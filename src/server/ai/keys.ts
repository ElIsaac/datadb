/**
 * De dónde sale una credencial de IA (fase 25, T2; decisiones D2 y D6 del PLAN).
 *
 * Orden: 1) el almacén cifrado (lo que el usuario escribió en Ajustes; lo descifra `main` y llega por el protocolo),
 * 2) SOLO en desarrollo, la variable de entorno (p. ej. `OPENROUTER_API_KEY`): `main` no se la pasa al worker en la app
 * empaquetada, así que ahí esta rama nunca encuentra nada.
 *
 * Se resuelve en CADA petición al proveedor y no se cachea: si el usuario borra o cambia la key en Ajustes, la siguiente
 * petición ya usa la nueva, y la key no se queda en la memoria del worker más de lo que dura la llamada.
 */
import type { SecretName } from "@/shared/secrets";
import { getSecret, hasSecret } from "@/server/secrets-client";

export type KeySource = "settings" | "env" | null;

export async function resolveKey(name: SecretName, envVar?: string): Promise<{ key: string | null; source: KeySource }> {
  const stored = await getSecret(name);
  if (stored) return { key: stored, source: "settings" };
  const fromEnv = envVar ? process.env[envVar] : undefined;
  if (fromEnv) return { key: fromEnv, source: "env" };
  return { key: null, source: null };
}

/** Lo mismo sin descifrar (para el estado de la UI). */
export async function keySource(name: SecretName, envVar?: string): Promise<KeySource> {
  if (await hasSecret(name)) return "settings";
  if (envVar && process.env[envVar]) return "env";
  return null;
}
