/**
 * Fase 15 (R13) · Tarea T6 — tests de la TIRA DE PESTAÑAS (`src/shell/tabs.ts`).
 *
 * La cadena completa de ⌘⇧] / ⌘⇧[ (Select Next/Previous Tab, #68) tiene cuatro eslabones:
 *
 *   1. el atajo, en el registro (`src/shared/keymap.ts`, `selectNextTab`/`selectPreviousTab`);
 *   2. su acelerador en el menú nativo (`electron/menu-template.ts`, «Next Tab»/«Previous Tab»;
 *      fijado en `electron/menu-template.test.ts`);
 *   3. el manejador de la acción → evento de `window` (`src/hooks/use-menu-actions.ts`;
 *      fijado en `use-menu-actions.test.ts`) y el armazón que lo escucha (`app-shell.tsx`);
 *   4. LA CUENTA del destino: esto es lo que se fija aquí.
 *
 * El requisito explícito de T6 es el de (4): «⌘⇧] en la última pestaña va a la primera, y ⌘⇧[
 * en la primera va a la última», incluidos los casos de 0 y 1 pestañas. Antes la cuenta vivía
 * en línea en `app-shell.tsx` y ningún test la tocaba.
 *
 * Runner: `npm test` → `tsx --test "src/**\/*.test.ts" "electron/**\/*.test.ts"` (node:test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  indiceDeLaPestanaActiva,
  pestanaDestino,
  tiraDePestanas,
  type EstadoDeLaTira,
} from "./tabs";

/** Fábrica de estados de la tira: lo que lee `tabs.ts`, con valores por defecto vacíos. */
function estado(extra: Partial<EstadoDeLaTira> = {}): EstadoDeLaTira {
  return { consolas: [], pestanas: [], consolaActiva: "", pestanaActiva: "sql", ...extra };
}

/** Texto compacto de un destino para comparar en los asserts («console:c2», «tab:t1»). */
function texto(destino: ReturnType<typeof pestanaDestino>): string {
  return destino ? `${destino.kind === "console" ? "console" : "tab"}:${destino.id}` : "nada";
}

// ============================================================================================
// 1. La tira y su índice activo
// ============================================================================================

test("la tira pinta primero las consolas y después las pestañas de tabla (el orden de TabBar)", () => {
  // El orden es el contrato compartido con `tab-bar.tsx` (consolas en el orden de `state.consoles`
  // y después `state.tableTabs`): si esto cambiara, el ciclo activaría una pestaña que no es «la
  // siguiente» de la tira que el usuario ve.
  const tira = tiraDePestanas(estado({ consolas: ["c1", "c2"], pestanas: ["t1", "t2", "log"] }));
  assert.deepEqual(tira, [
    { kind: "console", id: "c1" },
    { kind: "console", id: "c2" },
    { kind: "tab", id: "t1" },
    { kind: "tab", id: "t2" },
    { kind: "tab", id: "log" },
  ]);
});

test("indiceDeLaPestanaActiva: `sql` ancla en su consola; una pestaña de tabla, tras las consolas", () => {
  const e = estado({ consolas: ["c1", "c2"], pestanas: ["t1", "t2"] });
  assert.equal(indiceDeLaPestanaActiva({ ...e, pestanaActiva: "sql", consolaActiva: "c2" }), 1);
  assert.equal(indiceDeLaPestanaActiva({ ...e, pestanaActiva: "t1" }), 2, "t1 va tras las dos consolas");
  assert.equal(indiceDeLaPestanaActiva({ ...e, pestanaActiva: "t2" }), 3);
  // Estados que la app no produce: el contrato devuelve -1 en vez de fingir una posición.
  assert.equal(indiceDeLaPestanaActiva({ ...e, pestanaActiva: "sql", consolaActiva: "fantasma" }), -1);
  assert.equal(indiceDeLaPestanaActiva({ ...e, pestanaActiva: "cerrada" }), -1);
});

// ============================================================================================
// 2. El ciclo: avance, retroceso y vuelta al principio
// ============================================================================================

test("⌘⇧] (delta 1) avanza por la tira y ⌘⇧[ (delta -1) retrocede, atravesando consolas y pestañas", () => {
  const e = estado({ consolas: ["c1", "c2"], pestanas: ["t1", "t2"] });

  // Avance desde la primera consola: c1 → c2 → t1 → t2.
  assert.equal(texto(pestanaDestino({ ...e, consolaActiva: "c1" }, 1)), "console:c2");
  assert.equal(texto(pestanaDestino({ ...e, consolaActiva: "c2" }, 1)), "tab:t1");
  assert.equal(texto(pestanaDestino({ ...e, pestanaActiva: "t1" }, 1)), "tab:t2");

  // Retroceso desde la última pestaña de tabla: t2 → t1 → c2 → c1.
  assert.equal(texto(pestanaDestino({ ...e, pestanaActiva: "t2" }, -1)), "tab:t1");
  assert.equal(texto(pestanaDestino({ ...e, pestanaActiva: "t1" }, -1)), "console:c2");
  assert.equal(texto(pestanaDestino({ ...e, consolaActiva: "c2" }, -1)), "console:c1");
});

