import { test } from "node:test";
import assert from "node:assert/strict";
import { schemaSuggestions } from "@/lib/editor-suggest";
import type { SchemaNode } from "@/lib/types";

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
      {
        name: "pedidos",
        type: "table",
        columns: [
          { name: "id", type: "int4", isPrimaryKey: true, nullable: false },
          { name: "fecha", type: "date", isPrimaryKey: false, nullable: false },
        ],
      },
    ],
  },
];

test("sin esquema quedan las palabras clave y las funciones", () => {
  const items = schemaSuggestions(null);
  assert.ok(items.some((i) => i.label === "SELECT" && i.kind === "keyword"));
  assert.ok(items.some((i) => i.label === "count" || i.label === "COUNT"));
  assert.ok(!items.some((i) => i.kind === "table"));
});

test("con esquema entran tablas, columnas y nombres cualificados", () => {
  const items = schemaSuggestions(ESQUEMA);
  assert.ok(items.some((i) => i.label === "clientes" && i.kind === "table"));
  assert.ok(items.some((i) => i.label === "public.clientes" && i.kind === "table"));
  assert.ok(items.some((i) => i.label === "fecha" && i.kind === "column"));
  assert.ok(items.some((i) => i.label === "pedidos.fecha" && i.kind === "column"));
});

test("no se repiten etiquetas (id está en dos tablas)", () => {
  const items = schemaSuggestions(ESQUEMA);
  const ids = items.filter((i) => i.label === "id");
  assert.equal(ids.length, 1);
});
