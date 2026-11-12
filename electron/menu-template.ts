/**
 * ============================================================================
 * Fase 15 (R13) · Tarea T3 — el PLANTILLA del menú, construida desde el registro
 * ============================================================================
 *
 * POR QUÉ ESTE ARCHIVO ESTÁ SEPARADO DE `electron/menu.ts`
 * -------------------------------------------------------
 * `electron/menu.ts` importa `electron` en tiempo de ejecución (`app`, `Menu`) y eso lo hace
 * imposible de importar desde un test de `node:test` con `tsx` (el paquete `electron` no exporta
 * `app`/`Menu` fuera de Electron; el import revienta con MODULE_NOT_FOUND, medido). La parte que
 * merece test —«de dónde sale cada acelerador»— no necesita Electron para nada: es una proyección
 * del registro puro. Vive aquí, SIN ningún import de Electron salvo `import type` (que TypeScript
 * borra al compilar), y `menu.ts` la usa para construir y aplicar el menú de verdad.
 *
 * LA REGLA (T1, medido con teclas reales en macOS)
 * ------------------------------------------------
 * El subagente de T1 midió el veredicto «Plan B»: el `keydown` llega PRIMERO al renderer y, en
 * macOS, **un acelerador del menú sin ⌘ NO se dispara desde el teclado** (con `⇧⏎` no se abrió el
 * Value Editor; con `⌘,` sí se abrieron los ajustes). Por eso aquí sólo se declara acelerador de
 * menú para las entradas **globales CON ⌘**: son las únicas que el menú puede servir de verdad. Los
 * atajos por foco y los que no llevan ⌘ los atiende el ENRUTADOR del renderer (otra tarea de la
 * fase); este archivo NO los duplica en el menú (duplicarlos produciría el doble disparo que la
 * fase lleva toda la vida peleando).
 *
 * DOS EXCEPCIONES, ambas documentadas y con su porqué:
 *   1. `view.toolWindow.value` (Value Editor, ⇧⏎, #97) SÍ declara su acelerador, pero **sólo para
 *      MOSTRARLO** en el ítem: en macOS no captura nada (T1) y quien lo ejecuta es el enrutador en
 *      la rejilla. Es la «excepción para mostrar» que autoriza el PLAN.
 *   2. `view.hideToolWindow` (⇧⎋, #87) es global pero NO lleva ⌘: no se declara acelerador y el
 *      atajo se muestra en la ETIQUETA del ítem («Hide Active Tool Window  ⇧⎋»).
 *
 * LOS ALIAS GLOBALES NO CABEN EN EL MENÚ
 * --------------------------------------
 * Un MenuItem tiene UN acelerador. El registro conserva alias (D1) como `⇧⌘F` (formatear), `⌘⇧U`
 * (diagrama ER) o `⌘K` (paleta) que chocan con el atajo de DataGrip del MISMO ítem: el ítem declara
 * el de DataGrip (`⌘⌥L`, `⌘⌥⇧U`, `⌘⇧A`) y el alias lo servirá el enrutador.
 *
 * Consecuencia asumida y medida en el código (no hace falta el enrutador para lo de dentro del
 * editor): `⇧⌘F` y `⌘⇧U` siguen funcionando DENTRO del editor SQL, porque su `runKeymap`
 * (`sql-editor.tsx`, que T4 migra al registro) los atiende hoy; lo que pierden es el menú, así que
 * FUERA del editor esos dos alias no hacen nada hasta que llegue el enrutador. `⌘K` no se queda sin
 * servir en ninguna parte: `command-palette.tsx` conserva su propio `keydown` a propósito (entre
 * tareas nadie borra nada que funcione) y el enrutador lo sustituirá después.
 *
 * Este archivo es TAMBIÉN lo que el test `menu-template.test.ts` recorre para comprobar que cada
 * acelerador del menú es `aAceleradorElectron` de su entrada del registro y que no hay dos ítems con
 * el mismo acelerador.
 */
import type { MenuItemConstructorOptions } from "electron";

import { type MenuAction, type MenuState } from "@/shared/menu-actions";
import { REGISTRO, aAceleradorElectron, type Entrada } from "@/shared/keymap";

