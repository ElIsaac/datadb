// Fase 5 (R2): fija DATADB_DATA_DIR a un temporal antes de cargar src/server/**. Debe ser el primer import.
import "../test-env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { MYSQL_READ_ONLY_SQL, PG_READ_ONLY_OPTIONS, pgReadOnlyPoolOptions, readOnlyEnforcedByDatabase, readOnlyProtectionNote } from "./read-only-session";
import { driverCacheKey } from "../sessions";

const dest = { id: "p1", type: "postgres" as const, host: "h", port: 5432, user: "u", password: "p", database: "d", name: "x" };

test("R53: solo Postgres y MySQL pueden forzar el solo lectura en la base; SQL Server no", () => {
  assert.equal(readOnlyEnforcedByDatabase("postgres"), true);
  assert.equal(readOnlyEnforcedByDatabase("mysql"), true);
  assert.equal(readOnlyEnforcedByDatabase("sqlserver"), false);
});

test("Postgres: un perfil de solo lectura abre con default_transaction_read_only=on; uno de escritura no añade nada", () => {
  assert.deepEqual(pgReadOnlyPoolOptions({ readOnly: true }), { options: PG_READ_ONLY_OPTIONS });
  assert.equal(PG_READ_ONLY_OPTIONS, "-c default_transaction_read_only=on");
  assert.deepEqual(pgReadOnlyPoolOptions({ readOnly: false }), {});
  assert.deepEqual(pgReadOnlyPoolOptions({}), {});
});

test("MySQL: la sentencia que fija la sesión en solo lectura", () => {
  assert.equal(MYSQL_READ_ONLY_SQL, "SET SESSION TRANSACTION READ ONLY");
});

test("la caché de drivers separa perfiles de solo lectura y de escritura del mismo destino", () => {
  // Sin readOnly en la clave compartían pool: el de solo lectura heredaba conexiones SIN la protección de la base.
  assert.notEqual(driverCacheKey({ ...dest, readOnly: true }), driverCacheKey({ ...dest, readOnly: false }));
  assert.equal(driverCacheKey({ ...dest, readOnly: false }), driverCacheKey({ ...dest }), "undefined cuenta como escritura");
  assert.equal(driverCacheKey({ ...dest, readOnly: true }), driverCacheKey({ ...dest, readOnly: true, name: "otro" }));
});

test("el aviso para SQL Server dice que la protección es solo el análisis del SQL y qué hacer; los demás motores no", () => {
  const sqlserver = readOnlyProtectionNote("sqlserver");
  assert.match(sqlserver, /no permite forzar/i);
  assert.match(sqlserver, /db_datareader/);
  assert.doesNotMatch(readOnlyProtectionNote("postgres"), /no permite forzar/i);
  assert.match(readOnlyProtectionNote("mysql"), /doble protección/i);
});
