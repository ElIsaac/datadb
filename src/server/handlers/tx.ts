/**
 * Handlers de transacciones manuales (modo «Manual» de la barra de la consola). Fase 3, T1.
 * Antes: src/app/api/tx/{begin,commit,rollback,status}/route.ts.
 *
 * Mensajes y status IDENTICOS a los de las rutas (ver errors.ts): las validaciones lanzan HandlerError y
 * cualquier otro fallo sale como String(err) con 500, que es lo que hacia `error(String(err), 500)`.
 *
 * La transaccion vive en `sessions.ts` (StoredSession.activeTx): una conexion del pool reservada para esa
 * sesion. Como el worker es un solo proceso, la query y el COMMIT/ROLLBACK usan la MISMA conexion; ese es el
 * requisito para que el modo Manual funcione, y se verifica contando filas en la base, no en la UI.
 */
import {
  beginSessionTransaction,
  commitSessionTransaction,
  getSession,
  hasActiveTransaction,
  rollbackSessionTransaction,
} from "@/server/sessions";
import { HandlerError } from "./errors";

type Req = { sessionId: string };

function requireSessionId(req: Req | undefined): string {
  const sessionId = req?.sessionId;
  if (!sessionId) throw new HandlerError("Missing sessionId", 400);
  return sessionId;
}

/** Antes: tx/begin/route.ts. Devuelve `active` para que la UI no tenga que preguntar despues. */
export async function beginTxHandler(req: Req): Promise<{ ok: true; active: boolean }> {
  const sessionId = requireSessionId(req);
  await beginSessionTransaction(sessionId);
  return { ok: true, active: hasActiveTransaction(sessionId) };
}

/** Antes: tx/commit/route.ts */
export async function commitTxHandler(req: Req): Promise<{ ok: true }> {
  await commitSessionTransaction(requireSessionId(req));
  return { ok: true };
}

/** Antes: tx/rollback/route.ts */
export async function rollbackTxHandler(req: Req): Promise<{ ok: true }> {
  await rollbackSessionTransaction(requireSessionId(req));
  return { ok: true };
}

/**
 * Antes: tx/status/route.ts. En Electron, hasta esta fase, esta llamada fallaba EN SILENCIO
 * (app-shell.tsx la envuelve en `.catch(() => undefined)`): el indicador de transaccion abierta no se
 * sincronizaba al cambiar de consola.
 */
export async function txStatusHandler(req: Req): Promise<{ active: boolean }> {
  const sessionId = requireSessionId(req);
  if (!getSession(sessionId)) throw new HandlerError("Session not found", 401);
  return { active: hasActiveTransaction(sessionId) };
}
