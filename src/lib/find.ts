/**
 * Motor de búsqueda del editor: opciones, expresión, coincidencias y reemplazo.
 *
 * PURA, sin DOM y sin dependencias. Antes se apoyaba en `SearchQuery` de `@codemirror/search`;
 * al retirar CodeMirror (2026-10-20) se reescribe con `RegExp` nativo, manteniendo el mismo
 * contrato que la barra del editor ya usaba: contar coincidencias, siguiente/anterior con vuelta,
 * reemplazo con `$1`/`$&`/`$$` en regex y un tope de coincidencias.
 *
 * Diferencias deliberadas con el motor anterior, todas a favor de lo predecible:
 *  - con «palabra completa» se usa `\b`, igual que hacía CodeMirror con búsqueda literal;
 *  - una regex inválida se reporta como tal (`reason: "invalid"`) en vez de lanzar;
 *  - las coincidencias de longitud cero se descartan: reemplazarlas en bucle es el caso
 *    patológico clásico de una regex vacía.
 */

/** Las tres casillas de la barra. */
export interface FindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export const DEFAULT_FIND_OPTIONS: FindOptions = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

/** Una coincidencia. `match` solo existe para poder expandir `$1`/`$&` en el reemplazo. */
export interface MatchRange {
  from: number;
  to: number;
  match?: RegExpMatchArray;
}

export type QueryResult =
  | { ok: true; query: RegExp }
  | { ok: false; reason: "empty" | "invalid" };

/** Escapa los metacaracteres para que una búsqueda literal no se comporte como regex. */
function escapar(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Construye la expresión. Lleva `g` siempre (se recorre el documento entero) y `i` salvo que la
 * búsqueda distinga mayúsculas. `wholeWord` se ignora con regex activo, igual que antes: quien
 * escribe una regex ya decide sus propios límites.
 */
export function createQuery(text: string, options: FindOptions): QueryResult {
  if (!text) return { ok: false, reason: "empty" };
  const cuerpo = options.regex ? text : escapar(text);
  const patron = options.wholeWord && !options.regex ? `\\b(?:${cuerpo})\\b` : cuerpo;
  try {
    return { ok: true, query: new RegExp(patron, options.caseSensitive ? "g" : "gi") };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

/**
 * Todas las coincidencias del documento, en orden. `limit` no es un detalle: sin tope, una regex
 * como `.*` sobre un documento de 10 000 líneas devuelve cientos de miles de rangos y congela la
 * barra. El llamador decide el tope y lo dice en la cuenta («999+»).
 */
export function findAll(source: string, query: RegExp, limit = 999): MatchRange[] {
  const out: MatchRange[] = [];
  const re = new RegExp(query.source, query.flags.includes("g") ? query.flags : `${query.flags}g`);
  for (const m of source.matchAll(re)) {
    if (out.length >= limit) break;
    const from = m.index ?? 0;
    const to = from + m[0].length;
    // Las de longitud cero se descartan: no hay nada que resaltar ni que reemplazar.
    if (to > from) out.push({ from, to, match: m });
  }
  return out;
}

/** La siguiente (o anterior) con vuelta, como DataGrip: del último vuelve al primero. */
export function nextIndex(current: number, total: number, delta: number): number {
  if (total <= 0) return -1;
  if (current < 0) return delta >= 0 ? 0 : total - 1;
  return (current + delta + total) % total;
}

/**
 * Expande `$1`…`$9`, `$&` y `$$` en el texto de reemplazo cuando la búsqueda es regex. Con búsqueda
 * literal se devuelve el texto tal cual: un `$1` escrito sobre una búsqueda literal es un `$1` real.
 */
export function expandReplacement(template: string, match: RegExpMatchArray | undefined): string {
  if (!match) return template;
  return template.replace(/\$(\$|&|\d)/g, (todo, token: string) => {
    if (token === "$") return "$";
    if (token === "&") return match[0] ?? todo;
    const grupo = Number(token);
    return match[grupo] ?? todo;
  });
}

/** Los cambios del reemplazo, listos para aplicarse en una sola transacción. */
export function replacementChanges(
  matches: readonly MatchRange[],
  template: string
): { from: number; to: number; insert: string }[] {
  return matches.map((m) => ({ from: m.from, to: m.to, insert: expandReplacement(template, m.match) }));
}
