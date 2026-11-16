import type { SchemaNode, TableMeta, ColumnMeta } from "@/lib/types";
import type { AiDialect } from "./prompts";

export interface SchemaContextOptions {
  budgetChars: number;
  focusTables?: { schema?: string; table: string }[];
  dialect: AiDialect;
}

function tableKey(schema: string, table: string): string {
  return `${schema}.${table}`;
}

function findTable(
  schema: SchemaNode[],
  ref: { schema?: string; table: string }
): { node: SchemaNode; table: TableMeta } | null {
  for (const node of schema) {
    if (ref.schema && node.name !== ref.schema) continue;
    const table = node.tables.find((t) => t.name === ref.table);
    if (table) return { node, table };
  }
  return null;
}

function reachableTables(
  schema: SchemaNode[],
  seeds: { schema?: string; table: string }[]
): Set<string> {
  const reached = new Set<string>();
  for (const seed of seeds) {
    const found = findTable(schema, seed);
    if (!found) continue;
    reached.add(tableKey(found.node.name, found.table.name));
  }
  // Expandir por FK a un salto desde las semillas.
  for (const seed of seeds) {
    const found = findTable(schema, seed);
    if (!found) continue;
    for (const col of found.table.columns) {
      if (!col.fk) continue;
      const target = findTable(schema, {
        schema: col.fk.schema,
        table: col.fk.table,
      });
      if (target) {
        reached.add(tableKey(target.node.name, target.table.name));
      }
    }
  }
  return reached;
}

function tableScore(
  node: SchemaNode,
  table: TableMeta,
  focusSet: Set<string>,
  reachableSet: Set<string>
): number {
  const key = tableKey(node.name, table.name);
  if (focusSet.has(key)) return 3;
  if (reachableSet.has(key)) return 2;
  return 1;
}

function formatColumn(col: ColumnMeta): string {
  const parts: string[] = [col.name, col.type];
  if (col.isPrimaryKey) parts.push("PK");
  if (!col.nullable) parts.push("NOT NULL");
  if (col.fk) {
    parts.push(`-> ${col.fk.schema}.${col.fk.table}.${col.fk.column}`);
  }
  return `  ${parts.join(" ")}`;
}

function formatTable(node: SchemaNode, table: TableMeta): string {
  const lines: string[] = [`${node.name}.${table.name} (${table.type})`];
  for (const col of table.columns) {
    lines.push(formatColumn(col));
  }
  return lines.join("\n");
}

export function buildSchemaContext(
  schema: SchemaNode[],
  opts: SchemaContextOptions
): string {
  const { budgetChars, focusTables = [], dialect } = opts;
  const focusSet = new Set(
    focusTables.map((t) => tableKey(t.schema ?? "public", t.table))
  );
  const reachableSet = reachableTables(schema, focusTables);

  const entries: { key: string; score: number; text: string }[] = [];
  for (const node of schema) {
    for (const table of node.tables) {
      entries.push({
        key: tableKey(node.name, table.name),
        score: tableScore(node, table, focusSet, reachableSet),
        text: formatTable(node, table),
      });
    }
  }

  entries.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.key.localeCompare(b.key);
  });

  const inventoryLines = [
    `-- Dialect: ${dialect}`,
    `-- Tables: ${schema.reduce((acc, n) => acc + n.tables.length, 0)}`,
    ...schema.map(
      (n) => `-- ${n.name}: ${n.tables.map((t) => t.name).join(", ")}`
    ),
  ];

  let used = inventoryLines.join("\n").length;
  const detailLines: string[] = [];

  for (const entry of entries) {
    const extra = entry.text.length + 1;
    if (used + extra > budgetChars) {
      detailLines.push(
        `-- Context truncated: ${entries.length - detailLines.length} tables not detailed.`
      );
      break;
    }
    detailLines.push(entry.text);
    used += extra;
  }

  return [...inventoryLines, "", ...detailLines].join("\n");
}
