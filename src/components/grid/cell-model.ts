/**
 * Modelo de celda del grid (fase 11, T3): valor crudo del driver → lo que se pinta.
 *
 * Separado del componente a propósito: es la única parte de la rejilla que se puede probar sin
 * navegador, y es donde viven los casos que ya mordieron antes (un `jsonb` saliendo como
 * "[object Object]", un NULL indistinguible de la cadena vacía).
 *
 * El texto lo pone `cellText()`, que es el mismo que usa el grid de hoy, el exportador y el
 * editor: si esto divergiera, la celda, el portapapeles y el CSV dirían cosas distintas del mismo
 * dato.
 */
import { cellText } from "@/lib/cell-value";
import { getColumnKind } from "@/lib/column-kind";

export interface CeldaPintada {
  /** Lo que se dibuja. */
  texto: string;
  /** NULL se pinta distinto (atenuado) para no confundirlo con una cadena vacía. */
  esNulo: boolean;
  /** Alineación: los números a la derecha, como en DataGrip. */
  alineacion: "izquierda" | "derecha";
}

/** Lo que se muestra en una celda NULL. DataGrip usa este literal, no una celda en blanco. */
export const TEXTO_NULO = "[NULL]";

/**
 * Tope de caracteres que se le dan a la rejilla para UNA celda (fase 12, T6).
 *
 * **Medido**, no elegido a ojo: con una sola celda de 5 MB en el result set, *cualquier*
 * interacción con la rejilla pasaba a costar **5 030 ms** — incluido pinchar una celda pequeña de
 * otra columna. Con un máximo de 500 KB, 21 ms; con valores normales, 20 ms. Es decir: el texto
 * completo de la celda lo paga la rejilla entera en cada repintado, aunque de él sólo se vean unos
 * 60 caracteres.
 *
 * 4 096 es holgado para cualquier ancho de columna razonable (una columna de 1 000 px muestra del
 * orden de 150 caracteres) y deja el coste en nada.
 *
 * El valor COMPLETO no se pierde: vive en la fila, y es el que recibe el value editor (R37). Esto
 * sólo recorta lo que se DIBUJA.
 */
export const MAX_CARACTERES_EN_CELDA = 4096;

/** Marca de que lo que se ve está recortado. El panel del valor enseña el contenido entero. */
export const MARCA_RECORTE = "…";

/**
 * Tipos cuyo contenido se alinea a la derecha. Se decide por el NOMBRE del tipo, que desde la
 * fase 10 llega bien también en los resultados de consulta (antes era el OID numérico).
 */
function esNumerico(tipoDeColumna: string): boolean {
  const t = tipoDeColumna.toLowerCase().trim();
  // Los arrays NO van a la derecha aunque su base sea numérica: se leen como texto.
  if (t.endsWith("[]")) return false;
  return /^(tinyint|smallint|mediumint|int|integer|int2|int4|int8|bigint|serial|float|float4|float8|double|real|numeric|decimal|number|money|smallmoney)/.test(
    t
  );
}

export function pintarCelda(valor: unknown, tipoDeColumna = ""): CeldaPintada {
  const texto = cellText(valor);
  if (texto === null) {
    return { texto: TEXTO_NULO, esNulo: true, alineacion: "izquierda" };
  }
  return {
    // Ver `MAX_CARACTERES_EN_CELDA`: pasarle a la rejilla un texto de megabytes cuesta segundos por
    // repintado, y de él no se ve ni el 0,1 %.
    texto:
      texto.length > MAX_CARACTERES_EN_CELDA
        ? texto.slice(0, MAX_CARACTERES_EN_CELDA) + MARCA_RECORTE
        : texto,
    esNulo: false,
    alineacion: esNumerico(tipoDeColumna) ? "derecha" : "izquierda",
  };
}

/**
 * R98: el valor de una columna booleana como `true`/`false`, o `null` si no se puede pintar como
 * casilla (NULL, o un valor que no es 0/1: un `TINYINT(1)` usado como número sigue saliendo como
 * texto, así no se esconde un 7 detrás de una casilla marcada).
 *
 * Formas en que llega un booleano según el driver: `boolean` (Postgres, SQL Server), `0`/`1`
 * (`TINYINT(1)` de MySQL), un `Uint8Array` de un byte (`BIT(1)` de MySQL) y, por si acaso, las
 * cadenas `"t"`/`"f"`/`"true"`/`"false"`/`"0"`/`"1"`.
 */
export function valorBooleano(valor: unknown): boolean | null {
  if (typeof valor === "boolean") return valor;
  if (valor === 0 || valor === 1) return valor === 1;
  if (valor instanceof Uint8Array && valor.length === 1 && (valor[0] === 0 || valor[0] === 1)) return valor[0] === 1;
  if (typeof valor === "string") {
    const v = valor.toLowerCase();
    if (v === "t" || v === "true" || v === "1") return true;
    if (v === "f" || v === "false" || v === "0") return false;
  }
  return null;
}

/** ¿La columna se pinta con casillas? */
export function esColumnaBooleana(tipoDeColumna: string): boolean {
  return getColumnKind(tipoDeColumna) === "boolean";
}

/**
 * R98: el valor que se GUARDA al marcar/desmarcar la casilla, con la misma forma que tenía el original:
 * un `TINYINT(1)` vuelve como 1/0 y no como `true`/`false`. Si no, desmarcar y volver a marcar dejaría
 * la celda «modificada» (1 contra `true`) aunque el valor fuera el mismo.
 */
export function booleanoParaGuardar(original: unknown, marcado: boolean): unknown {
  if (typeof original === "number") return marcado ? 1 : 0;
  return marcado;
}

/**
 * R98: color de texto por tipo de dato, sacado de los colores de SINTAXIS del tema (los mismos que en
 * el editor, así cambia con el tema): números como los números del SQL, fechas y horas como las
 * funciones, JSON/arrays como las cadenas. El texto normal se queda en el color de texto de la rejilla
 * —colorear todo cansa y DataGrip tampoco lo hace—. `null` = color de texto normal.
 *
 * El usuario lo pidió al ver la vista previa de la fase R98 («me gustaba como estaba»); se puede
 * apagar en Apariencia › Rejilla de datos.
 */
export type TokenDeTipo = "--gdb-num" | "--gdb-fn" | "--gdb-str";
export function tokenDeColorPorTipo(tipoDeColumna: string): TokenDeTipo | null {
  const t = tipoDeColumna.toLowerCase().trim();
  if (t.endsWith("[]") || /^(json|jsonb)\b/.test(t)) return "--gdb-str";
  switch (getColumnKind(tipoDeColumna)) {
    case "number":
      return "--gdb-num";
    case "date":
    case "time":
    case "datetime":
    case "datetimetz":
      return "--gdb-fn";
    default:
      return null;
  }
}

/**
 * Texto de una celda para el portapapeles y la exportación.
 *
 * Diferencia deliberada con lo que se PINTA: un NULL se copia como cadena vacía, no como
 * "[NULL]". Si se copiara el literal, pegar en otra herramienta metería la cadena "[NULL]" como
 * dato — que es justo el bug clásico de copiar de una rejilla.
 */
export function celdaParaCopiar(valor: unknown): string {
  return cellText(valor) ?? "";
}
