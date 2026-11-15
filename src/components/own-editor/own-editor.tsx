import * as React from "react";
import { cn } from "@/lib/utils";
import {
  EditorModel,
  collapse,
  from,
  to,
  type Selection,
} from "@/lib/editor-core/model";
import { highlightLines, type Dialecto, type NombresConocidos, type Token } from "./highlight";
import { computeFoldRanges, type FoldRange } from "@/lib/editor-core/folding";
import { OwnFindBar, type OwnFindBarHandle } from "./own-find";
import type { MatchRange } from "@/lib/find";
import type { SqlLintDiagnostic } from "@/lib/sql-lint";
import { IjIcon, type IjIconName } from "@/components/ij-icon";
import {
  completionWindow,
  insertionFor,
  popupVerticalPlacement,
  popupWidthFor,
  rankSuggestions,
  shouldOpenAfter,
  shouldOpenAfterSpace,
  type Suggestion,
  type SuggestionKind,
} from "./completion";
import "./own-editor.css";

/**
 * El editor propio (spike F2-B). Es la vista; el modelo vive en `@/lib/editor-core/model`.
 *
 * POR QUÉ ASÍ: DOM por línea visible (no canvas). Un editor de código tiene que ser seleccionable,
 * accesible y copiable, y la pintura en canvas obliga a reimplementar todo eso. Lo que separaba al
 * editor de «parecer una página» no era el DOM, era la pintura por defecto de CodeMirror — y eso lo
 * demostró la barra de buscar/reemplazar: con la misma tecnología, el chrome propio cambia el
 * aspecto por completo.
 *
 * DECISIONES QUE SE VEN EN EL USUARIO:
 *   · SOLO SE PINTA LA VENTANA VISIBLE (más 6 líneas de margen). 10 000 líneas son 10 000 nodos si
 *     se pintan todas; aquí son ~30.
 *   · El cursor y la selección son divs posicionados con `col * anchoDeCarácter`, porque la fuente
 *     es monoespaciada. El ancho se MIDE (canvas + `measureText`) al montar y cuando la fuente
 *     termina de cargar: un valor «de memoria» (7,8 px) se desvía una décima por carácter y a la
 *     columna 80 ya son 8 px.
 *   · El teclado y el portapapeles entran por un `<textarea>` invisible colocado en el cursor. Es
 *     lo que hace que el IME de macOS (acentos, ñ, teclas muertas) funcione sin reimplementarlo.
 *
 * LO QUE NO TIENE TODAVÍA (a propósito, v0): autocompletado, inspecciones, multicursor, plegado y
 * la barra de buscar/reemplazar. Cada uno tiene su plan; primero que teclear se sienta bien.
 */

/** Acciones de la app que el editor dispara con sus atajos (las mismas que el editor viejo). */
export type OwnEditorAction = "run" | "save" | "format" | "explain" | "erDiagram" | "erDiagramScope" | "aiSql";

/** Lo que la consola necesita del editor para sustituir a `cmRef`. */
export interface OwnEditorHandle {
  element: HTMLDivElement | null;
  focus: () => void;
  getText: () => string;
  getSelection: () => { from: number; to: number };
  setSelection: (from: number, to: number) => void;
  replaceSelection: (text: string) => void;
  insertAtCursor: (text: string) => void;
  selectAll: () => void;
}

export interface OwnEditorProps {
  value: string;
  onChange?: (value: string) => void;
  minHeight?: string;
  className?: string;
  dialecto?: Dialecto;
  /**
   * Sugerencias para el autocompletado. El editor no conoce el esquema: el llamador devuelve la
   * lista ya construida (palabras clave, tablas, columnas del alcance…) y aquí solo se filtra,
   * ordena y se pinta. Sin esta prop no hay popup.
   */
  suggest?: (context: { text: string; offset: number }) => Suggestion[];
  /**
   * Diagnósticos ya calculados por el llamador (`buildSqlDiagnostics`). El editor no conoce el
   * esquema: pinta subrayados y puntos en el canal, y el `title` lleva el mensaje.
   */
  diagnostics?: SqlLintDiagnostic[];
  /**
   * Atajos de la app: ⌘⏎ (ejecutar), ⌘S (guardar), ⌘⌥L / ⇧⌘F (formatear), ⇧⌘J (explain),
   * ⇧⌘U / ⇧⌘E (diagrama ER) y ⇧⌘Y (IA). El editor no sabe qué hacen: avisa y quien lo monta decide.
   */
  onAction?: (action: OwnEditorAction) => void;
  /** Avisa del elemento montado: la consola lo necesita para los CustomEvent del adaptador. */
  onElement?: (element: HTMLDivElement | null) => void;
  /**
   * Sentencia en la que está el cursor (`[from, to)`), o `null` si no está en ninguna. El editor
   * la contornea con una línea verde fina, como DataGrip. El editor no sabe de SQL: la consola pasa
   * `getStatementRangeAt` (`@/lib/sql-statements`). Sin esta prop no hay contorno.
   */
  currentStatement?: (text: string, offset: number) => { from: number; to: number } | null;
  /**
   * Columnas y tablas conocidas del esquema conectado (en minúsculas) para el coloreado: las
   * columnas se pintan con su propio color y las tablas y los alias quedan como estaban. El editor
   * no consulta la base; se lo pasa la consola. Tiene que venir MEMOIZADO (referencias estables) o
   * el documento se re-colorea en cada pulsación.
   */
  nombres?: NombresConocidos;
}

/** Alto de línea y margen superior. El CSS los repite; si cambian, cambian los dos. */
const LINE_HEIGHT = 20;
const TOP_PAD = 4;
/** Margen sin fondo entre el canal de números y el texto (ver `gutterWidth`). */
const GUTTER_INSET = 6;
/** Líneas de más que se pintan por encima y por debajo de la ventana. */
const OVERSCAN = 6;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, max));

/**
 * Tecla → acción de la app. Se decide ANTES que el popup y que las teclas de edición: con ⌘⏎ el
 * usuario quiere ejecutar aunque el popup esté abierto (⏎ sin modificadores es el que acepta).
 * Son las mismas teclas que el `runKeymap` del editor de CodeMirror, para que cambiar de editor no
 * cambie los dedos.
 */
