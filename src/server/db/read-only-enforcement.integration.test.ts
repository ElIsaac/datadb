/**
 * Prueba de integración de R53 contra bases REALES. Se omite si no hay variables de entorno (no hay Docker en CI):
 *
 *   docker run -d --rm --name pg -e POSTGRES_HOST_AUTH_METHOD=trust -p 55432:5432 postgres:16-alpine
 *   docker run -d --rm --name my -e MYSQL_ALLOW_EMPTY_PASSWORD=yes -e MYSQL_DATABASE=app -p 53306:3306 mysql:8.0
 *   GESTORDB_IT_PG_PORT=55432 GESTORDB_IT_MYSQL_PORT=53306 npm test
 *
 * Crea una tabla `ro_it` y una función `ro_it_w()` que ESCRIBE en ella; el guard que lee el SQL no puede ver eso,
 * así que solo la base en modo solo lectura la detiene. Usa root en MySQL para fijar log_bin_trust_function_creators.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createDriver } from "./factory";
import { assertWritableIfNeeded } from "./read-only-guard";
import type { ConnectionProfile } from "@/lib/types";

const pgPort = Number(process.env.GESTORDB_IT_PG_PORT) || 0;
const myPort = Number(process.env.GESTORDB_IT_MYSQL_PORT) || 0;

const pg = (readOnly: boolean): ConnectionProfile =>
  ({ type: "postgres", host: "127.0.0.1", port: pgPort, user: "postgres", password: "", database: "postgres", name: "it", readOnly }) as ConnectionProfile;
const my = (readOnly: boolean): ConnectionProfile =>
  ({ type: "mysql", host: "127.0.0.1", port: myPort, user: "root", password: "", database: "app", name: "it", readOnly }) as ConnectionProfile;

async function count(p: ConnectionProfile): Promise<number> {
  const d = createDriver({ ...p, readOnly: false });
  try {
    return Number((await d.executeQuery("SELECT count(*) AS n FROM ro_it")).rows[0].n);
  } finally {
    await d.close();
  }
}

async function guardedRun(p: ConnectionProfile, sql: string): Promise<string> {
  const d = createDriver(p);
  try {
    assertWritableIfNeeded(sql, p.readOnly, p.type);
    await d.executeQuery(sql);
    return "ejecutó";
  } catch (e) {
    return String((e as Error).message);
  } finally {
    await d.close();
  }
}

test("Postgres: una función que escribe falla en un perfil de solo lectura y funciona en uno de escritura", { skip: !pgPort }, async () => {
  const setup = createDriver(pg(false));
  await setup.executeQuery("CREATE TABLE IF NOT EXISTS ro_it (n int)");
  await setup.executeQuery("CREATE OR REPLACE FUNCTION ro_it_w() RETURNS int LANGUAGE sql AS $$ INSERT INTO ro_it VALUES (1) RETURNING 1 $$");
  await setup.close();

  const before = await count(pg(false));
  const ro = await guardedRun(pg(true), "SELECT ro_it_w()");
  assert.match(ro, /read-only transaction/i);
  assert.equal(await count(pg(false)), before, "el perfil de solo lectura NO debe escribir");

  assert.equal(await guardedRun(pg(false), "SELECT ro_it_w()"), "ejecutó");
  assert.equal(await count(pg(false)), before + 1, "el perfil de escritura sigue escribiendo");
});

test("MySQL: una función que escribe falla en un perfil de solo lectura y funciona en uno de escritura", { skip: !myPort }, async () => {
  const setup = createDriver(my(false));
  await setup.executeQuery("SET GLOBAL log_bin_trust_function_creators = 1");
  await setup.executeQuery("CREATE TABLE IF NOT EXISTS ro_it (n int)");
  // El driver envía la sentencia entera por el protocolo, sin DELIMITER (que es cosa del cliente de consola).
  await setup.executeQuery("DROP FUNCTION IF EXISTS ro_it_w");
  await setup.executeQuery("CREATE FUNCTION ro_it_w() RETURNS int MODIFIES SQL DATA BEGIN INSERT INTO ro_it VALUES (1); RETURN 1; END");
  await setup.close();

  const before = await count(my(false));
  const ro = await guardedRun(my(true), "SELECT ro_it_w()");
  assert.match(ro, /READ ONLY transaction/i);
  assert.equal(await count(my(false)), before, "el perfil de solo lectura NO debe escribir");

  assert.equal(await guardedRun(my(false), "SELECT ro_it_w()"), "ejecutó");
  assert.equal(await count(my(false)), before + 1, "el perfil de escritura sigue escribiendo");
});
