export type AiTask =
  | "chat"          // chat libre consciente del esquema
  | "text-to-sql"   // NL → SQL
  | "fix-sql"       // SQL + error del driver → SQL corregido
  | "explain-sql"   // SQL → explicación en lenguaje natural
  | "convert-sql"   // SQL en dialecto A → dialecto B
  | "optimize-sql"  // SQL + plan EXPLAIN → sugerencias
  | "summarize-rows"    // columnas + filas de un result set → resumen en NL
  | "generate-aggregate"; // NL + esquema/columnas → SQL de agregación

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Marca de tiempo ISO para renderizar el hilo. */
  at: string;
  /**
   * Costo real en USD reportado por OpenRouter para ESTA respuesta
   * (solo aplica a mensajes del asistente). Se persiste junto con el
   * mensaje para poder sumar el gasto total del chat incluso tras
   * recargar la página, sin importar si cambiaste de modelo entre turnos.
   */
  costUsd?: number;
}

export interface AiRequest {
  sessionId: string;
  task: AiTask;
  /** Instrucción del usuario en lenguaje natural (chat, text-to-sql). */
  prompt?: string;
  /** SQL de entrada (fix, explain, convert, optimize). */
  sql?: string;
  /** Mensaje de error crudo del driver, para `fix-sql`. */
  errorMessage?: string;
  /** Plan de ejecución serializado, para `optimize-sql`. */
  explainPlan?: string;
  /** Dialecto destino, para `convert-sql`. */
  targetDialect?: "postgres" | "mysql" | "sqlserver";
  /** Tablas a priorizar en el contexto de esquema. */
  focusTables?: { schema?: string; table: string }[];
  /** Historial previo, solo para `chat`. */
  history?: ChatMessage[];
  /**
   * Filas reales del result set, solo para `summarize-rows`. Requiere
   * confirmación explícita del usuario antes de enviarse (nunca por default).
   */
  rows?: Record<string, unknown>[];
  /** Nombres de columnas del result set, para `summarize-rows`/`generate-aggregate`. */
  columns?: string[];
  /** Nombre de tabla de referencia para el SQL generado en `generate-aggregate`. */
  tableName?: string;
}

export interface AiResponse {
  /** Texto libre de la respuesta (markdown para chat, explicación, optimize). */
  text: string;
  /** SQL extraído del primer bloque ```sql, si la tarea lo produce. */
  sql?: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number; costUsd?: number };
}

/**
 * Fase 25 (R24): proveedores de IA. Los tres hablan el protocolo de chat compatible con OpenAI
 * (`src/server/ai/openai-compatible.ts`):
 *  - "openrouter": BYOK de OpenRouter (cientos de modelos, coste real en USD, razonamiento en vivo).
 *  - "openai": BYOK de cualquier API compatible con OpenAI con URL base (D1): OpenAI, DeepSeek, Groq, o modelos
 *    locales (Ollama, LM Studio) que no necesitan key.
 *  - "gateway": carril de keys gestionadas (D8): un servidor de DataDB con token de sesión; la key maestra del
 *    proveedor nunca está en la app. Aún sin backend real: se configura a mano (URL + token).
 */
export type AiProviderId = "openrouter" | "openai" | "gateway";
export const AI_PROVIDER_IDS: AiProviderId[] = ["openrouter", "openai", "gateway"];

export const AI_PROVIDER_LABELS: Record<AiProviderId, string> = {
  openrouter: "OpenRouter",
  openai: "Compatible con OpenAI",
  gateway: "Gateway DataDB",
};

/** Ajustes propios de los proveedores con URL configurable. */
export interface AiProviderSettings {
  /** URL base de la API, p. ej. https://api.openai.com/v1 o http://localhost:11434/v1 (Ollama). */
  baseUrl: string;
  model: string;
  favoriteModels: string[];
}

