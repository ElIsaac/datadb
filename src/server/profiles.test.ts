/**
 * Fase 17 (R6/R7) — los perfiles NO guardan contraseñas y la migración las cifra.
 *
 * Se prueba contra un directorio temporal (`DATADB_DATA_DIR`, igual que el worker) y con un
 * transporte de secretos FALSO en memoria: lo que se verifica aquí es la frontera del disco y las
 * decisiones (qué se escribe, qué se descarta, qué se pide al almacén), no `safeStorage`, que tiene
 * sus propias pruebas en `electron/secrets.test.ts`.
 *
 * Import dinámico (y no estático) a propósito: `profiles.ts` resuelve la ruta del archivo al
 * importarse, así que `DATADB_DATA_DIR` tiene que estar puesto antes.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), "profiles-"));
process.env.DATADB_DATA_DIR = dataDir;
const connectionsPath = path.join(dataDir, "connections.json");

/** Almacén de secretos falso: nombre → valor, en memoria. */
const secretos = new Map<string, string>();
let setLlamados = 0;

let mod: typeof import("./profiles") | undefined;
async function load() {
  if (!mod) {
    const secrets = await import("@/server/secrets-client");
    secrets.setSecretTransport(async (op, name, value) => {
      if (op === "get") return { value: secretos.get(name) ?? null };
      if (op === "has") return { has: secretos.has(name) };
      if (op === "set") {
        setLlamados++;
        secretos.set(name, value ?? "");
        return { has: true };
      }
      secretos.delete(name);
      return { has: false };
    });
    mod = await import("./profiles");
  }
  return mod;
}

const perfilBase = {
  name: "Local Postgres",
  type: "postgres" as const,
  host: "127.0.0.1",
  port: 5432,
  user: "postgres",
  password: "s3cr3t",
  database: "postgres",
  color: "#3b82f6",
  readOnly: false,
};

/** Lo que hay realmente en el archivo, como texto. */
async function jsonCrudo(): Promise<string> {
  return readFile(connectionsPath, "utf-8");
}

after(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

test("createProfile: la contraseña NO aparece en connections.json y sí en el almacén", async () => {
  const profiles = await load();
  const creado = await profiles.createProfile(perfilBase);
  const crudo = await jsonCrudo();

  assert.equal(crudo.includes("s3cr3t"), false, "la contraseña no puede estar en el JSON");
  assert.equal(crudo.includes('"password"'), false, "el campo password no se escribe en disco");
  assert.equal(creado.hasPassword, true);
  assert.equal(creado.password, "", "al llamador no se le devuelve el secreto");
  assert.equal(secretos.get(`db.${creado.id}`), "s3cr3t", "el secreto vive en el almacén, por id");
});

test("loadProfiles: descarta un password que se hubiera colado a mano en el JSON", async () => {
  const profiles = await load();
  const lista = await profiles.loadProfiles();
  const conClave = lista.map((p) => ({ ...p, password: "a-mano" }));
  await writeFile(connectionsPath, JSON.stringify(conClave, null, 2), "utf-8");

  const leidos = await profiles.loadProfiles();
  assert.ok(leidos.length > 0);
  for (const p of leidos) assert.equal(p.password, "", `${p.name} no debe traer contraseña`);
});

test("updateProfile sin contraseña nueva conserva la guardada (no la borra ni la reescribe)", async () => {
  const profiles = await load();
  const [perfil] = await profiles.loadProfiles();
  const antes = setLlamados;

  const actualizado = await profiles.updateProfile(perfil.id, {
    ...perfilBase,
    name: "Local Postgres (renombrado)",
    password: "",
  });

  assert.equal(actualizado.hasPassword, true, "sigue habiendo contraseña");
  assert.equal(setLlamados, antes, "no se re-cifra lo que no cambió");
  assert.equal(secretos.get(`db.${perfil.id}`), "s3cr3t");
  assert.equal((await jsonCrudo()).includes("s3cr3t"), false);
});

test("updateProfile con contraseña nueva la reemplaza en el almacén", async () => {
  const profiles = await load();
  const [perfil] = await profiles.loadProfiles();
  await profiles.updateProfile(perfil.id, { ...perfilBase, password: "otra-clave" });
  assert.equal(secretos.get(`db.${perfil.id}`), "otra-clave");
  assert.equal((await jsonCrudo()).includes("otra-clave"), false);
});

test("getProfilePassword devuelve el valor descifrado y '' cuando no hay nada", async () => {
  const profiles = await load();
  const [perfil] = await profiles.loadProfiles();
  assert.equal(await profiles.getProfilePassword(perfil.id), "otra-clave");
  assert.equal(await profiles.getProfilePassword("perfil-inexistente"), "");
});

test("deleteProfile borra también el secreto", async () => {
  const profiles = await load();
  const [perfil] = await profiles.loadProfiles();
  await profiles.deleteProfile(perfil.id);
  assert.equal(secretos.has(`db.${perfil.id}`), false);
  assert.equal((await profiles.loadProfiles()).length, 0);
});

test("R7: la migración cifra las contraseñas en claro y deja el JSON limpio", async () => {
  const profiles = await load();
  const id = "11111111-2222-3333-4444-555555555555";
  await writeFile(
    connectionsPath,
    JSON.stringify([{ ...perfilBase, id, password: "vieja-en-claro" }], null, 2),
    "utf-8"
  );

  const migradas = await profiles.migratePlaintextPasswords();
  assert.equal(migradas, 1);
  assert.equal(secretos.get(`db.${id}`), "vieja-en-claro");
  assert.equal((await jsonCrudo()).includes("vieja-en-claro"), false, "no puede quedar en el archivo");
  const [perfil] = await profiles.loadProfiles();
  assert.equal(perfil.hasPassword, true, "queda el sello para el hint del formulario");

  // Idempotente: la segunda pasada no migra nada.
  assert.equal(await profiles.migratePlaintextPasswords(), 0);
});

test("R7: sin archivo no falla (primera ejecución)", async () => {
  const profiles = await load();
  await rm(connectionsPath, { force: true });
  assert.equal(await profiles.migratePlaintextPasswords(), 0);
});
