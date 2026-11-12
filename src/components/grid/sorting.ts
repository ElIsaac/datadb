/**
 * Orden de filas del grid (fase 11, T4; multinivel en la fase 14, T2).
 *
 * El grid de hoy ordena con `@tanstack/react-table` (`enableSorting: true`). Al pasar a canvas no
 * hay tabla que ordene por nosotros, así que el orden se hace aquí — y se hace en un módulo puro
 * porque es donde están los casos que se rompen de verdad: los NULL, los números que llegan como
 * cadena desde el driver y las fechas.
 *
 * Desde la fase 14 (R39, decisión D1) el orden es MULTINIVEL, como el de DataGrip: `⌥`+clic en una
 * cabecera APILA un nivel detrás de los que ya había, y el clic sin modificador REEMPLAZA el orden
 * entero por esa columna. El estado es una lista de niveles en orden de precedencia (`OrdenDeGrid`)
 * y la lista VACÍA significa «sin orden»: una sola representación del caso «no hay orden» en vez de
 * dos (`null` y lista vacía), que es la clase de duplicado que acaba en un `if` de más en cada
 * consumidor.
 *
 * Qué NO es esto: la UI. Este módulo no sabe de canvas ni de eventos — quién decide si el clic
 * llevaba `⌥` es la rejilla (`data-grid.tsx`, spike T1) —, y el indicador de la cabecera (flecha +
 * número de nivel) lo pinta T3 leyendo `nivelDe`.
 */

/** Sentido de un nivel de orden. */
export type Direccion = "asc" | "desc";

/**
 * Un nivel de orden: la columna por la que se ordena y su sentido.
 */
export interface NivelDeOrden {
  columna: string;
  direccion: Direccion;
}

/**
 * El orden del grid: una lista de niveles, en orden de PRECEDENCIA.
 *
 * El nivel 1 decide; el 2 sólo desempata lo que el 1 dejó igual; el 3 lo que dejaron igual el 1 y
 * el 2; etc. La lista VACÍA es «sin orden» — es lo que enseña DataGrip cuando ninguna cabecera
 * tiene flecha, y adonde vuelve el ciclo de `siguienteOrden` al quitar el último nivel.
 *
 * Es `readonly` a propósito: los niveles se reemplazan, nunca se mutan. Un array mutado en el sitio
 * no cambiaría de identidad y React no volvería a calcular los índices (`data-grid.tsx` memoiza
 * sobre `orden`), así que la inmutabilidad aquí no es estilo: es corrección.
 */
export type OrdenDeGrid = readonly NivelDeOrden[];

/**
 * El colador del orden de texto, creado UNA vez a nivel de módulo (fase 14, T3).
 *
 * Hasta T3, `compararValores` hacía `String(a).localeCompare(String(b), "es", { numeric: true,
 * sensitivity: "base" })`, y eso costaba **~1,8 µs por llamada** (medido: 1 795 ms por 1 000 000 de
 * llamadas). El motivo es que cada `localeCompare` CONSTRUYE un colador nuevo — y ordenar una
 * columna de texto de 100 000 filas hace ~930 000 llamadas: **1,7 s solo en coladores**. Con una
 * constante de módulo, la misma comparación baja a **~0,14 µs** (143 ms por millón, medido con el
 * mismo script `perf-sorting-f14.ts`) y ordenar las 100 000 filas de texto pasa de 1 712 ms a
 * **137 ms** (mediana de 5); el orden de dos niveles con texto, de 2 862 ms a 225 ms.
 *
 * El resultado es EXACTAMENTE el mismo, y no por optimismo: la especificación (ECMA-402,
 * `String.prototype.localeCompare`) define que la comparación usa un `Intl.Collator` con esos
 * locales y esas opciones, así que `COLADOR.compare(a, b)` y `a.localeCompare(b, "es", …)` son la
 * misma operación. Lo fija el test «el colador de módulo da el MISMO resultado que localeCompare»
 * de `sorting.test.ts`, que compara los dos caminos par a par sobre acentos, mayúsculas, números
 * embebidos, la cadena vacía y `"fila 2"` vs `"fila 10"`.
 *
 * Es una constante de módulo (y no un parámetro o un `useMemo`) porque este módulo es PURO y sin
 * React: un `Intl.Collator` es inmutable y sin estado — no guarda nada entre llamadas —, así que
 * compartir la instancia es seguro. `sensitivity: "base"` es lo que pliega mayúsculas y acentos
 * («Mérida» = «merida»), y `numeric: true` lo que hace que "fila 2" vaya antes que "fila 10".
 */
