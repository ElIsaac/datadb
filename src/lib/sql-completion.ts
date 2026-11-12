/**
 * Autocompletado de SQL CONSCIENTE DEL CONTEXTO (R89).
 *
 * Antes la consola le daba al popup una lista plana con TODO el esquema —tablas, columnas de todas
 * las tablas y además `tabla.columna`— y el popup solo filtraba por prefijo. El usuario lo reportó
 * (2026-10-21) con tres síntomas: detrás de `FROM` salían columnas, detrás de `SELECT` salían tablas,
 * y las columnas sugeridas eran de tablas que no estaban en la consulta. Este módulo decide QUÉ se
 * propone según DÓNDE está el cursor, como el motor de DataGrip (y como el oráculo de Rust,
 * `~/personal/datadb/crates/datadb-sql/src/sugerencias.rs`, cuya tabla de «posiciones» es la que se
 * replica aquí en versión reducida):
 *
 * | Posición del cursor                         | Qué se propone                                          |
 * |---------------------------------------------|---------------------------------------------------------|
 * | inicio de sentencia                         | palabras que abren sentencia (`SELECT`, `INSERT INTO`…) |
 * | hueco de relación (`FROM │`, `JOIN │`, `INTO │`, `UPDATE │`, `, │` en un FROM) | tablas y vistas (las del esquema por defecto primero) y nombres de esquema. **Ninguna columna** y ninguna relación combinada `tabla ON …`: la condición se pide detrás de `ON` |
 * | detrás de una relación (`FROM t │`)         | palabras clave de la cláusula (`WHERE`, `INNER JOIN`, `AS`…). Si es un `JOIN` (`JOIN t │`) ES el hueco del alias: SOLO `ON`/`USING` |
 * | detrás de `ON` (y de `AND`/`OR` dentro de él) | condiciones de JOIN por FK (`o.cliente_id = c.id`) primero; luego columnas cualificadas de las tablas de la consulta |
 * | proyección, `WHERE`, `GROUP BY`, `ORDER BY`, `SET`, `HAVING`… | **solo** las columnas de las tablas de la consulta, alias, funciones y palabras clave |
 * | detrás de `alias.` / `tabla.`               | solo las columnas de ESA tabla                          |
 * | detrás de `esquema.`                        | las tablas de ese esquema                               |
 * | dentro de una cadena o de un comentario      | nada                                                    |
 *
 * DECISIONES (y su porqué):
 *
 * - **Sin tablas en la consulta, la proyección no ofrece columnas** (`SELECT │` sin `FROM`): ofrecer
 *   las de todas las tablas es exactamente el ruido que el usuario reportó. Se ofrecen palabras clave,
 *   funciones y las tablas (para quien escribe `SELECT tabla.col` sin FROM todavía, `tabla.` sí
 *   resuelve sus columnas aunque no esté en el FROM).
 * - **El alcance sale de la sentencia ENTERA, también lo que hay detrás del cursor**: lo normal es
 *   escribir `SELECT * FROM t` y volver al `*` para cambiarlo por columnas. Para eso se reutiliza
 *   `extractScopeTables` (`sql-scope.ts`), el mismo detector que usan las inspecciones y la IA.
 * - **Las condiciones de JOIN salen de las claves foráneas que ya trae la introspección**
 *   (`ColumnMeta.fk`, MySQL y Postgres), en los dos sentidos: la tabla nueva apunta a una de la
 *   consulta, o una de la consulta apunta a la nueva. Sin FK no se inventa nada por nombre (DataGrip
 *   tampoco lo hace por defecto); queda anotado como hueco para una heurística `x_id → x.id`.
 * - **El alias lo teclea el usuario y el hueco del alias se deja en paz** (R99-B, 2026-10-23):
 *   tras `JOIN` se ofrecen SOLO tablas (nunca la relación combinada `t ON …`), detrás de `JOIN t`
 *   SOLO `ON`/`USING`, y la condición por clave foránea se propone detrás del `ON`, donde ya
 *   respeta los alias escritos (`p.cliente_id = c.id`). El caso real que lo motivó: en
 *   `INNER JOIN banks_bank ban│` (alias de `banks_bank` a medias, contra tienda-db-prod)
 *   el popup clasificaba el hueco como «detrás de la relación» y ofrecía la condición por FK; al
 *   aceptarla, el editor reemplaza la ventana de palabra —justo `ban`— por el texto de la
 *   sugerencia y el SQL quedaba `INNER JOIN banks_bank ON … = banco.id`: alias comido, consulta
 *   rota. Con la regla nueva, ese hueco no ofrece nada con espacios y mientras se teclea el alias
 *   (`ban`) el popup ni aparece (`shouldOpenAfterSpace` exige hueco en blanco o palabra nueva).
 * - **Sin alias automático**: DataGrip genera `clientes c ON …` inventando el alias; aquí el alias
 *   que el usuario escribió es el que manda (ver la regla del hueco del alias, R99-B). La condición
 *   por FK tras `ON` respeta los alias que la consulta YA usa; para tablas sin alias se escribe el
 *   nombre real (`pedidos.cliente_id = clientes.id`).
 * - **Los alias detectados salen en minúsculas** (`sql-scope.ts` normaliza así); las tablas sin alias
 *   se escriben con el nombre REAL del esquema, porque en MySQL sobre Linux las mayúsculas cuentan
 *   (`azteca_aztecaControl_v2`).
 * - El análisis es léxico (tokens + profundidad de paréntesis), no un parser: tolera SQL a medio
 *   escribir, que es el caso normal mientras se completa. Lo que no reconoce cae en la rama «columna»,
 *   que es la más útil por defecto.
 *
 * HUECOS CONOCIDOS: CTE y tablas derivadas no aportan columnas (el oráculo de Rust sí); las
 * subconsultas comparten el alcance de la sentencia entera (no hay ámbitos anidados); `DELIMITER` de
 * MySQL no se interpreta (el `;` siempre separa).
 */
