/**
 * Handlers de perfiles de conexion. Fase 2: `profiles:list`. Fase 3 (T2): crear, editar, borrar y probar.
 * Antes: src/app/api/connections/{route,[id]/route,test/route}.ts.
 *
 * Mensajes y status IDENTICOS a los de las rutas (ver errors.ts). Dos rarezas que se conservan a proposito:
 *  - editar y borrar devolvian TODOS sus fallos con **400** (`error(String(err), 400)`), no 500;
 *  - probar la conexion no falla por un error del driver: devuelve `{ ok: false, error }` y la pantalla de
 *    conexion lo pinta como resultado de la prueba. Solo los campos obligatorios ausentes son error (400).
 *
 * Seguridad: `sanitizeProfile` va DENTRO de cada handler (no en el transporte) para que ningun canal pueda
 * devolver la contrasena al renderer.
 */
import type { ConnectionProfile, ConnectionProfileInput } from "@/lib/types";
import { createDriver } from "@/server/db/factory";
import { createProfile, deleteProfile, getProfilePassword, getProfileSshSecrets, loadProfiles, sanitizeProfile, updateProfile } from "@/server/profiles";
import { HandlerError } from "./errors";

/** Antes: GET /api/connections. */
export async function listProfilesHandler(): Promise<ConnectionProfile[]> {
  return (await loadProfiles()).map(sanitizeProfile);
}

function requireFields(input: ConnectionProfileInput | undefined, withName: boolean): void {
  if (!input || (withName && !input.name) || !input.type || !input.host || !input.user) {
    throw new HandlerError("Missing required fields", 400);
  }
}

/** Relanza como 400 lo que no sea ya un HandlerError (comportamiento de las rutas de editar y borrar). */
function as400(err: unknown): never {
  if (err instanceof HandlerError) throw err;
  throw new HandlerError(String(err), 400);
}

/** Antes: POST /api/connections. */
export async function saveProfileHandler(input: ConnectionProfileInput): Promise<ConnectionProfile> {
  requireFields(input, true);
  return sanitizeProfile(await createProfile(input));
}

/** Antes: PUT /api/connections/[id]. Una contrasena vacia conserva la guardada (lo decide updateProfile). */
export async function updateProfileHandler(req: {
  id: string;
  input: ConnectionProfileInput;
}): Promise<ConnectionProfile> {
  try {
    requireFields(req?.input, true);
    return sanitizeProfile(await updateProfile(req.id, req.input));
  } catch (err) {
    as400(err);
  }
}

/** Antes: DELETE /api/connections/[id]. */
export async function deleteProfileHandler(req: { id: string }): Promise<{ ok: true }> {
  try {
    await deleteProfile(req?.id);
    return { ok: true };
  } catch (err) {
    as400(err);
  }
}

/**
 * Antes: POST /api/connections/test. Abre un driver suelto (no una sesion), prueba y lo cierra.
 *
 * Fase 17 (R6): el formulario de un perfil YA GUARDADO llega con la contraseña en blanco (está
 * cifrada y solo el worker puede leerla). `id` es opcional y sirve justo para eso: si no viene
 * contraseña pero sí el id de un perfil guardado, se prueba con la suya. Sin ese camino, «Probar
 * conexión» fallaría siempre al editar una conexión que sí funciona.
 */
export async function testProfileHandler(
  input: ConnectionProfileInput & { id?: string }
): Promise<{ ok: boolean; error?: string }> {
  requireFields(input, false);
  try {
    const password =
      input.password || (input.id ? await getProfilePassword(input.id) : "");
    // Fase 80: si el salto SSH tiene secretos guardados y el formulario no los trae, se descifran
    // aquí — igual que la contraseña de la base. Sin esto, «Probar conexión» de un perfil guardado
    // con túnel fallaría siempre.
    const secretosSsh =
      input.ssh?.enabled && input.id && !input.sshPassword && !input.sshPassphrase
        ? await getProfileSshSecrets(input.id)
        : { password: input.sshPassword ?? "", passphrase: input.sshPassphrase ?? "" };
    const driver = createDriver({
      ...input,
      id: "test",
      password,
      sshPassword: secretosSsh.password,
      sshPassphrase: secretosSsh.passphrase,
      database: input.database ?? "",
    });
    await driver.testConnection();
    // La ruta se tragaba este fallo; aqui se registra (no cambia el resultado: la conexion SI funciono).
    await driver.close().catch((err) => console.error("[profiles:test] no se pudo cerrar el driver de prueba", err));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
