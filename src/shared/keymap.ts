/**
 * ============================================================================
 * Fase 15 (R13) · Tarea T2 — el REGISTRO ÚNICO Y PURO de atajos de teclado
 * ============================================================================
 *
 * POR QUÉ UN REGISTRO ÚNICO (decisión D5 del PLAN de la fase)
 * ----------------------------------------------------------
 * Hoy los atajos de la app viven repartidos en CINCO sitios que no se hablan entre ellos (línea
 * base medida en el PLAN de la fase 15): los aceleradores del menú nativo (`electron/menu.ts`), el
 * `runKeymap` de CodeMirror (`src/components/sql-editor.tsx:57-115`), el `basicSetup` implícito de
 * `@uiw/react-codemirror` (que trae la mitad del keymap de búsqueda sin que nadie lo eligiera),
 * varios `keydown` sueltos en componentes (`results-grid.tsx`, `command-palette.tsx`,
 * `tool-window.tsx`, `sql-editor.tsx`, `value-editor-panel.tsx`, `editable-cell.tsx`) y la propia
 * documentación. Consecuencia real y medida: `⌘K` está declarado DOS veces, `⌘⏎` y `⇧⏎` pueden
 * ejecutar dos cosas a la vez, y una misma tecla significa cosas distintas según el foco sin que
 * exista un sitio donde eso esté escrito.
 *
 * Este archivo es ese sitio: la tabla del registro. El menú (T3), el keymap de CodeMirror (T4), el
 * enrutado por foco (T5) y la referencia Help ▸ «Atajos de teclado» (T7) LEEN de aquí en vez de
 * escribir teclas a mano. Se gana lo que R13 pide de verdad: que un atajo no pueda existir en dos
 * lugares con dos significados, y que esa propiedad sea TESTEABLE (`keymap.test.ts` comprueba que
 * no hay dos entradas con la misma tecla en el mismo contexto).
 *
 * PURO Y COMPARTIDO
 * -----------------
 * Sin React, sin Electron, sin DOM: es TypeScript de datos y funciones puras, así que lo puede
 * importar tanto el proceso `main` (para construir el menú en T3) como el renderer (para el keymap
 * del editor y para el diálogo de Help). No importa NADA (ni siquiera `./menu-actions`: la
 * comprobación de que las acciones de menú existen la hace el test), así que se puede cargar en
 * cualquier contexto sin arrastrar dependencias.
 *
 * EL CONTENIDO: EXACTAMENTE LAS TABLAS DE ALCANCE DEL PLAN
 * -------------------------------------------------------
 * Las cuatro tablas de «Alcance: la tabla del registro» del PLAN de la fase (Global, Editor SQL,
 * Rejilla de datos, Árbol de esquema) están volcadas aquí fila por fila. La `#` de cada entrada es
 * la de `research/datagrip-ux.md` §4 (`fila`), y `procedencia` reproduce la marca de esa
 * investigación: `"M"` = verificada literalmente en la página oficial *Predefined macOS keymap*,
 * `"D"` = acción de base de datos que la investigación trae convertida y **sin verificar contra un
 * DataGrip real** (es la marca que exige la decisión D2: la nota viaja al registro y a la
 * referencia), `"app"` = atajo propio de DataDB que DataGrip no tiene (en el PLAN aparece con «—»
 * de procedencia). Toda entrada `"M"`/`"D"` lleva `fila`; es un invariante testeado.
 *
 * UNA ENTRADA POR ATAJO
 * ---------------------
 * El PLAN escribe `{ id, accion, teclas, alias? }` en plural porque varias filas de DataGrip traen
 * DOS atajos en una sola celda (`⌘⇧]` / `⌘⇧[`, `⌥⇧↑` / `⌥⇧↓`, `⌘N` / `⌥⌦`, `⌘⌥↑` / `⌘⌥↓`,
 * `⌘G` / `⌘⇧G`). (El `⌥⌦` de `#101` **no era** la tecla de Delete Row en DataGrip: T8 la corrigió
 * a `⌘⌫` y quitó `⌥⌦` del registro — ver la SEGUNDA TRAMPA abajo.) Aquí se parte cada una en dos
 * entradas independientes — que es lo que pide la
 * propia tarea («una entrada por atajo») y lo que permite que cada una tenga su contexto, su alias
 * y su conteo —, así que el campo se llama `tecla` en singular. `alias` sigue siendo una lista:
 * son los atajos VIEJOS de la app que la decisión D1 conserva al lado del atajo de DataGrip.
 *
 * FORMA DE LA TECLA: OBJETO, NO CADENA (decisión de T2)
 * ----------------------------------------------------
 * `Tecla = { mods, key }`. Se descartó la cadena canónica parseable («Meta+Alt+L») porque obliga a
 * un parser y a una convención de escapado (¿cómo se escribe la tecla `+`? ¿`Plus` o `+`?) y a un
 * `parsear` con su propio test; con el objeto, el modificador y la tecla nunca se confunden (no hay
 * que adivinar si el último tramo es modificador o tecla) y los tres conversores son una
 * proyección directa sin estado. `key` se guarda YA normalizada a la forma de CodeMirror/dom
 * («L» mayúscula, «Enter», «Escape», «Backspace», «Delete», «ArrowUp»…«ArrowRight», «F1»-«F24»,
 * «Space», y la puntuación literal «/» «[» «]» «,»): una sola forma de nombrar cada tecla para los
 * tres formatos de salida.
 *
 * ORDEN DE LOS MODIFICADORES (y una inconsistencia que se reporta)
 * ----------------------------------------------------------------
 * Cada formato tiene su orden canónico, fijado aquí para que las cadenas generadas sean
 * deterministas y comparables:
 *
 *   · Texto para mostrar / ⌘⌥⇧ : orden de **DataGrip** `⌘ ⌃ ⌥ ⇧` (Meta, Ctrl, Alt, Shift).
 *     Es el orden con el que están escritos TODOS los atajos del PLAN y de `datagrip-ux.md` §4
 *     (`⌘⌥⇧U` #6, `⌘⇧Q` #11, `⌘⌃G` #43, `⌥⇧↑` #41, `⌃⌥Space` #26), y el de los ejemplos de esta
 *     tarea (`⌘F2`). La propuesta de T2 decía «orden de símbolos de macOS: ⌃ ⌥ ⇧ ⌘», que es el
 *     orden que recomienda la HIG de Apple (`⌃⌥⇧⌘`); NO se usa porque con él `⌘⌥L` saldría `⌥⌘L`
 *     y `⌘⌥⇧U` saldría `⌥⇧⌘U`, rompiendo la comparación de la referencia (T8) contra las tablas de
 *     la investigación. Queda reportado como inconsistencia.
 *
 *     (TRAMPA 2026-10-13: en `keymaps/$default.xml` de DataGrip el modificador `control` es **⌘** en
 *      macOS y `meta` es **⌃** — al revés de lo que parece. Leerlos en crudo da el atajo equivocado:
 *      `control alt L` es **⌥⌘L**, no `⌃⌥L`. El oráculo es el MENÚ de la app viva, no el XML:
 *      `AXMenuItemCmdChar` + `AXMenuItemCmdModifiers`. Ver `research/rea-datagrip.md` §5.1.)
 *
 *     (SEGUNDA TRAMPA, T8 2026-10-13: el keymap activo `Mac OS X 10.5+.xml` PISA lo que hereda de
 *      `$default.xml`. `Refresh` hereda `control F5` pero el mac lo declara `meta R` → el Refresh de
 *      DataGrip es **⌘R** y **⌘F5 no está asignado a nada**; y **⌥⌦** NO es Delete Row (es
 *      `EditorDeleteToWordEnd`): Delete Rows toma prestado `EditorDeleteLine` = **⌘⌫**. Auditoría
 *      completa, con las citas `archivo:línea`: `.planning/phases/phase-15/T8-oraculo.md` §5.)
 *   · Acelerador de Electron : `⇧ ⌘ ⌃ ⌥` (Shift, Cmd, Ctrl, Alt) — la convención que ya usa
 *     `electron/menu.ts` hoy («Shift+Cmd+F», «Shift+Cmd+J», «Cmd+Return», «Cmd+S»), para que T3
 *     sustituya aceleradores escritos a mano por los generados aquí sin que el menú cambie de
 *     texto. (Electron trata el acelerador como case-insensitive y el orden es indiferente; el
 *     ejemplo «Cmd+Shift+]» de la tarea implica el orden contrario — ambos son válidos.)
 *   · Tecla de CodeMirror : `Mod ⌃ ⌥ ⇧` (Mod, Ctrl, Alt, Shift). `Mod` es el alias de CodeMirror
 *     para ⌘ en macOS, el mismo que ya usa `sql-editor.tsx` («Mod-Shift-f»).
 *
 * QUÉ NO ES ESTO (todavía)
 * ------------------------
 * T2 es SOLO el registro. No construye el menú (T3), no genera el keymap de CodeMirror (T4), no
 * enruta nada por foco (T5) y no dibuja la referencia (T7). Este archivo no importa a nadie: es
 * quien importa.
 *
 * D1 — EN UN CHOQUE GANA EL ATAJO DE DATAGRIP
 * -------------------------------------------
 * Cuando el atajo de la app y el de DataGrip chocan, `tecla` es el de DataGrip y el viejo se
 * conserva en `alias` SOLO si no choca con otro atajo de DataGrip que la app use. Por eso quedan
 * como alias `⇧⌘F` (formatear), `⌘⇧U` (diagrama ER) y `⌘K` (paleta) — Find in Files, Toggle Case y
 * Commit no existen en la app —, y por eso `⌘D` y `⌥↑` del editor NO conservan su significado
 * viejo: la tecla pasa a ser duplicar línea (#34) y ampliar selección (#39). El invariante «ningún
 * alias coincide con la tecla principal de otra entrada» es lo que hace cumplir D1 de verdad.
 */

