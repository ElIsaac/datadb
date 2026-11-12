/**
 * Helpers de la vista de documentos (fase 81). Se prueban sin base de datos: son la traducción entre
 * lo que llega del worker (EJSON) y lo que se pinta (notación de Compass / shell de Mongo).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { esHoja, textoDeValor, tipoDeValor } from "./mongo-view";

test("cada valor se reconoce por su tipo, incluidos los envoltorios de BSON", () => {
  assert.equal(tipoDeValor("hola"), "string");
  assert.equal(tipoDeValor(42), "number");
  assert.equal(tipoDeValor(true), "boolean");
  assert.equal(tipoDeValor(null), "null");
  assert.equal(tipoDeValor([1, 2]), "array");
  assert.equal(tipoDeValor({ a: 1 }), "object");
  assert.equal(tipoDeValor({ $oid: "6718190465448bf0ae986f6b" }), "objectid");
  assert.equal(tipoDeValor({ $date: "2024-10-22T00:00:00.000Z" }), "date");
  assert.equal(tipoDeValor({ $numberDecimal: "1.50" }), "decimal");
  assert.equal(tipoDeValor({ $numberLong: "7" }), "long");
  assert.equal(tipoDeValor({ $binary: { base64: "AAEC", subType: "00" } }), "binary");
  assert.equal(tipoDeValor({ $regularExpression: { pattern: "^a", options: "i" } }), "regex");
});

test("se pinta como en Compass: ObjectId, ISODate, NumberDecimal", () => {
  assert.equal(textoDeValor({ $oid: "6718190465448bf0ae986f6b" }), "ObjectId('6718190465448bf0ae986f6b')");
  assert.equal(textoDeValor({ $date: "2024-10-22T00:00:00.000Z" }), "ISODate('2024-10-22T00:00:00.000Z')");
  assert.equal(textoDeValor({ $numberDecimal: "1.50" }), "NumberDecimal('1.50')");
  assert.equal(textoDeValor({ $numberLong: "7" }), "NumberLong(7)");
  assert.equal(textoDeValor({ $regularExpression: { pattern: "^a", options: "i" } }), "/^a/i");
});

test("las fechas canónicas (milisegundos) también se pintan como ISODate", () => {
  assert.equal(
    textoDeValor({ $date: { $numberLong: String(Date.UTC(2024, 9, 22)) } }),
    "ISODate('2024-10-22T00:00:00.000Z')"
  );
});

test("objetos y arrays se resumen; lo demás se pinta entero", () => {
  assert.equal(textoDeValor({ a: 1, b: 2 }), "{2 campos}");
  assert.equal(textoDeValor([1, 2, 3]), "[3]");
  assert.equal(textoDeValor("hola"), '"hola"');
  assert.equal(textoDeValor(null), "null");
  assert.equal(textoDeValor(42), "42");
  assert.equal(textoDeValor(false), "false");
});

test("un valor que no es objeto ni array es hoja; objeto y array se despliegan", () => {
  assert.equal(esHoja("objectid"), true);
  assert.equal(esHoja("string"), true);
  assert.equal(esHoja("object"), false);
  assert.equal(esHoja("array"), false);
});

test("un BinData largo se recorta para que no rompa la fila", () => {
  const base64 = "A".repeat(80);
  const texto = textoDeValor({ $binary: { base64, subType: "00" } });
  assert.match(texto, /^BinData\(00, 'A{24}…'\)$/);
});
