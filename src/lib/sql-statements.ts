/**
 * Utilidades de SENTENCIAS del editor SQL: qué sentencia está bajo el cursor y cómo se parte el
 * documento en sentencias, respetando `DELIMITER` (MySQL), cadenas y comentarios.
 *
 * Vivían dentro de `sql-code-editor.tsx` (el editor de CodeMirror). Al quitarlo pasan aquí: las usan
 * la consola, el panel de IA y el diálogo «Texto→SQL», y no dependen de ningún editor.
 */

function isInsideComment(text: string, pos: number): boolean {
  // Comentario de línea: -- hasta el fin de línea.
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  if (text.slice(lineStart, pos).trimStart().startsWith("--")) return true;

  // Comentario de bloque: /* ... */
  const idx = text.lastIndexOf("/*", pos - 1);
  if (idx === -1) return false;
  const close = text.indexOf("*/", idx + 2);
  return close === -1 || close >= pos;
}

function isInsideStringOrComment(text: string, pos: number): boolean {
  let inQuote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < pos; i++) {
    const ch = text[i];
    const next = text[i + 1] ?? "";
    const prev = i > 0 ? text[i - 1] : "";

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
    } else if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
    } else if (inQuote) {
      if (ch === inQuote && prev !== "\\") inQuote = null;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      inQuote = ch;
    } else if (ch === "-" && next === "-") {
      inLineComment = true;
      i++;
    } else if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
    }
  }

  return inQuote !== null || inLineComment || inBlockComment;
}

interface DelimiterChange {
  pos: number;
  delimiter: string;
  endPos: number;
}

function findDelimiterChanges(text: string): DelimiterChange[] {
  const changes: DelimiterChange[] = [];
  const regex = /^DELIMITER\s+(\S+)/gim;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (isInsideStringOrComment(text, match.index)) continue;
    changes.push({
      pos: match.index,
      delimiter: match[1],
      endPos: match.index + match[0].length,
    });
  }
  return changes;
}

function getDelimiterContext(
  text: string,
  pos: number
): { delimiter: string; segmentStart: number; segmentEnd: number } {
  const changes = findDelimiterChanges(text);
  let delimiter = ";";
  let segmentStart = 0;

  for (const change of changes) {
    if (change.pos <= pos) {
      delimiter = change.delimiter;
      segmentStart = change.endPos;
    } else {
      break;
    }
  }

  const nextChange = changes.find((c) => c.pos > pos);
  const segmentEnd = nextChange ? nextChange.pos : text.length;

  return { delimiter, segmentStart, segmentEnd };
}

function isInsideDelimiterCommand(text: string, pos: number): boolean {
  const regex = /^DELIMITER\s+\S+/gim;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (isInsideStringOrComment(text, match.index)) continue;
    if (pos >= match.index && pos <= match.index + match[0].length) {
      return true;
    }
  }
  return false;
}

function findPreviousDelimiter(
  text: string,
  pos: number,
  delimiter: string,
  minPos: number
): number {
  const delimLen = delimiter.length;
  let inQuote: string | null = null;
  for (let i = pos - 1; i >= minPos; i--) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : "";
    if (inQuote) {
      if (ch === inQuote && prev !== "\\") inQuote = null;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      inQuote = ch;
    } else if (
      i + delimLen <= pos &&
      text.slice(i, i + delimLen) === delimiter &&
      !isInsideComment(text, i)
    ) {
      return i;
    }
  }
  return -1;
}

function findNextDelimiter(
  text: string,
  pos: number,
  delimiter: string,
  maxPos: number
): number {
  const delimLen = delimiter.length;
  let inQuote: string | null = null;
  for (let i = pos; i < maxPos; i++) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : "";
    if (inQuote) {
      if (ch === inQuote && prev !== "\\") inQuote = null;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      inQuote = ch;
    } else if (
      i + delimLen <= maxPos &&
      text.slice(i, i + delimLen) === delimiter &&
      !isInsideComment(text, i)
    ) {
      return i;
    }
  }
  return maxPos;
}