test("vuelta al principio en los DOS extremos: ⌘⇧] en la última va a la primera y ⌘⇧[ en la primera va a la última", () => {
  // Es el requisito literal de T6. La aritmética modular `(actual + delta + n) % n` lo cumple sin
  // casos especiales, y este test es el que impide que una «optimización» futura se lleve la vuelta.
  const e = estado({ consolas: ["c1", "c2"], pestanas: ["t1"] });

  assert.equal(
    texto(pestanaDestino({ ...e, pestanaActiva: "t1" }, 1)),
    "console:c1",
    "⌘⇧] en la ÚLTIMA pestaña (t1) vuelve a la primera de la tira (c1)"
  );
  assert.equal(
    texto(pestanaDestino({ ...e, consolaActiva: "c1" }, -1)),
    "tab:t1",
    "⌘⇧[ en la PRIMERA pestaña (c1) salta a la última de la tira (t1)"
  );
});

// ============================================================================================
// 3. Los bordes: 0 y 1 pestañas
// ============================================================================================

test("con 0 pestañas (la tira vacía) no hay destino: el armazón no despacha nada", () => {
  // En la app no ocurre —`CLOSE_CONSOLE` no deja cerrar la última consola y `TabBar` siempre pinta
  // al menos una—, pero el contrato devuelve `null` en vez de inventarse un índice.
  assert.equal(pestanaDestino(estado(), 1), null);
  assert.equal(pestanaDestino(estado(), -1), null);
});

test("con UNA sola pestaña el ciclo se queda en ella, en las dos direcciones", () => {
  // Una consola y ninguna pestaña de tabla: ⌘⇧] y ⌘⇧[ devuelven la MISMA consola (n = 1 → el
  // módulo da 0). El armazón despacha `SET_ACTIVE_CONSOLE` a la misma consola, que es inofensivo.
  const una = estado({ consolas: ["c1"], consolaActiva: "c1" });
  assert.equal(texto(pestanaDestino(una, 1)), "console:c1");
  assert.equal(texto(pestanaDestino(una, -1)), "console:c1");

  // Una consola y una pestaña de tabla: la tira tiene DOS elementos y alternan, incluida la vuelta.
  const dos = estado({ consolas: ["c1"], pestanas: ["t1"], consolaActiva: "c1" });
  assert.equal(texto(pestanaDestino(dos, 1)), "tab:t1");
  assert.equal(texto(pestanaDestino({ ...dos, pestanaActiva: "t1" }, 1)), "console:c1", "vuelve a la primera");
  assert.equal(texto(pestanaDestino({ ...dos, pestanaActiva: "t1" }, -1)), "console:c1");
  assert.equal(texto(pestanaDestino(dos, -1)), "tab:t1", "desde la primera, ⌘⇧[ va a la última");
});

test("sin pestañas de tabla la vuelta se cierra sobre las consolas", () => {
  // 0 pestañas de TABLA (pero ≥1 consola): el caso que en la app es el de arranque, con una sola
  // consola. Con tres consolas, la vuelta es entre ellas.
  const e = estado({ consolas: ["c1", "c2", "c3"], consolaActiva: "c3" });
  assert.equal(texto(pestanaDestino(e, 1)), "console:c1", "de la última consola a la primera");
  assert.equal(texto(pestanaDestino({ ...e, consolaActiva: "c1" }, -1)), "console:c3");
  assert.equal(texto(pestanaDestino({ ...e, consolaActiva: "c2" }, 1)), "console:c3");
});

// ============================================================================================
// 4. La pestaña activa que no está en la tira (decisión documentada)
// ============================================================================================

test("si la pestaña activa no está en la tira, el destino es la primera para las dos direcciones", () => {
  // DECISIÓN de T6 (en la cabecera de `tabs.ts` y en T6-informe.md): el estado es inalcanzable
  // desde la UI (el reducer reasigna la activa al cerrar), pero el contrato no lo deja al azar:
  // las dos direcciones caen a la primera, que es lo que decía el comentario del código en línea
  // que esto reemplaza. Con el `-1` sin tratar, la cuenta modular daría la penúltima para ⌘⇧[.
  const e = estado({ consolas: ["c1", "c2"], pestanas: ["t1"], pestanaActiva: "cerrada" });
  assert.equal(texto(pestanaDestino(e, 1)), "console:c1");
  assert.equal(texto(pestanaDestino(e, -1)), "console:c1");
  const sinConsola = estado({ consolas: ["c1"], pestanaActiva: "sql", consolaActiva: "fantasma" });
  assert.equal(texto(pestanaDestino(sinConsola, 1)), "console:c1");
});
