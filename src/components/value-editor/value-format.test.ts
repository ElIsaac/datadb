import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { bytesDeHex, bytesDeTexto, hexDeBytes, presentarValor, tamanoLegible } from "./value-format";

describe("presentarValor", () => {
  test("NULL es NULL, y no se confunde con la cadena vacía", () => {
    // Es la confusión clásica de un grid: una celda vacía puede ser NULL o puede ser ''. El panel
    // tiene que decirlo sin ambigüedad.
    const nulo = presentarValor(null);
    assert.equal(nulo.esNulo, true);
    assert.equal(nulo.descripcion, "NULL");

    const vacia = presentarValor("", "text");
    assert.equal(vacia.esNulo, false);
    assert.equal(vacia.texto, "");
    assert.equal(vacia.bytes, 0);
  });

  test("un objeto del driver se indenta (ahí el texto lo escribimos nosotros)", () => {
    const { texto, lenguaje } = presentarValor({ vip: true, tags: ["a", "b"] }, "jsonb");
    assert.equal(lenguaje, "json");
    assert.ok(texto.includes("\n"), "debe ocupar varias líneas");
    assert.ok(texto.includes('  "vip": true'), "y venir indentado");
  });

  test("una cadena NO se reindenta aunque parezca JSON", () => {
    // Si el panel reindentara el contenido de una columna `text`, el usuario vería algo distinto de
    // lo guardado y, al confirmar, escribiría un cambio que no pidió.
    const crudo = '{"a":1,"b":2}';
    const { texto } = presentarValor(crudo, "text");
    assert.equal(texto, crudo);
  });

  test("una columna json con el valor ya en texto se resalta, pero tampoco se reescribe", () => {
    const crudo = '{"a":1}';
    const r = presentarValor(crudo, "json");
    assert.equal(r.lenguaje, "json", "se resalta");
    assert.equal(r.texto, crudo, "pero el texto es el guardado");
  });

  test("los binarios se ven en hex y NO se editan (D4)", () => {
    const r = presentarValor(new Uint8Array([0xde, 0xad, 0xbe, 0xef]), "bytea");
    assert.equal(r.soloLecturaPorTipo, true);
    assert.equal(r.descripcion, "binario");
    assert.ok(r.texto.startsWith("dead beef"), `hex agrupado, fue: ${r.texto}`);
    assert.equal(r.bytes, 4);
  });

  test("un binario enorme se corta en vez de colgar el panel", () => {
    const r = presentarValor(new Uint8Array(200 * 1024), "bytea");
    assert.ok(r.texto.includes("truncado"), "avisa de que no se muestra entero");
    assert.equal(r.bytes, 200 * 1024, "pero el tamaño informado es el real");
  });

  test("los bytes son UTF-8 reales, no el largo de la cadena", () => {
    // 'ñ' ocupa 2 bytes y '🙂' ocupa 4: informar `length` mentiría sobre lo que pesa en la base.
    assert.equal(bytesDeTexto("ñ"), 2);
    assert.equal(bytesDeTexto("🙂"), 4);
    assert.equal(presentarValor("ñ", "text").bytes, 2);
  });

  test("un tipo binario declarado bloquea la edición aunque llegue como texto", () => {
    assert.equal(presentarValor("\\xdeadbeef", "bytea").soloLecturaPorTipo, true);
    assert.equal(presentarValor("hola", "varchar").soloLecturaPorTipo, false);
  });

  test("el tamaño de un bytea es el del DATO, no el de su texto hexadecimal", () => {
    // Medido en la app: Postgres entrega el bytea como la cadena `\\xdeadbeef…`. Contar caracteres
    // informaba 42 B donde la base tiene 20 — el doble y pico, justo en el dato en el que el
    // tamaño es la única pista de lo que hay dentro.
    const r = presentarValor("\\xdeadbeef0102030405060708090a0b0c0d0e0f10", "bytea");
    assert.equal(r.bytes, 20);
    assert.equal(bytesDeHex("\\xdeadbeef"), 4);
    // Si no tiene forma hexadecimal, se cae a contar el texto en vez de mentir con un 0.
    assert.equal(bytesDeHex("no es hex"), 9);
  });
});

describe("hexDeBytes", () => {
  test("agrupa de dos en dos y salta de línea cada 16 bytes", () => {
    const { texto } = hexDeBytes(new Uint8Array(Array.from({ length: 18 }, (_, i) => i)));
    const lineas = texto.split("\n");
    assert.equal(lineas.length, 2);
    assert.equal(lineas[0].split(" ").length, 8, "16 bytes = 8 grupos de 2");
  });
});

describe("tamanoLegible", () => {
  test("usa la unidad que se lee de un vistazo", () => {
    assert.equal(tamanoLegible(512), "512 B");
    assert.equal(tamanoLegible(51_200), "50,0 KB");
    assert.equal(tamanoLegible(5 * 1024 * 1024), "5,0 MB");
  });
});
