/**
 * El resaltado se prueba por TRAMOS, no por píxeles: cada trozo tiene que caer en el tipo correcto,
 * porque el color del espejo es lo único que el usuario ve de la sintaxis.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenizarConsulta, type TipoToken } from "./mongo-highlight";

const tipos = (texto: string) => tokenizarConsulta(texto).map((t) => [t.texto, t.tipo]);
const tipoDe = (texto: string, buscado: string): TipoToken | undefined =>
  tokenizarConsulta(texto)
    .filter((t) => t.tipo !== "espacio")
    .find((t) => t.texto === buscado)?.tipo;

test("claves, cadenas, números y literales", () => {
  const t = tipos('{ cliente: "ACME", total: 1200, activo: true, nada: null }');
  assert.deepEqual(tipoDe('{ cliente: "ACME" }', "cliente"), "clave");
  assert.equal(tipoDe('{ cliente: "ACME" }', '"ACME"'), "cadena");
  assert.equal(tipoDe("{ total: 1200 }", "1200"), "numero");
  assert.equal(tipoDe("{ activo: true }", "true"), "literal");
  assert.equal(tipoDe("{ nada: null }", "null"), "literal");
  assert.ok(t.length > 0);
});

test("una clave entre comillas también se pinta como clave, no como texto", () => {
  assert.equal(tipoDe('{ "detalle.pais": "MX" }', '"detalle.pais"'), "clave");
  // El valor sigue siendo cadena: el `:` es lo que distingue una de otra.
  assert.equal(tipoDe('{ "detalle.pais": "MX" }', '"MX"'), "cadena");
});

test("los operadores $ y los constructores tienen su propio tipo", () => {
  assert.equal(tipoDe('{ a: { $gt: 10 } }', "$gt"), "operador");
  assert.equal(tipoDe('{ a: { $regex: "x", $options: "i" } }', "$regex"), "operador");
  assert.equal(tipoDe('{ _id: ObjectId("6718190465448bf0ae986f6b") }', "ObjectId"), "constructor");
  assert.equal(tipoDe('{ f: ISODate("2024-01-01") }', "ISODate"), "constructor");
});

test("la puntuación va aparte, para poder atenuarla", () => {
  const t = tokenizarConsulta('{ a: 1 }');
  assert.deepEqual(
    t.filter((x) => x.tipo === "llave").map((x) => x.texto.trim()).filter(Boolean),
    ["{", ":", "}", ","].slice(0, 3)
  );
});

test("no se rompe con texto a medio escribir (es cuando más se mira)", () => {
  for (const texto of ["{", "{ a", "{ a:", "{ a: ", '{ a: { $gt', "}"]) {
    assert.doesNotThrow(() => tokenizarConsulta(texto), `revienta con ${JSON.stringify(texto)}`);
  }
  // Y el texto reconstruido es exactamente el de entrada: el espejo no puede perder caracteres.
  const raro = '{ "a b": "x\\"y", n: -12.5, ok: false }  ';
  assert.equal(tokenizarConsulta(raro).map((t) => t.texto).join(""), raro);
});

test("un número negativo y un decimal son un solo token", () => {
  assert.equal(tipoDe("{ a: -12.5 }", "-12.5"), "numero");
});

test("una palabra que no es clave ni constructor queda como texto normal", () => {
  assert.equal(tipoDe("{ a: foo }", "foo"), "texto");
  assert.equal(tipoDe("{ nombre: identificador }", "identificador"), "texto");
});
