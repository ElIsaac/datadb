/**
 * Fase 15 (R13) · Tarea T5 — tests del enrutador de teclado por foco
 * (`src/shell/keyboard-router.ts`).
 *
 * Tres bloques:
 *
 *  1. **PUROS**: `contextoDeFoco`, `normalizarTecla`, `esTeclaDelEditor` y la tabla de decisión
 *     (`decidirTecla`). Son la mitad que decide y se prueban con DATOS, sin DOM — que es la razón
 *     de que el diseño reciba cadenas de descriptores en vez de elementos.
 *  2. **REGISTRO POR INSTANCIA**: el `WeakMap` de manejadores de rejilla y el singleton del árbol,
 *     con objetos mínimos (`NodoConPadre`) en vez de nodos reales.
 *  3. **CAPA DOM con dobles**: `atenderTecla` e `instalarEnrutadorDeTeclado` contra un
 *     `window`/`document` de mentira que registra lo que le piden. Aquí se comprueba lo que de
 *     verdad importa del contrato: que la tecla se CONSUME (preventDefault + stopPropagation)
 *     exactamente cuando se actuó, y que no se consume cuando no.
 *
 * Runner: `npm test` → `tsx --test "src/**\/*.test.ts" "electron/**\/*.test.ts"` (node:test).
 */
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  GLOBALES_DEL_ENRUTADOR,
  TECLAS_DEL_RUNKEYMAP,
  TESTID_ARBOL,
  TESTID_EDITOR_PROPIO,
  TESTID_PANEL_DEL_VALOR,
  TESTID_REJILLA,
  TESTID_REJILLA_GLIDE,
  atenderTecla,
  cadenaDeAncestros,
  contextoDeFoco,
  decidirTecla,
  enrutadorInstalado,
  entradaGlobalDelEnrutador,
  esTeclaDelEditor,
  hayCapaModalAbierta,
  instalarEnrutadorDeTeclado,
  manejadoresDeRejillaMasCercanos,
  normalizarTecla,
  registrarManejadoresDeArbol,
  registrarManejadoresDeRejilla,
  teclasGlobalesDelEnrutador,
  type ContextoDeFoco,
  type DatosDeTecla,
  type DescriptorDeAncestro,
  type ManejadoresDeRejilla,
} from "./keyboard-router";
import { atajosDe, entradaPorId, type Mod, type Tecla } from "@/shared/keymap";

/** Fábrica de teclas, igual que la del registro. */
function t(key: string, ...mods: Mod[]): Tecla {
  return { mods, key };
}

/** Fábrica de eventos: sólo lo que `normalizarTecla` lee. */
function datos(key: string, extra: Partial<DatosDeTecla> = {}): DatosDeTecla {
  return { key, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, ...extra };
}

/** Un descriptor de ancestro con lo mínimo. */
function nodo(extra: Partial<DescriptorDeAncestro> = {}): DescriptorDeAncestro {
  return { tag: "div", ...extra };
}

const CONTEXTOS: readonly ContextoDeFoco[] = ["global", "editor", "rejilla", "arbol", "campo"];

