/**
 * Muestreo de campos para el autocompletado (fase 83). Lo que se fija aquí son los dos casos que
 * ensucian la lista: los valores de BSON (`ObjectId` parece un objeto con `i0`, `i1`…) y los arrays
 * de objetos, que sí aportan rutas útiles (`tags.nombre`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BSON } from "mongodb";

// `recorrer` es interno; se prueba a través del camino real del driver sin abrir conexión sería
// imposible, así que se replica la llamada pública con un documento de ejemplo y el mismo walker.
import { MongodbDriver } from "./mongodb";

/** Se monta un driver sin conectar y se intercepta `obtenerCliente` con un doble mínimo. */
function driverConDocs(docs: Record<string, unknown>[]) {
  const d = new MongodbDriver({
    id: "x",
    name: "Mongo",
    type: "mongodb",
    host: "127.0.0.1",
    port: 1,
    user: "",
    password: "",
    database: "sonda",
    readOnly: false,
  });
  const fake = {
    db: () => ({
      collection: () => ({
        find: () => ({ limit: () => ({ toArray: async () => docs }) }),
      }),
    }),
  };
  // @ts-expect-error: se salta el pool real; es un doble de prueba acotado a este método.
  d.obtenerCliente = async () => fake;
  return d;
}

test("los valores de BSON no aportan rutas internas (nada de _id.i0)", async () => {
  const d = driverConDocs([
    { _id: new BSON.ObjectId(), cliente: "ACME", creado: new Date(), total: new BSON.Decimal128("1.5") },
  ]);
  const campos = await d.sampleFields("ventas");
  assert.deepEqual(campos, ["_id", "cliente", "creado", "total"]);
  assert.equal(campos.some((c) => c.includes("i0")), false);
});

test("los subdocumentos y los arrays de objetos sí aportan rutas", async () => {
  const d = driverConDocs([
    { detalle: { pais: "MX", folio: 1 }, tags: [{ nombre: "a" }], nums: [1, 2, 3] },
  ]);
  const campos = await d.sampleFields("ventas");
  assert.deepEqual(campos, ["detalle", "detalle.folio", "detalle.pais", "nums", "tags", "tags.nombre"]);
});
