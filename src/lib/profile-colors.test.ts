import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROFILE_COLOR, colorDeTinte, fondoTenido } from "./profile-colors";

test("R18: solo tiñe un color elegido; el azul de fábrica y lo inválido no", () => {
  assert.equal(colorDeTinte("#ef4444"), "#ef4444");
  assert.equal(colorDeTinte(DEFAULT_PROFILE_COLOR), null);
  assert.equal(colorDeTinte(DEFAULT_PROFILE_COLOR.toUpperCase()), null);
  assert.equal(colorDeTinte(undefined), null);
  assert.equal(colorDeTinte(""), null);
  assert.equal(colorDeTinte("rojo"), null);
});

test("R18: el fondo teñido escala con la intensidad del tema", () => {
  assert.equal(
    fondoTenido("#ef4444", "var(--gdb-editor)", 20),
    "color-mix(in srgb, #ef4444 calc(var(--gdb-tint) * 20%), var(--gdb-editor))"
  );
});