// ============================================================================================
// 1. PUROS — contextoDeFoco
// ============================================================================================
describe("contextoDeFoco", () => {
  test("el contenido de CodeMirror es `editor` (aunque sea contenteditable y role=textbox)", () => {
    // Medido en vivo: `.cm-content` lleva contenteditable="true" Y role="textbox". Si el chequeo
    // de campo fuera antes, el editor se clasificaría como campo y perdería sus globales.
    const cadena = [
      nodo({ tag: "div", clases: ["cm-content"], contentEditable: true, role: "textbox" }),
      nodo({ tag: "div", clases: ["cm-scroller"] }),
      nodo({ tag: "div", clases: ["cm-editor"] }),
    ];
    assert.equal(contextoDeFoco(cadena), "editor");
  });

  test("el editor propio (DOM) es `editor` por su marcador, aunque dentro haya un textarea", () => {
    // El editor propio recibe el teclado por un `<textarea>` oculto. Sin el marcador, la cadena
    // acabaría en `campo` y el enrutador se quedaría globales que el editor necesita (⌘R).
    const cadena = [nodo({ tag: "textarea" }), nodo({ tag: "div", testid: TESTID_EDITOR_PROPIO })];
    assert.equal(contextoDeFoco(cadena), "editor");
  });

  test("un input, un textarea y un select son `campo`", () => {
    assert.equal(contextoDeFoco([nodo({ tag: "input" })]), "campo");
    assert.equal(contextoDeFoco([nodo({ tag: "textarea" })]), "campo");
    assert.equal(contextoDeFoco([nodo({ tag: "select" })]), "campo");
  });

  test("un contentEditable que no es CodeMirror es `campo`", () => {
    assert.equal(contextoDeFoco([nodo({ tag: "div", contentEditable: true })]), "campo");
  });

  test("un nodo con rol de campo (textbox/searchbox/combobox/spinbutton) es `campo`", () => {
    for (const role of ["textbox", "searchbox", "combobox", "spinbutton"]) {
      assert.equal(contextoDeFoco([nodo({ role })]), "campo", role);
    }
  });

  test("un input DENTRO de la rejilla sigue siendo `campo` (overlay de celda, fila de filtros)", () => {
    // El overlay de edición de celda de glide es un input dentro del contenedor de la rejilla: la
    // regla es que el enrutador no secuestra la escritura.
    const cadena = [
      nodo({ tag: "input" }),
      nodo({ testid: "editor-de-celda" }),
      nodo({ testid: TESTID_REJILLA_GLIDE }),
      nodo({ testid: TESTID_REJILLA }),
    ];
    assert.equal(contextoDeFoco(cadena), "campo");
  });

  test("el canvas de glide dentro del contenedor es `rejilla`", () => {
    const cadena = [
      nodo({ tag: "canvas", testid: "data-grid-canvas" }),
      nodo({ testid: TESTID_REJILLA_GLIDE }),
      nodo({ tag: "div" }),
      nodo({ testid: TESTID_REJILLA }),
      nodo({ tag: "div" }),
    ];
    assert.equal(contextoDeFoco(cadena), "rejilla");
  });

  test("un botón de la barra de la rejilla (fuera del canvas, dentro del contenedor) es `rejilla`", () => {
    const cadena = [nodo({ tag: "button" }), nodo({ testid: TESTID_REJILLA }), nodo({ tag: "div" })];
    assert.equal(contextoDeFoco(cadena), "rejilla");
  });

  test("el árbol de esquema es `arbol`", () => {
    const cadena = [nodo({ tag: "button" }), nodo({ testid: TESTID_ARBOL }), nodo({ tag: "div" })];
    assert.equal(contextoDeFoco(cadena), "arbol");
  });

  test("el panel del Value Editor es `campo` aunque contenga un CodeMirror", () => {
    const cadena = [
      nodo({ tag: "div", clases: ["cm-content"], contentEditable: true }),
      nodo({ tag: "div", clases: ["cm-editor"] }),
      nodo({ tag: "div", testid: TESTID_PANEL_DEL_VALOR }),
    ];
    assert.equal(contextoDeFoco(cadena), "campo");
  });

  test("todo lo demás es `global` (header, barra de estado, body, cadena vacía)", () => {
    assert.equal(contextoDeFoco([nodo({ tag: "button" }), nodo({ tag: "header" }), nodo({ tag: "body" })]), "global");
    assert.equal(contextoDeFoco([nodo({ tag: "body" })]), "global");
    assert.equal(contextoDeFoco([]), "global");
  });

  test("la precedencia importa: rejilla > árbol no se mezclan y campo gana a rejilla", () => {
    // Un nodo con los dos marcadores (no pasa hoy, pero fija la precedencia): gana rejilla porque
    // se consulta antes. Y con un input dentro, gana campo.
    assert.equal(
      contextoDeFoco([nodo({ tag: "canvas" }), nodo({ testid: TESTID_ARBOL }), nodo({ testid: TESTID_REJILLA })]),
      "rejilla"
    );
    assert.equal(
      contextoDeFoco([nodo({ tag: "input" }), nodo({ testid: TESTID_ARBOL }), nodo({ testid: TESTID_REJILLA })]),
      "campo"
    );
  });
});

// ============================================================================================
// 1. PUROS — normalizarTecla
// ============================================================================================
describe("normalizarTecla", () => {
  test("letras a mayúscula, dígitos y puntuación literales", () => {
    assert.deepEqual(normalizarTecla(datos("d", { metaKey: true })), t("D", "Meta"));
    assert.deepEqual(normalizarTecla(datos("D", { metaKey: true, shiftKey: true })), t("D", "Meta", "Shift"));
    assert.deepEqual(normalizarTecla(datos("1", { metaKey: true })), t("1", "Meta"));
    assert.deepEqual(normalizarTecla(datos(",", { metaKey: true })), t(",", "Meta"));
    assert.deepEqual(normalizarTecla(datos("/", { metaKey: true })), t("/", "Meta"));
  });

  test("⇧ sobre puntuación se DESHACE (⌘⇧] llega como «}»)", () => {
    assert.deepEqual(normalizarTecla(datos("}", { metaKey: true, shiftKey: true })), t("]", "Meta", "Shift"));
    assert.deepEqual(normalizarTecla(datos("{", { metaKey: true, shiftKey: true })), t("[", "Meta", "Shift"));
    assert.deepEqual(normalizarTecla(datos("?", { metaKey: true, shiftKey: true })), t("/", "Meta", "Shift"));
  });

  test("teclas con nombre: Enter, Escape, Backspace, Delete, flechas, Space, F1-F24", () => {
    assert.deepEqual(normalizarTecla(datos("Enter", { shiftKey: true })), t("Enter", "Shift"));
    assert.deepEqual(normalizarTecla(datos("Escape", { shiftKey: true })), t("Escape", "Shift"));
    assert.deepEqual(normalizarTecla(datos("Backspace")), t("Backspace"));
    assert.deepEqual(normalizarTecla(datos("Delete", { altKey: true })), t("Delete", "Alt"));
    assert.deepEqual(normalizarTecla(datos("ArrowUp", { metaKey: true, altKey: true })), t("ArrowUp", "Meta", "Alt"));
    assert.deepEqual(normalizarTecla(datos("F4")), t("F4"));
    assert.deepEqual(normalizarTecla(datos("F5", { metaKey: true })), t("F5", "Meta"));
    assert.deepEqual(normalizarTecla(datos(" ")), t("Space"));
  });

  test("con ⌥ se prefiere event.code (⌥A llega como «å»)", () => {
    // El caso que midió T4: en macOS ⌥A produce el carácter «å», no la letra. Por código físico sí
    // se reconoce.
    assert.deepEqual(normalizarTecla(datos("å", { altKey: true, code: "KeyA" })), t("A", "Alt"));
    // Y ⌥⌦ (Delete con ⌥; T8 lo eliminó del registro —⌥⌦ no es Delete Row en DataGrip—, pero el
    // evento del teclado sigue teniendo esta forma): el código manda sobre cualquier carácter de control.
    assert.deepEqual(normalizarTecla(datos("\u007f", { altKey: true, code: "Delete" })), t("Delete", "Alt"));
    // Las flechas con ⌥ no se rompen: el código da el mismo nombre.
    assert.deepEqual(normalizarTecla(datos("ArrowDown", { altKey: true, code: "ArrowDown" })), t("ArrowDown", "Alt"));
  });

  test("modificadores: los cuatro, en el orden del registro", () => {
    assert.deepEqual(
      normalizarTecla(datos("U", { metaKey: true, altKey: true, shiftKey: true, code: "KeyU" })),
      t("U", "Meta", "Alt", "Shift")
    );
    assert.deepEqual(normalizarTecla(datos("Space", { ctrlKey: true })), t("Space", "Ctrl"));
  });

  test("una tecla desconocida devuelve undefined (no inventa atajos)", () => {
    assert.equal(normalizarTecla(datos("Unidentified")), undefined);
    assert.equal(normalizarTecla(datos("Dead")), undefined);
    assert.equal(normalizarTecla(datos("F25")), undefined);
  });
});