import type { SchemaNode, TableMeta } from "@/lib/types";
import type { Suggestion } from "@/components/own-editor/completion";
import { completionWindow } from "@/components/own-editor/completion";
import {
  buildOnSuggestions,
  extractScopeTables,
  resolveTableInSchema,
  type ScopeTable,
} from "@/lib/sql-scope";

// --- léxico ---------------------------------------------------------------------------------

type TokenKind = "word" | "quoted" | "string" | "number" | "punct" | "op";

interface Token {
  kind: TokenKind;
  text: string;
  /** Mayúsculas, solo para `word`: lo que se compara contra las palabras clave. */
  upper: string;
  from: number;
  to: number;
}

/** Tramos que no son código (cadenas y comentarios): dentro de ellos no se completa nada. */
interface Opaque {
  from: number;
  to: number;
}

const WORD_START = /[\p{L}_$@#]/u;
const WORD_PART = /[\p{L}\p{N}_$@#]/u;

/**
 * Tokeniza el documento. Cadenas `'…'` (con `''` escapado), identificadores entre comillas
 * (`"…"`, `` `…` ``, `[…]`), comentarios `--`/`#` (MySQL) y `/* … *\/`, y cadenas dólar de Postgres
 * (`$$…$$`, `$tag$…$tag$`). Un tramo sin cerrar llega hasta el final: es lo que pasa mientras se
 * escribe, y dentro de él no se debe abrir el popup.
 */
function tokenize(text: string): { tokens: Token[]; opaque: Opaque[] } {
  const tokens: Token[] = [];
  const opaque: Opaque[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    // Comentarios de línea: `--` y, en MySQL, `#`. El `#` también abre identificadores temporales
    // de SQL Server (`#tmp`): solo es comentario si NO va pegado a una letra.
    if ((ch === "-" && text[i + 1] === "-") || (ch === "#" && !WORD_PART.test(text[i + 1] ?? ""))) {
      const end = text.indexOf("\n", i);
      const to = end === -1 ? n : end;
      opaque.push({ from: i, to });
      i = to;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const to = end === -1 ? n : end + 2;
      opaque.push({ from: i, to });
      i = to;
      continue;
    }
    if (ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (text[j] === "'" && text[j + 1] === "'") j += 2;
        else if (text[j] === "\\" && j + 1 < n) j += 2;
        else if (text[j] === "'") break;
        else j++;
      }
      const to = Math.min(n, j + 1);
      opaque.push({ from: i, to });
      tokens.push({ kind: "string", text: text.slice(i, to), upper: "", from: i, to });
      i = to;
      continue;
    }
    if (ch === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(i, i + 40));
      if (tag) {
        const end = text.indexOf(tag[0], i + tag[0].length);
        const to = end === -1 ? n : end + tag[0].length;
        opaque.push({ from: i, to });
        tokens.push({ kind: "string", text: text.slice(i, to), upper: "", from: i, to });
        i = to;
        continue;
      }
    }
    if (ch === '"' || ch === "`" || ch === "[") {
      const close = ch === "[" ? "]" : ch;
      const end = text.indexOf(close, i + 1);
      const to = end === -1 ? n : end + 1;
      // Un identificador entre comillas sin cerrar es «estoy escribiendo un nombre»: NO es opaco.
      tokens.push({ kind: "quoted", text: text.slice(i, to), upper: "", from: i, to });
      i = to;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[0-9.eE]/.test(text[j])) j++;
      tokens.push({ kind: "number", text: text.slice(i, j), upper: "", from: i, to: j });
      i = j;
      continue;
    }
    if (WORD_START.test(ch)) {
      let j = i + 1;
      while (j < n && WORD_PART.test(text[j])) j++;
      const word = text.slice(i, j);
      tokens.push({ kind: "word", text: word, upper: word.toUpperCase(), from: i, to: j });
      i = j;
      continue;
    }
    if ("(),;.".includes(ch)) {
      tokens.push({ kind: "punct", text: ch, upper: ch, from: i, to: i + 1 });
      i++;
      continue;
    }
    tokens.push({ kind: "op", text: ch, upper: ch, from: i, to: i + 1 });
    i++;
  }
  return { tokens, opaque };
}

