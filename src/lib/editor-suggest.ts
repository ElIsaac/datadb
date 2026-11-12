/**
 * Sugerencias del autocompletado a partir del esquema REAL de la conexión.
 *
 * El editor propio no conoce el esquema (esa es la gracia: es un componente genérico). Esta función
 * es la que traduce `SchemaNode[]` —lo que ya usa el editor de CodeMirror— a la lista plana que
 * espera el popup. Cuando la consola cambie de editor, esta es la única pieza nueva que necesita.
 *
 * QUÉ ENTRA Y EN QUÉ ORDEN: primero palabras clave y funciones (lo que se escribe con más
 * frecuencia), después tablas y columnas. El popup reordena por prefijo, así que el orden de aquí
 * solo manda cuando el prefijo está vacío (Ctrl+Space).
 *
 * LO QUE NO HACE (a propósito): mirar el alcance de la sentencia. Desde la fase 87 (R89) la consola
 * ya NO usa esta lista: usa `contextualSuggestions` (`src/lib/sql-completion.ts`), que decide por
 * posición del cursor. Esta lista plana queda para la demo del editor propio y como respaldo sin
 * contexto.
 */
import type { SchemaNode } from "@/lib/types";
import type { Suggestion } from "@/components/own-editor/completion";

const KEYWORDS: Suggestion[] = [
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "INNER JOIN",
  "FULL JOIN",
  "ON",
  "GROUP BY",
  "ORDER BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "INSERT INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE FROM",
  "CREATE TABLE",
  "ALTER TABLE",
  "DROP TABLE",
  "UNION",
  "UNION ALL",
  "DISTINCT",
  "AS",
  "AND",
  "OR",
  "NOT",
  "NULL",
  "IS NULL",
  "IS NOT NULL",
  "LIKE",
  "ILIKE",
  "IN",
  "BETWEEN",
  "EXISTS",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "ASC",
  "DESC",
  "RETURNING",
].map((label) => ({ label, kind: "keyword" as const }));

const FUNCTIONS: Suggestion[] = [
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
].map((label) => ({ label, kind: "function" as const, detail: "función" }));

/**
 * Construye la lista. Se deduplica por etiqueta: un esquema con dos tablas que tengan la misma
 * columna (`id`) generaría dos entradas idénticas en el popup.
 */
export function schemaSuggestions(schema: SchemaNode[] | null | undefined): Suggestion[] {
  if (!schema || schema.length === 0) return [...KEYWORDS, ...FUNCTIONS];

  const out: Suggestion[] = [...KEYWORDS, ...FUNCTIONS];
  const seen = new Set(out.map((s) => s.label.toLowerCase()));

  const push = (item: Suggestion) => {
    const key = item.label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(item);
  };

  for (const node of schema) {
    for (const table of node.tables) {
      push({ label: table.name, kind: "table", detail: node.name });
      push({ label: `${node.name}.${table.name}`, kind: "table", detail: "tabla" });
      for (const column of table.columns) {
        push({ label: column.name, kind: "column", detail: `${table.name} · ${column.type}` });
        push({ label: `${table.name}.${column.name}`, kind: "column", detail: column.type });
      }
    }
  }
  return out;
}
