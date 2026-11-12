import { promises as fs } from "fs";
import type { SavedQuery, SavedQueryInput } from "@/lib/types";
// R96: la regla de ligado es pura (con tests) y vive en lib; aquí solo se lee y se escribe.
import { ligarAPerfiles } from "@/lib/consultas-guardadas";
// Fase 5 (R2): el directorio de datos lo resuelve el único módulo src/server/data-dir.ts.
import { DATA_DIR, dataPath } from "./data-dir";

const SAVED_QUERIES_PATH = dataPath("savedQueries");

function nowIso(): string {
  return new Date().toISOString();
}

export async function loadSavedQueries(connectionId?: string): Promise<SavedQuery[]> {
  try {
    const raw = await fs.readFile(SAVED_QUERIES_PATH, "utf-8");
    if (!raw.trim()) return [];
    const parsed = JSON.parse(raw) as unknown;
    const all: SavedQuery[] = Array.isArray(parsed)
      ? parsed.filter(
          (q): q is SavedQuery =>
            q && typeof q === "object" && "id" in q && "name" in q && "sql" in q
        )
      : [];
    if (connectionId) {
      return all.filter((q) => q.connectionId === connectionId);
    }
    return all;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function migrarConsultasAPerfiles(
  perfiles: ReadonlyArray<{ id: string; name: string }>
): Promise<SavedQuery[]> {
  const todas = await loadSavedQueries();
  const { consultas, cambiadas } = ligarAPerfiles(todas, perfiles);
  if (cambiadas > 0) await saveSavedQueries(consultas);
  return consultas;
}

export async function saveSavedQueries(queries: SavedQuery[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${SAVED_QUERIES_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(queries, null, 2));
  await fs.rename(tmp, SAVED_QUERIES_PATH);
}

export async function createSavedQuery(input: SavedQueryInput): Promise<SavedQuery> {
  const queries = await loadSavedQueries();
  const now = nowIso();
  const query: SavedQuery = {
    ...input,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  queries.push(query);
  await saveSavedQueries(queries);
  return query;
}

export async function updateSavedQuery(
  id: string,
  input: Partial<SavedQueryInput>
): Promise<SavedQuery> {
  const queries = await loadSavedQueries();
  const index = queries.findIndex((q) => q.id === id);
  if (index === -1) {
    throw new Error("Saved query not found");
  }
  const existing = queries[index];
  const updated: SavedQuery = {
    ...existing,
    ...input,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: nowIso(),
  };
  queries[index] = updated;
  await saveSavedQueries(queries);
  return updated;
}

export async function deleteSavedQuery(id: string): Promise<void> {
  const queries = await loadSavedQueries();
  const index = queries.findIndex((q) => q.id === id);
  if (index === -1) {
    throw new Error("Saved query not found");
  }
  queries.splice(index, 1);
  await saveSavedQueries(queries);
}
