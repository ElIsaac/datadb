import { promises as fs } from "fs";
import type { AiSettings } from "@/lib/ai-types";
import { DEFAULT_AI_SETTINGS } from "@/lib/ai-types";
// Fase 5 (R2): el directorio de datos lo resuelve el único módulo src/server/data-dir.ts.
import { DATA_DIR, dataPath } from "../data-dir";

const AI_SETTINGS_PATH = dataPath("aiSettings");

/**
 * Fase 25: los ajustes de los proveedores con URL (`openai`, `gateway`) son objetos anidados; un archivo viejo no los
 * tiene y uno parcial puede traer solo algunos campos. Se completan con los defaults campo a campo.
 */
function withDefaults(parsed: Partial<AiSettings>): AiSettings {
  return {
    ...DEFAULT_AI_SETTINGS,
    ...parsed,
    provider: parsed.provider ?? DEFAULT_AI_SETTINGS.provider,
    openai: { ...DEFAULT_AI_SETTINGS.openai, ...(parsed.openai ?? {}) },
    gateway: { ...DEFAULT_AI_SETTINGS.gateway, ...(parsed.gateway ?? {}) },
  };
}

const uniq = (list: string[] | undefined) => Array.from(new Set((list ?? []).map((m) => m.trim()).filter(Boolean)));

export async function loadAiSettings(): Promise<AiSettings> {
  try {
    const raw = await fs.readFile(AI_SETTINGS_PATH, "utf-8");
    if (!raw.trim()) return DEFAULT_AI_SETTINGS;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      return withDefaults(parsed as Partial<AiSettings>);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return DEFAULT_AI_SETTINGS;
    }
    throw err;
  }
  return DEFAULT_AI_SETTINGS;
}

export async function saveAiSettings(patch: Partial<AiSettings>): Promise<AiSettings> {
  const current = await loadAiSettings();
  const updated: AiSettings = withDefaults({ ...current, ...patch });
  // Favoritos únicos y sin vacíos, en cada proveedor. Las URLs sin barra final.
  updated.favoriteModels = uniq(updated.favoriteModels);
  for (const id of ["openai", "gateway"] as const) {
    updated[id] = {
      ...updated[id],
      baseUrl: updated[id].baseUrl.trim().replace(/\/+$/, ""),
      model: updated[id].model.trim(),
      favoriteModels: uniq(updated[id].favoriteModels),
    };
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${AI_SETTINGS_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(updated, null, 2));
  await fs.rename(tmp, AI_SETTINGS_PATH);
  return updated;
}
