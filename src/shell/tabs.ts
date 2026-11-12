/**
 * ============================================================================
 * Fase 15 (R13) · Tarea T6 — LA TIRA DE PESTAÑAS (Select Next/Previous Tab, #68)
 * ============================================================================
 *
 * QUÉ RESUELVE ESTE ARCHIVO
 * -------------------------
 * La mitad PURA del ciclo de pestañas de DataGrip:
 *
 *   · `⌘⇧]` (Select Next Tab, fila #68) activa la pestaña SIGUIENTE de la tira;
 *   · `⌘⇧[` (Select Previous Tab, #68) activa la ANTERIOR;
 *   · con **vuelta al principio**: desde la última, `⌘⇧]` va a la primera, y desde la primera,
 *     `⌘⇧[` va a la última. Es lo que el PLAN de la fase pide para T6 («pestañas (⌘⇧]/⌘⇧[,
 *     con vuelta al principio)») y la aritmética modular lo da sin casos especiales.
 *
 * LA TIRA ES LA DE `TabBar`
 * -------------------------
 * El orden es el que pinta `src/components/tab-bar.tsx`: primero las CONSOLAS, en el orden de
 * `state.consoles` (`tab-bar.tsx:58`), y después las PESTAÑAS DE TABLA, en el orden de
 * `state.tableTabs` (`tab-bar.tsx:144`: consultas, vistas de tabla, diagramas y el log).
 *
 * La pestaña ACTIVA se describe con dos campos de `AppState` (`src/hooks/use-app-state.tsx`):
 *   · `activeTabId === "sql"` → la consola `activeConsoleId` está enseñando su vista SQL
 *     (`tab-bar.tsx:51/60`, `isSqlActive && isCurrentConsole`);
 *   · cualquier otro id → esa pestaña de tabla está activa (`tab-bar.tsx:156`).
 * Y activar el destino se hace con las MISMAS acciones que un clic en la tira:
 * `SET_ACTIVE_CONSOLE` (`tab-bar.tsx:73`, y el reducer le devuelve `activeTabId: "sql"` en
 * `use-app-state.tsx:302`) o `SET_ACTIVE_TAB` (`tab-bar.tsx:166`).
 *
 * ANTES ESTA CUENTA VIVÍA EN `app-shell.tsx` Y NO SE PODÍA PROBAR
 * ---------------------------------------------------------------
 * La cuenta estaba escrita en línea dentro de `activarPestanaDeLaTira(delta)`, el manejador de
 * los eventos `gestordb:next-tab`/`gestordb:prev-tab` que emite `use-menu-actions.ts` (la
 * cadena completa: acelerador del menú → `menu:action` → `ejecutarAccionDeMenu("view.nextTab")`
 * → evento de `window` → armazón). T6 exige tests de «las funciones de pestañas» y de la
 * vuelta al principio EN LOS DOS EXTREMOS; con la cuenta dentro de un componente React eso no
 * se puede probar sin montar la app entera (la app no se ejecuta en esta tarea). Aquí es una
 * función sin React ni DOM — el mismo criterio por el que `layout.ts` y `keyboard-router.ts`
 * separan su mitad pura — y por eso sus casos se fijan en `tabs.test.ts`.
 *
 * LO QUE NO ES
 * ------------
 *   · No es el reducer: `use-app-state.tsx` sigue siendo el dueño de `SET_ACTIVE_TAB` y
 *     `SET_ACTIVE_CONSOLE`. Esto solo CALCULA a qué pestaña ir; el despacho lo hace el armazón.
 *   · No es un registro de atajos: aquí no hay ni una tecla. El atajo vive en
 *     `src/shared/keymap.ts` (`selectNextTab`/`selectPreviousTab`, fila #68), su acelerador lo
 *     declara el menú (`electron/menu-template.ts`, «Next Tab»/«Previous Tab») y el enrutador
 *     de teclado NO lo toca a propósito (lleva ⌘: lo sirve el menú).
 */

/** Una pestaña de la tira, tal como la pinta `TabBar`: una consola o una pestaña de tabla. */
export interface PestanaDeLaTira {
  kind: "console" | "tab";
  id: string;
}