// --------------------------------------------------------------------------------------------
// Tipos
// --------------------------------------------------------------------------------------------

/** Los cuatro modificadores. `Meta` es ⌘, `Alt` es ⌥, `Shift` es ⇧, `Ctrl` es ⌃. */
export type Mod = "Meta" | "Alt" | "Shift" | "Ctrl";

/**
 * Una tecla pulsada, en forma propia y neutra: modificadores + tecla normalizada.
 * `key` usa siempre la forma de CodeMirror/dom («Enter», «Escape», «Backspace», «Delete»,
 * «ArrowUp»…«ArrowRight», «F1»-«F24», «Space», letras en mayúscula, puntuación literal).
 */
export interface Tecla {
  mods: Mod[];
  key: string;
}

/** Dónde vale un atajo. El foco lo decide T5 (`contextoDeFoco`); aquí solo se declara. */
export type Contexto = "global" | "editor" | "rejilla" | "arbol";

/**
 * Qué hace un atajo, con el camino que T3-T6 van a cablear:
 *
 *  · `"menu"`       → `id` es una acción del menú nativo: una de `MENU_ACTIONS` (fase 6) o una de
 *                     `ACCIONES_MENU_NUEVAS` (las que este registro declara y que T3 debe añadir).
 *  · `"codemirror"` → `comando` es el nombre de un comando de CodeMirror (`toggleComment`,
 *                     `startCompletion`, `openSearchPanel`…). T4 los mete en el keymap del editor.
 *  · `"app"`        → `id` es una acción de la app fuera del menú nativo (rejilla y árbol: `grid.*`,
 *                     `tree.*`), que T5/T6 cablean donde ya vive su manejador.
 */
export type Accion =
  | { tipo: "menu"; id: string }
  | { tipo: "codemirror"; comando: string }
  | { tipo: "app"; id: string };

/**
 * Procedencia del atajo: `"M"` / `"D"` son las marcas de `research/datagrip-ux.md` §4 (`"D"` lleva
 * además implícita la marca de la decisión D2: «convertida, sin verificar en un DataGrip real»);
 * `"app"` es un atajo propio de DataDB que DataGrip no tiene (en el PLAN aparece con «—»).
 */
