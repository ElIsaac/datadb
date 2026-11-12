/**
 * ============================================================================
 * Fase 15 (R13) · Tarea T5 — EL ENRUTADOR DE TECLADO POR FOCO
 * ============================================================================
 *
 * QUÉ RESUELVE ESTE ARCHIVO (y por qué no bastaba con el menú)
 * ------------------------------------------------------------
 * El PLAN de la fase 15 pide que los atajos que dependen del foco (`⌘⏎` ejecuta en el editor y ENVÍA
 * CAMBIOS en la rejilla, `⇧⏎` abre el Value Editor en la rejilla, `⌘R` refresca el árbol y
 * RE-EJECUTA en la rejilla —y en el editor abre Reemplazar, #54—, `⌘⌫` borra la línea en el editor
 * y borra la fila marcada en la rejilla…) hagan lo correcto según dónde esté el foco. La tarea T1 midió con
 * teclas reales quién se queda la tecla y el veredicto fue el **Plan B**:
 *
 *   1. El `keydown` llega PRIMERO al renderer (un listener en CAPTURA sobre `window`).
 *   2. Si el renderer hace `preventDefault()`, el ACELERADOR del menú nativo NO se dispara.
 *   3. Un acelerador de menú SIN `⌘` (el `⇧⏎` del Value Editor) NO se dispara nunca desde el
 *      teclado, aunque nadie consuma la tecla: esos atajos sólo pueden vivir en el renderer.
 *
 * De ahí este módulo: un único `keydown` en captura que decide (a) DÓNDE está el foco, (b) qué dice
 * el registro (`src/shared/keymap.ts`, T2) para esa tecla en ese contexto y (c) quién ejecuta la
 * acción — el propio enrutador (alias globales, `⇧⎋`), el menú por el camino único de
 * `ejecutarAccionDeMenu` (fase 6/T6), o los MANEJADORES DE LA INSTANCIA de rejilla que tenga el foco.
 *
 * QUÉ NO HACE (importante, para no duplicar lo que ya funciona)
 * -------------------------------------------------------------
 *   · NO es un segundo registro de atajos: no hay ni una tecla escrita a mano que no salga de
 *     `REGISTRO` (las excepciones están declaradas abajo, en listas explícitas y testeadas).
 *   · NO toca las teclas del editor: el contexto `editor` del registro y el `runKeymap` de
 *     `sql-editor.tsx` (⌘⏎, ⌘S, ⇧⌘F, ⇧⌘U, ⇧⌘J, ⇧⌘Y, ⌘⇧E) son SUYOS. El enrutador corre en captura,
 *     así que si consumiera una de esas teclas el editor se quedaría sin ella — por eso
 *     `decidirTecla` las descarta de entrada en contexto `editor` (ver `esTeclaDelEditor`).
 *   · NO sirve los globales con `⌘` que el MENÚ ya sirve (⌘1, ⌘2, ⌘8, ⌘⌥E, ⌘⇧Q, ⌘F2, ⌘⇧A, ⌘⇧]…):
 *     los declara `electron/menu-template.ts` (T3) y los sirve macOS. Duplicarlos aquí produciría
 *     justo el doble disparo que la fase lleva toda la vida evitando.
 *   · NO secuestra nada mientras haya un menú/diálogo/popup abierto (`[role=menu]`, `[role=dialog]`,
 *     `[role=alertdialog]`, `[role=listbox]` — este último es el autocompletado de CodeMirror y los
 *     desplegables de base-ui). Con la paleta abierta, `⌘K` se comporta como hoy (la paleta sigue
 *     abierta: nadie la cierra ni la reabre).
 *   · NO secuestra teclas de ESCRITURA en los campos de texto (contexto `campo`): ⌫, ⏎, flechas,
 *     letras… siguen siendo del campo. El overlay de edición de celda de glide es un `campo`.
 *
 * DÓNDE SE INSTALA
 * ----------------
 * `src/renderer/main.tsx`, UNA vez, al arrancar el renderer (`instalarEnrutadorDeTeclado()`), antes
 * del primer render. Es el único sitio donde el arranque de la UI es explícito desde la fase 4; un
 * `useEffect` de un componente dejaría el enrutador sin instalar en cualquier árbol que no lo monte
 * (y el orden de montaje de React no es una garantía que este contrato deba tener). La instalación
 * es idempotente (una segunda llamada devuelve la misma función de baja).
 *
 * CÓMO SE PRUEBA SIN DOM
 * ----------------------
 * La mitad que decide (`contextoDeFoco`, `normalizarTecla`, `decidirTecla`, `esTeclaDelEditor`…) es
 * PURA y recibe datos, no elementos: por eso `keyboard-router.test.ts` puede recorrer contextos y
 * teclas sin navegador, y por eso el registro de manejadores por instancia se prueba con objetos
 * mínimos (`NodoConPadre`) en vez de con nodos reales. La capa DOM (leer la cadena de ancestros,
 * buscar la rejilla más cercana, instalar el listener) es una envoltura delgada y no decide nada.
 */
import { ejecutarAccionDeMenu } from "@/hooks/use-menu-actions";
import {
  atajosDe,
  entradaPorId,
  mismaTecla,
  resolver,
  type Contexto,
  type Entrada,
  type Mod,
  type Tecla,
} from "@/shared/keymap";
import type { MenuAction } from "@/shared/menu-actions";

