import type { Token } from "@/components/own-editor/highlight";

const MQL_KEYWORDS = new Set([
  "db",
  "show",
  "collections",
  "true",
  "false",
  "null",
  "undefined",
  "new",
]);

const isDigit = (c: string) => c >= "0" && c <= "9";
const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c);
const isIdentPart = (c: string) => /[A-Za-z0-9_$]/.test(c);

function skipSpaces(text: string, from: number): number {
  let i = from;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
  return i;
}

function readQuoted(text: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === "\\" && i + 1 < text.length) {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    i++;
  }
  return text.length;
}

function readNumber(text: string, start: number): number {
  let i = start;
  if (text[i] === "-") i++;
  while (i < text.length && isDigit(text[i])) i++;
  if (text[i] === "." && i + 1 < text.length && isDigit(text[i + 1])) {
    i++;
    while (i < text.length && isDigit(text[i])) i++;
  }
  if ((text[i] === "e" || text[i] === "E") && i + 1 < text.length) {
    let exp = i + 1;
    if (text[exp] === "+" || text[exp] === "-") exp++;
    if (exp < text.length && isDigit(text[exp])) {
      i = exp + 1;
      while (i < text.length && isDigit(text[i])) i++;
    }
  }
  return i;
}

/**
 * Highlights MQL commands and JSON/BSON output line by line using the editor's `.ld-*` theme classes.
 */
export function highlightMongoLines(lines: readonly string[]): Token[][] {
  const result: Token[][] = lines.map(() => []);
  let inBlockComment = false;

  for (let ln = 0; ln < lines.length; ln++) {
    const text = lines[ln];
    const tokens = result[ln];
    let i = 0;

    while (i < text.length) {
      if (inBlockComment) {
        const end = text.indexOf("*/", i);
        if (end === -1) {
          tokens.push({ from: i, to: text.length, cls: "ld-com" });
          i = text.length;
        } else {
          tokens.push({ from: i, to: end + 2, cls: "ld-com" });
          i = end + 2;
          inBlockComment = false;
        }
        continue;
      }

      const c = text[i];

      if (c === " " || c === "\t" || c === "\r") {
        i++;
        continue;
      }

      if (c === "/" && text[i + 1] === "/") {
        tokens.push({ from: i, to: text.length, cls: "ld-com" });
        i = text.length;
        continue;
      }

      if (c === "/" && text[i + 1] === "*") {
        const end = text.indexOf("*/", i + 2);
        if (end === -1) {
          tokens.push({ from: i, to: text.length, cls: "ld-com" });
          inBlockComment = true;
          i = text.length;
        } else {
          tokens.push({ from: i, to: end + 2, cls: "ld-com" });
          i = end + 2;
        }
        continue;
      }

      if (c === '"' || c === "'") {
        const end = readQuoted(text, i, c);
        const after = skipSpaces(text, end);
        const isKey = text[after] === ":";
        const rawInner = text.slice(i + 1, end - (text[end - 1] === c ? 1 : 0));
        const cls = isKey ? (rawInner.startsWith("$") ? "ld-type" : "ld-col") : "ld-str";
        tokens.push({ from: i, to: end, cls });
        i = end;
        continue;
      }

      if (isDigit(c) || (c === "-" && i + 1 < text.length && isDigit(text[i + 1]))) {
        const end = readNumber(text, i);
        tokens.push({ from: i, to: end, cls: "ld-num" });
        i = end;
        continue;
      }

      if (isIdentStart(c)) {
        let end = i + 1;
        while (end < text.length && isIdentPart(text[end])) end++;
        const word = text.slice(i, end);
        const after = skipSpaces(text, end);

        let cls: string | null = null;
        if (word.startsWith("$")) {
          cls = "ld-type";
        } else if (text[after] === "(") {
          cls = "ld-fn";
        } else if (text[after] === ":") {
          cls = "ld-col";
        } else if (MQL_KEYWORDS.has(word)) {
          cls = "ld-kw";
        } else if (i >= 3 && text.slice(i - 3, i) === "db.") {
          cls = "ld-col";
        }

        if (cls) {
          tokens.push({ from: i, to: end, cls });
        }
        i = end;
        continue;
      }

      if ("{}[]().,:;".includes(c)) {
        tokens.push({ from: i, to: i + 1, cls: "ld-op" });
        i++;
        continue;
      }

      i++;
    }
  }

  return result;
}
