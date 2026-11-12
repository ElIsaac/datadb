import type { SchemaNode } from "@/lib/types";
import {
  extractScopeTables,
  extractJoinTables,
  resolveAlias,
  resolveTableInSchema,
  type ScopeTable,
} from "@/lib/sql-scope";

export type LintSeverity = "error" | "warning" | "info" | "hint";

export interface SqlLintDiagnostic {
  from: number;
  to: number;
  severity: LintSeverity;
  message: string;
  /** Reemplazo sugerido (p.ej. corrección de nombre de tabla/columna con typo). */
  suggestion?: string;
}

interface StatementSpan {
  text: string;
  from: number;
}

/**
 * Quita los comentarios que ABREN una sentencia (`-- …` y `/* … *\/`, uno tras otro) y devuelve el
 * desplazamiento que se comió, para poder anclar los diagnósticos al documento original.
 *
 * POR QUÉ HACE FALTA: `lintStatement` busca tablas y columnas en el texto de la sentencia. Con un
 * comentario delante (`-- nota` + `select c.nombr …`) el detector no veía la sentencia y **la
 * inspección se quedaba muda** — medido con la demo del editor propio: la misma consulta con y sin
 * comentario daba 1 diagnóstico y 0. Escribir comentarios antes del SQL es lo normal, así que el
 * hueco se arregla aquí y no pidiendo que no se comenten las consultas.
 */
function stripLeadingComments(text: string): { text: string; offset: number } {
  let rest = text;
  let offset = 0;
  for (;;) {
    const sinEspacios = rest.replace(/^\s+/, "");
    offset += rest.length - sinEspacios.length;
    rest = sinEspacios;
    if (rest.startsWith("--")) {
      const end = rest.indexOf("\n");
      if (end === -1) return { text: "", offset };
      offset += end + 1;
      rest = rest.slice(end + 1);
      continue;
    }
    if (rest.startsWith("/*")) {
      const end = rest.indexOf("*/");
      if (end === -1) return { text: "", offset };
      offset += end + 2;
      rest = rest.slice(end + 2);
      continue;
    }
    return { text: rest, offset };
  }
}

/**
 * Divide el documento completo en sentencias conservando el offset absoluto
 * de inicio de cada una, para poder anclar diagnósticos en el documento real.
 */
function splitStatementsWithOffsets(text: string): StatementSpan[] {
  const spans: StatementSpan[] = [];
  let inQuote: string | null = null;
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const prev = i > 0 ? text[i - 1] : "";
    if (inQuote) {
      if (ch === inQuote && prev !== "\\") inQuote = null;
    } else if (ch === "'" || ch === '"' || ch === "`") {
      inQuote = ch;
    } else if (ch === ";") {
      const raw = text.slice(start, i);
      const trimmed = raw.trim();
      if (trimmed) {
        const leadingWs = raw.length - raw.trimStart().length;
        const limpio = stripLeadingComments(trimmed);
        if (limpio.text) spans.push({ text: limpio.text, from: start + leadingWs + limpio.offset });
      }
      start = i + 1;
    }
  }

  const rawTail = text.slice(start);
  const tail = rawTail.trim();
  if (tail) {
    const leadingWs = rawTail.length - rawTail.trimStart().length;
    const limpio = stripLeadingComments(tail);
    if (limpio.text) spans.push({ text: limpio.text, from: start + leadingWs + limpio.offset });
  }

  return spans;
}