/**
 * Lo que este módulo necesita del estado de la app: ni un campo más. Son exactamente los
 * cuatro que lee `activarPestanaDeLaTira` en `app-shell.tsx` (los comentarios de allí anotan de
 * dónde sale cada uno). Se piden los IDs y no los objetos completos para que el contrato sea
 * mínimo y el test no tenga que fabricar consolas ni pestañas enteras.
 */
export interface EstadoDeLaTira {
  /** `state.consoles.map(c => c.id)`: las consolas, en el orden de la tira. */
  consolas: readonly string[];
  /** `state.tableTabs.map(t => t.id)`: las pestañas de tabla, en el orden de la tira. */
  pestanas: readonly string[];
  /** `state.activeConsoleId`. */
  consolaActiva: string;
  /** `state.activeTabId`: `"sql"` = la consola activa enseña su vista SQL. */
  pestanaActiva: string;
}

/**
 * La tira completa, en el orden en que `TabBar` la pinta: consolas y después pestañas de
 * tabla. La usan el cálculo del destino y los tests (para fijar el orden, que es el contrato
 * compartido con el componente).
 */
export function tiraDePestanas(estado: EstadoDeLaTira): PestanaDeLaTira[] {
  return [
    ...estado.consolas.map((id) => ({ kind: "console" as const, id })),
    ...estado.pestanas.map((id) => ({ kind: "tab" as const, id })),
  ];
}

/**
 * El índice de la pestaña ACTIVA AHORA dentro de la tira, o `-1` si no está en ella.
 *
 * `-1` es un estado que la app no produce (el reducer mantiene `activeTabId` apuntando a una
 * pestaña existente o a `"sql"`, y `CLOSE_TABLE_TAB` reasigna la activa al cerrar,
 * `use-app-state.tsx:214-222`), pero el contrato no lo finge: quien llama decide qué hacer con
 * él (`pestanaDestino` lo trata abajo).
 */
export function indiceDeLaPestanaActiva(estado: EstadoDeLaTira): number {
  if (estado.pestanaActiva === "sql") return estado.consolas.indexOf(estado.consolaActiva);
  const enPestanas = estado.pestanas.indexOf(estado.pestanaActiva);
  return enPestanas < 0 ? -1 : estado.consolas.length + enPestanas;
}

/**
 * La pestaña DESTINO de `⌘⇧]` (`delta = 1`) o `⌘⇧[` (`delta = -1`), con vuelta al principio:
 * `(actual + delta + n) % n` sobre la tira (ver la cabecera). `null` si la tira está vacía
 * (sin consolas ni pestañas de tabla): en la app no pasa —siempre hay al menos una consola
 * (`CLOSE_CONSOLE` no deja cerrar la última`, use-app-state.tsx:287-291`)—, pero el contrato
 * no inventa un destino que no existe y el armazón simplemente no despacha nada.
 *
 * DECISIÓN (documentada en `.planning/phases/phase-15/T6-informe.md`): si la pestaña activa
 * NO está en la tira (`índice === -1`), el destino es la PRIMERA para las dos direcciones.
 * Es lo que hacía el código en línea de `app-shell` (su comentario ya lo decía: «se va a la
 * primera») y evita que la cuenta modular elija un destino distinto según la dirección para un
 * estado sin significado. Diferencia conocida con el código viejo, en el único caso que difiere
 * (una pestaña de TABLA activa que ya no existe, con ≥1 consola): antes anclaba en la última
 * consola por accidente (`consoles.length + (-1)`), ahora cae a la primera; el estado es
 * inalcanzable desde la UI y queda anotado aquí para no perderlo.
 */
export function pestanaDestino(estado: EstadoDeLaTira, delta: 1 | -1): PestanaDeLaTira | null {
  const tira = tiraDePestanas(estado);
  if (tira.length === 0) return null;
  const actual = indiceDeLaPestanaActiva(estado);
  if (actual < 0) return tira[0];
  return tira[(actual + delta + tira.length) % tira.length];
}
