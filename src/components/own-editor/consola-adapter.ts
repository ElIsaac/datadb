/**
 * Adaptador de la consola SQL al editor propio (spike F2-B).
 *
 * LA CONSOLA NO SE REESCRIBE. `sql-editor.tsx` habla con CodeMirror a través de `cmRef.current.view`
 * (el documento, la selección, el dispatch) y de `cmRef.current.editor` (el elemento que recibe los
 * `CustomEvent` del keymap). Cambiar quince usos uno a uno sería reescribir la consola a mano y
 * arriesgar una regresión en cada uno; en su lugar, este módulo expone un objeto con LA MISMA FORMA
 * que lo que la consola ya usa, apoyándose en una `FuenteDeTexto` — una interfaz mínima que el
 * handle del editor propio satisface:
 *
 *   - `texto()`: el documento completo.
 *   - `seleccion()`: `{anchor, head}` en coordenadas del documento.
 *   - `aplicar(from, to, insert)`: reemplaza un rango.
 *   - `enfocar()`: pone el foco en el campo del editor.
 *   - `fijarSeleccion(anchor, head)`: cambia la selección sin tocar el texto.
 *
 * Los `CustomEvent` (`cm-run-query`, `cm-format-sql`…) se disparan igual que siempre: el editor
 * propio llama a `onAction` (⌘⏎, ⌘S, ⌘⌥L…) y el adaptador traduce acción → evento, que ya tiene su
 * listener en la consola. Ni una línea de los manejadores se toca.
 *
 * También queda cubierto `getTableReferenceAtCursor`, que usa `view.state.wordAt`: aquí se
 * implementa con la misma lógica de palabra del editor propio (`\p{L}`, acentos incluidos), así que
 * «Ir a la tabla referenciada» y el ER del ámbito siguen funcionando.
 */
import type { OwnEditorAction } from "@/components/own-editor/own-editor";

/** La selección, con la forma que la consola espera de CodeMirror. */
interface Seleccion {
  from: number;
  to: number;
  anchor: number;
  head: number;
  empty: boolean;
}

/** Lo que el adaptador necesita del editor. El `OwnEditorHandle` lo satisface. */
export interface FuenteDeTexto {
  texto(): string;
  seleccion(): { anchor: number; head: number };
  aplicar(from: number, to: number, insert: string): void;
  /** Pone el foco en el campo del editor (lo usa `view.focus()`). */
  enfocar(): void;
  /** Fija la selección sin tocar el texto (lo usa `dispatch({selection})`). */
  fijarSeleccion(anchor: number, head: number): void;
}

export interface ConsolaView {
  state: {
    doc: { toString(): string; length: number };
    selection: { main: Seleccion };
    /** Lo usa `getTableReferenceAtCursor` (la palabra bajo el cursor). */
    wordAt(pos: number): { from: number; to: number } | null;
    /** Lo usan el formateo y la IA (un rango como texto). */
    sliceDoc(from: number, to: number): string;
  };
  focus(): void;
  /** La forma mínima del dispatch de CodeMirror que la consola usa: `changes` y `selection`. */
  dispatch(tr: { changes?: unknown; selection?: unknown }): void;
}

const accionAEvento: Record<OwnEditorAction, string> = {
  run: "cm-run-query",
  save: "cm-save-query",
  format: "cm-format-sql",
  explain: "cm-explain-query",
  erDiagram: "cm-open-er-diagram",
  erDiagramScope: "cm-open-er-diagram-scope",
  aiSql: "cm-ai-sql",
};

/** Carácter de palabra, con la misma definición del modelo (acentos y `_`/`$`). */
const PALABRA = /[\p{L}\p{N}_$]/u;

function palabraEn(texto: string, offset: number): { from: number; to: number } | null {
  const dentro = Math.max(0, Math.min(offset, texto.length));
  if (!PALABRA.test(texto[dentro] ?? "") && !PALABRA.test(texto[dentro - 1] ?? "")) return null;
  let from = dentro;
  while (from > 0 && PALABRA.test(texto[from - 1])) from--;
  let to = dentro;
  while (to < texto.length && PALABRA.test(texto[to])) to++;
  return from === to ? null : { from, to };
}

