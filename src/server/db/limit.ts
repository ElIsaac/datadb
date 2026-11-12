import { DEFAULT_MAX_ROWS } from "@/shared/limits";

/**
 * Valor por defecto cuando la petición no trae límite. Sale del módulo compartido para que el
 * servidor y el renderer no puedan discrepar: antes era 500 escrito aquí a mano, y el renderer no
 * mandaba nada, así que ese número era el tope real de la app (fase 11, T2).
 */
export const DEFAULT_LIMIT = DEFAULT_MAX_ROWS;

export interface LimitResult {
  sql: string;
  limitApplied: boolean;
  effectiveLimit: number;
  effectiveOffset: number;
}

export function applyLimit(
  sql: string,
  limit = DEFAULT_LIMIT,
  offset = 0,
  dialect: "postgres" | "mysql" | "sqlserver" = "postgres"
): LimitResult {
  const effectiveLimit = Math.max(1, Math.floor(limit));
  const effectiveOffset = Math.max(0, Math.floor(offset));
  const trimmed = sql.trim();
  const withoutTrailingSemi = trimmed.replace(/;+\s*$/, "");

  const isLimitedQuery = /^\s*(SELECT|WITH|SHOW|DESCRIBE|EXPLAIN)\b/i.test(
    withoutTrailingSemi
  );
  const alreadyHasLimit = /\bLIMIT\b/i.test(withoutTrailingSemi);
  const alreadyHasFetchFirst = /\bFETCH\s+(FIRST|NEXT)\b/i.test(withoutTrailingSemi);
  const alreadyHasTop = /^\s*SELECT\s+(DISTINCT\s+)?TOP\s*\(/i.test(withoutTrailingSemi);

  if (
    !isLimitedQuery ||
    alreadyHasLimit ||
    alreadyHasFetchFirst ||
    (dialect === "sqlserver" && alreadyHasTop)
  ) {
    return {
      sql: trimmed,
      limitApplied: false,
      effectiveLimit,
      effectiveOffset: 0,
    };
  }

  if (dialect === "sqlserver") {
    // T-SQL no soporta LIMIT: OFFSET/FETCH requiere ORDER BY, así que si la
    // query no trae uno propio se agrega un ORDER BY neutro para habilitar
    // la paginación sin alterar el orden real de resultados.
    const hasOrderBy = /\bORDER\s+BY\b/i.test(withoutTrailingSemi);
    const orderByClause = hasOrderBy ? "" : " ORDER BY (SELECT NULL)";
    const offsetClause = ` OFFSET ${effectiveOffset} ROWS FETCH NEXT ${effectiveLimit} ROWS ONLY`;
    return {
      sql: `${withoutTrailingSemi}${orderByClause}${offsetClause}`,
      limitApplied: true,
      effectiveLimit,
      effectiveOffset,
    };
  }

  const offsetClause = effectiveOffset > 0 ? ` OFFSET ${effectiveOffset}` : "";

  return {
    sql: `${withoutTrailingSemi} LIMIT ${effectiveLimit}${offsetClause}`,
    limitApplied: true,
    effectiveLimit,
    effectiveOffset,
  };
}
