/**
 * Parseo de la barra de consulta de Mongo (fase 81) y conversión del driver a JSON.
 *
 * Lo que se fija aquí son los tres fallos que se ven como «no funciona y no dice nada»: un filtro
 * vacío que debe significar «todo», un filtro escrito a mano con ObjectId, y un error que tiene que
 * nombrar el campo en vez de reventar con el mensaje del parser.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BSON } from "mongodb";
import { aEjson, parsearJson, parsearOrden } from "./mongodb";

test("filtro vacío = sin filtro (no es un error)", () => {
  assert.deepEqual(parsearJson("", "filtro"), {});
  assert.deepEqual(parsearJson(undefined, "filtro"), {});
  assert.deepEqual(parsearJson("   ", "filtro"), {});
});

test("acepta la notación del shell: ObjectId y fechas", () => {
  const oid = "6718190465448bf0ae986f6b";
  // Con ObjectId de verdad: el driver necesita la INSTANCIA, no un objeto plano `{$oid}`.
  const filtro = parsearJson(`{ "_id": ObjectId("${oid}") }`, "filtro") as { _id: BSON.ObjectId };
  assert.equal(filtro._id.toHexString(), oid);
  // Se compara serializado: `EJSON.parse` puede devolver objetos con prototipo propio.
  assert.equal(JSON.stringify(parsearJson("{ edad: { $gt: 30 } }", "filtro")), JSON.stringify({ edad: { $gt: 30 } }));
});

test("un filtro que no es objeto se rechaza con el nombre del campo", () => {
  assert.throws(() => parsearJson("[1,2]", "filtro"), /filtro inválido/);
  assert.throws(() => parsearJson('"texto"', "filtro"), /el filtro tiene que ser un objeto/);
});

test("JSON roto: el mensaje dice que el filtro está inválido", () => {
  assert.throws(() => parsearJson("{ edad: ", "filtro"), /filtro inválido/);
});

test("el orden acepta objeto y lista de pares, y normaliza la dirección", () => {
  assert.deepEqual(parsearOrden("{ edad: -1 }"), [["edad", -1]]);
  assert.deepEqual(parsearOrden("{ a: 1, b: -1 }"), [
    ["a", 1],
    ["b", -1],
  ]);
  assert.deepEqual(parsearOrden('[["a", -1]]'), [["a", -1]]);
  // Cualquier cosa que no sea -1 ordena ascendente: es lo que hace el shell de Mongo.
  assert.deepEqual(parsearOrden('{ a: 2 }'), [["a", 1]]);
  assert.equal(parsearOrden(""), null);
});

test("aEjson conserva ObjectId y Date en vez de perderlos en el IPC", () => {
  const oid = new BSON.ObjectId("6718190465448bf0ae986f6b");
  const fecha = new Date(Date.UTC(2024, 9, 22));
  const plano = aEjson({ _id: oid, cuando: fecha, n: 1, anidado: { x: [1, 2] } });
  assert.deepEqual(plano._id, { $oid: "6718190465448bf0ae986f6b" });
  assert.deepEqual(plano.cuando, { $date: "2024-10-22T00:00:00Z" });
  assert.equal(plano.n, 1);
  assert.deepEqual(plano.anidado, { x: [1, 2] });
  // Y sobrevive a la clonación que hace el IPC (structured clone): nada de clases de BSON.
  assert.deepEqual(structuredClone(plano), plano);
});

test("solo lectura rechaza la escritura ANTES de conectar", async () => {
  const { MongodbDriver } = await import("./mongodb");
  const d = new MongodbDriver({
    id: "x",
    name: "Mongo",
    type: "mongodb",
    host: "127.0.0.1",
    port: 1,
    user: "",
    password: "",
    database: "sonda",
    readOnly: true,
  });
  await assert.rejects(
    () => d.updateDocument("ventas", { $oid: "6718190465448bf0ae986f6b" }, { cliente: "X" }),
    /solo lectura/
  );
});

test("no se puede cambiar el _id ni guardar una lista vacía", async () => {
  const { MongodbDriver } = await import("./mongodb");
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
  await assert.rejects(
    () => d.updateDocument("ventas", { $oid: "6718190465448bf0ae986f6b" }, { _id: 1 }),
    /_id no se puede modificar/
  );
  await assert.rejects(
    () => d.updateDocument("ventas", { $oid: "6718190465448bf0ae986f6b" }, {}),
    /No hay cambios/
  );
});