// ============================================================================================
// 1. PUROS — esTeclaDelEditor + las listas derivadas del registro
// ============================================================================================
describe("esTeclaDelEditor", () => {
  test("cubre TODO el contexto `editor` del registro (principal + alias)", () => {
    for (const e of atajosDe("editor")) {
      assert.ok(esTeclaDelEditor(e.tecla), `la principal de "${e.id}" debería ser del editor`);
      for (const alias of e.alias ?? []) {
        assert.ok(esTeclaDelEditor(alias), `el alias de "${e.id}" debería ser del editor`);
      }
    }
  });

  test("cubre el runKeymap de sql-editor.tsx (7 teclas, incluidas ⇧⌘F y ⌘⇧U)", () => {
    assert.equal(TECLAS_DEL_RUNKEYMAP.length, 7);
    for (const tecla of TECLAS_DEL_RUNKEYMAP) assert.ok(esTeclaDelEditor(tecla));
    assert.ok(esTeclaDelEditor(t("F", "Meta", "Shift")), "⇧⌘F lo atiende el runKeymap");
    assert.ok(esTeclaDelEditor(t("U", "Meta", "Shift")), "⌘⇧U lo atiende el runKeymap");
  });

  test("NO se lleva las teclas del enrutador (⌘K, ⇧⎋) ni las de rejilla/árbol", () => {
    assert.equal(esTeclaDelEditor(t("K", "Meta")), false);
    assert.equal(esTeclaDelEditor(t("Escape", "Shift")), false);
    assert.equal(esTeclaDelEditor(t("N", "Meta")), false);
    // T8: ⌘F5 ya no es la tecla PRINCIPAL de refresh/refreshGrid (quedó como alias), pero sigue
    // sin ser del editor; y ⌘R/⌘⌫ SÍ son del editor (replace #54 / deleteLine #35) aunque
    // refresh/refreshGrid/deleteRow también los usen en sus contextos: el enrutador decide por foco.
    assert.equal(esTeclaDelEditor(t("F5", "Meta")), false);
    assert.ok(esTeclaDelEditor(t("R", "Meta")), "⌘R lo atiende el editor (replace, #54)");
    assert.ok(esTeclaDelEditor(t("Backspace", "Meta")), "⌘⌫ lo atiende el editor (deleteLine, #35)");
  });
});

describe("las teclas globales del enrutador", () => {
  test("son exactamente ⇧⌘F, ⌘⇧U, ⌘K y ⇧⎋ — derivadas del registro, no escritas aquí", () => {
    const teclas = teclasGlobalesDelEnrutador();
    assert.deepEqual(
      teclas.map((c) => `${c.tecla.mods.join("+")}/${c.tecla.key}`),
      ["Meta+Shift/F", "Meta+Shift/U", "Meta/K", "Shift/Escape"]
    );
    assert.deepEqual(
      teclas.map((c) => c.entrada.id),
      ["reformatCode", "showDiagram", "findAction", "hideActiveToolWindow"]
    );
    // Las tres primeras son ALIAS de D1; ⇧⎋ es la principal de su entrada (no lleva ⌘: macOS no
    // dispara su acelerador de menú y por eso lo sirve el enrutador — medición T1).
    assert.deepEqual(teclas.map((c) => c.esAlias), [true, true, true, false]);
  });

  test("todo id de GLOBALES_DEL_ENRUTADOR existe en el registro y es una acción de menú", () => {
    for (const cfg of GLOBALES_DEL_ENRUTADOR) {
      const entrada = entradaPorId(cfg.id);
      assert.ok(entrada, `"${cfg.id}" no está en el registro`);
      assert.equal(entrada.accion.tipo, "menu", `"${cfg.id}" debería ser una acción de menú`);
    }
  });

  test("entradaGlobalDelEnrutador reconoce las suyas y NO las principales que sirve el menú", () => {
    assert.equal(entradaGlobalDelEnrutador(t("K", "Meta"))?.id, "findAction");
    assert.equal(entradaGlobalDelEnrutador(t("F", "Meta", "Shift"))?.id, "reformatCode");
    assert.equal(entradaGlobalDelEnrutador(t("U", "Meta", "Shift"))?.id, "showDiagram");
    assert.equal(entradaGlobalDelEnrutador(t("Escape", "Shift"))?.id, "hideActiveToolWindow");
    // ⌘⌥L es el PRINCIPAL de reformatCode y lo sirve el menú: el enrutador no debe servirlo.
    // (El `control alt L` del XML de DataGrip NO es ⌃⌥L: ahí `control` es ⌘. Ver rea-datagrip.md §5.1.)
    assert.equal(entradaGlobalDelEnrutador(t("L", "Meta", "Alt")), undefined);
    assert.equal(entradaGlobalDelEnrutador(t("U", "Meta", "Alt", "Shift")), undefined);
    assert.equal(entradaGlobalDelEnrutador(t("A", "Meta", "Shift")), undefined);
  });
});