// --------------------------------------------------------------------------------------------
// Sentencias SIN `;`: una línea en blanco seguida de una palabra que abre sentencia también separa
// --------------------------------------------------------------------------------------------

/**
 * Palabras que abren una sentencia. Tras una línea en blanco, una de estas (a profundidad 0 de
 * paréntesis y fuera de cadenas/comentarios) empieza OTRA sentencia aunque la anterior no lleve
 * `;`, como hace DataGrip (su parser cierra la sentencia al ver que empieza otra). Pedido del
 * usuario (2026-10-21): el contorno verde de la sentencia actual «funciona con el `;` y sin él».
 */
const STATEMENT_STARTERS =
  /^(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|TRUNCATE|EXPLAIN|SHOW|DESCRIBE|DESC|USE|SET|BEGIN|START|COMMIT|ROLLBACK|GRANT|REVOKE|CALL|EXEC|EXECUTE|MERGE|REPLACE|ANALYZE|VACUUM|LOCK|DECLARE|DO)\b/i;

/**
 * Lo que deja la sentencia de arriba A MEDIAS: si acaba así, lo de abajo la continúa (`… UNION` +
 * línea en blanco + `SELECT …` es UNA sentencia; también tras `AS`, una coma, un paréntesis…).
 */
const CONTINUES_BELOW =
  /(\b(UNION|ALL|EXCEPT|INTERSECT|MINUS|AS|AND|OR|NOT|FROM|WHERE|JOIN|ON|BY|IN|INTO|SET|VALUES|THEN|ELSE|WHEN|SELECT|EXISTS|LIKE|BETWEEN|IS)|[,(=<>+\-*/|])\s*$/i;

/** Un rango `[from, to)` del documento. */
interface Range {
  from: number;
  to: number;
}

/**
 * Parte `[from, to)` —un tramo SIN delimitadores dentro— en las sentencias que separan las líneas
 * en blanco (ver `STATEMENT_STARTERS`). No corta:
 *   - dentro de cadenas (`'…'`, `"…"`, `` `…` ``, `$tag$…$tag$`) ni comentarios;
 *   - dentro de paréntesis (una subconsulta con una línea en blanco delante de su SELECT);
 *   - si la sentencia de arriba queda a medias (`CONTINUES_BELOW`);
 *   - a partir de un `BEGIN` dentro del tramo: es el cuerpo de un bloque (procedimiento, `DO`), que
 *     sí lleva sentencias sueltas separadas por líneas en blanco.
 * Devuelve los rangos SIN recortar espacios; el llamador los recorta.
 */
function splitByBlankLines(text: string, from: number, to: number): Range[] {
  const parts: Range[] = [];
  let cur = from;
  let depth = 0;
  let quote: string | null = null;
  let dollarTag: string | null = null;
  let lineComment = false;
  let blockComment = false;
  let blockBody = false;
  for (let i = from; i < to; i++) {
    const ch = text[i];
    const next = text[i + 1] ?? "";
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      else continue;
    } else if (blockComment) {
      if (ch === "*" && next === "/") {
        blockComment = false;
        i++;
      }
      continue;
    } else if (dollarTag) {
      if (text.startsWith(dollarTag, i)) {
        i += dollarTag.length - 1;
        dollarTag = null;
      }
      continue;
    } else if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "-" && next === "-") {
      lineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      blockComment = true;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(i, i + 40));
      if (tag) {
        dollarTag = tag[0];
        i += tag[0].length - 1;
        continue;
      }
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    else if (/[A-Za-z_]/.test(ch) && !/[A-Za-z0-9_$]/.test(text[i - 1] ?? "")) {
      const word = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(text.slice(i, i + 40))?.[0] ?? "";
      // `BEGIN` seguido de algo que no es `;`/fin: cuerpo de bloque, no se corta más en este tramo.
      if (/^BEGIN$/i.test(word) && text.slice(i + word.length, to).trim() !== "") blockBody = true;
      i += word.length - 1;
      continue;
    }
    if (ch !== "\n" || depth > 0 || blockBody) continue;
    // ¿Viene al menos UNA línea en blanco y después una palabra que abre sentencia?
    const nextNl = text.indexOf("\n", i + 1);
    if (nextNl === -1 || nextNl >= to) continue;
    if (text.slice(i + 1, nextNl).trim() !== "") continue;
    let m = nextNl;
    while (m < to && /\s/.test(text[m])) m++;
    if (m >= to || !STATEMENT_STARTERS.test(text.slice(m, m + 12))) continue;
    const above = text.slice(cur, i);
    if (!above.trim() || CONTINUES_BELOW.test(above)) continue;
    parts.push({ from: cur, to: i });
    cur = m;
    i = m - 1;
  }
  parts.push({ from: cur, to });
  return parts;
}