const COLADOR = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

/**
 * Compara dos valores de celda de UN nivel.
 *
 * Reglas, en este orden:
 * 1. **Los NULL van siempre al final**, suban o bajen el resto. Es lo que hace DataGrip, y es lo
 *    útil: ordenar una columna para ver los valores grandes y encontrarte 400 NULL arriba es
 *    inservible. (Ojo: Postgres por defecto hace lo contrario en DESC; aquí manda la UI.) El «al
 *    final» es POR NIVEL: si el nivel 1 es NULL en las dos filas, aquí no se fuerza nada y decide
 *    el nivel 2 (o, agotados los niveles, el desempate por índice original de `ordenarIndices`).
 * 2. Si los dos parecen números, se comparan como números aunque lleguen como cadena: `numeric` y
 *    `bigint` llegan del driver como texto para no perder precisión, y comparar "10" con "9" como
 *    cadenas pone el 10 antes.
 * 3. El resto, como texto con orden natural y SIN distinguir mayúsculas ni acentos, para que
 *    "fila 2" vaya antes que "fila 10" y «Mérida» y «merida» cuenten como el mismo texto. Lo hace
 *    `COLADOR`, creado una vez a nivel de módulo (ver abajo): hasta T3 esto era un
 *    `String(a).localeCompare(...)` que construía un colador NUEVO en cada llamada.
 *
 * La dirección entra como parámetro (y no como una función por nivel) porque el multinivel la
 * cambia en cada nivel: el mismo par de filas se compara hacia arriba en un nivel y hacia abajo en
 * el siguiente.
 */
export function compararValores(a: unknown, b: unknown, direccion: Direccion): number {
  const aNulo = a === null || a === undefined;
  const bNulo = b === null || b === undefined;
  if (aNulo && bNulo) return 0;
  if (aNulo) return 1; // los nulos al final, sin importar la dirección
  if (bNulo) return -1;

  const signo = direccion === "asc" ? 1 : -1;

  if (typeof a === "boolean" || typeof b === "boolean") {
    return signo * (Number(a) - Number(b));
  }

  const na = aNumero(a);
  const nb = aNumero(b);
  if (na !== null && nb !== null) return signo * (na - nb);

  // El colador de módulo, no `localeCompare`: mismo resultado (ECMA-402), sin construir un colador
  // por llamada. Ver el porqué y los números en `COLADOR`.
  return signo * COLADOR.compare(String(a), String(b));
}

/**
 * Número si el valor lo es o lo parece (cadena numérica), si no `null`.
 *
 * Exportada desde que el filtro local (fase 13, `filtering.ts`) la necesita: el plan pide que el
 * filtro compare con el MISMO criterio que el orden — `numeric` y `bigint` llegan del driver como
 * texto, y una segunda implementación acabaría divergiendo (una ordenaría 9 antes que 10 y la otra
 * al revés), que es exactamente la clase de incoherencia que nadie nota hasta que confunde.
 */