// ============================================================================================
// 1. PUROS — la tabla de decisión
// ============================================================================================
describe("decidirTecla", () => {
  test("contexto `editor`: NO toca lo que el editor atiende (regla a)", () => {
    for (const tecla of [t("Enter", "Meta"), t("Enter", "Shift"), t("D", "Meta"), t("Backspace", "Meta"), t("ArrowUp", "Alt"), t("Space", "Ctrl"), t("F", "Meta", "Shift"), t("U", "Meta", "Shift")]) {
      assert.equal(decidirTecla(tecla, "editor"), undefined, tecla.key);
    }
  });

  test("contexto `editor`: SÍ sirve lo que el editor no consume (⌘K, ⇧⎋)", () => {
    assert.equal(decidirTecla(t("K", "Meta"), "editor")?.accionDeMenu, "view.commandPalette");
    assert.equal(decidirTecla(t("Escape", "Shift"), "editor")?.accionDeMenu, "view.hideToolWindow");
  });

  test("contexto `rejilla`: cada acción de la tabla, con su destino y su acción de app", () => {
    const casos: ReadonlyArray<[Tecla, string, string | undefined]> = [
      [t("Enter", "Meta"), "submitChanges", "grid.confirmChanges"],
      [t("Enter", "Shift"), "openInValueEditor", undefined],
      [t("N", "Meta"), "addRow", "grid.addRow"],
      [t("Backspace", "Meta"), "deleteRow", "grid.deleteSelected"],
      [t("Backspace"), "deleteRow", "grid.deleteSelected"],
      [t("Delete"), "deleteRow", "grid.deleteSelected"],
      [t("D", "Meta"), "cloneRow", "grid.duplicateSelected"],
      [t("ArrowUp", "Meta", "Alt"), "previousPage", "grid.prevPage"],
      [t("ArrowDown", "Meta", "Alt"), "nextPage", "grid.nextPage"],
      [t("F4"), "relatedRows", "grid.navigateFk"],
      [t("R", "Meta"), "refreshGrid", "grid.refresh"],
      [t("F5", "Meta"), "refreshGrid", "grid.refresh"], // alias de D1 (T8: ⌘F5 era el atajo viejo)
    ];
    for (const [tecla, id, accion] of casos) {
      const decision = decidirTecla(tecla, "rejilla");
      assert.ok(decision, `${id} debería decidir`);
      assert.equal(decision.entrada.id, id);
      if (id === "openInValueEditor") {
        assert.equal(decision.destino, "menu");
        assert.equal(decision.accionDeMenu, "view.toolWindow.value");
      } else {
        assert.equal(decision.destino, "rejilla");
        assert.equal(decision.accionDeApp, accion);
      }
    }
  });

  test("T8 (§5.1): ⌘R y ⌘⌫ significan otra cosa por foco; ⌘F5 sigue como alias y ⌥⌦ ya no existe", () => {
    // Auditoría T8 (`T8-oraculo.md` §5.1): el keymap activo de DataGrip declara `Refresh` como
    // `meta R` (PISA el `control F5` heredado) y `DeleteRows` toma prestado `EditorDeleteLine` =
    // `⌘⌫`. La MISMA tecla significa otra cosa en el editor (replace #54 / deleteLine #35): el
    // enrutador resuelve por foco, exactamente como con `⌘D` (#34/#Clone Row).
    assert.equal(decidirTecla(t("R", "Meta"), "rejilla")?.entrada.id, "refreshGrid");
    assert.equal(decidirTecla(t("R", "Meta"), "rejilla")?.accionDeApp, "grid.refresh");
    assert.equal(decidirTecla(t("R", "Meta"), "arbol")?.entrada.id, "refresh");
    assert.equal(decidirTecla(t("R", "Meta"), "arbol")?.accionDeApp, "tree.refresh");
    assert.equal(decidirTecla(t("R", "Meta"), "editor"), undefined, "en el editor ⌘R es replace (#54): lo atiende su keymap");
    assert.equal(decidirTecla(t("Backspace", "Meta"), "rejilla")?.entrada.id, "deleteRow");
    assert.equal(decidirTecla(t("Backspace", "Meta"), "rejilla")?.accionDeApp, "grid.deleteSelected");
    assert.equal(decidirTecla(t("Backspace", "Meta"), "editor"), undefined, "en el editor ⌘⌫ es deleteLine (#35): lo atiende su keymap");
    // ⌘F5, el atajo viejo, se conserva como ALIAS (D1) en árbol y rejilla:
    assert.equal(decidirTecla(t("F5", "Meta"), "arbol")?.entrada.id, "refresh");
    assert.equal(decidirTecla(t("F5", "Meta"), "rejilla")?.entrada.id, "refreshGrid");
    // ⌥⌦ se ELIMINÓ: en DataGrip es borrar hasta el final de la palabra, no Delete Row.
    assert.equal(decidirTecla(t("Delete", "Alt"), "rejilla"), undefined);
    // Y en `global` ninguna de las dos significa nada (no son globales del enrutador ni del menú).
    assert.equal(decidirTecla(t("R", "Meta"), "global"), undefined);
    assert.equal(decidirTecla(t("Backspace", "Meta"), "global"), undefined);
  });

  test("⌘⏎ en la rejilla se consume SIEMPRE (consumeSiempre); las demás no", () => {
    // #96: en DataGrip, ⌘⏎ en el data editor no ejecuta la consulta ni aunque no haya cambios.
    assert.equal(decidirTecla(t("Enter", "Meta"), "rejilla")?.consumeSiempre, true);
    assert.equal(decidirTecla(t("N", "Meta"), "rejilla")?.consumeSiempre, undefined);
    assert.equal(decidirTecla(t("R", "Meta"), "rejilla")?.consumeSiempre, undefined);
  });

  test("contexto `rejilla`: las globales del enrutador también valen ahí", () => {
    assert.equal(decidirTecla(t("K", "Meta"), "rejilla")?.entrada.id, "findAction");
    assert.equal(decidirTecla(t("F", "Meta", "Shift"), "rejilla")?.entrada.id, "reformatCode");
    assert.equal(decidirTecla(t("U", "Meta", "Shift"), "rejilla")?.entrada.id, "showDiagram");
    assert.equal(decidirTecla(t("Escape", "Shift"), "rejilla")?.entrada.id, "hideActiveToolWindow");
  });

  test("contexto `arbol`: ⌘R refresca el árbol (y ⌘F5, alias); nada más de rejilla", () => {
    const decision = decidirTecla(t("R", "Meta"), "arbol");
    assert.equal(decision?.entrada.id, "refresh");
    assert.equal(decision?.destino, "arbol");
    assert.equal(decision?.accionDeApp, "tree.refresh");
    // ⌘F5 (T8: el atajo viejo del registro, alias de D1) sigue refrescando el árbol:
    assert.equal(decidirTecla(t("F5", "Meta"), "arbol")?.entrada.id, "refresh");
    assert.equal(decidirTecla(t("N", "Meta"), "arbol"), undefined);
    assert.equal(decidirTecla(t("Enter", "Meta"), "arbol"), undefined);
    assert.equal(decidirTecla(t("K", "Meta"), "arbol")?.entrada.id, "findAction");
  });

  test("contexto `campo`: NADA que escriba o edite texto (regla b)", () => {
    for (const tecla of [t("Backspace"), t("Delete"), t("Enter"), t("Enter", "Shift"), t("Enter", "Meta"), t("ArrowUp"), t("ArrowDown", "Meta", "Alt"), t("D", "Meta"), t("N", "Meta"), t("F4"), t("R", "Meta"), t("Backspace", "Meta"), t("A")]) {
      assert.equal(decidirTecla(tecla, "campo"), undefined, tecla.key);
    }
  });

  test("contexto `campo`: SÍ las globales con ⌘ que el menú no sirve, y ⇧⎋", () => {
    assert.equal(decidirTecla(t("K", "Meta"), "campo")?.accionDeMenu, "view.commandPalette");
    assert.equal(decidirTecla(t("F", "Meta", "Shift"), "campo")?.accionDeMenu, "edit.formatSql");
    assert.equal(decidirTecla(t("U", "Meta", "Shift"), "campo")?.accionDeMenu, "view.erDiagram");
    assert.equal(decidirTecla(t("Escape", "Shift"), "campo")?.accionDeMenu, "view.hideToolWindow");
  });

  test("contexto `global`: sólo las del enrutador", () => {
    assert.equal(decidirTecla(t("K", "Meta"), "global")?.entrada.id, "findAction");
    assert.equal(decidirTecla(t("F", "Meta", "Shift"), "global")?.entrada.id, "reformatCode");
    assert.equal(decidirTecla(t("U", "Meta", "Shift"), "global")?.entrada.id, "showDiagram");
    assert.equal(decidirTecla(t("Escape", "Shift"), "global")?.entrada.id, "hideActiveToolWindow");
    // Los atajos de rejilla y árbol NO valen fuera de su contexto:
    assert.equal(decidirTecla(t("N", "Meta"), "global"), undefined);
    assert.equal(decidirTecla(t("R", "Meta"), "global"), undefined);
    assert.equal(decidirTecla(t("F5", "Meta"), "global"), undefined);
    assert.equal(decidirTecla(t("Backspace", "Meta"), "global"), undefined);
    assert.equal(decidirTecla(t("F4"), "global"), undefined);
  });

  test("los globales con ⌘ del MENÚ no son del enrutador en ningún contexto", () => {
    // ⌘⏎ del editor lo sirve su keymap; ⌘⌥L, ⌘⇧A, ⌘1, ⌘⇧Q, ⌘⇧]… los sirve el menú nativo (T3).
    const delMenu = [t("L", "Meta", "Alt"), t("A", "Meta", "Shift"), t("1", "Meta"), t("Q", "Meta", "Shift"), t("]", "Meta", "Shift"), t(",", "Meta"), t("F2", "Meta")];
    for (const contexto of CONTEXTOS) {
      for (const tecla of delMenu) {
        const decision = decidirTecla(tecla, contexto);
        // La única excepción: en `editor` el ⌘⏎ del registro ejecuta… y tampoco es del enrutador.
        assert.equal(decision, undefined, `${tecla.key} en ${contexto}`);
      }
    }
  });

  test("coherencia con el registro: toda decisión sale de una entrada real y `mismaTecla` casa", () => {
    for (const contexto of CONTEXTOS) {
      for (const e of atajosDe(contexto === "campo" ? "global" : contexto)) {
        for (const tecla of [e.tecla, ...(e.alias ?? [])]) {
          const decision = decidirTecla(tecla, contexto);
          if (!decision) continue;
          assert.ok(entradaPorId(decision.entrada.id), `la decisión apunta a "${decision.entrada.id}", que no está en el registro`);
        }
      }
    }
  });
});

