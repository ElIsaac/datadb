import { test } from "node:test";
import assert from "node:assert/strict";
import { parsearDocumentoJson, plantillaParaDuplicar } from "./mongo-document-json";

test("acepta la sintaxis de Compass (claves sin comillas y ObjectId)", () => {
  const r = parsearDocumentoJson('{ cliente: "ACME", total: 10 }');
  assert.equal(r.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify((r as { documento: object }).documento)), { cliente: "ACME", total: 10 });

  // El parser compartido deja el envoltorio plano; el DRIVER lo rehidrata con EJSON al escribir.
  const conId = parsearDocumentoJson('{ _id: ObjectId("6718190465448bf0ae986f6b") }');
  assert.equal(conId.ok, true);
  assert.deepEqual((conId as unknown as { documento: object }).documento, {
    _id: { $oid: "6718190465448bf0ae986f6b" },
  });
});

test("un texto vacío o un valor que no es objeto se rechaza con motivo", () => {
  assert.equal(parsearDocumentoJson("   ").ok, false);
  const lista = parsearDocumentoJson("[1,2]");
  assert.equal(lista.ok, false);
  assert.match((lista as { error: string }).error, /tiene que ser un objeto/);
  assert.equal(parsearDocumentoJson('{ roto: ').ok, false);
});

test("duplicar quita el _id (y solo eso): el servidor genera uno nuevo", () => {
  const texto = plantillaParaDuplicar({ _id: { $oid: "6718190465448bf0ae986f6b" }, cliente: "ACME", total: 10 });
  const copia = JSON.parse(texto) as Record<string, unknown>;
  assert.equal(copia._id, undefined);
  assert.equal(copia.cliente, "ACME");
  assert.equal(copia.total, 10);
});
