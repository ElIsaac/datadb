/**
 * Núcleo del editor propio (spike F2-B): texto, cursor, navegación, edición y deshacer.
 *
 * POR QUÉ UN EDITOR PROPIO Y NO CODEMIRROR: el usuario lo pidió con una razón concreta —la
 * experiencia y la customización— después de que la barra de buscar/reemplazar demostrara que el
 * problema no era el motor de CodeMirror sino su pintura. Aquí se sigue la misma regla al revés:
 * TODO es nuestro, y lo que se reutiliza es lo que no se ve (el parser de SQL de Lezer para el
 * coloreado, que es una gramática, no una vista).
 *
 * QUÉ ES ESTO Y QUÉ NO (v0 del spike, a propósito):
 *   · SÍ: texto, cursor, selección, navegación por carácter/palabra/línea/inicio/fin, inserción,
 *     borrado, auto-sangría, tabular/destabular, duplicar y mover líneas, comentar, deshacer/rehacer.
 *   · NO todavía: multicursor, plegado, autocompletado, inspecciones y buscar/reemplazar. El orden
 *     importa: primero que teclear se sienta bien.
 *
 * POR QUÉ UN ARRAY DE LÍNEAS Y NO UNA CUERDA (rope): una consola de SQL de 10 000 líneas son ~1 MB,
 * y `split`/`join` de eso cuesta ~1-2 ms, muy por debajo de lo que se nota al teclear. El rope se
 * justifica con documentos de decenas de MB; no es el caso. La decisión se revisa con la medición
 * del carril de rendimiento (10 000 líneas, presupuesto: < 16 ms por pulsación).
 *
 * EL DOCUMENTO ES INMUTABLE DESDE FUERA: el componente recibe `text` y emite `onChange`. Este
 * módulo mantiene el estado de edición (cursor, historial) y devuelve un `EditorSnapshot` nuevo en
 * cada operación; así se puede probar en Node sin DOM, que es lo que hacen los tests de `model.test`.
 */

/** Un cambio de texto. `from`/`to` son offsets sobre el documento; `insert` es lo que entra. */
export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

/** Cursor y ancla. `head` es el extremo que se mueve; `anchor` el que se queda. */
export interface Selection {
  anchor: number;
  head: number;
}

/** Estado visible del editor en un instante. */
export interface EditorSnapshot {
  text: string;
  selection: Selection;
}

export const collapse = (offset: number): Selection => ({ anchor: offset, head: offset });

export const from = (s: Selection): number => Math.min(s.anchor, s.head);
export const to = (s: Selection): number => Math.max(s.anchor, s.head);

// --------------------------------------------------------------------------------------------
// 1. El texto: líneas, offsets y posiciones
// --------------------------------------------------------------------------------------------

/**
 * Buffer de líneas. Los offsets son posiciones en el texto completo (con `\n` entre líneas); las
 * posiciones son `{line, col}` en base 0. La caché de inicios de línea se invalida en cada edición
 * y se reconstruye a la primera consulta: 10 000 líneas son 10 000 sumas, ~0,1 ms.
 */
export class TextBuffer {
  private lines: string[];
  private startsCache: number[] | null = null;
  /**
   * El texto unido se cachea hasta la próxima edición: `join` de 1 MB cuesta ~1-3 ms y el
   * componente lo pide VARIAS veces por pulsación (el snapshot, el valor que se emite, las
   * dependencias de los memos). Sin caché, teclear en un documento de 10 000 líneas se nota.
   */
  private textCache: string | null = null;

  constructor(text = "") {
    this.lines = text.split("\n");
  }

  get text(): string {
    return (this.textCache ??= this.lines.join("\n"));
  }

  get lineCount(): number {
    return this.lines.length;
  }

  get length(): number {
    const starts = this.starts();
    return starts[starts.length - 1] + this.lines[this.lines.length - 1].length;
  }

  line(n: number): string {
    return this.lines[n] ?? "";
  }

  /** Offsets del primer carácter de cada línea. */
  starts(): number[] {
    if (this.startsCache) return this.startsCache;
    const starts = new Array<number>(this.lines.length);
    let offset = 0;
    for (let i = 0; i < this.lines.length; i++) {
      starts[i] = offset;
      offset += this.lines[i].length + 1;
    }
    this.startsCache = starts;
    return starts;
  }

  lineStart(n: number): number {
    const starts = this.starts();
    return starts[Math.max(0, Math.min(n, starts.length - 1))];
  }

  /** Offset del FINAL de la línea (sin contar el `\n`). */
  lineEnd(n: number): number {
    const starts = this.starts();
    if (n >= starts.length - 1) return this.length;
    return starts[n + 1] - 1;
  }

