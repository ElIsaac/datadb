/**
 * Las sugerencias de la barra de consulta tienen que ser EJECUTABLES. Un ejemplo que el propio
 * parser rechaza enseña mal: se copia, falla y el usuario concluye que Mongo no hace lo que dice la
 * ayuda. Estos tests recorren todas las plantillas y las pasan por el mismo camino que una consulta
 * escrita a mano (normalizador + EJSON).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BSON } from "mongodb";
import { normalizarConsulta } from "@/shared/mongo-query";
import { primerHueco, todasLasSugerencias, filtrarSugerencias, SUGERENCIAS_MONGO } from "./mongo-snippets";

test("toda plantilla es una consulta válida para la barra", () => {
  for (const s of todasLasSugerencias()) {
    const normalizada = normalizarConsulta(s.plantilla);
    assert.doesNotThrow(
      () => BSON.EJSON.parse(normalizada, { relaxed: false }),
      `la plantilla de «${s.etiqueta}» no parsea: ${normalizada}`
    );
  }
});

test("las plantillas producen objetos, no escalares ni arrays", () => {
  for (const s of todasLasSugerencias()) {
    const valor = BSON.EJSON.parse(normalizarConsulta(s.plantilla), { relaxed: false });
    assert.equal(typeof valor, "object", `«${s.etiqueta}» no devuelve un objeto`);
    assert.equal(Array.isArray(valor), false, `«${s.etiqueta}» devuelve un array`);
    assert.ok(Object.keys(valor as object).length > 0, `«${s.etiqueta}» está vacía`);
  }
});

test("cada sugerencia explica qué hace y no repite plantilla con otra", () => {
  const vistas = new Set<string>();
  for (const s of todasLasSugerencias()) {
    assert.ok(s.etiqueta.trim().length > 3, "una sugerencia sin etiqueta legible");
    assert.equal(vistas.has(s.plantilla), false, `plantilla duplicada: ${s.plantilla}`);
    vistas.add(s.plantilla);
  }
});

test("están las equivalencias de SQL que el usuario pidió (LIKE, IN, IS NULL, BETWEEN)", () => {
  const sql = todasLasSugerencias().map((s) => s.sql ?? "").join(" | ");
  assert.match(sql, /LIKE '%texto%'/);
  assert.match(sql, /IN \('a', 'b'\)/);
  assert.match(sql, /IS NULL/);
  assert.match(sql, /BETWEEN 10 AND 20/);
  assert.match(sql, /AND/);
  assert.match(sql, /OR/);
});

test("el buscador encuentra por SQL, por operador y por nombre", () => {
  assert.ok(filtrarSugerencias("like").flatMap((g) => g.items).some((i) => i.sql?.includes("LIKE")));
  assert.ok(filtrarSugerencias("$regex").flatMap((g) => g.items).length >= 1);
  assert.ok(filtrarSugerencias("array").flatMap((g) => g.items).length >= 2);
  assert.deepEqual(filtrarSugerencias("no existe eso"), []);
  assert.equal(filtrarSugerencias("").length, SUGERENCIAS_MONGO.length);
});

test("cada plantilla con valores selecciona su primer hueco al insertarla", () => {
  const r = primerHueco('{ campo: { $regex: "texto", $options: "i" } }');
  assert.ok(r);
  const texto = '{ campo: { $regex: "texto", $options: "i" } }'.slice(r.inicio, r.fin);
  assert.equal(texto, "texto", "se selecciona el valor, no la clave");

  // Las de solo operadores no tienen hueco: no se selecciona nada y no hay error.
  assert.equal(primerHueco("{ $and: [ ] }"), null);
  // Todas las sugerencias con valores de ejemplo tienen un hueco seleccionable.
  const conValor = todasLasSugerencias().filter((s) => /"/.test(s.plantilla));
  for (const s of conValor) assert.ok(primerHueco(s.plantilla), `«${s.etiqueta}» sin hueco`);
});
