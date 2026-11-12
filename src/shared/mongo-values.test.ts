/**
 * Conversión y diff de la edición de documentos. Lo que se fija aquí es lo que evita corromper datos:
 * que un número no se guarde como texto, que un texto inválido NO se acepte y que solo se manden los
 * campos que de verdad cambiaron.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cambiosRespectoA,
  convertirTexto,
  esEditable,
  mismoValor,
  textoEditable,
} from "./mongo-values";

test("un número sigue siendo número (no se guarda \"1200\")", () => {
  assert.deepEqual(convertirTexto("1200", "number"), { ok: true, valor: 1200 });
  // La coma decimal se acepta porque es lo que se teclea con teclado en español.
  assert.deepEqual(convertirTexto("12,5", "number"), { ok: true, valor: 12.5 });
  assert.equal(convertirTexto("-3", "number").ok, true);
});

test("un texto que no es número se rechaza con su motivo", () => {
  const r = convertirTexto("abc", "number");
  assert.equal(r.ok, false);
  assert.match((r as { error: string }).error, /no es un número/);
  assert.equal(convertirTexto("", "number").ok, false);
});

test("booleanos: solo true y false (nada de 1/si)", () => {
  assert.deepEqual(convertirTexto("true", "boolean"), { ok: true, valor: true });
  assert.deepEqual(convertirTexto("false", "boolean"), { ok: true, valor: false });
  assert.equal(convertirTexto("1", "boolean").ok, false);
  assert.equal(convertirTexto("si", "boolean").ok, false);
});

test("las cadenas se guardan tal cual, con espacios incluidos", () => {
  assert.deepEqual(convertirTexto(" ACME ", "string"), { ok: true, valor: " ACME " });
  assert.deepEqual(convertirTexto("", "string"), { ok: true, valor: "" });
});

test("objetos y arrays NO son editables en la tarjeta (van a su propio editor)", () => {
  assert.equal(esEditable("string"), true);
  assert.equal(esEditable("number"), true);
  assert.equal(esEditable("boolean"), true);
  assert.equal(esEditable("null"), true);
  assert.equal(esEditable("object"), false);
  assert.equal(esEditable("array"), false);
  assert.equal(esEditable("objectid"), false);
});

test("el input arranca con el texto del valor, sin comillas", () => {
  assert.equal(textoEditable("ACME"), "ACME");
  assert.equal(textoEditable(1200), "1200");
  assert.equal(textoEditable(true), "true");
  assert.equal(textoEditable(null), "");
});

test("el diff manda SOLO lo cambiado", () => {
  const original = { cliente: "ACME", total: 1000, activo: true };
  const borrador = { cliente: "ACME", total: 1200, activo: true };
  assert.deepEqual(cambiosRespectoA(original, borrador), { total: 1200 });
});

test("volver al valor original deja el diff vacío (no se manda nada)", () => {
  const original = { cliente: "ACME", total: 1000 };
  const borrador = { cliente: "ACME", total: 1000 };
  assert.deepEqual(cambiosRespectoA(original, borrador), {});
  assert.equal(mismoValor(1000, 1000), true);
  assert.equal(mismoValor("1000", 1000), false, "texto y número no son el mismo valor");
  assert.equal(mismoValor(null, undefined), true);
});

test("un campo nuevo también cuenta como cambio", () => {
  assert.deepEqual(cambiosRespectoA({ a: 1 }, { a: 1, nuevo: "x" }), { nuevo: "x" });
});
