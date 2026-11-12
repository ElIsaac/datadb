import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSqlDiagnostics } from "@/lib/sql-lint";
import type { SchemaNode } from "@/lib/types";

/**
 * Regresión del hueco que destapó el editor propio: una sentencia con un comentario DELANTE no se
 * inspeccionaba (`-- nota` + `select c.nombr …` daba cero diagnósticos). El comentario es lo normal
 * en SQL, así que el hueco se arregla en el divisor de sentencias.
 */

const ESQUEMA: SchemaNode[] = [
  {
    name: "public",
    routines: [],
    triggers: [],
    tables: [
      {
        name: "clientes",
        type: "table",
        columns: [
          { name: "id", type: "int4", isPrimaryKey: true, nullable: false },
          { name: "nombre", type: "text", isPrimaryKey: false, nullable: false },
        ],
      },
    ],
  },
];

test("una columna desconocida se marca aunque la sentencia lleve un comentario delante", () => {
  const sql = "-- nota\nselect c.nombr from clientes c;";
  const diags = buildSqlDiagnostics(sql, ESQUEMA, "public");
  assert.equal(diags.length, 1);
  // El offset tiene que caer sobre `nombr` EN EL DOCUMENTO ORIGINAL, no sobre el texto recortado.
  assert.equal(sql.slice(diags[0].from, diags[0].to), "nombr");
  assert.equal(diags[0].suggestion, "nombre");
});

test("también con un comentario de bloque delante", () => {
  const sql = "/* nota\nlarga */\nselect c.nombr from clientes c;";
  const diags = buildSqlDiagnostics(sql, ESQUEMA, "public");
  assert.equal(diags.length, 1);
  assert.equal(sql.slice(diags[0].from, diags[0].to), "nombr");
});

test("una sentencia que es solo un comentario no produce nada", () => {
  assert.deepEqual(buildSqlDiagnostics("-- solo un comentario\n", ESQUEMA, "public"), []);
});