/** Construye el par `{ view, editor, onAction }` sobre una `FuenteDeTexto`. */
function construir(fuente: FuenteDeTexto, obtenerElemento: () => HTMLElement | null) {
  const seleccion = (): Seleccion => {
    const sel = fuente.seleccion();
    const from = Math.min(sel.anchor, sel.head);
    const to = Math.max(sel.anchor, sel.head);
    return { from, to, anchor: sel.anchor, head: sel.head, empty: from === to };
  };

  const view: ConsolaView = {
    state: {
      doc: {
        toString: () => fuente.texto(),
        get length() {
          return fuente.texto().length;
        },
      },
      selection: { get main() { return seleccion(); } },
      wordAt: (pos: number) => palabraEn(fuente.texto(), pos),
      sliceDoc: (from: number, to: number) => fuente.texto().slice(from, to),
    },
    focus: () => fuente.enfocar(),
    dispatch: (tr) => {
      // La consola solo despacha `changes` (formatear, insertar SQL de la IA) y `selection`.
      const cambios = tr.changes;
      if (cambios && typeof cambios === "object" && "from" in (cambios as Record<string, unknown>)) {
        const c = cambios as { from: number; to: number; insert?: string };
        fuente.aplicar(c.from, c.to, c.insert ?? "");
        return;
      }
      const sel = tr.selection;
      if (sel && typeof sel === "object" && "anchor" in (sel as Record<string, unknown>)) {
        const s = sel as { anchor: number; head: number };
        fuente.fijarSeleccion(s.anchor, s.head);
      }
    },
  };

  return {
    view,
    get editor() {
      return obtenerElemento();
    },
    // Acción → el MISMO CustomEvent que ya tiene listener en la consola: cero duplicación.
    onAction: (accion: OwnEditorAction) => {
      obtenerElemento()?.dispatchEvent(new CustomEvent(accionAEvento[accion], { bubbles: true }));
    },
  };
}

/**
 * Adaptador directo con `FuenteDeTexto` explícita (para tests y para quien tenga el modelo).
 */
export function adaptadorDeConsola(
  fuente: FuenteDeTexto,
  obtenerElemento: () => HTMLElement | null
) {
  return construir(fuente, obtenerElemento);
}

/**
 * Versión PROXY para la consola: la fuente se arma sobre los refs (que aún no tienen el editor
 * montado) y consulta el handle y el elemento EN CADA USO. `aplicar` se compone con
 * `setSelection` + `replaceSelection` del handle: marca el rango y lo sustituye, que es
 * exactamente lo que hace un `changes: {from, to, insert}` de CodeMirror.
 */
export function adaptadorDeConsolaProxy(
  ownRef: { current: OwnEditorHandleLike | null },
  elementRef: { current: HTMLElement | null }
) {
  const fuente: FuenteDeTexto = {
    texto: () => ownRef.current?.getText() ?? "",
    seleccion: () => {
      const sel = ownRef.current?.getSelection() ?? { from: 0, to: 0 };
      return { anchor: sel.from, head: sel.to };
    },
    aplicar: (from, to, insert) => {
      // Marcar y sustituir: el camino del handle para reemplazar un rango cualquiera.
      ownRef.current?.setSelection(from, to);
      ownRef.current?.replaceSelection(insert);
    },
    enfocar: () => ownRef.current?.focus(),
    fijarSeleccion: (anchor, head) => ownRef.current?.setSelection(anchor, head),
  };
  return construir(fuente, () => elementRef.current);
}

/** La parte del `OwnEditorHandle` que el proxy usa (nombrada para no importar todo el tipo aquí). */
export interface OwnEditorHandleLike {
  getText(): string;
  getSelection(): { from: number; to: number };
  setSelection(from: number, to: number): void;
  replaceSelection(text: string): void;
  focus(): void;
}
