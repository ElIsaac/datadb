export type SqlDialect = "postgres" | "mysql" | "sqlserver";

export function quoteIdentifier(name: string, type: SqlDialect): string {
  if (type === "mysql") {
    return "`" + name.replace(/`/g, "``") + "`";
  }
  if (type === "sqlserver") {
    return `[${name.replace(/\]/g, "]]")}]`;
  }
  const escaped = name.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function quoteValue(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || typeof value === "undefined") return "NULL";
  const escaped = String(value).replace(/'/g, "''");
  return `'${escaped}'`;
}