// --------------------------------------------------------------------------------------------
// De acción de menú → entrada del registro (y a su acelerador de Electron)
// --------------------------------------------------------------------------------------------

/**
 * La entrada del registro que corresponde a una acción de menú. Como mucho hay una por acción (el
 * test lo comprueba), así que no hace falta desempate. Devuelve `undefined` para las acciones de
 * menú que R13 no cubre (ver `ACELERADORES_FUERA_DEL_REGISTRO`).
 */
export function entradaDeAccionDeMenu(action: string): Entrada | undefined {
  return REGISTRO.find((e) => e.accion.tipo === "menu" && e.accion.id === action);
}

/**
 * Las únicas acciones cuyo atajo NO lleva ⌘ pero que SÍ se enseñan en el menú (no se capturan). Hoy
 * sólo el Value Editor (`⇧⏎`, #97): el usuario de DataGrip lo busca ahí y verlo es información, no
 * un atajo que funcione desde el menú.
 */
export const ACCIONES_SOLO_MOSTRAR: readonly MenuAction[] = ["view.toolWindow.value"];

/**
 * Acciones de menú sin fila en el registro porque R13 no las cubre: son atajos propios de DataDB
 * (la tabla de la fase lista las acciones de DataGrip, no las de la app). Su acelerador se escribe
 * aquí a mano y el test lo sabe (no le exige que salga del registro). Si algún día una de estas
 * entra en el registro, se borra de aquí y pasa a salir del registro sola.
 */
export const ACELERADORES_FUERA_DEL_REGISTRO: Partial<Record<MenuAction, string>> = {
  // Guardar. DataGrip lo tiene en su keymap (⌘S), pero R13 no le da fila en la tabla de alcance.
  "file.saveQuery": "Cmd+S",
  // Text to SQL: atajo propio de DataDB (el asistente de IA no existe en DataGrip, D6).
  "ai.textToSql": "Shift+Cmd+Y",
};

/**
 * Acelerador que el menú nativo debe declarar para una acción, DERIVADO del registro único.
 *
 *   · Entrada de contexto `global` con ⌘  → su acelerador (el menú lo sirve de verdad).
 *   · `view.toolWindow.value`             → su acelerador, SÓLO para mostrarlo (excepción 1).
 *   · Cualquier otra (por foco, o global sin ⌘) → `undefined`: lo atiende el enrutador del renderer.
 *   · Acción fuera del registro            → `undefined` aquí; el llamador usa el override de
 *                                            `ACELERADORES_FUERA_DEL_REGISTRO`.
 */
export function aceleradorDeAccionDeMenu(action: MenuAction): string | undefined {
  const entrada = entradaDeAccionDeMenu(action);
  if (!entrada) return undefined;
  const esGlobalConCmd = entrada.contexto === "global" && entrada.tecla.mods.includes("Meta");
  if (!esGlobalConCmd && !ACCIONES_SOLO_MOSTRAR.includes(action)) return undefined;
  return aAceleradorElectron(entrada.tecla);
}

// --------------------------------------------------------------------------------------------
// Construcción del template
// --------------------------------------------------------------------------------------------

export interface OpcionesMenu {
  /** Estado publicado por el renderer; decide qué entradas van en gris (D8 de la fase 6). */
  estado: MenuState;
  /** `true` fuera de la app empaquetada (`!app.isPackaged`): añade recarga y DevTools (D4/D8). */
  dev: boolean;
  /** `app.getName()`: la etiqueta del primer menú. Se pasa para no importar Electron aquí. */
  appName: string;
  /** Manda la acción al renderer. `menu.ts` pasa el `webContents.send("menu:action", …)`. */
  emitir: (action: MenuAction) => void;
}

/**
 * Construye el template del menú nativo. Puro salvo `emitir` (que el llamador inyecta): el mismo
 * código sirve en Electron y en el test, que pasa un `emitir` que no hace nada.
 *
 * Cada ítem de la app lleva `id: action` (Electron lo admite en MenuItemConstructorOptions) para
 * que el test pueda recorrer el template y emparejar cada acelerador con su entrada del registro sin
 * ejecutar ningún `click`.
 */
