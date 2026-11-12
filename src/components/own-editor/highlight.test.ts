import { test } from "node:test";
import assert from "node:assert/strict";
import { highlightLines } from "./highlight";

/** Texto de una línea, tal como lo pintaría el editor. */
const pintado = (linea: string, dialecto: "postgres" | "mysql" | "standard" = "standard") => {
  const [tokens] = highlightLines([linea], dialecto);
  return tokens.map((t) => ({ cls: t.cls, txt: linea.slice(t.from, t.to) }));
};

test("palabras clave y funciones", () => {
  const t = pintado("select count(*) from users");
  assert.deepEqual(t[0], { cls: "ld-kw", txt: "select" });
  assert.deepEqual(t[1], { cls: "ld-fn", txt: "count" });
  assert.ok(t.some((x) => x.cls === "ld-kw" && x.txt === "from"));
  // «users» no es clave: es un identificador.
  assert.deepEqual(t[t.length - 1], { cls: "ld-var", txt: "users" });
});

test("tipos de dato se distinguen de las columnas", () => {
  const t = pintado("create table t (id integer, nombre varchar(40))");
  assert.ok(t.some((x) => x.cls === "ld-type" && x.txt === "integer"));
  assert.ok(t.some((x) => x.cls === "ld-type" && x.txt === "varchar"));
});

test("cadenas con comillas escapadas al estilo SQL", () => {
  const t = pintado("select 'it''s ok' as x");
  assert.ok(t.some((x) => x.cls === "ld-str" && x.txt === "'it''s ok'"));
});

test("en MySQL una cadena con \\' no se corta", () => {
  const t = pintado("select 'a\\'b' as x", "mysql");
  assert.ok(t.some((x) => x.cls === "ld-str" && x.txt === "'a\\'b'"));
});

test("comentario de línea", () => {
  const t = pintado("select 1 -- esto es un comentario");
  assert.ok(t.some((x) => x.cls === "ld-com" && x.txt === "-- esto es un comentario"));
});

test("comentario de bloque que cruza líneas", () => {
  const lineas = highlightLines(["select 1 /* abre", "sigue el comentario", "cierra */ select 2"]);
  const a = lineas[0];
  const b = lineas[1];
  const c = lineas[2];
  // «select 1 /* abre» tiene 16 caracteres: el comentario llega al final de la línea.
  assert.deepEqual(a[a.length - 1], { from: 9, to: 16, cls: "ld-com" });
  assert.deepEqual(b[0], { from: 0, to: "sigue el comentario".length, cls: "ld-com" });
  assert.equal(c[0].cls, "ld-com");
  assert.ok(c.some((t) => t.cls === "ld-kw"), "tras cerrar el comentario se vuelve a pintar SQL");
});

test("números incluidos decimales y parámetros $1", () => {
  const t = pintado("select 42, 3.14, $1 from t");
  const nums = t.filter((x) => x.cls === "ld-num").map((x) => x.txt);
  assert.deepEqual(nums, ["42", "3.14", "$1"]);
});

test("identificadores entre comillas dobles y backticks no son cadenas", () => {
  const pg = pintado('select "Mi Columna" from t', "postgres");
  assert.ok(pg.some((x) => x.cls === "ld-var" && x.txt === '"Mi Columna"'));
  const my = pintado("select `mi_col` from t", "mysql");
  assert.ok(my.some((x) => x.cls === "ld-var" && x.txt === "`mi_col`"));
});

test("los tramos cubren exactamente el texto, sin huecos ni solapes", () => {
  const linea = "select a.id, count(*) from public.t where a.x = 'y'";
  const [tokens] = highlightLines([linea]);
  let cursor = 0;
  for (const t of tokens) {
    assert.ok(t.from >= cursor, `solape en ${t.from}`);
    assert.ok(t.to > t.from, "token vacío");
    cursor = t.to;
  }
  assert.ok(cursor <= linea.length);
});

/**
 * R92 — coloreado de columnas. Se pasa un esquema mínimo (todo en minúsculas, como lo normaliza la
 * consola) y se comprueba la clase de cada palabra. Los colores son tokens del tema (`--gdb-col`),
 * no hex: aquí solo se mide la CLASE que el lexer elige.
 */
const conEsquema = (
  linea: string,
  columnas: string[],
  tablas: string[],
  dialecto: "postgres" | "mysql" | "standard" = "postgres"
) => {
  const [tokens] = highlightLines([linea], dialecto, {
    columnas: new Set(columnas),
    tablas: new Set(tablas),
  });
  return tokens.map((t) => ({ cls: t.cls, txt: linea.slice(t.from, t.to) }));
};

test("columna: la columna se pinta con su clase y la tabla se queda como estaba", () => {
  const t = conEsquema("select id, nombre from clientes", ["id", "nombre"], ["clientes"]);
  assert.deepEqual(t.find((x) => x.txt === "id"), { cls: "ld-col", txt: "id" });
  assert.deepEqual(t.find((x) => x.txt === "nombre"), { cls: "ld-col", txt: "nombre" });
  assert.deepEqual(t.find((x) => x.txt === "clientes"), { cls: "ld-var", txt: "clientes" });
});

test("columna: `alias.columna` es columna aunque haya una tabla con ese nombre", () => {
  const t = conEsquema("select p.pedidos, p.total from pedidos p", ["pedidos", "total"], ["pedidos"]);
  const de = (texto: string) => t.filter((x) => x.txt === texto).map((x) => x.cls);
  // Dos apariciones de «pedidos»: la del alias (miembro, columna) y la tabla suelta.
  assert.deepEqual(de("pedidos"), ["ld-col", "ld-var"]);
  assert.deepEqual(de("total"), ["ld-col"]);
});

test("columna: sin nombres conocidos nada se pinta como columna", () => {
  const t = pintado("select id from clientes");
  assert.ok(t.every((x) => x.cls !== "ld-col"));
});

test("columna: clave y función siguen mandando sobre la columna", () => {
  const t = conEsquema("select count(id) from t", ["count", "select", "id"], []);
  assert.deepEqual(t.find((x) => x.txt === "select"), { cls: "ld-kw", txt: "select" });
  assert.deepEqual(t.find((x) => x.txt === "count"), { cls: "ld-fn", txt: "count" });
  assert.deepEqual(t.find((x) => x.txt === "id"), { cls: "ld-col", txt: "id" });
});
