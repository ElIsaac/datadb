/**
 * Sugerencias para la barra de consulta de MongoDB (fase 82).
 *
 * POR QUÉ EXISTE: el usuario no usa Mongo a diario y tenía que buscar por fuera cómo se escribe lo
 * que en SQL sabe de memoria («¿cómo hago un LIKE?»). Estas plantillas son la respuesta corta, con
 * su equivalente en SQL cuando lo hay.
 *
 * REGLA QUE SE CUMPLE POR TEST: **toda plantilla es una consulta válida** con el normalizador de la
 * barra (`normalizarConsulta`) y con `EJSON.parse`. Un ejemplo que no se puede ejecutar enseña mal y
 * encima hace perder tiempo al depurarlo. Por eso no se usa la forma `/texto/i` (que Compass acepta,
 * pero es un literal de JavaScript, no JSON): se usa `$regex` + `$options`, que viaja igual y sí es
 * válido. Los valores van con datos reales de ejemplo (`ObjectId` de 24 hex, fecha ISO) para que se
 * puedan ejecutar tal cual y solo haga falta cambiarlos.
 */

export interface SugerenciaMongo {
  /** Qué hace, en el idioma del usuario. */
  etiqueta: string;
  /** Equivalente en SQL, si existe. Es lo que engancha con lo que ya sabe. */
  sql?: string;
  /** Plantilla lista para la barra de consulta (JSON/EJSON válido con el normalizador). */
  plantilla: string;
  /** Nota corta: cuándo NO sirve o qué tener en cuenta. */
  nota?: string;
}

export interface GrupoDeSugerencias {
  titulo: string;
  items: SugerenciaMongo[];
}