export type Procedencia = "M" | "D" | "app";

/** Una fila del registro. */
export interface Entrada {
  /** Id estable y único del atajo (el vocabulario de DataGrip, camelCase). Lo usan T3-T7. */
  id: string;
  /** Nombre de la acción como en DataGrip (el menú va en inglés, D1 de la fase 6). */
  nombre: string;
  /** Qué dispara. */
  accion: Accion;
  /** El atajo principal: el de DataGrip cuando hay choque (D1). */
  tecla: Tecla;
  /** Atajos viejos de la app que se conservan al lado (D1). Nunca chocan con otro principal. */
  alias?: Tecla[];
  /** Dónde vale. */
  contexto: Contexto;
  /** Marca de la investigación. */
  procedencia: Procedencia;
  /** La `#` de `research/datagrip-ux.md` §4. Obligatoria en `"M"`/`"D"` (invariante testeado). */
  fila?: number;
  /**
   * La MISMA tecla hace otra cosa en otro contexto (`⌘⏎`, `⇧⏎`, `⌘⌥↑`/`⌘⌥↓`…). Solo las entradas
   * marcadas así pueden compartir tecla con el contexto `global` (invariante testeado), porque son
   * las que T5 resuelve por foco.
   */
  porFoco?: true;
  /** Aclaraciones: choques de hoy, decisiones D1-D8, marcas de D2. */
  nota?: string;
}

// --------------------------------------------------------------------------------------------
// Orden canónico de los modificadores y fábrica de teclas
// --------------------------------------------------------------------------------------------

/** Orden de DataGrip `⌘ ⌃ ⌥ ⇧` (ver la cabecera). Es el que usan `huellaTecla` y el texto de macOS. */
const ORDEN_MODS: readonly Mod[] = ["Meta", "Ctrl", "Alt", "Shift"];

/**
 * Deja los modificadores en el orden canónico y sin repetidos, para que `{Meta, Alt}` y
 * `{Alt, Meta}` sean la MISMA tecla (los invariantes de duplicados dependen de esto).
 */
function normalizarMods(mods: readonly Mod[]): Mod[] {
  const vistos = new Set<Mod>();
  for (const m of mods) vistos.add(m);
  return ORDEN_MODS.filter((m) => vistos.has(m));
}

/** Fábrica de teclas para no repetir objetos y normalizar los modificadores de una vez. */
function atajo(key: string, ...mods: Mod[]): Tecla {
  return { mods: normalizarMods(mods), key };
}

/**
 * Huella comparable de una tecla. Es la unidad con la que los tests detectan duplicados: dos
 * `Tecla` son la misma si tienen la misma huella, sin importar cómo se escribieron.
 */
export function huellaTecla(t: Tecla): string {
  return `${normalizarMods(t.mods).join("+")}/${t.key}`;
}

/** ¿Son la misma tecla? (ignora el orden en que se escribieron los modificadores). */
export function mismaTecla(a: Tecla, b: Tecla): boolean {
  return huellaTecla(a) === huellaTecla(b);
}

// --------------------------------------------------------------------------------------------
// Acciones que T3 debe añadir y acciones de app (fuera del menú nativo)
// --------------------------------------------------------------------------------------------

/**
 * ACCIONES NUEVAS QUE T3 DEBE AÑADIR A `MENU_ACTIONS` (no se toca `menu-actions.ts` aquí).
 *
 * El PLAN prevé cuatro acciones de menú que todavía NO existen en `MENU_ACTIONS` (fase 6). Se
 * declaran aquí con id estable y `procedencia` de la fila de DataGrip correspondiente; T3 las añade
 * a la lista cerrada y a su despachador (`src/hooks/use-menu-actions.ts`, que es un
 * `Record<MenuAction, …>` y por tanto fallará en compilación en cuanto falte una — que es
 * justamente la red de seguridad que se busca).
 *
 *  · `view.erDiagram`      — Show Diagram (#6, ⌘⌥⇧U). Hoy el diagrama ER se abre por un evento del
 *                            editor (`cm-open-er-diagram`), no desde el menú.
 *  · `view.hideToolWindow` — Hide Active Tool Window (#87, ⇧⎋). El store de layout tiene
 *                            `hideToolWindow(id)` pero no «oculta la activa».
 *  · `view.nextTab`        — Select Next Tab (#68, ⌘⇧]). No existe acción de pestaña siguiente.
 *  · `view.prevTab`        — Select Previous Tab (#68, ⌘⇧[). Ídem, anterior.
 */
export const ACCIONES_MENU_NUEVAS: readonly string[] = [
  "view.erDiagram",
  "view.hideToolWindow",
  "view.nextTab",
  "view.prevTab",
];

/**
 * Acciones de la app que NO pasan por el menú nativo (rejilla y árbol). Los ids imitan el nombre
 * del manejador real que ya existe en `results-grid.tsx` / el explorador, para que T5/T6 las
 * cableen sin inventar un vocabulario nuevo. Testeado: toda `accion` de tipo `"app"` está aquí.
 */
export const ACCIONES_APP: readonly string[] = [
  "grid.confirmChanges", // #96 Submit Changes → botón «Guardar» (results-grid.tsx)
  "grid.addRow", // #101 Add Row → «Agregar fila» (addRow)
  "grid.deleteSelected", // #101 Delete Row → «Borrar selección» (deleteSelected)
  "grid.duplicateSelected", // — Clone Row → «Duplicar selección» (duplicateSelected)
  "grid.prevPage", // #103 Previous Page → onPrevPage
  "grid.nextPage", // #103 Next Page → onNextPage
  "grid.navigateFk", // #105 Related Rows → onNavigateFk («Ir a la referenciada»)
  "grid.refresh", // #18 Refresh (en la rejilla) → re-ejecutar la consulta (fase 15, T5)
  "tree.refresh", // #18 Refresh → refrescar el explorador
];

// --------------------------------------------------------------------------------------------
// El registro. Una entrada por atajo, con las filas de las tablas de alcance del PLAN.
// --------------------------------------------------------------------------------------------

