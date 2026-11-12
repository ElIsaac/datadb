/**
 * Fase 15 (R13) · Tarea T6 — tests del MAPEO ACCIÓN → MANEJADOR de las acciones globales nuevas
 * (`src/hooks/use-menu-actions.ts`).
 *
 * QUÉ FALTABA Y POR QUÉ SE PRUEBA AQUÍ
 * ------------------------------------
 * La cadena de una acción de menú tiene cuatro eslabones: el atajo en el registro
 * (`src/shared/keymap.ts`), el ítem y su acelerador en el menú (`electron/menu-template.ts`,
 * fijado en `menu-template.test.ts`), el evento `menu:action` que `main` manda al renderer, y
 * ESTE: `ejecutarAccionDeMenu(id)` → el manejador real de la app. Los tres primeros ya estaban
 * fijados por otros tests; el cuarto no lo estaba para ninguna de las acciones de T6:
 *
 *   · tool windows `⌘1`/`⌘2`/`⌘8`/`⌘⌥E` (#80/#81/#85/#8) → ¿qué tool window toca cada una?
 *   · Hide Active Tool Window `⇧⎋` (#87) → ¿oculta la activa, y cuál es «la activa»?
 *   · pestañas `⌘⇧]`/`⌘⇧[` (#68), New Query Console `⌘⇧Q` (#11), Cancel `⌘F2` (#3), Find Action
 *     `⌘⇧A` (#52), Reformat Code `⌘⌥L` (#30) → el manejador delega en el armazón por un evento
 *     de `window`; aquí se fija QUE evento, con qué nombre.
 *   · Show Diagram `⌘⌥⇧U` (#6) → dispara `cm-open-er-diagram` a los editores montados.
 *
 * CÓMO SE PUEDE PROBAR SIN ELECTRON NI REACT
 * ------------------------------------------
 * `ejecutarAccionDeMenu` es una función de módulo (`use-menu-actions.ts:138`) sobre un `Record`
 * de funciones: no necesita React ni una ventana. Lo que sí necesita es `window` (los eventos),
 * `document` (el ⇧⎋ mira `document.activeElement`; el diagrama busca los `.cm-editor`) y el
 * store del layout para las tool windows. Los dobles son del mismo tipo que los de
 * `src/shell/keyboard-router.test.ts`: aquí lo que importa es el EFECTO (qué tool window cambió,
 * qué evento salió), no pintar nada.
 *
 * Runner: `npm test` → `tsx --test "src/**\/*.test.ts" "electron/**\/*.test.ts"` (node:test).
 */
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import { ejecutarAccionDeMenu } from "./use-menu-actions";
import { aTextoMac, entradaPorId } from "@/shared/keymap";
import { MENU_ACTIONS, type MenuAction } from "@/shared/menu-actions";
import { DEFAULT_LAYOUT, setMode, show, type Dock, type LayoutState, type ToolWindowId } from "@/shell/layout";
import {
  getLayoutState,
  hideActiveToolWindow,
  hideToolWindow,
  setLayoutState,
} from "@/shell/layout-store";

// ============================================================================================
// Dobles de DOM: lo mínimo que las acciones tocan fuera de Electron
// ============================================================================================

/** Clase que hace de `Element` global: `pistaDeFocoActivo` pregunta `instanceof Element`. */
class ElementFalso {}

/** `CustomEvent` de mentira: solo el `type` que el doble de `window` registra. */
class CustomEventFalso {
  type: string;
  constructor(type: string) {
    this.type = type;
  }
}

/** Elemento con foco falso: `closest()` responde como el del DOM real (los atributos
 * `data-tool-window-overlay` / `data-tool-window-dock` los pinta `tool-window.tsx`).
 */
function elementoConPista(pista: { dock?: Dock; overlay?: ToolWindowId }): Element {
  const el = new ElementFalso() as ElementFalso & { closest: (selector: string) => unknown };
  el.closest = (selector: string) => {
    if (pista.overlay && selector.includes("data-tool-window-overlay")) {
      return { getAttribute: (nombre: string) => (nombre === "data-tool-window-overlay" ? pista.overlay : null) };
    }
    if (pista.dock && selector.includes("data-tool-window-dock")) {
      return { getAttribute: (nombre: string) => (nombre === "data-tool-window-dock" ? pista.dock : null) };
    }
    return null;
  };
  return el as unknown as Element;
}