function editorActionFor(e: { metaKey: boolean; altKey: boolean; shiftKey: boolean; key: string }): OwnEditorAction | null {
  const k = e.key.toLowerCase();
  if (!e.metaKey) return null;
  if (k === "enter" && !e.altKey && !e.shiftKey) return "run";
  if (k === "s" && !e.altKey && !e.shiftKey) return "save";
  if ((k === "l" && e.altKey && !e.shiftKey) || (k === "f" && e.shiftKey && !e.altKey)) return "format";
  if (k === "j" && e.shiftKey && !e.altKey) return "explain";
  if (k === "u" && e.shiftKey && !e.altKey) return "erDiagram";
  if (k === "e" && e.shiftKey && !e.altKey) return "erDiagramScope";
  if (k === "y" && e.shiftKey && !e.altKey) return "aiSql";
  return null;
}

/**
 * Pinta el prefijo tecleado dentro de la etiqueta (como `CompletionPopup.matchForeground` de
 * DataGrip). Solo cuando la etiqueta EMPIEZA por el prefijo: en una coincidencia por subsecuencia no
 * hay un tramo contiguo que resaltar, y marcar letras sueltas parece un error.
 */
function highlightPrefix(label: string, prefix: string) {
  if (!prefix || !label.toLowerCase().startsWith(prefix.toLowerCase())) return label;
  return (
    <>
      <span className="ld-popup-match">{label.slice(0, prefix.length)}</span>
      {label.slice(prefix.length)}
    </>
  );
}

/**
 * Icono de la fila del popup, el MISMO que usa el árbol y el chrome (catálogo de IntelliJ): tabla,
 * columna y función del motor. Antes era un punto de 6 px coloreado, que a este tamaño no distingue
 * nada si no se distinguen los colores; DataGrip usa iconos con forma.
 *
 * Las palabras clave y los snippets van sin icono (DataGrip tampoco les pone uno propio), pero con
 * un hueco del mismo ancho para que todas las etiquetas queden alineadas.
 */
function IconoDeKind({ kind }: { kind?: SuggestionKind }) {
  // R89: el alias se pinta como tabla (es una tabla con otro nombre), el esquema con el cilindro de
  // base y la relación por clave foránea con la llave de FK, que es lo que la distingue de una tabla
  // cualquiera en la misma lista.
  const nombre: IjIconName | null =
    kind === "table" || kind === "alias"
      ? "table"
      : kind === "column"
        ? "column"
        : kind === "function"
          ? "function"
          : kind === "schema"
            ? "database"
            : kind === "join"
              ? "foreignKey"
              : null;
  if (!nombre) return <span className="ld-popup-icon ld-popup-icon-vacio" aria-hidden />;
  return (
    <span className="ld-popup-icon">
      <IjIcon name={nombre} />
    </span>
  );
}