export const REGISTRO: readonly Entrada[] = [
  // ==========================================================================================
  // GLOBAL — tabla «Global» del PLAN. Los 15 atajos que valen en cualquier parte de la ventana.
  // ==========================================================================================
  {
    id: "execute",
    nombre: "Execute",
    accion: { tipo: "menu", id: "query.execute" },
    tecla: atajo("Enter", "Meta"),
    contexto: "global",
    procedencia: "D",
    fila: 1,
    // Ejecuta lo que hay bajo el caret. En la rejilla la MISMA tecla envía los cambios (#96), por
    // eso va marcada por foco: son las dos entradas que T5 tiene que separar.
    porFoco: true,
    nota: "En el editor; en la rejilla es Submit Changes (#96). El atajo lo sirve hoy el menú.",
  },
  {
    id: "cancelRunningStatements",
    nombre: "Cancel Running Statements",
    accion: { tipo: "menu", id: "query.cancel" },
    tecla: atajo("F2", "Meta"),
    contexto: "global",
    procedencia: "D",
    fila: 3,
    nota: "Hoy sin atajo: el ítem «Cancel» del menú existe pero no tiene acelerador.",
  },
  {
    id: "newQueryConsole",
    nombre: "New Query Console",
    accion: { tipo: "menu", id: "file.newConsole" },
    tecla: atajo("Q", "Meta", "Shift"),
    contexto: "global",
    procedencia: "D",
    fila: 11,
    nota: "Hoy sin atajo: «New SQL Console» está en el menú File sin acelerador.",
  },
  {
    id: "showDiagram",
    nombre: "Show Diagram",
    accion: { tipo: "menu", id: "view.erDiagram" },
    tecla: atajo("U", "Meta", "Alt", "Shift"),
    alias: [atajo("U", "Meta", "Shift")],
    contexto: "global",
    procedencia: "D",
    fila: 6,
    nota: "D1: `⌘⇧U` era el atajo de la app y se conserva como alias; Toggle Case (#38) no existe aquí. Acción nueva `view.erDiagram` (ver ACCIONES_MENU_NUEVAS).",
  },
  {
    id: "browseQueryHistory",
    nombre: "Browse Query History",
    accion: { tipo: "menu", id: "view.toolWindow.history" },
    tecla: atajo("E", "Meta", "Alt"),
    contexto: "global",
    procedencia: "D",
    fila: 8,
    nota: "D6: la tool window de DataGrip «Browse Query History» es el Historial de la app.",
  },
  {
    id: "findAction",
    nombre: "Find Action…",
    accion: { tipo: "menu", id: "view.commandPalette" },
    tecla: atajo("A", "Meta", "Shift"),
    alias: [atajo("K", "Meta")],
    contexto: "global",
    procedencia: "M",
    fila: 52,
    nota: "D1: `⌘K` (paleta de comandos) se conserva como alias; en DataGrip `⌘K` es Commit (VCS), que la app no tiene. Ojo: `command-palette.tsx:25` lo repite — T3 lo borra si el menú ya lo sirve (T1).",
  },
  {
    id: "settings",
    nombre: "Settings…",
    accion: { tipo: "menu", id: "ai.settings" },
    tecla: atajo(",", "Meta"),
    contexto: "global",
    procedencia: "M",
    fila: 79,
    nota: "Hoy abre los ajustes de IA (es lo único que hay detrás de «Settings…», D9 de la fase 6).",
  },
  {
    id: "showDatabaseExplorer",
    nombre: "Show Database Explorer",
    accion: { tipo: "menu", id: "view.toolWindow.explorer" },
    tecla: atajo("1", "Meta"),
    contexto: "global",
    procedencia: "M",
    fila: 80,
    nota: "D6: `⌘1` → Database Explorer de la app. Hoy sin atajo.",
  },
  {
    id: "showFilesWindow",
    nombre: "Show Files window",
    accion: { tipo: "menu", id: "view.toolWindow.saved" },
    tecla: atajo("2", "Meta"),
    contexto: "global",
    procedencia: "M",
    fila: 81,
    nota: "D6: el «Files» de DataGrip (donde se guardan las consolas) es «Consultas guardadas».",
  },
  {
    id: "showServicesWindow",
    nombre: "Show Services window",
    accion: { tipo: "menu", id: "view.toolWindow.results" },
    tecla: atajo("8", "Meta"),
    contexto: "global",
    procedencia: "M",
    fila: 85,
    nota: "D6: el «Services» de DataGrip (Output/Result) es la tool window de Resultados.",
  },
  {
    id: "hideActiveToolWindow",
    nombre: "Hide Active Tool Window",
    accion: { tipo: "menu", id: "view.hideToolWindow" },
    tecla: atajo("Escape", "Shift"),
    contexto: "global",
    procedencia: "M",
    fila: 87,
    nota: "Hoy sólo `⎋` (tool-window.tsx:252). Acción nueva `view.hideToolWindow` (ver ACCIONES_MENU_NUEVAS).",
  },
  {
    id: "selectNextTab",
    nombre: "Select Next Tab",
    accion: { tipo: "menu", id: "view.nextTab" },
    tecla: atajo("]", "Meta", "Shift"),
    contexto: "global",
    procedencia: "M",
    fila: 68,
    nota: "El PLAN parte la fila #68 (trae `⌘⇧]` y `⌘⇧[`). Hoy no hay acción de pestaña siguiente; la crea T6/`view.nextTab`.",
  },
  {
    id: "selectPreviousTab",
    nombre: "Select Previous Tab",
    accion: { tipo: "menu", id: "view.prevTab" },
    tecla: atajo("[", "Meta", "Shift"),
    contexto: "global",
    procedencia: "M",
    fila: 68,
    nota: "La otra mitad de la fila #68. La vuelta al principio la decide T6.",
  },
  {
    id: "reformatCode",
    nombre: "Reformat Code",
    accion: { tipo: "menu", id: "edit.formatSql" },
    tecla: atajo("L", "Meta", "Alt"),
    alias: [atajo("F", "Meta", "Shift")],
    contexto: "global",
    procedencia: "M",
    fila: 30,
    nota: "CHOQUE resuelto por D1: `⇧⌘F` (formatear) queda como alias; `⇧⌘F` de DataGrip es Find in Files (#55, fuera de la fase por D3). NO CAMBIAR a `⌃⌥L`: el 2026-10-13 se intentó «corregir» a `⌃⌥L` leyendo `keymaps/$default.xml` en crudo y era FALSO — en ese archivo `control` es ⌘ en macOS y `meta` es ⌃, así que `control alt L` es ⌥⌘L, que es lo que este registro declara. El menú de la app viva lo confirma (`Reformat Code` → `AXMenuItemCmdChar=L`, `CmdModifiers=2` = ⌥ + ⌘). Trampa y oráculo: `research/rea-datagrip.md` §5.1.",
  },
  {
    id: "explainPlan",
    nombre: "Explain Plan",
    accion: { tipo: "menu", id: "query.explain" },
    tecla: atajo("J", "Meta", "Shift"),
    contexto: "global",
    procedencia: "app",
    nota: "El PLAN lo lista con «—» de procedencia: DataGrip no le da atajo por defecto (`Console.Jdbc.ExplainPlan` no declara ninguno y su menú lo muestra sin acelerador), así que se conserva el de la app. T8 (§5.3 de T8-oraculo.md): `⇧⌘J` SÍ choca con «Scratch Query File» (`Jdbc.OpenConsole.Scratch`, `database-plugin.jar` META-INF/plugin.xml, `keymap=\"Mac OS X 10.5+\"`), pero esa acción no existe en DataDB: mismo precedente que el alias `⇧⌘F` de `reformatCode` (Find in Files tampoco existe). Se conserva a sabiendas.",
  },
  // ==========================================================================================
  // EDITOR SQL — tabla «Editor SQL» del PLAN. 16 entradas; `accion` es un COMANDO de CodeMirror
  // (los nombres son los reales de `@codemirror/commands`, `@codemirror/search` y
  // `@codemirror/autocomplete`, comprobados contra sus .d.ts).
  // ==========================================================================================
  {
    id: "basicCompletion",
    nombre: "Basic Completion",
    accion: { tipo: "codemirror", comando: "startCompletion" },
    tecla: atajo("Space", "Ctrl"),
    contexto: "editor",
    procedencia: "M",
    fila: 25,
    nota: "Ya funciona: lo trae la extension de autocompletado del editor.",
  },
  {
    id: "commentLine",
    nombre: "Comment with Line Comment",
    accion: { tipo: "codemirror", comando: "toggleComment" },
    tecla: atajo("/", "Meta"),
    contexto: "editor",
    procedencia: "M",
    fila: 32,
  },
  {
    id: "commentBlock",
    nombre: "Comment with Block Comment",
    accion: { tipo: "codemirror", comando: "toggleBlockComment" },
    tecla: atajo("/", "Meta", "Alt"),
    alias: [atajo("A", "Alt")],
    contexto: "editor",
    procedencia: "M",
    fila: 33,
    nota: "D1: `⌥A` se conserva como alias, pero en un teclado de macOS `⌥A` escribe «å»: por eso el atajo de DataGrip es el principal.",
  },
  {
    id: "duplicateLine",
    nombre: "Duplicate Line or Selection",
    accion: { tipo: "codemirror", comando: "copyLineDown" },
    tecla: atajo("D", "Meta"),
    contexto: "editor",
    procedencia: "M",
    fila: 34,
    nota: "D1: `⌘D` del editor PIERDE su significado viejo («siguiente coincidencia», que venía del basicSetup). Pasa a duplicar línea. La siguiente coincidencia se muda a `⌃G` (#42).",
  },
  {
    id: "deleteLine",
    nombre: "Delete Line",
    accion: { tipo: "codemirror", comando: "deleteLine" },
    tecla: atajo("Backspace", "Meta"),
    alias: [atajo("K", "Meta", "Shift")],
    contexto: "editor",
    procedencia: "M",
    fila: 35,
    nota: "D1/D2: `⌘⌫` de la app («borrar hasta el inicio de línea») se pierde; `⌘⌫` pasa a borrar la línea. `⇧⌘K` es alias de la app.",
  },
  {
    id: "startNewLine",
    nombre: "Start New Line",
    accion: { tipo: "codemirror", comando: "insertBlankLine" },
    tecla: atajo("Enter", "Shift"),
    contexto: "editor",
    procedencia: "M",
    fila: 37,
    // SOSPECHA MEDIDA EN T1: hoy el `⇧⏎` del Value Editor (acelerador del menú) se come este.
    porFoco: true,
    nota: "Sospecha a medir (T1): el `⇧⏎` del menú (Value Editor) captura siempre en macOS y deja este sin llegar. Por foco con la rejilla (#97).",
  },
  {
    id: "extendSelection",
    nombre: "Extend Selection",
    accion: { tipo: "codemirror", comando: "selectParentSyntax" },
    tecla: atajo("ArrowUp", "Alt"),
    contexto: "editor",
    procedencia: "M",
    fila: 39,
    nota: "D7: el par `⌥↓` (Shrink Selection) queda sin acción y sin alias: encoger la selección no existe y un par asimétrico confunde más que ayuda.",
  },
  {
    id: "moveLineUp",
    nombre: "Move Line Up",
    accion: { tipo: "codemirror", comando: "moveLineUp" },
    tecla: atajo("ArrowUp", "Alt", "Shift"),
    contexto: "editor",
    procedencia: "M",
    fila: 41,
    nota: "Hoy la app mueve la línea con `⌥↑`; esa tecla pasa a Extend Selection (#39).",
  },
  {
    id: "moveLineDown",
    nombre: "Move Line Down",
    accion: { tipo: "codemirror", comando: "moveLineDown" },
    tecla: atajo("ArrowDown", "Alt", "Shift"),
    contexto: "editor",
    procedencia: "M",
    fila: 41,
  },
  {
    id: "addSelectionNextOccurrence",
    nombre: "Add Selection for Next Occurrence",
    accion: { tipo: "codemirror", comando: "selectNextOccurrence" },
    tecla: atajo("G", "Ctrl"),
    contexto: "editor",
    procedencia: "M",
    fila: 42,
    nota: "Hoy en `⌘D` (lo trae el basicSetup). `⌃G` NO choca con `⌘G` (Find Next, #57).",
  },
  {
    id: "selectAllOccurrences",
    nombre: "Select All Occurrences",
    accion: { tipo: "codemirror", comando: "selectSelectionMatches" },
    tecla: atajo("G", "Meta", "Ctrl"),
    alias: [atajo("L", "Meta", "Shift")],
    contexto: "editor",
    procedencia: "M",
    fila: 43,
    nota: "D1: `⇧⌘L` (que es lo que usa el `searchKeymap` de CodeMirror para lo mismo) se conserva como alias.",
  },
  {
    id: "find",
    nombre: "Find…",
    accion: { tipo: "codemirror", comando: "openSearchPanel" },
    tecla: atajo("F", "Meta"),
    contexto: "editor",
    procedencia: "M",
    fila: 53,
    nota: "Ya funciona: lo trae el basicSetup por defecto de @uiw/react-codemirror (T4 lo hará explícito).",
  },
  {
    id: "replace",
    nombre: "Replace…",
    accion: { tipo: "codemirror", comando: "openReplacePanel" },
    tecla: atajo("R", "Meta"),
    contexto: "editor",
    procedencia: "M",
    fila: 54,
    nota: "D8: en `npm run dev` `⌘R` recarga la ventana (rol Reload); la fase le quita ese atajo para que se pueda abrir Reemplazar. Spike F2: la barra propia abre su segunda fila (`openReplacePanel`), que es lo que hacía el panel de CodeMirror con su campo de reemplazo.",
  },
  {
    id: "findNext",
    nombre: "Find Next",
    accion: { tipo: "codemirror", comando: "findNext" },
    tecla: atajo("G", "Meta"),
    contexto: "editor",
    procedencia: "M",
    fila: 57,
  },
  {
    id: "findPrevious",
    nombre: "Find Previous",
    accion: { tipo: "codemirror", comando: "findPrevious" },
    tecla: atajo("G", "Meta", "Shift"),
    contexto: "editor",
    procedencia: "M",
    fila: 57,
  },
  {
    id: "gotoLine",
    nombre: "Go to Line/Column…",
    accion: { tipo: "codemirror", comando: "gotoLine" },
    tecla: atajo("L", "Meta"),
    alias: [atajo("G", "Meta", "Alt")],
    contexto: "editor",
    procedencia: "M",
    fila: 61,
    nota: "D1/el PLAN autorizan `⌘⌥G` como alias (era el atajo de la app). En DataGrip `⌘⌥G` es SQL Generator (#9), que la app no implementa.",
  },
  // ==========================================================================================
  // REJILLA DE DATOS — tabla «Rejilla de datos» del PLAN. 8 entradas. `accion` es de app salvo
  // `⇧⏎`, que abre la tool window del value editor (acción de menú, #97).
  // ==========================================================================================
  {
    id: "submitChanges",
    nombre: "Submit Changes",
    accion: { tipo: "app", id: "grid.confirmChanges" },
    tecla: atajo("Enter", "Meta"),
    contexto: "rejilla",
    procedencia: "D",
    fila: 96,
    porFoco: true,
    nota: "CHOQUE por foco: en el editor `⌘⏎` ejecuta (query.execute, global). En la rejilla envía los cambios pendientes («Guardar»). Hoy la rejilla NO lo tiene.",
  },
  {
    id: "openInValueEditor",
    nombre: "Open in Value Editor",
    accion: { tipo: "menu", id: "view.toolWindow.value" },
    tecla: atajo("Enter", "Shift"),
    contexto: "rejilla",
    procedencia: "D",
    fila: 97,
    porFoco: true,
    nota: "El PLAN marca «✓ ya (global)»: hoy es un acelerador del menú (`Shift+Enter` en menu.ts:122), que en macOS captura SIEMPRE. Por foco con Start New Line (#37) del editor.",
  },
  {
    id: "addRow",
    nombre: "Add Row",
    accion: { tipo: "app", id: "grid.addRow" },
    tecla: atajo("N", "Meta"),
    contexto: "rejilla",
    procedencia: "D",
    fila: 101,
    nota: "El PLAN parte la fila #101 (`⌘N` / `⌥⌦`). Hoy sólo hay botón «Agregar».",
  },
  {
    id: "deleteRow",
    nombre: "Delete Row",
    accion: { tipo: "app", id: "grid.deleteSelected" },
    tecla: atajo("Backspace", "Meta"),
    // D1 + T8 (§5.1): la tecla de DataGrip para Delete Rows es `⌘⌫`
    // (`Console.TableResult.DeleteRows` toma prestado `EditorDeleteLine` en `product.jar`, y en el
    // keymap activo es `meta BACK_SPACE`, `Mac OS X 10.5+.xml:366`). Los atajos de hoy (`⌫` y
    // `Delete` a secas, results-grid.tsx:505) se conservan como alias: no chocan con ninguna tecla
    // principal del registro. `⌥⌦` se ELIMINA de la entrada: en DataGrip es `EditorDeleteToWordEnd`
    // (borrar hasta el final de la palabra) y conservarlo enseñaría un hábito que no es de DataGrip.
    alias: [atajo("Backspace"), atajo("Delete")],
    contexto: "rejilla",
    procedencia: "D",
    fila: 101,
    nota: "T8 (§5.1 de T8-oraculo.md): la tecla de DataGrip es `⌘⌫`, la de `EditorDeleteLine` que `Console.TableResult.DeleteRows` toma prestada. Alias `⌫` y `Delete`, los de hoy; `⌥⌦` se eliminó (en DataGrip es borrar hasta el final de la palabra, no Delete Row). Comparte tecla con `deleteLine` del editor (#35), contexto distinto: el enrutador decide por el foco, igual que con `⌘D` (#34/#Clone Row).",
  },
  {
    id: "previousPage",
    nombre: "Previous Page",
    accion: { tipo: "app", id: "grid.prevPage" },
    tecla: atajo("ArrowUp", "Meta", "Alt"),
    contexto: "rejilla",
    procedencia: "D",
    fila: 103,
    porFoco: true,
    nota: "Por foco: en el editor `⌘⌥↑` es (en DataGrip) cursor extra; en la rejilla, página anterior.",
  },
  {
    id: "nextPage",
    nombre: "Next Page",
    accion: { tipo: "app", id: "grid.nextPage" },
    tecla: atajo("ArrowDown", "Meta", "Alt"),
    contexto: "rejilla",
    procedencia: "D",
    fila: 103,
    porFoco: true,
  },
  {
    id: "relatedRows",
    nombre: "Related Rows (FK)",
    accion: { tipo: "app", id: "grid.navigateFk" },
    tecla: atajo("F4"),
    contexto: "rejilla",
    procedencia: "D",
    fila: 105,
    nota: "Hoy sólo en el menú contextual de la celda («Ir a la referenciada»).",
  },
  {
    id: "cloneRow",
    nombre: "Clone Row",
    accion: { tipo: "app", id: "grid.duplicateSelected" },
    tecla: atajo("D", "Meta"),
    contexto: "rejilla",
    procedencia: "app",
    nota: "El PLAN lo lista con «—»: es el `⌘D` de la app («Duplicar» filas marcadas) y se conserva. Contexto distinto del `⌘D` del editor (#34), así que no choca.",
  },
  {
    id: "refreshGrid",
    nombre: "Refresh (re-ejecutar la consulta)",
    accion: { tipo: "app", id: "grid.refresh" },
    tecla: atajo("R", "Meta"),
    // D1: `⌘F5` era el atajo del registro y se conserva como alias. No choca con nada del keymap
    // activo de DataGrip: `Refresh` y `Rerun` heredan `control F5` de `$default.xml:1034/1038`
    // pero el mac los PISA — los dos quedan `meta R` (`Mac OS X 10.5+.xml:312` y `:318`) —, así
    // que `⌘F5` no está asignado a nada (T8-oraculo.md §5.1).
    alias: [atajo("F5", "Meta")],
    contexto: "rejilla",
    procedencia: "D",
    fila: 18,
    // Fase 15, T5: la entrada que T2 dejó fuera y que el PLAN pidió recuperar. La fila #18 de la
    // tabla del árbol dice «en la rejilla, re-ejecutar su consulta», y la decisión «sobre lo que
    // reportó T2» (§1) la cierra como entrada propia de la rejilla con la misma tecla (porFoco).
    // Fase 15, T8 (§5.1): la tecla pasa de `⌘F5` a `⌘R`, que es el Refresh real de DataGrip
    // (`Mac OS X 10.5+.xml:312`, `<action id="Refresh"><keyboard-shortcut first-keystroke="meta R"/>`;
    // y `Console.TableResult.Reload` —«Reload Page»— lo toma prestado en `product.jar`). Aquí
    // `onRefresh` vuelve a lanzar la consulta de ESA rejilla (la de la consola o la de la tabla).
    porFoco: true,
    nota: "T8 (§5.1 de T8-oraculo.md): la tecla de DataGrip es `⌘R`; `⌘F5` (el registro viejo, que aplicaba la regla al `control F5` heredado que el mac pisa) queda como alias. Misma tecla que el árbol (#18) y que `replace` del editor (#54): el enrutador (T5) decide por el foco.",
  },

  // ==========================================================================================
  // ÁRBOL DE ESQUEMA — tabla «Árbol de esquema» del PLAN. Una sola fila.
  // ==========================================================================================
  {
    id: "refresh",
    nombre: "Refresh",
    accion: { tipo: "app", id: "tree.refresh" },
    tecla: atajo("R", "Meta"),
    // D1: `⌘F5` era el atajo del registro y se conserva como alias (el mac pisa el `control F5`
    // heredado; ver la nota). No choca con ninguna tecla principal del registro.
    alias: [atajo("F5", "Meta")],
    contexto: "arbol",
    procedencia: "D",
    fila: 18,
    nota: "T8 (§5.1 de T8-oraculo.md): la tecla de DataGrip es `⌘R` (`Mac OS X 10.5+.xml:312` declara `Refresh` como `meta R` y PISA el `control F5` heredado de `$default.xml:1034`; `⌘F5` no está asignado a nada en la instalación). Hoy sólo hay botón. El PLAN anota además que «en la rejilla, ⌘R re-ejecuta su consulta»: esa mitad se registró en T5 como entrada propia de la rejilla (`refreshGrid`, `porFoco`), y el enrutador decide por foco.",
  },
];