/** Editor montado falso: solo lo que `abrirDiagramaErDesdeMenu` le pide (`dispatchEvent`). */
function editorFalso(registro: string[]): unknown {
  return {
    dispatchEvent: (evento: { type?: string }) => {
      registro.push(String(evento?.type ?? "evento"));
      return true;
    },
  };
}

/** Lo que devuelve el doble de DOM. Se declara explícito para no depender de `ReturnType`. */
interface DomFalso {
  /** Nombres de los eventos despachados sobre el `window` falso, en orden. */
  despedidos: string[];
  /** Cambia la lista de editores que devuelve `document.querySelectorAll(".cm-editor")`. */
  setEditores: (lista: unknown[]) => void;
  /** Devuelve los globales como estaban. */
  restaurar: () => void;
}

/** Doble de `window`/`document`/`Element`/`CustomEvent` para ejecutar acciones fuera de Electron. */
function montarDomFalso(activo: Element | null, opciones: { editores?: unknown[] } = {}): DomFalso {
  const despedidos: string[] = [];
  let editores: unknown[] = opciones.editores ?? [];
  const global = globalThis as unknown as Record<string, unknown>;
  const previo = {
    window: global.window,
    document: global.document,
    Element: global.Element,
    CustomEvent: global.CustomEvent,
  };
  global.Element = ElementFalso;
  global.CustomEvent = CustomEventFalso;
  global.window = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: (evento: { type?: string }) => {
      despedidos.push(String(evento?.type ?? "evento"));
      return true;
    },
    localStorage: { getItem: () => null, setItem: () => undefined },
  };
  global.document = {
    activeElement: activo,
    querySelector: () => null,
    querySelectorAll: (selector: string) => (selector === ".cm-editor" ? editores : []),
  };
  return {
    despedidos,
    setEditores: (lista: unknown[]) => {
      editores = lista;
    },
    restaurar: () => {
      global.window = previo.window;
      global.document = previo.document;
      global.Element = previo.Element;
      global.CustomEvent = previo.CustomEvent;
    },
  };
}