/** URLs base conocidas para el proveedor compatible con OpenAI (atajos de Ajustes). */
export const OPENAI_COMPATIBLE_PRESETS: { label: string; baseUrl: string; model: string }[] = [
  { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  { label: "Ollama (local)", baseUrl: "http://localhost:11434/v1", model: "qwen2.5-coder" },
  { label: "LM Studio (local)", baseUrl: "http://localhost:1234/v1", model: "local-model" },
];

/** ¿La URL apunta a esta máquina? Entonces la key es opcional (modelos locales). */
export function isLocalBaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

export interface AiSettings {
  /** Fase 25: proveedor activo. Archivos de ajustes anteriores no lo tienen → "openrouter". */
  provider: AiProviderId;
  /** Modelo de OpenRouter (el campo de siempre; los otros proveedores tienen el suyo abajo). */
  model: string;
  /** Presupuesto de caracteres del contexto de esquema. */
  schemaBudgetChars: number;
  temperature: number;
  /** Tope de tokens de la respuesta (completion). Más alto = respuestas más largas/completas. */
  maxTokens: number;
  /** Si false, toda la UI de IA queda oculta. */
  enabled: boolean;
  /** Modelos favoritos de OpenRouter (para el buscador rápido). */
  favoriteModels: string[];
  /** Fase 25: proveedor compatible con OpenAI (D1). */
  openai: AiProviderSettings;
  /** Fase 25: gateway de DataDB (D8). */
  gateway: AiProviderSettings;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  /** DeepSeek es el default porque es el proveedor más barato y competitivo para SQL. */
  model: "deepseek/deepseek-chat-v3-0324",
  schemaBudgetChars: 12000,
  temperature: 0.1,
  /** 4096 es un buen balance: suficiente para respuestas de chat detalladas
   * (explicaciones largas, varios bloques SQL, tablas) sin disparar el coste. */
  maxTokens: 4096,
  enabled: true,
  /** Modelos favoritos del usuario para autocompletar rápido. */
  favoriteModels: [
    "deepseek/deepseek-chat-v3-0324",
    "deepseek/deepseek-coder",
  ],
  provider: "openrouter",
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", favoriteModels: [] },
  // Sin backend real todavía: la URL la pone quien tenga un gateway (vacía = no configurado).
  gateway: { baseUrl: "", model: "", favoriteModels: [] },
};

/** Modelo y favoritos del proveedor activo (OpenRouter guarda los suyos en los campos de siempre). */
export function activeModelOf(s: AiSettings): { model: string; favoriteModels: string[] } {
  if (s.provider === "openrouter" || !s.provider) return { model: s.model, favoriteModels: s.favoriteModels };
  const p = s[s.provider];
  return { model: p.model, favoriteModels: p.favoriteModels };
}

/** Parche de ajustes que cambia el modelo y/o los favoritos DEL PROVEEDOR ACTIVO. */
export function activeModelPatch(
  s: AiSettings,
  change: { model?: string; favoriteModels?: string[] }
): Partial<AiSettings> {
  if (s.provider === "openrouter" || !s.provider) return { ...change };
  return { [s.provider]: { ...s[s.provider], ...change } } as Partial<AiSettings>;
}

export interface OpenRouterModelPricing {
  prompt: number;
  completion: number;
}

/**
 * Modelo del catálogo de un proveedor. Fase 25: contexto y precio son opcionales porque solo OpenRouter los publica
 * (la API de OpenAI devuelve solo el id); la UI muestra «—» cuando faltan, nunca un 0 inventado (D9).
 */
export interface AiModel {
  id: string;
  name: string;
  context_length?: number;
  pricing?: OpenRouterModelPricing;
}
/** Nombre histórico (fase 3). */
export type OpenRouterModel = AiModel;

export interface AiModelsResult {
  models: AiModel[];
  /** Timestamp ISO de la última vez que se contactó al proveedor. */
  fetchedAt: string;
  /** true si falló la red (lista puede ser cacheada vacía). */
  stale: boolean;
}

export interface AiSettingsWithKeyStatus extends AiSettings {
  /** Fase 25: el proveedor activo puede usarse sin key (URL local). */
  keyOptional: boolean;
  /**
   * Fase 25: de dónde sale la key del proveedor activo: "settings" (guardada cifrada en Ajustes), "env" (variable de
   * entorno, solo en desarrollo) o null. Nunca el valor.
   */
  keySource: "settings" | "env" | null;
  hasApiKey: boolean;
}

/**
 * Mensaje que ve el usuario cuando el proveedor activo no tiene key. Lo usan el worker y la UI.
 * Historia: hasta la fase 3 mandaba a `.env.local` (falso en escritorio); en la fase 3 explicaba la variable de
 * entorno; desde la fase 25 (R8) la key se escribe en Ajustes y se guarda cifrada.
 */
export const MISSING_KEY_MESSAGE =
  "No hay API key configurada. Escríbela en Ajustes de IA: se guarda cifrada en el Llavero de macOS.";
