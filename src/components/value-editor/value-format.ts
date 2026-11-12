/**
 * Cómo se presenta UN valor en el panel del value editor (fase 12, T3).
 *
 * Esto es la contraparte de `lib/cell-value.ts`: aquél produce **una línea** para la celda, el
 * copiado y la exportación; éste produce el texto **legible** del panel. Van por separado a
 * propósito — lo que hace útil a la celda (compacto) es justo lo que hace ilegible a un `jsonb`.
 *
 * Regla que no es obvia y que conviene no romper: **nunca se reescribe el texto que está
 * almacenado**. Se indenta sólo cuando el driver entregó un valor ESTRUCTURADO (objeto o array),
 * porque entonces no existe un «texto original» — lo serializamos nosotros. Una columna `text` que
 * casualmente contiene JSON se muestra tal y como está guardada: si el panel la reindentara, el
 * usuario vería algo distinto de lo que hay en la base y, al confirmar, guardaría un cambio que no
 * pidió.
 */

/** Lenguaje con el que se resalta el contenido en CodeMirror. */
export type LenguajeDelValor = "json" | "text";

export interface ValorPresentado {
  /** Texto a mostrar. Cadena vacía cuando el valor es NULL (el panel lo pinta aparte). */
  texto: string;
  lenguaje: LenguajeDelValor;
  /** Tamaño del contenido en bytes, para la cabecera. */
  bytes: number;
  esNulo: boolean;
  /** Binarios: se ven, no se editan (D4 de la fase 12). */
  soloLecturaPorTipo: boolean;
  /** Qué es, en palabras, para la cabecera: `jsonb`, `binario`, `texto`… */
  descripcion: string;
}

const TIPOS_JSON = /^(json|jsonb)$/i;
const TIPOS_BINARIOS = /(bytea|blob|binary|varbinary|image)/i;

/** Bytes de una cadena en UTF-8, que es lo que ocupa de verdad y no su `length`. */
export function bytesDeTexto(texto: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(texto).length;
  return Buffer.byteLength(texto, "utf8");
}

/**
 * Hexadecimal agrupado de a 2 bytes, como lo enseñan los visores de binarios. Se corta a `maximo`
 * bytes: un BLOB de 10 MB en hex son 20 millones de caracteres, y el panel no es un editor hex.
 */
export function hexDeBytes(bytes: Uint8Array, maximo = 64 * 1024): { texto: string; truncado: boolean } {
  const fin = Math.min(bytes.length, maximo);
  const partes: string[] = [];
  for (let i = 0; i < fin; i++) {
    partes.push(bytes[i].toString(16).padStart(2, "0"));
    // Un salto cada 16 bytes: una línea de 32 caracteres hexadecimales se lee; una de 2000, no.
    if ((i + 1) % 16 === 0) partes.push("\n");
    else if ((i + 1) % 2 === 0) partes.push(" ");
  }
  return { texto: partes.join("").trimEnd(), truncado: bytes.length > fin };
}

/**
 * Bytes reales detrás de una representación hexadecimal (`\xdeadbeef` → 4). Si no tiene esa forma,
 * se cae a contar el texto: más vale un número aproximado que ninguno.
 */
export function bytesDeHex(texto: string): number {
  const limpio = texto.startsWith("\\x") ? texto.slice(2) : texto;
  return /^[0-9a-fA-F]*$/.test(limpio) ? Math.floor(limpio.length / 2) : bytesDeTexto(texto);
}

export function presentarValor(valor: unknown, tipo = ""): ValorPresentado {
  if (valor === null || valor === undefined) {
    return { texto: "", lenguaje: "text", bytes: 0, esNulo: true, soloLecturaPorTipo: false, descripcion: "NULL" };
  }

  if (valor instanceof Uint8Array) {
    const { texto, truncado } = hexDeBytes(valor);
    return {
      texto: truncado ? `${texto}\n\n… (truncado: se muestran 64 KB de ${valor.length} bytes)` : texto,
      lenguaje: "text",
      bytes: valor.length,
      esNulo: false,
      soloLecturaPorTipo: true,
      descripcion: "binario",
    };
  }

  if (valor instanceof Date) {
    const texto = String(valor);
    return { texto, lenguaje: "text", bytes: bytesDeTexto(texto), esNulo: false, soloLecturaPorTipo: false, descripcion: tipo || "fecha" };
  }

  // Objetos y arrays: los entregó el driver ya estructurados (`pg` convierte json/jsonb y los
  // arrays de Postgres), así que el texto lo escribimos nosotros y puede ir indentado.
  if (typeof valor === "object") {
    let texto: string;
    try {
      texto = JSON.stringify(valor, null, 2);
    } catch {
      texto = String(valor);
    }
    return {
      texto,
      lenguaje: "json",
      bytes: bytesDeTexto(texto),
      esNulo: false,
      soloLecturaPorTipo: false,
      descripcion: tipo || (Array.isArray(valor) ? "array" : "json"),
    };
  }

  const texto = String(valor);
  const esBinario = TIPOS_BINARIOS.test(tipo);
  return {
    texto,
    lenguaje: TIPOS_JSON.test(tipo) ? "json" : "text",
    // Un `bytea` no siempre llega como `Uint8Array`: medido en la app, Postgres lo entrega como la
    // cadena hexadecimal `\xdeadbeef…`, y contar sus caracteres diría 42 B donde hay 20. El tamaño
    // que importa es el del dato en la base, no el de su representación.
    bytes: esBinario ? bytesDeHex(texto) : bytesDeTexto(texto),
    esNulo: false,
    soloLecturaPorTipo: esBinario,
    descripcion: tipo || typeof valor,
  };
}

/** `1 234 B`, `12,3 KB`, `4,5 MB` — para la cabecera del panel. */
export function tamanoLegible(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