function unquote(token: Token): string {
  if (token.kind !== "quoted") return token.text;
  const t = token.text;
  const last = t[t.length - 1];
  const closed = (t[0] === "[" && last === "]") || (t.length > 1 && last === t[0]);
  return closed ? t.slice(1, -1) : t.slice(1);
}

const isIdent = (t: Token | undefined) => !!t && (t.kind === "word" || t.kind === "quoted");

// --- contexto -------------------------------------------------------------------------------

export type CompletionContext =
  /** Dentro de una cadena o un comentario: no se propone nada. */
  | { kind: "none" }
  /** Inicio de sentencia. */
  | { kind: "start" }
  /** Hueco donde va una tabla. `clause` dice cuál (FROM, JOIN, INTO, UPDATE, TABLE). */
  | { kind: "relation"; clause: string }
  /** Ya hay una relación escrita y el cursor va detrás (alias o palabra clave siguiente). */
  | { kind: "after-relation"; clause: string }
  /** Condición de un JOIN (`ON │`, `ON a = b AND │`). */
  | { kind: "on" }
  /** Expresión: proyección, WHERE, GROUP/ORDER BY, SET, HAVING… */
  | { kind: "column"; clause: string; afterExpression: boolean }
  /** Lista de columnas de un `INSERT INTO t (│`. */
  | { kind: "insert-columns"; table: ScopeTable }
  /** Detrás de `x.` (y opcionalmente `esquema.tabla.`). */
  | { kind: "qualified"; qualifier: string; schema?: string };

/** Palabras que fijan la cláusula al recorrer hacia atrás. */
const RELATION_KEYWORDS = new Set(["FROM", "JOIN", "INTO", "UPDATE", "TABLE"]);
const COLUMN_KEYWORDS = new Set([
  "SELECT",
  "WHERE",
  "HAVING",
  "BY",
  "SET",
  "VALUES",
  "RETURNING",
  "LIMIT",
  "OFFSET",
  "WHEN",
  "THEN",
  "ELSE",
  "CASE",
]);
/** Calificadores de JOIN: forman parte de «detrás de la relación» mientras se escribe `INNER JOIN`. */
const JOIN_MODIFIERS = new Set(["INNER", "LEFT", "RIGHT", "FULL", "OUTER", "CROSS", "NATURAL", "STRAIGHT_JOIN"]);

export interface StatementSpan {
  tokens: Token[];
  from: number;
  to: number;
}

