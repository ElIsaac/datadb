/**
 * Edición de valores de un documento de Mongo (fase 85).
 *
 * Lo que se escribe en la tarjeta es TEXTO, y lo que hay que mandar al servidor es un valor del MISMO
 * tipo que el original: si `total` era un número y se guarda `"1200"` como cadena, la consulta de
 * mañana que filtre por rango deja de encontrarlo y el error aparece lejos de aquí.
 *
 * Estas funciones son puras: convierten texto a valor tipado, dicen si el texto es aceptable para el
 * tipo original y calculan qué campos cambiaron. Se prueban sin base de datos ni ventana.
 */
import { tipoDeValor, type TipoDeValor } from "@/shared/mongo-view";

/** Tipos que la v1 deja editar en la tarjeta. Objetos y arrays quedan para su propio editor. */
export const TIPOS_EDITABLES: TipoDeValor[] = ["string", "number", "boolean", "null"];

export function esEditable(tipo: TipoDeValor): boolean {
  return TIPOS_EDITABLES.includes(tipo);
}

export interface ValorConvertido {
  ok: true;
  valor: unknown;
}

export interface ValorInvalido {
  ok: false;
  /** Motivo para el aviso en línea, en el idioma del formulario. */
  error: string;
}

/**
 * Texto tecleado → valor del tipo del original.
 *
 * - `string`: tal cual (sin comillas; el usuario escribe el contenido).
 * - `number`: número finito; `12,5` con coma se acepta como 12.5 porque es lo que se teclea con
 *   teclado en español, pero se avisa del redondeo implícito no: se convierte y ya.
 * - `boolean`: `true`/`false` (y `1`/`0`, `si`/`no` se rechazan — mejor explícito).
 * - `null`: cualquier texto lo convierte en un valor nuevo del tipo que se elija aparte; aquí `null`
 *   solo acepta vacío (seguir siendo null).
 */
export function convertirTexto(texto: string, tipo: TipoValorOriginal): ValorConvertido | ValorInvalido {
  const t = texto.trim();
  switch (tipo) {
    case "string":
      return { ok: true, valor: texto };
    case "number": {
      if (!t) return { ok: false, error: "Escribe un número" };
      const n = Number(t.replace(",", "."));
      if (!Number.isFinite(n)) return { ok: false, error: `"${texto}" no es un número` };
      return { ok: true, valor: n };
    }
    case "boolean": {
      if (t === "true") return { ok: true, valor: true };
      if (t === "false") return { ok: true, valor: false };
      return { ok: false, error: "Solo true o false" };
    }
    case "null":
      return t === "" ? { ok: true, valor: null } : { ok: false, error: "Este campo es nulo: usa «poner valor»" };
  }
}

/** Tipos de valor original que la tarjeta sabe editar (incluye `null`, que no tiene texto propio). */
export type TipoValorOriginal = Extract<TipoDeValor, "string" | "number" | "boolean" | "null">;

/** Texto que se pone en el input al empezar a editar (sin comillas ni adornos). */
export function textoEditable(valor: unknown): string {
  const tipo = tipoDeValor(valor);
  if (tipo === "null") return "";
  if (tipo === "boolean") return valor ? "true" : "false";
  if (tipo === "number") return String(valor);
  if (tipo === "string") return String(valor);
  // Cualquier otra cosa no debería llegar aquí (no es editable), pero un texto razonable es mejor
  // que "undefined" en el input.
  return String(valor ?? "");
}

/** Compara por representación: suficiente para saber si el borrador difiere del servidor. */
export function mismoValor(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // NaN nunca es igual a sí mismo y JSON lo convierte en null: se comparan como texto.
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Campos que el borrador cambia respecto del documento original. Devuelve solo los distintos: es lo
 * que se manda al servidor (nunca el documento entero).
 */
export function cambiosRespectoA(
  original: Record<string, unknown>,
  borrador: Record<string, unknown>
): Record<string, unknown> {
  const cambios: Record<string, unknown> = {};
  for (const [campo, valor] of Object.entries(borrador)) {
    if (!mismoValor(original[campo], valor)) cambios[campo] = valor;
  }
  return cambios;
}

/** ¿El campo ya estaba en el documento? Un campo nuevo no tiene «antes» con qué comparar. */
export function existiaEn(original: Record<string, unknown>, campo: string): boolean {
  return Object.prototype.hasOwnProperty.call(original, campo);
}
