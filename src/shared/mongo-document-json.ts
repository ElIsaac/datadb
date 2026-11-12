/**
 * Texto JSON de un documento completo para el editor de la vista de Mongo (fase 86).
 *
 * Se usa en tres sitios con las mismas reglas: insertar uno nuevo, duplicar el que ya existe y editar
 * el documento entero (incluidos los anidados, que la tarjeta no deja tocar). Acepta la misma sintaxis
 * que la barra de consulta (`{ campo: valor }`, `ObjectId("…")`), porque el usuario escribe en el
 * mismo idioma en los dos sitios.
 */
import { normalizarConsulta } from "@/shared/mongo-query";

/*
 * SIN `BSON` aquí: este módulo corre TAMBIÉN en el renderer (lo usa el diálogo de insertar), y meter
 * el driver de Mongo en el bundle del renderer tumba la ventana entera con
 * «Class extends value undefined is not a constructor or null» (bson hereda de clases de otro chunk
 * y el orden de carga se rompe). El parser es JSON puro: el normalizador + `JSON.parse`, y los
 * envoltorios (`{$oid}`) se quedan como objetos planos; el DRIVER los rehidrata con EJSON al
 * escribir (ver `updateDocument`/`insertDocument`). Se pierde el constructor `ObjectId("…")` en el
 * diálogo, no la validez de lo que se inserta.
 */

export interface DocumentoValido {
  ok: true;
  documento: Record<string, unknown>;
}

export interface DocumentoInvalido {
  ok: false;
  error: string;
}

/** Texto del usuario → documento. Vacío NO es válido aquí: insertar `{}` es una decisión explícita. */
export function parsearDocumentoJson(texto: string): DocumentoValido | DocumentoInvalido {
  const limpio = texto.trim();
  if (!limpio) return { ok: false, error: "Escribe al menos un campo" };
  const normalizado = normalizarConsulta(limpio);
  try {
    const valor = JSON.parse(normalizado);
    if (valor === null || typeof valor !== "object" || Array.isArray(valor)) {
      return { ok: false, error: "Un documento tiene que ser un objeto, p. ej. { \"campo\": \"valor\" }" };
    }
    return { ok: true, documento: valor as Record<string, unknown> };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Copia del documento SIN `_id` (ni `__v`, que es de Mongoose y no se debe duplicar): el servidor
 * genera un id nuevo al insertar. Se serializa a EJSON para no perder tipos.
 */
export function plantillaParaDuplicar(doc: Record<string, unknown>): string {
  const copia: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === "_id") continue;
    copia[k] = v;
  }
  return JSON.stringify(copia, null, 2);
}

/** Texto inicial del editor de un documento existente (con su `_id`, que se muestra pero no se envía). */
export function plantillaParaEditar(doc: Record<string, unknown>): string {
  return JSON.stringify(doc, null, 2);
}
