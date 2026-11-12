import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ANCHO_MAXIMO, ANCHO_MINIMO, claveDeAnchos, sanearAnchos } from "./grid-widths";

/**
 * R99-A: anchos de columna de la rejilla de resultados, recordados por perfil/tabla (o por la firma
 * de columnas de la consulta) en `datadb-grid-widths-v1`.
 *
 * Aquí se fija lo que puede romperse en silencio: la LECTURA tolerante de lo guardado (un JSON
 * editado a mano, una versión futura, basura cualquiera no debe tumbar la rejilla ni colar anchos
 * imposibles) y la forma de la clave, de la que depende que un ancho arrastrado en `acme.Banks_Bank`
 * no se le cuelgue a otra tabla ni a otro perfil.
 *
 * La persistencia de verdad (sobrevivir a reabrir la ventana) se mide en la app; el hook que la
 * conecta con React sigue el mismo esquelero de `data-settings.ts`, que ya está probado a mano.
 */

describe("sanearAnchos: lectura tolerante del JSON guardado", () => {
  test("null, basura y valores no numéricos → objeto vacío", () => {
    assert.deepEqual(sanearAnchos(null), {});
    assert.deepEqual(sanearAnchos("basura"), {});
    assert.deepEqual(sanearAnchos({ a: "x" }), {});
  });

  test("redondea, acota a [ANCHO_MINIMO, ANCHO_MAXIMO] y descarta lo inservible", () => {
    assert.deepEqual(
      sanearAnchos({ a: 120.4, b: 10, c: 99999, d: NaN, "": 50 }),
      { a: 120, b: ANCHO_MINIMO, c: ANCHO_MAXIMO }
    );
    assert.equal(ANCHO_MINIMO, 40);
    assert.equal(ANCHO_MAXIMO, 2000);
  });

  test("Infinity y arrays no cuelan (array es objeto, pero sus valores no son números)", () => {
    assert.deepEqual(sanearAnchos({ a: Number.POSITIVE_INFINITY, b: Number.NEGATIVE_INFINITY }), {});
    assert.deepEqual(sanearAnchos(["x", 42]), {});
  });

  test("un ancho ya sano se respeta tal cual", () => {
    assert.deepEqual(sanearAnchos({ id: 180, nombre: 250 }), { id: 180, nombre: 250 });
  });
});

describe("claveDeAnchos: un ancho por perfil+tabla, o por firma de columnas", () => {
  test("con tabla → `tabla:<perfil>:<esquema>.<tabla>`, todo en minúsculas", () => {
    assert.equal(
      claveDeAnchos({ profileId: "P1", schema: "acme", table: "Banks_Bank", firma: "x" }),
      "tabla:p1:acme.banks_bank"
    );
  });

  test("sin tabla → `consulta:<firma>` (la firma de columnas de la consulta)", () => {
    assert.equal(claveDeAnchos({ profileId: null, firma: "id|nombre" }), "consulta:id|nombre");
  });

  test("la clave es determinista: da igual cómo llegue el caso en las letras", () => {
    assert.equal(
      claveDeAnchos({ profileId: "p1", schema: "Acme", table: "banks_bank", firma: "x" }),
      claveDeAnchos({ profileId: "P1", schema: "acme", table: "BANKS_BANK", firma: "x" })
    );
  });
});