export const SUGERENCIAS_MONGO: GrupoDeSugerencias[] = [
  {
    titulo: "Como en SQL",
    items: [
      {
        etiqueta: "Contiene texto",
        sql: "LIKE '%texto%'",
        plantilla: '{ campo: { $regex: "texto", $options: "i" } }',
        nota: "Sin distinguir mayúsculas. Quitá $options para que sí las distinga.",
      },
      {
        etiqueta: "Empieza con",
        sql: "LIKE 'texto%'",
        plantilla: '{ campo: { $regex: "^texto", $options: "i" } }',
      },
      {
        etiqueta: "Termina con",
        sql: "LIKE '%texto'",
        plantilla: '{ campo: { $regex: "texto$", $options: "i" } }',
      },
      {
        etiqueta: "Igual a",
        sql: "= 'texto'",
        plantilla: '{ campo: "texto" }',
      },
      {
        etiqueta: "Distinto de",
        sql: "<> 'texto'",
        plantilla: '{ campo: { $ne: "texto" } }',
        nota: "También trae los documentos donde el campo NO existe.",
      },
      {
        etiqueta: "Está en la lista",
        sql: "IN ('a', 'b')",
        plantilla: '{ campo: { $in: ["a", "b"] } }',
      },
      {
        etiqueta: "No está en la lista",
        sql: "NOT IN ('a', 'b')",
        plantilla: '{ campo: { $nin: ["a", "b"] } }',
      },
      {
        etiqueta: "Es nulo",
        sql: "IS NULL",
        plantilla: "{ campo: null }",
        nota: "En Mongo, null también encuentra los documentos sin ese campo.",
      },
      {
        etiqueta: "No es nulo ni falta",
        sql: "IS NOT NULL",
        plantilla: '{ campo: { $ne: null } }',
      },
    ],
  },
  {
    titulo: "Números y fechas",
    items: [
      {
        etiqueta: "Mayor que",
        sql: "> 10",
        plantilla: "{ campo: { $gt: 10 } }",
      },
      {
        etiqueta: "Mayor o igual",
        sql: ">= 10",
        plantilla: "{ campo: { $gte: 10 } }",
      },
      {
        etiqueta: "Menor que",
        sql: "< 10",
        plantilla: "{ campo: { $lt: 10 } }",
      },
      {
        etiqueta: "Entre dos valores",
        sql: "BETWEEN 10 AND 20",
        plantilla: "{ campo: { $gte: 10, $lte: 20 } }",
      },
      {
        etiqueta: "Desde una fecha",
        sql: ">= '2024-01-01'",
        plantilla: '{ campo: { $gte: ISODate("2024-01-01T00:00:00Z") } }',
        nota: "Con ISODate el driver compara fechas, no texto.",
      },
      {
        etiqueta: "Rango de fechas",
        plantilla:
          '{ campo: { $gte: ISODate("2024-01-01T00:00:00Z"), $lt: ISODate("2024-02-01T00:00:00Z") } }',
      },
    ],
  },
  {
    titulo: "Objetos y arrays",
    items: [
      {
        etiqueta: "Campo de un subdocumento",
        sql: "detalle.pais = 'MX'",
        plantilla: '{ "detalle.pais": "MX" }',
        nota: "La ruta va entre comillas: el punto es parte del nombre.",
      },
      {
        etiqueta: "El array contiene un valor",
        plantilla: '{ tags: "valor" }',
        nota: "No hace falta $in: un array coincide si contiene el valor.",
      },
      {
        etiqueta: "El array contiene todos",
        plantilla: '{ tags: { $all: ["a", "b"] } }',
      },
      {
        etiqueta: "El array tiene N elementos",
        plantilla: "{ tags: { $size: 3 } }",
      },
      {
        etiqueta: "El campo existe",
        sql: "IS NOT NULL (solo por existencia)",
        plantilla: "{ campo: { $exists: true } }",
      },
      {
        etiqueta: "El campo no existe",
        plantilla: "{ campo: { $exists: false } }",
      },
    ],
  },
  {
    titulo: "Combinar condiciones",
    items: [
      {
        etiqueta: "Se cumplen las dos (Y)",
        sql: "AND",
        plantilla: '{ $and: [ { a: 1 }, { b: "x" } ] }',
        nota: "Con campos distintos alcanza con ponerlos juntos: { a: 1, b: \"x\" }. $and se usa cuando la misma clave se repite.",
      },
      {
        etiqueta: "Se cumple alguna (O)",
        sql: "OR",
        plantilla: '{ $or: [ { a: 1 }, { b: "x" } ] }',
      },
      {
        etiqueta: "Ninguna se cumple (NI)",
        sql: "NOT (...)",
        plantilla: '{ $nor: [ { a: 1 }, { b: "x" } ] }',
      },
      {
        etiqueta: "Negar una condición",
        plantilla: "{ campo: { $not: { $gt: 10 } } }",
      },
    ],
  },
  {
    titulo: "Lo propio de Mongo",
    items: [
      {
        etiqueta: "Buscar por _id",
        plantilla: '{ _id: ObjectId("6718190465448bf0ae986f6b") }',
        nota: "El id va SIN comillas alrededor: ObjectId(...) es un valor, no texto.",
      },
      {
        etiqueta: "Los últimos N por fecha",
        plantilla: '{ creado: { $gte: ISODate("2024-01-01T00:00:00Z") } }',
        nota: "Después poné en Opciones ▸ orden: { creado: -1 }.",
      },
    ],
  },
];

/** Aplana los grupos: útil para buscar y para los tests. */
export function todasLasSugerencias(): SugerenciaMongo[] {
  return SUGERENCIAS_MONGO.flatMap((g) => g.items);
}

/**
 * Filtra por texto libre (lo que el usuario escribe en el buscador de sugerencias). Busca en la
 * etiqueta, en el equivalente SQL y en la plantilla: escribir «like» o «$regex» llega a lo mismo.
 */
export function filtrarSugerencias(texto: string): GrupoDeSugerencias[] {
  const q = texto.trim().toLowerCase();
  if (!q) return SUGERENCIAS_MONGO;
  return SUGERENCIAS_MONGO.map((g) => ({
    titulo: g.titulo,
    items: g.items.filter((i) =>
      [i.etiqueta, i.sql ?? "", i.plantilla, i.nota ?? ""].join(" ").toLowerCase().includes(q)
    ),
  })).filter((g) => g.items.length > 0);
}

/**
 * Posición del primer texto entrecomillado de una plantilla, para dejarlo SELECCIONADO al insertarla:
 * el usuario escribe encima y la consulta queda suya sin borrar nada. `null` si no hay ningún valor
 * de ejemplo (p. ej. una plantilla de solo operadores).
 */
export function primerHueco(plantilla: string): { inicio: number; fin: number } | null {
  // Se busca el contenido de la primera cadena, sea dentro de una clave o de un valor.
  const m = /"([^"\\]*)"/.exec(plantilla);
  if (!m) return null;
  const inicio = m.index + 1;
  return { inicio, fin: inicio + m[1].length };
}
