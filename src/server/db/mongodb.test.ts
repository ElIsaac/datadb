/**
 * Driver de MongoDB — lo que se puede probar sin servidor: la URI y que las operaciones que
 * TODAVÍA no existen fallen con un mensaje honesto en vez de devolver algo vacío.
 *
 * La conexión real (TLS por archivos + túnel SSH) se verificó contra un `mongod` con
 * `--tlsMode requireTLS` y un salto OpenSSH: ver `.planning/phases/phase-80/PLAN.md`, que guarda la
 * receta del banco de pruebas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { construirUri, MongodbDriver } from "./mongodb";
import type { ConnectionProfile } from "@/lib/types";

const SIN_VISTA = /la vista de consultas todavía no está/;

const perfil: ConnectionProfile = {
  id: "x",
  name: "Mongo",
  type: "mongodb",
  host: "127.0.0.1",
  port: 27017,
  user: "datadb",
  password: "secreta",
  database: "sonda",
  readOnly: false,
};

test("la URI no lleva credenciales: van por `auth`, que las escapa el driver", () => {
  const uri = construirUri({ host: "127.0.0.1", port: 52981, database: "sonda" });
  assert.equal(uri, "mongodb://127.0.0.1:52981/sonda");
  assert.equal(uri.includes("secreta"), false);
});

test("sin base la URI no acaba en barra; con espacios se codifica", () => {
  assert.equal(construirUri({ host: "h", port: 1 }), "mongodb://h:1");
  assert.equal(construirUri({ host: "h", port: 1, database: "  " }), "mongodb://h:1");
  assert.equal(construirUri({ host: "h", port: 1, database: "mi base" }), "mongodb://h:1/mi%20base");
});

test("las operaciones SQL fallan con el mensaje de la vista pendiente, sin intentar conectar", async () => {
  const d = new MongodbDriver(perfil);
  await assert.rejects(() => d.executeQuery(), SIN_VISTA);
  await assert.rejects(() => d.executeBatch(), SIN_VISTA);
  await assert.rejects(() => d.getTableDdl(), SIN_VISTA);
  await assert.rejects(() => d.getRoutineDdl(), SIN_VISTA);
  await assert.rejects(() => d.getTriggerDdl(), SIN_VISTA);
  await assert.rejects(() => d.explainQuery(), SIN_VISTA);
  // Cancelar sin consultas en curso no es un error: no hay nada que matar.
  await d.cancelQuery();
});

test("TLS mal configurado se explica antes de abrir el socket", async () => {
  const d = new MongodbDriver({
    ...perfil,
    tls: { mode: "verificar-ca" },
  });
  await assert.rejects(() => d.testConnection(), /TLS: falta el archivo de CA/);
});

test("el túnel sin host también se rechaza con un mensaje que nombra el campo", async () => {
  const d = new MongodbDriver({
    ...perfil,
    ssh: { enabled: true, host: "", port: 22, user: "", auth: "password" },
  });
  await assert.rejects(() => d.testConnection(), /SSH: falta el host del salto/);
});
