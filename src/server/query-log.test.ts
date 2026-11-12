/**
 * Fase 3 (T7) → fase 5 (R2): lectura del final del log SQL. Se prueba en un directorio temporal apuntado por la
 * variable DATADB_DATA_DIR, que es como el worker recibe su directorio de datos de main. Antes se cambiaba el cwd del
 * proceso a un temporal porque la ruta del log salía del cwd; la fase 5 la movió a userData y el cwd ya no interviene.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// query-log.ts resuelve DATA_DIR AL IMPORTARSE (vía src/server/data-dir.ts), leyendo DATADB_DATA_DIR en ese momento.
// Por eso se fija el override a un temporal ANTES del primer import del módulo: el import es dinámico (dentro de
// load()), no un import estático hoisted. Los tres tests operan sobre ese mismo directorio, en orden.
const dataDir = mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), "sqllog-"));
process.env.DATADB_DATA_DIR = dataDir;

const logPath = path.join(dataDir, "sql-log.jsonl");

let mod: typeof import("./query-log") | undefined;
async function load() {
  mod ??= await import("./query-log");
  return mod;
}

after(() => rm(dataDir, { recursive: true, force: true }));

test("sin archivo: exists false, sin error", async () => {
  const { readSqlLogTail } = await load();
  const r = await readSqlLogTail(1024);
  assert.equal(r.exists, false);
  assert.equal(r.content, "");
  assert.equal(r.path, logPath);
});

test("archivo chico: entero, sin truncar", async () => {
  await writeFile(logPath, '{"sql":"a"}\n{"sql":"b"}\n');
  const { readSqlLogTail } = await load();
  const r = await readSqlLogTail(1024);
  assert.equal(r.truncated, false);
  assert.equal(r.content, '{"sql":"a"}\n{"sql":"b"}\n');
  assert.equal(r.totalBytes, 24);
});

test("archivo grande: solo el final, sin la primera línea a medias", async () => {
  const lines = Array.from({ length: 100 }, (_, i) => JSON.stringify({ sql: `select ${i}` }));
  await writeFile(logPath, lines.join("\n") + "\n");
  const { readSqlLogTail } = await load();
  const r = await readSqlLogTail(200);
  assert.equal(r.truncated, true);
  assert.ok(r.shownBytes <= 200);
  const shown = r.content.split("\n").filter(Boolean);
  for (const l of shown) assert.doesNotThrow(() => JSON.parse(l), `línea entera: ${l}`);
  assert.equal(shown.at(-1), JSON.stringify({ sql: "select 99" }));
});