describe("T6 — mapeo acción → manejador de las acciones globales nuevas", () => {
  let dom: DomFalso | null = null;
  afterEach(() => {
    dom?.restaurar();
    dom = null;
  });

  // ==========================================================================================
  // Tool windows ⌘1 / ⌘2 / ⌘8 / ⌘⌥E
  // ==========================================================================================

  /**
   * Las cuatro filas de tool window de T6, con su equivalencia D6 del PLAN. La acción se toma
   * del REGISTRO (`entradaPorId`) y no se escribe aquí: así, si un día cambia la acción de la
   * fila, este test la sigue y salta si el efecto deja de ser el esperado.
   */
  const TOOL_WINDOWS_DE_T6: ReadonlyArray<{
    id: string;
    tw: ToolWindowId;
    accion: MenuAction;
    tecla: string;
    fila: number;
  }> = [
    { id: "showDatabaseExplorer", tw: "explorer", accion: "view.toolWindow.explorer", tecla: "⌘1", fila: 80 },
    { id: "showFilesWindow", tw: "saved", accion: "view.toolWindow.saved", tecla: "⌘2", fila: 81 },
    { id: "showServicesWindow", tw: "results", accion: "view.toolWindow.results", tecla: "⌘8", fila: 85 },
    { id: "browseQueryHistory", tw: "history", accion: "view.toolWindow.history", tecla: "⌘⌥E", fila: 8 },
  ];

  test("⌘1/⌘2/⌘8/⌘⌥E abren SU tool window y la alternan al segundo pulso (como DataGrip)", () => {
    // El gesto que DataGrip tiene en la barra y en estos atajos (y que ya documenta `layout.ts`,
    // `toggle`): oculta → la abre y la deja activa; activa → la vuelve a ocultar. El PLAN no
    // dice explícitamente que alternen; es la decisión D6 ejecutada con el gesto que la app ya
    // tenía (informe de T6, «decisiones»).
    for (const caso of TOOL_WINDOWS_DE_T6) {
      dom = montarDomFalso(null);
      setLayoutState(DEFAULT_LAYOUT);

      // La fila del registro manda: acción, tecla y # se comprueban contra ella.
      const entrada = entradaPorId(caso.id);
      assert.ok(entrada, `falta la entrada ${caso.id} en el registro`);
      assert.equal(entrada.accion.tipo, "menu", `${caso.id} debería ser una acción de menú`);
      assert.ok(
        entrada.accion.tipo === "menu" && entrada.accion.id === caso.accion,
        `${caso.id} debería disparar ${caso.accion}`
      );
      assert.equal(aTextoMac(entrada.tecla), caso.tecla, `${caso.id} debería mostrar ${caso.tecla}`);
      assert.equal(entrada.fila, caso.fila, `${caso.id} debería citar la fila #${caso.fila}`);

      // 1er pulso desde OCULTA: la abre y la deja activa en su dock.
      hideToolWindow(caso.tw);
      assert.equal(getLayoutState().visible[caso.tw], false, `${caso.tecla}: punto de partida oculta`);
      ejecutarAccionDeMenu(caso.accion);
      let s = getLayoutState();
      assert.ok(s.visible[caso.tw], `${caso.tecla} debería abrir ${caso.tw}`);
      assert.equal(s.active[s.docks[caso.tw]], caso.tw, `${caso.tecla} debería dejar ${caso.tw} ACTIVA en su dock`);

      // 2º pulso (la MISMA tecla, ya activa): la vuelve a ocultar.
      ejecutarAccionDeMenu(caso.accion);
      s = getLayoutState();
      assert.equal(s.visible[caso.tw], false, `el segundo ${caso.tecla} debería ocultar ${caso.tw}`);
    }
  });

  test("⌘2 con Guardadas visible pero NO activa: la activa, no la cierra (la rama intermedia del gesto)", () => {
    // El arranque (DEFAULT_LAYOUT) tiene el explorador activo y Guardadas visible de fondo en el
    // mismo dock: ⌘2 debe traerla al frente, no cerrarla — es el caso que distingue «alternar»
    // de «toggle a lo bruto».
    dom = montarDomFalso(null);
    // Fase 70 (T3): la columna izquierda ya no es de dos tool windows de fábrica, así que el caso
    // «visible pero no activa» se arma a mano (es el gesto que hay que seguir cubriendo cuando el
    // usuario apila dos tool windows en un dock).
    setLayoutState({
      ...DEFAULT_LAYOUT,
      docks: { ...DEFAULT_LAYOUT.docks, saved: "left" },
      visible: { ...DEFAULT_LAYOUT.visible, saved: true },
      active: { ...DEFAULT_LAYOUT.active, left: "explorer" },
    });
    ejecutarAccionDeMenu("view.toolWindow.saved");
    const s = getLayoutState();
    assert.ok(s.visible.saved, "⌘2 no debe cerrar Guardadas si solo estaba de fondo");
    assert.equal(s.active.left, "saved", "⌘2 debería activar Guardadas en el dock izquierdo");
    assert.ok(s.visible.explorer, "el explorador sigue visible: solo deja de estar al frente");
  });

  // ==========================================================================================
  // Hide Active Tool Window ⇧⎋
  // ==========================================================================================

  test("⇧⎋ (view.hideToolWindow) oculta la tool window ACTIVA: la del dock donde está el foco", () => {
    // El enrutador le pasa el ⇧⎋ a `ejecutarAccionDeMenu("view.hideToolWindow")`
    // (keyboard-router.ts, `GLOBALES_DEL_ENRUTADOR`), y el manejador resuelve la activa con la
    // pista de foco del DOM (layout-store.ts, `pistaDeFocoActivo`). Aquí con foco dentro del dock
    // izquierdo: la activa de ESE dock es el explorador.
    dom = montarDomFalso(elementoConPista({ dock: "left" }));
    // Mismo escenario de dos tool windows en el dock izquierdo que el test de ⌘2 (fase 70, T3: ya
    // no es el arranque, pero el gesto debe pasar a la siguiente cuando hay dos).
    setLayoutState({
      ...DEFAULT_LAYOUT,
      docks: { ...DEFAULT_LAYOUT.docks, saved: "left" },
      visible: { ...DEFAULT_LAYOUT.visible, saved: true },
      active: { ...DEFAULT_LAYOUT.active, left: "explorer" },
    });
    ejecutarAccionDeMenu("view.hideToolWindow");
    const s = getLayoutState();
    assert.equal(s.visible.explorer, false, "⇧⎋ debería ocultar el explorador (la activa del dock con foco)");
    assert.equal(s.active.left, "saved", "y el dock pasa a la siguiente que lo ocupa");
    assert.ok(s.visible.results, "las demás tool windows no se tocan");
  });

  test("⇧⎋ con el foco dentro de la No fijada abierta oculta ESA (el overlay está encima)", () => {
    dom = montarDomFalso(elementoConPista({ overlay: "ai" }));
    let s = setMode(DEFAULT_LAYOUT, "ai", "unpinned");
    s = show(s, "ai");
    setLayoutState(s);
    ejecutarAccionDeMenu("view.hideToolWindow");
    assert.equal(getLayoutState().visible.ai, false, "⇧⎋ debería cerrar la No fijada con el foco");
  });

  test("hideActiveToolWindow (el camino del ⇧⎋) devuelve el id oculto y null cuando no hay nada visible", () => {
    // El valor de retorno no lo usa el menú, pero sí lo usan las sondas y es el contrato del
    // store: `null` = «no había ninguna tool window visible que ocultar», estado intacto.
    dom = montarDomFalso(elementoConPista({ dock: "left" }));
    setLayoutState(DEFAULT_LAYOUT);
    assert.equal(hideActiveToolWindow(), "explorer");
    assert.equal(getLayoutState().visible.explorer, false);

    const vacio: LayoutState = {
      ...DEFAULT_LAYOUT,
      visible: { ...DEFAULT_LAYOUT.visible, explorer: false, saved: false, results: false },
    };
    setLayoutState(vacio);
    assert.equal(hideActiveToolWindow(), null, "sin nada visible no hay nada que ocultar");
    assert.deepEqual(getLayoutState().visible, vacio.visible, "y no se toca el estado");
  });

  // ==========================================================================================
  // Las acciones que delegan en el armazón y en el editor
  // ==========================================================================================

  /**
   * Las filas de T6 cuyo manejador delega vía evento de `window` (el armazón de la app, o el
   * editor con `cm-open-er-diagram`). Igual que arriba, la acción sale del registro.
   */
  const ACCIONES_QUE_DELEGAN: ReadonlyArray<{
    id: string;
    accion: MenuAction;
    evento: string;
    tecla: string;
    fila: number;
  }> = [
    { id: "newQueryConsole", accion: "file.newConsole", evento: "gestordb:new-console", tecla: "⌘⇧Q", fila: 11 },
    { id: "cancelRunningStatements", accion: "query.cancel", evento: "gestordb:cancel-query", tecla: "⌘F2", fila: 3 },
    { id: "findAction", accion: "view.commandPalette", evento: "gestordb:command-palette", tecla: "⌘⇧A", fila: 52 },
    { id: "reformatCode", accion: "edit.formatSql", evento: "gestordb:format-sql", tecla: "⌘⌥L", fila: 30 },
    { id: "selectNextTab", accion: "view.nextTab", evento: "gestordb:next-tab", tecla: "⌘⇧]", fila: 68 },
    { id: "selectPreviousTab", accion: "view.prevTab", evento: "gestordb:prev-tab", tecla: "⌘⇧[", fila: 68 },
  ];

  test("⌘⇧Q, ⌘F2, ⌘⇧A, ⌘⌥L y las pestañas: cada fila del registro emite SU evento de window", () => {
    // Los nombres de evento son el vocabulario que ya escuchan el armazón (`app-shell.tsx`, los
    // `gestordb:*`) y el editor (`sql-editor.tsx`): aquí se fija que cada acción de T6 use el
    // suyo y no otro. Que el receptor haga lo correcto se prueba en `src/shell/tabs.test.ts`
    // (el ciclo de pestañas) y en las fases de cada componente.
    dom = montarDomFalso(null);
    for (const caso of ACCIONES_QUE_DELEGAN) {
      const entrada = entradaPorId(caso.id);
      assert.ok(entrada, `falta la entrada ${caso.id} en el registro`);
      assert.ok(
        entrada.accion.tipo === "menu" && entrada.accion.id === caso.accion,
        `${caso.id} debería disparar ${caso.accion}`
      );
      assert.equal(aTextoMac(entrada.tecla), caso.tecla, `${caso.id} debería mostrar ${caso.tecla}`);
      assert.equal(entrada.fila, caso.fila, `${caso.id} debería citar la fila #${caso.fila}`);

      // Nota: la anotación `: number` es a propósito. Sin ella, TypeScript se enreda con el
      // estrechamiento de `dom` (un `let` con `| null` capturado por el `afterEach`) en esta
      // posición exacta y dispara TS7022 («referenced directly or indirectly in its own
      // initializer»); el tipo explícito lo resuelve sin cambiar nada del runtime.
      const eventosAntes: number = dom.despedidos.length;
      ejecutarAccionDeMenu(caso.accion);
      assert.deepEqual(dom.despedidos.slice(eventosAntes), [caso.evento], `${caso.id} debería emitir ${caso.evento}`);
    }
  });

  test("⌘⌥⇧U (view.erDiagram) dispara `cm-open-er-diagram` sobre cada editor montado; sin editor, avisa", () => {
    // El manejador reutiliza el camino que ya existía en el editor (fase 12/15): el MISMO
    // CustomEvent que despachaba el keymap `Mod-Shift-u`. Se dispara a cada `.cm-editor` porque
    // no se sabe cuál es «la consola activa» desde fuera; solo el editor SQL tiene listener.
    const registro: string[] = [];
    dom = montarDomFalso(null, { editores: [editorFalso(registro), editorFalso(registro)] });
    ejecutarAccionDeMenu("view.erDiagram");
    assert.deepEqual(registro, ["cm-open-er-diagram", "cm-open-er-diagram"]);

    // Sin editores montados no hay cursor del que sacar la tabla: se avisa y no se finge nada.
    dom.setEditores([]);
    const avisos: unknown[][] = [];
    const warnOriginal = console.warn;
    console.warn = (...args: unknown[]) => void avisos.push(args);
    try {
      ejecutarAccionDeMenu("view.erDiagram");
    } finally {
      console.warn = warnOriginal;
    }
    assert.equal(avisos.length, 1, "debería avisar de que no hay editor montado");
    assert.deepEqual(registro, ["cm-open-er-diagram", "cm-open-er-diagram"], "y no disparar nada más");
  });

  // ==========================================================================================
  // Guardia general: ninguna acción del menú puede quedar muda
  // ==========================================================================================

  test("ninguna acción de MENU_ACTIONS se queda muda: todas producen un efecto con el doble de DOM", () => {
    // El `Record<MenuAction, …>` ya impide en compilación que falte un manejador; esto comprueba
    // que, además, cada uno HACE algo observable sin Electron: emite un evento, dispara el del
    // editor o cambia el store del layout. Es la red que evita la «entrada muda» que la fase 6
    // declaró como el riesgo real de un menú completo.
    const registroEditores: string[] = [];
    dom = montarDomFalso(null, { editores: [editorFalso(registroEditores)] });
    for (const accion of MENU_ACTIONS) {
      setLayoutState(DEFAULT_LAYOUT);
      const eventosAntes = dom.despedidos.length;
      const editoresAntes = registroEditores.length;
      const estadoAntes = JSON.stringify(getLayoutState());
      ejecutarAccionDeMenu(accion);
      const cambioStore = JSON.stringify(getLayoutState()) !== estadoAntes;
      const nuevoEvento = dom.despedidos.length > eventosAntes;
      const nuevoEditor = registroEditores.length > editoresAntes;
      assert.ok(nuevoEvento || nuevoEditor || cambioStore, `"${accion}" no produjo ningún efecto observable`);
    }
  });
});
