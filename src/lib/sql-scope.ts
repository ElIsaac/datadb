import type { SchemaNode, TableMeta, ColumnMeta } from "@/lib/types";

export interface ScopeTable {
  schema?: string;
  table: string;
  alias?: string;
}

export interface ScopeColumn {
  schema?: string;
  table: string;
  alias?: string;
  column: ColumnMeta;
}

export interface JoinSuggestion {
  label: string;
  detail: string;
  apply: string;
}

function normalizeId(value: string): string {
  return value.replace(/^["'`[]|["'`\]]$/g, "").toLowerCase();
}

function splitIgnoringQuotes(text: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuote: string | null = null;
  let depth = 0;

  for (const ch of text) {
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      current += ch;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      inQuote = ch;
      current += ch;
    } else if (ch === "(") {
      depth++;
      current += ch;
    } else if (ch === ")") {
      depth--;
      current += ch;
    } else if (ch === delimiter && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function parseTableExpression(expression: string): ScopeTable | null {
  let expr = expression.trim();
  if (!expr || expr.startsWith("(")) return null;

  // Ignorar cualquier cláusula que venga después de la referencia a tabla.
  const stopRe =
    /\b(WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|OFFSET|UNION|INTERSECT|EXCEPT|JOIN|LEFT|RIGHT|FULL|INNER|OUTER|CROSS|ON|USING)\b/i;
  const stopMatch = stopRe.exec(expr);
  if (stopMatch) {
    expr = expr.slice(0, stopMatch.index).trim();
  }

  const cleaned = expr.replace(/\bAS\b/gi, " ");
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;

  const tableRef = normalizeId(parts[0]);
  const alias = parts[1] ? normalizeId(parts[1]) : undefined;

  const [schema, table] = tableRef.includes(".")
    ? tableRef.split(".")
    : [undefined, tableRef];

  if (!table) return null;
  return { schema, table, alias };
}

export function extractScopeTables(statement: string): ScopeTable[] {
  const tables: ScopeTable[] = [];
  const normalized = statement.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, " ");

  const joinRe =
    /\b(?:LEFT\s+|RIGHT\s+|FULL\s+|INNER\s+|OUTER\s+|CROSS\s+)?JOIN\s+([\s\S]+?)(?=\bON\b|\bUSING\b|\bWHERE\b|\bGROUP\s+BY\b|\bHAVING\b|\bORDER\s+BY\b|\bLIMIT\b|\bOFFSET\b|\bUNION\b|\bINTERSECT\b|\bEXCEPT\b|\bWINDOW\b|$)/gi;

  for (const match of normalized.matchAll(joinRe)) {
    const parsed = parseTableExpression(match[1]);
    if (parsed) tables.push(parsed);
  }

  const fromRe =
    /\bFROM\s+([\s\S]+?)(?=\bJOIN\b|\bLEFT\b|\bRIGHT\b|\bFULL\b|\bINNER\b|\bOUTER\b|\bCROSS\b|\bWHERE\b|\bGROUP\s+BY\b|\bHAVING\b|\bORDER\s+BY\b|\bLIMIT\b|\bOFFSET\b|\bUNION\b|\bINTERSECT\b|\bEXCEPT\b|\bWINDOW\b|$)/gi;

  for (const match of normalized.matchAll(fromRe)) {
    const items = splitIgnoringQuotes(match[1], ",");
    for (const item of items) {
      const parsed = parseTableExpression(item);
      if (parsed) tables.push(parsed);
    }
  }

  return tables;
}

export function resolveTableInSchema(
  schemaNodes: SchemaNode[],
  tableName: string,
  schemaName?: string,
  defaultSchema?: string
): { schema: string; table: TableMeta } | null {
  const target = normalizeId(tableName);

  if (schemaName) {
    for (const node of schemaNodes) {
      if (normalizeId(node.name) !== normalizeId(schemaName)) continue;
      const table = node.tables.find((t) => normalizeId(t.name) === target);
      if (table) return { schema: node.name, table };
    }
    return null;
  }

  if (defaultSchema) {
    const defaultNode = schemaNodes.find(
      (n) => normalizeId(n.name) === normalizeId(defaultSchema)
    );
    if (defaultNode) {
      const table = defaultNode.tables.find((t) => normalizeId(t.name) === target);
      if (table) return { schema: defaultNode.name, table };
    }
  }

  for (const node of schemaNodes) {
    const table = node.tables.find((t) => normalizeId(t.name) === target);
    if (table) return { schema: node.name, table };
  }
  return null;
}

export function resolveAlias(
  aliasOrTable: string,
  scopeTables: ScopeTable[],
  schemaNodes: SchemaNode[],
  defaultSchema?: string
): { schema: string; table: TableMeta; alias?: string } | null {
  const key = normalizeId(aliasOrTable);
  const scope = scopeTables.find(
    (s) => normalizeId(s.alias ?? s.table) === key
  );
  if (!scope) return null;
  const resolved = resolveTableInSchema(
    schemaNodes,
    scope.table,
    scope.schema,
    defaultSchema
  );
  if (!resolved) return null;
  return { ...resolved, alias: scope.alias };
}

export function buildScopeColumns(
  scopeTables: ScopeTable[],
  schemaNodes: SchemaNode[],
  defaultSchema?: string
): ScopeColumn[] {
  const columns: ScopeColumn[] = [];
  for (const st of scopeTables) {
    const resolved = resolveTableInSchema(
      schemaNodes,
      st.table,
      st.schema,
      defaultSchema
    );
    if (!resolved) continue;
    for (const column of resolved.table.columns) {
      columns.push({
        schema: resolved.schema,
        table: resolved.table.name,
        alias: st.alias,
        column,
      });
    }
  }
  return columns;
}

export function buildJoinSuggestions(
  scopeTables: ScopeTable[],
  schemaNodes: SchemaNode[],
  defaultSchema?: string
): JoinSuggestion[] {
  const suggestions: JoinSuggestion[] = [];
  const seen = new Set<string>();

  for (const st of scopeTables) {
    const resolved = resolveTableInSchema(
      schemaNodes,
      st.table,
      st.schema,
      defaultSchema
    );
    if (!resolved) continue;

    const leftAlias = st.alias ?? resolved.table.name;

    for (const column of resolved.table.columns) {
      if (!column.fk) continue;
      const target = resolveTableInSchema(
        schemaNodes,
        column.fk.table,
        column.fk.schema ?? resolved.schema
      );
      if (!target) continue;

      const label = `JOIN ${target.table.name}`;
      const detail = `on ${leftAlias}.${column.name} = ${target.table.name}.${column.fk.column}`;
      const apply = `JOIN ${target.table.name} ON ${leftAlias}.${column.name} = ${target.table.name}.${column.fk.column}`;
      const key = [resolved.table.name, column.name, target.table.name, column.fk.column]
        .map((p) => p.toLowerCase())
        .join("|");

      if (!seen.has(key)) {
        seen.add(key);
        suggestions.push({ label, detail, apply });
      }
    }

    const pkColumns = resolved.table.columns.filter((c) => c.isPrimaryKey);
    if (pkColumns.length === 0) continue;

    for (const node of schemaNodes) {
      for (const t of node.tables) {
        if (
          normalizeId(t.name) === normalizeId(resolved.table.name) &&
          normalizeId(node.name) === normalizeId(resolved.schema)
        ) {
          continue;
        }

        for (const column of t.columns) {
          if (!column.fk) continue;
          if (
            normalizeId(column.fk.table) === normalizeId(resolved.table.name) &&
            normalizeId(column.fk.schema ?? node.name) === normalizeId(resolved.schema)
          ) {
            const label = `JOIN ${t.name}`;
            const detail = `on ${t.name}.${column.name} = ${leftAlias}.${column.fk.column}`;
            const apply = `JOIN ${t.name} ON ${t.name}.${column.name} = ${leftAlias}.${column.fk.column}`;
            const key = [t.name, column.name, resolved.table.name, column.fk.column]
              .map((p) => p.toLowerCase())
              .join("|");

            if (!seen.has(key)) {
              seen.add(key);
              suggestions.push({ label, detail, apply });
            }
          }
        }
      }
    }
  }

  return suggestions;
}

export function extractJoinTables(statement: string): ScopeTable[] {
  const tables: ScopeTable[] = [];
  const normalized = statement.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, " ");

  const joinRe =
    /\b(?:LEFT\s+|RIGHT\s+|FULL\s+|INNER\s+|OUTER\s+|CROSS\s+)?JOIN\s+([\s\S]+?)(?=\bON\b|\bUSING\b|\bWHERE\b|\bGROUP\s+BY\b|\bHAVING\b|\bORDER\s+BY\b|\bLIMIT\b|\bOFFSET\b|\bUNION\b|\bINTERSECT\b|\bEXCEPT\b|\bWINDOW\b|$)/gi;

  for (const match of normalized.matchAll(joinRe)) {
    const parsed = parseTableExpression(match[1]);
    if (parsed) tables.push(parsed);
  }

  return tables;
}

export function buildOnSuggestions(
  statement: string,
  schemaNodes: SchemaNode[],
  defaultSchema?: string
): JoinSuggestion[] {
  const scopeTables = extractScopeTables(statement);
  const joinTables = extractJoinTables(statement);
  if (joinTables.length === 0) return [];

  const target = joinTables[joinTables.length - 1];
  const targetResolved = resolveTableInSchema(
    schemaNodes,
    target.table,
    target.schema,
    defaultSchema
  );
  if (!targetResolved) return [];

  const targetAlias = target.alias ?? targetResolved.table.name;
  const suggestions: JoinSuggestion[] = [];
  const seen = new Set<string>();

  function add(label: string) {
    const key = label.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      suggestions.push({ label, detail: "join condition", apply: label });
    }
  }

  // target FK -> previous table PK
  for (const column of targetResolved.table.columns) {
    if (!column.fk) continue;
    const fkTarget = resolveTableInSchema(
      schemaNodes,
      column.fk.table,
      column.fk.schema ?? targetResolved.schema
    );
    if (!fkTarget) continue;

    const prevScope = scopeTables.find(
      (s) =>
        normalizeId(s.table) === normalizeId(fkTarget.table.name) &&
        normalizeId(s.schema ?? fkTarget.schema) === normalizeId(fkTarget.schema)
    );
    if (!prevScope) continue;

    const prevAlias = prevScope.alias ?? fkTarget.table.name;
    add(`${targetAlias}.${column.name} = ${prevAlias}.${column.fk.column}`);
  }

  // previous table FK -> target PK (sin alias, el nombre REAL de la tabla: `prevScope.table` viene
  // en minúsculas de `normalizeId` y en MySQL sobre Linux las mayúsculas cuentan).
  for (const prevScope of scopeTables) {
    if (
      normalizeId(prevScope.table) === normalizeId(target.table) &&
      normalizeId(prevScope.schema ?? targetResolved.schema) ===
        normalizeId(targetResolved.schema)
    ) {
      continue;
    }

    const prevResolved = resolveTableInSchema(
      schemaNodes,
      prevScope.table,
      prevScope.schema,
      defaultSchema
    );
    if (!prevResolved) continue;

    for (const column of prevResolved.table.columns) {
      if (!column.fk) continue;
      const fkTarget = resolveTableInSchema(
        schemaNodes,
        column.fk.table,
        column.fk.schema ?? prevResolved.schema
      );
      if (!fkTarget) continue;
      if (
        normalizeId(fkTarget.table.name) === normalizeId(targetResolved.table.name) &&
        normalizeId(fkTarget.schema) === normalizeId(targetResolved.schema)
      ) {
        const prevAlias = prevScope.alias ?? prevResolved.table.name;
        add(`${prevAlias}.${column.name} = ${targetAlias}.${column.fk.column}`);
      }
    }
  }

  return suggestions;
}
