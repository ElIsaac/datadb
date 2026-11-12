/**
 * Favoritos en disco (fase 84). Se prueba la frontera: qué se escribe, que dos perfiles no se pisen y
 * que un archivo con basura no rompa el arranque. El fallo reportado («cierro y no están») venía de
 * guardar con clave de sesión y en cada cambio de estado; aquí la clave es el id del perfil.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "favs-"));
process.env.DATADB_DATA_DIR = dataDir;

// Import dinámico dentro de un `before`-like: `favorites.ts` resuelve el directorio al importarse,
// así que `DATADB_DATA_DIR` tiene que estar puesto antes. (Top-level await no compila en CJS.)
let mod: typeof import("./favorites");
test("carga del módulo", async () => {
  mod = await import("./favorites");
  assert.ok(mod);
});

test("guardar y leer sobrevive a un reinicio (el archivo queda en disco)", async () => {
  await mod.guardarFavoritos("perfil-1", [{ schema: "sonda", table: "ventas" }]);
  const enDisco = JSON.parse(readFileSync(path.join(dataDir, "favorites.json"), "utf8"));
  assert.deepEqual(enDisco["perfil-1"], [{ schema: "sonda", table: "ventas" }]);
  assert.deepEqual(await mod.leerFavoritos("perfil-1"), [{ schema: "sonda", table: "ventas" }]);
});

test("dos perfiles no se pisan (era el fallo con un solo array global)", async () => {
  await mod.guardarFavoritos("perfil-1", [{ schema: "sonda", table: "ventas" }]);
  await mod.guardarFavoritos("perfil-2", [{ schema: "public", table: "clientes" }]);
  assert.deepEqual(await mod.leerFavoritos("perfil-1"), [{ schema: "sonda", table: "ventas" }]);
  assert.deepEqual(await mod.leerFavoritos("perfil-2"), [{ schema: "public", table: "clientes" }]);
});

test("cambiar de base no borra los favoritos de las otras bases", async () => {
  await mod.guardarFavoritos("perfil-3", [
    { schema: "ventas", table: "accounts" },
    { schema: "admin", table: "system.users" },
  ]);
  // Al cambiar de base la UI muestra solo los suyos, pero el archivo conserva ambos.
  const todos = await mod.leerFavoritos("perfil-3");
  assert.equal(todos.length, 2);
  assert.deepEqual(todos.filter((f) => f.schema === "ventas"), [{ schema: "ventas", table: "accounts" }]);
});

test("el archivo se normaliza: duplicados fuera, basura fuera", async () => {
  const limpios = await mod.guardarFavoritos("perfil-4", [
    { schema: "sonda", table: "ventas" },
    { schema: "sonda", table: "ventas" },
    { schema: "", table: "x" },
    { table: "sinBase" },
    "no soy un favorito",
  ]);
  assert.deepEqual(limpios, [{ schema: "sonda", table: "ventas" }]);
});

test("un perfil sin favoritos devuelve lista vacía, no error", async () => {
  assert.deepEqual(await mod.leerFavoritos("no-existe"), []);
});