/** Sentencia que contiene el cursor: los tokens entre el `;` anterior y el siguiente. */
function statementAt(tokens: Token[], offset: number, textLength: number): StatementSpan {
  let start = 0;
  let end = tokens.length;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.text !== ";" || t.kind !== "punct") continue;
    if (t.to <= offset) start = k + 1;
    else {
      end = k;
      break;
    }
  }
  const slice = tokens.slice(start, end);
  const from = start > 0 ? tokens[start - 1].to : 0;
  const to = end < tokens.length ? tokens[end].from : textLength;
  return { tokens: slice, from, to };
}

/**
 * Decide la posición del cursor. `before` son los tokens de la sentencia que terminan ANTES de la
 * palabra que se está completando (la palabra a medias no cuenta: es el prefijo).
 */
function classify(before: Token[]): CompletionContext {
  if (before.length === 0) return { kind: "start" };

  // `x.│` / `esquema.tabla.│`: el punto pegado a la palabra que se completa.
  const last = before[before.length - 1];
  if (last.kind === "punct" && last.text === "." && isIdent(before[before.length - 2])) {
    const qualifierTok = before[before.length - 2];
    const qualifier = unquote(qualifierTok);
    const dot2 = before[before.length - 3];
    const schemaTok = before[before.length - 4];
    if (dot2?.text === "." && dot2.kind === "punct" && isIdent(schemaTok) && schemaTok.to === dot2.from) {
      return { kind: "qualified", qualifier, schema: unquote(schemaTok) };
    }
    return { kind: "qualified", qualifier };
  }

  // Recorrido hacia atrás a la MISMA profundidad de paréntesis que el cursor (lo que está dentro de
  // un paréntesis ya cerrado se salta). Al cruzar un `(` abierto se sube un nivel: `COUNT(│` hereda
  // la cláusula de fuera, y `INSERT INTO t (│` se reconoce por ese cruce.
  let depth = 0;
  let crossedOpenParen = false;
  /** Tokens de la cláusula actual entre la palabra clave y el cursor (en orden inverso). */
  const sinceKeyword: Token[] = [];
  let sawCommaAtLevel = false;
  for (let k = before.length - 1; k >= 0; k--) {
    const t = before[k];
    if (t.kind === "punct" && t.text === ")") {
      depth++;
      if (depth === 1 && !crossedOpenParen) sinceKeyword.push(t);
      continue;
    }
    if (t.kind === "punct" && t.text === "(") {
      if (depth > 0) {
        depth--;
        continue;
      }
      crossedOpenParen = true;
      continue;
    }
    if (depth > 0) continue;

    if (t.kind === "punct" && t.text === ",") {
      if (!crossedOpenParen) sawCommaAtLevel = true;
      sinceKeyword.push(t);
      continue;
    }

    if (t.kind === "word") {
      const kw = t.upper;
      if (RELATION_KEYWORDS.has(kw)) {
        // `TABLE` solo es hueco de relación detrás de CREATE/ALTER/DROP/TRUNCATE (no como columna).
        if (kw === "TABLE") {
          const prev = before[k - 1]?.upper;
          if (!prev || !["CREATE", "ALTER", "DROP", "TRUNCATE", "LOCK", "TEMPORARY", "EXISTS"].includes(prev)) {
            sinceKeyword.push(t);
            continue;
          }
        }
        if (kw === "INTO" && crossedOpenParen) {
          const tableTok = before.slice(k + 1).find((x) => isIdent(x));
          if (tableTok) return { kind: "insert-columns", table: { table: unquote(tableTok) } };
        }
        if (crossedOpenParen) {
          // `FROM (│` → subconsulta: lo que se escribe es una sentencia nueva.
          return sinceKeyword.length === 0 ? { kind: "start" } : { kind: "column", clause: "SELECT", afterExpression: false };
        }
        // Tokens de la relación actual: los que hay detrás de la palabra clave, o detrás de la última
        // coma de un FROM (`FROM a, │`).
        const relTokens: Token[] = [];
        for (let m = sinceKeyword.length - 1; m >= 0; m--) {
          const x = sinceKeyword[m];
          if (x.text === ",") relTokens.length = 0;
          else relTokens.push(x);
        }
        if (relTokens.length === 0) return { kind: "relation", clause: kw };
        // `FROM t INNER │`: el modificador ya cuenta como «detrás de la relación».
        return { kind: "after-relation", clause: kw };
      }
      if (kw === "ON" || kw === "USING") return { kind: "on" };
      if (COLUMN_KEYWORDS.has(kw)) {
        const afterExpression = !crossedOpenParen && !sawCommaAtLevel && endsExpression(sinceKeyword);
        return { kind: "column", clause: kw, afterExpression };
      }
      if (["INSERT", "DELETE", "WITH", "CREATE", "ALTER", "DROP"].includes(kw) && k === 0) {
        return { kind: "start" };
      }
      if (JOIN_MODIFIERS.has(kw)) {
        sinceKeyword.push(t);
        continue;
      }
    }
    sinceKeyword.push(t);
  }
  return { kind: "column", clause: "", afterExpression: endsExpression(sinceKeyword) };
}