// --------------------------------------------------------------------------------------------
// 1. El foco: `contextoDeFoco` — puro, sobre DATOS de la cadena de ancestros
// --------------------------------------------------------------------------------------------

/**
 * Dónde está el foco, desde el punto de vista del enrutador. No son los cuatro contextos del
 * registro: `campo` (input/textarea/select/contentEditable) no tiene atajos propios — existe para
 * NO secuestrar la escritura— y `global` es «fuera de todo lo demás».
 */
export type ContextoDeFoco = Contexto | "campo";

/**
 * Lo que el enrutador necesita saber de UN nodo de la cadena de ancestros. Es el contrato que hace
 * testeable el clasificador sin DOM: `cadenaDeAncestros` (abajo) lo construye desde un `Element`,
 * y los tests lo construyen a mano.
 */
export interface DescriptorDeAncestro {
  /** `tagName` en minúsculas («input», «div», «canvas»…). */
  tag: string;
  /** `data-testid` del nodo, si lo tiene. */
  testid?: string;
  /** Atributo `role`, si lo tiene. */
  role?: string;
  /** `classList` del nodo. */
  clases?: readonly string[];
  /**
   * `true` sólo si el nodo DECLARA `contenteditable` (atributo presente y distinto de "false").
   * A propósito NO se usa `isContentEditable` (que se hereda a los descendientes): lo que el
   * enrutador quiere saber es «este nodo es el que se edita», no «está dentro de algo editable».
   */
  contentEditable?: boolean;
}

/**
 * `data-testid` del contenedor de cada `ResultsGrid` (el wrapper de `results-grid.tsx`, que es
 * donde se registran los manejadores de esa instancia). Hay DOS rejillas montadas a la vez — el
 * panel de resultados de la consola y cada pestaña de vista de tabla —, así que el contexto
 * `rejilla` y el registro por instancia se apoyan en ESTE marcador y no en una clase de Tailwind
 * (que cambia con el diseño) ni en un id (que sería global y no por instancia).
 */
export const TESTID_REJILLA = "rejilla-de-resultados";

/**
 * `data-testid` del contenedor que pinta la propia librería del grid (`data-grid.tsx`). Se acepta
 * también como marcador de rejilla: el canvas de glide (que es quien recibe el foco) vive dentro de
 * él, y así una rejilla futura que no pase por `results-grid` sigue clasificando bien aunque no
 * tenga manejadores registrados (en ese caso el enrutador no consume nada: ver `atenderTecla`).
 */
export const TESTID_REJILLA_GLIDE = "data-grid";

/** `data-testid` de la raíz del explorador (`schema-tree.tsx`). Contexto `arbol`. */
export const TESTID_ARBOL = "schema-tree";

/** `data-testid` de la raíz del editor propio (spike F2-B). Contexto `editor`. */
export const TESTID_EDITOR_PROPIO = "editor-propio";

/**
 * `data-testid` del panel del Value Editor (`value-editor/value-editor-panel.tsx`). Es un CodeMirror
 * (igual que el editor SQL), pero NO es el editor SQL: es un campo de texto con sus propias teclas
 * (su `⌘⏎` aplica el valor, su `⎋` lo descarta). Se clasifica `campo` para que el enrutador no le
 * toque NADA — si se clasificara `editor`, el enrutador dejaría de servirle los alias globales de
 * forma silenciosa y, peor, un cambio de criterio futuro podría meterle teclas del editor SQL.
 */
export const TESTID_PANEL_DEL_VALOR = "value-editor-panel";

/** Roles que cuentan como «campo de texto» cuando el nodo no es un input/textarea/select. */
const ROLES_DE_CAMPO: readonly string[] = ["textbox", "searchbox", "combobox", "spinbutton"];

/** ¿El nodo es el contenido editable del editor SQL (`.cm-content`)? */
function esContenidoDeCodeMirror(n: DescriptorDeAncestro): boolean {
  return (n.clases ?? []).includes("cm-content");
}

/** ¿El nodo es un control de texto (lo que el enrutador NO debe secuestrar)? */
function esCampoDeTexto(n: DescriptorDeAncestro | undefined): boolean {
  if (!n) return false;
  if (n.tag === "input" || n.tag === "textarea" || n.tag === "select") return true;
  if (n.contentEditable) return true;
  return n.role !== undefined && ROLES_DE_CAMPO.includes(n.role);
}

/** ¿El nodo es (o está dentro de) el panel del Value Editor? */
function esPanelDelValor(n: DescriptorDeAncestro): boolean {
  return n.testid === TESTID_PANEL_DEL_VALOR;
}

/** ¿El nodo es (o está dentro de) una rejilla de resultados? */
function esRejilla(n: DescriptorDeAncestro): boolean {
  return n.testid === TESTID_REJILLA || n.testid === TESTID_REJILLA_GLIDE;
}

