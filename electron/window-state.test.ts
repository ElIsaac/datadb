/**
 * Fase 6 (R5/T1): pruebas de `electron/window-state.ts`.
 *
 * El módulo está diseñado para NO importar Electron, así que aquí se prueba con `node:test` y un
 * sistema de archivos real en un directorio temporal: es la única forma de verificar de verdad la
 * atomicidad y el debounce (un mock de fs no probaría que `rename` deja el archivo sano).
 *
 * Se cubren las tres capas del módulo por separado:
 *  - `readWindowState`: los "no hay estado" (sin archivo, corrupto, basura) y la ida y vuelta.
 *  - `clampToVisible`: la lógica pura que da visibilidad; casi todos los casos límite están aquí.
 *  - `createWindowStateSaver`: coalescencia del debounce, `flush` y escritura atómica.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, stat, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readWindowState,
  clampToVisible,
  createWindowStateSaver,
  type Rect,
  type WindowState,
  type MinSize,
} from "./window-state";

const MIN: MinSize = { width: 1024, height: 640 };

/** Pantalla de 1440x900 en el origen, como el monitor del portátil de referencia. */
const LAPTOP: Rect = { x: 0, y: 0, width: 1440, height: 900 };
/** Monitor externo a la derecha del portátil, más grande y de mayor resolución. */
const EXTERNAL: Rect = { x: 1440, y: 0, width: 1920, height: 1080 };

