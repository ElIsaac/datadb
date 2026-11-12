/**
 * Fase 5 (R2/T2): pruebas de `resolveDataDir`, el único resolutor del directorio
 * de datos. Es puro, así que se prueba sin Electron ni tocar el sistema de archivos.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { DATA_FILES, resolveDataDir } from "./data-dir";

test("sin DATADB_DATA_DIR devuelve userData", () => {
  const userData = "/Users/luis/Library/Application Support/DataDB";
  assert.equal(resolveDataDir({ userData, env: {} }), userData);
});

test("con DATADB_DATA_DIR absoluto gana el override", () => {
  const userData = "/Users/luis/Library/Application Support/DataDB";
  const override = path.join("/tmp", "datadb-sonda");
  assert.equal(resolveDataDir({ userData, env: { DATADB_DATA_DIR: override } }), override);
});

test("con DATADB_DATA_DIR relativo lanza (reintroduciría el bug del cwd)", () => {
  assert.throws(
    () => resolveDataDir({ userData: "/tmp/userData", env: { DATADB_DATA_DIR: "data" } }),
    /absoluta/
  );
});

test("DATA_FILES tiene las 8 claves de archivo", () => {
  assert.deepEqual(Object.keys(DATA_FILES).sort(), [
    "aiChats",
    "aiSettings",
    "connections",
    "queryHistory",
    "savedQueries",
    "secrets",
    "sqlLog",
    "windowState",
  ]);
  assert.equal(DATA_FILES.connections, "connections.json");
  assert.equal(DATA_FILES.sqlLog, "sql-log.jsonl");
  assert.equal(DATA_FILES.secrets, "secrets.json");
  assert.equal(DATA_FILES.windowState, "window-state.json");
});
