import { test } from "node:test";
import assert from "node:assert/strict";
import { PALETTES } from "./palettes";
import { conteosDeTemas, temasVisibles } from "./galeria";

/* R98 (T1): filtros y conteos de la galería de temas. */

test("los conteos cuadran con la lista y suman oscuros + claros", () => {
  const c = conteosDeTemas(PALETTES, "");
  assert.equal(c.todos, PALETTES.length);
  assert.equal(c.oscuros + c.claros, c.todos);
  assert.equal(temasVisibles(PALETTES, "oscuros", "").length, c.oscuros);
  assert.equal(temasVisibles(PALETTES, "claros", "").length, c.claros);
});

test("la búsqueda ignora acentos y mayúsculas, y los chips cuentan con ella aplicada", () => {
  assert.deepEqual(
    temasVisibles(PALETTES, "todos", "ROSE").map((p) => p.id),
    ["rose-pine", "rose-pine-dawn"]
  );
  assert.deepEqual(conteosDeTemas(PALETTES, "rose"), { todos: 2, oscuros: 1, claros: 1 });
  assert.deepEqual(temasVisibles(PALETTES, "claros", "catppuccin").map((p) => p.id), ["catppuccin-latte"]);
  assert.equal(temasVisibles(PALETTES, "todos", "zzz").length, 0);
});