  /** Offset → `{line, col}`. Acepta offsets fuera de rango y los acota. */
  positionAt(offset: number): { line: number; col: number } {
    const starts = this.starts();
    const clamped = Math.max(0, Math.min(offset, this.length));
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= clamped) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, col: clamped - starts[lo] };
  }

  /** `{line, col}` → offset, acotado a la línea. */
  offsetAt(line: number, col: number): number {
    const n = Math.max(0, Math.min(line, this.lines.length - 1));
    const c = Math.max(0, Math.min(col, this.lines[n].length));
    return this.lineStart(n) + c;
  }

  slice(fromOffset: number, toOffset: number): string {
    const a = Math.max(0, Math.min(fromOffset, toOffset));
    const b = Math.max(fromOffset, toOffset);
    if (b - a === 0) return "";
    const start = this.positionAt(a);
    const end = this.positionAt(b);
    if (start.line === end.line) return this.lines[start.line].slice(start.col, end.col);
    const parts = [this.lines[start.line].slice(start.col)];
    for (let i = start.line + 1; i < end.line; i++) parts.push(this.lines[i]);
    parts.push(this.lines[end.line].slice(0, end.col));
    return parts.join("\n");
  }

  /**
   * Aplica un cambio y devuelve su INVERSO. El inverso se calcula con el texto que se quitó, no con
   * una copia del documento: 1 MB de copia por pulsación sería el camino lento.
   */
  apply(edit: TextEdit): TextEdit {
    const removed = this.slice(edit.from, edit.to);
    const start = this.positionAt(edit.from);
    const end = this.positionAt(edit.to);
    const before = this.lines[start.line].slice(0, start.col);
    const after = this.lines[end.line].slice(end.col);
    const middle = edit.insert.split("\n");
    middle[0] = before + middle[0];
    middle[middle.length - 1] = middle[middle.length - 1] + after;
    this.lines.splice(start.line, end.line - start.line + 1, ...middle);
    this.startsCache = null;
    this.textCache = null;
    return { from: edit.from, to: edit.from + edit.insert.length, insert: removed };
  }
}

/** Desplaza un offset por una lista de cambios (ascendentes). Sirve para conservar el cursor. */
export function mapOffset(offset: number, edits: readonly TextEdit[]): number {
  let delta = 0;
  for (const edit of edits) {
    if (edit.to <= offset) {
      delta += edit.insert.length - (edit.to - edit.from);
    } else if (edit.from < offset) {
      delta += edit.insert.length - (offset - edit.from);
    }
  }
  return offset + delta;
}

// --------------------------------------------------------------------------------------------
// 2. Navegación: qué carácter cuenta como «palabra»
// --------------------------------------------------------------------------------------------

/**
 * Carácter de palabra para moverse con ⌥←/⌥→ y para ⌥⌫. Incluye letras con acento (el usuario
 * escribe en español: `ñ`, `á`…) y `$`, que en SQL es parte de un identificador. Se hace con
 * `\p{L}` y no con `\w` precisamente por los acentos: `\w` es ASCII y cortaría «canción» en dos.
 */
const WORD = /[\p{L}\p{N}_$]/u;

export function isWordChar(ch: string | undefined): boolean {
  return !!ch && WORD.test(ch);
}

/** Inicio de la palabra anterior a `offset` (o el offset anterior si no hay palabra). */
export function wordStartBefore(text: string, offset: number): number {
  let i = Math.max(0, Math.min(offset, text.length));
  while (i > 0 && !isWordChar(text[i - 1])) i--;
  while (i > 0 && isWordChar(text[i - 1])) i--;
  return i;
}

/** Final de la palabra que empieza en `offset` (o el offset siguiente si no hay palabra). */
export function wordEndAfter(text: string, offset: number): number {
  let i = Math.max(0, Math.min(offset, text.length));
  while (i < text.length && !isWordChar(text[i])) i++;
  while (i < text.length && isWordChar(text[i])) i++;
  return i;
}

/** Carácter anterior a un offset, sin unir el documento. `\n` en el salto de línea. */
function charBeforeOffset(buffer: TextBuffer, offset: number): string {
  if (offset <= 0) return "";
  const { line, col } = buffer.positionAt(offset);
  return col > 0 ? buffer.line(line)[col - 1] : "\n";
}

function charAtOffset(buffer: TextBuffer, offset: number): string {
  if (offset >= buffer.length) return "";
  const { line, col } = buffer.positionAt(offset);
  return col < buffer.line(line).length ? buffer.line(line)[col] : "\n";
}

