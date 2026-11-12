export type DdlDialect = "postgres" | "mysql" | "sqlserver";

/**
 * Plantillas DDL de un clic, al estilo "Generate DDL" de DataGrip. Cada
 * función devuelve un esqueleto de sentencia lista para completar en el
 * editor, con el dialecto correcto (MySQL vs PostgreSQL vs SQL Server) para
 * las partes que difieren entre motores (autoincrement, tipos, comillas).
 */

function quoteIdent(dialect: DdlDialect, ident: string): string {
  if (dialect === "mysql") return `\`${ident}\``;
  if (dialect === "sqlserver") return `[${ident}]`;
  return `"${ident}"`;
}

export function createTableTemplate(dialect: DdlDialect, schema: string): string {
  const tableRef = `${quoteIdent(dialect, schema)}.${quoteIdent(dialect, "nueva_tabla")}`;

  const pkColumn =
    dialect === "mysql"
      ? "  id INT AUTO_INCREMENT PRIMARY KEY,"
      : dialect === "sqlserver"
        ? "  id INT IDENTITY(1,1) PRIMARY KEY,"
        : "  id SERIAL PRIMARY KEY,";

  return [
    `CREATE TABLE ${tableRef} (`,
    pkColumn,
    "  nombre VARCHAR(255) NOT NULL,",
    dialect === "mysql"
      ? "  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
      : dialect === "sqlserver"
        ? "  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()"
        : "  created_at TIMESTAMPTZ NOT NULL DEFAULT now()",
    ");",
  ].join("\n");
}

export function createViewTemplate(dialect: DdlDialect, schema: string): string {
  const viewRef = `${quoteIdent(dialect, schema)}.${quoteIdent(dialect, "nueva_vista")}`;
  return [
    `CREATE VIEW ${viewRef} AS`,
    "SELECT *",
    "FROM tabla",
    "WHERE condicion;",
  ].join("\n");
}

export function createIndexTemplate(dialect: DdlDialect, schema: string): string {
  const tableRef = `${quoteIdent(dialect, schema)}.${quoteIdent(dialect, "tabla")}`;
  return `CREATE INDEX idx_tabla_columna ON ${tableRef} (columna);`;
}

export function createTriggerTemplate(dialect: DdlDialect, schema: string): string {
  const tableRef = `${quoteIdent(dialect, schema)}.${quoteIdent(dialect, "tabla")}`;
  if (dialect === "mysql") {
    return [
      "DELIMITER $$",
      `CREATE TRIGGER trg_tabla_before_insert`,
      `BEFORE INSERT ON ${tableRef}`,
      "FOR EACH ROW",
      "BEGIN",
      "  -- lógica aquí",
      "END$$",
      "DELIMITER ;",
    ].join("\n");
  }
  if (dialect === "sqlserver") {
    return [
      `CREATE TRIGGER trg_tabla_after_insert`,
      `ON ${tableRef}`,
      "AFTER INSERT",
      "AS",
      "BEGIN",
      "  SET NOCOUNT ON;",
      "  -- lógica aquí (usar la tabla virtual INSERTED)",
      "END;",
    ].join("\n");
  }
  return [
    "CREATE OR REPLACE FUNCTION tabla_before_insert()",
    "RETURNS TRIGGER AS $$",
    "BEGIN",
    "  -- lógica aquí",
    "  RETURN NEW;",
    "END;",
    "$$ LANGUAGE plpgsql;",
    "",
    "CREATE TRIGGER trg_tabla_before_insert",
    `BEFORE INSERT ON ${tableRef}`,
    "FOR EACH ROW",
    "EXECUTE FUNCTION tabla_before_insert();",
  ].join("\n");
}

export function createFunctionTemplate(dialect: DdlDialect, schema: string): string {
  const funcRef = `${quoteIdent(dialect, schema)}.${quoteIdent(dialect, "nueva_funcion")}`;
  if (dialect === "mysql") {
    return [
      `CREATE FUNCTION ${funcRef} (param INT)`,
      "RETURNS INT",
      "DETERMINISTIC",
      "BEGIN",
      "  RETURN param * 2;",
      "END;",
    ].join("\n");
  }
  if (dialect === "sqlserver") {
    return [
      `CREATE FUNCTION ${funcRef} (@param INT)`,
      "RETURNS INT",
      "AS",
      "BEGIN",
      "  RETURN @param * 2;",
      "END;",
    ].join("\n");
  }
  return [
    `CREATE OR REPLACE FUNCTION ${funcRef}(param INTEGER)`,
    "RETURNS INTEGER AS $$",
    "BEGIN",
    "  RETURN param * 2;",
    "END;",
    "$$ LANGUAGE plpgsql;",
  ].join("\n");
}