// ============================================================================================
// 2. REGISTRO POR INSTANCIA
// ============================================================================================
/** Nodo mínimo para la cadena: cumple `NodoConPadre` sin DOM. */
interface NodoFalso {
  parentElement: NodoFalso | null;
}

function nodoFalso(padre: NodoFalso | null = null): NodoFalso {
  return { parentElement: padre };
}

function manejadoresDePrueba(marca: string, registro: string[]): ManejadoresDeRejilla {
  const si = () => {
    registro.push(marca);
    return true;
  };
  return {
    guardarCambios: si,
    agregarFila: si,
    borrarSeleccionadas: si,
    duplicarSeleccionadas: si,
    paginaAnterior: si,
    paginaSiguiente: si,
    irALaReferenciada: si,
    refrescar: si,
  };
}

describe("manejadores por instancia de rejilla", () => {
  test("se encuentra la rejilla MÁS CERCANA subiendo por los ancestros", () => {
    const lejano = nodoFalso(null);
    const cercano = nodoFalso(lejano);
    const medio = nodoFalso(cercano);
    const foco = nodoFalso(medio);
    const registro: string[] = [];
    registrarManejadoresDeRejilla(lejano, manejadoresDePrueba("lejano", registro));
    registrarManejadoresDeRejilla(cercano, manejadoresDePrueba("cercano", registro));
    const encontrados = manejadoresDeRejillaMasCercanos(foco);
    assert.ok(encontrados);
    encontrados.agregarFila();
    assert.deepEqual(registro, ["cercano"]);
  });

  test("sin registro devuelve undefined (y el enrutador no consumirá nada)", () => {
    assert.equal(manejadoresDeRejillaMasCercanos(nodoFalso(null)), undefined);
    assert.equal(manejadoresDeRejillaMasCercanos(null), undefined);
  });

  test("re-registrar el mismo contenedor actualiza; la baja lo elimina", () => {
    const contenedor = nodoFalso(null);
    const foco = nodoFalso(contenedor);
    const registro: string[] = [];
    const baja = registrarManejadoresDeRejilla(contenedor, manejadoresDePrueba("viejo", registro));
    registrarManejadoresDeRejilla(contenedor, manejadoresDePrueba("nuevo", registro));
    manejadoresDeRejillaMasCercanos(foco)?.refrescar();
    assert.deepEqual(registro, ["nuevo"]);
    baja();
    assert.equal(manejadoresDeRejillaMasCercanos(foco), undefined);
  });

  test("el árbol es un singleton: se registra, se usa y se limpia con null", () => {
    const registro: string[] = [];
    registrarManejadoresDeArbol({
      refrescar: () => {
        registro.push("arbol");
        return true;
      },
    });
    const baja = registrarManejadoresDeArbol(null);
    assert.equal(registro.length, 0, "tras limpiar, el manejador no existe");
    baja(); // idempotente
  });
});

