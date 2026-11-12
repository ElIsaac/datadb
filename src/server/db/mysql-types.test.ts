import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mysqlTipoDeCampo, mysqlTypeName } from "./mysql-types";
import { getColumnKind } from "@/lib/column-kind";

/**
 * Igual que en `pg-types.test.ts`: lo que se comprueba no es el diccionario, sino que el nombre que
 * sale sea uno que `getColumnKind()` sepa clasificar. Son las dos mitades de la misma cadena.
 */
describe("mysqlTypeName", () => {
  test("traduce los códigos del protocolo a nombres que getColumnKind clasifica bien", () => {
    const esperado: Array<[number, string, string]> = [
      [1, "tinyint", "number"],
      [2, "smallint", "number"],
      [3, "int", "number"],
      [8, "bigint", "number"],
      [9, "mediumint", "number"],
      [4, "float", "number"],
      [5, "double", "number"],
      [246, "decimal", "number"],
      [10, "date", "date"],
      [11, "time", "time"],
      [12, "datetime", "datetime"],
      [7, "timestamp", "datetime"],
      [15, "varchar", "text"],
      [253, "varchar", "text"],
      [254, "char", "text"],
      [245, "json", "text"],
    ];
    for (const [codigo, nombre, kind] of esperado) {
      assert.equal(mysqlTypeName(codigo), nombre, `el código ${codigo} debería llamarse ${nombre}`);
      assert.equal(
        getColumnKind(nombre),
        kind,
        `"${nombre}" debería clasificarse como ${kind} (si no, la celda abre el editor equivocado)`
      );
    }
  });

  test("los nombres coinciden con los de information_schema, que es el otro camino", () => {
    // La vista de tabla saca los tipos de `information_schema.columns.data_type`. Si el resultado
    // de consulta dijera "int4" y el esquema "int", la misma columna abriría editores distintos
    // según de dónde viniera.
    assert.equal(mysqlTypeName(3), "int");
    assert.equal(mysqlTypeName(12), "datetime");
    assert.equal(mysqlTypeName(246), "decimal");
  });

  test("un código desconocido devuelve el número, que es lo que se hacía antes", () => {
    assert.equal(mysqlTypeName(9999), "9999");
  });

  test("sin código devuelve cadena vacía, no 'undefined'", () => {
    assert.equal(mysqlTypeName(undefined), "");
    assert.equal(mysqlTypeName(null), "");
  });
});

describe("mysqlTipoDeCampo (R98)", () => {
  test("TINYINT(1) y BIT(1) llegan como booleanos; los demás anchos no", () => {
    assert.equal(mysqlTipoDeCampo({ type: 1, columnLength: 1 }), "tinyint(1)");
    assert.equal(getColumnKind("tinyint(1)"), "boolean");
    assert.equal(mysqlTipoDeCampo({ type: 1, columnLength: 4 }), "tinyint");
    assert.equal(getColumnKind("tinyint"), "number");
    assert.equal(mysqlTipoDeCampo({ type: 16, columnLength: 1 }), "bit");
    assert.equal(getColumnKind("bit"), "boolean");
    assert.equal(mysqlTipoDeCampo({ type: 16, columnLength: 8 }), "bit(8)");
    assert.equal(getColumnKind("bit(8)"), "text");
    assert.equal(mysqlTipoDeCampo({ type: 3, columnLength: 1 }), "int");
  });
});