function normalizeId(value: string): string {
  return value.replace(/^["'`[]|["'\]`]$/g, "").toLowerCase();
}

const IDENT = String.raw`(?:"[^"]+"|` + "`[^`]+`" + String.raw`|\[[^\]]+\]|[A-Za-z_][\w$]*)`;

/**
 * Localiza en el texto de la sentencia cada referencia de tabla en
 * FROM/JOIN junto con su offset, para poder marcar tablas desconocidas.
 */
function findTableReferences(
  statement: string
): { schema?: string; table: string; from: number; to: number }[] {
  const refs: { schema?: string; table: string; from: number; to: number }[] = [];
  const re = new RegExp(
    String.raw`\b(?:FROM|JOIN)\s+(${IDENT}(?:\.${IDENT})?)`,
    "gi"
  );
  let match: RegExpExecArray | null;
  while ((match = re.exec(statement)) !== null) {
    const ref = match[1];
    const refStart = match.index + match[0].length - ref.length;
    const parts = ref.split(".");
    if (parts.length === 2) {
      refs.push({
        schema: normalizeId(parts[0]),
        table: normalizeId(parts[1]),
        from: refStart,
        to: refStart + ref.length,
      });
    } else {
      refs.push({
        table: normalizeId(parts[0]),
        from: refStart,
        to: refStart + ref.length,
      });
    }
  }
  return refs;
}

/**
 * Localiza referencias `alias.columna` en toda la sentencia (fuera de
 * FROM/JOIN) para poder validar la columna contra el esquema resuelto.
 */
function findAliasColumnReferences(
  statement: string
): { alias: string; column: string; columnFrom: number; columnTo: number }[] {
  const refs: { alias: string; column: string; columnFrom: number; columnTo: number }[] = [];
  const re = new RegExp(String.raw`\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\b`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(statement)) !== null) {
    const after = statement.slice(match.index + match[0].length).trimStart();
    // Evitar falsos positivos con llamadas a función tipo schema.func(...)
    if (after.startsWith("(")) continue;
    const columnFrom = match.index + match[0].length - match[2].length;
    refs.push({
      alias: match[1],
      column: match[2],
      columnFrom,
      columnTo: columnFrom + match[2].length,
    });
  }
  return refs;
}

/**
 * Genera diagnósticos de lint para una sentencia SQL única dada su posición
 * absoluta en el documento. Reglas cubiertas (a propósito conservadoras para
 * minimizar falsos positivos, dado que el parseo es basado en regex):
 *  - Tabla/vista referenciada en FROM/JOIN que no existe en el schema.
 *  - Columna referenciada como alias.columna que no existe en la tabla resuelta.
 *  - JOIN cuyo alias/nombre nunca se usa en el resto de la sentencia (hint).
 */
function lintStatement(
  stmt: StatementSpan,
  schema: SchemaNode[],
  defaultSchema?: string
): SqlLintDiagnostic[] {
  const diagnostics: SqlLintDiagnostic[] = [];
  const upper = stmt.text.toUpperCase();

  // Solo tiene sentido resolver contra el schema en sentencias que
  // referencian tablas de forma directa.
  if (!/^\s*(SELECT|WITH|UPDATE|DELETE|INSERT)\b/.test(upper)) {
    return diagnostics;
  }

  const scopeTables = extractScopeTables(stmt.text);
  const tableRefs = findTableReferences(stmt.text);

  for (const ref of tableRefs) {
    const resolved = resolveTableInSchema(schema, ref.table, ref.schema, defaultSchema);
    if (!resolved) {
      const allTableNames = schema.flatMap((n) => n.tables.map((t) => t.name));
      const suggestion = findClosest(ref.table, allTableNames) ?? undefined;
      diagnostics.push({
        from: stmt.from + ref.from,
        to: stmt.from + ref.to,
        severity: "error",
        message: `Tabla desconocida: "${ref.schema ? `${ref.schema}.` : ""}${ref.table}"${suggestion ? ` — ¿quisiste decir "${suggestion}"?` : ""}`,
        suggestion,
      });
    }
  }

  // Solo validar alias.columna cuando la(s) tabla(s) de esa sentencia
  // existen todas en el schema; si alguna tabla ya es desconocida, evitamos
  // duplicar ruido con falsos positivos de columna.
  const allTablesResolved = tableRefs.every(
    (ref) => resolveTableInSchema(schema, ref.table, ref.schema, defaultSchema) !== null
  );

  if (allTablesResolved && tableRefs.length > 0) {
    const aliasRefs = findAliasColumnReferences(stmt.text);
    for (const ref of aliasRefs) {
      const resolved = resolveAlias(ref.alias, scopeTables, schema, defaultSchema);
      if (!resolved) continue; // alias no reconocido: podría ser función/schema, no arriesgar falso positivo
      const hasColumn = resolved.table.columns.some(
        (c) => normalizeId(c.name) === normalizeId(ref.column)
      );
      if (!hasColumn) {
        const suggestion =
          findClosest(ref.column, resolved.table.columns.map((c) => c.name)) ?? undefined;
        diagnostics.push({
          from: stmt.from + ref.columnFrom,
          to: stmt.from + ref.columnTo,
          severity: "error",
          message: `Columna desconocida "${ref.column}" en "${resolved.alias ?? resolved.table.name}" (${resolved.table.name})${suggestion ? ` — ¿quisiste decir "${suggestion}"?` : ""}`,
          suggestion,
        });
      }
    }
  }

  // JOINs sin referencia posterior en la sentencia: hint de "join muerto".
  const joinTables = extractJoinTables(stmt.text);
  if (joinTables.length > 0) {
    for (const st of joinTables) {
      const key = st.alias ?? st.table;
      const ref = tableRefs.find(
        (r) => normalizeId(r.table) === normalizeId(st.table)
      );
      if (!ref) continue;

      const wordRe = new RegExp(`\\b${escapeRegExp(key)}\\b`, "gi");
      let occurrences = 0;
      while (wordRe.exec(stmt.text) !== null) {
        occurrences++;
      }
      // La propia declaración en JOIN ya cuenta como 1 ocurrencia, y la
      // condición ON suele referenciarla al menos una vez más.
      if (occurrences <= 1) {
        diagnostics.push({
          from: stmt.from + ref.from,
          to: stmt.from + ref.to,
          severity: "hint",
          message: `"${key}" se une pero no se referencia en el resto de la consulta`,
        });
      }
    }
  }

  return diagnostics;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[n];
}

/**
 * Busca en `candidates` el nombre más parecido a `target` (distancia de
 * Levenshtein), útil como quick-fix ante un typo de tabla/columna. Solo
 * sugiere si la distancia es razonablemente chica respecto al largo del
 * nombre, para no proponer reemplazos disparatados.
 */
function findClosest(target: string, candidates: string[]): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  const t = target.toLowerCase();
  for (const c of candidates) {
    const dist = levenshtein(t, c.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  if (best === null) return null;
  const maxAllowed = Math.max(1, Math.floor(target.length * 0.4));
  return bestDist > 0 && bestDist <= maxAllowed ? best : null;
}

export function buildSqlDiagnostics(
  fullText: string,
  schema: SchemaNode[] | null,
  defaultSchema?: string
): SqlLintDiagnostic[] {
  if (!schema || schema.length === 0) return [];
  const statements = splitStatementsWithOffsets(fullText);
  const diagnostics: SqlLintDiagnostic[] = [];
  for (const stmt of statements) {
    diagnostics.push(...lintStatement(stmt, schema, defaultSchema));
  }
  return diagnostics;
}

// Re-exportado por conveniencia para quien necesite construir scope tables
// a partir del resultado del lint (p.ej. quick-fixes).
export type { ScopeTable };
