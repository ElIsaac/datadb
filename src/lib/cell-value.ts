/**
 * Texto de una celda de resultados (bug corregido el 2026-10-09).
 *
 * Los drivers no devuelven solo primitivos: `pg` convierte `json`/`jsonb` en objetos JS, los arrays de Postgres en
 * arrays JS y `bytea` en Buffer (que por IPC llega como Uint8Array). Antes todo pasaba por `String(value)`:
 * un jsonb salía como "[object Object]" (medido en la ventana con `{"vip": true}`), un array `{a,b}` como "a,b"
 * (perdiendo la estructura) y un binario como bytes sueltos — en la celda, al copiar, al editar y al exportar.
 *
 * Se centraliza aquí para que todos esos sitios formateen igual. JSON compacto (una línea, como DataGrip en la
 * celda); el visor de valores grandes (fase 12, R37) lo mostrará indentado.
 *
 * @returns el texto, o null si el valor es NULL/undefined (cada sitio decide si pinta "NULL", vacío, etc.).
 */
export function cellText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) {
    // Formato de salida de bytea en Postgres (`\x…`).
    return "\\x" + Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  if (value instanceof Date) return String(value); // sin cambios: las fechas tienen su propio tratamiento
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value); // referencias circulares: imposible desde un driver, pero sin romper la celda
    }
  }
  return String(value);
}
