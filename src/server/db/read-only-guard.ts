/**
 * Guard del modo "solo lectura" de una conexión: BLOQUEA (no solo avisa; complementa las advertencias de
 * sql-safety.ts) cualquier SQL que pueda escribir.
 *
 * Historia (2026-10-09, verificado contra Postgres 16 real): la versión anterior solo miraba la primera
 * palabra. Eso (1) bloqueaba consultas legítimas que empiezan con un comentario (`-- nota\nSELECT …` →
 * "no se permite ejecutar \"--\"") y, peor, (2) dejaba pasar `SELECT 1; DELETE FROM t` — que borró todas las
 * filas en una conexión marcada como solo lectura —, CTEs que modifican datos y `SELECT … INTO`.
 *
 * Cómo decide ahora:
 *   1. Enmascara comentarios y literales con un lexer mínimo y lo hace con CADA interpretación posible del motor
 *      (los lexers difieren: MySQL usa `\` como escape salvo NO_BACKSLASH_ESCAPES, trata `#` como comentario,
 *      solo acepta `-- ` con espacio y EJECUTA `/*! … *\/`; Postgres tiene `$$…$$`, `E'…'` y, con
 *      standard_conforming_strings=off, también escapa con `\`; SQL Server tiene `[…]`).
 *   2. En cada vista: todo debe parsear (literal o comentario sin cerrar → bloquear), cada sentencia separada
 *      por `;` debe empezar por una palabra de lectura y NINGUNA puede contener una palabra de escritura en
 *      ninguna posición (SQL Server ejecuta `SELECT 1 DELETE FROM t` sin `;`; EXPLAIN ANALYZE ejecuta).
 *   3. Se bloquea si CUALQUIER vista encuentra un problema. Como la interpretación real del motor es una de las
 *      vistas, una escritura que el motor ejecutaría siempre queda expuesta en al menos una. El coste son falsos
 *      positivos raros (p. ej. `DELETE` dentro de `$$…$$` en MySQL, `FOR UPDATE`, `SELECT … INTO @var`), que en
 *      una conexión de solo lectura son aceptables.
 *
 * LÍMITE CONOCIDO (no se puede resolver leyendo el SQL): funciones con efectos (`nextval`, `setval`,
 * `pg_terminate_backend`, `dblink_exec`, procedimientos llamados desde un SELECT…). La defensa completa es que la
 * propia base rechace escrituras (`default_transaction_read_only` en Postgres, `SET SESSION TRANSACTION READ ONLY`
 * en MySQL). Registrado como requisito aparte (R53); SQL Server no tiene equivalente por sesión.
 */

type Engine = "postgres" | "mysql" | "sqlserver";

interface LexView {
  name: string;
  /** `\` escapa dentro de '…' y "…" (MySQL por defecto; PG con standard_conforming_strings=off). */
  backslash: boolean;
  /** `E'…'` usa `\` como escape (Postgres). */
  eStrings: boolean;
  /** `$tag$…$tag$` (Postgres). */
  dollar: boolean;
  /** `#` abre comentario de línea (MySQL). */
  hashComment: boolean;
  /** `--` solo es comentario si va seguido de espacio o fin de línea (MySQL). */
  dashNeedsSpace: boolean;
  /** `…` es identificador (MySQL). */
  backtick: boolean;
  /** […] es identificador (SQL Server). */
  brackets: boolean;
}

const BASE: Omit<LexView, "name"> = {
  backslash: false,
  eStrings: false,
  dollar: false,
  hashComment: false,
  dashNeedsSpace: false,
  backtick: false,
  brackets: false,
};

const VIEWS: Record<Engine, LexView[]> = {
  postgres: [
    { ...BASE, name: "postgres", eStrings: true, dollar: true },
    { ...BASE, name: "postgres (standard_conforming_strings=off)", eStrings: true, dollar: true, backslash: true },
  ],
  mysql: [
    { ...BASE, name: "mysql", backslash: true, hashComment: true, dashNeedsSpace: true, backtick: true },
    { ...BASE, name: "mysql (NO_BACKSLASH_ESCAPES)", hashComment: true, dashNeedsSpace: true, backtick: true },
  ],
  sqlserver: [{ ...BASE, name: "sqlserver", brackets: true }],
};

const ALL_VIEWS = [...VIEWS.postgres, ...VIEWS.mysql, ...VIEWS.sqlserver];

const READ_ONLY_PREFIX = /^(SELECT|WITH|SHOW|DESCRIBE|DESC|EXPLAIN|VALUES)\b/i;
/**
 * Palabras que delatan una escritura en CUALQUIER posición de la sentencia: las que pueden ir DENTRO de algo que
 * empieza como lectura (CTE con DELETE, `SELECT … INTO`, `EXPLAIN ANALYZE UPDATE`) o tras una lectura sin `;`
 * (SQL Server: `SELECT 1 DELETE FROM t`, `SELECT 1 KILL 52`). Las que solo son peligrosas como INICIO de sentencia
 * (`SET`, `COMMENT ON`, `LOCK`, `LOAD DATA`, `VACUUM`…) ya las rechaza READ_ONLY_PREFIX; no van aquí porque son
 * nombres de columna habituales (`comment`, `load`, `lock`) y bloquearían lecturas legítimas.
 * Conservadora a propósito: `UPDATE` también bloquea `SELECT … FOR UPDATE` (bloqueo de filas).
 */
