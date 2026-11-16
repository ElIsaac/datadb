/**
 * Handlers de IA. Fase 3, T5 (sin streaming: tareas, ajustes, modelos e historial de chats) y T6 (chat en streaming).
 * Antes: src/app/api/ai/{route,settings/route,models/route,chats/route}.ts.
 *
 * Seguridad (R8/R28):
 *  - La API key NUNCA sale del worker: los ajustes devuelven solo `hasApiKey`, como la ruta.
 *  - Estos handlers solo GENERAN texto/SQL. Ejecutar el SQL que proponga la IA sigue siendo decision explicita del
 *    usuario en la UI (insertar en el editor, nunca ejecutar): aqui no hay ningun camino hacia `executeQuery`.
 *
 * Key (decision D2 de la fase 3): en Electron no hay `.env.local`; la key sale de la variable de entorno con la que
 * se arranco la app (el worker hereda el entorno de main). La key cifrada en Ajustes es la fase 25 (R8), adelantada
 * a justo despues de esta.
 */
import { dialectoSql } from "@/shared/connection-net";
import { activeModelOf } from "@/lib/ai-types";
import type {
  AiModelsResult,
  AiRequest,
  AiResponse,
  AiSettings,
  AiSettingsWithKeyStatus,
  ChatMessage,
} from "@/lib/ai-types";
import type { EventMap } from "@/shared/contract";
import { getSession, getSessionSchema } from "@/server/sessions";
import { loadAiSettings, saveAiSettings } from "@/server/ai/settings";
import { buildSchemaContext } from "@/server/ai/schema-context";
import { buildMessages } from "@/server/ai/prompts";
import { getProvider } from "@/server/ai/providers";
import { clearAiChatHistory, loadAiChatHistory, saveAiChatHistory } from "@/server/ai/chats";
import { HandlerError } from "./errors";

/** Lo que el router le pasa a los handlers que emiten eventos (hoy solo el chat). */
export interface HandlerContext {
  emit: <E extends keyof EventMap>(name: E, payload: EventMap[E]) => void;
}

function extractSqlBlock(text: string): string | undefined {
  const match = /```(?:sql)?\s*([\s\S]*?)```/i.exec(text);
  return match ? match[1].trim() : undefined;
}

/**
 * Lo comun a todas las tareas: validacion, ajustes, contexto de esquema y mensajes. Mismo orden y mismos mensajes
 * que la ruta. OJO: la ruta devolvia los fallos inesperados como `err.message` (SIN el prefijo "Error: " que llevan
 * las demas rutas); se conserva relanzando como HandlerError con 500.
 */
async function prepare(body: AiRequest) {
  if (!body?.sessionId || !body.task) throw new HandlerError("Missing sessionId or task", 400);
  const stored = getSession(body.sessionId);
  if (!stored) throw new HandlerError("Session not found", 401);

  const settings = await loadAiSettings();
  const schema = await getSessionSchema(body.sessionId);
  const aiDialect = stored.session.type === "mongodb" ? "mongodb" : dialectoSql(stored.session.type);
  const schemaContext = buildSchemaContext(schema, {
    budgetChars: settings.schemaBudgetChars,
    focusTables: body.focusTables ?? [],
    dialect: aiDialect,
  });
  const messages = buildMessages(body, schemaContext, aiDialect, stored.session.readOnly);
  // Fase 25 (R24): proveedor activo y SU modelo.
  return { settings, messages, provider: getProvider(settings), model: activeModelOf(settings).model };
}

function asRouteError(err: unknown): never {
  if (err instanceof HandlerError) throw err;
  throw new HandlerError(err instanceof Error ? err.message : String(err), 500);
}

