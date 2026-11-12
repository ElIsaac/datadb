import { test } from "node:test";
import assert from "node:assert/strict";
import { contextualSuggestions, detectCompletionContext } from "@/lib/sql-completion";
import {
  completionWindow,
  insertionFor,
  popupWidthFor,
  rankSuggestions,
  shouldOpenAfterSpace,
  type Suggestion,
} from "@/components/own-editor/completion";
import type { ColumnMeta, SchemaNode, TableMeta } from "@/lib/types";

/**
 * R89 — autocompletado por contexto. Cada test reproduce una queja concreta del usuario
 * (2026-10-21, capturas de la consola contra tienda-db-prod) o una regla de la tabla de
 * posiciones de `sql-completion.ts`. El cursor se marca con `│` en el SQL de cada caso.
 *
 * R99-B añade la regla de los tres huecos del JOIN (2026-10-23): `JOIN │` solo tablas, el hueco del
 * alias solo `ON`/`USING`, y la relación por FK detrás de `ON` con el alias ya tecleado.
 */

const col = (name: string, type: string, extra: Partial<ColumnMeta> = {}): ColumnMeta => ({
  name,
  type,
  isPrimaryKey: false,
  nullable: true,
  ...extra,
});
const table = (name: string, columns: ColumnMeta[]): TableMeta => ({ name, type: "table", columns });

const ESQUEMA: SchemaNode[] = [
  {
    name: "acme",
    routines: [],
    triggers: [],
    tables: [
      table("clientes", [col("id", "int", { isPrimaryKey: true }), col("nombre", "varchar"), col("email", "varchar")]),
      table("pedidos", [
        col("id", "int", { isPrimaryKey: true }),
        col("cliente_id", "int", { fk: { schema: "acme", table: "clientes", column: "id" } }),
        col("fecha", "datetime"),
        col("total", "decimal"),
      ]),
      table("banks_deposits_bankdeposit", [
        col("id", "int", { isPrimaryKey: true }),
        col("date_operation", "datetime"),
        col("date_aplication", "datetime"),
        col("concept", "varchar"),
      ]),
      table("banks_deposits_audit", [col("id", "int", { isPrimaryKey: true }), col("charge", "decimal")]),
      table("expenses_charge", [col("date", "datetime")]),
      table("auth_user", [col("date_joined", "datetime")]),
    ],
  },
  {
    name: "otro",
    routines: [],
    triggers: [],
    tables: [table("clientes", [col("id", "int")]), table("facturas", [col("folio", "varchar")])],
  },
];

/** Sugerencias en la posición de `│`, ya ordenadas como las pinta el popup. */
function at(sqlConCursor: string): Suggestion[] {
  const offset = sqlConCursor.indexOf("│");
  assert.ok(offset >= 0, "falta el cursor │ en el caso");
  const text = sqlConCursor.replace("│", "");
  const items = contextualSuggestions({ text, offset, schema: ESQUEMA, defaultSchema: "acme" });
  let from = offset;
  while (from > 0 && /[\p{L}\p{N}_$]/u.test(text[from - 1])) from--;
  return rankSuggestions(items, text.slice(from, offset));
}
const labels = (items: Suggestion[]) => items.map((i) => i.label);
const ctx = (sqlConCursor: string) =>
  detectCompletionContext(sqlConCursor.replace("│", ""), sqlConCursor.indexOf("│"));

test("detrás de FROM salen tablas, nunca columnas (captura 1: `from banks_de`)", () => {
  const items = at("SELECT * FROM banks_deposits_bankdeposit\nwhere id =11981082;\n\nSELECT * from banks_de│");
  assert.deepEqual(labels(items), ["banks_deposits_audit", "banks_deposits_bankdeposit"]);
  assert.ok(items.every((i) => i.kind === "table"));
});

test("en la proyección salen SOLO columnas de las tablas de la consulta (captura 2: `SELECT date`)", () => {
  const items = at("SELECT date│ from banks_deposits_bankdeposit");
  const cols = items.filter((i) => i.kind === "column");
  assert.deepEqual(labels(cols), ["date_operation", "date_aplication"]);
  // `date` de expenses_charge y `date_joined` de auth_user ya no se cuelan.
  assert.ok(!labels(items).includes("date"));
  assert.ok(!labels(items).includes("date_joined"));
  // Ni tablas en la proyección cuando ya hay FROM.
  assert.ok(!items.some((i) => i.kind === "table"));
});

test("la proyección se completa aunque el FROM esté DETRÁS del cursor", () => {
  const items = at("SELECT │ FROM pedidos");
  const cols = labels(items.filter((i) => i.kind === "column"));
  assert.deepEqual(cols, ["id", "cliente_id", "fecha", "total"]);
});

test("WHERE, ORDER BY y SET también se limitan a las columnas de la consulta", () => {
  assert.deepEqual(labels(at("SELECT * FROM clientes WHERE n│")).slice(0, 1), ["nombre"]);
  assert.ok(!labels(at("SELECT * FROM clientes ORDER BY │")).includes("fecha"));
  assert.deepEqual(
    labels(at("UPDATE pedidos SET │").filter((i) => i.kind === "column")),
    ["id", "cliente_id", "fecha", "total"]
  );
  assert.deepEqual(labels(at("INSERT INTO clientes (│")), ["id", "nombre", "email"]);
});