/** Límites de la palabra que contiene `offset`, para el doble clic. */
export function wordRangeAt(text: string, offset: number): { from: number; to: number } {
  let a = Math.max(0, Math.min(offset, text.length));
  if (a > 0 && !isWordChar(text[a]) && isWordChar(text[a - 1])) a--;
  let b = a;
  while (a > 0 && isWordChar(text[a - 1])) a--;
  while (b < text.length && isWordChar(text[b])) b++;
  return { from: a, to: b };
}

// --------------------------------------------------------------------------------------------
// 3. El modelo: edición + historial
// --------------------------------------------------------------------------------------------

type EditKind = "type" | "delete" | "newline" | "command";

interface HistoryEntry {
  /** Los cambios, ASCENDENTES: es el orden en que se rehacen. */
  edits: TextEdit[];
  /** Los inversos, en orden ASCENDENTE por índice de cambio: se deshacen de atrás adelante. */
  inverse: TextEdit[];
  /**
   * F2: el deshacer devuelve TAMBIÉN la forma del multicursor. Si solo se restaurara el cursor
   * primario, deshacer un `⌘D` + tecleo dejaría un cursor donde había tres y el siguiente tecleo
   * escribiría en un sitio distinto del que el usuario vio.
   */
  before: Selection[];
  after: Selection[];
  kind: EditKind;
  at: number;
}

/** Ventana de agrupación del deshacer: dos pulsaciones seguidas se deshacen juntas. */
const UNDO_GROUP_MS = 400;

/**
 * El modelo completo. Cada operación devuelve el `EditorSnapshot` nuevo y deja el historial al día.
 * No conoce el DOM: el componente se limita a leer `snapshot` y a llamar a los métodos.
 */
export class EditorModel {
  private buffer: TextBuffer;
  /**
   * F2 — multicursor. Siempre hay al menos una selección; la `primary` es la que mueven las
   * órdenes que todavía trabajan con una sola (subir/bajar línea, comentar, indentar) y la que
   * refleja el `<textarea>` oculto para el IME. `this.sel` sigue existiendo como acceso de lectura
   * y escritura de UNA selección: escribirla colapsa el multicursor, que es justo lo que hace un
   * clic normal.
   */
  private sels: Selection[] = [collapse(0)];
  private primary = 0;

  private get sel(): Selection {
    return this.sels[this.primary] ?? this.sels[0];
  }