// --------------------------------------------------------------------------------------------
// Consultas (puras)
// --------------------------------------------------------------------------------------------

/** Todas las entradas de un contexto, en el orden del registro. */
export function atajosDe(contexto: Contexto): Entrada[] {
  return REGISTRO.filter((e) => e.contexto === contexto);
}

/** Entrada por id, o `undefined`. Para T3-T7 (buscar por id estable). */
export function entradaPorId(id: string): Entrada | undefined {
  return REGISTRO.find((e) => e.id === id);
}

/** ¿La entrada se dispara con esta tecla? Vale tanto la principal como los alias. */
function lePega(e: Entrada, t: Tecla): boolean {
  if (mismaTecla(e.tecla, t)) return true;
  return (e.alias ?? []).some((a) => mismaTecla(a, t));
}

/**
 * Resuelve una tecla en un contexto.
 *
 * Regla (T2/T5): el contexto específico gana a `global` **solo si la entrada está marcada
 * `porFoco`**. Es la traducción exacta del problema que el PLAN describe: `⌘⏎` ejecuta en el
 * editor y envía los cambios en la rejilla; `⇧⏎` hace otra cosa en cada uno. Si la entrada
 * específica no es «por foco», el invariante 2 garantiza que no hay una global con la misma tecla,
 * así que devolverla es lo correcto igualmente.
 *
 * No decide el FOCO (eso es T5, `contextoDeFoco`): recibe el contexto ya resuelto.
 */
