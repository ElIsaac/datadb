/**
 * Fase 3: los handlers migrados de las rutas conservan EXACTAMENTE los mensajes y status de validacion que
 * daban las rutas (`error("…", 400|401)`). Se prueban sin base de datos: todas estas ramas fallan antes de
 * tocar un driver. Lo que si toca la base se verifica en Electron contra Postgres/MySQL (ver el PLAN de la fase).
 */
// Fase 5 (R2): fija DATADB_DATA_DIR a un temporal antes de cargar src/server/**. Debe ser el primer import.
import "../test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { errorToPayload } from "./errors";
import { beginTxHandler, commitTxHandler, rollbackTxHandler, txStatusHandler } from "./tx";
import { ddlHandler, explainHandler } from "./inspect";
import { saveProfileHandler, testProfileHandler, updateProfileHandler } from "./profiles";
import { disconnectHandler, switchDatabaseHandler } from "./session";
import { batchEditHandler } from "./grid";
import { saveSavedQueryHandler, updateSavedQueryHandler } from "./saved-queries";
import { cancelQueryHandler, clearHistoryHandler, executeQueryHandler, runningOperationCount } from "./query";
import type { ConnectionProfileInput } from "@/lib/types";
import {
  askAiHandler,
  cancelAiHandler,
  chatAiHandler,
  clearAiChatsHandler,
  listAiChatsHandler,
  runningChatCount,
  saveAiChatsHandler,
} from "./ai";
import { MISSING_KEY_MESSAGE, type AiRequest } from "@/lib/ai-types";

/** Ejecuta un handler y devuelve el payload de error que veria el renderer (o null si no fallo). */
async function failure(fn: () => Promise<unknown>) {
  try {
    await fn();
    return null;
  } catch (err) {
    return errorToPayload(err);
  }
}

const MISSING = { message: "Missing sessionId", status: 400 };
const NOT_FOUND = { message: "Session not found", status: 401 };

test("tx:*: sin sessionId → 400; tx:status con sesión inexistente → 401 (como las rutas)", async () => {
  for (const h of [beginTxHandler, commitTxHandler, rollbackTxHandler, txStatusHandler]) {
    assert.deepEqual(await failure(() => h({ sessionId: "" })), MISSING, h.name);
  }
  assert.deepEqual(await failure(() => txStatusHandler({ sessionId: "nope" })), NOT_FOUND);
});

test("schema:ddl: validaciones en el orden de la ruta", async () => {
  assert.deepEqual(await failure(() => ddlHandler({ sessionId: "", schema: "s", name: "t" })), MISSING);
  assert.deepEqual(await failure(() => ddlHandler({ sessionId: "x", schema: "", name: "t" })), {
    message: "Missing schema or name",
    status: 400,
  });
  assert.deepEqual(await failure(() => ddlHandler({ sessionId: "nope", schema: "s", name: "t" })), NOT_FOUND);
});

test("query:explain: validaciones y sesión inexistente", async () => {
  assert.deepEqual(await failure(() => explainHandler({ sessionId: "x", sql: "" })), {
    message: "Missing sessionId or sql",
    status: 400,
  });
  assert.deepEqual(await failure(() => explainHandler({ sessionId: "nope", sql: "select 1" })), NOT_FOUND);
});

// --- Fase 3, T2+T3 ------------------------------------------------------------------------------------

const FIELDS = { message: "Missing required fields", status: 400 };
const incompleto = { type: "postgres", host: "", user: "u", name: "n" } as unknown as ConnectionProfileInput;

test("perfiles: campos obligatorios → 400; editar convierte cualquier fallo en 400 (como la ruta)", async () => {
  assert.deepEqual(await failure(() => saveProfileHandler(incompleto)), FIELDS);
  assert.deepEqual(await failure(() => testProfileHandler(incompleto)), FIELDS);
  assert.deepEqual(await failure(() => updateProfileHandler({ id: "x", input: incompleto })), FIELDS);
});

test("sesión: desconectar sin id → 400; cambiar de base sin datos → 400", async () => {
  assert.deepEqual(await failure(() => disconnectHandler({ sessionId: "" })), MISSING);
  assert.deepEqual(await failure(() => disconnectHandler({ sessionId: "no-existe" })), null, "cerrar una sesión inexistente no es error");
  assert.deepEqual(await failure(() => switchDatabaseHandler({ sessionId: "x", database: "" })), {
    message: "Missing sessionId or database",
    status: 400,
  });
});

