/**
 * Tipos de Postgres: nombre legible del OID, y qué columnas deben llegar como TEXTO CRUDO.
 *
 * Dos problemas distintos, los dos medidos en la app real el 2026-10-11 (fase 10):
 *
 * 1. `pg` solo reporta el OID numérico del tipo de cada columna del resultado (`field.dataTypeID`),
 *    así que `QueryColumn.type` valía "1184" en vez de "timestamptz". Hoy nadie lo consume —la
 *    rejilla saca los tipos del esquema (`information_schema`), no del resultado— pero es una
 *    trampa puesta: cualquiera que intente clasificar una columna de un resultado con
 *    `getColumnKind()` recibe "text" para todo y no se entera.
 *
 * 2. Más grave: `pg` convierte `date`, `timestamp` y `time` en objetos `Date` de JavaScript
 *    interpretándolos en la zona horaria del proceso. Un `timestamp without time zone` con el valor
 *    '2026-01-02 08:00:00' salía del driver como '2026-01-02T15:00:00.000Z' (medido en
 *    América/Ciudad Juárez, UTC-7): la app enseñaba una hora que NO es la que hay en la base.
 *    Son valores de reloj de pared, sin instante asociado, así que la única lectura correcta es el
 *    texto tal cual lo manda Postgres.
 *
 * `timestamptz` se deja como está (instante real, se normaliza a UTC): ahí no se pierde información.
 */

/** OID -> nombre de tipo, en la forma que entiende `getColumnKind()` (src/lib/column-kind.ts). */
const OID_NOMBRES: Record<number, string> = {
  16: "bool",
  17: "bytea",
  18: "char",
  19: "name",
  20: "int8",
  21: "int2",
  23: "int4",
  25: "text",
  26: "oid",
  114: "json",
  700: "float4",
  701: "float8",
  790: "money",
  1042: "bpchar",
  1043: "varchar",
  1082: "date",
  1083: "time",
  1114: "timestamp",
  1184: "timestamptz",
  1186: "interval",
  1266: "timetz",
  1700: "numeric",
  2950: "uuid",
  3802: "jsonb",
  // Arrays de los anteriores: Postgres les pone "_" delante al nombre interno. Se devuelve el
  // nombre del elemento con "[]" para que se lea bien en la UI y para que `getColumnKind` siga
  // clasificando por el tipo base.
  1000: "bool[]",
  1001: "bytea[]",
  1005: "int2[]",
  1007: "int4[]",
  1009: "text[]",
  1014: "bpchar[]",
  1015: "varchar[]",
  1016: "int8[]",
  1021: "float4[]",
  1022: "float8[]",
  1115: "timestamp[]",
  1182: "date[]",
  1183: "time[]",
  1185: "timestamptz[]",
  1231: "numeric[]",
  2951: "uuid[]",
  3807: "jsonb[]",
};

/**
 * Nombre del tipo para un OID. Si no está en la tabla se devuelve el OID como cadena, que es lo que
 * se hacía antes: así un tipo propio del usuario (enum, dominio, extensión) no rompe nada, solo se
 * queda sin nombre bonito.
 */
export function pgTypeName(oid: number | undefined | null): string {
  if (oid === undefined || oid === null) return "";
  return OID_NOMBRES[oid] ?? String(oid);
}

/**
 * OIDs que hay que leer como texto crudo, sin que `pg` los convierta a `Date`.
 *
 * `date`, `time`, `timetz` y `timestamp` (sin zona) son valores de reloj de pared: convertirlos a
 * `Date` obliga a elegir una zona horaria que el dato no tiene, y eso cambia el valor que ve el
 * usuario. `timestamptz` NO está en la lista a propósito: ese sí es un instante.
 */
export const OIDS_TEXTO_CRUDO = [1082, 1083, 1114, 1266] as const;

/** Lo mismo para los arrays de esos tipos. */
export const OIDS_TEXTO_CRUDO_ARRAY = [1182, 1183, 1115] as const;

/**
 * R94 — una fila del catálogo para resolver el origen de las columnas de un resultado:
 * `(oid de la tabla, número de columna) → (esquema, tabla, columna)`.
 */
export interface FilaDeOrigenPg {
  oid: number;
  attnum: number;
  esquema: string;
  tabla: string;
  columna: string;
}

/**
 * Los pares `(tableID, columnID)` del resultado que merece la pena resolver: `pg` manda
 * `tableID = 0` en una expresión (`count(*)`, `a || b`) y ahí no hay nada que buscar.
 */
export function oidsDeOrigen(campos: ReadonlyArray<{ tableID: number; columnID: number }>): number[] {
  const oids = new Set<number>();
  for (const c of campos) if (c.tableID > 0 && c.columnID > 0) oids.add(c.tableID);
  return [...oids];
}

/**
 * R94 — el origen de cada columna del resultado, con las filas del catálogo ya leídas.
 *
 * Se separa del driver para poder probarlo sin servidor: el driver solo hace la consulta a
 * `pg_attribute` y le pasa las filas. Una columna sin fila en el catálogo (expresión, tabla
 * borrada entre medias) se queda SIN origen, que en la rejilla significa «solo lectura».
 */
export function origenesPg(
  campos: ReadonlyArray<{ tableID: number; columnID: number }>,
  filas: ReadonlyArray<FilaDeOrigenPg>
): Array<{ schema: string; table: string; column: string } | undefined> {
  const porClave = new Map<string, FilaDeOrigenPg>();
  for (const f of filas) porClave.set(`${f.oid}:${f.attnum}`, f);
  return campos.map((c) => {
    const f = porClave.get(`${c.tableID}:${c.columnID}`);
    return f ? { schema: f.esquema, table: f.tabla, column: f.columna } : undefined;
  });
}
