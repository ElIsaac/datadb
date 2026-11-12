/**
 * Handlers de inspeccion: DDL de un objeto y plan de ejecucion (EXPLAIN). Fase 3, T1.
 * Antes: src/app/api/ddl/route.ts y src/app/api/explain/route.ts.
 *
 * Mensajes y status IDENTICOS a los de las rutas (ver errors.ts).
 */
import type { ExplainNode } from "@/lib/types";
import { assertWritableIfNeeded } from "@/server/db/read-only-guard";
import { getSession } from "@/server/sessions";
import { HandlerError } from "./errors";

export type DdlKind = "table" | "function" | "procedure" | "trigger";

/**
 * Antes: GET /api/ddl. Las vistas se piden como "table" (el renderer ya hace ese mapeo en
 * `getObjectDdl`): los drivers generan el DDL de una vista con `getTableDdl`.
 */
export async function ddlHandler(req: {
  sessionId: string;
  schema: string;
  name: string;
  kind?: DdlKind;
}): Promise<{ ddl: string }> {
  const { sessionId, schema, name } = req ?? ({} as typeof req);
  const kind = req?.kind ?? "table";
  if (!sessionId) throw new HandlerError("Missing sessionId", 400);
  if (!schema || !name) throw new HandlerError("Missing schema or name", 400);

  const stored = getSession(sessionId);
  if (!stored) throw new HandlerError("Session not found", 401);

  switch (kind) {
    case "function":
    case "procedure":
      return { ddl: await stored.driver.getRoutineDdl(schema, name, kind) };
    case "trigger":
      return { ddl: await stored.driver.getTriggerDdl(schema, name) };
    default:
      return { ddl: await stored.driver.getTableDdl(schema, name) };
  }
}

/**
 * Antes: POST /api/explain. Ejecuta EXPLAIN y devuelve el plan normalizado. No pasa por applyLimit ni queda
 * en el historial: es diagnostico, no una consulta de datos.
 *
 * Solo lectura (2026-10-09, sin cambios): el driver hace `EXPLAIN (FORMAT JSON) ${sql}` y Postgres/MySQL
 * aceptan varias sentencias en una llamada, asi que `SELECT 1; DELETE FROM t` ejecutaria el DELETE tras el
 * EXPLAIN. Se aplica el mismo guard que a query:execute. Efecto colateral aceptado: en solo lectura tampoco se
 * puede explicar un UPDATE/DELETE (aunque EXPLAIN sin ANALYZE no escriba).
 */
export async function explainHandler(req: { sessionId: string; sql: string }): Promise<{ tree: ExplainNode }> {
  const { sessionId, sql } = req ?? ({} as typeof req);
  if (!sessionId || !sql) throw new HandlerError("Missing sessionId or sql", 400);

  const stored = getSession(sessionId);
  if (!stored) throw new HandlerError("Session not found", 401);

  assertWritableIfNeeded(sql, stored.session.readOnly, stored.session.type);
  return { tree: await stored.driver.explainQuery(sql) };
}
