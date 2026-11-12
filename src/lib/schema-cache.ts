import type { SchemaNode, Session } from "./types";

/**
 * Lo que identifica una caché de esquema: conexión, motor y base. Una `Session` viva lo cumple, y
 * también la conexión DORMIDA de una consola (R91), que así enseña su explorador sin conectar.
 */
type SchemaCacheOwner = Pick<Session, "name" | "type" | "database">;

const CACHE_KEY_PREFIX = "gdb:schema";

export function getSchemaCacheKey(session: SchemaCacheOwner): string {
  return `${CACHE_KEY_PREFIX}:${session.name}:${session.type}:${session.database ?? ""}`;
}

export function loadCachedSchema(session: SchemaCacheOwner): SchemaNode[] | null {
  try {
    const raw = localStorage.getItem(getSchemaCacheKey(session));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SchemaNode[];
    // Normaliza caches antiguas que no incluían routines/triggers.
    return parsed.map((node) => ({
      ...node,
      routines: node.routines ?? [],
      triggers: node.triggers ?? [],
    }));
  } catch {
    return null;
  }
}

export function saveCachedSchema(session: Session, schema: SchemaNode[]): void {
  try {
    localStorage.setItem(getSchemaCacheKey(session), JSON.stringify(schema));
  } catch {
    // ignore storage errors
  }
}

export function clearCachedSchema(session: Session): void {
  try {
    localStorage.removeItem(getSchemaCacheKey(session));
  } catch {
    // ignore storage errors
  }
}