export const OwnEditor = React.forwardRef<OwnEditorHandle, OwnEditorProps>(function OwnEditor({
  value,
  onChange,
  minHeight = "200px",
  className,
  dialecto = "standard",
  suggest,
  diagnostics,
  onAction,
  onElement,
  currentStatement,
  nombres,
}: OwnEditorProps,
  ref
) {
  // El modelo se crea UNA vez por montaje. `useState` y no `useRef` porque el linter del proyecto
  // (react-hooks v6) prohíbe leer refs durante el render, y aquí se lee en cada pintada.
  const [model] = React.useState(() => new EditorModel(value));

  const [, forceRender] = React.useReducer((n: number) => n + 1, 0);
  const [scrollTop, setScrollTop] = React.useState(0);
  const [viewportHeight, setViewportHeight] = React.useState(320);
  /** Ancho visible del área de texto: acota el ancho del popup para que no se salga por la derecha. */
  const [viewportWidth, setViewportWidth] = React.useState(640);
  const [charWidth, setCharWidth] = React.useState(7.8);
  const [focused, setFocused] = React.useState(false);
  const [composing, setComposing] = React.useState<string | null>(null);
  /** Popup de autocompletado: la ventana que se reemplaza, las opciones y cuál está marcada. */
  const [popup, setPopup] = React.useState<{
    from: number;
    prefix: string;
    items: Suggestion[];
    index: number;
  } | null>(null);
  const [findOpen, setFindOpen] = React.useState(false);
  const [findReplace, setFindReplace] = React.useState(false);
  const [findMatches, setFindMatches] = React.useState<readonly MatchRange[]>([]);
  /** Sube con cada cambio del documento: la barra de buscar recontar con esto. */
  const [editVersion, bumpEdit] = React.useReducer((n: number) => n + 1, 0);
  const findRef = React.useRef<OwnFindBarHandle | null>(null);
  /*
    ⌘L / ⌘⌥G — «Ir a la línea» (DataGrip #61). El motor CodeMirror lo traía de `@codemirror/search`
    (un `.cm-dialog`); el editor propio no tenía nada y la tecla no hacía NADA (medido con la sonda
    T8 el 2026-10-21: `dialogos: []` tras ⌘L). Es un campo diminuto pegado arriba a la derecha, con
    el mismo aspecto que la barra de buscar, para no inventar otro lenguaje visual.
  */
  const [gotoOpen, setGotoOpen] = React.useState(false);
  const [gotoValue, setGotoValue] = React.useState("");

  const rootRef = React.useRef<HTMLDivElement>(null);
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  /** Último texto emitido por nosotros: distingue un cambio externo de la vuelta de `onChange`. */
  const emittedRef = React.useRef<string | null>(null);
  /** Columna «soñada» al moverse en vertical, para no saltar al final de las líneas cortas. */
  const goalColumnRef = React.useRef<number | null>(null);
  /** Tras `compositionend` puede llegar un `input` con el texto ya insertado: se salta uno. */
  const skipInputRef = React.useRef(false);
  /** Marca que la última edición/movimiento debe dejar el cursor dentro de la ventana visible. */
  const pendingScrollRef = React.useRef(false);

  const snapshot = model.snapshot;
  const selection = snapshot.selection;
  const selFrom = from(selection);
  const selTo = to(selection);
  const caret = model.positionAt(selection.head);
  const lineCount = model.lineCount;
  const digits = Math.max(2, String(lineCount).length);
  /*
    El canal (gutter) tiene un margen INTERIOR sin fondo de `GUTTER_INSET` px entre los números y el
    texto: ahí cae el borde izquierdo del contorno de la sentencia actual (R90). Antes el contorno se
    pintaba a 3,5 px a la izquierda del texto, DEBAJO del número de línea (que es `sticky` con fondo y
    z-index 3), y el usuario lo vio «sin cerrar por la izquierda». DataGrip también deja ese aire.
  */
  const gutterWidth = Math.round(digits * charWidth + 16 + GUTTER_INSET);

  /*
    F2 — plegado. Los rangos se recalculan con el texto (puro y barato: recorre caracteres, no
    líneas×líneas) y lo que el usuario pliega vive en `plegados` por línea de apertura.

    Con algo plegado el editor deja de pintar por número de línea y pinta por POSICIÓN VISIBLE: las
    líneas ocultas se saltan y las de abajo suben. Por eso todo lo que traduce y↔línea y todo lo que
    posiciona (cursor, selección, diagnósticos) pasa por `lineasVisibles`.
  */
  const pliegues = React.useMemo<FoldRange[]>(() => computeFoldRanges(snapshot.text), [snapshot.text]);
  const [plegados, setPlegados] = React.useState<Set<number>>(new Set());
  const activos = React.useMemo(
    () => pliegues.filter((r) => plegados.has(r.fromLine)),
    [pliegues, plegados]
  );
  const lineasVisibles = React.useMemo(() => {
    if (!activos.length) return null; // sin plegar: se usa el número de línea directo
    const ocultas = new Set<number>();
    for (const r of activos) for (let l = r.fromLine + 1; l <= r.toLine; l++) ocultas.add(l);
    const out: number[] = [];
    for (let l = 0; l < lineCount; l++) if (!ocultas.has(l)) out.push(l);
    return out;
  }, [activos, lineCount]);
  const totalVisibles = lineasVisibles ? lineasVisibles.length : lineCount;
  /**
   * Posición visible de una línea, o `null` si está plegada. Todo lo que se PINTA por línea
   * (cursor, selección, coincidencias, diagnósticos) pasa por aquí: sin esto, un rectángulo de una
   * línea oculta se dibujaría encima de la que ocupa su sitio.
   */
  const posicionDe = React.useCallback(
    (line: number): number | null => {
      if (lineasVisibles) {
        const i = lineasVisibles.indexOf(line);
        return i < 0 ? null : i;
      }
      return line;
    },
    [lineasVisibles]
  );
  const contentHeight = totalVisibles * LINE_HEIGHT + TOP_PAD * 2;

  const first = clamp(Math.floor(scrollTop / LINE_HEIGHT) - OVERSCAN, 0, Math.max(0, totalVisibles - 1));
  const last = clamp(Math.ceil((scrollTop + viewportHeight) / LINE_HEIGHT) + OVERSCAN, 0, Math.max(0, totalVisibles - 1));

  // --- sincronización con el padre -----------------------------------------------------------
  React.useEffect(() => {
    if (value === emittedRef.current) return;
    model.setText(value);
    bumpEdit();
    forceRender();
  }, [value, model]);

  // --- medidas ------------------------------------------------------------------------------
  React.useEffect(() => {
    const measure = () => {
      const el = scrollerRef.current;
      if (!el) return;
      const cs = getComputedStyle(el);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const width = ctx.measureText("M").width;
      if (width > 0) setCharWidth(width);
    };
    measure();
    void document.fonts?.ready.then(measure);
  }, []);

  React.useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setViewportHeight(el.clientHeight);
      setViewportWidth(el.clientWidth);
    });
    observer.observe(el);
    setViewportHeight(el.clientHeight);
    setViewportWidth(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  // --- ayudas de edición --------------------------------------------------------------------
  React.useLayoutEffect(() => {
    if (!pendingScrollRef.current) return;
    pendingScrollRef.current = false;
    const el = scrollerRef.current;
    if (!el) return;
    const { line, col } = model.positionAt(selection.head);
    const visibleLine = posicionDe(line) ?? line;
    const lineTop = TOP_PAD + visibleLine * LINE_HEIGHT;
    const lineBottom = lineTop + LINE_HEIGHT;
    if (lineTop - TOP_PAD < el.scrollTop) {
      el.scrollTop = Math.max(0, lineTop - TOP_PAD);
    } else if (lineBottom + TOP_PAD > el.scrollTop + el.clientHeight) {
      el.scrollTop = lineBottom + TOP_PAD - el.clientHeight;
    }
    const left = gutterWidth + col * charWidth;
    if (left < el.scrollLeft + gutterWidth) {
      el.scrollLeft = Math.max(0, left - gutterWidth);
    } else if (left + charWidth > el.scrollLeft + el.clientWidth) {
      el.scrollLeft = left + charWidth - el.clientWidth;
    }
    if (el.scrollTop !== scrollTop) {
      setScrollTop(el.scrollTop);
    }
  }, [model, selection.head, posicionDe, gutterWidth, charWidth, scrollTop, editVersion]);

  const commit = React.useCallback(
    (next: { text: string; selection: Selection }) => {
      emittedRef.current = next.text;
      onChange?.(next.text);
      pendingScrollRef.current = true;
      bumpEdit();
      forceRender();
    },
    [onChange]
  );

  const moveTo = React.useCallback(
    (offset: number, extend: boolean) => {
      const clampOffset = clamp(offset, 0, model.length);
      const next = model.setSelection(extend ? { anchor: selection.anchor, head: clampOffset } : collapse(clampOffset));
      pendingScrollRef.current = true;
      forceRender();
      const { line, col } = model.positionAt(next.selection.head);
      void line;
      goalColumnRef.current = col;
    },
    [model, selection.anchor]
  );

  const vertical = React.useCallback(
    (direction: -1 | 1, extend: boolean) => {
      const { line, col } = model.positionAt(selection.head);
      const goal = goalColumnRef.current ?? col;
      const targetLine = clamp(line + direction, 0, lineCount - 1);
      const targetCol = Math.min(goal, model.line(targetLine).length);
      moveTo(model.offsetAt(targetLine, targetCol), extend);
      goalColumnRef.current = goal;
    },
    [model, selection.head, lineCount, moveTo]
  );

  const offsetFromPoint = React.useCallback(
    (clientX: number, clientY: number): number => {
      const el = scrollerRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left - gutterWidth + el.scrollLeft;
      const y = clientY - rect.top - TOP_PAD + el.scrollTop;
      const indice = clamp(Math.floor(y / LINE_HEIGHT), 0, Math.max(0, totalVisibles - 1));
      const line = lineasVisibles ? (lineasVisibles[indice] ?? 0) : indice;
      const col = clamp(Math.round(x / charWidth), 0, model.line(line).length);
      return model.offsetAt(line, col);
    },
    [model, totalVisibles, lineasVisibles, gutterWidth, charWidth]
  );

  /** Abre o refresca el popup con el prefijo que hay entre `from` y el cursor. */
  const refreshPopup = React.useCallback(
    (force = false) => {
      if (!suggest) return;
      const caret = model.selection.head;
      const win = completionWindow(model.text, caret);
      const previous = popup;
      if (!force && !previous && !win.prefix) return;
      const items = rankSuggestions(suggest({ text: model.text, offset: caret }), win.prefix);
      if (!items.length) {
        setPopup(null);
        return;
      }
      setPopup({
        from: win.from,
        prefix: win.prefix,
        items,
        index: previous && previous.from === win.from ? Math.min(previous.index, items.length - 1) : 0,
      });
    },
    [suggest, model, popup]
  );

  const accept = React.useCallback(
    (item: Suggestion) => {
      const caret = model.selection.head;
      const start = popup?.from ?? completionWindow(model.text, caret).from;
      setPopup(null);
      const insert = insertionFor(item);
      const snapshot = model.insertAt(start, caret, insert);
      commit(snapshot);
    },
    [model, popup, commit]
  );

  const onMouseDown = (e: React.MouseEvent) => {
    /*
      F2 — ⌥clic añade un cursor (⇧⌥clic extiende el último). Si el clic cae EXACTAMENTE donde ya
      hay un cursor vacío, lo quita: es el gesto de deshacer un multicursor mal puesto sin tener
      que ir a ⎋ y perder todos.
    */
    if (e.altKey) {
      e.preventDefault();
      const offset = offsetFromPoint(e.clientX, e.clientY);
      const existente = model.selections.findIndex(
        (s) => s.anchor === s.head && s.head === offset
      );
      if (existente >= 0) {
        model.removeSelectionAt(existente);
      } else if (e.shiftKey) {
        const primaria = model.selection;
        model.addSelection({ anchor: primaria.anchor, head: offset });
      } else {
        model.addSelection(collapse(offset));
      }
      forceRender();
      textareaRef.current?.focus();
      return;
    }
    if (e.button !== 0) return;
    e.preventDefault();
    textareaRef.current?.focus();
    const offset = offsetFromPoint(e.clientX, e.clientY);
    const anchor = e.shiftKey ? selection.anchor : offset;
    const next = model.setSelection(e.shiftKey ? { anchor, head: offset } : collapse(offset));
    void next;
    goalColumnRef.current = model.positionAt(offset).col;
    if (composing !== null) setComposing(null);
    setPopup(null);
    forceRender();

    const move = (ev: MouseEvent) => {
      model.setSelection({ anchor, head: offsetFromPoint(ev.clientX, ev.clientY) });
      forceRender();
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // --- teclado ------------------------------------------------------------------------------
  /**
   * F2 — «añadir la selección a la siguiente coincidencia» (⌃G, como IntelliJ).
   *
   * Sin selección, toma la palabra bajo el cursor. Busca HACIA DELANTE desde el final de la
   * selección primaria y, si llega al final del documento sin encontrarla, no hace nada (no da la
   * vuelta: añadir un cursor al principio mientras el usuario mira el final es desconcertante).
   */
  function addNextOccurrence() {
    const primaria = model.selection;
    const texto = model.text;
    let inicio = from(primaria);
    let fin = to(primaria);
    if (inicio === fin) {
      const palabra = model.wordRangeAt(primaria.head);
      if (palabra.from === palabra.to) return;
      inicio = palabra.from;
      fin = palabra.to;
      model.setSelection({ anchor: inicio, head: fin });
    }
    const termino = texto.slice(inicio, fin);
    const siguiente = texto.indexOf(termino, fin);
    if (siguiente < 0) return;
    model.addSelection({ anchor: siguiente, head: siguiente + termino.length });
    forceRender();
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || composing !== null) return;
    const mod = e.metaKey;
    const alt = e.altKey;
    const shift = e.shiftKey;
    const key = e.key;
    const caretOffset = selection.head;
    const line = model.positionAt(caretOffset).line;

    const handled = (fn: () => void) => {
      e.preventDefault();
      fn();
    };

    // ⌘⌫ (#35) y el alias ⌘⇧K de la app: borran la LÍNEA. Sin este caso, ⌘⌫ caía en el `case
    // "Backspace"` de abajo y borraba un carácter (el `mod` no se miraba): medido con teclas reales
    // el 2026-10-21 en `uno;\ndos;` con el cursor en la línea 2 → `uno;dos;`.
    if (mod && key === "Backspace") return handled(() => commit(model.deleteLine()));
    if (mod && shift && key.toLowerCase() === "k") return handled(() => commit(model.deleteLine()));

    switch (key) {
      case "Enter":
        return handled(() => commit(model.newline()));
      case "Backspace":
        return handled(() => commit(model.deleteBackward(alt)));
      case "Delete":
        return handled(() => commit(model.deleteForward(alt)));
      case "Tab":
        return handled(() => commit(shift ? model.outdent() : model.indent()));
      case "ArrowLeft": {
        const target = mod
          ? model.offsetAt(line, 0)
          : alt
            ? model.wordStartBefore(caretOffset)
            : Math.max(0, caretOffset - 1);
        return handled(() => moveTo(target, shift));
      }
      case "ArrowRight": {
        const target = mod
          ? model.offsetAt(line, model.line(line).length)
          : alt
            ? model.wordEndAfter(caretOffset)
            : Math.min(model.length, caretOffset + 1);
        return handled(() => moveTo(target, shift));
      }
      case "ArrowUp":
        return handled(() => vertical(-1, shift));
      case "ArrowDown":
        return handled(() => vertical(1, shift));
      case "Home":
        return handled(() => moveTo(mod ? 0 : model.offsetAt(line, 0), shift));
      case "End":
        return handled(() => moveTo(mod ? model.length : model.offsetAt(line, model.line(line).length), shift));
      default:
        break;
    }

    if (mod && key.toLowerCase() === "a") {
      return handled(() => {
        model.setSelection({ anchor: 0, head: model.length });
        forceRender();
      });
    }
    if (mod && key.toLowerCase() === "z") {
      return handled(() => commit(shift ? model.redo() : model.undo()));
    }
    if (mod && key.toLowerCase() === "d") {
      // Se MANTIENE ⌘D = duplicar línea (IntelliJ/DataGrip). El multicursor se añade con ⌥clic y con
      // ⌃G, para no romper el atajo que el usuario ya tiene en los dedos.
      return handled(() => commit(model.duplicateLine()));
    }
    if (e.ctrlKey && !mod && key.toLowerCase() === "g") {
      return handled(() => addNextOccurrence());
    }
    if (key === "Escape" && model.selections.length > 1) {
      // Colapsa a la selección primaria: la forma rápida de «salir» del multicursor.
      return handled(() => {
        model.setSelections([model.selection], 0);
        forceRender();
      });
    }
    /*
      Comentarios. Se casa por `code` y no por `key` porque con ⌥ pulsada macOS NO entrega «/» ni «a»:
      entrega «÷» y «å». Aquel `key === "/"` hacía que ⌘⌥/ (comentario de bloque, #33) comentara con
      `--` como si no llevara ⌥, y que el alias ⌥A escribiera «å» en el documento. Medido el
      2026-10-21 con teclas reales.
    */
    if (mod && e.code === "Slash") {
      return handled(() => commit(alt ? model.toggleBlockComment() : model.toggleComment()));
    }
    if (alt && !mod && e.code === "KeyA") {
      return handled(() => commit(model.toggleBlockComment()));
    }
    /*
      ⌘G / ⇧⌘G (#57): siguiente/anterior coincidencia. La barra de buscar ya tenía `next`/`previous`
      en su handle, pero NADIE los llamaba desde el teclado: la sonda los midió el 2026-10-21 y el
      contador se quedaba en «1 de 3». Con la barra cerrada se abre (sin reemplazo), que es lo que
      hace DataGrip con ⌘G sin búsqueda previa.
    */
    if (mod && !alt && key.toLowerCase() === "g") {
      return handled(() => {
        if (!findOpen) {
          setFindReplace(false);
          setFindOpen(true);
          return;
        }
        if (shift) findRef.current?.previous();
        else findRef.current?.next();
      });
    }
    // ⌘L (#61) y su alias ⌘⌥G: «Ir a la línea». El ⌘⌥G va ANTES del ⌘G de arriba, que si no se lo
    // comería (los dos son «g»).
    if ((mod && !alt && key.toLowerCase() === "l") || (mod && alt && key.toLowerCase() === "g")) {
      return handled(() => {
        setGotoValue("");
        setGotoOpen(true);
      });
    }
    // ⌘C/⌘X/⌘V y todo lo demás: lo atienden los eventos nativos (copy/cut/paste) o el IME.
  };

  /** ⌥↑/⌥↓ mueven la línea; sin ⌥, la flecha mueve el cursor. Se decide antes del `switch`. */
  const onKeyDownWrapped = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const accion = editorActionFor(e);
    if (accion && onAction) {
      e.preventDefault();
      e.stopPropagation();
      onAction(accion);
      return;
    }
    if (e.metaKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      e.stopPropagation();
      setFindReplace(false);
      setFindOpen(true);
      return;
    }
    if (e.metaKey && e.key.toLowerCase() === "r") {
      // ⌘R es «Reemplazar» en el editor (el enrutador global ya no lo ve: el editor se clasifica
      // como `editor`, y `esTeclaDelEditor(⌘R)` es cierto por la fila #54 del registro).
      e.preventDefault();
      e.stopPropagation();
      setFindReplace(true);
      setFindOpen(true);
      return;
    }
    if (popup) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setPopup({ ...popup, index: (popup.index + delta + popup.items.length) % popup.items.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const item = popup.items[popup.index];
        if (item) accept(item);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPopup(null);
        return;
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") setPopup(null);
    }
    if (e.ctrlKey && e.key === " ") {
      e.preventDefault();
      refreshPopup(true);
      return;
    }
    if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      commit(model.moveLines(e.key === "ArrowUp" ? -1 : 1));
      return;
    }
    onKeyDown(e);
  };

  // --- entrada de texto ---------------------------------------------------------------------
  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const text = el.value;
    el.value = "";
    if (!text) return;
    if (skipInputRef.current) {
      skipInputRef.current = false;
      return;
    }
    if ((e.nativeEvent as InputEvent).isComposing) return;
    commit(model.insert(text));
    // El popup se abre con la primera letra de una palabra (y tras un `.`), no tras espacio ni coma;
    // la excepción es `JOIN ␣` / `ON ␣`, donde salen las relaciones por clave foránea (R89).
    const caretAhora = model.selection.head;
    if (
      suggest &&
      (shouldOpenAfter(text.slice(-1)) ||
        (text === " " && shouldOpenAfterSpace(model.text.slice(Math.max(0, caretAhora - 12), caretAhora))))
    ) {
      refreshPopup(true);
    } else {
      setPopup(null);
    }
  };

  const onCompositionStart = () => setComposing("");
  const onCompositionUpdate = (e: React.CompositionEvent<HTMLTextAreaElement>) => setComposing(e.data ?? "");
  const onCompositionEnd = (e: React.CompositionEvent<HTMLTextAreaElement>) => {
    const text = e.data ?? "";
    setComposing(null);
    skipInputRef.current = true;
    // El `input` que macOS manda después de `compositionend` llega en el mismo tick; si no llega,
    // la bandera no puede quedarse puesta o se comería el SIGUIENTE tecleo.
    setTimeout(() => {
      skipInputRef.current = false;
    }, 0);
    if (text) commit(model.insert(text));
  };

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text/plain").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (!text) return;
    e.preventDefault();
    commit(model.insert(text));
  };

  const selectedText = () => model.text.slice(selFrom, selTo);

  const onCopy = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = selectedText();
    if (!text) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", text);
  };

  const onCut = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = selectedText();
    if (!text) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", text);
    commit(model.insert("", "delete"));
  };

  // --- pintura ------------------------------------------------------------------------------
  const visibleLines = React.useMemo(() => {
    const lines: string[] = [];
    for (let posicion = first; posicion <= last; posicion++) {
      const line = lineasVisibles ? (lineasVisibles[posicion] ?? 0) : posicion;
      lines.push(model.line(line));
    }
    return lines;
    // `snapshot.text` no se usa dentro: es la dependencia que invalida el bloque al editar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, first, last, snapshot.text, lineasVisibles]);

  /**
   * Ancho del contenido: la línea más larga por el ancho de carácter. Recorrer 10 000 líneas por
   * pulsación es ~0,2 ms (medido con el perfil del carril de rendimiento) y evita el «salto» del
   * scroll horizontal cuando se teclea al final de la línea más larga.
   */
  const maxLineLength = React.useMemo(() => {
    let max = 0;
    for (let i = 0; i < model.lineCount; i++) max = Math.max(max, model.line(i).length);
    return max;
    // `snapshot.text` es la dependencia que invalida el ancho al editar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, snapshot.text]);
  const contentWidth = Math.round(gutterWidth + maxLineLength * charWidth + 48);

  const tokensByLine = React.useMemo(
    () => highlightLines(visibleLines, dialecto, nombres),
    [visibleLines, dialecto, nombres]
  );

  const renderTokens = (line: string, tokens: Token[]) => {
    if (!tokens.length) return line;
    const out: React.ReactNode[] = [];
    let at = 0;
    tokens.forEach((token, index) => {
      if (token.from > at) out.push(line.slice(at, token.from));
      out.push(
        <span key={index} className={token.cls}>
          {line.slice(token.from, token.to)}
        </span>
      );
      at = token.to;
    });
    if (at < line.length) out.push(line.slice(at));
    return out;
  };

  /*
    F2: se pintan TODAS las selecciones del modelo, no solo la primaria. Con un cursor simple esto
    es un rectángulo; con multicursor, uno por rango. El bucle por línea se conserva para los
    rangos que ocupan varias líneas.
  */
  const selections: React.ReactNode[] = [];
  model.selections.forEach((sel, selIndex) => {
    const selFrom = from(sel);
    const selTo = to(sel);
    if (selTo <= selFrom) return;
    for (let posicion = first; posicion <= last; posicion++) {
      const i = lineasVisibles ? (lineasVisibles[posicion] ?? 0) : posicion;
      const lineStart = model.offsetAt(i, 0);
      const lineEnd = model.offsetAt(i, model.line(i).length);
      if (selFrom > lineEnd && i < lineCount - 1) continue;
      if (selTo < lineStart) break;
      const startCol = Math.max(0, selFrom - lineStart);
      const endCol = Math.min(model.line(i).length, selTo - lineStart);
      const coversNewline = selTo > lineEnd;
      const width = Math.max(0, (coversNewline ? model.line(i).length - startCol : endCol - startCol) * charWidth);
      if (!width && !coversNewline) continue;
      selections.push(
        <div
          key={`sel-${selIndex}-${i}`}
          className="ld-selection"
          style={{ top: TOP_PAD + posicion * LINE_HEIGHT, left: gutterWidth + startCol * charWidth, width }}
        />
      );
    }
  });

  const caretIndex = lineasVisibles ? Math.max(0, lineasVisibles.indexOf(caret.line)) : caret.line;
  const caretLeft = gutterWidth + caret.col * charWidth;

  /*
    Contorno de la SENTENCIA ACTUAL (como DataGrip): una línea verde de 1 px alrededor del texto de
    la sentencia en la que está el cursor; ninguna si el cursor está entre dos. Medido en una captura
    de DataGrip (2026-10-21): el borde izquierdo va pegado al principio del texto, y el derecho baja
    en ESCALERA: en cada línea llega hasta la más larga de esa línea y las de debajo, así que el
    contorno se estrecha hacia abajo cuando la última línea es más corta. Se reproduce igual: el
    derecho de cada fila es el máximo de los finales desde esa fila hasta la última.
    Con multicursor no se pinta (¿de qué cursor sería?); con líneas plegadas dentro, se salta lo
    oculto (las posiciones visibles siguen siendo consecutivas).
  */
  const sentencia = React.useMemo(
    () =>
      currentStatement && model.selections.length === 1 ? currentStatement(snapshot.text, selection.head) : null,
    // `model.selections` es estado mutable del modelo; `snapshot.text` y `selection` cambian con él.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentStatement, snapshot.text, selection.head, selection.anchor]
  );
  let contornoSentencia: React.ReactNode = null;
  if (sentencia && sentencia.to > sentencia.from) {
    const ini = model.positionAt(sentencia.from);
    const fin = model.positionAt(sentencia.to);
    const filas: { pos: number; end: number; start: number | null }[] = [];
    for (let l = ini.line; l <= fin.line; l++) {
      const pos = posicionDe(l);
      if (pos === null) continue;
      const texto = model.line(l);
      const end = l === fin.line ? fin.col : texto.length;
      const primera = texto.search(/\S/);
      const start = l === ini.line ? ini.col : primera >= 0 && primera < end ? primera : null;
      filas.push({ pos, end, start });
    }
    if (filas.length) {
      const leftCol = Math.min(...filas.map((f) => (f.start === null ? Infinity : f.start)));
      const xL = gutterWidth + (Number.isFinite(leftCol) ? leftCol : 0) * charWidth - 3.5;
      // Escalera: el derecho de cada fila es el máximo de los finales desde ella hasta abajo.
      const derechos = filas.map((_, k) => Math.max(...filas.slice(k).map((f) => f.end)));
      const xR = (k: number) => gutterWidth + derechos[k] * charWidth + 3.5;
      const yTop = (k: number) => TOP_PAD + filas[k].pos * LINE_HEIGHT + 0.5;
      const yBottom = TOP_PAD + (filas[filas.length - 1].pos + 1) * LINE_HEIGHT - 0.5;
      let d = `M ${xL} ${yTop(0)} H ${xR(0)}`;
      for (let k = 1; k < filas.length; k++) {
        if (derechos[k] !== derechos[k - 1]) d += ` V ${yTop(k)} H ${xR(k)}`;
      }
      d += ` V ${yBottom} H ${xL} Z`;
      contornoSentencia = (
        <svg className="ld-statement" aria-hidden data-testid="contorno-sentencia">
          <path d={d} />
        </svg>
      );
    }
  }
  const caretTop = TOP_PAD + caretIndex * LINE_HEIGHT;
  const popupPos = popup ? model.positionAt(popup.from) : null;
  const popupVisibleLine = popupPos ? (posicionDe(popupPos.line) ?? popupPos.line) : 0;
  const popupPlacement = popup
    ? popupVerticalPlacement({
        itemCount: popup.items.length,
        lineTop: TOP_PAD + popupVisibleLine * LINE_HEIGHT,
        lineHeight: LINE_HEIGHT,
        scrollTop,
        viewportHeight,
        contentHeight,
      })
    : null;
  const popupMaxWidth = Math.max(240, viewportWidth - gutterWidth - 12);
  const popupWidth = popup ? popupWidthFor(popup.items, popupMaxWidth) : 0;
  const popupLeft =
    popup && popupPos
      ? Math.max(
          gutterWidth,
          Math.min(gutterWidth + popupPos.col * charWidth, Math.max(contentWidth, viewportWidth) - popupWidth - 12)
        )
      : 0;

  /**
   * Rectángulos de un conjunto de rangos, solamente de las líneas visibles. Se recorre la lista (ya
   * ordenada por `from`) y se corta cuando pasa de la ventana: con 999 coincidencias y 40 líneas,
   * recorrer las 999 es más barato que preguntar por cada línea si cae en cada rango.
   */
  const rangeRects = (ranges: readonly { from: number; to: number }[], className: string) => {
    const rects: React.ReactNode[] = [];
    ranges.forEach((range, index) => {
      const start = model.positionAt(range.from);
      const fila = posicionDe(start.line);
      if (fila === null || fila > last || fila < first) return;
      const end = model.positionAt(Math.max(range.to, range.from + 1));
      const startCol = range.from - model.offsetAt(start.line, 0);
      const endCol = end.line === start.line ? end.col : model.line(start.line).length;
      const width = Math.max(2, (endCol - startCol) * charWidth);
      rects.push(
        <div
          key={`${className}-${index}`}
          className={className}
          style={{
            top: TOP_PAD + fila * LINE_HEIGHT,
            left: gutterWidth + startCol * charWidth,
            width,
          }}
        />
      );
    });
    return rects;
  };

  /** Líneas (visibles) con un diagnóstico que empieza en ellas: el punto del canal. */
  const lintLines = new Set<number>();
  for (const d of diagnostics ?? []) {
    const line = model.positionAt(d.from).line;
    if (line >= first && line <= last) lintLines.add(line);
  }

  // El elemento se publica al montar y se retira al desmontar: la consola no tiene que esperar
  // a un segundo render para tener el destino de sus CustomEvent.
  React.useEffect(() => {
    onElement?.(rootRef.current);
    return () => onElement?.(null);
  }, [onElement]);

  React.useImperativeHandle(
    ref,
    () => ({
      get element() {
        return rootRef.current;
      },
      focus: () => textareaRef.current?.focus(),
      getText: () => model.text,
      getSelection: () => {
        const sel = model.selection;
        return { from: Math.min(sel.anchor, sel.head), to: Math.max(sel.anchor, sel.head) };
      },
      setSelection: (from: number, to: number) => {
        model.setSelection({ anchor: from, head: to });
        pendingScrollRef.current = true;
        forceRender();
      },
      replaceSelection: (text: string) => commit(model.insert(text)),
      insertAtCursor: (text: string) => commit(model.insert(text)),
      selectAll: () => {
        model.setSelection({ anchor: 0, head: model.length });
        forceRender();
        textareaRef.current?.focus();
      },
    }),
    [model, commit]
  );

  return (
    <div ref={rootRef} className={cn("ld-root", className)} style={{ minHeight }} data-testid="editor-propio">
      <div
        ref={scrollerRef}
        className="ld-scroller"
        style={{ minHeight }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onMouseDown={onMouseDown}
        onDoubleClick={(e) => {
          const offset = offsetFromPoint(e.clientX, e.clientY);
          const range = model.wordRangeAt(offset);
          model.setSelection({ anchor: range.from, head: range.to });
          forceRender();
        }}
      >
        <div className="ld-content" style={{ height: contentHeight, width: contentWidth }}>
          {/* Fila del cursor: el fondo de la línea activa, como DataGrip. Va detrás de todo. */}
          <div className="ld-active-line" style={{ top: TOP_PAD + caretIndex * LINE_HEIGHT }} />
          {contornoSentencia}
          {Array.from({ length: last - first + 1 }, (_, index) => {
            const posicion = first + index;
            const line = lineasVisibles ? (lineasVisibles[posicion] ?? 0) : posicion;
            const pliegue = pliegues.find((r) => r.fromLine === line);
            const plegado = pliegue ? plegados.has(pliegue.fromLine) : false;
            return (
              <div key={line} className="ld-line" style={{ top: TOP_PAD + posicion * LINE_HEIGHT }}>
                <span
                  className={line === caret.line ? "ld-ln ld-ln-activo" : "ld-ln"}
                  style={{ width: gutterWidth - GUTTER_INSET }}
                >
                  {lintLines.has(line) && <span className="ld-ln-lint" title="Hay una inspección en esta línea" />}
                  {line + 1}
                </span>
                {/* F2: la flecha de plegado, en el canal y solo donde hay un bloque que cerrar. */}
                {pliegue && (
                  <button
                    type="button"
                    className={plegado ? "ld-fold ld-fold-cerrado" : "ld-fold"}
                    title={plegado ? "Desplegar bloque" : "Plegar bloque"}
                    aria-expanded={!plegado}
                    style={{ left: gutterWidth - GUTTER_INSET - 12 }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setPlegados((prev) => {
                        const next = new Set(prev);
                        if (next.has(pliegue.fromLine)) next.delete(pliegue.fromLine);
                        else next.add(pliegue.fromLine);
                        return next;
                      });
                    }}
                  >
                    {plegado ? "▸" : "▾"}
                  </button>
                )}
                <span className="ld-text" style={{ left: gutterWidth }}>
                  {renderTokens(model.line(line), tokensByLine[index] ?? [])}
                  {plegado && pliegue && (
                    <span className="ld-fold-badge" title={`${pliegue.toLine - pliegue.fromLine} líneas plegadas`}>
                      ⋯ {pliegue.toLine - pliegue.fromLine}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
          {rangeRects(findMatches, "ld-find")}
          {(diagnostics ?? []).map((d, index) => {
            const start = model.positionAt(d.from);
            const filaDiag = posicionDe(start.line);
            if (filaDiag === null || filaDiag < first || filaDiag > last) return null;
            const end = model.positionAt(Math.max(d.to, d.from + 1));
            const startCol = d.from - model.offsetAt(start.line, 0);
            const endCol = end.line === start.line ? end.col : model.line(start.line).length;
            return (
              <div
                key={`lint-${index}`}
                className="ld-lint"
                title={d.message}
                style={{
                  top: TOP_PAD + filaDiag * LINE_HEIGHT,
                  left: gutterWidth + startCol * charWidth,
                  width: Math.max(2, (endCol - startCol) * charWidth),
                  borderBottomColor: d.severity === "error" ? "var(--gdb-icred)" : "var(--gdb-warn)",
                }}
              />
            );
          })}
          {selections}
          {focused &&
            composing === null &&
            model.selections.map((sel, index) => {
              const pos = model.positionAt(sel.head);
              return (
                <div
                  key={`caret-${index}`}
                  className={index === model.primarySelection ? "ld-caret" : "ld-caret ld-caret-sec"}
                  style={{ top: TOP_PAD + pos.line * LINE_HEIGHT, left: gutterWidth + pos.col * charWidth }}
                />
              );
            })}
          {composing !== null && composing !== "" && (
            <span className="ld-composing" style={{ top: caretTop, left: caretLeft }}>
              {composing}
            </span>
          )}
          {popup && popupPlacement && (
            <div
              className="ld-popup"
              style={{
                // Anclado al INICIO de la palabra que se completa, no al cursor (como VS Code):
                // cuando el prefijo crece, el popup no se va corriendo hacia la derecha.
                top: popupPlacement.top,
                bottom: popupPlacement.bottom,
                maxHeight: popupPlacement.maxHeight,
                // R89: el ancho sale de la fila MÁS LARGA (antes, tope fijo de 340 px y los nombres
                // largos —`banks_deposits_bankdeposit`— se cortaban con «…»), acotado al área visible.
                // Si aun así no cabe, se recorta el detalle de la derecha, nunca el nombre (CSS).
                width: popupWidth,
                left: popupLeft,
              }}
              onMouseDown={(e) => e.preventDefault()}
            >
              {popup.items.map((item, index) => (
                <div
                  key={`${item.label}-${index}`}
                  className={[
                    "ld-popup-item",
                    `ld-popup-item-${item.kind ?? "snippet"}`,
                    index === popup.index ? "ld-popup-item-sel" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  // El texto completo en el tooltip: si el detalle se recortó, se lee al pasar el ratón.
                  title={item.detail ? `${item.label} — ${item.detail}` : item.label}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    accept(item);
                  }}
                >
                  <IconoDeKind kind={item.kind} />
                  <span className="ld-popup-label">
                    {highlightPrefix(item.label, popup.prefix)}
                  </span>
                  {item.detail && <span className="ld-popup-detail">{item.detail}</span>}
                </div>
              ))}
            </div>
          )}
          {/* El campo invisible vive DENTRO del contenido desplazado: así su `top`/`left` están en
              coordenadas del documento y el IME abre su ventanita junto al cursor de verdad. */}
          <textarea
          ref={textareaRef}
          className="ld-input"
          style={{ top: caretTop, left: caretLeft }}
          value=""
          onChange={() => {}}
          onInput={onInput}
          onKeyDown={onKeyDownWrapped}
          onCompositionStart={onCompositionStart}
          onCompositionUpdate={onCompositionUpdate}
          onCompositionEnd={onCompositionEnd}
          onPaste={onPaste}
          onCopy={onCopy}
          onCut={onCut}
          onFocus={() => {
            setFocused(true);
            goalColumnRef.current = model.positionAt(model.selection.head).col;
          }}
          onBlur={() => setFocused(false)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Editor SQL"
          aria-multiline="true"
          />
        </div>
      </div>
      {/*
        ⌘L — «Ir a la línea». Acepta «12» o «12:8» (línea:columna), como el diálogo de DataGrip. Se
        ancla arriba a la derecha con el mismo aspecto de la barra de buscar; `⏎` salta, `⎋` cierra.
        El salto mueve la selección y el efecto de scroll del editor se encarga de dejarla a la vista.
      */}
      {gotoOpen && (
        <div
          className="absolute right-2 top-1 z-30 flex items-center gap-1.5 rounded-sm border border-gdb-borderstrong bg-gdb-chrome px-1.5 py-1 font-sans text-xs text-gdb-fg shadow-md"
          data-testid="editor-goto-line"
        >
          <span className="shrink-0 text-gdb-fg/60">Ir a la línea:</span>
          <input
            autoFocus
            className="w-16 bg-transparent font-mono text-[12px] text-gdb-fg outline-none placeholder:text-gdb-fg/35"
            value={gotoValue}
            placeholder="12:8"
            onChange={(ev) => setGotoValue(ev.target.value.replace(/[^0-9:]/g, ""))}
            onKeyDown={(ev) => {
              if (ev.key === "Escape") {
                ev.preventDefault();
                setGotoOpen(false);
                textareaRef.current?.focus();
                return;
              }
              if (ev.key !== "Enter") return;
              ev.preventDefault();
              const [lineaTexto, columnaTexto] = gotoValue.split(":");
              const pedida = Number(lineaTexto);
              if (Number.isFinite(pedida) && pedida > 0) {
                const linea = clamp(pedida - 1, 0, model.lineCount - 1);
                const columna = clamp((Number(columnaTexto) || 1) - 1, 0, model.line(linea).length);
                const destino = model.offsetAt(linea, columna);
                model.setSelection({ anchor: destino, head: destino });
                pendingScrollRef.current = true;
                forceRender();
              }
              setGotoOpen(false);
              textareaRef.current?.focus();
            }}
            aria-label="Ir a la línea"
          />
        </div>
      )}
      <OwnFindBar
        ref={findRef}
        model={model}
        open={findOpen}
        replaceMode={findReplace}
        docVersion={editVersion}
        onModeChange={setFindReplace}
        onClose={() => {
          setFindOpen(false);
          textareaRef.current?.focus();
        }}
        onCommit={(snapshot) => commit(snapshot)}
        onRender={() => forceRender()}
        onMatches={setFindMatches}
      />
    </div>
  );
});