test("sin tablas en la consulta, la proyección no inventa columnas", () => {
  const items = at("SELECT │");
  assert.ok(!items.some((i) => i.kind === "column"));
});

test("con varias tablas, la columna repetida sale cualificada con su alias", () => {
  const items = at("SELECT │ FROM pedidos p JOIN clientes c ON p.cliente_id = c.id");
  const cols = labels(items.filter((i) => i.kind === "column"));
  assert.ok(cols.includes("p.id") && cols.includes("c.id"));
  assert.ok(!cols.includes("id"), "un `id` a secas sería ambiguo");
  assert.ok(cols.includes("nombre") && cols.includes("fecha"));
  // Y los alias, para escribir `c.` sin recordar a qué tabla apuntan.
  assert.ok(items.some((i) => i.kind === "alias" && i.label === "c"));
});

test("`alias.` propone solo las columnas de esa tabla", () => {
  assert.deepEqual(labels(at("SELECT c.│ FROM pedidos p JOIN clientes c ON 1=1")), ["id", "nombre", "email"]);
  assert.deepEqual(labels(at("SELECT pedidos.f│ FROM pedidos")), ["fecha"]);
  // Tabla que aún no está en el FROM: también resuelve.
  assert.deepEqual(labels(at("SELECT clientes.│")), ["id", "nombre", "email"]);
  // Un calificador que no existe no se rellena con ruido.
  assert.deepEqual(at("SELECT zz.│ FROM pedidos"), []);
});

test("`esquema.` propone las tablas de ese esquema", () => {
  assert.deepEqual(labels(at("SELECT * FROM otro.│")), ["clientes", "facturas"]);
});

// R99-B (2026-10-23, reporte contra tienda-db-prod): los tres huecos del JOIN están
// separados. 1) tras `JOIN` van SOLO tablas (no la relación `tabla ON …`, que no deja hueco para el
// alias); 2) entre la tabla y el ON SOLO `ON`/`USING` (ese hueco es del alias: aceptar una
// sugerencia con espacios reemplaza la ventana de palabra y se come lo tecleado, p. ej. el alias
// a medias `ban`); 3) la relación por FK se ofrece tras `ON`, ya respetando el alias tecleado.

test("detrás de JOIN (hueco de tabla) salen SOLO tablas y esquemas, sin la relación combinada `tabla ON …`", () => {
  const items = at("SELECT * FROM pedidos JOIN │");
  // Detrás de `JOIN ` es el hueco de la tabla: ni condiciones de relación ni nada con espacios
  // que, al aceptarse, reemplace texto ya escrito.
  assert.ok(!items.some((i) => i.kind === "join"), `había sugerencias join: ${labels(items)}`);
  assert.ok(items.every((i) => !(i.insert ?? "").includes(" ON ")));
  // Sigue habiendo tablas del esquema y ninguna columna.
  assert.ok(items.some((i) => i.kind === "table" && i.label === "auth_user"));
  assert.ok(!items.some((i) => i.kind === "column"));
});

test("el hueco del ALIAS (`JOIN clientes │`) ofrece SOLO ON y USING — nada más", () => {
  const items = at("SELECT * FROM pedidos p INNER JOIN clientes │");
  // Antes aquí salían las condiciones `ON` por FK (`ON p.cliente_id = c.id`) y el resto de
  // palabras clave del FROM: al aceptarlas, la ventana de palabra (el alias ya escrito) era
  // reemplazada por el texto completo y el alias desaparecía del SQL.
  assert.deepEqual(labels(items), ["ON", "USING"]);
  assert.ok(items.every((i) => i.kind === "keyword"));
});

test("alias a medias (`INNER JOIN clientes ban│`): aceptar una sugerencia NO puede borrar el alias", () => {
  const items = at("SELECT * FROM pedidos p INNER JOIN clientes ban│");
  // La palabra a medias `ban` es par de la tabla del JOIN, no un prefijo suelto: el popup queda
  // vacío (con el prefijo `ban` no casa ninguna de las etiquetas sin espacios).
  assert.deepEqual(labels(items), []);
  // El assert obligatorio de la regla: esta clasificación es `after-relation` (ve el hueco del
  // alias), así que aunque el ranking devolviera algo, NADA del popup puede llevar la condición
  // dentro (`… ON …`) ni empezar por `ON `: aceptarla sustituiría la ventana de palabra (`ban`),
  // que es justamente el alias.
  for (const item of items) {
    const insertado = item.insert ?? item.label;
    assert.ok(
      !insertado.includes(" ON ") && !insertado.startsWith("ON "),
      `sugerencia peligrosa («se comería el alias»): ${insertado}`
    )
  }
});

