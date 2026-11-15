import { test } from "node:test";
import assert from "node:assert/strict";
import {
  completionWindow,
  insertionFor,
  popupVerticalPlacement,
  rankSuggestions,
  shouldOpenAfter,
  type Suggestion,
} from "@/components/own-editor/completion";

const items: Suggestion[] = [
  { label: "SELECT", kind: "keyword" },
  { label: "id", kind: "column" },
  { label: "id_cliente", kind: "column" },
  { label: "cliente_nombre", kind: "column" },
  { label: "clientes", kind: "table" },
];

test("la ventana es la palabra que se está escribiendo", () => {
  assert.deepEqual(completionWindow("select cli", 10), { from: 7, prefix: "cli" });
  assert.deepEqual(completionWindow("select ", 7), { from: 7, prefix: "" });
});

test("tras un punto, la ventana empieza después del alias", () => {
  assert.deepEqual(completionWindow("c.na", 4), { from: 2, prefix: "na" });
  assert.deepEqual(completionWindow("c.", 2), { from: 2, prefix: "" });
});

test("el prefijo literal gana a la subsecuencia y el más corto primero", () => {
  const ranked = rankSuggestions(items, "id");
  assert.deepEqual(
    ranked.map((i) => i.label),
    ["id", "id_cliente"]
  );
});

test("la subsecuencia encuentra nombres largos", () => {
  // `cln` casa con «clientes» y con «cliente_nombre»; gana el más corto. `clnm` solo casa con el
  // segundo, que es lo que se quería demostrar.
  const cln = rankSuggestions(items, "cln").map((i) => i.label);
  assert.ok(cln.includes("cliente_nombre"), "la subsecuencia llega al nombre largo");
  assert.ok(cln[0] === "clientes", "y gana el nombre más corto entre los que casan");
  assert.deepEqual(
    rankSuggestions(items, "clnm").map((i) => i.label),
    ["cliente_nombre"]
  );
});

test("sin prefijo se respeta el orden del llamador", () => {
  assert.deepEqual(
    rankSuggestions(items, "").map((i) => i.label),
    items.map((i) => i.label)
  );
});

test("sin coincidencias, lista vacía", () => {
  assert.deepEqual(rankSuggestions(items, "zzz"), []);
});

test("el tope corta la lista", () => {
  assert.equal(rankSuggestions(items, "", 2).length, 2);
});

test("aceptar inserta `insert` si existe y si no el label", () => {
  assert.equal(insertionFor({ label: "sel", insert: "SELECT * FROM " }), "SELECT * FROM ");
  assert.equal(insertionFor({ label: "id" }), "id");
});

test("el popup no se abre tras espacio, coma ni paréntesis", () => {
  assert.equal(shouldOpenAfter("a"), true);
  assert.equal(shouldOpenAfter("_"), true);
  assert.equal(shouldOpenAfter("."), true);
  assert.equal(shouldOpenAfter(" "), false);
  assert.equal(shouldOpenAfter(","), false);
  assert.equal(shouldOpenAfter("("), false);
});

test("popupVerticalPlacement places below when there is enough room", () => {
  const res = popupVerticalPlacement({
    itemCount: 5,
    lineTop: 24,
    lineHeight: 20,
    scrollTop: 0,
    viewportHeight: 320,
    contentHeight: 600,
  });
  assert.equal(res.placeAbove, false);
  assert.equal(res.top, 44);
  assert.equal(res.bottom, undefined);
  assert.equal(res.maxHeight, 264);
});

test("popupVerticalPlacement flips above when cursor is near bottom", () => {
  const res = popupVerticalPlacement({
    itemCount: 10,
    lineTop: 284,
    lineHeight: 20,
    scrollTop: 0,
    viewportHeight: 320,
    contentHeight: 600,
  });
  assert.equal(res.placeAbove, true);
  assert.equal(res.bottom, 600 - 284);
  assert.equal(res.top, undefined);
  assert.equal(res.maxHeight, 264);
});

test("popupVerticalPlacement clamps maxHeight when viewport is short", () => {
  const res = popupVerticalPlacement({
    itemCount: 12,
    lineTop: 140,
    lineHeight: 20,
    scrollTop: 0,
    viewportHeight: 180,
    contentHeight: 400,
  });
  assert.equal(res.placeAbove, true);
  assert.equal(res.bottom, 400 - 140);
  assert.equal(res.maxHeight, 136);
});
