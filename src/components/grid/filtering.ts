/**
 * Filtro local del grid (fase 13, R38).
 *
 * Es la fila de filtros de DataGrip: una condición por columna que reduce lo que se VE, sin volver
 * a preguntar a la base. El campo `WHERE` (el que sí re-consulta) es otra cosa y vive en la vista
 * de tabla (`table-view-tab.tsx`).
 *
 * Por qué es un módulo puro: es donde están los casos que se rompen de verdad —los NULL, los
 * números que llegan como cadena desde el driver (`numeric`/`bigint` pierden precisión si se
 * convierten), el `jsonb` que en crudo es un objeto, y el operador escrito a medias— y donde se
 * puede probar sin ventana ni base. Mismo motivo y misma forma que `sorting.ts`, con el que este
 * módulo se compone: filtrar devuelve una lista de índices, ordenar la reordena, y **ninguno de los
 * dos mueve el array de filas** (ver el porqué en `sorting.ts`: los cambios pendientes del
 * contenedor apuntan a la posición ORIGINAL).
 *
 * Semántica decidida con el usuario (D2 de la fase): lo que se escribe es «contiene» sin distinguir
 * mayúsculas, con prefijos de operador (`>`, `>=`, `<`, `<=`, `=`, `!=`) y las palabras `null` /
 * `!null`. Deliberadamente NO es SQL: escribir una condición a medias (`>`) no puede vaciar la
 * rejilla, porque el usuario está tecleando.
 */

import { cellText } from "@/lib/cell-value";
import { aNumero } from "./sorting";

/** Operadores de prefijo, del más largo al más corto: `<=` tiene que probarse antes que `<`. */
export const OPERADORES = [">=", "<=", "!=", "=", ">", "<"] as const;
export type Operador = (typeof OPERADORES)[number];

export type Condicion =
  /** Subcadena, sin distinguir mayúsculas (los acentos SÍ cuentan, como en DataGrip). */
  | { tipo: "contiene"; texto: string }
  /** Comparación: numérica si los DOS lados lo parecen, de texto si no. */
  | { tipo: "op"; op: Operador; valor: string }
  /** `null` enseña sólo los NULL; `!null` los esconde. */
  | { tipo: "nulo"; negado: boolean };

/** Lo que hay escrito en la fila de filtros: columna → texto crudo (tal como lo tecleó el usuario). */
export type TextosDeFiltro = Readonly<Record<string, string>>;

/**
 * Firma de las columnas de un result set, para decidir si los filtros escritos siguen teniendo
 * sentido (fase 13, T4).
 *
 * Por qué columnas y no «¿cambió el `result`?»: refrescar, paginar y aplicar un `WHERE` traen un
 * `result` NUEVO con las MISMAS columnas, y en esos tres casos el usuario espera conservar el filtro
 * (medido en el código: la paginación de `app-shell.tsx` reutiliza el id de la pestaña). Sólo cuando
 * cambian las columnas un filtro viejo deja de apuntar a algo y hay que quitarlo.
 */
export function firmaDeColumnas(columnas: readonly { name: string }[]): string {
  return columnas.map((c) => c.name).join("\u0000");
}

export interface FiltroDeColumna {
  columna: string;
  condicion: Condicion;
}

/**
 * Traduce lo escrito en una celda de la fila de filtros a una condición.
 *
 * `null` significa «esta columna no filtra». Las palabras clave se reconocen sin distinguir
 * mayúsculas ni espacios alrededor (` NULL `, `null` y `Null` son lo mismo).
 *
 * Sobre el operador sin nada detrás: `>` a secas cae a «contiene». Es a propósito — mientras se
 * teclea `>=` se pasa por `>` sin valor, y descartar todas las filas en ese instante haría que la
 * rejilla parpadeara a vacío a medio escribir.
 */
export function parseCondicion(texto: string): Condicion | null {
  const t = texto.trim();
  if (t === "") return null;

  const minusculas = t.toLowerCase();
  if (minusculas === "null") return { tipo: "nulo", negado: false };
  // Las tres formas de decir lo mismo: «!null» (lo que se teclea), «not null» (lo que se lee en
  // SQL) y «notnull» (lo que sale cuando se escriben las dos palabras juntas sin querer).
  if (minusculas === "!null" || minusculas === "not null" || minusculas === "notnull") {
    return { tipo: "nulo", negado: true };
  }

  for (const op of OPERADORES) {
    if (!t.startsWith(op)) continue;
    const resto = t.slice(op.length).trim();
    if (resto === "") break; // a medias: se trata como texto (ver arriba)
    return { tipo: "op", op, valor: resto };
  }

  return { tipo: "contiene", texto: t };
}

/**
 * Texto con el que se compara una celda, o `null` si es NULL.
 *
 * Para los primitivos NO se pasa por `cellText()`: esa función hace `JSON.stringify` en los objetos,
 * y filtrar son 100 000 filas × N columnas **en cada pulsación**. La ruta rápida cubre el caso
 * normal (cadenas y números) y sólo los objetos/arrays/binarios pagan la serialización.
 *
 * Se usa el MISMO texto que ve el usuario — y el mismo que copia y exporta — vía `cellText`, así que
 * un `jsonb` se filtra por su JSON compacto y no por `[object Object]` (el bug corregido el
 * 2026-10-09, que `grid.test.ts` ya vigila para la pintura).
 */
function textoDeValor(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "string") return valor;
  if (typeof valor === "number" || typeof valor === "boolean" || typeof valor === "bigint") {
    return String(valor);
  }
  return cellText(valor);
}

