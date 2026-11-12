import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EditorModel,
  TextBuffer,
  collapse,
  from,
  mapOffset,
  to,
  wordEndAfter,
  wordRangeAt,
  wordStartBefore,
} from "@/lib/editor-core/model";

/**
 * Tests del núcleo del editor propio (spike F2-B). Todo sin DOM: si el modelo está bien, el
 * componente solo puede pintar mal, que es un fallo de vista y no de lógica.
 */

test("buffer: offsets y posiciones van y vuelven", () => {
  const b = new TextBuffer("uno\ndos\ntres");
  assert.equal(b.lineCount, 3);
  assert.equal(b.length, 12);
  assert.deepEqual(b.positionAt(0), { line: 0, col: 0 });
  assert.deepEqual(b.positionAt(3), { line: 0, col: 3 });
  assert.deepEqual(b.positionAt(4), { line: 1, col: 0 });
  assert.deepEqual(b.positionAt(12), { line: 2, col: 4 });
  assert.equal(b.offsetAt(1, 2), 6);
  assert.equal(b.slice(2, 9), "o\ndos\nt");
  assert.equal(b.lineEnd(1), 7);
});

test("buffer: apply devuelve el inverso exacto", () => {
  const b = new TextBuffer("select 1");
  const inverse = b.apply({ from: 7, to: 8, insert: "42" });
  assert.equal(b.text, "select 42");
  b.apply(inverse);
  assert.equal(b.text, "select 1");
});

test("insertar reemplaza la selección y deja el cursor detrás", () => {
  const m = new EditorModel("select 1");
  m.setSelection({ anchor: 7, head: 8 });
  const s = m.insert("count(*)");
  assert.equal(s.text, "select count(*)");
  assert.equal(s.selection.head, 15);
});

test("borrar hacia atrás y hacia delante", () => {
  const m = new EditorModel("abc");
  m.setSelection(collapse(3));
  assert.equal(m.deleteBackward().text, "ab");
  m.setSelection(collapse(0));
  assert.equal(m.deleteForward().text, "b");
});

test("⌥⌫ borra la palabra, con acentos", () => {
  const m = new EditorModel("select canción");
  m.setSelection(collapse(14));
  assert.equal(m.deleteBackward(true).text, "select ");
  assert.equal(wordStartBefore("select canción", 14), 7);
  assert.equal(wordEndAfter("select canción", 7), 14);
});

test("doble clic: la palabra incluye acentos", () => {
  assert.deepEqual(wordRangeAt("select canción, x", 12), { from: 7, to: 14 });
  assert.deepEqual(wordRangeAt("select id, x", 8), { from: 7, to: 9 });
});

test("doble clic por el MODELO (el camino de la vista) selecciona la palabra entera", () => {
  // Regresión 2026-10-21: el método perdía la primera letra («anks_deposits_bankdeposit»).
  const m = new EditorModel("FROM banks_deposits_bankdeposit\nwhere id = 1");
  for (const offset of [5, 6, 12, 30, 31]) {
    assert.deepEqual(m.wordRangeAt(offset), { from: 5, to: 31 }, `clic en ${offset}`);
  }
  // Palabra al principio de una línea que no es la primera, y de una sola letra.
  assert.deepEqual(m.wordRangeAt(33), { from: 32, to: 37 });
  const uno = new EditorModel("a b");
  assert.deepEqual(uno.wordRangeAt(2), { from: 2, to: 3 });
  assert.deepEqual(uno.wordRangeAt(0), { from: 0, to: 1 });
});

test("⏎ copia la sangría y abre un paréntesis", () => {
  const m = new EditorModel("  select (");
  m.setSelection(collapse(10));
  const s = m.newline();
  assert.equal(s.text, "  select (\n    ");
  assert.equal(s.selection.head, 15);
});

test("⇥ indenta las líneas del bloque y conserva el cursor", () => {
  const m = new EditorModel("a\nb");
  m.setSelection({ anchor: 0, head: 3 });
  const s = m.indent();
  assert.equal(s.text, "  a\n  b");
  assert.equal(from(s.selection), 2);
  assert.equal(to(s.selection), 7);
});

