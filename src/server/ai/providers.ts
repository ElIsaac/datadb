/**
 * Los tres proveedores de IA y cuál está activo (fase 25, T3/T4; R24). Ver `openai-compatible.ts` para el protocolo y
 * `ai-types.ts` (`AiProviderId`) para qué es cada uno.
 *
 * Las URLs base de "openai" y "gateway" vienen de los ajustes del usuario; se leen al llamar (`baseUrl` es una función)
 * para que cambiarlas en Ajustes surta efecto en la siguiente petición. `OPENROUTER_BASE_URL` existe solo para pruebas
 * (las sondas apuntan OpenRouter a un servidor simulado).
 *
 * Seguridad: cada proveedor usa SU secreto (`ai.openrouter`, `ai.openai`, `ai.gateway`). Cambiar la URL del proveedor
 * compatible con OpenAI nunca manda la key de OpenRouter a otro sitio.
 */
import {
  AI_PROVIDER_LABELS,
  DEFAULT_AI_SETTINGS,
  isLocalBaseUrl,
  type AiModel,
  type AiProviderId,
  type AiSettings,
} from "@/lib/ai-types";
import { createOpenAiCompatibleProvider, type AiProvider } from "./openai-compatible";

/** Ajustes vigentes para los proveedores con URL; los fija el handler antes de cada uso (ver `getProvider`). */
let current: AiSettings = DEFAULT_AI_SETTINGS;

/** OpenRouter publica nombre, contexto y precio; solo modelos que producen texto. */
function mapOpenRouterModel(m: Record<string, unknown>): AiModel | null {
  const arch = m.architecture as { modality?: string } | undefined;
  const modality = arch?.modality ?? "";
  if (modality && !(modality.split("->")[1] ?? "").includes("text")) return null;
  return {
    id: String(m.id),
    name: String(m.name ?? m.id),
    context_length: typeof m.context_length === "number" ? m.context_length : undefined,
    pricing: m.pricing as AiModel["pricing"],
  };
}

const providers: Record<AiProviderId, AiProvider> = {
  openrouter: createOpenAiCompatibleProvider({
    id: "openrouter",
    label: AI_PROVIDER_LABELS.openrouter,
    baseUrl: () => process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    secretName: "ai.openrouter",
    envVar: "OPENROUTER_API_KEY",
    // Atribución de app en OpenRouter. `HTTP-Referer` solo si se configura (antes iba fijo a http://localhost:3000, el
    // origen del servidor de Next, que en escritorio no significa nada).
    extraHeaders: () => ({
      "X-Title": "DataDB",
      ...(process.env.OPENROUTER_HTTP_REFERER ? { "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER } : {}),
    }),
    // `GET /key` valida la key sin gastar tokens.
    testPath: "/key",
    mapModel: mapOpenRouterModel,
  }),
  openai: createOpenAiCompatibleProvider({
    id: "openai",
    label: AI_PROVIDER_LABELS.openai,
    baseUrl: () => current.openai.baseUrl,
    secretName: "ai.openai",
    envVar: "OPENAI_API_KEY",
    keyOptional: () => isLocalBaseUrl(current.openai.baseUrl),
    testPath: "/models",
  }),
  gateway: createOpenAiCompatibleProvider({
    id: "gateway",
    label: AI_PROVIDER_LABELS.gateway,
    baseUrl: () => current.gateway.baseUrl,
    // El secreto es un TOKEN DE SESIÓN emitido por el gateway, no una key de proveedor (research §3.2).
    secretName: "ai.gateway",
    extraHeaders: () => ({ "X-DataDB-Client": "desktop" }),
    testPath: "/models",
  }),
};

/** El proveedor activo según los ajustes (y los fija como vigentes para las URLs). */
export function getProvider(settings: AiSettings): AiProvider {
  current = settings;
  return providers[settings.provider] ?? providers.openrouter;
}