/**
 * Clasifica el foco a partir de la CADENA DE ANCESTROS del elemento activo (el primero es el
 * propio elemento, el último suele ser `<body>`). Pura: recibe datos, no elementos.
 *
 * EL ORDEN DE LOS CHEQUEOS ES LA DECISIÓN, y cada paso tiene su porqué medido:
 *
 *   1. **Panel del Value Editor → `campo`.** Es un CodeMirror (contiene un `.cm-content`), así que
 *      sin este paso caería en `editor` y el enrutador le aplicaría el criterio del editor SQL.
 *      Medido en vivo (f15-t5-diag): el panel tiene `data-testid="value-editor-panel"` y su CM
 *      tiene sus propias teclas (⌘⏎ aplica, ⎋ descarta).
 *   2. **`.cm-content` → `editor`.** El contenido de CodeMirror es `contenteditable="true"` y
 *      además lleva `role="textbox"` (medido), así que tiene que ir ANTES que `campo`: si no,
 *      cualquier CM se clasificaría como campo y el editor dejaría de recibir `⌘K`/`⇧⎋`.
 *   3. **Control de texto → `campo`.** `input`/`textarea`/`select`, `contenteditable` declarado o
 *      rol de campo en el PROPIO elemento (no en un ancestro): la fila de filtros, el `WHERE`, el
 *      «máx.», los editores de celda de `editable-cell` y el overlay de glide son todos esto.
 *   4. **Rejilla → `rejilla`.** Después de `campo` a propósito: un input DENTRO de la rejilla (el
 *      overlay de edición, la fila de filtros) es un campo, no una rejilla. Lo que llega aquí es el
 *      canvas de glide (foco real) o los botones de la barra de la rejilla.
 *   5. **Árbol → `arbol`.**
 *   6. **Todo lo demás → `global`** (header, barra de estado, cuerpo…).
 */
export function contextoDeFoco(cadena: readonly DescriptorDeAncestro[]): ContextoDeFoco {
  if (cadena.some(esPanelDelValor)) return "campo";
  if (cadena.some(esContenidoDeCodeMirror)) return "editor";
  // Spike F2-B: el editor propio (DOM, no CodeMirror) se clasifica `editor` por su marcador. Debajo
  // hay un `<textarea>` (el campo que recibe el teclado) que, sin esto, lo clasificaría como `campo`
  // y el enrutador se quedaría las globales que el editor necesita (⌘R = Reemplazar, ⌘F, ⌘⌥L…).
  if (cadena.some((n) => n.testid === TESTID_EDITOR_PROPIO)) return "editor";
  if (esCampoDeTexto(cadena[0])) return "campo";
  if (cadena.some(esRejilla)) return "rejilla";
  if (cadena.some((n) => n.testid === TESTID_ARBOL)) return "arbol";
  return "global";
}

// --------------------------------------------------------------------------------------------
// 2. Normalizar la tecla del evento a la forma del registro
// --------------------------------------------------------------------------------------------