test("⇧⇥ quita dos espacios y no toca lo que no los tiene", () => {
  const m = new EditorModel("    a\nb");
  m.setSelection({ anchor: 0, head: 7 });
  const s = m.outdent();
  assert.equal(s.text, "  a\nb");
  assert.equal(from(s.selection), 0);
});

test("⌘D duplica la línea y el cursor cae en la copia", () => {
  const m = new EditorModel("abc");
  m.setSelection(collapse(1));
  const s = m.duplicateLine();
  assert.equal(s.text, "abc\nabc");
  assert.equal(s.selection.head, 5);
});

test("⌥↑ / ⌥↓ mueven la línea con el cursor", () => {
  const m = new EditorModel("a\nb\nc");
  m.setSelection(collapse(0));
  assert.equal(m.moveLines(1).text, "b\na\nc");
  assert.equal(m.selection.head, 2, "el cursor viaja con la línea");
  assert.equal(m.moveLines(-1).text, "a\nb\nc");
  assert.equal(m.selection.head, 0);
});

test("⌥↓ en la última línea no hace nada", () => {
  const m = new EditorModel("a\nb");
  m.setSelection(collapse(3));
  const s = m.moveLines(1);
  assert.equal(s.text, "a\nb");
  assert.equal(s.selection.head, 3);
});

test("⌘/ comenta y descomenta el bloque", () => {
  const m = new EditorModel("select 1\nselect 2");
  m.setSelection({ anchor: 0, head: 17 });
  assert.equal(m.toggleComment().text, "-- select 1\n-- select 2");
  assert.equal(m.toggleComment().text, "select 1\nselect 2");
});

test("deshacer agrupa el tecleo seguido y lo separa por tiempo", () => {
  const m = new EditorModel("");
  m.insert("a");
  m.insert("b");
  m.insert("c");
  assert.equal(m.text, "abc");
  assert.equal(m.undo().text, "");
  assert.equal(m.redo().text, "abc");
});

test("deshacer un comando de varias líneas es UNA transacción", () => {
  const m = new EditorModel("a\nb");
  m.setSelection({ anchor: 0, head: 3 });
  m.indent();
  assert.equal(m.text, "  a\n  b");
  assert.equal(m.undo().text, "a\nb");
  assert.equal(m.redo().text, "  a\n  b");
});

test("applyRanges cambia varios sitios en UNA transacción", () => {
  const m = new EditorModel("a b a");
  const s = m.applyRanges([
    { from: 0, to: 1, insert: "x" },
    { from: 4, to: 5, insert: "x" },
  ]);
  assert.equal(s.text, "x b x");
  assert.equal(m.undo().text, "a b a", "un solo deshacer revierte las dos");
});

test("la selección no se sale del documento al deshacer", () => {
  const m = new EditorModel("abc");
  m.setSelection(collapse(3));
  m.insert("def");
  m.undo();
  assert.equal(m.selection.head, 3);
  m.undo();
  assert.equal(m.text, "abc");
});

test("mapOffset conserva el cursor al insertar antes y después", () => {
  assert.equal(mapOffset(5, [{ from: 0, to: 0, insert: "  " }]), 7);
  assert.equal(mapOffset(1, [{ from: 3, to: 3, insert: "xx" }]), 1);
  assert.equal(mapOffset(4, [{ from: 0, to: 2, insert: "" }]), 2);
});

// ---------------------------------------------------------------------------------------------
// F2 — multicursor
// ---------------------------------------------------------------------------------------------

test("multicursor: teclear escribe en todos los cursores en UNA transacción", () => {
  const m = new EditorModel("uno\ndos\ntres");
  // Un cursor al final de «uno» (3) y otro al final de «dos» (7).
  m.setSelections([collapse(3), collapse(7)]);
  const s = m.insert("!");
  assert.equal(s.text, "uno!\ndos!\ntres");
  assert.deepEqual(
    m.selections.map((x) => x.head),
    [4, 9],
    "cada cursor queda DETRÁS de lo que escribió, en coordenadas finales"
  );
});

