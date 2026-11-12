/**
 * Lado del WORKER del almacén de secretos (fase 25). El worker no tiene `safeStorage` (solo existe en `main`): pide
 * cada secreto a `main` por el protocolo (`secret-request`) justo antes de usarlo, y no lo guarda.
 *
 * Fuera del worker (tests, scripts) no hay transporte: `getSecret` devuelve null y `hasSecret` false, así el código de
 * IA se comporta como «sin key» en vez de fallar raro.
 */
import type { SecretName } from "@/shared/secrets";

export type SecretTransport = (
  op: "get" | "has" | "set" | "delete",
  name: SecretName,
  value?: string
) => Promise<{ value?: string | null; has?: boolean }>;

let transport: SecretTransport | null = null;

/** Lo llama `electron/db-worker.ts` al arrancar. */
export function setSecretTransport(t: SecretTransport | null): void {
  transport = t;
}

export async function getSecret(name: SecretName): Promise<string | null> {
  if (!transport) return null;
  return (await transport("get", name)).value ?? null;
}

export async function hasSecret(name: SecretName): Promise<boolean> {
  if (!transport) return false;
  return Boolean((await transport("has", name)).has);
}

/**
 * Fase 17: guarda un secreto (la contraseña de un perfil). Sin transporte NO se pierde el valor en
 * silencio: se lanza, porque quien llama (`profiles.ts`) está a punto de dejar el perfil sin
 * contraseña y prefiere fallar la operación completa a guardar una conexión que no conecta.
 */
export async function setSecret(name: SecretName, value: string): Promise<void> {
  if (!transport) throw new Error("El almacén de secretos no está disponible");
  await transport("set", name, value);
}

/** Borra un secreto (al eliminar un perfil). Sin transporte no hay nada que borrar. */
export async function deleteSecret(name: SecretName): Promise<void> {
  if (!transport) return;
  await transport("delete", name);
}
