/**
 * Cliente IPC del renderer: la UNICA via del renderer a los datos desde la fase 3 (D1; `ipcAvailable()` y la rama
 * `fetch` de api.ts se borraron con las rutas de Next).
 *
 * Mantiene el contrato de errores: un IpcResult de error se vuelve un ApiError con el MISMO
 * mensaje y status que daba la ruta HTTP, de modo que String(err) sigue matcheando
 * /session not found/i (auto-reconexion de sql-editor.tsx).
 */
import type { InvokeChannel, InvokeMap, IpcResult } from "@/shared/contract";
import { ApiError } from "./api-error";

export function unwrap<T>(result: IpcResult<T>): T {
  if (result.ok) return result.data;
  throw new ApiError(result.error.message, result.error.status);
}

export async function invoke<C extends InvokeChannel>(
  channel: C,
  payload?: InvokeMap[C]["req"]
): Promise<InvokeMap[C]["res"]> {
  const bridge = window.gestordb;
  if (!bridge) throw new ApiError("El puente IPC no esta disponible", 500);
  return unwrap(await bridge.invoke(channel, payload));
}