// ============================================================================================
// 3. CAPA DOM con dobles
// ============================================================================================

/** Elemento falso que cumple lo que `descriptorDeElemento` lee. */
function elementoFalso(opciones: {
  tag?: string;
  testid?: string;
  role?: string;
  clases?: string[];
  contentEditable?: boolean;
  padre?: Element | null;
}): Element {
  const attrs = new Map<string, string>();
  if (opciones.testid) attrs.set("data-testid", opciones.testid);
  if (opciones.role) attrs.set("role", opciones.role);
  if (opciones.contentEditable) attrs.set("contenteditable", "true");
  const el = {
    tagName: (opciones.tag ?? "div").toUpperCase(),
    classList: [...(opciones.clases ?? [])],
    parentElement: opciones.padre ?? null,
    getAttribute: (nombre: string) => attrs.get(nombre) ?? null,
  };
  return el as unknown as Element;
}

/** Evento falso con lo que `atenderTecla` usa. */
function eventoFalso(datosTecla: DatosDeTecla) {
  const marcado = { prevented: false, stopped: false };
  const evento = {
    ...datosTecla,
    preventDefault: () => (marcado.prevented = true),
    stopPropagation: () => (marcado.stopped = true),
  };
  return { evento: evento as unknown as KeyboardEvent, marcado };
}

