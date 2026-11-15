/**
 * Autocompletado del editor propio: la lógica, sin DOM.
 *
 * Lo que se reutiliza de la app NO es el popup de CodeMirror, es el modelo de datos: aquí se recibe
 * una lista plana de sugerencias (`Suggestion`) y se devuelve la ventana de texto que se va a
 * reemplazar. Quien conoce el esquema (tablas, columnas, alias) es el llamador — en la app, el
 * mismo `sql-scope.ts` que ya usa el editor de CodeMirror; en la demo, una lista fija.
 *
 * POR QUÉ ASÍ: el popup es la parte más fácil de hacer mal (foco, teclas, posición) y la más difícil
 * de probar en un test de UI. Todo lo decidible sin píxeles vive aquí y se prueba en Node: qué
 * palabra se está escribiendo, qué sugerencias casan y en qué orden, y qué texto entra al aceptar.
 */

/**
 * Tipos de sugerencia. `alias` (un alias de la consulta), `schema` (un esquema/base) y `join` (una
 * tabla o condición de JOIN sacada de una clave foránea) llegaron con el autocompletado por
 * contexto (R89): cada uno lleva su icono para que no se confundan con una tabla o una columna.
 */
export type SuggestionKind = "keyword" | "table" | "column" | "function" | "snippet" | "alias" | "schema" | "join";

export interface Suggestion {
  label: string;
  /** Texto secundario a la derecha (tipo, tabla de origen…). */
  detail?: string;
  /** Lo que se inserta; si falta, se inserta `label`. */
  insert?: string;
  kind?: SuggestionKind;
  /**
   * Grupo de ranking: menor = más arriba. Lo pone quien conoce el CONTEXTO (en la consola,
   * `sql-completion.ts`: las condiciones de JOIN por FK antes que las columnas, las columnas de la
   * consulta antes que las funciones…). Sin grupo, 0: el comportamiento de antes.
   */
  group?: number;
}

/** La palabra que se está escribiendo: desde `from` hasta el cursor. */
export interface CompletionWindow {
  from: number;
  prefix: string;
}

/**
 * Caracteres que forman la palabra que se completa. `$` y `_` entran (identificadores de SQL) y las
 * letras con acento también, aunque en un identificador normal no aparezcan: si el usuario las
 * teclea, el popup no debe quedarse pegado a media palabra.
 */
const WORD = /[\p{L}\p{N}_$]/u;

/**
 * Ventana de texto que reemplaza una sugerencia. Con el cursor pegado a una palabra, esa palabra;
 * tras un `.` (columna cualificada) la palabra empieza después del punto, para no comerse el alias.
 */
export function completionWindow(text: string, offset: number): CompletionWindow {
  const caret = Math.max(0, Math.min(offset, text.length));
  let from = caret;
  while (from > 0 && WORD.test(text[from - 1])) from--;
  return { from, prefix: text.slice(from, caret) };
}

/**
 * Ordena y filtra. Cuatro reglas, en este orden:
 *   1. prefijo literal (lo que empieza por lo tecleado) antes que subsecuencia;
 *   2. dentro de cada clase, el `group` del llamador (el contexto manda: con `FROM t ON │` la
 *      condición por FK va antes que cualquier columna que empiece igual);
 *   3. entre prefijos del mismo grupo, el más corto primero (`id` antes que `id_cliente`);
 *   4. entre subsecuencias del mismo grupo, el que «añade» menos (mismo criterio que el motor de Rust).
 * Sin prefijo (Ctrl+Space), se ordena solo por grupo y, dentro del grupo, en el orden del llamador.
 */
export function rankSuggestions(items: readonly Suggestion[], prefix: string, limit = 50): Suggestion[] {
  if (!prefix) {
    return items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => (a.item.group ?? 0) - (b.item.group ?? 0) || a.index - b.index)
      .slice(0, limit)
      .map((entry) => entry.item);
  }
  const needle = prefix.toLowerCase();
  const scored: { item: Suggestion; cls: number; score: number; index: number }[] = [];
  items.forEach((item, index) => {
    const label = item.label.toLowerCase();
    if (label.startsWith(needle)) {
      scored.push({ item, cls: 0, score: 1000 - label.length, index });
      return;
    }
    const sub = subsequence(label, needle);
    if (sub !== null) scored.push({ item, cls: 1, score: sub, index });
  });
  scored.sort(
    (a, b) =>
      a.cls - b.cls ||
      (a.item.group ?? 0) - (b.item.group ?? 0) ||
      b.score - a.score ||
      a.index - b.index
  );
  return scored.slice(0, limit).map((entry) => entry.item);
}