  private set sel(value: Selection) {
    this.sels = [this.clampSelection(value)];
    this.primary = 0;
  }
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];

  constructor(text = "") {
    this.buffer = new TextBuffer(text);
  }

  get snapshot(): EditorSnapshot {
    return { text: this.buffer.text, selection: this.sel };
  }

  get selection(): Selection {
    return this.sel;
  }

  /** F2: todas las selecciones, en orden de documento. La vista pinta una por cada una. */
  get selections(): readonly Selection[] {
    return this.sels;
  }

  /** Índice de la selección que manda (la del `<textarea>` y las órdenes de una sola selección). */
  get primarySelection(): number {
    return this.primary;
  }

  /**
   * Reemplaza TODAS las selecciones. Normaliza: ordena por inicio, descarta las vacías que caen
   * dentro de un rango y une las que se solapan. Sin eso, dos cursores en el mismo punto escriben
   * el texto dos veces.
   */
  setSelections(next: readonly Selection[], primary = next.length - 1): EditorSnapshot {
    this.sels = this.normalizarSelecciones(next);
    this.primary = Math.max(0, Math.min(primary, this.sels.length - 1));
    return this.snapshot;
  }

  /** Añade un cursor (⌥clic o ⌘D) y lo deja como primario. */
  addSelection(sel: Selection): EditorSnapshot {
    this.setSelections([...this.sels, sel], this.sels.length);
    return this.snapshot;
  }

  /** ⌥clic sobre otro cursor: lo quita. Si era el último, queda uno. */
  removeSelectionAt(index: number): EditorSnapshot {
    if (this.sels.length <= 1) return this.snapshot;
    const siguientes = this.sels.filter((_, i) => i !== index);
    this.setSelections(siguientes, Math.max(0, Math.min(index, siguientes.length - 1)));
    return this.snapshot;
  }

  get text(): string {
    return this.buffer.text;
  }

  get lineCount(): number {
    return this.buffer.lineCount;
  }

  /** `{line, col}` del offset. Lo usa la vista para pintar el cursor sin conocer el buffer. */
  positionAt(offset: number): { line: number; col: number } {
    return this.buffer.positionAt(offset);
  }

  offsetAt(line: number, col: number): number {
    return this.buffer.offsetAt(line, col);
  }

  /** Texto de una línea. La vista solo pide las visibles. */
  line(n: number): string {
    return this.buffer.line(n);
  }

  get length(): number {
    return this.buffer.length;
  }

  /**
   * Navegación por palabras SIN unir el documento entero: cada paso mira el carácter anterior en su
   * línea. `model.text` construye 1 MB de cadena y llamarlo en cada ⌥← sería el camino lento.
   */
  wordStartBefore(offset: number): number {
    let i = Math.max(0, Math.min(offset, this.buffer.length));
    const charBefore = (at: number) => {
      if (at <= 0) return undefined;
      const { line, col } = this.buffer.positionAt(at);
      return col > 0 ? this.buffer.line(line)[col - 1] : "\n";
    };
    while (i > 0 && !isWordChar(charBefore(i))) i--;
    while (i > 0 && isWordChar(charBefore(i))) i--;
    return i;
  }

  wordEndAfter(offset: number): number {
    let i = Math.max(0, Math.min(offset, this.buffer.length));
    const charAt = (at: number) => {
      if (at >= this.buffer.length) return undefined;
      const { line, col } = this.buffer.positionAt(at);
      return col < this.buffer.line(line).length ? this.buffer.line(line)[col] : "\n";
    };
    while (i < this.buffer.length && !isWordChar(charAt(i))) i++;
    while (i < this.buffer.length && isWordChar(charAt(i))) i++;
    return i;
  }

  /**
   * Límites de la palabra bajo `offset` (doble clic y ⌘D). Misma regla que la función libre
   * `wordRangeAt`: si el cursor está JUSTO detrás de una palabra, esa palabra.
   *
   * BUG CORREGIDO (2026-10-21, reportado por el usuario: «al dar doble clic no llena por completo la
   * palabra»): el bucle hacia atrás llamaba a `charBeforeOffset(buffer, start - 1)`, que es el
   * carácter en `start - 2` — un carácter de más hacia atrás—, así que se paraba uno antes y la
   * selección perdía la PRIMERA letra (`anks_deposits…` en vez de `banks_deposits…`). Los tests solo
   * cubrían la función libre; el método, que es el que usa la vista, no tenía ninguno.
   */
  wordRangeAt(offset: number): { from: number; to: number } {
    let start = Math.max(0, Math.min(offset, this.buffer.length));
    if (
      start > 0 &&
      !isWordChar(charAtOffset(this.buffer, start)) &&
      isWordChar(charBeforeOffset(this.buffer, start))
    ) {
      start--;
    }
    let end = start;
    while (start > 0 && isWordChar(charBeforeOffset(this.buffer, start))) start--;
    while (end < this.buffer.length && isWordChar(charAtOffset(this.buffer, end))) end++;
    return { from: start, to: end };
  }

  /** Sincroniza con un `value` externo (el padre es la fuente de verdad del documento). */
  setText(text: string): EditorSnapshot {
    if (text === this.buffer.text) return this.snapshot;
    this.buffer = new TextBuffer(text);
    this.undoStack = [];
    this.redoStack = [];
    this.sel = this.clampSelection(this.sel);
    return this.snapshot;
  }

  setSelection(selection: Selection): EditorSnapshot {
    this.sel = this.clampSelection(selection);
    return this.snapshot;
  }

  // ------------------------------------------------------------------------------------------
  // Edición
  // ------------------------------------------------------------------------------------------

  /**
   * Reemplaza CADA selección con `text`, en una sola transacción (un solo deshacer).
   *
   * Los cursores de destino se calculan en coordenadas FINALES: cada cambio previo desplaza lo que
   * viene después por `insert.length - (to - from)`. Sin esa suma, teclear con tres cursores deja
   * los tres apuntando a posiciones del documento viejo.
   */
  insert(text: string, kind: EditKind = "type"): EditorSnapshot {
    const edits: TextEdit[] = this.sels.map((s) => ({ from: from(s), to: to(s), insert: text }));
    if (edits.length === 1) {
      return this.applyEdits(edits, kind, [collapse(edits[0].from + text.length)]);
    }
    return this.applyEdits(edits, kind, this.destinosTrasEditar(edits));
  }

  /**
   * Aplica varios cambios como UNA transacción (un solo deshacer). Lo usa «reemplazar todo»: si
   * cada coincidencia fuera una transacción, deshacer un reemplazo global costaría N ⌘Z.
   */
  applyRanges(edits: TextEdit[]): EditorSnapshot {
    if (!edits.length) return this.snapshot;
    const last = edits.reduce((a, b) => (b.to >= a.to ? b : a));
    return this.applyEdits(edits, "command", collapse(last.from + last.insert.length));
  }

  /**
   * Reemplaza un rango CONCRETO (no la selección). Es lo que usa el autocompletado: la ventana que
   * se sustituye la decidió el popup, no el cursor.
   */
  insertAt(fromOffset: number, toOffset: number, text: string, kind: EditKind = "type"): EditorSnapshot {
    return this.applyEdits(
      [{ from: fromOffset, to: toOffset, insert: text }],
      kind,
      collapse(fromOffset + text.length)
    );
  }

  /**
   * Borra hacia atrás en TODAS las selecciones. Con `byWord`, hasta el inicio de la palabra
   * anterior (⌥⌫). Una selección no vacía se borra entera; un cursor vacío borra un carácter (o una
   * palabra).
   */
  deleteBackward(byWord = false): EditorSnapshot {
    const edits: TextEdit[] = [];
    const destinos: Selection[] = [];
    for (const s of this.sels) {
      if (from(s) !== to(s)) {
        edits.push({ from: from(s), to: to(s), insert: "" });
        destinos.push(collapse(from(s)));
        continue;
      }
      const caret = from(s);
      if (caret === 0) {
        destinos.push(collapse(caret));
        continue;
      }
      const target = byWord ? wordStartBefore(this.buffer.text, caret) : caret - 1;
      edits.push({ from: target, to: caret, insert: "" });
      destinos.push(collapse(target));
    }
    if (!edits.length) return this.snapshot;
    return this.applyEdits(edits, "delete", this.desplazarDestinos(edits, destinos));
  }

  /** Borra hacia delante (⌦) en todas las selecciones; `byWord` = hasta el final de la palabra. */
  deleteForward(byWord = false): EditorSnapshot {
    const edits: TextEdit[] = [];
    const destinos: Selection[] = [];
    for (const s of this.sels) {
      if (from(s) !== to(s)) {
        edits.push({ from: from(s), to: to(s), insert: "" });
        destinos.push(collapse(from(s)));
        continue;
      }
      const caret = to(s);
      if (caret >= this.buffer.length) {
        destinos.push(collapse(caret));
        continue;
      }
      const target = byWord ? wordEndAfter(this.buffer.text, caret) : caret + 1;
      edits.push({ from: caret, to: target, insert: "" });
      destinos.push(collapse(caret));
    }
    if (!edits.length) return this.snapshot;
    return this.applyEdits(edits, "delete", this.desplazarDestinos(edits, destinos));
  }

  /**
   * ⏎: parte la línea y COPIA LA SANGRÍA de la línea actual (lo que hace cualquier IDE). Si el
   * carácter anterior es un `(`, añade dos espacios: es la mitad del valor de un auto-indent de
   * verdad y no exige conocer el dialecto.
   */
  newline(): EditorSnapshot {
    const caret = from(this.sel);
    const line = this.buffer.positionAt(caret).line;
    const lineText = this.buffer.line(line);
    const indent = /^[ \t]*/.exec(lineText)?.[0] ?? "";
    const beforeCaret = lineText[caret - this.buffer.lineStart(line) - 1];
    const extra = beforeCaret === "(" ? "  " : "";
    return this.applyEdits(
      [{ from: from(this.sel), to: to(this.sel), insert: `\n${indent}${extra}` }],
      "newline",
      collapse(caret + 1 + indent.length + extra.length)
    );
  }

  /** ⇥: dos espacios. Con selección, indenta todas las líneas tocadas (las vacías no). */
  indent(): EditorSnapshot {
    const { startLine, endLine } = this.selectedLines();
    const edits: TextEdit[] = [];
    for (let line = startLine; line <= endLine; line++) {
      if (!this.buffer.line(line).trim() && startLine !== endLine) continue;
      edits.push({ from: this.buffer.lineStart(line), to: this.buffer.lineStart(line), insert: "  " });
    }
    if (!edits.length) return this.snapshot;
    return this.applyEdits(edits, "command", this.mapSelection(edits));
  }

  /** ⇧⇥: quita hasta dos espacios (o un tabulador) del inicio de cada línea tocada. */
  outdent(): EditorSnapshot {
    const { startLine, endLine } = this.selectedLines();
    const edits: TextEdit[] = [];
    for (let line = startLine; line <= endLine; line++) {
      const text = this.buffer.line(line);
      const cut = text.startsWith("  ") ? 2 : text.startsWith(" ") || text.startsWith("\t") ? 1 : 0;
      if (!cut) continue;
      const at = this.buffer.lineStart(line);
      edits.push({ from: at, to: at + cut, insert: "" });
    }
    if (!edits.length) return this.snapshot;
    return this.applyEdits(edits, "command", this.mapSelection(edits));
  }

  /** ⌘D: duplica la línea (o las líneas seleccionadas) debajo, con el cursor en la copia. */
  duplicateLine(): EditorSnapshot {
    const { startLine, endLine } = this.selectedLines();
    const block = this.linesBlock(startLine, endLine);
    const insertAt = this.buffer.lineEnd(endLine);
    const offsetInBlock = from(this.sel) - this.buffer.lineStart(startLine);
    const nextCaret = insertAt + 1 + offsetInBlock;
    return this.applyEdits(
      [{ from: insertAt, to: insertAt, insert: `\n${block}` }],
      "command",
      { anchor: nextCaret, head: nextCaret + (to(this.sel) - from(this.sel)) }
    );
  }

  /** ⌥↑ / ⌥↓: mueve la línea (o el bloque) arriba o abajo. */
  moveLines(direction: -1 | 1): EditorSnapshot {
    const { startLine, endLine } = this.selectedLines();
    const lineCount = this.buffer.lineCount;
    if (direction === -1 && startLine === 0) return this.snapshot;
    if (direction === 1 && endLine === lineCount - 1) return this.snapshot;
    const neighbour = direction === -1 ? startLine - 1 : endLine + 1;
    const block = this.linesBlock(startLine, endLine);
    const other = this.linesBlock(neighbour, neighbour);
    const fromOffset = Math.min(this.buffer.lineStart(startLine), this.buffer.lineStart(neighbour));
    const toOffset = Math.max(this.buffer.lineEnd(endLine), this.buffer.lineEnd(neighbour));
    const insert = direction === -1 ? `${block}\n${other}` : `${other}\n${block}`;
    const offsetInLine = from(this.sel) - this.buffer.lineStart(this.buffer.positionAt(from(this.sel)).line);
    const lineOfCaret = this.buffer.positionAt(from(this.sel)).line;
    const snapshot = this.applyEdits([{ from: fromOffset, to: toOffset, insert }], "command", this.sel);
    // El cursor viaja con su línea: se recalcula ya con el texto movido.
    const newLine = lineOfCaret + direction;
    const caret = this.buffer.lineStart(newLine) + offsetInLine;
    const headDelta = to(this.sel) - from(this.sel);
    this.sel = this.clampSelection({ anchor: caret, head: caret + headDelta });
    return { text: snapshot.text, selection: this.sel };
  }

  /** ⌘/: comenta o descomenta las líneas tocadas con `--`. */
  toggleComment(): EditorSnapshot {
    const { startLine, endLine } = this.selectedLines();
    const lines: string[] = [];
    for (let line = startLine; line <= endLine; line++) lines.push(this.buffer.line(line));
    const allCommented = lines.every((line) => /^\s*--/.test(line) || !line.trim());
    const edits: TextEdit[] = [];
    for (let line = startLine; line <= endLine; line++) {
      const text = this.buffer.line(line);
      const indent = /^\s*/.exec(text)?.[0].length ?? 0;
      const at = this.buffer.lineStart(line) + indent;
      if (allCommented) {
        const match = /^--\s?/.exec(text.slice(indent));
        if (match) edits.push({ from: at, to: at + match[0].length, insert: "" });
      } else if (text.trim()) {
        edits.push({ from: at, to: at, insert: "-- " });
      }
    }
    if (!edits.length) return this.snapshot;
    return this.applyEdits(edits, "command", this.mapSelection(edits));
  }

  // ------------------------------------------------------------------------------------------
  // ⌘⌫ y ⌘⌥/ — las dos que el motor CodeMirror traía de su keymap y el propio no tenía
  // ------------------------------------------------------------------------------------------

  /**
   * ⌘⌫ (y su alias ⌘⇧K): borra la línea —o el bloque de líneas— que toca la selección, **con su
   * salto de línea**.
   *
   * Por qué no se reutiliza `deleteBackward`: hasta la fase 15 cerrada, `⌘⌫` en el editor propio caía
   * en el `case "Backspace"` y borraba UN carácter (medido con teclas reales: `uno;\ndos;` con el
   * cursor en la línea 2 quedaba en `uno;dos;`). DataGrip borra la línea entera.
   *
   * Los dos bordes que importan:
   *  - Línea del medio: se borra desde su inicio hasta el inicio de la siguiente, así se lleva el
   *    salto y no queda un hueco.
   *  - Última línea: no hay salto detrás, se come el de delante; si no, quedaría una línea vacía al
   *    final que el usuario no pidió.
   */
  deleteLine(): EditorSnapshot {
    const { startLine, endLine } = this.selectedLines();
    const lineCount = this.buffer.lineCount;
    if (lineCount === 1) {
      // Documento de una sola línea: se vacía el contenido, pero el buffer conserva su línea.
      return this.applyEdits([{ from: 0, to: this.length, insert: "" }], "command", { anchor: 0, head: 0 });
    }
    const start = this.buffer.lineStart(startLine);
    const ultima = endLine + 1 >= lineCount;
    const desde = ultima ? start - 1 : start;
    const hasta = ultima ? this.length : this.buffer.lineStart(endLine + 1);
    return this.applyEdits([{ from: desde, to: hasta, insert: "" }], "command", { anchor: desde, head: desde });
  }

  /**
   * ⌘⌥/ (y el alias ⌥A de la app): comenta o descomenta en bloque (`/* … *\/`).
   *
   * Sin selección se comenta la LÍNEA del cursor, **sin su indentación**: `    select 1` tiene que
   * quedar en `    /* select 1 *\/`, no en `/*     select 1 *\/`. Con selección se envuelve justo lo
   * seleccionado, que es lo que hace DataGrip.
   *
   * Se resuelve sobre la selección PRIMARIA. El multicursor envuelve cada selección en DataGrip;
   * queda anotado como hueco consciente (el caso normal es una selección) y no se finge soporte.
   */
  toggleBlockComment(): EditorSnapshot {
    const a = from(this.sel);
    const b = to(this.sel);
    if (a !== b) return this.comentarBloque(Math.min(a, b), Math.max(a, b));
    const linea = this.positionAt(a).line;
    const texto = this.buffer.line(linea);
    const sangria = /^\s*/.exec(texto)?.[0].length ?? 0;
    const inicio = this.buffer.lineStart(linea);
    return this.comentarBloque(inicio + sangria, inicio + texto.length);
  }

  /** Envuelve o desenvuelve el rango: UNA edición, para que el deshacer sea un solo paso. */
  private comentarBloque(desde: number, hasta: number): EditorSnapshot {
    const interior = this.text.slice(desde, hasta).trim();
    if (!interior) return this.snapshot;
    const envuelto = interior.startsWith("/*") && interior.endsWith("*/");
    const nuevo = envuelto ? interior.slice(2, interior.length - 2).trim() : `/* ${interior} */`;
    return this.applyEdits([{ from: desde, to: hasta, insert: nuevo }], "command", {
      anchor: desde,
      head: desde + nuevo.length,
    });
  }

  // ------------------------------------------------------------------------------------------
  // Deshacer / rehacer
  // ------------------------------------------------------------------------------------------

  undo(): EditorSnapshot {
    const entry = this.undoStack.pop();
    if (!entry) return this.snapshot;
    // `inverse` está apilado en orden de deshacer: el primero es el del último cambio, y cada uno
    // es válido en el estado que deja el anterior.
    for (const inv of entry.inverse) this.buffer.apply(inv);
    this.sels = entry.before.map((s) => this.clampSelection(s));
    this.primary = this.sels.length - 1;
    this.redoStack.push(entry);
    return this.snapshot;
  }

  redo(): EditorSnapshot {
    const entry = this.redoStack.pop();
    if (!entry) return this.snapshot;
    // Los cambios se rehacen ascendentes, desplazando cada offset por lo que ya se aplicó (los
    // `edits` están en coordenadas del documento original). El inverso nuevo se apila en orden de
    // deshacer, que es el contrato que espera `undo`.
    const inverse: TextEdit[] = [];
    const applied: TextEdit[] = [];
    for (const edit of entry.edits) {
      const actual = {
        from: mapOffset(edit.from, applied),
        to: mapOffset(edit.to, applied),
        insert: edit.insert,
      };
      inverse.unshift(this.buffer.apply(actual));
      applied.push(edit);
    }
    this.sels = entry.after.map((s) => this.clampSelection(s));
    this.primary = this.sels.length - 1;
    this.undoStack.push({ ...entry, inverse });
    return this.snapshot;
  }

  // ------------------------------------------------------------------------------------------
  // Utilidades
  // ------------------------------------------------------------------------------------------

  private applyEdits(
    edits: TextEdit[],
    kind: EditKind,
    nextSelection: Selection | Selection[]
  ): EditorSnapshot {
    // Un solo punto de entrada para que el historial no se desincronice nunca del texto.
    const before = [...this.sels];
    // OJO: las selecciones de destino se normalizan DESPUÉS de aplicar los cambios. Normalizar aquí
    // las recortaría contra la longitud VIEJA del documento y un cursor al final de lo insertado
    // (p. ej. en 15 con el texto anterior de 8 caracteres) acabaría en 8.
    const pedidas: Selection[] = Array.isArray(nextSelection) ? nextSelection : [nextSelection];
    const ascending = [...edits].sort((a, b) => a.from - b.from);
    const inverse: TextEdit[] = new Array(ascending.length);
    // De atrás adelante: así los offsets de los cambios anteriores siguen siendo válidos.
    for (let i = ascending.length - 1; i >= 0; i--) inverse[i] = this.buffer.apply(ascending[i]);
    // Cada inverso nació en el estado intermedio que dejó SU cambio, no en el final: los cambios
    // con `from` menor (aplicados después) desplazaron sus offsets. Se llevan al estado final una
    // vez, aquí, en vez de repetir el cálculo en cada deshacer.
    for (let i = 0; i < inverse.length; i++) {
      const earlier = ascending.slice(0, i);
      inverse[i] = {
        from: mapOffset(inverse[i].from, earlier),
        to: mapOffset(inverse[i].to, earlier),
        insert: inverse[i].insert,
      };
    }
    inverse.reverse(); // orden de deshacer: el del último cambio, primero

    const next = this.normalizarSelecciones(pedidas);

    const now = Date.now();
    const last = this.undoStack[this.undoStack.length - 1];
    const mergeable =
      last !== undefined &&
      kind === "type" &&
      last.kind === "type" &&
      now - last.at < UNDO_GROUP_MS &&
      last.after[last.after.length - 1].head === before[before.length - 1].head &&
      ascending.length === 1 &&
      !ascending[0].insert.includes("\n");

    if (mergeable) {
      // El cambio nuevo se deshace PRIMERO: su inverso va al principio de la lista de undo.
      last.inverse = [...inverse, ...last.inverse];
      last.edits = [...last.edits, ...ascending];
      last.after = next;
      last.at = now;
    } else {
      this.undoStack.push({ edits: ascending, inverse, before, after: next, kind, at: now });
    }
    this.redoStack = [];
    this.sels = next;
    this.primary = next.length - 1;
    return this.snapshot;
  }

  /** Ordena, clampa, une solapes y quita cursores repetidos. Siempre devuelve al menos uno. */
  private normalizarSelecciones(sels: readonly Selection[]): Selection[] {
    const clampadas = sels.map((s) => this.clampSelection(s));
    const ordenadas = clampadas
      .map((s) => ({ from: from(s), to: to(s) }))
      .sort((a, b) => a.from - b.from || a.to - b.to);

    const out: Selection[] = [];
    for (const r of ordenadas) {
      const last = out[out.length - 1];
      if (!last) {
        out.push({ anchor: r.from, head: r.to });
        continue;
      }
      const lastFrom = from(last);
      const lastTo = to(last);
      // Dos cursores en el MISMO punto escribirían el texto dos veces: se deja uno.
      if (r.from === lastFrom && r.to === lastTo) continue;
      // Solapados: se fusionan en un solo rango, que es lo que hace cualquier editor.
      if (r.from <= lastTo) {
        out[out.length - 1] = { anchor: lastFrom, head: Math.max(lastTo, r.to) };
        continue;
      }
      out.push({ anchor: r.from, head: r.to });
    }
    return out.length ? out : [collapse(0)];
  }

  /** Cursor al final de cada edición, en coordenadas FINALES (ver `insert`). */
  private destinosTrasEditar(edits: TextEdit[]): Selection[] {
    const ascendentes = [...edits].sort((a, b) => a.from - b.from);
    let desplazamiento = 0;
    return ascendentes.map((e) => {
      const pos = e.from + desplazamiento + e.insert.length;
      desplazamiento += e.insert.length - (e.to - e.from);
      return collapse(pos);
    });
  }

  /**
   * Para los borrados: el destino de cada selección es el inicio de SU rango, corregido por lo que
   * hayan desplazado los borrados anteriores.
   */
  private desplazarDestinos(edits: TextEdit[], destinos: Selection[]): Selection[] {
    const pares = edits
      .map((e, i) => ({ e, d: destinos[i] }))
      .sort((a, b) => a.e.from - b.e.from);
    let desplazamiento = 0;
    const out: Selection[] = [];
    for (const { e, d } of pares) {
      out.push(collapse(from(d) + desplazamiento));
      desplazamiento += e.insert.length - (e.to - e.from);
    }
    return out;
  }

  private clampSelection(sel: Selection): Selection {
    const clamp = (n: number) => Math.max(0, Math.min(n, this.buffer.length));
    return { anchor: clamp(sel.anchor), head: clamp(sel.head) };
  }

  private selectedLines(): { startLine: number; endLine: number } {
    const a = this.buffer.positionAt(from(this.sel)).line;
    const b = this.buffer.positionAt(to(this.sel)).line;
    return { startLine: a, endLine: b };
  }

  private linesBlock(startLine: number, endLine: number): string {
    const parts: string[] = [];
    for (let line = startLine; line <= endLine; line++) parts.push(this.buffer.line(line));
    return parts.join("\n");
  }

  /** Conserva el cursor al aplicar cambios que no son texto tecleado (indentar, comentar…). */
  private mapSelection(edits: readonly TextEdit[]): Selection {
    return {
      anchor: mapOffset(this.sel.anchor, edits),
      head: mapOffset(this.sel.head, edits),
    };
  }
}