test("multicursor: un solo ⌘Z deshace el tecleo de todos los cursores", () => {
  const m = new EditorModel("a\nb");
  m.setSelections([collapse(1), collapse(3)]);
  m.insert("X");
  assert.equal(m.text, "aX\nbX");
  const s = m.undo();
  assert.equal(s.text, "a\nb");
  assert.equal(m.selections.length, 2, "el deshacer devuelve también la forma del multicursor");
});

test("multicursor: borrar hacia atrás en varios cursores", () => {
  const m = new EditorModel("abc\ndef");
  m.setSelections([collapse(3), collapse(7)]);
  const s = m.deleteBackward();
  assert.equal(s.text, "ab\nde");
  assert.deepEqual(m.selections.map((x) => x.head), [2, 5]);
});

test("multicursor: dos cursores en el mismo punto se reducen a uno", () => {
  const m = new EditorModel("abc");
  m.setSelections([collapse(1), collapse(1)]);
  assert.equal(m.selections.length, 1, "si no, el texto se escribiría dos veces");
});

test("multicursor: selecciones solapadas se fusionan en un rango", () => {
  const m = new EditorModel("abcdef");
  m.setSelections([
    { anchor: 1, head: 4 },
    { anchor: 3, head: 6 },
  ]);
  assert.equal(m.selections.length, 1);
  assert.deepEqual(m.selections[0], { anchor: 1, head: 6 });
});

test("addSelection deja el cursor nuevo como primario; removeSelectionAt lo quita", () => {
  const m = new EditorModel("uno dos");
  m.addSelection(collapse(4));
  assert.equal(m.selections.length, 2);
  assert.equal(m.selection.head, 4, "el nuevo manda");
  m.removeSelectionAt(1);
  assert.equal(m.selections.length, 1);
  assert.equal(m.selection.head, 0, "al quitar el primario vuelve el otro");
});

test("setSelection (clic normal) colapsa el multicursor", () => {
  const m = new EditorModel("uno dos");
  m.setSelections([collapse(0), collapse(4)]);
  m.setSelection(collapse(2));
  assert.equal(m.selections.length, 1);
});

test("⌘⌫ borra la línea del cursor con su salto (fase 15: no existía)", () => {
  const m = new EditorModel("uno;\ndos;\ntres;");
  m.setSelection({ anchor: m.offsetAt(1, 1), head: m.offsetAt(1, 1) });
  const s = m.deleteLine();
  assert.equal(s.text, "uno;\ntres;");
  assert.equal(s.selection.anchor, "uno;\n".length, "el cursor queda donde estaba la línea borrada");
});

test("⌘⌫ en la última línea se lleva el salto de delante, no deja una vacía", () => {
  const m = new EditorModel("uno;\ndos;");
  m.setSelection({ anchor: m.offsetAt(1, 0), head: m.offsetAt(1, 0) });
  assert.equal(m.deleteLine().text, "uno;");
});

test("⌘⌫ con una sola línea vacía el documento", () => {
  const m = new EditorModel("uno;");
  m.setSelection({ anchor: 2, head: 2 });
  assert.equal(m.deleteLine().text, "");
});

test("⌘⌥/ envuelve la línea SIN la indentación y ⌘⌥/ otra vez la desenvuelve", () => {
  const m = new EditorModel("    select 1");
  m.setSelection(collapse(6));
  const envuelto = m.toggleBlockComment();
  assert.equal(envuelto.text, "    /* select 1 */");
  const desenvuelto = m.toggleBlockComment();
  assert.equal(desenvuelto.text, "    select 1", "el segundo ⌘⌥/ quita el comentario");
});

test("⌘⌥/ con selección envuelve exactamente lo seleccionado", () => {
  const m = new EditorModel("select 1 -- nota");
  m.setSelection({ anchor: 0, head: 8 });
  assert.equal(m.toggleBlockComment().text, "/* select 1 */ -- nota");
});

test("⌘⌥/ en una línea vacía no hace nada (ni mete /* */ suelto)", () => {
  const m = new EditorModel("uno;\n");
  m.setSelection({ anchor: m.offsetAt(1, 0), head: m.offsetAt(1, 0) });
  assert.equal(m.toggleBlockComment().text, "uno;\n");
});