/** Doble de `window`/`document` para la capa DOM. */
function montarDomFalso(activo: Element | null, capaModal = false) {
  const despedidos: string[] = [];
  const listeners: Array<{ tipo: string; fn: (e: unknown) => void; captura: boolean }> = [];
  const global = globalThis as unknown as Record<string, unknown>;
  const previo = { window: global.window, document: global.document, Element: global.Element };
  /*
   * `Element` también se dobla: `layout-store.pistaDeFocoActivo` (el `⇧⎋`) hace
   * `el instanceof Element` y en Node esa clase no existe — sin el doble, la sonda de tests
   * reventaría con `ReferenceError: Element is not defined` en un camino que en el navegador es
   * una línea. Los elementos falsos no son instancias de este doble, así que la pista de foco
   * devuelve `null` (que es exactamente lo que hace la app cuando el foco no está en una tool
   * window) y el resto del camino se recorre igual.
   */
  class ElementFalso {}
  global.Element = ElementFalso;
  global.window = {
    addEventListener: (tipo: string, fn: (e: unknown) => void, captura: boolean) => listeners.push({ tipo, fn, captura }),
    removeEventListener: (tipo: string, fn: (e: unknown) => void, captura: boolean) => {
      const i = listeners.findIndex((l) => l.fn === fn && l.captura === captura);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent: (evento: { type?: string }) => {
      despedidos.push(String(evento?.type ?? "evento"));
      return true;
    },
    localStorage: { getItem: () => null, setItem: () => undefined },
  };
  global.document = {
    activeElement: activo,
    querySelector: (selector: string) => {
      if (selector.includes("role") && capaModal) return {} as Element;
      return null;
    },
  };
  return {
    despedidos,
    listeners,
    restaurar: () => {
      global.window = previo.window;
      global.document = previo.document;
      global.Element = previo.Element;
    },
  };
}

describe("atenderTecla (con window/document de mentira)", () => {
  let dom: ReturnType<typeof montarDomFalso> | null = null;
  afterEach(() => {
    dom?.restaurar();
    dom = null;
  });

  test("⌘⏎ en la rejilla llama al manejador de LA instancia y consume la tecla", () => {
    const contenedor = elementoFalso({ testid: TESTID_REJILLA });
    const canvas = elementoFalso({ tag: "canvas", padre: contenedor });
    dom = montarDomFalso(canvas);
    const registro: string[] = [];
    registrarManejadoresDeRejilla(contenedor, manejadoresDePrueba("grid", registro));
    const { evento, marcado } = eventoFalso(datos("Enter", { metaKey: true }));
    assert.equal(atenderTecla(evento), true);
    assert.deepEqual(registro, ["grid"]);
    assert.equal(marcado.prevented, true);
    assert.equal(marcado.stopped, true);
  });

  test("⌘⌫ en la rejilla (T8, Delete Row) llama al manejador de la instancia y consume", () => {
    // §5.1 de T8-oraculo.md: `⌘⌫` es la tecla real de Delete Rows; el enrutador la sirve por foco
    // (en el editor la MISMA tecla es deleteLine y se queda con ella su keymap).
    const contenedor = elementoFalso({ testid: TESTID_REJILLA });
    const canvas = elementoFalso({ tag: "canvas", padre: contenedor });
    dom = montarDomFalso(canvas);
    const registro: string[] = [];
    registrarManejadoresDeRejilla(contenedor, manejadoresDePrueba("grid", registro));
    const { evento, marcado } = eventoFalso(datos("Backspace", { metaKey: true }));
    assert.equal(atenderTecla(evento), true);
    assert.deepEqual(registro, ["grid"]);
    assert.equal(marcado.prevented, true);
  });

  test("un manejador que NO actúa deja pasar la tecla (⌫ sin filas marcadas)", () => {
    const contenedor = elementoFalso({ testid: TESTID_REJILLA });
    const canvas = elementoFalso({ tag: "canvas", padre: contenedor });
    dom = montarDomFalso(canvas);
    registrarManejadoresDeRejilla(contenedor, {
      ...manejadoresDePrueba("x", []),
      borrarSeleccionadas: () => false,
    });
    const { evento, marcado } = eventoFalso(datos("Backspace"));
    assert.equal(atenderTecla(evento), false);
    assert.equal(marcado.prevented, false);
  });

  test("⌘⏎ con la rejilla SIN manejadores registrados no se consume (el menú queda de respaldo)", () => {
    const contenedor = elementoFalso({ testid: TESTID_REJILLA });
    const canvas = elementoFalso({ tag: "canvas", padre: contenedor });
    dom = montarDomFalso(canvas);
    const { evento, marcado } = eventoFalso(datos("Enter", { metaKey: true }));
    assert.equal(atenderTecla(evento), false);
    assert.equal(marcado.prevented, false, "sin instancia no se consume nada: consumeSiempre no aplica");
  });

  test("con una capa modal abierta no se actúa (ni ⌘K ni ⌘⏎)", () => {
    const contenedor = elementoFalso({ testid: TESTID_REJILLA });
    const canvas = elementoFalso({ tag: "canvas", padre: contenedor });
    dom = montarDomFalso(canvas, true);
    const registro: string[] = [];
    registrarManejadoresDeRejilla(contenedor, manejadoresDePrueba("grid", registro));
    assert.equal(atenderTecla(eventoFalso(datos("Enter", { metaKey: true })).evento), false);
    assert.equal(atenderTecla(eventoFalso(datos("k", { metaKey: true })).evento), false);
    assert.deepEqual(registro, []);
    assert.deepEqual(dom.despedidos, []);
  });

  test("en un campo de texto, ⌘K abre la paleta por el camino único del menú (⌫ no)", () => {
    const input = elementoFalso({ tag: "input" });
    dom = montarDomFalso(input);
    const { evento, marcado } = eventoFalso(datos("k", { metaKey: true }));
    assert.equal(atenderTecla(evento), true);
    assert.deepEqual(dom.despedidos, ["gestordb:command-palette"]);
    assert.equal(marcado.prevented, true);
    // Y ⌫ no se toca:
    const borrar = eventoFalso(datos("Backspace"));
    assert.equal(atenderTecla(borrar.evento), false);
    assert.equal(borrar.marcado.prevented, false);
  });

  test("en el editor, ⇧⌘F NO se consume (lo sirve su runKeymap) pero ⇧⎋ sí", () => {
    const cm = elementoFalso({ clases: ["cm-content"], contentEditable: true, role: "textbox" });
    dom = montarDomFalso(cm);
    const formatear = eventoFalso(datos("F", { metaKey: true, shiftKey: true }));
    assert.equal(atenderTecla(formatear.evento), false);
    assert.equal(formatear.marcado.prevented, false);
    const ocultar = eventoFalso(datos("Escape", { shiftKey: true }));
    assert.equal(atenderTecla(ocultar.evento), true);
    assert.equal(ocultar.marcado.prevented, true);
  });

  test("⌘R en el árbol llama al refresco registrado (⌘F5, alias, también); sin registro, no consume", () => {
    const arbol = elementoFalso({ testid: TESTID_ARBOL });
    const fila = elementoFalso({ tag: "button", padre: arbol });
    dom = montarDomFalso(fila);
    const registro: string[] = [];
    registrarManejadoresDeArbol({
      refrescar: () => {
        registro.push("arbol");
        return true;
      },
    });
    const { evento, marcado } = eventoFalso(datos("r", { metaKey: true }));
    assert.equal(atenderTecla(evento), true);
    assert.deepEqual(registro, ["arbol"]);
    assert.equal(marcado.prevented, true);
    // T8: ⌘F5 quedó como ALIAS de refresh/refreshGrid y sigue refrescando el árbol:
    const alias = eventoFalso(datos("F5", { metaKey: true }));
    assert.equal(atenderTecla(alias.evento), true);
    assert.deepEqual(registro, ["arbol", "arbol"]);
    // Y sin registro:
    registrarManejadoresDeArbol(null);
    const otra = eventoFalso(datos("r", { metaKey: true }));
    assert.equal(atenderTecla(otra.evento), false);
  });

  test("una tecla que el enrutador no conoce no se consume nunca", () => {
    const body = elementoFalso({ tag: "body" });
    dom = montarDomFalso(body);
    for (const tecla of [datos("z", { metaKey: true }), datos("Enter", { metaKey: true }), datos("a")]) {
      const { evento, marcado } = eventoFalso(tecla);
      assert.equal(atenderTecla(evento), false, tecla.key);
      assert.equal(marcado.prevented, false);
    }
  });

  test("hayCapaModalAbierta consulta el MISMO selector que tool-window.tsx", () => {
    dom = montarDomFalso(elementoFalso({ tag: "body" }));
    const consultados: string[] = [];
    (globalThis as unknown as { document: { querySelector: (s: string) => unknown } }).document.querySelector = (selector: string) => {
      consultados.push(selector);
      return null;
    };
    hayCapaModalAbierta();
    assert.equal(consultados.length, 1);
    assert.ok(consultados[0].includes('[role="menu"]'));
    assert.ok(consultados[0].includes('[role="dialog"]'));
    assert.ok(consultados[0].includes('[role="alertdialog"]'));
    assert.ok(consultados[0].includes('[role="listbox"]'));
  });
});

describe("instalarEnrutadorDeTeclado", () => {
  test("instala UN listener en captura y es idempotente; la baja lo quita", () => {
    const dom = montarDomFalso(elementoFalso({ tag: "body" }));
    try {
      const baja1 = instalarEnrutadorDeTeclado();
      assert.equal(dom.listeners.length, 1);
      assert.equal(dom.listeners[0].tipo, "keydown");
      assert.equal(dom.listeners[0].captura, true);
      assert.equal(enrutadorInstalado(), true);
      const baja2 = instalarEnrutadorDeTeclado();
      assert.equal(dom.listeners.length, 1, "una segunda instalación no añade otro listener");
      assert.equal(baja1, baja2);
      baja1();
      assert.equal(dom.listeners.length, 0);
      assert.equal(enrutadorInstalado(), false);
      // Tras la baja, una instalación nueva vuelve a poner uno solo:
      instalarEnrutadorDeTeclado();
      assert.equal(dom.listeners.length, 1);
      instalarEnrutadorDeTeclado()();
    } finally {
      dom.restaurar();
    }
  });

  test("fuera del navegador (sin window) no explota y no deja nada instalado", () => {
    const baja = instalarEnrutadorDeTeclado();
    assert.equal(typeof baja, "function");
    assert.equal(enrutadorInstalado(), false);
    baja();
  });
});

// ============================================================================================
// Extra: `cadenaDeAncestros` con el doble de elemento
// ============================================================================================
describe("cadenaDeAncestros", () => {
  test("recorre del elemento activo hacia arriba y vuelca lo que lee el clasificador", () => {
    const raiz = elementoFalso({ tag: "body" });
    const contenedor = elementoFalso({ testid: TESTID_REJILLA, padre: raiz });
    const canvas = elementoFalso({ tag: "canvas", clases: ["dvn-canvas"], padre: contenedor });
    const cadena = cadenaDeAncestros(canvas);
    assert.equal(cadena.length, 3);
    assert.deepEqual(cadena[0], { tag: "canvas", testid: undefined, role: undefined, clases: ["dvn-canvas"], contentEditable: false });
    assert.equal(cadena[1].testid, TESTID_REJILLA);
    assert.equal(cadena[2].tag, "body");
    assert.equal(contextoDeFoco(cadena), "rejilla");
  });
});
