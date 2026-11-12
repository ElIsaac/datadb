/**
 * Handlers de sesion. Antes vivian dentro de las rutas de Next (connect / databases /
 * schema); ahora los comparten la ruta HTTP y el canal IPC. Mensajes y status IDENTICOS a
 * los de las rutas: no "mejorar" textos (ver errors.ts).
 */
import type { ConnectionProfileInput, SchemaNode, Session } from "@/lib/types";
import { getProfilePassword, getProfileSshSecrets, loadProfiles } from "@/server/profiles";
import { closeSession, createSession, getSession, getSessionSchema, switchDatabase } from "@/server/sessions";
import { HandlerError } from "./errors";

/** Antes: src/app/api/connect/route.ts */
export async function connectHandler(
  body: { profileId: string } | ConnectionProfileInput
): Promise<Session> {
  if ("profileId" in body) {
    const profile = (await loadProfiles()).find((p) => p.id === body.profileId);
    if (!profile) throw new HandlerError("Profile not found", 400);
    // Fase 17 (R6): el perfil del disco NO trae contraseña. Se descifra aquí, en el worker, justo
    // antes de abrir el pool; el valor no se guarda en la sesión ni viaja al renderer.
    // Fase 80: además de la contraseña de la base, se descifran los secretos del salto SSH. Los dos
    // valores viven solo en memoria del worker: ni la sesión ni el renderer los ven.
    const secretosSsh = profile.ssh?.enabled ? await getProfileSshSecrets(profile.id) : { password: "", passphrase: "" };
    return createSession({
      ...profile,
      password: await getProfilePassword(profile.id),
      sshPassword: secretosSsh.password,
      sshPassphrase: secretosSsh.passphrase,
    });
  }
  if (!body.type || !body.host || !body.user) {
    throw new HandlerError("Missing required fields", 400);
  }
  return createSession(body);
}

/** Antes: src/app/api/session/route.ts. OJO: aqui "no existe" es 404, no 401 como en el resto. */
export async function getSessionHandler({
  sessionId,
}: {
  sessionId: string;
}): Promise<Session> {
  if (!sessionId) throw new HandlerError("Missing sessionId", 400);
  const stored = getSession(sessionId);
  if (!stored) throw new HandlerError("Session not found", 404);
  return stored.session;
}

/** Antes: src/app/api/databases/route.ts */
export async function listDatabasesHandler({
  sessionId,
}: {
  sessionId: string;
}): Promise<string[]> {
  if (!sessionId) throw new HandlerError("Missing sessionId", 400);
  const stored = getSession(sessionId);
  if (!stored) throw new HandlerError("Session not found", 401);
  return stored.driver.listDatabases();
}

/** Antes: src/app/api/schema/route.ts */
export async function getSchemaHandler({
  sessionId,
}: {
  sessionId: string;
}): Promise<SchemaNode[]> {
  if (!sessionId) throw new HandlerError("Missing sessionId", 400);
  return getSessionSchema(sessionId);
}

/**
 * Antes: src/app/api/disconnect/route.ts (fase 3, T2). Cerrar una sesion que ya no existe no es error (la ruta
 * tampoco lo era): `closeSession` sale sin hacer nada. Una transaccion abierta se revierte al cerrar.
 */
export async function disconnectHandler({ sessionId }: { sessionId: string }): Promise<{ ok: true }> {
  if (!sessionId) throw new HandlerError("Missing sessionId", 400);
  await closeSession(sessionId);
  return { ok: true };
}

/**
 * Antes: src/app/api/switch-database/route.ts (fase 3, T2). OJO: aqui una sesion inexistente NO es 401: `switchDatabase`
 * lanza un Error generico y la ruta lo devolvia como "Error: Session not found" con 500. Se conserva; el texto sigue
 * matcheando /session not found/i, que es lo que mira la auto-reconexion.
 */
export async function switchDatabaseHandler({
  sessionId,
  database,
}: {
  sessionId: string;
  database: string;
}): Promise<Session> {
  if (!sessionId || !database) throw new HandlerError("Missing sessionId or database", 400);
  return switchDatabase(sessionId, database);
}
