import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarConsulta } from "./mongo-query";

/** Lo que de verdad importa: que el resultado sea JSON parseable y con la forma esperada. */
const parse = (t: string) => JSON.parse(normalizarConsulta(t));

test("claves sin comillas: lo que se escribe en Compass es válido", () => {
  assert.deepEqual(parse('{ name: "cuenta" }'), { name: "cuenta" });
  assert.deepEqual(parse("{ name: 'cuenta', activo: true }"), { name: "cuenta", activo: true });
  assert.deepEqual(parse('{ edad: { $gt: 30 }, __v: 0 }'), { edad: { $gt: 30 }, __v: 0 });
});

test("no toca lo que va dentro de una cadena", () => {
  assert.deepEqual(parse('{ texto: "a: b, c { d }" }'), { texto: "a: b, c { d }" });
  assert.deepEqual(parse('{ texto: "ObjectId(\\"x\\")" }'), { texto: 'ObjectId("x")' });
});

test("constructores del shell se vuelven envoltorios de EJSON", () => {
  assert.deepEqual(parse('{ _id: ObjectId("6718190465448bf0ae986f6b") }'), {
    _id: { $oid: "6718190465448bf0ae986f6b" },
  });
  assert.deepEqual(parse("{ _id: ObjectId('6718190465448bf0ae986f6b') }"), {
    _id: { $oid: "6718190465448bf0ae986f6b" },
  });
  assert.deepEqual(parse('{ n: NumberLong(7), d: NumberDecimal("1.50"), i: NumberInt(3) }'), {
    n: { $numberLong: "7" },
    d: { $numberDecimal: "1.50" },
    i: 3,
  });
  assert.deepEqual(parse('{ cuando: ISODate("2024-10-22T00:00:00Z") }'), {
    cuando: { $date: "2024-10-22T00:00:00Z" },
  });
  assert.deepEqual(parse('{ cuando: new Date("2024-10-22") }'), { cuando: { $date: "2024-10-22" } });
});

test("un JSON ya válido pasa intacto", () => {
  const original = '{"a": 1, "b": {"$gt": 2}}';
  assert.deepEqual(parse(original), { a: 1, b: { $gt: 2 } });
  assert.equal(normalizarConsulta(original), original);
});

test("palabras que no son clave ni constructor se dejan como están (y el parser se queja)", () => {
  // `true`/`false`/`null` no se citan: son literales de JSON.
  assert.deepEqual(parse('{ activo: true, otro: null }'), { activo: true, otro: null });
  // Un operador dentro de un valor no es clave: no se le ponen comillas.
  assert.deepEqual(JSON.parse(normalizarConsulta("{ $and: [] }")), { $and: [] });
});

test("texto vacío o basura no lanza: la barra de consulta decide qué hacer con el error", () => {
  assert.equal(normalizarConsulta(""), "");
  // Se cita la clave aunque el JSON siga incompleto: el error que llega nombra `edad`, no «position 2».
  assert.match(normalizarConsulta("{ edad: "), /"edad"/);
});
