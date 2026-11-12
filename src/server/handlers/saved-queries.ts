/**
 * Handlers de consultas guardadas. Fase 2: `savedQueries:list`. Fase 3 (T3): crear, editar y borrar.
 * Antes: src/app/api/saved-queries/{route,[id]/route}.ts.
 *
 * Mensajes y status IDENTICOS a los de las rutas (ver errors.ts). Como en perfiles, editar y borrar devolvian
 * todos sus fallos con 400 y se conserva.
 */
import type { SavedQuery, SavedQueryInput } from "@/lib/types";
import {
  createSavedQuery,
  deleteSavedQuery,
  loadSavedQueries,
  migrarConsultasAPerfiles,
  updateSavedQuery,
} from "@/server/saved-queries";
import { loadProfiles } from "@/server/profiles";
import { HandlerError } from "./errors";

/** Antes: GET /api/saved-queries (el filtro por conexion es opcional). */
export async function listSavedQueriesHandler({
  connectionId,
}: {
  connectionId?: string;
}): Promise<SavedQuery[]> {
  // R96: el panel pide TODAS (filtra él, por perfil). Al pedirlas todas se ligan de paso las
  // consultas viejas a su perfil (ver `migrarConsultasAPerfiles`); si leer los perfiles falla no se
  // pierde la lista: se registra y se devuelven tal cual.
  if (!connectionId) {
    try {
      return await migrarConsultasAPerfiles(await loadProfiles());
    } catch (err) {
      console.error("[consultas guardadas] no se pudieron ligar a sus perfiles", err);
    }
  }
  return loadSavedQueries(connectionId || undefined);
}

/** Antes: POST /api/saved-queries. */
export async function saveSavedQueryHandler(input: SavedQueryInput): Promise<SavedQuery> {
  if (!input?.name || !input.sql) throw new HandlerError("Missing required fields", 400);
  return createSavedQuery(input);
}

function as400(err: unknown): never {
  if (err instanceof HandlerError) throw err;
  throw new HandlerError(String(err), 400);
}

/** Antes: PUT /api/saved-queries/[id]. Solo se validan los campos que vienen en el parche. */
export async function updateSavedQueryHandler(req: {
  id: string;
  input: Partial<SavedQueryInput>;
}): Promise<SavedQuery> {
  try {
    const input = req?.input ?? {};
    if (input.name !== undefined && !input.name) throw new HandlerError("Name cannot be empty", 400);
    if (input.sql !== undefined && !input.sql) throw new HandlerError("SQL cannot be empty", 400);
    return await updateSavedQuery(req.id, input);
  } catch (err) {
    as400(err);
  }
}

/** Antes: DELETE /api/saved-queries/[id]. */
export async function deleteSavedQueryHandler(req: { id: string }): Promise<{ ok: true }> {
  try {
    await deleteSavedQuery(req?.id);
    return { ok: true };
  } catch (err) {
    as400(err);
  }
}
