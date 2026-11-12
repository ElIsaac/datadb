/**
 * Handlers de favoritos (fase 84). Viven en el worker porque el archivo está en el directorio de
 * datos, junto a `connections.json`, y el renderer solo debe ver la lista.
 */
import { HandlerError } from "./errors";
import { guardarFavoritos, leerFavoritos, type FavoritoDeTabla } from "@/server/favorites";
import type { InvokeMap } from "@/shared/contract";

export async function favoritesGetHandler(
  body: InvokeMap["favorites:get"]["req"]
): Promise<InvokeMap["favorites:get"]["res"]> {
  if (!body?.profileId) throw new HandlerError("Falta el id del perfil", 400);
  return { favoritos: await leerFavoritos(body.profileId) };
}

export async function favoritesSetHandler(
  body: InvokeMap["favorites:set"]["req"]
): Promise<InvokeMap["favorites:set"]["res"]> {
  if (!body?.profileId) throw new HandlerError("Falta el id del perfil", 400);
  const favoritos = (Array.isArray(body.favoritos) ? body.favoritos : []) as FavoritoDeTabla[];
  return { favoritos: await guardarFavoritos(body.profileId, favoritos) };
}
