import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarExtensiones, opcionesDeArchivo } from "./file-dialog";

test("el panel siempre permite archivos y muestra los ocultos (las claves SSH viven en ~/.ssh)", () => {
  const o = opcionesDeArchivo();
  assert.deepEqual(o.properties, ["openFile", "showHiddenFiles"]);
  assert.equal(o.filters, undefined, "sin extensiones no se filtra: un filtro vacío deja todo en gris");
});

test("las extensiones se aceptan con punto, en mayúsculas y sin duplicados", () => {
  assert.deepEqual(normalizarExtensiones([".PEM", "pem", "crt", ".key"]), ["pem", "crt", "key"]);
});

test("una extensión basura no rompe el filtro: se descarta", () => {
  assert.deepEqual(normalizarExtensiones(["", "   ", "p*m", "una extension larga", 42, null]), []);
});

test("con extensiones hay filtro de archivos Y de todos, en ese orden", () => {
  const o = opcionesDeArchivo("Elegir el certificado de CA", ["pem", "crt"]);
  assert.equal(o.title, "Elegir el certificado de CA");
  assert.deepEqual(o.filters, [
    { name: "Archivos", extensions: ["pem", "crt"] },
    { name: "Todos", extensions: ["*"] },
  ]);
});

test("un título en blanco no se manda: macOS mostraría un título vacío", () => {
  assert.equal(opcionesDeArchivo("   ").title, undefined);
});
