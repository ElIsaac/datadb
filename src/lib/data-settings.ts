/**
 * Preferencias de datos del usuario (fase 11, T2). Mismo patrón que `src/theme/theme-store.ts`:
 * `useSyncExternalStore` + localStorage, que en Electron vive en `userData` y sobrevive a reinicios.
 *
 * Hoy guarda dos cosas: cuántas filas se traen de un result set (fase 11) y **en qué formato copia
 * la rejilla** (fase 14, T6). Se hace como store y no como constante porque son exactamente las dos
 * cosas que un usuario quiere bajar/cambiar al conectarse a una tabla gorda por una VPN lenta.
 *
 * Un valor guardado corrupto no tumba nada: `maxRows` se acota con `clampMaxRows` y el formato se
 * valida con `esFormatoDeCopia`; si no hay forma, se usa el valor por defecto.
 */
import { useSyncExternalStore } from "react";
import { clampMaxRows, DEFAULT_MAX_ROWS } from "@/shared/limits";
import { esFormatoDeCopia, type FormatoDeCopia } from "@/components/grid/copy-as";

const STORAGE_KEY = "datadb-data-settings-v1";

export interface DataSettings {
  /** Filas máximas por result set. Ver la tabla de medidas en `src/shared/limits.ts`. */
  maxRows: number;
  /**
   * Formato con el que ⌘C copia la selección de la rejilla (fase 14, D2) — el «data extractor»
   * activo de DataGrip, que allí se elige en un desplegable de la barra de la rejilla.
   *
   * Por defecto `tsv`, que es lo que la rejilla copiaba antes de esta fase: el gesto no cambia.
   */
  formatoDeCopia: FormatoDeCopia;
}

/** El formato de copiado por defecto: TSV (D2/D5). */
export const FORMATO_DE_COPIA_POR_DEFECTO: FormatoDeCopia = "tsv";

const DEFAULT_SETTINGS: DataSettings = {
  maxRows: DEFAULT_MAX_ROWS,
  formatoDeCopia: FORMATO_DE_COPIA_POR_DEFECTO,
};

/**
 * Lee y SANA lo guardado (T6). Es una función pura y por eso está exportada: así la lectura
 * tolerante se prueba sin montar un localStorage ni pelearse con la caché de módulos.
 *
 * Tres casos que tienen que acabar en el formato por defecto en vez de propagarse:
 *
 * 1. la clave no está (todo el que ya usaba la app antes de esta fase) o el JSON entero está
 *    corrupto — ahí se devuelven los ajustes por defecto completos;
 * 2. el valor no es un formato conocido (versión futura, valor editado a mano, `null` explícito).
 *
 * La validación vive en `esFormatoDeCopia` (junto al tipo, en `grid/copy-as.ts`) para que añadir un
 * formato no obligue a tocar dos listas.
 */
export function parsearAjustes(raw: string | null): DataSettings {
  if (!raw) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(raw) as Partial<DataSettings>;
    return {
      maxRows: clampMaxRows(parsed?.maxRows),
      formatoDeCopia: esFormatoDeCopia(parsed?.formatoDeCopia)
        ? parsed.formatoDeCopia
        : FORMATO_DE_COPIA_POR_DEFECTO,
    };
  } catch (err) {
    console.error("[ajustes] Preferencias de datos inválidas; se usan las de por defecto", err);
    return DEFAULT_SETTINGS;
  }
}

function load(): DataSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  return parsearAjustes(window.localStorage.getItem(STORAGE_KEY));
}

let state: DataSettings = load();
const listeners = new Set<() => void>();

/** Guarda el estado en localStorage. El `catch` es el mismo para los dos setters. */
function persistir() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("[ajustes] No se pudieron guardar las preferencias de datos", err);
  }
}

export function getDataSettings(): DataSettings {
  return state;
}

export function setMaxRows(valor: number) {
  state = { ...state, maxRows: clampMaxRows(valor) };
  persistir();
  listeners.forEach((l) => l());
}

/**
 * Cambia el formato activo de copiado (T6, selector de la barra). Persiste y avisa a los
 * suscriptores.
 *
 * Un valor que no sea un formato conocido NO se guarda (se ignora): el tipo ya lo impide en
 * TypeScript, y esta guarda es para el camino que no pasa por el compilador (una llamada desde la
 * consola de DevTools, un test). Sin ella, `state.formatoDeCopia` podría quedar en un valor que
 * `copiarComo` no sabe formatear y el ⌘C siguiente no copiaría nada.
 */
export function setFormatoDeCopia(formato: FormatoDeCopia) {
  if (!esFormatoDeCopia(formato)) return;
  state = { ...state, formatoDeCopia: formato };
  persistir();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useDataSettings(): DataSettings {
  return useSyncExternalStore(subscribe, getDataSettings, () => DEFAULT_SETTINGS);
}