async function tmpFile(prefix = "window-state-") {
  const dir = await mkdtemp(path.join(process.env.TMPDIR ?? os.tmpdir(), prefix));
  return {
    dir,
    file: path.join(dir, "window-state.json"),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/** Espera real, para los casos de debounce. */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// readWindowState
// ---------------------------------------------------------------------------

test("sin archivo devuelve null (primer arranque)", async () => {
  const { file, cleanup } = await tmpFile();
  try {
    assert.equal(readWindowState(file), null);
  } finally {
    await cleanup();
  }
});

test("archivo corrupto (JSON inválido) devuelve null, nunca lanza", async () => {
  const { file, cleanup } = await tmpFile();
  try {
    await writeFile(file, "{ no es json");
    assert.equal(readWindowState(file), null);
  } finally {
    await cleanup();
  }
});

test("bounds basura (NaN, negativos, no numéricos) -> null", async () => {
  const { file, cleanup } = await tmpFile();
  try {
    const basura: unknown[] = [
      { bounds: { x: NaN, y: 0, width: 800, height: 600 } },
      { bounds: { x: 0, y: 0, width: -800, height: 600 } }, // ancho negativo
      { bounds: { x: 0, y: 0, width: 800, height: 0 } }, // alto cero
      { bounds: { x: "0", y: 0, width: 800, height: 600 } }, // x no numérico
      { bounds: null },
      {},
    ];
    for (const content of basura) {
      await writeFile(file, JSON.stringify(content));
      assert.equal(readWindowState(file), null, `debería ignorar ${JSON.stringify(content)}`);
    }
  } finally {
    await cleanup();
  }
});

test("ida y vuelta: lo guardado (bounds y maximizado) se recupera tal cual", async () => {
  const { file, cleanup } = await tmpFile();
  try {
    const state: WindowState = { bounds: { x: 220, y: 120, width: 1280, height: 780 }, maximized: true };
    const saver = createWindowStateSaver(file, 5);
    saver.save(state);
    saver.flush();
    await wait(40); // el flush dispara la escritura async; se le da un turno al event loop
    assert.deepEqual(readWindowState(file), state);
    assert.equal(readWindowState(file)?.maximized, true);
  } finally {
    await cleanup();
  }
});

// ---------------------------------------------------------------------------
// clampToVisible (lógica pura)
// ---------------------------------------------------------------------------

test("bounds fuera de toda pantalla (monitor externo desconectado) -> centrados en la primera", () => {
  // Se cerró en el externo (x=1400) y ahora solo existe el portátil: las coordenadas 5000 no caen
  // en ninguna pantalla. Debe aparecer centrada, conservando el tamaño, dentro del portátil.
  const bounds: Rect = { x: 5000, y: 5000, width: 1200, height: 800 };
  const out = clampToVisible(bounds, [LAPTOP], MIN);
  assert.deepEqual(out, { x: 120, y: 50, width: 1200, height: 800 });
});

test("bounds medio fuera -> se EMPUJAN dentro (no se recentran) conservando el tamaño", () => {
  // La ventana asoma por arriba y por la izquierda del portátil. Se empuja lo mínimo: a (0,0).
  const bounds: Rect = { x: -50, y: -50, width: 1200, height: 800 };
  const out = clampToVisible(bounds, [LAPTOP], MIN);
  assert.deepEqual(out, { x: 0, y: 0, width: 1200, height: 800 });
});

test("con varias pantallas se empuja dentro de la que MÁS solapa", () => {
  // Solapa sobre todo con el externo (x=1400 cae casi entero en el monitor de la derecha).
  const bounds: Rect = { x: 1400, y: 100, width: 1200, height: 700 };
  const out = clampToVisible(bounds, [LAPTOP, EXTERNAL], MIN);
  assert.deepEqual(out, { x: 1440, y: 100, width: 1200, height: 700 });
});

test("ventana más grande que la pantalla -> se acota al área útil", () => {
  const bounds: Rect = { x: 0, y: 0, width: 2000, height: 1200 };
  const out = clampToVisible(bounds, [LAPTOP], MIN);
  assert.deepEqual(out, { x: 0, y: 0, width: 1440, height: 900 });
});

test("el tamaño nunca baja del mínimo, aunque el guardado sea más pequeño", () => {
  const bounds: Rect = { x: 100, y: 100, width: 200, height: 100 };
  const out = clampToVisible(bounds, [LAPTOP], MIN);
  assert.deepEqual(out, { x: 100, y: 100, width: 1024, height: 640 });
});

test("entrada basura en clampToVisible -> recentrado en la primera pantalla al tamaño mínimo", () => {
  // La función se exporta sola, así que debe ser segura aunque el llamador pase basura.
  const out = clampToVisible({ x: NaN, y: NaN, width: NaN, height: NaN }, [LAPTOP], MIN);
  assert.deepEqual(out, { x: 208, y: 130, width: 1024, height: 640 });
});

test("sin pantallas no se puede acotar: se garantiza el mínimo y no se lanza", () => {
  const out = clampToVisible({ x: 10, y: 20, width: 500, height: 300 }, [], MIN);
  assert.deepEqual(out, { x: 10, y: 20, width: 1024, height: 640 });
});

test("si el mínimo excede la pantalla gana el mínimo (anclado a la esquina, no por debajo)", () => {
  const tiny: Rect = { x: 0, y: 0, width: 800, height: 500 };
  const out = clampToVisible({ x: 0, y: 0, width: 900, height: 600 }, [tiny], MIN);
  assert.deepEqual(out, { x: 0, y: 0, width: 1024, height: 640 });
});

test("una ventana ya visible (y no menor que el mínimo) no se mueve", () => {
  const bounds: Rect = { x: 300, y: 200, width: 1100, height: 700 };
  assert.deepEqual(clampToVisible(bounds, [LAPTOP], MIN), bounds);
});

// ---------------------------------------------------------------------------
// createWindowStateSaver (debounce + escritura atómica)
// ---------------------------------------------------------------------------

test("debounce: N saves seguidos escriben UNA vez, con el último estado", async () => {
  const { file, cleanup } = await tmpFile();
  const saver = createWindowStateSaver(file, 60);
  try {
    const a: WindowState = { bounds: { x: 1, y: 1, width: 800, height: 600 }, maximized: false };
    const b: WindowState = { bounds: { x: 2, y: 2, width: 800, height: 600 }, maximized: false };
    const c: WindowState = { bounds: { x: 3, y: 3, width: 900, height: 700 }, maximized: true };
    saver.save(a);
    saver.save(b);
    saver.save(c);
    // Antes de que expire el debounce NO debe existir el archivo: los saves intermedios no se
    // escriben, lo que prueba que la coalescencia funciona (solo se escribirá el último).
    await assert.rejects(() => readFile(file, "utf-8"), /ENOENT/);
    await wait(140);
    assert.deepEqual(readWindowState(file), c);
    // No queda ningún `.tmp` huérfano: el rename lo consumió.
    assert.deepEqual(await readdir(path.dirname(file)), ["window-state.json"]);
  } finally {
    await cleanup();
  }
});

test("flush() fuerza la escritura pendiente sin esperar el debounce", async () => {
  const { file, cleanup } = await tmpFile();
  // delay enorme: si flush no forzara la escritura, el test no vería el archivo nunca.
  const saver = createWindowStateSaver(file, 100_000);
  try {
    const state: WindowState = { bounds: { x: 42, y: 24, width: 1024, height: 640 }, maximized: false };
    saver.save(state);
    await assert.rejects(() => readFile(file, "utf-8"), /ENOENT/);
    saver.flush();
    await wait(40);
    assert.deepEqual(readWindowState(file), state);
  } finally {
    await cleanup();
    // El temporizador largo queda vivo; el proceso de test no espera por él, pero se limpia por
    // higiene llamando flush otra vez de forma inocua (ya no hay estado pendiente).
    saver.flush();
  }
});

test("la escritura es atómica: el archivo queda con permisos legibles y JSON válido", async () => {
  const { file, cleanup } = await tmpFile();
  try {
    const saver = createWindowStateSaver(file, 5);
    saver.save({ bounds: { x: 0, y: 0, width: 1440, height: 900 }, maximized: true });
    saver.flush();
    await wait(40);
    const raw = await readFile(file, "utf-8");
    assert.deepEqual(JSON.parse(raw), { bounds: { x: 0, y: 0, width: 1440, height: 900 }, maximized: true });
    assert.ok((await stat(file)).isFile());
  } finally {
    await cleanup();
  }
});