/**
 * ¿La cláusula ya tiene una expresión completa justo antes del cursor? (`SELECT id │`, `WHERE a = 1 │`).
 * Entonces lo que se escribe es más probablemente una palabra clave (`FROM`, `AND`, `AS`) que otra
 * columna, y el ranking las sube. `sinceKeyword` viene en orden inverso (el primero es el más cercano).
 */
function endsExpression(sinceKeyword: Token[]): boolean {
  const nearest = sinceKeyword[0];
  if (!nearest) return false;
  if (nearest.kind === "op") return nearest.text === "*" && sinceKeyword.length === 1;
  if (nearest.kind === "punct") return nearest.text === ")";
  if (nearest.kind === "word") {
    return !["AND", "OR", "NOT", "IS", "IN", "LIKE", "ILIKE", "BETWEEN", "AS", "DISTINCT", "ALL"].includes(nearest.upper);
  }
  return true;
}

/** Contexto del cursor (exportado para los tests). */
export function detectCompletionContext(text: string, offset: number): CompletionContext {
  const caret = Math.max(0, Math.min(offset, text.length));
  const { tokens, opaque } = tokenize(text);
  // Dentro de una cadena o un comentario: nada. Con el cursor JUSTO detrás de la comilla de cierre
  // ya se está fuera; al final de un comentario de línea (o de un tramo sin cerrar), todavía dentro.
  if (opaque.some((o) => caret > o.from && (caret < o.to || (caret === o.to && !closesAt(text, o))))) {
    return { kind: "none" };
  }
  const win = completionWindow(text, caret);
  const stmt = statementAt(tokens, caret, text.length);
  // La palabra a medias (la que empieza en `win.from`) no cuenta: es el prefijo que se completa.
  return classify(stmt.tokens.filter((t) => t.to <= win.from));
}

/** ¿El tramo opaco que llega al final del documento está CERRADO? (`'abc'` sí, `'abc` no). */
function closesAt(text: string, o: Opaque): boolean {
  const s = text.slice(o.from, o.to);
  if (s.startsWith("--") || s.startsWith("#")) return false; // comentario de línea abierto
  if (s.startsWith("/*")) return s.length >= 4 && s.endsWith("*/");
  if (s.startsWith("'")) return s.length >= 2 && s.endsWith("'");
  if (s.startsWith("$")) {
    const tag = /^\$[A-Za-z_]*\$/.exec(s);
    return !!tag && s.length >= tag[0].length * 2 && s.endsWith(tag[0]);
  }
  return true;
}

// --- catálogos de palabras ------------------------------------------------------------------

const kw = (labels: string[], group: number): Suggestion[] =>
  labels.map((label) => ({ label, kind: "keyword" as const, group }));

const STATEMENT_START = [
  "SELECT",
  "INSERT INTO",
  "UPDATE",
  "DELETE FROM",
  "WITH",
  "EXPLAIN",
  "CREATE TABLE",
  "ALTER TABLE",
  "DROP TABLE",
  "TRUNCATE TABLE",
  "SHOW",
  "BEGIN",
  "COMMIT",
  "ROLLBACK",
];

const AFTER_FROM = [
  "WHERE",
  "INNER JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "JOIN",
  "CROSS JOIN",
  "FULL JOIN",
  "AS",
  "GROUP BY",
  "ORDER BY",
  "LIMIT",
  "UNION",
  "UNION ALL",
];

const EXPRESSION_KEYWORDS = [
  "DISTINCT",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "NULL",
  "NOT",
  "EXISTS",
  "TRUE",
  "FALSE",
];

