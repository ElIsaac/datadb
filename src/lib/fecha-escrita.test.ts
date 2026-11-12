import { test } from "node:test";
import assert from "node:assert/strict";
import { fechaEscritaAValor, esFechaEscritaValida } from "./fecha-escrita";

/**
 * R93 — la fecha escrita a mano en el selector del grid. Lo que se prueba es que acepta lo que el
 * usuario teclea (formatos de México y de España) y que **rechaza** lo imposible en vez de
 * convertirlo en otra fecha, que es el fallo caro: escribir el 31 de febrero y guardar el 3 de marzo.
 */

test("acepta la forma ISO que muestra el propio campo", () => {
  assert.equal(fechaEscritaAValor("2026-03-15"), "2026-03-15");
  assert.equal(fechaEscritaAValor("2026/03/15"), "2026-03-15");
});

test("acepta día primero (lo que teclea cualquiera en México y España)", () => {
  assert.equal(fechaEscritaAValor("15/03/2026"), "2026-03-15");
  assert.equal(fechaEscritaAValor("15-03-2026"), "2026-03-15");
  assert.equal(fechaEscritaAValor("15.03.2026"), "2026-03-15");
});

test("normaliza a dos dígitos y sin espacios de sobra", () => {
  assert.equal(fechaEscritaAValor("  2026-3-5  "), "2026-03-05");
  assert.equal(fechaEscritaAValor("5/3/2026"), "2026-03-05");
});

test("rechaza fechas que no existen en vez de moverlas de mes", () => {
  assert.equal(fechaEscritaAValor("2026-02-31"), null);
  assert.equal(fechaEscritaAValor("2026-13-01"), null);
  assert.equal(fechaEscritaAValor("29/02/2025"), null, "2025 no es bisiesto");
  assert.equal(fechaEscritaAValor("29/02/2024"), "2024-02-29", "2024 sí lo es");
});

test("rechaza años de dos cifras (no se adivina el siglo)", () => {
  assert.equal(fechaEscritaAValor("15/03/26"), null);
  assert.equal(fechaEscritaAValor("26-03-15"), null);
});

test("rechaza basura y vacío", () => {
  assert.equal(fechaEscritaAValor(""), null);
  assert.equal(fechaEscritaAValor("   "), null);
  assert.equal(fechaEscritaAValor("mañana"), null);
  assert.equal(fechaEscritaAValor("2026-03-15 10:00"), null, "la hora la pone el selector de tiempo");
  assert.equal(esFechaEscritaValida("2026-03-15"), true);
  assert.equal(esFechaEscritaValida("2026-02-31"), false);
});