export function resolver(tecla: Tecla, contexto: Contexto): Entrada | undefined {
  const enContexto = REGISTRO.find((e) => e.contexto === contexto && lePega(e, tecla));
  if (enContexto && (contexto === "global" || enContexto.porFoco)) return enContexto;
  const global = REGISTRO.find((e) => e.contexto === "global" && lePega(e, tecla));
  return global ?? enContexto;
}

// --------------------------------------------------------------------------------------------
// Conversores: la forma propia → los tres formatos que la app necesita
// --------------------------------------------------------------------------------------------

/** Modificador → nombre de Electron (el que entiende `accelerator` de MenuItem). */
const MOD_A_ELECTRON: Record<Mod, string> = {
  Shift: "Shift",
  Meta: "Cmd",
  Ctrl: "Ctrl",
  Alt: "Alt",
};

/** Orden en el acelerador: ⇧ ⌘ ⌃ ⌥ (la convención que ya usa `electron/menu.ts`). */
const ORDEN_ELECTRON: readonly Mod[] = ["Shift", "Meta", "Ctrl", "Alt"];

/**
 * Nombre del key code en un acelerador de Electron. Los nombres son los de
 * https://www.electronjs.org/docs/latest/tutorial/keyboard-shortcuts (comprobados): `Return`
 * (alias `Enter`), `Escape`/`Esc`, `Backspace`, `Delete`, `Up`/`Down`/`Left`/`Right`, `Space`,
 * `Plus`, `F1`-`F24` y la puntuación literal (`/`, `[`, `]`, `,`…). Nótese que las flechas se
 * llaman `Up`, NO `ArrowUp`; y `Enter` es `Return`.
 */
