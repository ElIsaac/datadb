/**
 * Solo lectura FORZADO POR LA BASE (R53), además del guard que lee el SQL (read-only-guard.ts).
 *
 * Por qué hace falta: el guard analiza texto y no puede ver efectos dentro de funciones. Verificado contra bases
 * reales el 2026-10-09: con un perfil de solo lectura, `SELECT w()` — donde `w()` es una función que hace un INSERT —
 * pasaba el guard y escribió (Postgres 2→3 filas, MySQL 2→3), y `nextval`/`setval`/`pg_terminate_backend` igual.
 * Con la base en modo solo lectura, esas llamadas fallan en el servidor aunque el guard no las vea.
 *
 *   - Postgres: la conexión abre con `default_transaction_read_only = on` (parámetro de arranque, así vale para
 *     cada conexión del pool desde el primer instante y las transacciones manuales también lo heredan).
 *     Límite: PgBouncer < 1.20 rechaza el parámetro `options` salvo `ignore_startup_parameters = options`; en ese
 *     caso la conexión FALLA con el error del servidor (visible), no se degrada en silencio.
 *   - MySQL/MariaDB: `SET SESSION TRANSACTION READ ONLY` en cada conexión nueva del pool.
 *   - SQL Server: no existe equivalente por sesión (`ApplicationIntent=ReadOnly` solo enruta en grupos de
 *     disponibilidad y no impide escribir). La protección es solo el guard; la UI lo dice (ver
 *     `readOnlyEnforcedByDatabase`). Para producción: usar un login con permisos solo de lectura (`db_datareader`).
 *
 * Esto NO sustituye a un usuario de base de datos sin permisos de escritura, que sigue siendo la defensa fuerte
 * (una sesión de solo lectura la puede revertir quien ejecute `SET` con otros privilegios; el guard bloquea `SET`).
 */
import type { ConnectionProfile } from "@/lib/types";

export const PG_READ_ONLY_OPTIONS = "-c default_transaction_read_only=on";
export const MYSQL_READ_ONLY_SQL = "SET SESSION TRANSACTION READ ONLY";

/** ¿El motor puede hacer cumplir el solo lectura por sí mismo? SQL Server no. */
export function readOnlyEnforcedByDatabase(type: ConnectionProfile["type"]): boolean {
  return type === "postgres" || type === "mysql";
}

/** Opciones extra para `new Pool(...)` de pg según el perfil. */
export function pgReadOnlyPoolOptions(config: Pick<ConnectionProfile, "readOnly">): { options?: string } {
  return config.readOnly ? { options: PG_READ_ONLY_OPTIONS } : {};
}

/**
 * Texto para la UI sobre quién hace cumplir el solo lectura. Un solo sitio para que el aviso de SQL Server (que no
 * puede forzarlo la base) diga lo mismo en la pantalla de conexión, en la insignia de la barra de estado, etc.
 */
export function readOnlyProtectionNote(type: ConnectionProfile["type"]): string {
  if (readOnlyEnforcedByDatabase(type)) {
    return "Doble protección: se analiza el SQL antes de enviarlo y la sesión de la base de datos queda en solo lectura.";
  }
  return (
    "SQL Server no permite forzar el solo lectura en la sesión: la protección es solo el análisis del SQL antes de " +
    "enviarlo, y no detecta funciones o procedimientos con efectos. Para producción usa un login con permisos de solo " +
    "lectura (db_datareader)."
  );
}
