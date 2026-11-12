import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFoldRanges, estaOculta, pliegueEnLinea } from "./folding";

test("pliega un bloque de llaves partido en varias líneas y deja ver la línea que abre y la que cierra", () => {
  const sql = [
    "CREATE FUNCTION suma(a int, b int) RETURNS int AS $$",
    "BEGIN",
    "  RETURN a + b;",
    "END",
    "$$ LANGUAGE plpgsql;",
  ].join("\n");
  const pliegues = computeFoldRanges(sql);
  assert.equal(pliegues.length, 0, "sin llaves ni paréntesis partidos no hay pliegue… salvo el del $$");
});

test("un paréntesis que abre en una línea y cierra en otra se puede plegar", () => {
  const sql = ["SELECT * FROM (", "  SELECT 1", "  UNION ALL", "  SELECT 2", ") t;"].join("\n");
  const pliegues = computeFoldRanges(sql);
  assert.deepEqual(pliegues, [{ fromLine: 0, toLine: 3 }]);
  assert.equal(estaOculta(0, pliegues), false, "la línea que abre se sigue viendo");
  assert.equal(estaOculta(2, pliegues), true);
  assert.equal(estaOculta(4, pliegues), false, "el cierre queda visible");
  assert.equal(pliegueEnLinea(0, pliegues)?.toLine, 3);
});

test("un bloque `{ … }` partido también pliega", () => {
  const sql = ["BEGIN", "  x := 1;", "  y := 2;", "END;"].join("\n");
  assert.deepEqual(computeFoldRanges(sql), [], "BEGIN/END en SQL no usa llaves: nada que plegar aquí");

  const js = ["function f() {", "  const a = 1;", "  const b = 2;", "}"].join("\n");
  assert.deepEqual(computeFoldRanges(js), [{ fromLine: 0, toLine: 2 }]);
});

test("lo que abre y cierra en la MISMA línea no genera pliegue", () => {
  const sql = "INSERT INTO t (a, b) VALUES (1, 2);";
  assert.deepEqual(computeFoldRanges(sql), []);
});

test("ignora paréntesis dentro de cadenas y comentarios", () => {
  const sql = [
    "SELECT '(' AS abierto,", // paréntesis en cadena: no cuenta
    "  -- ( comentario con paréntesis",
    "  x",
    "FROM t);", // cierre que NO debe emparejar con la cadena
  ].join("\n");
  assert.deepEqual(computeFoldRanges(sql), []);
});

test("un bloque sin cerrar se pliega hasta el final del documento", () => {
  const sql = ["SELECT * FROM (", "  SELECT 1", "  SELECT 2"].join("\n");
  assert.deepEqual(computeFoldRanges(sql), [{ fromLine: 0, toLine: 2 }]);
});

test("los bloques anidados no se duplican: gana el exterior", () => {
  const sql = ["SELECT * FROM (", "  SELECT * FROM (", "    1", "  ) t", ") u;"].join("\n");
  const pliegues = computeFoldRanges(sql);
  assert.equal(pliegues.length, 1, "el interior queda oculto por el exterior");
  assert.deepEqual(pliegues[0], { fromLine: 0, toLine: 3 });
});
