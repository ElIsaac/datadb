/**
 * Autocompletado: dónde está el cursor, qué se ofrece ahí y cómo queda el texto al aceptar.
 * Se prueba por casos de uso reales (escribir una clave, un operador, un valor), no por funciones
 * sueltas: lo que importa es que lo que sale en la lista sea lo que se puede escribir en esa posición.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicarCandidato, candidatosEn, contextoEn } from "./mongo-completion";

const CAMPOS = ["_id", "cliente", "total", "activo", "detalle.pais", "detalle.folio", "creado"];

/** Simula teclear `texto` dejando el cursor al final. */
const ctx = (texto: string) => contextoEn(texto, texto.length);

test("al empezar una clave se ofrecen los campos de la colección", () => {
  const c = ctx("{ cli");
  assert.equal(c.tipo, "clave");
  assert.equal(c.prefijo, "cli");
  const nombres = candidatosEn(c, CAMPOS).map((x) => x.etiqueta);
  assert.deepEqual(nombres.slice(0, 2), ["cliente"]);
  assert.equal(nombres.includes("total"), false, "no se ofrecen campos que no encajan con lo escrito");
});

test("al empezar la clave vacía se ofrecen todos, y los anidados se insertan entre comillas", () => {
  const lista = candidatosEn(ctx("{ "), CAMPOS);
  assert.equal(lista.length, CAMPOS.length, "sin prefijo se ofrecen todos los campos");
  const anidado = lista.find((x) => x.etiqueta === "detalle.pais");
  assert.ok(anidado);
  assert.equal(anidado?.insercion, '"detalle.pais"', "una ruta con punto necesita comillas");
});

test("después de los dos puntos se ofrecen valores, y al escribir $ solo operadores", () => {
  const valores = candidatosEn(ctx("{ cliente: "), CAMPOS);
  assert.ok(valores.some((v) => v.etiqueta === '"texto"'));
  assert.ok(valores.some((v) => v.etiqueta === "null"));

  const ops = candidatosEn(ctx("{ total: { $g"), CAMPOS);
  assert.ok(ops.some((o) => o.etiqueta === "$gt"));
  assert.ok(ops.some((o) => o.etiqueta === "$gte"));
  assert.ok(!ops.some((o) => o.etiqueta === '"texto"'), "con $ no se ofrecen literales");
});

test("cada operador dice qué hace, y los que tienen equivalente en SQL lo muestran", () => {
  const ops = candidatosEn(ctx("{ nombre: { "), CAMPOS).filter((o) => o.tipo === "operador");
  const regex = ops.find((o) => o.etiqueta === "$regex");
  assert.ok(regex);
  assert.match(regex?.detalle ?? "", /LIKE/);
  assert.equal(regex?.sql, "LIKE");
  const gt = ops.find((o) => o.etiqueta === "$gt");
  assert.equal(gt?.sql, ">");
});

test("fuera de una llave no se sugiere nada (no es una consulta)", () => {
  assert.equal(ctx("hola").tipo, "ninguno");
});

test("aceptar reemplaza la palabra en curso y deja el cursor después", () => {
  const texto = "{ cli";
  const r = aplicarCandidato(texto, texto.length, 2, "cliente");
  assert.equal(r.texto, "{ cliente");
  assert.equal(r.cursor, 9);
});

test("aceptar un constructor deja el cursor DENTRO de las comillas", () => {
  const texto = "{ _id: Obj";
  const r = aplicarCandidato(texto, texto.length, 7, 'ObjectId("")');
  assert.equal(r.texto, '{ _id: ObjectId("")');
  assert.equal(r.texto.indexOf('""') + 1, r.cursor, "el cursor queda entre las comillas del constructor");
  assert.deepEqual(r.hueco, { inicio: r.cursor, fin: r.cursor });
});

test("aceptar a mitad de la consulta no se come lo que va después del cursor", () => {
  const texto = "{ cli, total: 1 }";
  const r = aplicarCandidato(texto, 5, 2, "cliente");
  assert.equal(r.texto, "{ cliente, total: 1 }");
});