/** Lo que el enrutador necesita de un `KeyboardEvent` (estructura, no el evento: testeable). */
export interface DatosDeTecla {
  key: string;
  code?: string;
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

/** Nombres que se quedan tal cual (los de CodeMirror/dom que usa el registro). */
const NOMBRES_DE_TECLA: Readonly<Record<string, string>> = {
  Enter: "Enter",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  // El teclado entrega " " para la barra espaciadora; "Space" se admite por comodidad de las
  // sondas (y porque es la forma de CodeMirror).
  " ": "Space",
  Space: "Space",
};

/**
 * Lo que macOS produce con `⇧` encima de un signo (`⇧]` → `}`). El registro escribe la tecla BASE
 * (`⌘⇧]` es `{mods:[Meta,Shift], key:"]"}`), así que para reconocerla hay que DESHACER el shift.
 * La tabla es la del teclado US (la disposición de esta máquina y la que asume DataGrip); en otra
 * disposición el signo puede no casar y el atajo simplemente no se reconoce — que es el
 * comportamiento seguro.
 */
const SIN_SHIFT: Readonly<Record<string, string>> = {
  "!": "1",
  "@": "2",
  "#": "3",
  "$": "4",
  "%": "5",
  "^": "6",
  "&": "7",
  "*": "8",
  "(": "9",
  ")": "0",
  _: "-",
  "+": "=",
  "{": "[",
  "}": "]",
  "|": "\\",
  ":": ";",
  '"': "'",
  "<": ",",
  ">": ".",
  "?": "/",
  "~": "`",
};

/** Nombre normalizado desde `event.key`, o `undefined` si no es una tecla conocida. */
function nombreDesdeKey(key: string, shiftKey: boolean): string | undefined {
  const nombre = NOMBRES_DE_TECLA[key];
  if (nombre) return nombre;
  if (/^F([1-9]|1\d|2[0-4])$/.test(key)) return key;
  if (key.length === 1) {
    const base = shiftKey ? (SIN_SHIFT[key] ?? key) : key;
    if (/[a-zA-Z]/.test(base)) return base.toUpperCase();
    return base;
  }
  return undefined;
}

/**
 * Nombre normalizado desde `event.code` (la tecla FÍSICA, independiente del carácter producido).
 * Hace falta para el caso que midió T4 con `⌥A`: en macOS `⌥A` no es la tecla «A», es el carácter
 * «å» (`event.key === "å"`), así que por nombre no hay forma de reconocerla. `event.code` sí.
 */
function nombreDesdeCodigo(code: string): string | undefined {
  const letra = /^Key([A-Z])$/.exec(code);
  if (letra) return letra[1];
  const digito = /^Digit(\d)$/.exec(code);
  if (digito) return digito[1];
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  const conNombre = NOMBRES_DE_CODIGO[code];
  if (conNombre !== undefined) return conNombre;
  return PUNTUACION_DE_CODIGO[code];
}

/** `event.code` de las teclas CON nombre (las mismas formas que usa el registro). */
const NOMBRES_DE_CODIGO: Readonly<Record<string, string>> = {
  Enter: "Enter",
  NumpadEnter: "Enter",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowLeft: "ArrowLeft",
  ArrowRight: "ArrowRight",
  Space: "Space",
};

/** `event.code` de la puntuación, al carácter literal (la forma que usa el registro: `[`, `/`…). */
const PUNTUACION_DE_CODIGO: Readonly<Record<string, string>> = {
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Comma: ",",
  Period: ".",
  Slash: "/",
};

/**
 * Evento → `Tecla` del registro (`{ mods, key }`), o `undefined` si la tecla no es reconocible.
 *
 * DECISIÓN: con `⌥` pulsado se prefiere `event.code`. `⌥` TRANSFORMA el carácter en macOS (`⌥A` →
 * «å», `⌥⌦` puede llegar como un carácter de control): quedarse con `event.key` haría
 * irreconocibles justo las teclas del registro que llevan ⌥ (⌘⌥↑/↓ de la rejilla, el alias ⌥A
 * del editor). El código físico no depende de la disposición ni del carácter.
 *
 * `⇧` no se quita nunca de los modificadores (⇧⌘F ≠ ⌘F); lo único que se deshace es el SIGNO que
 * `⇧` produce sobre la puntuación, para que `⌘⇧]` case con `{mods:[Meta,Shift], key:"]"}`.
 */
export function normalizarTecla(datos: DatosDeTecla): Tecla | undefined {
  const mods: Mod[] = [];
  if (datos.metaKey) mods.push("Meta");
  if (datos.ctrlKey) mods.push("Ctrl");
  if (datos.altKey) mods.push("Alt");
  if (datos.shiftKey) mods.push("Shift");
  const key = datos.altKey
    ? (nombreDesdeCodigo(datos.code ?? "") ?? nombreDesdeKey(datos.key, datos.shiftKey))
    : nombreDesdeKey(datos.key, datos.shiftKey);
  if (!key) return undefined;
  return { mods, key };
}

// --------------------------------------------------------------------------------------------
// 3. Las teclas que el enrutador sirve — y quién es el dueño de las demás
// --------------------------------------------------------------------------------------------

/**
 * Las teclas del `runKeymap` de `sql-editor.tsx` (acciones de la app que despachan un
 * `CustomEvent` sobre el editor: ejecutar, guardar, explicar, texto→SQL y los dos diagramas ER).
 * T4 las dejó FUERA del registro porque no son comandos de CodeMirror, así que el enrutador no
 * puede deducirlas de `atajosDe("editor")` y las declara aquí. Si el `runKeymap` cambia (T4+), esta
 * lista tiene que cambiar con él: el test de este módulo fija sus siete entradas y su porqué.
 */
export const TECLAS_DEL_RUNKEYMAP: readonly Tecla[] = [
  { mods: ["Meta"], key: "Enter" }, // ⌘⏎ ejecutar (Mod-Enter)
  { mods: ["Meta"], key: "S" }, // ⌘S guardar (Mod-s)
  { mods: ["Meta", "Shift"], key: "U" }, // ⌘⇧U diagrama ER (Mod-Shift-u)
  { mods: ["Meta", "Shift"], key: "E" }, // ⌘⇧E ER del ámbito (Mod-Shift-e)
  { mods: ["Meta", "Shift"], key: "F" }, // ⇧⌘F formatear (Mod-Shift-f)
  { mods: ["Meta", "Shift"], key: "J" }, // ⇧⌘J explain (Mod-Shift-j)
  { mods: ["Meta", "Shift"], key: "Y" }, // ⇧⌘Y texto→SQL (Mod-Shift-y)
];

/**
 * ¿Esta tecla la atiende el EDITOR SQL cuando tiene el foco? Es la lista con la que el contexto
 * `editor` se protege de verdad: las entradas del contexto `editor` del registro (principal y
 * alias) más el `runKeymap`. `decidirTecla` no devuelve nada para ellas en contexto `editor`, que
 * es la traducción exacta de la regla (a) de la tarea: «NO toca las teclas que el editor atiende».
 */
export function esTeclaDelEditor(tecla: Tecla): boolean {
  for (const e of atajosDe("editor")) {
    if (mismaTecla(e.tecla, tecla)) return true;
    if ((e.alias ?? []).some((a) => mismaTecla(a, tecla))) return true;
  }
  return TECLAS_DEL_RUNKEYMAP.some((t) => mismaTecla(t, tecla));
}

/**
 * Las entradas GLOBALES del registro cuyas teclas sirve este enrutador (el menú nativo no las
 * sirve: o son ALIAS de D1, que no caben en un `MenuItem` que ya declara el atajo de DataGrip, o no
 * llevan `⌘` y por eso macOS no dispara su acelerador — T1 lo midió).
 *
 *   · `reformatCode`          → alias `⇧⌘F`   (el principal `⌘⌥L` lo sirve el menú — y SÍ lleva ⌘,
 *                               aunque el `control alt L` del XML sugiera lo contrario: en ese
 *                               archivo `control` es ⌘. Ver `research/rea-datagrip.md` §5.1).
 *   · `showDiagram`           → alias `⌘⇧U`   (el principal `⌘⌥⇧U` lo sirve el menú).
 *   · `findAction`            → alias `⌘K`    (el principal `⌘⇧A` lo sirve el menú).
 *   · `hideActiveToolWindow`  → su PRINCIPAL `⇧⎋` (no lleva ⌘: el menú no puede servirlo).
 *
 * `incluirPrincipal` distingue los dos casos para que la lista no se escriba a mano tecla a tecla:
 * las teclas salen del registro con sus conversores (una lista duplicada envejecería sola).
 */
export const GLOBALES_DEL_ENRUTADOR: ReadonlyArray<{
  id: string;
  incluirPrincipal: boolean;
  nota: string;
}> = [
  { id: "reformatCode", incluirPrincipal: false, nota: "alias ⇧⌘F (D1); el principal ⌘⌥L lo sirve el menú" },
  { id: "showDiagram", incluirPrincipal: false, nota: "alias ⌘⇧U (D1); el principal ⌘⌥⇧U lo sirve el menú" },
  { id: "findAction", incluirPrincipal: false, nota: "alias ⌘K (D1); el principal ⌘⇧A lo sirve el menú" },
  { id: "hideActiveToolWindow", incluirPrincipal: true, nota: "⇧⎋ sin ⌘: macOS no dispara su acelerador, lo sirve el enrutador" },
];

/** Un candidato del enrutador: la entrada del registro y LA tecla concreta que casa. */
export interface TeclaGlobalDelEnrutador {
  entrada: Entrada;
  tecla: Tecla;
  /** `true` si la tecla es un alias de D1, `false` si es la principal de la entrada. */
  esAlias: boolean;
}

/** Deriva las teclas globales del enrutador del registro (ver `GLOBALES_DEL_ENRUTADOR`). */
export function teclasGlobalesDelEnrutador(): TeclaGlobalDelEnrutador[] {
  const lista: TeclaGlobalDelEnrutador[] = [];
  for (const cfg of GLOBALES_DEL_ENRUTADOR) {
    const entrada = entradaPorId(cfg.id);
    if (!entrada) continue; // el test lo vigila; en runtime, mejor callar que romper
    if (cfg.incluirPrincipal) lista.push({ entrada, tecla: entrada.tecla, esAlias: false });
    for (const alias of entrada.alias ?? []) lista.push({ entrada, tecla: alias, esAlias: true });
  }
  return lista;
}

/** La entrada global cuyo alias/principal casa con esta tecla, si el enrutador la sirve. */
export function entradaGlobalDelEnrutador(tecla: Tecla): Entrada | undefined {
  return teclasGlobalesDelEnrutador().find((c) => mismaTecla(c.tecla, tecla))?.entrada;
}

// --------------------------------------------------------------------------------------------
// 4. La decisión — pura: (tecla, contexto) → qué hacer
// --------------------------------------------------------------------------------------------

/** A quién hay que llamar para ejecutar la decisión. */
export type DestinoDeEnrutador = "rejilla" | "arbol" | "menu";

/** Lo que el enrutador va a hacer con una tecla. */
export interface AccionDeEnrutador {
  /** La entrada del registro que decidió (para tests, trazas y el documento de atajos). */
  entrada: Entrada;
  destino: DestinoDeEnrutador;
  /** Acción de menú a ejecutar cuando `destino` es `"menu"`. */
  accionDeMenu?: MenuAction;
  /** Id de acción de la app (`ACCIONES_APP`) cuando `destino` es `"rejilla"`/`"arbol"`. */
  accionDeApp?: string;
  /**
   * Consumir la tecla aunque el manejador diga que no actuó. Sólo `⌘⏎` en la rejilla (#96 Submit
   * Changes): en DataGrip, `⌘⏎` en el data editor NUNCA ejecuta la consulta, así que la tecla se
   * consume también cuando no hay cambios pendientes (el manejador enseña «No hay cambios para
   * guardar» o, sin contexto de tabla, no hace nada visible).
   */
  consumeSiempre?: boolean;
}

/** `true` si la entrada es una de las globales que sirve el enrutador (por id). */
function esEntradaGlobalDelEnrutador(id: string): boolean {
  return GLOBALES_DEL_ENRUTADOR.some((c) => c.id === id);
}

/**
 * Traduce una entrada del registro de contexto `rejilla` a la decisión de la rejilla.
 *
 * Dos clases de entradas viven en ese contexto (y por eso la decisión tiene dos destinos):
 *   · las que ejecuta la INSTANCIA (⌘⏎, ⌘N, ⌘⌫/⌫/⌦, ⌘D, ⌘⌥↑/↓, F4, ⌘R) → destino `rejilla`;
 *   · `⇧⏎` (Open in Value Editor, #97), que es una acción de MENÚ (`view.toolWindow.value`): el
 *     panel del valor es único (dock derecho) y togglearlo no depende de qué rejilla tenga el foco
 *     → destino `menu`, por el camino único de `ejecutarAccionDeMenu`. La tecla sí se consume sólo
 *     si hay una rejilla bajo el foco (ver `ejecutarDecision`).
 */
function decisionDeRejilla(entrada: Entrada): AccionDeEnrutador {
  if (entrada.accion.tipo === "menu") {
    return { entrada, destino: "menu", accionDeMenu: entrada.accion.id as MenuAction };
  }
  return {
    entrada,
    destino: "rejilla",
    accionDeApp: entrada.accion.tipo === "app" ? entrada.accion.id : undefined,
    // #96: en DataGrip, ⌘⏎ en el data editor no ejecuta la consulta aunque no haya cambios
    // pendientes. Se consume igual; `undefined` (y no `false`) en las demás.
    consumeSiempre: entrada.id === "submitChanges" || undefined,
  };
}

/**
 * LA TABLA DE DECISIÓN (pura). Dada una tecla normalizada y el contexto del foco, devuelve qué
 * hacer o `undefined` («no es mía»: la tecla sigue su camino — CodeMirror, glide, el menú, el
 * campo de texto…).
 *
 * Reglas, en este orden:
 *
 *   1. **`editor` + tecla del editor → nada.** Ni con modificador ni sin él: si el editor la
 *      atiende, el enrutador se aparta (regla (a) de la tarea). En la práctica esto es lo que deja
 *      `⇧⌘F`/`⌘⇧U` en manos del `runKeymap` cuando el foco está DENTRO del editor.
 *   2. **`rejilla` → primero el registro de rejilla.** `⌘⏎`, `⇧⏎`, `⌘N`, `⌘⌫`/`⌫`/`⌦`, `⌘D`,
 *      `⌘⌥↑/↓`, `F4`, `⌘R`. Si la tecla no es de rejilla se cae al paso 4 (p. ej. `⌘K`).
 *   3. **`arbol` → el registro de árbol** (`⌘R`).
 *   4. **En CUALQUIER contexto → los alias globales del enrutador** (`⇧⌘F`, `⌘⇧U`, `⌘K`) y `⇧⎋`.
 *      En `campo` esto es lo ÚNICO que sale del enrutador (regla (b): no se secuestra nada que
 *      escriba o edite texto); en `editor` los dos primeros ya cayeron en el paso 1.
 *
 * Lo que NO está en ninguno de los cuatro conjuntos es «no es mía» a propósito: los globales con ⌘
 * del menú, los atajos de codeMirror, `⇧⏎`/`⌘⏎` en el editor (los sirve el keymap del editor)…
 */
export function decidirTecla(tecla: Tecla, contexto: ContextoDeFoco): AccionDeEnrutador | undefined {
  // (1) El editor manda en lo suyo.
  if (contexto === "editor" && esTeclaDelEditor(tecla)) return undefined;

  // (2) Rejilla.
  if (contexto === "rejilla") {
    const entrada = resolver(tecla, "rejilla");
    if (entrada && entrada.contexto === "rejilla") return decisionDeRejilla(entrada);
  }

  // (3) Árbol.
  if (contexto === "arbol") {
    const entrada = resolver(tecla, "arbol");
    if (entrada && entrada.contexto === "arbol") {
      return {
        entrada,
        destino: "arbol",
        accionDeApp: entrada.accion.tipo === "app" ? entrada.accion.id : undefined,
      };
    }
  }

  // (4) Las globales del enrutador, en cualquier contexto.
  const global = entradaGlobalDelEnrutador(tecla);
  if (global && global.accion.tipo === "menu" && esEntradaGlobalDelEnrutador(global.id)) {
    return { entrada: global, destino: "menu", accionDeMenu: global.accion.id as MenuAction };
  }
  return undefined;
}

// --------------------------------------------------------------------------------------------
// 5. El registro de manejadores POR INSTANCIA (la rejilla) y el del árbol
// --------------------------------------------------------------------------------------------

/**
 * Lo que UNA rejilla sabe hacer. Cada manejador devuelve si ACTUÓ: `false` significa «yo no tengo
 * nada que hacer con esta pulsación» y el enrutador NO consume la tecla (deja que siga su camino).
 * Ese contrato es lo que evita dos males a la vez: secuestrar `⌫` cuando no hay filas marcadas y
 * consumir `⌘N` en una rejilla que no es editable.
 *
 * Hay DOS (o más) rejillas montadas a la vez —el panel de resultados y cada pestaña de vista de
 * tabla, que pueden coexistir con el dock inferior abierto—, así que los manejadores NO pueden ser
 * un singleton: cada instancia registra los suyos asociados a SU contenedor DOM y el enrutador
 * llama a los de la rejilla más cercana al elemento con foco.
 */
export interface ManejadoresDeRejilla {
  /** #96 Submit Changes (⌘⏎) — «Guardar» los cambios pendientes. */
  guardarCambios: () => boolean;
  /** #101 Add Row (⌘N) — «Agregar fila». */
  agregarFila: () => boolean;
  /** #101 Delete Row (⌘⌫ / ⌫ / ⌦) — «Borrar» las filas marcadas. */
  borrarSeleccionadas: () => boolean;
  /** Clone Row (⌘D) — «Duplicar» las filas marcadas. */
  duplicarSeleccionadas: () => boolean;
  /** #103 Previous Page (⌘⌥↑). */
  paginaAnterior: () => boolean;
  /** #103 Next Page (⌘⌥↓). */
  paginaSiguiente: () => boolean;
  /** #105 Related Rows (F4) — «Ir a la referenciada» de la celda enfocada. */
  irALaReferenciada: () => boolean;
  /** #18 Refresh (⌘R) — re-ejecutar la consulta de ESTA rejilla. */
  refrescar: () => boolean;
}

/** Lo que sabe hacer el explorador. Un solo manejador: sólo hay un árbol. */
export interface ManejadoresDeArbol {
  /** #18 Refresh (⌘R) — recargar el esquema. Devuelve si actuó. */
  refrescar: () => boolean;
}

/**
 * Lo mínimo que el enrutador necesita de un nodo para subir por el DOM. Es estructural a propósito:
 * un `Element` lo cumple tal cual, y un test puede pasar objetos mínimos sin navegador.
 */
export interface NodoConPadre {
  parentElement: NodoConPadre | null;
}

/** Manejadores registrados, por contenedor. `WeakMap`: si un contenedor muere, su entrada también. */
const rejillas = new WeakMap<object, ManejadoresDeRejilla>();

/** El refresco del árbol. Singleton declarado (sólo hay un explorador) y vacío hasta que se registra. */
let manejadorDeArbol: ManejadoresDeArbol | null = null;

/**
 * Registra los manejadores de UNA instancia de rejilla, asociados a SU contenedor. Devuelve la
 * función de baja (lo que devuelve un `useEffect` de React). Re-registrar el mismo contenedor
 * actualiza los manejadores: es lo que necesita React, que vuelve a ejecutar el efecto cuando
 * cambian las props que los manejadores capturan.
 */
export function registrarManejadoresDeRejilla(
  contenedor: NodoConPadre,
  manejadores: ManejadoresDeRejilla
): () => void {
  rejillas.set(contenedor, manejadores);
  return () => {
    rejillas.delete(contenedor);
  };
}

/**
 * Los manejadores de la rejilla más cercana subiendo desde un nodo (el elemento con foco o null).
 * Es la mitad «por instancia» de la tarea: con dos rejillas montadas, se llama a la que CONTIENE
 * el foco, no a «la rejilla».
 */
export function manejadoresDeRejillaMasCercanos(
  nodo: NodoConPadre | null
): ManejadoresDeRejilla | undefined {
  let actual: NodoConPadre | null = nodo;
  while (actual) {
    const encontrados = rejillas.get(actual);
    if (encontrados) return encontrados;
    actual = actual.parentElement;
  }
  return undefined;
}

/** Registra (o limpia con `null`) el refresco del árbol. Devuelve la baja. */
export function registrarManejadoresDeArbol(manejadores: ManejadoresDeArbol | null): () => void {
  manejadorDeArbol = manejadores;
  return () => {
    manejadorDeArbol = null;
  };
}

/** El registro de acciones de la app → el manejador que las ejecuta en la instancia. */
const MANEJADOR_POR_ACCION: Readonly<Record<string, keyof ManejadoresDeRejilla>> = {
  "grid.confirmChanges": "guardarCambios",
  "grid.addRow": "agregarFila",
  "grid.deleteSelected": "borrarSeleccionadas",
  "grid.duplicateSelected": "duplicarSeleccionadas",
  "grid.prevPage": "paginaAnterior",
  "grid.nextPage": "paginaSiguiente",
  "grid.navigateFk": "irALaReferenciada",
  "grid.refresh": "refrescar",
};

// --------------------------------------------------------------------------------------------
// 6. La capa DOM: cadena de ancestros, capas modales abiertas y ejecución
// --------------------------------------------------------------------------------------------

/** Convierte un `Element` en el descriptor que consume `contextoDeFoco`. */
export function descriptorDeElemento(el: Element): DescriptorDeAncestro {
  const attr = el.getAttribute("contenteditable");
  return {
    tag: el.tagName.toLowerCase(),
    testid: el.getAttribute("data-testid") ?? undefined,
    role: el.getAttribute("role") ?? undefined,
    clases: [...el.classList],
    contentEditable: attr !== null && attr !== "false",
  };
}

/**
 * La cadena de ancestros del elemento activo, del propio elemento hacia arriba. El último es
 * `<body>`/`<html>` (o el elemento raíz), que siempre da `global`.
 */
export function cadenaDeAncestros(el: Element | null): DescriptorDeAncestro[] {
  const cadena: DescriptorDeAncestro[] = [];
  let actual: Element | null = el;
  while (actual) {
    cadena.push(descriptorDeElemento(actual));
    actual = actual.parentElement;
  }
  return cadena;
}

/**
 * ¿Hay un menú, un diálogo o una lista (autocompletado, desplegable) abierta? Con una capa modal
 * abierta el enrutador NO actúa: el `⎋`/`⏎`/flechas pertenecen a esa capa y «secuestrar» un atajo
 * por debajo sería exactamente el tipo de sorpresa que la fase quiere quitar de en medio.
 *
 * El selector es el MISMO criterio que ya usa `tool-window.tsx:213` para decidir si un clic cuenta
 * como «fuera» de una tool window No fijada (menús, diálogos, listas y avisos). Medido en vivo con
 * la app en reposo (f15-t5-diag): 0 nodos. `alertdialog` se añade por los diálogos de confirmación.
 *
 * OJO con los avisos (`[data-sonner-toaster]`): NO se excluyen aquí. Un aviso no tiene teclado y
 * bloquear los atajos durante los segundos que vive sería un fallo silencioso.
 */
export function hayCapaModalAbierta(): boolean {
  if (typeof document === "undefined") return false;
  return document.querySelector('[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]') !== null;
}

/** Ejecuta una decisión. Devuelve si de verdad se actuó (y por tanto hay que consumir la tecla). */
function ejecutarDecision(decision: AccionDeEnrutador, activo: Element | null): boolean {
  switch (decision.destino) {
    case "menu": {
      // Las acciones de menú que dependen de la INSTANCIA (⇧⏎ → Value Editor, entrada de contexto
      // `rejilla`) sólo se consumen si hay una rejilla registrada bajo el foco: sin ella, el ítem
      // del menú es el único camino y secuestrar la tecla dejaría al usuario sin ninguna vía.
      if (decision.entrada.contexto === "rejilla" && !manejadoresDeRejillaMasCercanos(activo)) {
        return false;
      }
      if (!decision.accionDeMenu) return false;
      ejecutarAccionDeMenu(decision.accionDeMenu);
      return true;
    }
    case "arbol": {
      if (!manejadorDeArbol) return false;
      return manejadorDeArbol.refrescar();
    }
    case "rejilla": {
      const manejadores = manejadoresDeRejillaMasCercanos(activo);
      if (!manejadores) return false;
      const clave = decision.accionDeApp ? MANEJADOR_POR_ACCION[decision.accionDeApp] : undefined;
      if (!clave) return false;
      const actuo = manejadores[clave]();
      return actuo || decision.consumeSiempre === true;
    }
  }
}

/**
 * Atiende UNA tecla. Devuelve si el enrutador actuó (y consumió la tecla). Es la función que el
 * listener de `window` llama; se exporta para poder medirla desde una sonda y para los tests de la
 * capa DOM.
 */
export function atenderTecla(evento: KeyboardEvent): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  if (hayCapaModalAbierta()) return false;
  // Spike F2: la barra de buscar/reemplazar del editor toma el teclado mientras tiene el foco, como
  // una capa modal. Sin esto, el paso (4) de `decidirTecla` aplicaba las GLOBALES también con el
  // foco en su campo: ⌘R («Refresh») refrescaba la consola y la barra desaparecía en mitad de un
  // reemplazo — medido en la app real. El widget atiende sus propias teclas (⏎, ⇧⏎, ⎋, ⌘R, ⌘G).
  if (document.activeElement?.closest?.('[data-testid="editor-find-bar"]')) return false;

