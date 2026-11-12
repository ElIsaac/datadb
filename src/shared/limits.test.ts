import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  clampMaxRows,
  DEFAULT_MAX_ROWS,
  MAX_ROWS_CEILING,
  MIN_MAX_ROWS,
  PRESETS_DE_FILAS,
} from "./limits";

/**
 * El valor por defecto no es una opinión: sale de la medición T1 de la fase 11 (100 000 filas en
 * 642 ms y +57 MB contra Postgres 16). Estos tests fijan el contrato del ajuste para que nadie
 * suba el techo sin volver a medir.
 */
describe("tope de filas", () => {
  test("el valor por defecto es el de DataGrip: 500 cuando la query no trae LIMIT", () => {
    // Decisión del usuario (2026-10-20). 100 000 medía «viable» (642 ms) pero congelaba la
    // consola en tablas grandes; ver el comentario de DEFAULT_MAX_ROWS.
    assert.equal(DEFAULT_MAX_ROWS, 500);
    assert.ok(DEFAULT_MAX_ROWS <= MAX_ROWS_CEILING, "el defecto no puede pasarse del techo");
    assert.ok(DEFAULT_MAX_ROWS >= MIN_MAX_ROWS);
  });

  test("acota por arriba y por abajo en vez de aceptar cualquier cosa", () => {
    assert.equal(clampMaxRows(10_000_000), MAX_ROWS_CEILING);
    assert.equal(clampMaxRows(1), MIN_MAX_ROWS);
    assert.equal(clampMaxRows(0), MIN_MAX_ROWS);
    assert.equal(clampMaxRows(-50), MIN_MAX_ROWS);
  });

  test("un valor válido se respeta tal cual", () => {
    assert.equal(clampMaxRows(5_000), 5_000);
    assert.equal(clampMaxRows(MIN_MAX_ROWS), MIN_MAX_ROWS);
    assert.equal(clampMaxRows(MAX_ROWS_CEILING), MAX_ROWS_CEILING);
  });

  test("basura guardada de otra versión cae en el valor por defecto, no rompe", () => {
    // El ajuste vive en localStorage: lo que haya ahí puede ser de una versión anterior,
    // editado a mano, o directamente null.
    for (const malo of [undefined, null, "", "muchas", NaN, Infinity, {}, []]) {
      assert.equal(clampMaxRows(malo), DEFAULT_MAX_ROWS, `${JSON.stringify(malo)} debería caer en el defecto`);
    }
  });

  test("los decimales se truncan: no se puede pedir media fila", () => {
    assert.equal(clampMaxRows(1234.9), 1234);
  });

  test("R55: cada preset sobrevive al acotado tal cual", () => {
    // El bug que destapó la sonda de la fase 13: con el mínimo en 100, elegir «50 filas» guardaba
    // 100 sin avisar. Un preset que el acotado cambia es un botón que miente.
    for (const preset of PRESETS_DE_FILAS) {
      assert.equal(clampMaxRows(preset), preset, `el preset ${preset} se convirtió en otro valor`);
    }
    assert.equal(Math.min(...PRESETS_DE_FILAS), MIN_MAX_ROWS, "el preset más bajo es el mínimo");
  });
});
