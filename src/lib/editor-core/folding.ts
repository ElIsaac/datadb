/**
 * F2 — plegado del editor propio: qué líneas se pueden cerrar y dónde.
 *
 * Es lógica PURA sobre el texto (sin DOM, sin modelo, sin Lezer) para que se pueda probar en Node y
 * para que la vista solo tenga que decidir «pinto esta línea o la salto».
 *
 * Qué se pliega, en este orden de prioridad:
 *
 *  1. **Bloques de llaves/paréntesis/corchetes** que abren en una línea y cierran en otra posterior
 *     —el cuerpo de un `CREATE FUNCTION`, un `INSERT (…, …)` partido en varias líneas—. Se empareja
 *     con un contador de profundidad y se ignoran llaves dentro de cadenas o comentarios.
 *  2. **Comentarios de bloque** `/* … *\/`.
 *
 * Lo que NO se pliega (y por qué): las sentencias `SELECT … ;` de varias líneas. En un documento con
 * diez consultas, plegar cada una deja el editor en una lista de `SELECT` sin contexto; DataGrip
 * tampoco las pliega de fábrica.
 *
 * La región plegada se expresa en LÍNEAS (0-based, como el modelo) y NO incluye la línea que abre:
 * al colapsar se ve `SELECT * FROM (` y un indicador de que hay más.
 */

export interface FoldRange {
  /** Línea que se queda visible (la que abre el bloque). */
  fromLine: number;
  /** Última línea OCULTA (inclusive). El cierre queda fuera: `}` se sigue viendo. */
  toLine: number;
}

const ABRE: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
const CIERRA = new Set(Object.values(ABRE));

/**
 * Recorre las líneas llevando la profundidad de llaves y las cadenas abiertas.
 *
 * Las cadenas se cierran al final de la línea si no se cerraron: en SQL un literal partido en dos
 * líneas sin cerrar es un error, y arrastrar el estado convertiría el archivo entero en «dentro de
 * una cadena», ocultando todos los pliegues.
 */
export function computeFoldRanges(text: string): FoldRange[] {
  const lines = text.split("\n");
  const ranges: FoldRange[] = [];

  /** Pila de aperturas: carácter, línea y columna donde abrió. */
  const pila: { ch: string; line: number }[] = [];
  let enComentarioBloque = false;

  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    let enCadena: string | null = null;

    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      const next = line[c + 1];

      if (enComentarioBloque) {
        if (ch === "*" && next === "/") {
          enComentarioBloque = false;
          c++;
        }
        continue;
      }
      if (enCadena) {
        if (ch === enCadena) enCadena = null;
        continue;
      }
      if (ch === "-" && next === "-") break; // comentario de línea: el resto no cuenta
      if (ch === "/" && next === "*") {
        enComentarioBloque = true;
        c++;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") {
        enCadena = ch;
        continue;
      }
      if (ABRE[ch]) {
        pila.push({ ch, line: n });
        continue;
      }
      if (CIERRA.has(ch)) {
        const abierto = pila.pop();
        // Cierra una línea POSTERIOR: hay algo que plegar. Si cerró en la misma línea (un
        // `INSERT (1, 2)`) no hay nada que ocultar.
        if (abierto && n > abierto.line && n - abierto.line >= 1) {
          ranges.push({ fromLine: abierto.line, toLine: n - 1 > abierto.line ? n - 1 : abierto.line });
        }
      }
    }
    // Una cadena sin cerrar no se arrastra a la línea siguiente (ver arriba).
  }

  // Bloques que quedaron abiertos (documento a medio escribir): se pliegan hasta el final.
  for (const pendiente of pila) {
    if (lines.length - 1 > pendiente.line) {
      ranges.push({ fromLine: pendiente.line, toLine: lines.length - 1 });
    }
  }

  return normalizar(ranges);
}

/** Ordena, descarta las que no ocultan nada y elimina las contenidas en otra igual o mayor. */
function normalizar(ranges: FoldRange[]): FoldRange[] {
  const utiles = ranges.filter((r) => r.toLine > r.fromLine);
  utiles.sort((a, b) => a.fromLine - b.fromLine || b.toLine - a.toLine);
  const out: FoldRange[] = [];
  for (const r of utiles) {
    const previo = out[out.length - 1];
    // Anidada dentro de la anterior: plegar la exterior ya la oculta. Se descarta para que el
    // marcador del canal sea uno por bloque visible y no una escalera de flechas.
    if (previo && r.fromLine >= previo.fromLine && r.toLine <= previo.toLine) continue;
    out.push(r);
  }
  return out;
}

/** ¿La línea está oculta por algún pliegue? (`fromLine` siempre se ve.) */
export function estaOculta(line: number, pliegues: readonly FoldRange[]): boolean {
  return pliegues.some((r) => line > r.fromLine && line <= r.toLine);
}

/** Pliegue que empieza en esa línea, si lo hay: es el que dibuja la flecha del canal. */
export function pliegueEnLinea(
  line: number,
  pliegues: readonly FoldRange[]
): FoldRange | undefined {
  return pliegues.find((r) => r.fromLine === line);
}