  const tecla = normalizarTecla({
    key: evento.key,
    code: evento.code,
    metaKey: evento.metaKey,
    altKey: evento.altKey,
    ctrlKey: evento.ctrlKey,
    shiftKey: evento.shiftKey,
  });
  if (!tecla) return false;

  const activo = document.activeElement;
  const contexto = contextoDeFoco(cadenaDeAncestros(activo));
  const decision = decidirTecla(tecla, contexto);
  if (!decision) return false;

  const actuo = ejecutarDecision(decision, activo);
  if (!actuo) return false;

  // Plan B de T1: consumir la tecla en CAPTURA hace dos cosas a la vez — el editor/la rejilla y,
  // lo que de verdad importa aquí, el ACELERADOR del menú nativo, que en macOS sólo se dispara si
  // el renderer no hizo `preventDefault()`. `stopPropagation` evita además que un listener de
  // burbuja (los «fallback» de `sql-editor.tsx` para ⌘S/⌘⏎, por ejemplo) repita la acción.
  evento.preventDefault();
  evento.stopPropagation();
  return true;
}

/** ¿Está instalado el enrutador? (Espejo para sondas y tests.) */
let instalado = false;

/** Baja del listener instalado, si lo hay (la devuelve `instalarEnrutadorDeTeclado`). */
let bajaActual: (() => void) | null = null;

/**
 * Instala el listener ÚNICO en captura sobre `window`. Idempotente: una segunda llamada devuelve
 * la misma función de baja en vez de añadir un segundo listener (una sonda que la llame dos veces
 * contaría cada tecla N veces — «doble disparo» de la sonda, no de la app; ese error ya se pagó en
 * la fase 6).
 */
export function instalarEnrutadorDeTeclado(): () => void {
  if (typeof window === "undefined") return () => {};
  if (instalado && bajaActual) return bajaActual;
  const listener = (evento: KeyboardEvent) => {
    atenderTecla(evento);
  };
  window.addEventListener("keydown", listener, true);
  instalado = true;
  bajaActual = () => {
    window.removeEventListener("keydown", listener, true);
    instalado = false;
    bajaActual = null;
  };
  return bajaActual;
}

/** Sólo para tests/sondas: si el enrutador tiene listener puesto. */
export function enrutadorInstalado(): boolean {
  return instalado;
}
