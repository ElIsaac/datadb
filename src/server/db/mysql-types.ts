/**
 * Tipos de MySQL: nombre legible del código numérico que manda el protocolo.
 *
 * Mismo problema que en Postgres (ver `pg-types.ts`), con otro envoltorio: `mysql2` reporta el tipo
 * de cada columna del resultado como un número del protocolo (`FieldPacket.type`), así que
 * `QueryColumn.type` valía "12" en vez de "datetime" y `getColumnKind()` lo clasificaba como texto.
 *
 * Los nombres elegidos son los mismos que devuelve `information_schema.columns.data_type`, que es
 * de donde salen los tipos en la vista de tabla: así los dos caminos coinciden y una columna se
 * clasifica igual venga de donde venga.
 *
 * Códigos según `mysql2/lib/constants/types.js`.
 */
const CODIGO_NOMBRES: Record<number, string> = {
  0: "decimal",
  1: "tinyint",
  2: "smallint",
  3: "int",
  4: "float",
  5: "double",
  6: "null",
  7: "timestamp",
  8: "bigint",
  9: "mediumint",
  10: "date",
  11: "time",
  12: "datetime",
  13: "year",
  14: "date", // NEWDATE, interno del servidor
  15: "varchar",
  16: "bit",
  245: "json",
  246: "decimal", // NEWDECIMAL: es el DECIMAL de verdad desde MySQL 5.0
  247: "enum",
  248: "set",
  249: "tinyblob",
  250: "mediumblob",
  251: "longblob",
  252: "blob",
  253: "varchar", // VAR_STRING
  254: "char",
  255: "geometry",
};

/**
 * Nombre del tipo para un código del protocolo. Si no está tabulado se devuelve el número como
 * cadena, que es lo que se hacía antes: degradar, nunca romper.
 */
export function mysqlTypeName(codigo: number | undefined | null): string {
  if (codigo === undefined || codigo === null) return "";
  return CODIGO_NOMBRES[codigo] ?? String(codigo);
}

/**
 * R98: tipo de una columna del RESULTADO teniendo en cuenta su ancho (`columnLength`).
 *
 * MySQL no tiene booleano propio: `BOOLEAN` es `TINYINT(1)`, y el protocolo manda solo «tinyint».
 * DataGrip (Connector/J con `tinyInt1isBit`, que viene activo) lo pinta como casilla; para hacer lo
 * mismo hace falta distinguirlo de un `TINYINT` normal, y eso solo lo dice el ancho del campo.
 * Igual con `BIT`: `BIT(1)` es un booleano, `BIT(8)` es un campo de bits y se queda como texto.
 *
 * Hueco conocido: un `TINYINT(1)` usado como número de 0 a 9 también sale como casilla, igual que en
 * DataGrip con la configuración de fábrica; si el valor no es 0/1 la celda cae a texto (ver
 * `valorBooleano`), así que no se pierde el dato.
 */
export function mysqlTipoDeCampo(campo: { type?: number | null; columnLength?: number | null }): string {
  const nombre = mysqlTypeName(campo.type);
  if (nombre === "tinyint" && campo.columnLength === 1) return "tinyint(1)";
  if (nombre === "bit" && typeof campo.columnLength === "number" && campo.columnLength > 1) {
    return `bit(${campo.columnLength})`;
  }
  return nombre;
}

/**
 * R94 — de qué tabla y columna REALES sale una columna del resultado, leído del paquete de campo.
 *
 * `orgTable`/`orgName` son la tabla y la columna sin alias (`table`/`name` llevan el alias de la
 * consulta: `ficha`, `fecha`), y `db` es la base. En una expresión (`count(*)`, `concat(a, b)`,
 * un literal) MySQL manda `orgTable` vacío: entonces NO hay origen y la columna queda de solo
 * lectura — nunca se adivina la tabla por el nombre.
 *
 * Devuelve un objeto para esparcir (`...origenMysql(f)`): vacío cuando no hay origen, así la
 * columna no lleva la clave `origen: undefined` (que un `deepEqual` de los tests distinguiría).
 */
export function origenMysql(campo: {
  db?: string;
  schema?: string;
  orgTable?: string;
  orgName?: string;
}): { origen?: { schema?: string; table: string; column: string } } {
  const table = (campo.orgTable ?? "").trim();
  const column = (campo.orgName ?? "").trim();
  if (!table || !column) return {};
  const schema = (campo.db ?? campo.schema ?? "").trim();
  return { origen: schema ? { schema, table, column } : { table, column } };
}
