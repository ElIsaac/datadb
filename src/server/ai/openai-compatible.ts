/**
 * Cliente de chat con el protocolo compatible con OpenAI (`POST /chat/completions`, SSE, `GET /models`). Fase 25 (T3):
 * sale de lo que antes era `openrouter.ts`, parametrizado por proveedor, porque los tres carriles hablan este mismo
 * protocolo:
 *   - OpenRouter (BYOK; añade coste en USD y razonamiento en vivo),
 *   - «Compatible con OpenAI» con URL base (D1: OpenAI, DeepSeek, Groq, Ollama, LM Studio…),
 *   - Gateway de DataDB (D8: keys gestionadas; token de sesión en vez de key del proveedor).
 *
 * Lo que cada proveedor aporta va en `ProviderConfig` (URL, secreto, cabeceras extra, cómo se prueba la key). El
 * parser SSE, el aviso de «agotó los tokens pensando», el NDJSON de cuatro tipos que consume `ai:chat` y la
 * cancelación por `signal` son los mismos de la fase 3 (no cambian de comportamiento).
 *
 * La key: se resuelve en CADA llamada (`keys.ts`): Ajustes (cifrada, la descifra `main`) y, solo en desarrollo, la
 * variable de entorno del proveedor. Nunca se loguea.
 */
import { MISSING_KEY_MESSAGE, type AiModel, type AiModelsResult, type AiProviderId } from "@/lib/ai-types";
import type { SecretName } from "@/shared/secrets";
import { keySource, resolveKey, type KeySource } from "./keys";