/**
 * Puntuación de subsecuencia: cada carácter tecleado tiene que aparecer en el nombre, en orden.
 * Premia los tramos contiguos y el empezar al principio. `null` si no casa.
 */
function subsequence(label: string, needle: string): number | null {
  let at = 0;
  let score = 0;
  let last = -2;
  for (const ch of needle) {
    const found = label.indexOf(ch, at);
    if (found === -1) return null;
    score += found === last + 1 ? 3 : 1;
    last = found;
    at = found + 1;
  }
  return score - label.length * 0.05;
}

/** Texto que entra al aceptar: `insert` si lo hay, y el `label` si no. */
export function insertionFor(item: Suggestion): string {
  return item.insert ?? item.label;
}

/**
 * Ancho del popup en px, a partir de la fila más larga (R89). Antes el popup tenía un tope fijo de
 * 340 px y los nombres largos salían cortados con «…» («no cabe la sugerencia y no se lee completa»).
 *
 * Se ESTIMA con el ancho medio de Inter (12 px la etiqueta, 11 px el detalle) en vez de medir el DOM:
 * medir obliga a un render de prueba y a leer un ref en render, y el lint del repo prohíbe lo
 * segundo. La estimación peca de ancha (mejor aire que un corte) y queda acotada a `[260, máximo]`;
 * si una fila aun así no cabe, el CSS recorta primero el detalle y deja el nombre entero.
 */
export function popupWidthFor(items: readonly Suggestion[], max: number): number {
  const LABEL_PX = 7; // media de Inter 12 con minúsculas y «_»
  const DETAIL_PX = 6.2; // media de Inter 11
  // padding del popup (3+3) + de la fila (6+6) + icono (16) + gap (8) + hueco del detalle (12) + barra (12)
  const CHROME = 66;
  let widest = 0;
  for (const item of items) {
    const w = item.label.length * LABEL_PX + (item.detail ? item.detail.length * DETAIL_PX + 12 : 0);
    if (w > widest) widest = w;
  }
  const upper = Math.max(260, Math.min(720, max));
  return Math.round(Math.min(upper, Math.max(260, widest + CHROME)));
}

const POPUP_ITEM_HEIGHT = 22;
const POPUP_CHROME_HEIGHT = 8;
const POPUP_MAX_HEIGHT = 264;
const POPUP_MIN_HEIGHT = 66;

export interface PopupVerticalPlacement {
  placeAbove: boolean;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/**
 * Vertical placement of the completion popup inside `.ld-content`.
 * Flips above the active line when space below is insufficient and there is more room above,
 * clamping `maxHeight` to the visible viewport so the popup is never clipped at the bottom.
 */
export function popupVerticalPlacement(params: {
  itemCount: number;
  lineTop: number;
  lineHeight: number;
  scrollTop: number;
  viewportHeight: number;
  contentHeight: number;
}): PopupVerticalPlacement {
  const { itemCount, lineTop, lineHeight, scrollTop, viewportHeight, contentHeight } = params;
  const lineBottom = lineTop + lineHeight;
  const spaceBelow = Math.max(0, scrollTop + viewportHeight - lineBottom);
  const spaceAbove = Math.max(0, lineTop - scrollTop);
  const estimatedHeight = Math.min(POPUP_MAX_HEIGHT, itemCount * POPUP_ITEM_HEIGHT + POPUP_CHROME_HEIGHT);
  const placeAbove = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
  const available = placeAbove ? spaceAbove : spaceBelow;
  const maxHeight = Math.min(POPUP_MAX_HEIGHT, Math.max(POPUP_MIN_HEIGHT, available - 4));
  if (placeAbove) {
    return { placeAbove: true, bottom: contentHeight - lineTop, maxHeight };
  }
  return { placeAbove: false, top: lineBottom, maxHeight };
}

/**
 * ¿Hay que abrir el popup después de este carácter? Se abre al teclear dentro de una palabra y
 * justo después de un `.`; NO tras un espacio, un paréntesis o una coma, donde el popup estorba.
 */
export function shouldOpenAfter(char: string): boolean {
  return char === "." || WORD.test(char);
}

/**
 * Excepción al «no tras un espacio»: detrás de `JOIN ` y de `ON ` el popup se abre solo, porque ahí
 * es donde el autocompletado ofrece las relaciones por clave foránea (R89) y el usuario no tiene que
 * saber que existen para verlas. En el resto, el espacio sigue cerrando el popup.
 */
export function shouldOpenAfterSpace(textBeforeCaret: string): boolean {
  return /\b(JOIN|ON)\s$/i.test(textBeforeCaret.slice(-12));
}
