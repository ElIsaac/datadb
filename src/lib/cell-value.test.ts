import { test } from "node:test";
import assert from "node:assert/strict";
import { cellText } from "./cell-value";

test("jsonb (objeto) se muestra como JSON, no como [object Object]", () => {
  assert.equal(cellText({ vip: true }), '{"vip":true}');
  assert.equal(cellText({ a: { b: [1, 2] } }), '{"a":{"b":[1,2]}}');
});

test("arrays de Postgres conservan su estructura", () => {
  assert.equal(cellText(["vip", "cross-border"]), '["vip","cross-border"]');
  assert.equal(cellText([]), "[]");
});

test("binarios (bytea / Uint8Array) se muestran en hex, no como bytes sueltos", () => {
  assert.equal(cellText(new Uint8Array([0xde, 0xad, 0x01])), "\\xdead01");
});

test("los primitivos no cambian", () => {
  assert.equal(cellText("hola"), "hola");
  assert.equal(cellText(42), "42");
  assert.equal(cellText(true), "true");
  assert.equal(cellText(""), "");
});

test("null y undefined devuelven null: cada sitio decide cómo pintarlos (NULL, vacío…)", () => {
  assert.equal(cellText(null), null);
  assert.equal(cellText(undefined), null);
});