test("grid:batchEdit: validaciones en el orden de la ruta", async () => {
  const base = { sessionId: "nope", table: "t", pkColumn: "id", operations: [] };
  assert.deepEqual(await failure(() => batchEditHandler({ ...base, table: "" })), {
    message: "Missing sessionId, table or pkColumn",
    status: 400,
  });
  assert.deepEqual(await failure(() => batchEditHandler({ ...base, pkColumn: "  " })), {
    message: "pkColumn must be a non-empty string",
    status: 400,
  });
  assert.deepEqual(
    await failure(() => batchEditHandler({ ...base, operations: "x" as unknown as [] })),
    { message: "operations must be an array", status: 400 }
  );
  assert.deepEqual(await failure(() => batchEditHandler(base)), NOT_FOUND);
});

test("consultas guardadas e historial", async () => {
  assert.deepEqual(await failure(() => saveSavedQueryHandler({ name: "", sql: "x" } as never)), FIELDS);
  assert.deepEqual(await failure(() => updateSavedQueryHandler({ id: "x", input: { sql: "" } })), {
    message: "SQL cannot be empty",
    status: 400,
  });
  assert.deepEqual(await failure(() => clearHistoryHandler({ sessionId: "" })), MISSING);
});

// --- Fase 3, T4 ---------------------------------------------------------------------------------------
test("query:cancel por opId: una operación que ya no está en curso es un no-op con ok", async () => {
  assert.deepEqual(await cancelQueryHandler({ opId: "ya-termino" }), { ok: true });
  assert.equal(runningOperationCount(), 0);
  // sin opId ni sessionId: el error de siempre
  assert.deepEqual(await failure(() => cancelQueryHandler({})), MISSING);
  // una query que falla en la validación no deja la operación registrada
  await failure(() => executeQueryHandler({ sessionId: "nope", sql: "select 1", opId: "op-1" }));
  assert.equal(runningOperationCount(), 0);
});

// --- Fase 3, T5+T6: IA --------------------------------------------------------------------------------
test("ai:ask: validaciones como la ruta; el chat no entra por aquí", async () => {
  assert.deepEqual(await failure(() => askAiHandler({ sessionId: "", task: "text-to-sql" } as AiRequest)), {
    message: "Missing sessionId or task",
    status: 400,
  });
  assert.deepEqual(await failure(() => askAiHandler({ sessionId: "nope", task: "text-to-sql" } as AiRequest)), NOT_FOUND);
  assert.equal((await failure(() => askAiHandler({ sessionId: "x", task: "chat" } as AiRequest)))?.status, 400);
});

test("ai:chat: exige opId; una sesión inexistente no deja el chat registrado; cancelar uno terminado es no-op", async () => {
  assert.deepEqual(await failure(() => chatAiHandler({ sessionId: "x", task: "chat" } as AiRequest & { opId: string })), {
    message: "Missing opId",
    status: 400,
  });
  assert.deepEqual(
    await failure(() => chatAiHandler({ sessionId: "nope", task: "chat", opId: "c1" } as AiRequest & { opId: string })),
    NOT_FOUND
  );
  assert.equal(runningChatCount(), 0);
  assert.deepEqual(await cancelAiHandler({ opId: "c1" }), { ok: true });
});

test("historial de chats: sin connectionId → 400", async () => {
  const missing = { message: "Missing connectionId", status: 400 };
  assert.deepEqual(await failure(() => listAiChatsHandler({ connectionId: "" })), missing);
  assert.deepEqual(await failure(() => saveAiChatsHandler({ connectionId: "", messages: [] })), missing);
  assert.deepEqual(await failure(() => clearAiChatsHandler({ connectionId: "" })), missing);
});

test("el mensaje de falta de key manda a Ajustes, no a .env.local (fase 3 D2 → fase 25 R8)", () => {
  assert.doesNotMatch(MISSING_KEY_MESSAGE, /\.env\.local/);
  assert.match(MISSING_KEY_MESSAGE, /Ajustes de IA/);
});
