/**
 * Fase 6 (R5): la lista CERRADA de acciones que el menú nativo puede disparar, compartida por el
 * proceso `main` (que construye el menú) y el renderer (que las ejecuta).
 *
 * Por qué vive en `src/shared/` y no en `electron/`: si cada mitad tuviera su propia lista, añadir
 * una entrada al menú sin manejarla en el renderer compilaría igual y daría una entrada muda. Con
 * `MENU_ACTIONS` como unión cerrada, el `Record<MenuAction, …>` del despachador del renderer deja
 * de compilar en cuanto falta una.
 *
 * Qué NO es esto: un mapa de atajos de teclado. El keymap de DataGrip es R13 (fase 15); aquí solo
 * se declaran aceleradores de acciones que la app YA tiene. Cuando llegue la fase 15, este archivo
 * es el sitio donde unificarlos — hoy los atajos viven repartidos entre el keymap de CodeMirror
 * (`sql-editor.tsx`) y dos `keydown` sueltos.
 *
 * Cuidado con los aceleradores (medido en la fase 6, T5): en macOS un acelerador declarado en el
 * menú se lo queda el MENÚ, y el `keydown` del renderer no llega a verlo. Donde el menú declara la
 * tecla, el manejador del renderer sobra; dejar los dos vivos es lo que produce la ejecución doble
 * de una query.
 */

/**
 * Ids de acción. El orden no importa; el agrupado en menús lo decide `electron/menu.ts`.
 * Los nombres siguen el vocabulario de DataGrip en inglés porque el menú va en inglés (D1).
 */
export const MENU_ACTIONS = [
  // File
  "file.newConsole",
  "file.newConnection",
  "file.saveQuery",
  "file.disconnect",
  // Edit (lo demás son roles nativos de Electron)
  "edit.formatSql",
  // View — tool windows y apariencia
  "view.toolWindow.explorer",
  "view.toolWindow.saved",
  "view.toolWindow.ai",
  "view.toolWindow.results",
  "view.toolWindow.history",
  // Fase 12 (T6, R37): el value editor. Lleva acelerador ⇧Enter, que es el de DataGrip para
  // «maximizar celda». Ojo con lo que dice la cabecera de este archivo: al declararlo AQUÍ, el
  // menú se queda la tecla y el renderer NO debe volver a escucharla.
  "view.toolWindow.value",
  // Fase 15 (T3, R13): las CUATRO acciones que el registro de atajos (`src/shared/keymap.ts`)
  // declaraba en `ACCIONES_MENU_NUEVAS` y que hasta ahora NO existían aquí. El test de keymap
  // («toda acción apunta a algo que existe») las unía con MENU_ACTIONS sólo de forma provisional:
  // a partir de aquí son acciones de menú de pleno derecho y el registro ya no las necesita aparte.
  //   · view.erDiagram      — Show Diagram (⌘⌥⇧U, #6). Reutiliza el evento `cm-open-er-diagram` del editor.
  //   · view.hideToolWindow — Hide Active Tool Window (⇧⎋, #87). La sirve el enrutador del renderer (T5/T6).
  //   · view.nextTab        — Select Next Tab (⌘⇧], #68).
  //   · view.prevTab        — Select Previous Tab (⌘⇧[, #68).
  "view.erDiagram",
  "view.hideToolWindow",
  "view.nextTab",
  "view.prevTab",
  "view.commandPalette",
  "view.appearance",
  // Help
  // Fase 15 (T3, D4): abre Help ▸ «Atajos de teclado» (la lista generada del registro, T7). No lleva
  // atajo: se llega por el menú nativo, como en DataGrip («Help | Keymap Reference» / buscador).
  "help.shortcuts",
  // Query
  "query.execute",
  "query.executeAll",
  "query.cancel",
  "query.explain",
  "query.txAuto",
  "query.txManual",
  "query.commit",
  "query.rollback",
  // AI
  "ai.textToSql",
  "ai.explainQuery",
  "ai.chat",
  "ai.settings",
] as const;

export type MenuAction = (typeof MENU_ACTIONS)[number];

export function isMenuAction(value: unknown): value is MenuAction {
  return typeof value === "string" && (MENU_ACTIONS as readonly string[]).includes(value);
}

/**
 * El estado mínimo que decide qué entradas del menú están activas. Lo publica el renderer con el
 * canal `menu:state` cada vez que cambia, y `main` reconstruye el menú.
 *
 * Son cuatro booleanos a propósito: cada campo extra es una oportunidad más de que el menú mienta
 * sobre lo que se puede hacer. Con estos cuatro se cubre todo lo que de verdad cambia de color.
 */
export interface MenuState {
  /** La consola activa tiene sesión. Sin esto no hay nada que ejecutar. */
  connected: boolean;
  /** Hay una query en vuelo en la consola activa (habilita Cancel). */
  queryRunning: boolean;
  /** El modo de transacción de la consola activa es Manual (habilita Commit/Rollback). */
  txManual: boolean;
  /** Hay una transacción abierta de verdad: Commit/Rollback solo tienen sentido entonces. */
  txActive: boolean;
  /** El editor tiene SQL no vacío (habilita guardar, formatear y ejecutar todo). */
  hasSql: boolean;
}

export const DEFAULT_MENU_STATE: MenuState = {
  connected: false,
  queryRunning: false,
  txManual: false,
  txActive: false,
  hasSql: false,
};