export function construirTemplate({ estado, dev, appName, emitir }: OpcionesMenu): MenuItemConstructorOptions[] {
  const { connected, queryRunning, txManual, txActive, hasSql } = estado;

  // Ejecutar necesita sesión. Commit/Rollback, además, modo Manual y una transacción abierta.
  const puedeEjecutar = connected;
  const puedeCerrarTx = connected && txManual && txActive;

  /**
   * Entrada que dispara una acción de la app, con su acelerador tomado del registro.
   * `sinAcelerador` es para el caso de una MISMA acción que aparece en dos menús: un acelerador no
   * puede estar declarado dos veces (macOS acabaría mostrándolo en dos ítems y el menú no sabría
   * cuál es el canónico). Hoy sólo lo usa «AI Settings…», duplicado de «Settings…» del menú de la
   * app — que es el que conserva ⌘,.
   */
  const item = (
    label: string,
    action: MenuAction,
    opts: { enabled?: boolean; sinAcelerador?: boolean } = {}
  ): MenuItemConstructorOptions => ({
    id: action,
    label,
    // El registro manda; el override a mano sólo cubre lo que R13 no lista (documentado arriba).
    accelerator: opts.sinAcelerador
      ? undefined
      : aceleradorDeAccionDeMenu(action) ?? ACELERADORES_FUERA_DEL_REGISTRO[action],
    enabled: opts.enabled ?? true,
    click: () => emitir(action),
  });

  const appMenu: MenuItemConstructorOptions = {
    label: appName,
    submenu: [
      { role: "about" },
      { type: "separator" },
      item("Settings…", "ai.settings"),
      item("Appearance…", "view.appearance"),
      { type: "separator" },
      { role: "services" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      { type: "separator" },
      { role: "quit" },
    ],
  };

  const fileMenu: MenuItemConstructorOptions = {
    label: "File",
    submenu: [
      // ⌘⇧Q (New Query Console, #11) sale del registro. Antes estaba sin acelerador.
      item("New SQL Console", "file.newConsole"),
      item("New Connection…", "file.newConnection"),
      { type: "separator" },
      // ⌘S lo declara el menú: a partir de aquí la tecla la sirve macOS y NO llega al renderer.
      item("Save Query", "file.saveQuery", { enabled: hasSql }),
      { type: "separator" },
      item("Disconnect", "file.disconnect", { enabled: connected }),
      { role: "close" },
    ],
  };

  // OJO: los roles de este menú son los que hacen funcionar copiar/pegar/deshacer en TODA la app.
  // No sustituirlos por `click` propios (ver la cabecera de menu.ts).
  const editMenu: MenuItemConstructorOptions = {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "delete" },
      { role: "selectAll" },
      { type: "separator" },
      // ⌘⌥L (Reformat Code, #30) sale del registro. El alias viejo ⇧⌘F lo servirá el enrutador.
      item("Format SQL", "edit.formatSql", { enabled: hasSql }),
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      // Mostrar/toggle de tool windows (⌘1, ⌘2, ⌘8, ⌘⌥E — D6). «AI Assistant» no tiene fila en el
      // registro (DataGrip no le da atajo) y se queda sin acelerador.
      item("Database Explorer", "view.toolWindow.explorer"),
      item("Saved Queries", "view.toolWindow.saved"),
      item("AI Assistant", "view.toolWindow.ai"),
      item("Results", "view.toolWindow.results"),
      item("History", "view.toolWindow.history"),
      // ⇧⏎ (Open in Value Editor, #97): el ítem lo MUESTRA; en macOS no captura y lo ejecuta el
      // enrutador en la rejilla (excepción 1 de la cabecera).
      item("Value Editor", "view.toolWindow.value"),
      { type: "separator" },
      // ⌘⌥⇧U (Show Diagram, #6) sale del registro. El alias viejo ⌘⇧U lo servirá el enrutador.
      item("Show Diagram", "view.erDiagram"),
      // ⇧⎋ (Hide Active Tool Window, #87): sin acelerador (no lleva ⌘ y no se dispara desde el menú);
      // el atajo se enseña en la etiqueta y lo atiende el enrutador.
      item("Hide Active Tool Window  ⇧⎋", "view.hideToolWindow"),
      { type: "separator" },
      // ⌘⇧] / ⌘⇧[ (Select Next/Previous Tab, #68), con vuelta al principio/final (T6).
      item("Next Tab", "view.nextTab"),
      item("Previous Tab", "view.prevTab"),
      { type: "separator" },
      // ⌘⇧A (Find Action, #52). El alias ⌘K lo sirve todavía `command-palette.tsx` y, después, el enrutador.
      item("Command Palette…", "view.commandPalette"),
      { type: "separator" },
      // D4 de la fase 7 + D8 de la fase 15: recargar y las DevTools NO se le ofrecen al usuario final.
      // D8: en dev el rol Reload PIERDE ⌘R (si no, en `npm run dev` recarga la ventana en vez de
      // abrir el panel de búsqueda del editor, #54, y no se puede medir). Se le da un ⌘⇧R alternativo
      // en vez de dejarlo sin atajo para no perder el rol por completo.
      ...(dev
        ? ([
            { role: "reload", accelerator: "Shift+Cmd+R" },
            { role: "forceReload", accelerator: "Shift+Cmd+Alt+R" },
            { role: "toggleDevTools" },
            { type: "separator" },
          ] as MenuItemConstructorOptions[])
        : []),
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  };

  const queryMenu: MenuItemConstructorOptions = {
    label: "Query",
    submenu: [
      // ⌘⏎ (Execute, #1): global con ⌘, así que el menú lo sirve MIENTRAS el foco no lo consuma (el
      // editor lo hace con su keymap; en la rejilla lo hará el enrutador con Submit Changes, #96).
      item("Execute", "query.execute", { enabled: puedeEjecutar }),
      item("Execute All", "query.executeAll", { enabled: puedeEjecutar && hasSql }),
      // ⌘F2 (Cancel Running Statements, #3) sale del registro. Antes el ítem existía sin acelerador.
      item("Cancel", "query.cancel", { enabled: queryRunning }),
      { type: "separator" },
      // ⇧⌘J (Explain Plan): atajo de la app conservado por el PLAN (procedencia «—» en la tabla).
      item("Explain Plan", "query.explain", { enabled: puedeEjecutar }),
      { type: "separator" },
      // Marcadas con ✓ porque el modo de transacción es un estado, no una acción suelta. Llevan `id`
      // (como los demás ítems de acción) para que el test compruebe que no hay ninguna acción de
      // MENU_ACTIONS sin ítem en el menú.
      {
        id: "query.txAuto",
        label: "Auto-commit",
        type: "checkbox",
        checked: !txManual,
        enabled: connected,
        click: () => emitir("query.txAuto"),
      },
      {
        id: "query.txManual",
        label: "Manual Commit",
        type: "checkbox",
        checked: txManual,
        enabled: connected,
        click: () => emitir("query.txManual"),
      },
      { type: "separator" },
      item("Commit", "query.commit", { enabled: puedeCerrarTx }),
      item("Rollback", "query.rollback", { enabled: puedeCerrarTx }),
    ],
  };

  const aiMenu: MenuItemConstructorOptions = {
    label: "AI",
    submenu: [
      item("Text to SQL…", "ai.textToSql", { enabled: connected }),
      item("Explain Query", "ai.explainQuery", { enabled: connected }),
      item("Chat", "ai.chat"),
      { type: "separator" },
      // Duplicado a propósito del «Settings…» del menú de la app (el de arriba): este lleva al mismo
      // diálogo desde el menú AI, pero SIN acelerador — ⌘, ya lo declara el primero, y un mismo
      // acelerador en dos ítems es justo lo que el test prohíbe.
      item("AI Settings…", "ai.settings", { sinAcelerador: true }),
    ],
  };

  // Fase 15 (T3, D4): el menú Help que la fase 6 había dejado fuera a propósito (el comentario «D9»
  // de `menu.ts`). «Keyboard Shortcuts» abre la referencia generada del registro (T7).
  const helpMenu: MenuItemConstructorOptions = {
    label: "Help",
    role: "help",
    submenu: [item("Keyboard Shortcuts", "help.shortcuts")],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: "Window",
    role: "windowMenu",
  };

  return [appMenu, fileMenu, editMenu, viewMenu, queryMenu, aiMenu, helpMenu, windowMenu];
}