/** El rango sin los espacios de los bordes; `null` si queda vacío. */
function trimRange(text: string, r: Range): Range | null {
  let { from, to } = r;
  while (from < to && /\s/.test(text[from])) from++;
  while (to > from && /\s/.test(text[to - 1])) to--;
  return from < to ? { from, to } : null;
}

/**
 * La sentencia en la que está el cursor, en sentido ESTRICTO (el de DataGrip para su contorno
 * verde): `null` si el cursor no está dentro de ninguna —en una línea en blanco entre dos, o en los
 * espacios del final—. El rango incluye el `;` final si lo hay. Con el cursor JUSTO detrás del `;`
 * se sigue en esa sentencia.
 *
 * Distinto de `getActiveStatementBounds`, que entre dos sentencias devuelve la de ARRIBA (la que
 * ejecuta ⌘⏎ en ese caso). Las dos usan los mismos cortes, así que dentro de una sentencia
 * coinciden: lo que se ve contorneado es lo que se ejecuta.
 */
export function getStatementRangeAt(text: string, pos: number): Range | null {
  if (isInsideDelimiterCommand(text, pos)) return null;
  const { delimiter, segmentStart, segmentEnd } = getDelimiterContext(text, pos);
  const len = delimiter.length;
  let p = pos;
  if (
    p - len >= segmentStart &&
    text.slice(p - len, p) === delimiter &&
    !isInsideStringOrComment(text, p - len)
  ) {
    p -= len;
  }
  const prev = findPreviousDelimiter(text, p, delimiter, segmentStart);
  const next = findNextDelimiter(text, p, delimiter, segmentEnd);
  const segFrom = prev === -1 ? segmentStart : prev + len;
  const hasDelimiter = next < segmentEnd && text.slice(next, next + len) === delimiter;
  const parts = splitByBlankLines(text, segFrom, next)
    .map((r) => trimRange(text, r))
    .filter((r): r is Range => r !== null);
  for (let k = 0; k < parts.length; k++) {
    const part = parts[k];
    const isLast = k === parts.length - 1;
    const end = isLast && hasDelimiter ? next + len : part.to;
    if (p >= part.from && p <= part.to) return { from: part.from, to: end };
    if (p < part.from) return null;
  }
  return null;
}