test("detrás de ON, la condición por FK y luego columnas cualificadas", () => {
  const items = at("SELECT * FROM pedidos p INNER JOIN clientes c ON │");
  assert.equal(items[0].label, "p.cliente_id = c.id");
  assert.ok(labels(items).includes("c.nombre"));
  // Sin alias, con el nombre real de la tabla.
  assert.equal(at("SELECT * FROM pedidos JOIN clientes ON │")[0].label, "pedidos.cliente_id = clientes.id");
  // Y con los alias invertidos: la condición usa el alias del ÚLTIMO JOIN (`p`), no la tabla.
  assert.equal(at("SELECT * FROM clientes c INNER JOIN pedidos p ON │")[0].label, "p.cliente_id = c.id");
});

test("REGRESIÓN del reporte (2026-10-23): tras aceptar la condición del ON, el alias sigue en el SQL", () => {
  const texto = "SELECT * FROM clientes c INNER JOIN pedidos p ON ";
  const offset = texto.length;
  const sugerencias = contextualSuggestions({ text: texto, offset, schema: ESQUEMA, defaultSchema: "acme" });
  const primera = rankSuggestions(sugerencias, "")[0];
  // La condición sugerida lleva el alias tecleado del último JOIN (`p`, no `pedidos`).
  assert.equal(primera.label, "p.cliente_id = c.id");
  // Aceptación en puro, igual que hace el editor: se reemplaza la ventana de palabra completa.
  const win = completionWindow(texto, offset);
  const resultado = texto.slice(0, win.from) + insertionFor(primera) + texto.slice(offset);
  assert.ok(resultado.includes("INNER JOIN pedidos p ON p.cliente_id = c.id"), resultado);
  // El alias `p` sigue ahí: antes, aceptar una sugerencia con espacios se comía lo tecleado.
  assert.ok(resultado.includes("pedidos p "), resultado);
});

test("detrás de una relación salen las palabras clave que siguen", () => {
  assert.equal(labels(at("SELECT * FROM pedidos w│"))[0], "WHERE");
  // Los modificadores de JOIN (INNER…) cuentan como «detrás de la relación»; con la cláusula FROM
  // el popup sigue ofreciendo las palabras que continúan el FROM, `JOIN` entre ellas (R99-B solo
  // recortó el hueco de la tabla ya unida, `… JOIN t │`, que es el del alias).
  assert.ok(labels(at("SELECT * FROM pedidos INNER j│")).includes("JOIN"));
  assert.equal(ctx("SELECT * FROM pedidos INNER j│").kind, "after-relation");
  assert.deepEqual(ctx("SELECT * FROM a, │"), { kind: "relation", clause: "FROM" });
});

test("con una expresión completa delante, FROM gana a las columnas que empiezan igual", () => {
  assert.equal(labels(at("SELECT * f│"))[0], "FROM");
  assert.equal(labels(at("SELECT fecha f│ FROM pedidos"))[0], "FROM");
});

test("inicio de sentencia, también detrás de un `;`", () => {
  assert.equal(labels(at("SEL│"))[0], "SELECT");
  assert.equal(labels(at("SELECT 1;\nup│"))[0], "UPDATE");
});

test("dentro de una cadena o de un comentario no se propone nada", () => {
  assert.deepEqual(at("SELECT * FROM pedidos WHERE nombre = 'cli│"), []);
  assert.deepEqual(at("SELECT 1 -- from cli│"), []);
  assert.deepEqual(at("SELECT /* pedi│ */ 1"), []);
  // Justo detrás de la comilla de cierre ya se está fuera.
  assert.deepEqual(ctx("SELECT 'a' │"), { kind: "column", clause: "SELECT", afterExpression: true });
});

test("COUNT(│ hereda la cláusula de fuera: columnas de la consulta", () => {
  const items = at("SELECT COUNT(│) FROM pedidos");
  assert.ok(items.some((i) => i.kind === "column" && i.label === "fecha"));
  assert.ok(!items.some((i) => i.label === "nombre"));
});

test("el popup se abre solo tras `JOIN ` y `ON `, no tras cualquier espacio", () => {
  assert.equal(shouldOpenAfterSpace("FROM pedidos INNER JOIN "), true);
  assert.equal(shouldOpenAfterSpace("JOIN clientes c on "), true);
  assert.equal(shouldOpenAfterSpace("SELECT * FROM "), false);
  assert.equal(shouldOpenAfterSpace("WHERE nombre = 'don "), false);
});

test("el popup es tan ancho como su fila más larga (ya no corta `banks_deposits_bankdeposit`)", () => {
  // La fila exacta de la captura 1: nombre largo + base larga a la derecha.
  const items: Suggestion[] = [
    { label: "banks_deposits_bankdeposit", detail: "tienda-db-prod", kind: "table" },
    { label: "banks_deposits_audit", detail: "tienda-db-prod", kind: "table" },
  ];
  const w = popupWidthFor(items, 1200);
  assert.ok(w > 340, `antes el tope era 340 px; ahora ${w}`);
  // Acotado al área visible.
  assert.equal(popupWidthFor(items, 300), 300);
  // Y nunca menos del mínimo.
  assert.equal(popupWidthFor([{ label: "id" }], 1200), 260);
});