/** Antes: POST /api/ai con cualquier `task` que no sea "chat". */
export async function askAiHandler(body: AiRequest): Promise<AiResponse> {
  try {
    if (body?.task === "chat") throw new HandlerError("Use ai:chat para el chat", 400);
    const { settings, messages, provider, model } = await prepare(body);
    const result = await provider.complete({
      model,
      messages,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
    });
    return { text: result.text, sql: extractSqlBlock(result.text), model, usage: result.usage };
  } catch (err) {
    asRouteError(err);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Chat en streaming (T6)
// ---------------------------------------------------------------------------------------------------------------

/** Chats en curso: opId -> controlador para abortar el fetch a OpenRouter. */
const chatOps = new Map<string, AbortController>();

/** Mensaje con el que termina un chat cancelado (el renderer lo traduce a AbortError, ver lib/ai.ts). */
export const AI_CANCELLED_MESSAGE = "AI request cancelled";

/**
 * Antes: POST /api/ai con `task: "chat"`, que devolvia un ReadableStream NDJSON. Ahora (decision del PLAN: eventos,
 * como el progreso de queries): cada linea del NDJSON sale como evento `ai:chunk {opId, type, text}` y la respuesta
 * del invoke llega al final con el texto completo, el uso y los avisos. Eso NO es redundancia gratuita: medido en la
 * verificacion de T6, Electron a veces entrega el ultimo evento DESPUES de la respuesta del invoke, y el renderer ya
 * se ha desuscrito; sin esto se perdia el uso/coste de la respuesta.
 *
 * Se reutiliza `streamComplete` tal cual (el parser SSE con su buffer de lineas y sus avisos de «agoto los tokens
 * pensando»): aqui solo se lee su salida NDJSON y se reemite.
 *
 * Cancelar (`ai:cancel`) aborta el `fetch` a OpenRouter: la generacion se corta EN EL PROVEEDOR. Antes, «Detener»
 * solo dejaba de leer en el navegador y OpenRouter seguia generando (y cobrando) hasta el final.
 */
export async function chatAiHandler(
  body: AiRequest & { opId: string },
  ctx?: HandlerContext
): Promise<{ text: string; usage?: string; warnings: string[] }> {
  if (!body?.opId) throw new HandlerError("Missing opId", 400);
  const controller = new AbortController();
  chatOps.set(body.opId, controller);
  try {
    const { settings, messages, provider, model } = await prepare({ ...body, task: "chat" });
    const stream = await provider.streamComplete({
      model,
      messages,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      signal: controller.signal,
    });

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let usage: string | undefined;
    const warnings: string[] = [];
    const handleLine = (line: string) => {
      if (!line.trim()) return;
      const evt = JSON.parse(line) as { type: EventMap["ai:chunk"]["type"]; text: string };
      if (evt.type === "content") full += evt.text;
      else if (evt.type === "usage") usage = evt.text;
      else if (evt.type === "warning") warnings.push(evt.text);
      ctx?.emit("ai:chunk", { opId: body.opId, type: evt.type, text: evt.text });
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(handleLine);
    }
    handleLine(buffer);
    return { text: full, usage, warnings };
  } catch (err) {
    if (controller.signal.aborted) throw new HandlerError(AI_CANCELLED_MESSAGE, 499);
    asRouteError(err);
  } finally {
    chatOps.delete(body.opId);
  }
}

/** Corta un chat en curso. Un opId que ya termino es un no-op (como query:cancel). */
export async function cancelAiHandler({ opId }: { opId: string }): Promise<{ ok: true }> {
  if (!opId) throw new HandlerError("Missing opId", 400);
  chatOps.get(opId)?.abort();
  return { ok: true };
}

/** Para tests: cuantos chats hay en curso. */
export function runningChatCount(): number {
  return chatOps.size;
}

// ---------------------------------------------------------------------------------------------------------------
// Ajustes, modelos e historial de chats (T5)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Estado de la key DEL PROVEEDOR ACTIVO (fase 25): si hay, de dónde sale y si hace falta. Nunca el valor.
 * `hasApiKey` es true también cuando el proveedor no la necesita (modelos locales): significa «se puede usar».
 */
async function withKeyStatus(settings: AiSettings): Promise<AiSettingsWithKeyStatus> {
  const provider = getProvider(settings);
  const source = await provider.keySource();
  const keyOptional = provider.keyOptional();
  return { ...settings, hasApiKey: source !== null || keyOptional, keySource: source, keyOptional };
}

/** Antes: GET /api/ai/settings. Solo el estado de la key: la key no cruza al renderer. */
export async function getAiSettingsHandler(): Promise<AiSettingsWithKeyStatus> {
  return withKeyStatus(await loadAiSettings());
}

/** Antes: PUT /api/ai/settings. */
export async function saveAiSettingsHandler(patch: Partial<AiSettings>): Promise<AiSettingsWithKeyStatus> {
  return withKeyStatus(await saveAiSettings(patch ?? {}));
}

/** Fase 25: «Probar» la key del proveedor activo (sin gastar tokens). Nunca falla: devuelve el resultado. */
export async function testAiKeyHandler(): Promise<{ ok: boolean; message: string }> {
  return getProvider(await loadAiSettings()).testKey();
}

/** Antes: GET /api/ai/models. Catálogo del proveedor activo. No falla: sin red devuelve `{ models: [], stale: true }`. */
export async function listAiModelsHandler(): Promise<AiModelsResult> {
  return getProvider(await loadAiSettings()).listModels();
}

function requireConnectionId(connectionId: string | undefined): string {
  if (!connectionId) throw new HandlerError("Missing connectionId", 400);
  return connectionId;
}

/** Antes: GET /api/ai/chats. */
export async function listAiChatsHandler({ connectionId }: { connectionId: string }): Promise<ChatMessage[]> {
  return loadAiChatHistory(requireConnectionId(connectionId));
}

/** Antes: PUT /api/ai/chats. */
export async function saveAiChatsHandler({
  connectionId,
  messages,
}: {
  connectionId: string;
  messages: ChatMessage[];
}): Promise<ChatMessage[]> {
  return saveAiChatHistory(requireConnectionId(connectionId), messages ?? []);
}

/** Antes: DELETE /api/ai/chats. */
export async function clearAiChatsHandler({ connectionId }: { connectionId: string }): Promise<{ ok: true }> {
  await clearAiChatHistory(requireConnectionId(connectionId));
  return { ok: true };
}