const AFTER_EXPRESSION = [
  "FROM",
  "AS",
  "AND",
  "OR",
  "IS NULL",
  "IS NOT NULL",
  "IN",
  "NOT IN",
  "LIKE",
  "BETWEEN",
  "WHERE",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "LIMIT",
  "ASC",
  "DESC",
  "INNER JOIN",
  "LEFT JOIN",
  "UNION",
];

const FUNCTIONS = [
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "COALESCE",
  "NULLIF",
  "CAST",
  "NOW",
  "CURRENT_DATE",
  "UPPER",
  "LOWER",
  "LENGTH",
  "TRIM",
  "CONCAT",
  "SUBSTRING",
  "ROUND",
  "DATE_TRUNC",
  "EXTRACT",
];

const fn = (group: number): Suggestion[] =>
  FUNCTIONS.map((label) => ({ label, kind: "function" as const, detail: "función", group }));

// --- sugerencias ----------------------------------------------------------------------------

export interface CompletionRequest {
  text: string;
  offset: number;
  schema: SchemaNode[] | null | undefined;
  /** Esquema/base de la sesión: sus tablas van primero y resuelve nombres sin cualificar. */
  defaultSchema?: string;
}

/** Grupos de ranking: menor = más arriba (ver `rankSuggestions`). */
const G = {
  join: 0,
  qualified: 0,
  column: 1,
  alias: 2,
  tableDefault: 2,
  tableOther: 3,
  schema: 4,
  function: 5,
  keyword: 6,
  keywordFirst: 0,
} as const;

interface ResolvedScope {
  scope: ScopeTable;
  schema: string;
  table: TableMeta;
  /** Cómo se nombra en el SQL: el alias si lo hay, si no el nombre real de la tabla. */
  ref: string;
}

/**
 * `extractScopeTables` solo mira `FROM`/`JOIN`; en un `UPDATE t SET │` la tabla está detrás de
 * `UPDATE` (y en `INSERT INTO t … SELECT` detrás de `INTO`). Se añaden aquí, sin tocar el detector
 * compartido con las inspecciones (sus diagnósticos dependen de lo que devuelve).
 */
