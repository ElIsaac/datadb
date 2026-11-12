import { test } from "node:test";
import assert from "node:assert/strict";
import { alAbrir, alBorrar, alCerrar } from "./auto-pair";

/** Atajo: escribir un carácter con el cursor al final del texto. */
const escribir = (valor: string, c: string) => alAbrir(valor, valor.length, valor.length, c);

test("abrir inserta el par y deja el cursor en MEDIO (lo que pedía el usuario)", () => {
  assert.deepEqual(escribir("", "{"), { valor: "{}", cursor: 1 });
  assert.deepEqual(escribir("", '"'), { valor: '""', cursor: 1 });
  assert.deepEqual(escribir("{ a: ", "{"), { valor: "{ a: {}", cursor: 6 });
  // En medio de un objeto ya abierto: `{}` con el cursor dentro y se teclea `[`
  assert.deepEqual(alAbrir("{}", 1, 1, "["), { valor: "{[]}", cursor: 2 });
});

test("con texto seleccionado se envuelve en vez de añadir un par vacío", () => {
  assert.deepEqual(alAbrir("campo", 0, 5, '"'), { valor: '"campo"', cursor: 7 });
  assert.deepEqual(alAbrir("[1, 2]", 1, 2, "("), { valor: "[(1), 2]", cursor: 4 });
});

test("un cierre que ya está delante no se duplica: el cursor pasa", () => {
  // "{|}" y se teclea "}" → sigue siendo "{}" con el cursor después
  assert.deepEqual(alCerrar("{}", 1, 1, "}"), { valor: "{}", cursor: 2 });
  assert.equal(alCerrar("{}", 1, 1, "]"), null);
  assert.equal(alCerrar("{}", 0, 1, "}"), null, "con selección no se salta nada");
});

test("⌫ entre un par vacío borra los dos", () => {
  assert.deepEqual(alBorrar("{}", 1, 1), { valor: "", cursor: 0 });
  assert.deepEqual(alBorrar('{ "a": "" }', 8, 8), { valor: '{ "a":  }', cursor: 7 });
  // Entre un par con contenido NO se borra el cierre: solo el carácter de la izquierda.
  assert.equal(alBorrar("{a}", 1, 1), null);
  assert.equal(alBorrar("{}", 0, 0), null);
});

test("una comilla pegada a una palabra no auto-cierra (se está cerrando una cadena)", () => {
  assert.equal(escribir("abc", '"'), null);
  // Pero después de dos puntos sí, que es el caso normal de escribir un valor:
  assert.deepEqual(escribir('{ a: ', '"'), { valor: '{ a: ""', cursor: 6 });
});

test("una tecla que no abre ni cierra no la toca la edición", () => {
  assert.equal(escribir("{}", "a"), null);
  assert.equal(escribir("{}", ":"), null);
});