const CLAVE_A_ELECTRON: Record<string, string> = {
  Enter: "Return",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Space: "Space",
};

/**
 * Tecla → acelerador de Electron («Cmd+Alt+L», «Shift+Cmd+Return», «Cmd+F2», «Cmd+Shift+]»).
 * Electron es case-insensitive y el orden de los modificadores le da igual, así que este orden es
 * el nuestro (⇧ ⌘ ⌃ ⌥), elegido para coincidir con los aceleradores escritos hoy en `menu.ts`.
 */
export function aAceleradorElectron(t: Tecla): string {
  const mods = normalizarMods(t.mods);
  const piezas = ORDEN_ELECTRON.filter((m) => mods.includes(m)).map((m) => MOD_A_ELECTRON[m]);
  return [...piezas, CLAVE_A_ELECTRON[t.key] ?? t.key].join("+");
}

/** Modificador → modificador de CodeMirror. Ojo: en CodeMirror `Mod` es ⌘ en macOS. */
const MOD_A_CODEMIRROR: Record<Mod, string> = {
  Meta: "Mod",
  Ctrl: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
};

/** Orden en la tecla de CodeMirror: Mod ⌃ ⌥ ⇧ (el de `sql-editor.tsx`: «Mod-Shift-f»). */
const ORDEN_CODEMIRROR: readonly Mod[] = ["Meta", "Ctrl", "Alt", "Shift"];

