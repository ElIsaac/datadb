import type { FavoriteTable, Session } from "./types";

const CACHE_KEY_PREFIX = "gdb:favorites";

export function getFavoritesCacheKey(session: Session): string {
  return `${CACHE_KEY_PREFIX}:${session.name}:${session.type}:${session.database ?? ""}`;
}

export function loadCachedFavorites(session: Session): FavoriteTable[] {
  try {
    const raw = localStorage.getItem(getFavoritesCacheKey(session));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FavoriteTable[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCachedFavorites(
  session: Session,
  favorites: FavoriteTable[]
): void {
  try {
    localStorage.setItem(
      getFavoritesCacheKey(session),
      JSON.stringify(favorites)
    );
  } catch {
    // ignore storage errors
  }
}

export function clearCachedFavorites(session: Session): void {
  try {
    localStorage.removeItem(getFavoritesCacheKey(session));
  } catch {
    // ignore storage errors
  }
}
