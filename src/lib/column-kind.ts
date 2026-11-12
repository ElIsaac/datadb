export type ColumnKind = "text" | "boolean" | "date" | "time" | "datetime" | "datetimetz" | "number";

/**
 * Clasifica el tipo de columna del esquema (tal como lo reporta cada driver
 * vía information_schema/pg_catalog) para elegir el editor correcto en la
 * grilla y el formato de guardado. Distinguir "datetime" (naive, sin
 * zona horaria: DATETIME/TIMESTAMP de MySQL, TIMESTAMP/DATETIME2 de SQL
 * Server, "timestamp without time zone" de Postgres) de "datetimetz"
 * (TIMESTAMPTZ de Postgres, DATETIMEOFFSET de SQL Server) importa porque el
 * segundo tipo lleva desplazamiento de huso horario real: perderlo al editar
 * corrompe el instante guardado.
 */
export function getColumnKind(type: string): ColumnKind {
  const t = type.toLowerCase().trim();
  if (/bool/.test(t)) return "boolean";
  // R98: los booleanos sin ese nombre. `tinyint(1)` es el BOOLEAN de MySQL (el driver lo distingue
  // por el ancho, ver `mysqlTipoDeCampo`) y `bit` a secas es el booleano de SQL Server y el `BIT(1)`
  // de MySQL; `bit(8)` y demás anchos siguen siendo texto.
  if (/^tinyint\(1\)/.test(t) || t === "bit") return "boolean";
  if (
    /with\s+time\s+zone/.test(t) ||
    t === "timestamptz" ||
    t === "datetimeoffset"
  )
    return "datetimetz";
  if (t === "date") return "date";
  // "time" pero no "timestamp" (que también empieza por "time...").
  if (/^time\b/.test(t) && !/^timestamp/.test(t)) return "time";
  if (/^(datetime|timestamp|smalldatetime)/.test(t)) return "datetime";
  if (
    /^(tinyint|smallint|mediumint|int|integer|bigint|serial|float|double|real|numeric|decimal|number|money|smallmoney)/.test(
      t
    )
  )
    return "number";
  return "text";
}
