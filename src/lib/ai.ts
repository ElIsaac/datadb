/**
 * Cliente de IA del renderer. Fase 3 (T5+T6): solo IPC (decision D1: la via HTTP a /api/ai se borro).
 *
 * El chat en streaming llega como eventos `ai:chunk` (uno por linea del antiguo NDJSON) correlacionados por opId; la
 * firma de `askAiStream` y sus callbacks NO cambian, asi que ai-chat-panel.tsx sigue igual. Detener (abortar la
 * senal) manda `ai:cancel`, que corta la generacion EN OPENROUTER (antes solo se dejaba de leer y el proveedor seguia
 * generando y cobrando).
 */
import { ApiError } from "./api-error";
import { invoke } from "./ipc-client";
import type {
  AiModelsResult,
  AiRequest,
  AiResponse,
  AiSettings,
  AiSettingsWithKeyStatus,
  ChatMessage,
} from "./ai-types";

export * from "./ai-types";
export { ApiError };

/** Tareas de un solo disparo (generar, corregir, explicar, convertir SQL...). Solo devuelve texto: nunca ejecuta (R28). */
export async function askAi(req: AiRequest): Promise<AiResponse> {
  return invoke("ai:ask", req);
}

/** El error que espera ai-chat-panel.tsx al detener (`err.name === "AbortError"`), igual que con fetch. */
function abortError(): DOMException {
  return new DOMException("La respuesta de la IA se detuvo", "AbortError");
}

export async function askAiStream(
  req: AiRequest,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
  onReasoning?: (chunk: string) => void,
  onWarning?: (message: string) => void,
  onUsage?: (usage: { promptTokens: number; completionTokens: number; costUsd?: number }) => void
): Promise<string> {
  if (signal?.aborted) throw abortError();
  const bridge = window.gestordb;
  if (!bridge) throw new ApiError("El puente IPC no esta disponible", 500);

  const opId = crypto.randomUUID();
  let received = "";
  let usageDelivered = false;
  let warningsDelivered = 0;
  const deliverUsage = (rawText: string) => {
    const raw = JSON.parse(rawText) as { prompt_tokens: number; completion_tokens: number; cost?: number };
    usageDelivered = true;
    onUsage?.({ promptTokens: raw.prompt_tokens, completionTokens: raw.completion_tokens, costUsd: raw.cost });
  };
  const off = bridge.on("ai:chunk", (evt) => {
    if (evt.opId !== opId) return; // eventos de otro chat (u otra ventana): no son nuestros
    try {
      if (evt.type === "reasoning") onReasoning?.(evt.text);
      else if (evt.type === "warning") {
        warningsDelivered++;
        onWarning?.(evt.text);
      } else if (evt.type === "usage") deliverUsage(evt.text);
      else {
        received += evt.text;
        onChunk(evt.text);
      }
    } catch (err) {
      // Igual que antes con una linea NDJSON rara: no se tira la respuesta entera, queda rastro en consola.
      console.error("[ai] Trozo de chat invalido", { evt, err });
    }
  });
  const onAbort = () => {
    invoke("ai:cancel", { opId }).catch((err) => console.error("[ai] No se pudo cancelar el chat", err));
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const { text, usage, warnings } = await invoke("ai:chat", { ...req, task: "chat", opId });
    // Electron NO garantiza que los eventos lleguen antes que esta respuesta (medido en T6: a veces el ultimo evento
    // llega despues, cuando ya nos desuscribimos). La respuesta repite lo que no se puede perder; se entrega aqui lo
    // que no llego por evento: el resto del texto, los avisos que falten y el uso.
    if (text.length > received.length && text.startsWith(received)) onChunk(text.slice(received.length));
    for (const w of warnings.slice(warningsDelivered)) onWarning?.(w);
    if (usage && !usageDelivered) deliverUsage(usage);
    return text;
  } catch (err) {
    if (signal?.aborted || (err instanceof ApiError && err.status === 499)) throw abortError();
    throw err;
  } finally {
    off();
    signal?.removeEventListener("abort", onAbort);
  }
}

export async function getAiSettings(): Promise<AiSettingsWithKeyStatus> {
  return invoke("ai:getSettings");
}

export async function saveAiSettings(patch: Partial<AiSettings>): Promise<AiSettingsWithKeyStatus> {
  return invoke("ai:saveSettings", patch);
}

/** Catálogo de modelos del proveedor ACTIVO (fase 25; antes solo OpenRouter). */
export async function listAiModels(): Promise<AiModelsResult> {
  return invoke("ai:models");
}

export async function loadAiChatHistory(connectionId: string): Promise<ChatMessage[]> {
  return invoke("aiChats:list", { connectionId });
}

export async function saveAiChatHistory(connectionId: string, messages: ChatMessage[]): Promise<void> {
  await invoke("aiChats:save", { connectionId, messages });
}

export async function clearAiChatHistory(connectionId: string): Promise<void> {
  await invoke("aiChats:clear", { connectionId });
}

export function isModelAvailable(
  modelId: string,
  models: { id: string }[]
): boolean {
  return models.some((m) => m.id === modelId);
}

export function isDeepSeekModel(modelId: string): boolean {
  return modelId.toLowerCase().startsWith("deepseek/");
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function makeUserChatMessage(content: string): ChatMessage {
  return { role: "user", content, at: nowIso() };
}

export function makeAssistantChatMessage(content: string): ChatMessage {
  return { role: "assistant", content, at: nowIso() };
}
