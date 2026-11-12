/**
 * Vista de documentos de MongoDB (fase 81) — tipos y helpers COMPARTIDOS por worker y renderer.
 *
 * POR QUÉ ASÍ: los documentos de Mongo no son filas. Un mismo campo puede ser `ObjectId` en un
 * documento y `null` en el siguiente, hay objetos anidados y arrays, y los tipos especiales
 * (`ObjectId`, `Date`, `Decimal128`, `Long`, `BinData`) **no sobreviven al IPC** (structured clone no
 * conoce las clases de BSON). Por eso el worker los convierte a **EJSON** y el renderer pinta cada
 * envoltorio con la forma que usa MongoDB Compass (`ObjectId('…')`, `ISODate('…')`).
 *
 * Las funciones de aquí son puras y se prueban sin base de datos ni ventana.
 */

export interface MongoFindResult {
  documentos: Record<string, unknown>[];
  /** Total que cumple el filtro (no solo la página que se trajo). */
  total: number;
  /** Tiempo del servidor, en ms. */
  ms: number;
}

/** Tipos que la vista distingue con color, igual que Compass. */
export type TipoDeValor =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "objectid"
  | "date"
  | "decimal"
  | "long"
  | "binary"
  | "regex"
  | "object"
  | "array";

const esObjeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Tipo de un valor YA en EJSON relajado. El orden importa: un `{$oid: "…"}` es un objeto, y sin
 * mirarlo antes que `object` se pintaría como objeto genérico (perdiendo el color y la forma
 * `ObjectId('…')` que el usuario reconoce).
 */
export function tipoDeValor(v: unknown): TipoDeValor {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "string") return "string";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (esObjeto(v)) {
    const claves = Object.keys(v);
    if (claves.length === 1) {
      const k = claves[0];
      if (k === "$oid" && typeof v.$oid === "string") return "objectid";
      if (k === "$date") return "date";
      if (k === "$numberDecimal") return "decimal";
      if (k === "$numberLong") return "long";
      if (k === "$binary") return "binary";
      if (k === "$regularExpression") return "regex";
    }
    return "object";
  }
  return "string";
}

/** ¿Es un tipo «especial» de BSON, que se pinta como envoltorio en vez de como estructura? */
export function esEnvoltorio(tipo: TipoDeValor): boolean {
  return (
    tipo === "objectid" ||
    tipo === "date" ||
    tipo === "decimal" ||
    tipo === "long" ||
    tipo === "binary" ||
    tipo === "regex"
  );
}

/**
 * Texto que se muestra al lado de la clave, con la misma notación que Compass / el shell de Mongo:
 *  - `ObjectId('6718…')`, `ISODate('2024-10-22T…')`, `NumberDecimal('1.5')`, `NumberLong(7)`,
 *  - `null`, `true`/`false`,
 *  - y para objetos/arrays, un resumen (`{3 campos}`, `[4]`) porque el contenido se despliega.
 */
export function textoDeValor(v: unknown): string {
  const tipo = tipoDeValor(v);
  const o = v as Record<string, unknown>;
  switch (tipo) {
    case "objectid":
      return `ObjectId('${o.$oid as string}')`;
    case "date": {
      const d = o.$date;
      // EJSON relajado manda `{$date: "ISO"}`; canónico manda `{$date: {$numberLong: "ms"}}`.
      if (typeof d === "string") return `ISODate('${d}')`;
      if (esObjeto(d) && typeof d.$numberLong === "string") {
        return `ISODate('${new Date(Number(d.$numberLong)).toISOString()}')`;
      }
      return "ISODate(?)";
    }
    case "decimal":
      return `NumberDecimal('${String(o.$numberDecimal)}')`;
    case "long":
      return `NumberLong(${String(o.$numberLong)})`;
    case "binary": {
      const b = o.$binary;
      const sub = esObjeto(b) && typeof b.base64 === "string" ? b.base64 : "";
      const corto = sub.length > 24 ? `${sub.slice(0, 24)}…` : sub;
      return `BinData(${String((esObjeto(b) && b.subType) || "00")}, '${corto}')`;
    }
    case "regex": {
      const r = o.$regularExpression;
      return esObjeto(r) ? `/${String(r.pattern)}/${String(r.options || "")}` : "/?/";
    }
    case "array":
      return `[${(v as unknown[]).length}]`;
    case "object":
      return `{${Object.keys(o).length} campos}`;
    case "string":
      return `"${v as string}"`;
    case "null":
      return "null";
    default:
      return String(v);
  }
}

/**
 * Un valor que NO se puede desplegar: se pinta entero en la fila. Los objetos y arrays, en cambio,
 * se pintan como un nodo que abre (y ahí sí se ve el contenido).
 */
export function esHoja(tipo: TipoDeValor): boolean {
  return tipo !== "object" && tipo !== "array";
}
