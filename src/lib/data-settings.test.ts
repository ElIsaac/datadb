import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MAX_ROWS, MAX_ROWS_CEILING } from "@/shared/limits";
import {
  FORMATO_DE_COPIA_POR_DEFECTO,
  getDataSettings,
  parsearAjustes,
  setFormatoDeCopia,
  setMaxRows,
} from "./data-settings";

/**
 * Preferencias de datos (fase 14, T6): la clave `formatoDeCopia` del store
 * `datadb-data-settings-v1`.
 *
 * Lo que se fija aquí es la **lectura tolerante** —el caso que importa es el de un usuario que ya
 * tenía la app abierta antes de esta fase y por tanto tiene un JSON SIN la clave— y que el setter
 * del formato no puede dejar el store en un valor que `copiarComo` no sepa formatear.
 *
 * La persistencia de verdad (sobrevivir a recargar la ventana) se mide en la ventana real con una
 * sonda; aquí se comprueba lo que escribe el setter en el localStorage con un doble.
 */

/** localStorage de mentira: sólo lo que usa el store. */
function localStorageFalso() {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => {
      datos.set(k, v);
    },
  };
}

describe("parsearAjustes: lectura tolerante (T6)", () => {
  test("sin nada guardado → los ajustes por defecto, con TSV", () => {
    assert.deepEqual(parsearAjustes(null), {
      maxRows: DEFAULT_MAX_ROWS,
      formatoDeCopia: FORMATO_DE_COPIA_POR_DEFECTO,
    });
    assert.equal(FORMATO_DE_COPIA_POR_DEFECTO, "tsv");
  });

  test("la clave AUSENTE (usuario anterior a esta fase) → TSV", () => {
    // Éste es el caso real: `{"maxRows":500}` es lo que hay guardado hoy en la app de cualquiera.
    assert.deepEqual(parsearAjustes('{"maxRows":500}'), {
      maxRows: 500,
      formatoDeCopia: "tsv",
    });
  });

  test("un formato desconocido → TSV (no se propaga al formateador)", () => {
    for (const basura of ['"klingon"', "42", "null", "{}", '["json"]']) {
      assert.equal(
        parsearAjustes(`{"formatoDeCopia":${basura}}`).formatoDeCopia,
        "tsv",
        `formatoDeCopia=${basura}`
      );
    }
  });

  test("un formato VÁLIDO se respeta", () => {
    for (const formato of ["csv", "insert", "json", "markdown"] as const) {
      assert.equal(parsearAjustes(`{"formatoDeCopia":"${formato}"}`).formatoDeCopia, formato);
    }
  });

  test("JSON corrupto → ajustes por defecto (y no revienta)", () => {
    assert.deepEqual(parsearAjustes("{no es json"), {
      maxRows: DEFAULT_MAX_ROWS,
      formatoDeCopia: "tsv",
    });
  });

  test("`maxRows` se sigue acotando, y no arrastra al formato", () => {
    const alto = parsearAjustes(
      `{"maxRows":${MAX_ROWS_CEILING + 1},"formatoDeCopia":"markdown"}`
    );
    assert.equal(alto.maxRows, MAX_ROWS_CEILING);
    assert.equal(alto.formatoDeCopia, "markdown");
  });
});

describe("setFormatoDeCopia: cambia, persiste y avisa", () => {
  const original = globalThis.window;
  let falso: ReturnType<typeof localStorageFalso>;

  beforeEach(() => {
    falso = localStorageFalso();
    // El módulo lee `window.localStorage` al LLAMAR (no al cargarse), así que basta con doblarlo
    // aquí. Sin `window` el setter también funciona: el `try` de `persistir` se traga el error.
    (globalThis as unknown as { window: unknown }).window = { localStorage: falso };
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = original;
  });

  test("escribe el formato en `datadb-data-settings-v1` y lo devuelve `getDataSettings`", () => {
    setFormatoDeCopia("json");
    assert.equal(getDataSettings().formatoDeCopia, "json");
    const guardado = JSON.parse(falso.datos.get("datadb-data-settings-v1") ?? "{}");
    assert.equal(guardado.formatoDeCopia, "json");
    // El resto de los ajustes no se pierde al cambiar el formato.
    assert.equal(guardado.maxRows, getDataSettings().maxRows);
  });

  test("un valor inválido se IGNORA (el store no queda en un formato sin rama)", () => {
    setFormatoDeCopia("csv");
    setFormatoDeCopia("klingon" as never);
    assert.equal(getDataSettings().formatoDeCopia, "csv");
  });

  test("cambiar el tope de filas no toca el formato activo", () => {
    setFormatoDeCopia("markdown");
    setMaxRows(DEFAULT_MAX_ROWS + 100);
    assert.equal(getDataSettings().formatoDeCopia, "markdown");
    assert.equal(getDataSettings().maxRows, DEFAULT_MAX_ROWS + 100);
  });
});