const WRITE_KEYWORD =
  /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|DENY|INTO|CALL|EXEC|EXECUTE|BACKUP|RESTORE|DBCC|KILL|SHUTDOWN)\b/i;

/** Resultado del análisis: null = es de lectura; string = motivo legible del bloqueo. */
type Verdict = string | null;

/**
 * Sustituye comentarios por un espacio y literales/identificadores entrecomillados por `''` según `v`.
 * Devuelve `{ error }` si algo no se puede analizar con seguridad.
 */
function mask(sql: string, v: LexView): { text: string } | { error: string } {
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    // Comentario de línea `--`
    if (c === "-" && next === "-") {
      const after = sql[i + 2];
      if (!v.dashNeedsSpace || after === undefined || /\s/.test(after)) {
        while (i < n && sql[i] !== "\n") i++;
        out += " ";
        continue;
      }
    }
    // Comentario de línea `#` (MySQL)
    if (c === "#" && v.hashComment) {
      while (i < n && sql[i] !== "\n") i++;
      out += " ";
      continue;
    }
    // Comentario de bloque. `/*!` lo EJECUTA MySQL: no se puede tratar como comentario.
    if (c === "/" && next === "*") {
      if (sql[i + 2] === "!") return { error: "comentario ejecutable de MySQL (/*! … */)" };
      const end = sql.indexOf("*/", i + 2);
      if (end === -1) return { error: "comentario sin cerrar" };
      i = end + 2;
      out += " ";
      continue;
    }
    // Dollar quoting de Postgres: $tag$ … $tag$ (tag vacío o identificador).
    if (c === "$" && v.dollar) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      // `$1` (parámetro) no es dollar quote: el regex exige `$` de cierre del tag.
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        if (end === -1) return { error: "literal $$ sin cerrar" };
        i = end + tag.length;
        out += "''";
        continue;
      }
    }
    // Literales y identificadores entrecomillados.
    const isE = v.eStrings && (c === "E" || c === "e") && next === "'" && !/[A-Za-z0-9_]/.test(sql[i - 1] ?? "");
    const quote = isE ? "'" : c;
    const opens =
      isE ||
      c === "'" ||
      c === '"' ||
      (c === "`" && v.backtick) ||
      (c === "[" && v.brackets);
    if (opens) {
      const close = quote === "[" ? "]" : quote;
      const backslash = isE || (v.backslash && (quote === "'" || quote === '"'));
      let j = i + (isE ? 2 : 1);
      let closed = false;
      while (j < n) {
        const ch = sql[j];
        if (backslash && ch === "\\") {
          j += 2;
          continue;
        }
        if (ch === close) {
          if (sql[j + 1] === close && close !== "]") {
            j += 2; // comilla doblada = comilla literal
            continue;
          }
          if (close === "]" && sql[j + 1] === "]") {
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        j++;
      }
      if (!closed) return { error: "literal o identificador sin cerrar" };
      i = j;
      out += "''";
      continue;
    }
    out += c;
    i++;
  }
  return { text: out };
}

function verdictForView(sql: string, v: LexView): Verdict {
  const masked = mask(sql, v);
  if ("error" in masked) return `${masked.error} (${v.name})`;
  for (const raw of masked.text.split(";")) {
    const stmt = raw.trim();
    if (!stmt) continue;
    if (!READ_ONLY_PREFIX.test(stmt)) return `"${stmt.split(/\s+/)[0].toUpperCase()}"`;
    const w = WRITE_KEYWORD.exec(stmt);
    if (w) return `"${w[1].toUpperCase()}"`;
  }
  return null;
}

/**
 * Motivo del bloqueo o null si el SQL es de solo lectura.
 * @param engine motor de la sesión; sin él (uso en el cliente) se prueban TODAS las interpretaciones.
 */
export function readOnlyViolation(sql: string, engine?: string): Verdict {
  const views = engine && engine in VIEWS ? VIEWS[engine as Engine] : ALL_VIEWS;
  for (const v of views) {
    const verdict = verdictForView(sql, v);
    if (verdict) return verdict;
  }
  return null;
}

export function isReadOnlyStatement(sql: string, engine?: string): boolean {
  return readOnlyViolation(sql, engine) === null;
}

export class ReadOnlyViolationError extends Error {
  /**
   * @param what lo que se bloqueó: una palabra (`"DELETE"`) o una descripción. Antes se pasaba el SQL entero y se
   *             mostraba su primera palabra, que con un comentario inicial era `"--"`.
   */
  constructor(what: string) {
    super(`Esta conexión está en modo solo lectura: no se permite ejecutar ${what}.`);
    this.name = "ReadOnlyViolationError";
  }
}

export function assertWritableIfNeeded(sql: string, readOnly: boolean | undefined, engine?: string): void {
  if (!readOnly) return;
  const verdict = readOnlyViolation(sql, engine);
  if (verdict) throw new ReadOnlyViolationError(verdict);
}
