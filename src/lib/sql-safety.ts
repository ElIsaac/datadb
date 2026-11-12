/**
 * Detección de operaciones potencialmente riesgosas antes de ejecutarlas.
 * Réplica ligera de las advertencias de DataGrip: UPDATE/DELETE sin WHERE,
 * y DDL destructivo (DROP/TRUNCATE).
 */
export type SqlRiskKind =
  | "update-no-where"
  | "delete-no-where"
  | "drop"
  | "truncate";

export interface SqlRisk {
  kind: SqlRiskKind;
  statement: string;
  message: string;
}

function stripComments(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Analiza un único statement SQL y devuelve el riesgo detectado, o null si
 * no aplica ninguna regla.
 */
export function detectSqlRisk(statement: string): SqlRisk | null {
  const cleaned = stripComments(statement).trim().replace(/;+\s*$/, "");
  if (!cleaned) return null;

  const upper = cleaned.toUpperCase();

  if (/^\bDROP\b/.test(upper)) {
    return {
      kind: "drop",
      statement,
      message: "Esta sentencia elimina un objeto de la base de datos (DROP).",
    };
  }

  if (/^\bTRUNCATE\b/.test(upper)) {
    return {
      kind: "truncate",
      statement,
      message: "Esta sentencia vacía una tabla por completo (TRUNCATE).",
    };
  }

  if (/^\bUPDATE\b/.test(upper)) {
    if (!/\bWHERE\b/.test(upper)) {
      return {
        kind: "update-no-where",
        statement,
        message: "UPDATE sin cláusula WHERE: afectará todas las filas de la tabla.",
      };
    }
    return null;
  }

  if (/^\bDELETE\b/.test(upper)) {
    if (!/\bWHERE\b/.test(upper)) {
      return {
        kind: "delete-no-where",
        statement,
        message: "DELETE sin cláusula WHERE: borrará todas las filas de la tabla.",
      };
    }
    return null;
  }

  return null;
}

/**
 * Analiza una lista de statements y devuelve todos los riesgos detectados,
 * en el mismo orden.
 */
export function detectSqlRisks(statements: string[]): SqlRisk[] {
  const risks: SqlRisk[] = [];
  for (const stmt of statements) {
    const risk = detectSqlRisk(stmt);
    if (risk) risks.push(risk);
  }
  return risks;
}