export interface CompletionOpts {
  model: string;
  messages: { role: string; content: string }[];
  temperature: number;
  /** Tope de tokens de la respuesta. Si se omite, el proveedor usa el default del modelo. */
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface CompletionResult {
  text: string;
  usage?: { promptTokens: number; completionTokens: number; costUsd?: number };
}

export interface ProviderConfig {
  id: AiProviderId;
  /** Para los mensajes de error («Clave de OpenRouter inválida»). */
  label: string;
  /** URL base (sin barra final); se lee en cada llamada porque el usuario puede cambiarla en Ajustes. */
  baseUrl: () => string;
  secretName: SecretName;
  /** Respaldo de desarrollo (D6); `main` no lo pasa al worker en la app empaquetada. */
  envVar?: string;
  /** Con modelos locales la key no hace falta (Ollama/LM Studio): sin key se llama sin `Authorization`. */
  keyOptional?: () => boolean;
  extraHeaders?: () => Record<string, string>;
  /** Ruta para «Probar» la key sin gastar tokens (OpenRouter: `/key`; el resto: `/models`). */
  testPath: string;
  /** Mapea un elemento de `GET /models` del proveedor. */
  mapModel?: (raw: Record<string, unknown>) => AiModel | null;
}

/** Error con el mensaje ya traducido para el usuario. */
function translateError(label: string, status: number, body?: { error?: { message?: string } }): string {
  const detail = body?.error?.message ? `: ${body.error.message}` : "";
  switch (status) {
    case 401:
      return `Clave de ${label} inválida${detail}`;
    case 402:
      return `Sin crédito suficiente en ${label}${detail}`;
    case 403:
      return `Acceso denegado al modelo${detail}`;
    case 404:
      return `Modelo o ruta no encontrados en ${label}${detail}`;
    case 429:
      return `Límite de peticiones de ${label} alcanzado${detail}`;
    default:
      return `Error de ${label} (${status})${detail}`;
  }
}

const LENGTH_EXHAUSTED = (maxTokens?: number) =>
  `El modelo agotó el límite de tokens de respuesta (${maxTokens ?? "sin límite"}) pensando, sin llegar a escribir el ` +
  `resultado. Sube "Tokens de respuesta" en Ajustes de IA (o usa un modelo sin razonamiento extendido) y vuelve a intentar.`;

export function createOpenAiCompatibleProvider(cfg: ProviderConfig) {
  function url(path: string): string {
    const base = cfg.baseUrl().replace(/\/+$/, "");
    if (!base) throw new Error(`Falta la URL de ${cfg.label}: configúrala en Ajustes de IA.`);
    return `${base}${path}`;
  }

  async function headers(): Promise<Record<string, string>> {
    const { key } = await resolveKey(cfg.secretName, cfg.envVar);
    if (!key && !cfg.keyOptional?.()) throw new Error(MISSING_KEY_MESSAGE);
    return {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(cfg.extraHeaders?.() ?? {}),
    };
  }

  async function fail(res: Response, where: string, model?: string): Promise<never> {
    const body = await res.json().catch(() => ({}) as { error?: { message?: string } });
    // Detalle crudo al log del worker (llega a la consola de main con prefijo): el mensaje traducido del toast no
    // siempre alcanza para diagnosticar. Nunca incluye la key.
    console.error(`[ai] ${cfg.label} respondió error (${where})`, { status: res.status, model, body });
    throw new Error(translateError(cfg.label, res.status, body));
  }

  return {
    id: cfg.id,
    label: cfg.label,

    /** De dónde sale hoy la key (sin descifrarla). */
    keySource(): Promise<KeySource> {
      return keySource(cfg.secretName, cfg.envVar);
    },

    /** ¿Se puede usar sin key? (modelos locales). */
    keyOptional(): boolean {
      return cfg.keyOptional?.() ?? false;
    },

    async complete(opts: CompletionOpts): Promise<CompletionResult> {
      const res = await fetch(url("/chat/completions"), {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify({
          model: opts.model,
          messages: opts.messages,
          temperature: opts.temperature,
          max_tokens: opts.maxTokens,
          stream: false,
        }),
        signal: opts.signal,
      });
      if (!res.ok) await fail(res, "complete", opts.model);

      const body = (await res.json()) as {
        choices: { message: { content: string | null }; finish_reason?: string }[];
        usage?: { prompt_tokens: number; completion_tokens: number; cost?: number };
      };
      const choice = body.choices?.[0];
      const text = choice?.message?.content ?? "";
      const usage = body.usage
        ? {
            promptTokens: body.usage.prompt_tokens,
            completionTokens: body.usage.completion_tokens,
            // Solo OpenRouter manda el coste real en USD; los demás lo dejan undefined y la UI no lo muestra (D9).
            costUsd: body.usage.cost,
          }
        : undefined;

      // Modelos "thinking" pueden gastar TODO maxTokens razonando y devolver content vacío con finish_reason
      // "length": la llamada fue 200 pero el usuario no vería nada. Se convierte en un error explícito.
      if (!text && choice?.finish_reason === "length") {
        console.error("[ai] Respuesta vacía: se agotó maxTokens razonando", { model: opts.model, maxTokens: opts.maxTokens });
        throw new Error(LENGTH_EXHAUSTED(opts.maxTokens));
      }
      return { text, usage };
    },

    /**
     * Streaming: devuelve un ReadableStream NDJSON con eventos `content | reasoning | warning | usage` (lo que reemite
     * `ai:chat` como eventos `ai:chunk`). Razonamiento: `delta.reasoning` (OpenRouter) o `delta.reasoning_content`
     * (DeepSeek directo); si el proveedor no lo manda, simplemente no aparece.
     */
    async streamComplete(opts: CompletionOpts): Promise<ReadableStream<Uint8Array>> {
      const res = await fetch(url("/chat/completions"), {
        method: "POST",
        headers: await headers(),
        body: JSON.stringify({
          model: opts.model,
          messages: opts.messages,
          temperature: opts.temperature,
          max_tokens: opts.maxTokens,
          stream: true,
          // Sin esto el último trozo no trae `usage` en streaming (OpenRouter, OpenAI). Los que no lo entienden lo
          // ignoran.
          stream_options: { include_usage: true },
        }),
        signal: opts.signal,
      });
      if (!res.ok) await fail(res, "stream", opts.model);
      const source = res.body;
      if (!source) throw new Error(`${cfg.label} no devolvió un stream de respuesta`);

      const reader = source.getReader();
      const label = cfg.label;
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          const decoder = new TextDecoder();
          const encoder = new TextEncoder();
          // Los trozos de red no respetan las líneas SSE: se arrastra el remanente entre lecturas (antes se perdían
          // líneas partidas en silencio).
          let lineBuffer = "";
          let sawContent = false;
          let sawReasoning = false;
          const emit = (type: "content" | "reasoning" | "warning" | "usage", text: string) =>
            controller.enqueue(encoder.encode(JSON.stringify({ type, text }) + "\n"));
          const processLine = (rawLine: string) => {
            const trimmed = rawLine.trim();
            if (!trimmed || trimmed.startsWith(":") || trimmed === "data: [DONE]" || !trimmed.startsWith("data: ")) return;
            const payload = trimmed.slice("data: ".length);
            try {
              const parsed = JSON.parse(payload) as {
                choices?: { delta?: { content?: string; reasoning?: string; reasoning_content?: string }; finish_reason?: string }[];
                usage?: { prompt_tokens: number; completion_tokens: number; cost?: number };
              };
              const choice = parsed.choices?.[0];
              const reasoning = choice?.delta?.reasoning ?? choice?.delta?.reasoning_content;
              if (reasoning) {
                sawReasoning = true;
                emit("reasoning", reasoning);
              }
              if (choice?.delta?.content) {
                sawContent = true;
                emit("content", choice.delta.content);
              }
              if (choice?.finish_reason === "length" && sawReasoning && !sawContent) {
                console.error("[ai] Stream vacío: se agotó maxTokens razonando", { model: opts.model, maxTokens: opts.maxTokens });
                emit("warning", LENGTH_EXHAUSTED(opts.maxTokens));
              }
              if (parsed.usage) emit("usage", JSON.stringify(parsed.usage));
            } catch (err) {
              console.error(`[ai] Línea SSE malformada de ${label}, se ignora`, {
                payload,
                err: err instanceof Error ? err.message : String(err),
              });
            }
          };
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                if (lineBuffer.trim()) processLine(lineBuffer);
                controller.close();
                return;
              }
              lineBuffer += decoder.decode(value, { stream: true });
              const lines = lineBuffer.split("\n");
              lineBuffer = lines.pop() ?? "";
              for (const line of lines) processLine(line);
            }
          } catch (err) {
            console.error(`[ai] Error leyendo el stream de ${label}`, {
              model: opts.model,
              err: err instanceof Error ? err.message : String(err),
            });
            controller.error(err);
          }
        },
        cancel() {
          reader.cancel().catch((err) => console.error("[ai] No se pudo cancelar el lector del stream", err));
        },
      });
    },

    /**
     * Catálogo de modelos. No falla: sin red o con error devuelve `{ models: [], stale: true }` (la UI lo dice). Si el
     * proveedor exige key para listar (OpenAI) y no hay, igual: lista vacía y `stale`.
     */
    async listModels(): Promise<AiModelsResult> {
      const fetchedAt = new Date().toISOString();
      try {
        const res = await fetch(url("/models"), {
          headers: await headers().catch(() => ({ "Content-Type": "application/json" })),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          console.error(`[ai] ${cfg.label} no listó modelos`, { status: res.status });
          return { models: [], fetchedAt, stale: true };
        }
        const body = (await res.json()) as { data?: Record<string, unknown>[] };
        const map = cfg.mapModel ?? ((m: Record<string, unknown>) => ({ id: String(m.id), name: String(m.name ?? m.id) }));
        const models = (body.data ?? []).map(map).filter((m): m is AiModel => Boolean(m?.id));
        return { models, fetchedAt, stale: false };
      } catch (err) {
        console.error(`[ai] ${cfg.label}: no se pudo obtener el catálogo de modelos`, err instanceof Error ? err.message : err);
        return { models: [], fetchedAt, stale: true };
      }
    },

    /** «Probar» de Ajustes: valida la key sin gastar tokens. Nunca lanza. */
    async testKey(): Promise<{ ok: boolean; message: string }> {
      let res: Response;
      try {
        res = await fetch(url(cfg.testPath), { headers: await headers(), signal: AbortSignal.timeout(10_000) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === MISSING_KEY_MESSAGE || msg.startsWith("Falta la URL")) return { ok: false, message: msg };
        return { ok: false, message: `No se pudo contactar a ${cfg.label}: ${msg}` };
      }
      if (res.ok) return { ok: true, message: `Conexión con ${cfg.label} correcta` };
      const body = await res.json().catch(() => ({}) as { error?: { message?: string } });
      return { ok: false, message: translateError(cfg.label, res.status, body) };
    },
  };
}

export type AiProvider = ReturnType<typeof createOpenAiCompatibleProvider>;