/**
 * ¿Casa la celda con la condición?
 *
 * Reglas, en el orden en que importan:
 *
 * 1. **Un NULL no contiene nada y no casa con ningún operador.** Es lo que hace SQL (`NULL > 10` es
 *    desconocido, no verdadero) y evita el sorpresón de que `!=10` deje fuera las filas con NULL
 *    cuando lo que se quiere es «los que no son 10». Para verlos está `null`; para esconderlos,
 *    `!null`.
 * 2. **Los números se comparan como números aunque lleguen como cadena**: `numeric`, `bigint` y
 *    `decimal` llegan del driver en texto para no perder precisión, y comparar `"9"` con `"10"` como
 *    cadenas pondría el 10 primero. Mismo criterio que el orden (`aNumero`).
 * 3. **Los operadores de texto comparan con `localeCompare` y orden natural**: así una fecha ISO
 *    (`2026-01-02`) se compara como fecha por el orden de sus componentes, y «fila 2» va antes que
 *    «fila 10» en un `>`.
 * 4. **`=` y `!=` son exactos** (no «contiene»): `=activo` no casa con `inactivo`. Sin distinguir
 *    mayúsculas sería imposible distinguir «igual a» de «contiene», que es justo lo que el prefijo
 *    viene a pedir.
 */
export function casaCondicion(valor: unknown, condicion: Condicion): boolean {
  if (condicion.tipo === "nulo") {
    const esNulo = valor === null || valor === undefined;
    return condicion.negado ? !esNulo : esNulo;
  }

  const texto = textoDeValor(valor);
  if (texto === null) return false; // regla 1

  if (condicion.tipo === "contiene") {
    // Mayúsculas no distinguen; acentos sí (DataGrip tampoco los pliega, y plegarlos haría que «o»
    // encontrara «ó», que en una lista de valores distintos es una sorpresa desagradable).
    return texto.toLocaleLowerCase("es").includes(condicion.texto.toLocaleLowerCase("es"));
  }

  const nCelda = aNumero(valor);
  const nFiltro = aNumero(condicion.valor);

  if (condicion.op === "=" || condicion.op === "!=") {
    const iguales =
      nCelda !== null && nFiltro !== null
        ? nCelda === nFiltro // regla 2: "10.0" es igual a 10
        : texto === condicion.valor; // regla 4: exacto
    return condicion.op === "=" ? iguales : !iguales;
  }

  if (nCelda !== null && nFiltro !== null) {
    switch (condicion.op) {
      case ">":
        return nCelda > nFiltro;
      case ">=":
        return nCelda >= nFiltro;
      case "<":
        return nCelda < nFiltro;
      case "<=":
        return nCelda <= nFiltro;
    }
  }

  // Texto (regla 3). `numeric: true` para que "fila 2" < "fila 10".
  const comparacion = texto.localeCompare(condicion.valor, "es", { numeric: true });
  switch (condicion.op) {
    case ">":
      return comparacion > 0;
    case ">=":
      return comparacion >= 0;
    case "<":
      return comparacion < 0;
    case "<=":
      return comparacion <= 0;
  }
  // Inalcanzable (los seis operadores están cubiertos arriba), pero TypeScript no lo sabe sin él.
  return false;
}

/** Las condiciones activas de lo que hay escrito, ya parseadas. Descarta las columnas vacías. */
export function parsearFiltros(textos: TextosDeFiltro): FiltroDeColumna[] {
  const activos: FiltroDeColumna[] = [];
  for (const [columna, texto] of Object.entries(textos)) {
    const condicion = parseCondicion(texto);
    if (condicion) activos.push({ columna, condicion });
  }
  return activos;
}

/** ¿Hay algún filtro puesto? Es lo que decide si el contador dice «n de N filas». */
export function hayFiltro(textos: TextosDeFiltro): boolean {
  return Object.values(textos).some((texto) => parseCondicion(texto) !== null);
}

/**
 * Índices de las filas que pasan el filtro, **del array ORIGINAL** (no posiciones correlativas).
 *
 * Es la invariante que sostiene toda la fase: el contenedor guarda sus cambios pendientes (celdas
 * editadas, filas nuevas, filas a borrar) contra la posición original, así que devolver `[0,1,2…]`
 * reapuntaría cada edición a otra fila — y eso no se nota hasta que ya se guardó.
 *
 * `siempreVisibles` es la excepción de D4: una fila con cambios sin guardar se enseña aunque no
 * case, para que filtrar no se lleve por delante una edición que el usuario todavía no ha
 * confirmado. El contenedor decide qué índices son ésos; aquí sólo se respetan.
 */
export function filtrarIndices(
  filas: readonly Record<string, unknown>[],
  condiciones: readonly FiltroDeColumna[],
  siempreVisibles?: ReadonlySet<number>
): number[] {
  const indices: number[] = [];

  if (condiciones.length === 0) {
    for (let i = 0; i < filas.length; i++) indices.push(i);
    return indices;
  }

  for (let i = 0; i < filas.length; i++) {
    if (siempreVisibles?.has(i)) {
      indices.push(i);
      continue;
    }
    const fila = filas[i];
    if (!fila) continue;

    let casa = true;
    for (const { columna, condicion } of condiciones) {
      if (!casaCondicion(fila[columna], condicion)) {
        casa = false;
        break; // AND entre columnas: con una que falle, la fila se va
      }
    }
    if (casa) indices.push(i);
  }

  return indices;
}
