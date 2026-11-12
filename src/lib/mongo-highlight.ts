/**
 * Resaltado de sintaxis de la barra de consulta de MongoDB (fase 83).
 *
 * POR QUÉ: la barra es un `<input>` de una línea: no se puede pintar por dentro. Se pinta un
 * ESPEJO detrás (un `<div>` con los mismos caracteres, ya coloreados) y el `<input>` va encima con el
 * texto transparente y el `caret` visible. Para que las dos capas coincidan al píxel, el espejo usa
 * EXACTAMENTE la misma fuente, tamaño, padding y `white-space: pre`.
 *
 * El tokenizador es puro y no conoce el DOM: recibe el texto y devuelve tramos con su tipo. Así se
 * prueba sin ventana y se puede reutilizar en el autocompletado (que necesita saber dónde está el
 * cursor).
 */

export type TipoToken =
  | "llave" // { } [ ] ( ) : , —
  | "clave" // campo o "campo.anidado" antes de los dos puntos
  | "cadena"
  | "numero"
  | "literal" // true / false / null
  | "operador" // $gt, $regex…
  | "constructor" // ObjectId("…"), ISODate("…")
  | "espacio" // tramos de espacios: se pintan sin color
  | "texto"; // cualquier otra cosa

export interface Token {
  texto: string;
  tipo: TipoToken;
}

const PUNTUACION = new Set(["{", "}", "[", "]", "(", ")", ":", ","]);

/** Nombres que el shell de Mongo usa como constructores y que el normalizador entiende. */
export const CONSTRUCTORES = new Set([
  "ObjectId",
  "ISODate",
  "NumberLong",
  "NumberDecimal",
  "NumberInt",
  "Date",
]);

const LITERALES = new Set(["true", "false", "null"]);

/**
 * Parte el texto en tramos. No valida la sintaxis: un texto a medio escribir tiene que poder
 * pintarse igual (es justo cuando más se mira la barra).
 */
export function tokenizarConsulta(texto: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const empujar = (t: string, tipo: TipoToken) => {
    if (!t) return;
    const ultimo = tokens[tokens.length - 1];
    if (ultimo && ultimo.tipo === tipo) ultimo.texto += t;
    else tokens.push({ texto: t, tipo });
  };

  while (i < texto.length) {
    const c = texto[i];

    // --- Cadenas (dobles o simples) ----------------------------------------
    if (c === '"' || c === "'") {
      const comilla = c;
      let j = i + 1;
      while (j < texto.length) {
        if (texto[j] === "\\") j += 2;
        else if (texto[j] === comilla) {
          j++;
          break;
        } else j++;
      }
      // Una cadena seguida de `:` es una CLAVE entre comillas (`"detalle.pais"`): se pinta como
      // clave, no como texto, que es lo que espera quien la escribió así.
      empujar(texto.slice(i, j), siguienteEsDosPuntos(texto.slice(j)) ? "clave" : "cadena");
      i = j;
      continue;
    }

    // --- Puntuación ---------------------------------------------------------
    if (PUNTUACION.has(c)) {
      empujar(c, "llave");
      i++;
      continue;
    }

    // --- Espacios: su propio tramo, para que el espejo sea fiel y los tokens exactos.
    if (/\s/.test(c)) {
      let j = i;
      while (j < texto.length && /\s/.test(texto[j])) j++;
      empujar(texto.slice(i, j), "espacio");
      i = j;
      continue;
    }

    // --- Números (incluye negativos y decimales) ----------------------------
    if (/[-\d]/.test(c) && /\d/.test(texto[i + 1] ?? "")) {
      let j = i + 1;
      while (j < texto.length && /[\d.eE+-]/.test(texto[j])) j++;
      empujar(texto.slice(i, j), "numero");
      i = j;
      continue;
    }

    // --- Operadores `$…` ----------------------------------------------------
    if (c === "$") {
      let j = i + 1;
      while (j < texto.length && /\w/.test(texto[j])) j++;
      empujar(texto.slice(i, j), "operador");
      i = j;
      continue;
    }

    // --- Identificadores: claves, literales y constructores -----------------
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < texto.length && /[\w$]/.test(texto[j])) j++;
      const palabra = texto.slice(i, j);
      // Lo que sigue (sin espacios) dice si es una clave del objeto.
      const resto = texto.slice(j);
      const esClave = siguienteEsDosPuntos(resto);

      if (LITERALES.has(palabra)) empujar(palabra, "literal");
      else if (CONSTRUCTORES.has(palabra) && /^\s*\(/.test(resto)) empujar(palabra, "constructor");
      else if (esClave) empujar(palabra, "clave");
      else empujar(palabra, "texto");
      i = j;
      continue;
    }

    empujar(c, "texto");
    i++;
  }

  return tokens;
}

/** `:` justo después (con espacios de por medio). */
function siguienteEsDosPuntos(resto: string): boolean {
  return /^\s*:/.test(resto);
}