export type DdlTemplateKind = "table" | "view" | "index" | "trigger" | "function";

export function buildDdlTemplate(
  kind: DdlTemplateKind,
  dialect: DdlDialect,
  schema: string
): string {
  switch (kind) {
    case "table":
      return createTableTemplate(dialect, schema);
    case "view":
      return createViewTemplate(dialect, schema);
    case "index":
      return createIndexTemplate(dialect, schema);
    case "trigger":
      return createTriggerTemplate(dialect, schema);
    case "function":
      return createFunctionTemplate(dialect, schema);
    default:
      return "";
  }
}

/** Tipos de columna comunes ofrecidos en el editor visual de tabla, por dialecto. */
export const COMMON_COLUMN_TYPES: Record<DdlDialect, string[]> = {
  mysql: [
    "INT",
    "BIGINT",
    "VARCHAR(255)",
    "TEXT",
    "BOOLEAN",
    "DATE",
    "DATETIME",
    "TIMESTAMP",
    "DECIMAL(10,2)",
    "JSON",
  ],
  postgres: [
    "INTEGER",
    "BIGINT",
    "VARCHAR(255)",
    "TEXT",
    "BOOLEAN",
    "DATE",
    "TIMESTAMPTZ",
    "NUMERIC(10,2)",
    "UUID",
    "JSONB",
  ],
  sqlserver: [
    "INT",
    "BIGINT",
    "NVARCHAR(255)",
    "NVARCHAR(MAX)",
    "BIT",
    "DATE",
    "DATETIME2",
    "DECIMAL(10,2)",
    "UNIQUEIDENTIFIER",
    "NVARCHAR(MAX)", // sin tipo JSON nativo; se guarda como texto validado con ISJSON()
  ],
};

export interface BuilderColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string;
  autoIncrement: boolean;
}

export function newBuilderColumn(dialect: DdlDialect): BuilderColumn {
  return {
    name: "",
    type: COMMON_COLUMN_TYPES[dialect][0],
    nullable: true,
    primaryKey: false,
    defaultValue: "",
    autoIncrement: false,
  };
}

/**
 * Genera el CREATE TABLE final a partir del estado del editor visual.
 * Columnas sin nombre se omiten. Si ninguna columna es PK, no se agrega
 * cláusula PRIMARY KEY. autoIncrement solo se respeta en la primera columna
 * PK (evita SQL inválido con múltiples auto-increment).
 */
export function buildTableDdlFromColumns(
  dialect: DdlDialect,
  schema: string,
  tableName: string,
  columns: BuilderColumn[]
): string {
  const quote = quoteIdent;
  const tableRef = `${quote(dialect, schema)}.${quote(dialect, tableName || "nueva_tabla")}`;
  const valid = columns.filter((c) => c.name.trim().length > 0);

  const pkNames = valid.filter((c) => c.primaryKey).map((c) => c.name);
  let autoIncApplied = false;

  const lines = valid.map((c) => {
    let line = `  ${quote(dialect, c.name)} ${c.type}`;
    if (c.primaryKey && c.autoIncrement && pkNames.length === 1 && !autoIncApplied) {
      autoIncApplied = true;
      if (dialect === "mysql") line += " AUTO_INCREMENT";
      else if (dialect === "sqlserver") line += " IDENTITY(1,1)";
    }
    if (!c.nullable) line += " NOT NULL";
    if (c.defaultValue.trim()) line += ` DEFAULT ${c.defaultValue.trim()}`;
    return line;
  });

  if (pkNames.length > 0) {
    lines.push(`  PRIMARY KEY (${pkNames.map((n) => quote(dialect, n)).join(", ")})`);
  }

  // Postgres no soporta AUTO_INCREMENT: si hay una única PK autoincrement,
  // usar SERIAL/BIGSERIAL en el tipo en vez de una cláusula aparte.
  if (dialect === "postgres" && pkNames.length === 1) {
    const pkCol = valid.find((c) => c.name === pkNames[0]);
    if (pkCol?.autoIncrement) {
      const idx = lines.findIndex((l) => l.includes(quote(dialect, pkCol.name) + " "));
      if (idx !== -1) {
        const isBig = /BIGINT/i.test(pkCol.type);
        lines[idx] = lines[idx].replace(
          pkCol.type,
          isBig ? "BIGSERIAL" : "SERIAL"
        );
      }
    }
  }

  if (lines.length === 0) {
    return `CREATE TABLE ${tableRef} (\n  -- agrega al menos una columna\n);`;
  }

  return `CREATE TABLE ${tableRef} (\n${lines.join(",\n")}\n);`;
}