export function aNumero(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Devuelve los ÍNDICES de las filas en el orden pedido, no las filas.
 *
 * Es a propósito: el grid guarda los cambios pendientes (celdas editadas, filas nuevas, filas a
 * borrar) contra la posición original de cada fila. Si se reordenara el array, una edición hecha
 * antes de ordenar apuntaría a otra fila — que es la clase de bug que se descubre cuando ya se
 * guardó. Con dos niveles el argumento no cambia: el segundo nivel no «reordena» el array, sólo
 * desempata la comparación.
 *
 * `candidatos` (fase 13): cuando el filtro local ya redujo el conjunto, aquí sólo hay que ordenar
 * lo que pasó el filtro. Se recibe como índices (no como filas) por lo mismo de arriba — y sin él,
 * el comportamiento es el de siempre: ordenar todo.
 *
 * Empate en TODOS los niveles: desempate explícito por índice original ascendente. Hoy el `sort` de
 * JavaScript ya es estable (ECMA-2019) y el desempate sería redundante, pero se escribe de todas
 * formas: así el resultado no depende de la implementación del motor ni del orden en que llegaron
 * los `candidatos`, y dos llamadas con los mismos datos dan EXACTAMENTE el mismo array (que es lo
 * que pide la no-regresión: reordenar no puede hacer bailar filas iguales).
 *
 * Con el orden vacío no se toca nada: se devuelven los índices tal cual (los candidatos en su orden
 * de entrada, o 0..n-1).
 */
export function ordenarIndices(
  filas: readonly Record<string, unknown>[],
  orden: OrdenDeGrid,
  candidatos?: readonly number[]
): number[] {
  const indices = candidatos ? [...candidatos] : filas.map((_, i) => i);
  if (orden.length === 0) return indices;
  return indices.sort((ia, ib) => {
    // Nivel a nivel: el primero que decida algo decide; los siguientes sólo ven empates.
    for (const nivel of orden) {
      const comparacion = compararValores(
        filas[ia]?.[nivel.columna],
        filas[ib]?.[nivel.columna],
        nivel.direccion
      );
      if (comparacion !== 0) return comparacion;
    }
    return ia - ib;
  });
}

/**
 * Siguiente estado del orden al pulsar una cabecera (decisión D1 de la fase 14, como DataGrip).
 *
 * Sin `apilar` (clic normal): el orden entero se REEMPLAZA por esa columna en ascendente. La única
 * excepción es cuando esa columna es el ÚNICO nivel — ahí el clic repetido cicla
 * asc → desc → sin orden, que es el ciclo de toda la vida (fase 11) y el gesto con el que se quita
 * un orden de un solo nivel sin tocar `⌥`.
 *
 * Con `apilar` (`⌥`+clic, el gesto de DataGrip): si la columna no estaba, se AÑADE AL FINAL en
 * ascendente (un nivel nuevo desempata, no manda); si ya estaba, el clic cicla SU dirección
 * asc → desc → fuera. Al ciclar, el nivel NO se mueve de sitio: `⌥`+clic sobre el nivel 2 lo pone
 * en desc sin adelantarlo al 1 — si se moviera, «apilar» sería «reordenar los niveles», que no es
 * lo que hace DataGrip. Al quitarlo, los niveles de detrás suben uno solos (los números de nivel
 * se recalculan con `nivelDe`, no se guardan en ningún sitio).
 *
 * Nada se muta: cada rama devuelve una lista nueva, que es lo que necesita el `setOrden` de React
 * para volver a calcular los índices.
 */
export function siguienteOrden(actual: OrdenDeGrid, columna: string, apilar = false): OrdenDeGrid {
  const indice = actual.findIndex((nivel) => nivel.columna === columna);

  if (!apilar) {
    // El ciclo asc → desc → sin orden sólo aplica si ESA columna es el único nivel.
    if (indice === 0 && actual.length === 1) {
      return actual[0].direccion === "asc" ? [{ columna, direccion: "desc" }] : [];
    }
    // Cualquier otro caso (otra columna, o un multinivel del que esta columna es parte): el clic
    // solo REEMPLAZA, como DataGrip.
    return [{ columna, direccion: "asc" }];
  }

  if (indice === -1) return [...actual, { columna, direccion: "asc" }];

  const nivel = actual[indice];
  if (nivel.direccion === "asc") {
    // asc → desc, en la MISMA posición.
    return actual.map((n, i) => (i === indice ? { columna, direccion: "desc" } : n));
  }
  // desc → fuera. Los niveles de detrás suben uno sin tocarlos.
  return actual.filter((_, i) => i !== indice);
}

/**
 * Posición de una columna dentro del orden, para el indicador de la cabecera (lo pinta T3).
 *
 * Devuelve el número de nivel (1 = el que manda), su dirección y cuántos niveles hay en total:
 * DataGrip enseña el número junto a la flecha sólo cuando hay dos niveles o más, y eso lo decide
 * quien pinta, no este módulo. `null` si la columna no está en el orden.
 *
 * Se calcula aquí y no en el componente porque es la misma pregunta que ya responde `siguienteOrden`
 * (¿en qué índice está esta columna?) y tenerla en dos sitios es la forma habitual de que el
 * indicador y el ciclo se desincronicen.
 */
export function nivelDe(
  orden: OrdenDeGrid,
  columna: string
): { nivel: number; direccion: Direccion; total: number } | null {
  const indice = orden.findIndex((nivel) => nivel.columna === columna);
  if (indice === -1) return null;
  return { nivel: indice + 1, direccion: orden[indice].direccion, total: orden.length };
}
