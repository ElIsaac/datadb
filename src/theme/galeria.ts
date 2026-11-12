/**
 * R98 (T1) — lógica pura de la galería de temas del diálogo «Apariencia»: filtros por tipo
 * (Todos / Oscuros / Claros), búsqueda por nombre y los conteos de los chips.
 *
 * Los conteos se CALCULAN (con la búsqueda aplicada), nunca se escriben: la maqueta de Open Design
 * traía números fijos que no cuadraban con la lista (`design/propuesta-apariencia.png`).
 */
import type { PaletteDef } from "./palettes";

export type FiltroDeTemas = "todos" | "oscuros" | "claros";

/** Sin mayúsculas ni acentos: «rose» casa con «Rosé Pine». */
export function normalizarBusqueda(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function casa(p: PaletteDef, busqueda: string): boolean {
  const b = normalizarBusqueda(busqueda);
  return !b || normalizarBusqueda(p.label).includes(b) || p.id.includes(b);
}

/** Los temas que se ven con este filtro y esta búsqueda, en el orden del catálogo. */
export function temasVisibles(
  paletas: readonly PaletteDef[],
  filtro: FiltroDeTemas,
  busqueda: string
): PaletteDef[] {
  return paletas.filter(
    (p) => casa(p, busqueda) && (filtro === "todos" || (filtro === "oscuros" ? p.dark : !p.dark))
  );
}

/** Conteos de los chips con la búsqueda aplicada (así el chip dice cuántos hay de verdad). */
export function conteosDeTemas(
  paletas: readonly PaletteDef[],
  busqueda: string
): Record<FiltroDeTemas, number> {
  const visibles = paletas.filter((p) => casa(p, busqueda));
  return {
    todos: visibles.length,
    oscuros: visibles.filter((p) => p.dark).length,
    claros: visibles.filter((p) => !p.dark).length,
  };
}
