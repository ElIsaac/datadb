/**
 * R99-A: anchos de columna de la rejilla de resultados, recordados entre sesiones.
 *
 * El problema que origina esto: glide-data-grid NO cambia el ancho por su cuenta. En cada `mousemove`
 * del borde de la cabecera llama a `onColumnResize` y espera que la app actualice el array de
 * columnas; sin contenedor que guarde los anchos, el ancho volvía a 150 px en el frame siguiente y
 * el arrastre «no hacía nada». `data-grid.tsx` ya exponía `anchos`/`onAnchoCambiado` — lo que
 * faltaba es justamente este store y el contenedor (`results-grid.tsx`) que los conecta.
 *
 * Mismo patrón EXACTO que `src/lib/data-settings.ts`: `useSyncExternalStore` + localStorage, que en
 * Electron vive en `userData` y sobrevive a reinicios. Las funciones de saneo y de clave son PURAS y
 * están exportadas para poder probarlas sin DOM (ver `grid-widths.test.ts`).
 *
 * Se recuerda POR PERFIL Y TABLA (`tabla:<perfil>:<esquema>.<tabla>`): los anchos que le sirven a
 * `acme.Banks_Bank` no le sirven a otra tabla, y mucho menos a otro perfil conectado a otra base.
 * Cuando el resultado no sale de una tabla (una consulta libre, un JOIN), la clave es la FIRMA DE
 * COLUMNAS (`consulta:<firma>`, `firmaDeColumnas` de `components/grid/filtering`): misma lista de
 * columnas en el mismo orden → mismos anchos, que es la mejor aproximación a «la misma consulta».
 */
import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "datadb-grid-widths-v1";

/** Por debajo de esto una columna no se puede leer. glide no impone mínimo propio. */
export const ANCHO_MINIMO = 40;
/** Techo generoso: una columna de 2000 px ya desborda cualquier ventana, y sin techo un JSON
 * editado a mano (o un bug) podría colarla a millones. */
export const ANCHO_MAXIMO = 2000;

/** Lo que hay guardado: clave (`tabla:…` / `consulta:…`) → anchos de esa rejilla. */
type AnchosPorClave = Record<string, Record<string, number>>;

/**
 * Sanea UN registro de anchos (el valor de una clave del JSON guardado). PURA y exportada para
 * probarla sin montar localStorage.
 *
 * Acepta sólo números finitos; los redondea (glide trabaja con px enteros) y los acota a
 * `[ANCHO_MINIMO, ANCHO_MAXIMO]`. Ignora claves vacías y valores no numéricos. Si `raw` no es un
 * objeto (null, un string corrupto…) o es un array —lo que este módulo nunca guarda, y cuyas claves
 * de índice no son nombres de columna—, devuelve `{}`: un JSON podrido no puede tumbar la rejilla,
 * sólo resetear los anchos — el mismo criterio tolerante de `parsearAjustes`.
 */
export function sanearAnchos(raw: unknown): Record<string, number> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const entrada = raw as Record<string, unknown>;
  const salida: Record<string, number> = {};
  for (const [clave, valor] of Object.entries(entrada)) {
    if (!clave) continue;
    if (typeof valor !== "number" || !Number.isFinite(valor)) continue;
    const entero = Math.round(valor);
    salida[clave] = Math.min(ANCHO_MAXIMO, Math.max(ANCHO_MINIMO, entero));
  }
  return salida;
}

/** De dónde sale el resultado cuya rejilla se está dimensionando. */
export interface OrigenDeAnchos {
  /** Perfil de la sesión activa; `null` si no la hay (sólo puede pasar sin tabla). */
  profileId: string | null;
  schema?: string;
  table?: string;
  /** `firmaDeColumnas(result.columns)`: se ignora si hay `schema`+`table`. */
  firma: string;
}

/**
 * Clave del store para una rejilla. PURA. Con tabla: `tabla:<profileId>:<schema>.<table>`, TODO en
 * minúsculas (los motores suelen tratar los identificadores sin caso, y así `Acme.Banks_Bank` y
 * `acme.banks_bank` comparten anchos). Sin tabla: `consulta:<firma>`.
 */
export function claveDeAnchos(origen: OrigenDeAnchos): string {
  if (origen.schema && origen.table) {
    const perfil = (origen.profileId ?? "").toLowerCase();
    return `tabla:${perfil}:${origen.schema.toLowerCase()}.${origen.table.toLowerCase()}`;
  }
  return `consulta:${origen.firma}`;
}

function load(): AnchosPorClave {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return {};
    const saneado: AnchosPorClave = {};
    for (const [clave, anchos] of Object.entries(parsed as Record<string, unknown>)) {
      if (!clave) continue;
      const registro = sanearAnchos(anchos);
      if (Object.keys(registro).length > 0) saneado[clave] = registro;
    }
    return saneado;
  } catch (err) {
    console.error("[anchos-rejilla] JSON inválido en localStorage; se empieza de cero", err);
    return {};
  }
}

let state: AnchosPorClave = load();
const listeners = new Set<() => void>();

/**
 * Caché de snapshots POR CLAVE. `useSyncExternalStore` compara el snapshot con `Object.is` en cada
 * render: si devolviéramos `state[clave] ?? {}` construyendo un objeto nuevo, React entraría en
 * bucle infinito. Con la caché, la misma clave devuelve SIEMPRE el mismo objeto mientras no cambie.
 */
const instantaneas = new Map<string, Record<string, number>>();
const VACIO: Record<string, number> = {};

function snapshotDe(clave: string): Record<string, number> {
  const enCaché = instantaneas.get(clave);
  if (enCaché) return enCaché;
  const nuevo = state[clave] ?? VACIO;
  instantaneas.set(clave, nuevo);
  return nuevo;
}

function persistir() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("[anchos-rejilla] No se pudieron guardar los anchos de columna", err);
  }
}

/** Guarda el ancho de UNA columna de UNA clave, persiste y avisa a los suscriptores. */
function setAncho(clave: string, columna: string, ancho: number) {
  const saneado = sanearAnchos({ [columna]: ancho })[columna];
  if (saneado === undefined) return;
  const previo = snapshotDe(clave);
  const nuevo = { ...previo, [columna]: saneado };
  state = { ...state, [clave]: nuevo };
  instantaneas.set(clave, nuevo);
  persistir();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * Anchos de la rejilla con esa clave y el callback para `onAnchoCambiado` del grid. El snapshot es
 * estable por clave (ver `instantaneas`) y `cambiarAncho` es estable mientras lo sea la clave, para
 * no re-renderizar la rejilla en balde.
 */
export function useAnchosDeRejilla(
  clave: string
): [Record<string, number>, (columna: string, ancho: number) => void] {
  const anchos = useSyncExternalStore(
    subscribe,
    () => snapshotDe(clave),
    () => VACIO
  );
  /** `setAncho` fijado a la clave: identidad estable mientras lo sea la clave. */
  const cambiarAncho = useCallback(
    (columna: string, ancho: number) => setAncho(clave, columna, ancho),
    [clave]
  );
  return [anchos, cambiarAncho];
}
