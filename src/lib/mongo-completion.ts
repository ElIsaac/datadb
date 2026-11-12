/**
 * Autocompletado de la barra de consulta de MongoDB (fase 83).
 *
 * PEDIDO DEL USUARIO: «las sugerencias como un wiki funcional está bien, pero también puedes hacerlo
 * para que sea como autocompletado; Mongo detecta los fields pero no te ayuda con la sintaxis».
 *
 * DOS FUENTES, según dónde esté el cursor:
 *  - **Dentro de una llave, en posición de clave** → los CAMPOS reales de la colección (muestreados
 *    del servidor), incluidos los anidados (`detalle.pais`).
 *  - **Dentro de un valor** → los operadores (`$gt`, `$regex`, `$in`…) **con su equivalente en SQL y
 *    una explicación**, más los literales (`null`, `true`) y los constructores (`ObjectId`, `ISODate`).
 *    Esto es lo que Mongo no da: saber que para un LIKE se usa `$regex`.
 *
 * Todo es puro (texto + cursor → contexto y candidatos) para probarlo sin ventana; la vista solo pinta
 * y aplica la inserción.
 */

export type TipoContexto = "clave" | "valor" | "ninguno";

export interface Contexto {
  tipo: TipoContexto;
  /** Dónde empieza la palabra que se está escribiendo (para reemplazarla al aceptar). */
  desde: number;
  /** Lo ya escrito de esa palabra. */
  prefijo: string;
  /** ¿Estamos detrás de un `$`? Cambia la lista y el texto que se inserta. */
  enOperador: boolean;
}

export interface Candidato {
  /** Lo que se inserta (sin repetir el `$` si ya está escrito). */
  insercion: string;
  /** Cómo se ve en la lista. */
  etiqueta: string;
  /** Una línea de ayuda: qué hace. */
  detalle?: string;
  /** Equivalente en SQL, si existe. */
  sql?: string;
  tipo: "campo" | "operador" | "literal" | "constructor";
}

/**
 * Dónde está el cursor. Se recorre el texto llevando la profundidad de llaves y corchetes y el último
 * separador: si el último separador es `{` o `,` en un objeto, se está escribiendo una CLAVE; si es
 * `:` o `,` en un array, un VALOR.
 */
export function contextoEn(texto: string, cursor: number): Contexto {
  const hasta = texto.slice(0, cursor);
  let profundidadLlave = 0;
  let profundidadCorchete = 0;
  let ultimoSeparador = "";
  let enCadena = false;
  let comilla = "";

  for (let i = 0; i < hasta.length; i++) {
    const c = hasta[i];
    if (enCadena) {
      if (c === "\\") i++;
      else if (c === comilla) enCadena = false;
      continue;
    }
    if (c === '"' || c === "'") {
      enCadena = true;
      comilla = c;
      continue;
    }
    if (c === "{") profundidadLlave++;
    else if (c === "}") profundidadLlave--;
    else if (c === "[") profundidadCorchete++;
    else if (c === "]") profundidadCorchete--;
    else if (c === ":" || c === ",") ultimoSeparador = c;
  }

  // La palabra que se está escribiendo: desde el último carácter que no sea de nombre.
  const m = /[$\w]*$/.exec(hasta);
  const prefijo = m?.[0] ?? "";
  const desde = cursor - prefijo.length;

  // Fuera de cualquier llave (p. ej. texto suelto) no se sugiere nada.
  if (profundidadLlave <= 0 && profundidadCorchete <= 0) {
    return { tipo: "ninguno", desde, prefijo, enOperador: prefijo.startsWith("$") };
  }

  const enOperador = prefijo.startsWith("$");
  // Dentro de un array, todo lo que se escribe es un valor.
  if (profundidadCorchete > 0 && profundidadLlave <= 0) {
    return { tipo: "valor", desde, prefijo, enOperador };
  }
  // En un objeto: después de `{` o `,` se escribe una clave; después de `:` un valor.
  if (ultimoSeparador === ":" || ultimoSeparador === ",") {
    // `,` puede ser «siguiente clave» o «siguiente valor de un array»; para no adivinar, se ofrece
    // clave (el caso normal en un filtro) y los operadores/literales quedan a un `$` de distancia.
    return { tipo: ultimoSeparador === ":" ? "valor" : "clave", desde, prefijo, enOperador };
  }
  return { tipo: "clave", desde, prefijo, enOperador };
}

