export interface SingleTableRef {
  schema?: string;
  table: string;
}

/**
 * Determina si un SQL es un SELECT editable de una sola tabla.
 * Reglas (spec §6):
 * - Debe empezar con SELECT o WITH.
 * - No puede contener JOIN, UNION, INTO, GROUP BY.
 * - Debe tener exactamente un FROM.
 * - Extraer schema.table, "schema"."table", `tabla` o tabla.
 */
export function parseSingleTable(sql: string): SingleTableRef | null {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  const upper = trimmed.toUpperCase();

  if (!/^\s*(SELECT|WITH)\b/i.test(trimmed)) return null;
  if (/\b(JOIN|UNION|INTO|GROUP\s+BY)\b/i.test(upper)) return null;

  const fromMatches = [...trimmed.matchAll(/\bFROM\b/gi)];
  if (fromMatches.length !== 1) return null;

  const fromIdx = fromMatches[0].index!;
  const afterFrom = trimmed.slice(fromIdx + 4).trim();

  // Tomar solo hasta el siguiente keyword reservado (WHERE, ORDER, LIMIT, etc.)
  const stopRe = /\b(WHERE|ORDER\s+BY|GROUP\s+BY|HAVING|LIMIT|OFFSET|UNION|INTERSECT|EXCEPT|WINDOW|FOR\s+(UPDATE|SHARE|NO\s+KEY\s+UPDATE|KEY\s+SHARE))\b/i;
  const stopMatch = stopRe.exec(afterFrom);
  const conAlias = stopMatch
    ? afterFrom.slice(0, stopMatch.index).trim()
    : afterFrom.split(/\s*,\s*/)[0].trim();
  // R94: `FROM tabla ficha` / `FROM tabla AS ficha`. Antes el alias se quedaba pegado y se buscaba
  // la tabla «tabla ficha», que no existe: el resultado quedaba sin contexto y no se podía editar.
  // Se quita SOLO un identificador final separado por espacio (con o sin `AS`); un nombre entre
  // comillas con espacios dentro (`"mi tabla"`) no casa porque el alias tiene que empezar tras un
  // espacio y llegar al final sin comillas sueltas.
  const sinAlias = conAlias.replace(
    /\s+(?:AS\s+)?(?:[A-Za-z_][\w$]*|"[^"]+"|`[^`]+`|\[[^\]]+\])$/i,
    ""
  );
  const tableChunk = sinAlias.length > 0 ? sinAlias : conAlias;

  // Extraer identificador: "schema"."table", `table`, [table], schema.table, table
  const quoted = /^"([^"]+)"(?:\."([^"]+)")?$/.exec(tableChunk);
  if (quoted) {
    return quoted[2]
      ? { schema: quoted[1], table: quoted[2] }
      : { table: quoted[1] };
  }

  const backtick = /^`([^`]+)`(?:\.`([^`]+)`)?$/.exec(tableChunk);
  // Fallback para el formato `schema`.`table` de MySQL (el regex anterior
  // solo coincide con `schema`.`table` si los backticks internos están escapados).
  if (!backtick && /^`[^`]+`\.(`[^`]+`)$/.test(tableChunk)) {
    const parts = tableChunk.split(".").map((p) => p.replace(/^`|`$/g, ""));
    if (parts.length === 2) {
      return { schema: parts[0], table: parts[1] };
    }
  }
  if (backtick) {
    return backtick[2]
      ? { schema: backtick[1], table: backtick[2] }
      : { table: backtick[1] };
  }

  const bracket = /^\[([^\]]+)\](?:\.\[([^\]]+)\])?$/.exec(tableChunk);
  if (bracket) {
    return bracket[2]
      ? { schema: bracket[1], table: bracket[2] }
      : { table: bracket[1] };
  }

  const parts = tableChunk.split(".").map((p) => p.trim());
  if (parts.length === 2) {
    return { schema: parts[0], table: parts[1] };
  }
  if (parts.length === 1) {
    return { table: parts[0] };
  }

  return null;
}