/**
 * Clave → nombre de tecla de CodeMirror. CodeMirror usa las letras en minúscula («Mod-Shift-f»),
 * las flechas como `ArrowUp`… y `Space`. La puntuación va literal.
 */
function claveACodeMirror(key: string): string {
  if (/^[A-Z]$/.test(key)) return key.toLowerCase();
  return key;
}

/**
 * Tecla → tecla de CodeMirror («Mod-Alt-l», «Shift-Enter», «Alt-ArrowUp», «Ctrl-g», «Mod-Ctrl-g»).
 * `Mod` = ⌘ en macOS. El orden de los modificadores es indiferente para CodeMirror (los normaliza);
 * el de aquí queda fijado para que las cadenas sean comparables en los tests.
 */
export function aTeclaCodeMirror(t: Tecla): string {
  const mods = normalizarMods(t.mods);
  const piezas = ORDEN_CODEMIRROR.filter((m) => mods.includes(m)).map((m) => MOD_A_CODEMIRROR[m]);
  return [...piezas, claveACodeMirror(t.key)].join("-");
}

/** Modificador → símbolo de macOS. */
const MOD_A_SIMBOLO: Record<Mod, string> = {
  Meta: "⌘",
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
};

/** Orden de los símbolos: ⌘ ⌃ ⌥ ⇧ — el de DataGrip, que es el del PLAN (ver la cabecera). */
const ORDEN_SIMBOLOS: readonly Mod[] = ["Meta", "Ctrl", "Alt", "Shift"];

/** Tecla → símbolo para el texto mostrado (⏎ ⎋ ⌫ ⌦ ↑ ↓ ← → y las letras en mayúscula). */
const CLAVE_A_SIMBOLO: Record<string, string> = {
  Enter: "⏎",
  Escape: "⎋",
  Backspace: "⌫",
  Delete: "⌦",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Space: "Space",
};

/**
 * Tecla → texto para mostrar («⌘⌥L», «⇧⏎», «⌘F2», «⌃Space»). Es la forma que usan el menú
 * (Electron la reescribe por su cuenta), la referencia de T7 y el PLAN.
 */
export function aTextoMac(t: Tecla): string {
  const mods = normalizarMods(t.mods);
  const simbolos = ORDEN_SIMBOLOS.filter((m) => mods.includes(m)).map((m) => MOD_A_SIMBOLO[m]);
  return `${simbolos.join("")}${CLAVE_A_SIMBOLO[t.key] ?? t.key}`;
}

/** Todas las teclas de una entrada (principal + alias) como texto, para la referencia de T7. */
export function textosDe(e: Entrada): string[] {
  return [aTextoMac(e.tecla), ...(e.alias ?? []).map(aTextoMac)];
}