function extraScopeTables(statementText: string): ScopeTable[] {
  const out: ScopeTable[] = [];
  const re = /\b(?:UPDATE|INTO)\s+([`"[]?[\w$.]+[`"\]]?)(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?/gi;
  for (const m of statementText.matchAll(re)) {
    const ref = m[1].replace(/[`"[\]]/g, "");
    const [schemaName, table] = ref.includes(".") ? ref.split(".", 2) : [undefined, ref];
    const alias = m[2] && !/^(SET|VALUES|SELECT|DEFAULT|WHERE)$/i.test(m[2]) ? m[2].toLowerCase() : undefined;
    if (table) out.push({ schema: schemaName, table, alias });
  }
  return out;
}

function resolveScope(statementText: string, schema: SchemaNode[], defaultSchema?: string): ResolvedScope[] {
  const out: ResolvedScope[] = [];
  const seen = new Set<string>();
  for (const st of [...extractScopeTables(statementText), ...extraScopeTables(statementText)]) {
    const resolved = resolveTableInSchema(schema, st.table, st.schema, defaultSchema);
    if (!resolved) continue;
    const ref = st.alias ?? resolved.table.name;
    const key = `${resolved.schema}.${resolved.table.name}.${ref}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ scope: st, schema: resolved.schema, table: resolved.table, ref });
  }
  return out;
}

/** Columnas de las tablas de la consulta. Con varias tablas, las repetidas salen cualificadas. */
function scopeColumns(scope: ResolvedScope[], group: number, qualifyAll = false): Suggestion[] {
  const out: Suggestion[] = [];
  const counts = new Map<string, number>();
  for (const s of scope) for (const c of s.table.columns) counts.set(c.name.toLowerCase(), (counts.get(c.name.toLowerCase()) ?? 0) + 1);
  const multi = scope.length > 1;
  for (const s of scope) {
    for (const c of s.table.columns) {
      const ambiguous = (counts.get(c.name.toLowerCase()) ?? 0) > 1;
      const label = qualifyAll || ambiguous ? `${s.ref}.${c.name}` : c.name;
      out.push({
        label,
        kind: "column",
        detail: multi && !(qualifyAll || ambiguous) ? `${s.ref} · ${c.type}` : c.type,
        group,
      });
    }
  }
  return out;
}

function aliasSuggestions(scope: ResolvedScope[]): Suggestion[] {
  return scope
    .filter((s) => s.scope.alias)
    .map((s) => ({ label: s.ref, kind: "alias" as const, detail: `alias de ${s.table.name}`, group: G.alias }));
}

/** Tablas y vistas: las del esquema por defecto primero; repetidas en otro esquema, cualificadas. */
function tableSuggestions(schema: SchemaNode[], defaultSchema?: string, onlySchema?: string): Suggestion[] {
  const out: Suggestion[] = [];
  const def = defaultSchema?.toLowerCase();
  const seen = new Set<string>();
  const nodes = onlySchema ? schema.filter((n) => n.name.toLowerCase() === onlySchema.toLowerCase()) : schema;
  const ordered = [...nodes].sort((a, b) => Number(b.name.toLowerCase() === def) - Number(a.name.toLowerCase() === def));
  const single = nodes.length === 1;
  for (const node of ordered) {
    const isDefault = single || node.name.toLowerCase() === def;
    for (const t of node.tables) {
      const plain = !seen.has(t.name.toLowerCase());
      const label = plain || onlySchema ? t.name : `${node.name}.${t.name}`;
      seen.add(t.name.toLowerCase());
      out.push({
        label,
        kind: "table",
        detail: t.type === "view" ? `vista · ${node.name}` : node.name,
        group: isDefault ? G.tableDefault : G.tableOther,
      });
    }
  }
  return out;
}

function schemaNameSuggestions(schema: SchemaNode[]): Suggestion[] {
  if (schema.length < 2) return [];
  return schema.map((n) => ({ label: n.name, kind: "schema" as const, detail: "esquema", group: G.schema }));
}

/** Condiciones `ON` por FK entre la última tabla del JOIN y las anteriores. */
function onConditionSuggestions(statementText: string, schema: SchemaNode[], defaultSchema: string | undefined, withOn: boolean): Suggestion[] {
  return buildOnSuggestions(statementText, schema, defaultSchema).map((s) => ({
    label: withOn ? `ON ${s.label}` : s.label,
    kind: "join" as const,
    detail: "relación por clave foránea",
    group: G.join,
  }));
}

/**
 * Lo que el popup recibe. El popup filtra y ordena por prefijo (`rankSuggestions`) respetando el
 * `group` de cada sugerencia, así que aquí solo se decide QUÉ entra y en qué grupo.
 */
export function contextualSuggestions(req: CompletionRequest): Suggestion[] {
  const { text, offset, defaultSchema } = req;
  const schema = req.schema ?? [];
  const ctx = detectCompletionContext(text, offset);
  const caret = Math.max(0, Math.min(offset, text.length));
  const { tokens } = tokenize(text);
  const stmtSpan = statementAt(tokens, caret, text.length);
  const statementText = text.slice(stmtSpan.from, stmtSpan.to);
  const scope = () => resolveScope(statementText, schema, defaultSchema);

  switch (ctx.kind) {
    case "none":
      return [];
    case "start":
      return kw(STATEMENT_START, G.keywordFirst);
    case "qualified": {
      const q = ctx.qualifier.toLowerCase();
      // 1) alias o tabla de la consulta.
      const inScope = scope().find((s) => s.ref.toLowerCase() === q || s.table.name.toLowerCase() === q);
      if (inScope) return columnsOf(inScope.table);
      // 2) esquema → sus tablas.
      if (!ctx.schema && schema.some((n) => n.name.toLowerCase() === q)) {
        return tableSuggestions(schema, defaultSchema, ctx.qualifier);
      }
      // 3) tabla del esquema que aún no está en el FROM (`SELECT clientes.│`).
      const resolved = resolveTableInSchema(schema, ctx.qualifier, ctx.schema, defaultSchema);
      if (resolved) return columnsOf(resolved.table);
      return [];
    }
    case "relation":
      // Hueco de tabla (`FROM │`, `JOIN │`, `INTO │`, `UPDATE │`, `FROM a, │`): SOLO tablas y
      // esquemas. Aquí ya no va la relación por FK (R99-B, 2026-10-23): la fila combinada
      // `clientes ON pedidos.cliente_id = clientes.id` inserta la tabla Y la condición seguidas y
      // no deja hueco entre ambas para que el usuario teclee su alias: al aceptarla, el `ON` ya
      // estaba escrito y el alias no cabía jamás. La relación se ofrece después, detrás del `ON`
      // (`case "on"`), donde las condiciones calculadas ya llevan los alias que el usuario escribió
      // (`p.cliente_id = c.id`), que es justamente el flujo del reporte.
      return [...tableSuggestions(schema, defaultSchema), ...schemaNameSuggestions(schema)];
    case "after-relation": {
      // Detrás de `JOIN t` (o de un modificador `INNER` + palabra nueva) el hueco ES del alias
      // (R99-B, 2026-10-23): aquí se ofrecen SOLO `ON` y `USING`. Ni condiciones por FK con el
      // prefijo `ON ` (`ON p.cliente_id = c.id`) ni el resto de palabras clave del FROM
      // (`AFTER_FROM`, que sigue detrás de `FROM`/`UPDATE`/`INTO`). El motivo exacto: en
      // `INNER JOIN banks_bank ban│` este hueco se clasificaba así (`detectCompletionContext`
      // excluye la palabra a medias, así que aquí llega el hueco igual CON alias tecleado que a
      // medias) y el popup ofrecía la condición por FK; al aceptarla, el editor reemplaza la
      // ventana de palabra —que es el ALIAS, `ban`— por el texto de la sugerencia y el SQL quedaba
      // `INNER JOIN banks_bank ON … = banco.id` (alias comido, mensaje del usuario del 2026-10-23).
      // `ON` y `USING` no llevan espacios: al aceptarlos no puede borrarse nada ya tecleado.
      if (ctx.clause === "JOIN") return kw(["ON", "USING"], G.keywordFirst);
      const out: Suggestion[] = [];
      if (ctx.clause === "UPDATE") out.push(...kw(["SET"], G.keywordFirst));
      if (ctx.clause === "INTO") out.push(...kw(["VALUES", "SELECT"], G.keywordFirst));
      out.push(...kw(AFTER_FROM, G.keywordFirst + 1));
      return out;
    }
    case "on": {
      const sc = scope();
      return [
        ...onConditionSuggestions(statementText, schema, defaultSchema, false),
        ...scopeColumns(sc, G.column, sc.length > 1),
        ...aliasSuggestions(sc),
        ...kw(["AND", "OR", "IS NULL", "IS NOT NULL"], G.keyword),
        ...kw(["WHERE", "INNER JOIN", "LEFT JOIN", "ORDER BY", "GROUP BY"], G.keyword + 1),
      ];
    }
    case "insert-columns": {
      const resolved = resolveTableInSchema(schema, ctx.table.table, ctx.table.schema, defaultSchema);
      return resolved ? columnsOf(resolved.table) : [];
    }
    case "column": {
      const sc = scope();
      const out: Suggestion[] = [];
      // Con una expresión completa delante (`SELECT id │`) va antes la palabra clave que sigue.
      if (ctx.afterExpression) out.push(...kw(AFTER_EXPRESSION, G.keywordFirst));
      out.push(...scopeColumns(sc, G.column), ...aliasSuggestions(sc));
      out.push(...fn(G.function));
      if (!ctx.afterExpression) out.push(...kw([...EXPRESSION_KEYWORDS, ...AFTER_EXPRESSION], G.keyword));
      // Sin tablas en la consulta: las tablas, para `SELECT tabla.col` antes de escribir el FROM.
      if (sc.length === 0) out.push(...tableSuggestions(schema, defaultSchema).map((s) => ({ ...s, group: G.keyword + 1 })));
      return dedupe(out);
    }
  }
}

function columnsOf(table: TableMeta): Suggestion[] {
  return table.columns.map((c) => ({
    label: c.name,
    kind: "column" as const,
    detail: c.isPrimaryKey ? `${c.type} · PK` : c.fk ? `${c.type} → ${c.fk.table}` : c.type,
    group: G.qualified,
  }));
}

/** Una etiqueta, una fila: la primera (la de grupo más alto, por el orden de construcción) gana. */
function dedupe(items: Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  return items.filter((s) => {
    const key = `${s.kind}:${s.label.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
