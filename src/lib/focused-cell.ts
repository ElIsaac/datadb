/**
 * La celda activa, para el value editor (fase 12, R37).
 *
 * Por qué un store y no una prop: el panel del valor vive en el **dock derecho** (D1), que lo pinta
 * `app-shell.tsx`, mientras que quien sabe qué celda está enfocada es `results-grid.tsx` — y hay
 * **dos** instancias suyas (el panel de resultados de la consola y la pestaña de ver tabla). Pasar
 * esto por props obligaría a subir el estado hasta la raíz y a bajarlo por dos ramas distintas del
 * árbol; un store de módulo con `useSyncExternalStore` es el mismo patrón que ya usan
 * `theme-store.ts` y `data-settings.ts`.
 *
 * NO se persiste: la celda enfocada es estado efímero de la sesión, no una preferencia.
 *
 * El `confirmar` lo publica la rejilla que tiene el foco, y es lo que permite que el panel escriba
 * de vuelta SIN conocer a `results-grid` (fase 12, T5, D3: el valor entra por la misma barra de
 * cambios pendientes que cualquier otra edición, nunca directo a la base).
 */
import { useSyncExternalStore } from "react";

export interface CeldaEnfocada {
  /** Nombre real de la columna (no un id sintético). */
  columna: string;
  /** Tipo declarado de la columna, para decidir cómo se pinta el valor. */
  tipo: string;
  /** Índice en el array ORIGINAL de filas, que es contra el que se guardan los cambios. */
  indiceOriginal: number;
  /** Valor crudo tal y como lo devolvió el driver (objeto, Uint8Array, Date, primitivo…). */
  valor: unknown;
  /** `false` cuando la celda no se puede editar: sin contexto de tabla, clave primaria o binario. */
  editable: boolean;
  /**
   * Aplica un valor nuevo a esta celda. Lo publica la rejilla con el foco; el panel no sabe —ni
   * tiene por qué saber— a cuál de las dos rejillas está hablando.
   */
  confirmar?: (valor: unknown) => void;
}

let celda: CeldaEnfocada | null = null;
const listeners = new Set<() => void>();

export function getCeldaEnfocada(): CeldaEnfocada | null {
  return celda;
}

export function setCeldaEnfocada(siguiente: CeldaEnfocada | null) {
  // Comparación barata para no repintar el panel en cada movimiento del ratón sobre la misma celda:
  // la rejilla dispara su `onGridSelectionChange` también al arrastrar dentro de la celda activa.
  if (
    celda?.columna === siguiente?.columna &&
    celda?.indiceOriginal === siguiente?.indiceOriginal &&
    celda?.valor === siguiente?.valor &&
    celda?.editable === siguiente?.editable
  ) {
    return;
  }
  celda = siguiente;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useCeldaEnfocada(): CeldaEnfocada | null {
  return useSyncExternalStore(subscribe, getCeldaEnfocada, () => null);
}
