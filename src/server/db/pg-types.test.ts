import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  pgTypeName,
  OIDS_TEXTO_CRUDO,
  OIDS_TEXTO_CRUDO_ARRAY,
} from "./pg-types";
import { getColumnKind } from "@/lib/column-kind";

/**
 * Los OID que importan son los que cambian de editor en la rejilla. El valor de estos tests no es
 * comprobar un diccionario, sino que la cadena que sale de `pgTypeName()` sea una que
 * `getColumnKind()` sepa clasificar: son las dos mitades de la misma cadena y se rompen por
 * separado con facilidad.
 */
describe("pgTypeName", () => {
  test("traduce los OID a nombres que getColumnKind clasifica bien", () => {
    const esperado: Array<[number, string, string]> = [
      // oid, nombre, kind que debe deducir la rejilla
      [16, "bool", "boolean"],
      [23, "int4", "number"],
      [20, "int8", "number"],
      [1700, "numeric", "number"],
      [700, "float4", "number"],
      [25, "text", "text"],
      [1043, "varchar", "text"],
      [1082, "date", "date"],
      [1083, "time", "time"],
      [1114, "timestamp", "datetime"],
      [1184, "timestamptz", "datetimetz"],
      [3802, "jsonb", "text"],
      [2950, "uuid", "text"],
    ];
    for (const [oid, nombre, kind] of esperado) {
      assert.equal(pgTypeName(oid), nombre, `OID ${oid} debería llamarse ${nombre}`);
      assert.equal(
        getColumnKind(nombre),
        kind,
        `"${nombre}" debería clasificarse como ${kind} (si no, la celda abre el editor equivocado)`
      );
    }
  });

  test("un tipo desconocido devuelve el OID, que es lo que se hacía antes", () => {
    // Enums, dominios y tipos de extensiones tienen OID asignado en tiempo de instalación: no se
    // pueden tabular. Que degrade al número es aceptable; que reviente, no.
    assert.equal(pgTypeName(987654), "987654");
  });

  test("sin OID devuelve cadena vacía, no 'undefined'", () => {
    assert.equal(pgTypeName(undefined), "");
    assert.equal(pgTypeName(null), "");
  });

  test("los arrays conservan el tipo base para que la rejilla no los trate como texto suelto", () => {
    assert.equal(pgTypeName(1007), "int4[]");
    assert.equal(pgTypeName(1115), "timestamp[]");
  });
});

describe("OIDs que se leen como texto crudo", () => {
  test("están los de reloj de pared y NO está timestamptz", () => {
    // date, time, timestamp sin zona y timetz no tienen instante asociado: convertirlos a Date
    // obliga a elegir una zona horaria que el dato no tiene, y eso cambia lo que ve el usuario.
    assert.deepEqual([...OIDS_TEXTO_CRUDO].sort(), [1082, 1083, 1114, 1266]);
    assert.ok(
      !(OIDS_TEXTO_CRUDO as readonly number[]).includes(1184),
      "timestamptz SÍ es un instante real: normalizarlo a UTC no pierde información"
    );
  });

  test("los arrays de esos mismos tipos también", () => {
    assert.deepEqual([...OIDS_TEXTO_CRUDO_ARRAY].sort(), [1115, 1182, 1183]);
  });

  test("cada OID crudo tiene nombre, para que el tipo llegue completo a la rejilla", () => {
    for (const oid of [...OIDS_TEXTO_CRUDO, ...OIDS_TEXTO_CRUDO_ARRAY]) {
      assert.notEqual(pgTypeName(oid), String(oid), `al OID ${oid} le falta el nombre`);
    }
  });
});
