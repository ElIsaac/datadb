import type { ErrorStatus } from "@/shared/contract";

/**
 * Error con status explicito. Reemplaza los `return error("...", 4xx)` de las rutas: el
 * handler lanza, y cada transporte (HTTP o IPC) lo traduce con errorToPayload.
 */
export class HandlerError extends Error {
  constructor(
    message: string,
    public readonly status: ErrorStatus
  ) {
    super(message);
    this.name = "HandlerError";
  }
}

/**
 * Traduccion UNICA de errores. Reproduce exactamente el comportamiento previo de las rutas:
 *  - error explicito -> su mensaje tal cual + su status
 *  - cualquier otra cosa -> String(err) con 500 (incluye el prefijo "Error: ")
 * No "mejorar" el mensaje: la auto-reconexion de sql-editor.tsx lo matchea con regex.
 */
export function errorToPayload(err: unknown): { message: string; status: ErrorStatus } {
  if (err instanceof HandlerError) return { message: err.message, status: err.status };
  return { message: String(err), status: 500 };
}
