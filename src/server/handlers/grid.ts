/**
 * Handler de la edicion del grid (Guardar los cambios pendientes: UPDATE/INSERT/DELETE en lote, transaccional en
 * el driver). Fase 3, T3. Antes: src/app/api/batch-edit/route.ts.
 *
 * Mensajes y status IDENTICOS a los de la ruta. Solo lectura: se lanza `ReadOnlyViolationError` (no un
 * HandlerError) porque la ruta lo atrapaba en su `catch` y lo devolvia como `String(err)` con 500; el renderer
 * muestra ese texto («Esta conexión está en modo solo lectura…»).
 */
import type { BatchOperation } from "@/lib/types";
import { ReadOnlyViolationError } from "@/server/db/read-only-guard";
import { getSession } from "@/server/sessions";
import { HandlerError } from "./errors";

export interface BatchEditReq {
  sessionId: string;
  schema?: string;
  table: string;
  pkColumn: string;
  operations: BatchOperation[];
}

export async function batchEditHandler(body: BatchEditReq): Promise<{ affectedRows: number }> {
  if (!body?.sessionId || !body.table || !body.pkColumn) {
    throw new HandlerError("Missing sessionId, table or pkColumn", 400);
  }
  if (typeof body.pkColumn !== "string" || body.pkColumn.trim() === "") {
    throw new HandlerError("pkColumn must be a non-empty string", 400);
  }
  if (!Array.isArray(body.operations)) {
    throw new HandlerError("operations must be an array", 400);
  }

  const stored = getSession(body.sessionId);
  if (!stored) throw new HandlerError("Session not found", 401);

  if (stored.session.readOnly) {
    throw new ReadOnlyViolationError("UPDATE/INSERT/DELETE (edición de grid)");
  }

  return stored.driver.executeBatch({
    schema: body.schema,
    table: body.table,
    pkColumn: body.pkColumn,
    operations: body.operations,
  });
}