const OPERADORES: Candidato[] = [
  { insercion: "$eq", etiqueta: "$eq", detalle: "Igual a", sql: "=", tipo: "operador" },
  { insercion: "$ne", etiqueta: "$ne", detalle: "Distinto (también trae los que no tienen el campo)", sql: "<>", tipo: "operador" },
  { insercion: "$gt", etiqueta: "$gt", detalle: "Mayor que", sql: ">", tipo: "operador" },
  { insercion: "$gte", etiqueta: "$gte", detalle: "Mayor o igual", sql: ">=", tipo: "operador" },
  { insercion: "$lt", etiqueta: "$lt", detalle: "Menor que", sql: "<", tipo: "operador" },
  { insercion: "$lte", etiqueta: "$lte", detalle: "Menor o igual", sql: "<=", tipo: "operador" },
  { insercion: "$in", etiqueta: "$in", detalle: "Está en la lista", sql: "IN (…)", tipo: "operador" },
  { insercion: "$nin", etiqueta: "$nin", detalle: "No está en la lista", sql: "NOT IN (…)", tipo: "operador" },
  { insercion: "$regex", etiqueta: "$regex", detalle: "Coincide con la expresión: así se hace un LIKE", sql: "LIKE", tipo: "operador" },
  { insercion: "$options", etiqueta: "$options", detalle: "Opciones del $regex: «i» ignora mayúsculas", tipo: "operador" },
  { insercion: "$exists", etiqueta: "$exists", detalle: "El campo existe (true) o no (false)", tipo: "operador" },
  { insercion: "$type", etiqueta: "$type", detalle: "El campo es de un tipo BSON", tipo: "operador" },
  { insercion: "$all", etiqueta: "$all", detalle: "El array contiene todos los valores", tipo: "operador" },
  { insercion: "$size", etiqueta: "$size", detalle: "El array tiene N elementos", tipo: "operador" },
  { insercion: "$elemMatch", etiqueta: "$elemMatch", detalle: "Algún elemento del array cumple una condición", tipo: "operador" },
  { insercion: "$not", etiqueta: "$not", detalle: "Niega una condición", tipo: "operador" },
  { insercion: "$and", etiqueta: "$and", detalle: "Se cumplen todas", sql: "AND", tipo: "operador" },
  { insercion: "$or", etiqueta: "$or", detalle: "Se cumple alguna", sql: "OR", tipo: "operador" },
  { insercion: "$nor", etiqueta: "$nor", detalle: "No se cumple ninguna", sql: "NOT (…)", tipo: "operador" },
];

const LITERALES: Candidato[] = [
  { insercion: '"texto"', etiqueta: '"texto"', detalle: "Una cadena: escribe encima tu valor", tipo: "literal" },
  { insercion: "0", etiqueta: "0", detalle: "Un número", tipo: "literal" },
  { insercion: "true", etiqueta: "true", detalle: "Verdadero", tipo: "literal" },
  { insercion: "false", etiqueta: "false", detalle: "Falso", tipo: "literal" },
  { insercion: "null", etiqueta: "null", detalle: "Nulo (también encuentra los que no tienen el campo)", sql: "IS NULL", tipo: "literal" },
  { insercion: 'ObjectId("")', etiqueta: "ObjectId(…)", detalle: "Buscar por _id u otra referencia", tipo: "constructor" },
  { insercion: 'ISODate("")', etiqueta: "ISODate(…)", detalle: "Una fecha (no un texto)", tipo: "constructor" },
];

/**
 * Candidatos para lo que se está escribiendo. `campos` son las rutas muestreadas de la colección
 * (`detalle.pais`), que es lo que Mongo sí detecta y aquí se aprovecha.
 */
export function candidatosEn(ctx: Contexto, campos: string[]): Candidato[] {
  const prefijo = ctx.prefijo.toLowerCase();

  if (ctx.tipo === "clave") {
    return campos
      .filter((c) => c.toLowerCase().includes(prefijo))
      // Primero los que EMPIEZAN por lo escrito: es lo que se está tecleando.
      .sort((a, b) => Number(!a.toLowerCase().startsWith(prefijo)) - Number(!b.toLowerCase().startsWith(prefijo)))
      .slice(0, 12)
      .map((campo) => ({
        insercion: campo.includes(".") ? `"${campo}"` : campo,
        etiqueta: campo,
        detalle: campo.includes(".") ? "Campo de un subdocumento" : "Campo de la colección",
        tipo: "campo" as const,
      }));
  }

  if (ctx.tipo === "valor") {
    // Escribiendo `$…`: solo operadores. Sin `$`: literales y constructores (y operadores al escribir `$`).
    // Operadores primero: es lo que no se sabe de memoria. Los literales van después. Sin tope: la
    // lista tiene scroll y cortar aquí escondería justo `$regex`, que es el que se busca.
    const base = ctx.enOperador ? OPERADORES : [...OPERADORES, ...LITERALES];
    return base.filter((c) => c.etiqueta.toLowerCase().includes(prefijo));
  }

  return [];
}

/**
 * Texto y cursor después de aceptar un candidato: se reemplaza la palabra en curso (`desde`…`cursor`)
 * por la inserción. Devuelve también cuánto se avanzó, para poder seleccionar un hueco (el `""` de
 * `ObjectId("")`) si lo hay.
 */
export function aplicarCandidato(
  texto: string,
  cursor: number,
  desde: number,
  insercion: string
): { texto: string; cursor: number; hueco: { inicio: number; fin: number } | null } {
  const nuevo = texto.slice(0, desde) + insercion + texto.slice(cursor);
  const finCursor = desde + insercion.length;

  // Los constructores llevan `""` dentro: dejar el cursor dentro ahorra un clic.
  const dentro = insercion.indexOf('""');
  if (dentro >= 0) {
    return {
      texto: nuevo,
      cursor: desde + dentro + 1,
      hueco: { inicio: desde + dentro + 1, fin: desde + dentro + 1 },
    };
  }
  return { texto: nuevo, cursor: finCursor, hueco: null };
}
