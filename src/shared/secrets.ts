/**
 * Nombres de secretos (fase 25; ampliado en la fase 17 para las contraseñas de conexión).
 *
 * Compartido por `main` (almacén con `safeStorage`), el worker (que los pide justo antes de usarlos)
 * y el renderer (que solo puede guardar, borrar y preguntar si existen — NUNCA leer un valor).
 *
 * Dos familias:
 *
 *  - **Fijas** (`ai.*`): keys de IA. Lista cerrada, la del panel de ajustes.
 *  - **De conexión** (`db.<profileId>`): la contraseña de UN perfil (R6). El id es el `uuid` del
 *    perfil en `connections.json`, así que el nombre se deriva y no se inventa: `dbSecretName(id)`.
 *
 * Por qué un espacio de nombres y no un archivo por tipo: el almacén ya cifra, sella el nombre de
 * la app y migra; duplicarlo para «contraseñas» habría multiplicado los caminos donde algo puede
 * quedar en claro.
 */
export const AI_SECRET_NAMES = ["ai.openrouter", "ai.openai", "ai.gateway"] as const;
export type AiSecretName = (typeof AI_SECRET_NAMES)[number];

/** Prefijo de las contraseñas de conexión. */
export const DB_SECRET_PREFIX = "db." as const;

/** `db.<uuid del perfil>`. */
export type DbSecretName = `db.${string}`;

/**
 * Secretos del salto SSH (fase 80): `ssh.<uuid>` para la contraseña y `sshpass.<uuid>` para la
 * frase de paso de la clave privada. Van en familias propias para poder borrarlas sin tocar la
 * contraseña de la base cuando el usuario cambia de método de autenticación del salto.
 */
export type SshSecretName = `ssh.${string}` | `sshpass.${string}`;

export type SecretName = AiSecretName | DbSecretName | SshSecretName;

/**
 * Ids admitidos en un nombre `db.*`. Es un `uuid` (lo genera `crypto.randomUUID` en `profiles.ts`),
 * pero se acepta cualquier id de 8-64 caracteres alfanuméricos con `-`/`_`: el nombre viaja por el
 * protocolo main↔worker y no puede servir para inyectar claves arbitrarias en el almacén.
 */
const DB_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Nombre del secreto de un perfil. Lanza si el id no tiene forma de id (nunca debería). */
export function dbSecretName(profileId: string): DbSecretName {
  if (!DB_ID.test(profileId)) {
    throw new Error("Id de perfil inválido para el almacén de secretos");
  }
  return `${DB_SECRET_PREFIX}${profileId}`;
}

/** Contraseña del salto SSH de un perfil. */
export function sshPasswordSecretName(profileId: string): SshSecretName {
  if (!DB_ID.test(profileId)) {
    throw new Error("Id de perfil inválido para el almacén de secretos");
  }
  return `ssh.${profileId}`;
}

/** Frase de paso de la clave privada del salto SSH de un perfil. */
export function sshPassphraseSecretName(profileId: string): SshSecretName {
  if (!DB_ID.test(profileId)) {
    throw new Error("Id de perfil inválido para el almacén de secretos");
  }
  return `sshpass.${profileId}`;
}

/** ¿El nombre es un secreto conocido? Los `ai.*` son lista cerrada; el resto validan el id. */
export function isSecretName(name: unknown): name is SecretName {
  if (typeof name !== "string") return false;
  if ((AI_SECRET_NAMES as readonly string[]).includes(name)) return true;
  if (name.startsWith(DB_SECRET_PREFIX)) return DB_ID.test(name.slice(DB_SECRET_PREFIX.length));
  if (name.startsWith("sshpass.")) return DB_ID.test(name.slice("sshpass.".length));
  if (name.startsWith("ssh.")) return DB_ID.test(name.slice("ssh.".length));
  return false;
}

/**
 * Nombres de IA, que es lo único que el panel de ajustes enumera (`status`). Las contraseñas de
 * conexión no se listan: se preguntan de a una, por el id del perfil que se va a usar.
 */
export const SECRET_NAMES = AI_SECRET_NAMES;