export function getActiveStatementBounds(
  text: string,
  pos: number
): { from: number; to: number } {
  if (isInsideDelimiterCommand(text, pos)) {
    return { from: 0, to: 0 };
  }

  const { delimiter, segmentStart, segmentEnd } = getDelimiterContext(text, pos);
  const delimLen = delimiter.length;

  const prevDelim = findPreviousDelimiter(text, pos, delimiter, segmentStart);
  const nextDelim = findNextDelimiter(text, pos, delimiter, segmentEnd);

  // Si el cursor está en espacios en blanco entre dos sentencias
  // (justo después de un delimitador y antes de la siguiente), ejecutamos
  // la sentencia anterior, no la siguiente.
  const textBetweenPrevAndPos = text.slice(
    prevDelim === -1 ? segmentStart : prevDelim + delimLen,
    pos
  );
  const isBetweenStatements = /^\s*$/.test(textBetweenPrevAndPos);

  let from: number;
  let to: number;

  if (isBetweenStatements && prevDelim !== -1) {
    // Sentencia anterior.
    const prevPrevDelim = findPreviousDelimiter(
      text,
      prevDelim,
      delimiter,
      segmentStart
    );
    from = prevPrevDelim === -1 ? segmentStart : prevPrevDelim + delimLen;
    to = prevDelim;
  } else {
    // Sentencia bajo el cursor.
    from = prevDelim === -1 ? segmentStart : prevDelim + delimLen;
    to = nextDelim;
  }

  // Ajusta los límites para excluir espacios/saltos de línea entre sentencias
  // y mantener el resaltado/borde justo alrededor de la query activa.
  while (from < to && /\s/.test(text[from])) from++;
  while (to > from && /\s/.test(text[to - 1])) to--;

  // Sin `;` entre medias, las líneas en blanco + palabra de sentencia también separan (mismo corte
  // que `getStatementRangeAt`). Entre dos de esas piezas, la de ARRIBA: la misma regla de siempre
  // para «el cursor está entre dos sentencias».
  if (from < to) {
    const parts = splitByBlankLines(text, from, to)
      .map((r) => trimRange(text, r))
      .filter((r): r is Range => r !== null);
    if (parts.length > 1) {
      let elegida = parts[0];
      for (const part of parts) if (part.from <= pos) elegida = part;
      from = elegida.from;
      to = elegida.to;
    }
  }

  // Una sentencia al final del documento sin delimitador terminador también es válida:
  // se resalta y se ejecuta con Cmd+Enter igual que las terminadas.
  if (from >= to) {
    return { from: 0, to: 0 };
  }

  return { from, to };
}

export function getActiveStatement(text: string, pos: number): string {
  const { from, to } = getActiveStatementBounds(text, pos);
  return text.slice(from, to).trim();
}

/**
 * Añade las sentencias de `[from, to)`. Con el delimitador de siempre (`;`) se parte además por las
 * líneas en blanco (sentencias sin `;`, ver `splitByBlankLines`); con un `DELIMITER` propio NO: ese
 * modo existe justo para cuerpos de rutina con sentencias sueltas dentro.
 */
function pushStatements(out: string[], text: string, from: number, to: number, delimiter: string) {
  const parts = delimiter === ";" ? splitByBlankLines(text, from, to) : [{ from, to }];
  for (const r of parts) {
    const stmt = text.slice(r.from, r.to).trim();
    if (stmt) out.push(stmt);
  }
}

export function splitStatements(text: string): string[] {
  const changes = findDelimiterChanges(text);
  const statements: string[] = [];
  let inQuote: string | null = null;
  let currentDelimiter = ";";
  let start = 0;
  let changeIdx = 0;

  for (let i = 0; i < text.length; ) {
    // Al llegar a un comando DELIMITer, guardamos lo acumulado como sentencia,
    // cambiamos el delimitador activo y omitimos el propio comando DELIMITER.
    if (changeIdx < changes.length && i === changes[changeIdx].pos) {
      const stmt = text.slice(start, i).trim();
      if (stmt) statements.push(stmt);
      currentDelimiter = changes[changeIdx].delimiter;
      start = changes[changeIdx].endPos;
      i = start;
      changeIdx++;
      continue;
    }

    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : "";
    const delimLen = currentDelimiter.length;

    if (inQuote) {
      if (ch === inQuote && prev !== "\\") inQuote = null;
      i++;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      inQuote = ch;
      i++;
    } else if (
      i + delimLen <= text.length &&
      text.slice(i, i + delimLen) === currentDelimiter &&
      !isInsideComment(text, i)
    ) {
      pushStatements(statements, text, start, i, currentDelimiter);
      start = i + delimLen;
      i = start;
    } else {
      i++;
    }
  }

  // Sentencia final sin delimitador terminador: también se ejecuta.
  pushStatements(statements, text, start, text.length, currentDelimiter);

  return statements;
}
