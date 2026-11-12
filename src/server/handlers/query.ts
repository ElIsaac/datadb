/**
 * Handlers de query. Antes: src/app/api/query/{route,cancel/route,history/route}.ts.
 *
 * executeQueryHandler conserva TODO lo que hacia la ruta, en el mismo orden:
 *   validacion -> sesion -> guard read-only -> applyLimit -> executeQuery(sql, activeTx)
 *   -> historial en exito Y en error -> console.error -> relanzar.
 * Las validaciones (Missing..., Session not found) NO registran historial, igual que antes.
 */
import { dialectoSql } from "@/shared/connection-net";
import type { QueryHistoryEntry } from "@/lib/types";
import type { InvokeMap } from "@/shared/contract";
import { applyLimit } from "@/server/db/limit";
import { assertWritableIfNeeded } from "@/server/db/read-only-guard";
import { addQueryHistory, clearQueryHistory, getQueryHistory, getSession } from "@/server/sessions";
import { HandlerError } from "./errors";

type ExecuteReq = Omit<InvokeMap["query:execute"]["req"], "opId"> & { opId?: string };

/**
 * Operaciones en curso: opId -> sessionId (fase 3, T4; R4 pide «cancelación por id de operación»). Vive en el worker,
 * que es un solo proceso, asi que un Map basta. La entrada se borra al terminar la query, con exito o con error.
 *
 * Hueco conocido (R16, fase 19): cancelar sigue siendo A NIVEL DE DRIVER. El opId elige la sesion correcta, pero si
 * dos consolas comparten driver (mismo perfil), cancelar una puede cortar la query de la otra. Esto no lo arregla.
 */
const runningOps = new Map<string, string>();

/** Para tests y diagnostico: cuantas operaciones hay en curso. */
export function runningOperationCount(): number {
  return runningOps.size;
}

export async function executeQueryHandler(
  body: ExecuteReq
): Promise<InvokeMap["query:execute"]["res"]> {
  const startAt = Date.now();
  const sessionId = body.sessionId;
  const originalSql = body.sql;

  if (!sessionId || !originalSql) {
    throw new HandlerError("Missing sessionId or sql", 400);
  }
  const stored = getSession(sessionId);
  if (!stored) throw new HandlerError("Session not found", 401);

  if (body.opId) runningOps.set(body.opId, sessionId);
  try {
    assertWritableIfNeeded(originalSql, stored.session.readOnly, dialectoSql(stored.session.type));

    const { sql, limitApplied, effectiveLimit, effectiveOffset } = applyLimit(
      originalSql,
      body.limit,
      body.offset,
      dialectoSql(stored.session.type)
    );

    const result = await stored.driver.executeQuery(sql, stored.activeTx);
    await addQueryHistory(sessionId, {
      id: crypto.randomUUID(),
      sql: originalSql,
      executedAt: new Date().toISOString(),
      durationMs: Date.now() - startAt,
      rowCount: result.rowCount,
      affectedRows: result.affectedRows,
    });
    return { ...result, limitApplied, effectiveLimit, effectiveOffset };
  } catch (err) {
    await addQueryHistory(sessionId, {
      id: crypto.randomUUID(),
      sql: originalSql,
      executedAt: new Date().toISOString(),
      durationMs: Date.now() - startAt,
      error: String(err),
    });
    // Se loguea donde ocurre (en el utilityProcess llega a la consola de main con prefijo).
    console.error("[query error]", { sql: originalSql, err });
    throw err;
  } finally {
    if (body.opId) runningOps.delete(body.opId);
  }
}

/**
 * Antes: query/cancel/route.ts. Fase 3 (T4): acepta `{ opId }` (lo que usa el editor) ademas de `{ sessionId }`.
 *
 * Con opId: si la operacion ya no esta en curso (termino justo antes de pulsar Cancelar) NO es error: no hay nada que
 * cancelar y se responde ok. Con sessionId: el comportamiento de la ruta, sin cambios.
 *
 * La cancelacion sigue siendo A NIVEL DE DRIVER: cancelar en una consola puede matar la query de otra con el mismo
 * perfil. Es el bug R16 (fase 19), no se arregla aqui.
 */
export async function cancelQueryHandler(req: { sessionId?: string; opId?: string }): Promise<{ ok: true }> {
  let sessionId = req?.sessionId;
  if (req?.opId) {
    const owner = runningOps.get(req.opId);
    if (!owner) return { ok: true };
    sessionId = owner;
  }
  if (!sessionId) throw new HandlerError("Missing sessionId", 400);
  const stored = getSession(sessionId);
  if (!stored) throw new HandlerError("Session not found", 401);
  await stored.driver.cancelQuery();
  return { ok: true };
}

/** Antes: query/history/route.ts (GET). */
export async function listHistoryHandler({
  sessionId,
}: {
  sessionId: string;
}): Promise<QueryHistoryEntry[]> {
  if (!sessionId) throw new HandlerError("Missing sessionId", 400);
  return getQueryHistory(sessionId);
}

/**
 * Antes: query/history/route.ts (DELETE). Fase 3, T3. Vacia el historial de la sesion y su parte del log en disco
 * (`clearQueryHistoryLog`, por nombre de conexion). Sesion inexistente: no hace nada, como la ruta.
 */
export async function clearHistoryHandler({ sessionId }: { sessionId: string }): Promise<{ ok: true }> {
  if (!sessionId) throw new HandlerError("Missing sessionId", 400);
  await clearQueryHistory(sessionId);
  return { ok: true };
}
