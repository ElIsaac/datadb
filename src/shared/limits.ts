/**
 * Tope de filas que la app trae de un result set, en un único sitio porque lo usan los dos lados:
 * el renderer (que lo manda en cada consulta) y los drivers (como valor por defecto cuando la
 * petición no trae límite).
 *
 * El valor sale de una medición, no de una intuición (fase 11, T1, contra Postgres 16 con una tabla
 * de 100 000 filas y 8 columnas, una de ellas `jsonb`):
 *
 * | filas   | base de datos | viaje por IPC | total | payload | memoria del renderer |
 * |---------|---------------|---------------|-------|---------|----------------------|
 * | 500     | 7 ms          | 6 ms          | 13 ms | 0,1 MB  | +0 MB                |
 * | 10 000  | 32 ms         | 48 ms         | 80 ms | 2,4 MB  | +4 MB                |
 * | 100 000 | 143 ms        | 499 ms        | 642 ms| 24,7 MB | +57 MB               |
 *
 * Dos cosas que conviene no olvidar al tocar esto:
 *
 * 1. **El cuello es el viaje, no la base.** A 100 000 filas Postgres tarda 143 ms y el trayecto
 *    hasta el renderer 499 ms (3,5×). Subir el tope sin cambiar el transporte compra poco.
 * 2. El coste es **lineal** en las tres columnas, así que el usuario puede estimar: cada 10 000
 *    filas de una tabla así son ~2,5 MB y ~60 ms.
 */

/**
 * Filas por consulta si el usuario no toca nada.
 *
 * Decisión del usuario (2026-10-20): 500, como DataGrip, que trae 500 filas por página cuando la
 * consulta no trae su propio límite. Antes era 100 000 — «medido viable» (642 ms / 57 MB contra
 * Postgres 16, tabla de arriba) pero inútil en la práctica: una consulta sin LIMIT sobre una tabla
 * grande congelaba la consola segundos y dejaba 57 MB vivos en el renderer por cada resultado.
 * El usuario ya puede subirlo con el selector de filas (presets de abajo); lo que cambia aquí es
 * el arranque por defecto.
 */
export const DEFAULT_MAX_ROWS = 500;

/**
 * Techo duro del ajuste. No es un capricho: a 500 000 filas el payload rondaría los 125 MB y el
 * viaje los 2,5 s según la medición lineal de arriba, y eso ya se nota como un cuelgue. Si alguna
 * vez hace falta más, lo que hay que cambiar es el transporte (streaming por bloques), no este
 * número.
 */
export const MAX_ROWS_CEILING = 500_000;

/**
 * Mínimo del ajuste.
 *
 * Era 100 (fase 11, con el argumento —no medido— de que por debajo la paginación molesta más de lo
 * que ayuda). Baja a 50 en la fase 13 porque el usuario pidió expresamente un preset de 50 filas
 * (D5 / R55), y con 100 de mínimo `clampMaxRows` convertía ese 50 en 100 **en silencio**: la sonda
 * eligió «50 filas» y la base recibió `LIMIT 100`. El preset más bajo y el mínimo tienen que ser el
 * mismo número, y lo fija un test.
 */
export const MIN_MAX_ROWS = 50;

/** Topes rápidos del selector de filas (fase 13, R55). 100 000 sigue disponible como preset. */
export const PRESETS_DE_FILAS = [50, 500, 100_000] as const;

/**
 * Acota un valor cualquiera (p. ej. lo que había guardado de una versión anterior) al rango útil.
 *
 * Ojo con la coerción: solo se acotan NÚMEROS. Un `""` o un `[]` valen 0 con `Number()`, y si se
 * acotaran acabarían en el mínimo — la app se pondría a traer 100 filas por consulta sin que nadie
 * lo hubiera pedido. Lo que no es un número es "no hay valor", y eso es el valor por defecto.
 * (Lo destapó el test de basura guardada, no la lectura del código.)
 */
export function clampMaxRows(valor: unknown): number {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return DEFAULT_MAX_ROWS;
  return Math.min(MAX_ROWS_CEILING, Math.max(MIN_MAX_ROWS, Math.floor(valor)));
}
