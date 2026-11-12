/**
 * Favoritos del explorador (fase 84).
 *
 * POR QUÉ CAMBIA: hasta ahora vivían en `localStorage` con una clave derivada de la SESIÓN
 * (`gdb:favorites:<nombre>:<tipo>:<base>`) y se guardaban en un efecto que corría en CADA cambio de
 * estado. Eso tiene tres formas de perder datos, y el usuario reportó una («cierro y al abrir no
 * están»):
 *  1. la clave cambia al cambiar de BASE o al renombrar la conexión, así que los favoritos quedan en
 *     una clave que ya nadie lee;
 *  2. el array de favoritos es UNO SOLO para toda la app: dos consolas con conexiones distintas se
 *     pisan (el último que guarda gana) y al cambiar de consola se carga la lista de la otra;
 *  3. como se guarda en cada cambio de estado, cualquier arranque que deje el array vacío (antes de
 *     que termine la carga) escribe `[]` encima de lo guardado.
 *
 * AHORA: un archivo `favorites.json` en el directorio de datos (`data/`, junto a `connections.json`),
 * **por id de perfil** —que es estable entre sesiones, reconexiones y renombrados—, y se escribe SOLO
 * cuando el usuario marca o desmarca. La base va dentro del favorito (`schema`), así que cambiar de
 * base no lo borra: se listan los de esa base y los demás siguen guardados.
 */
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "@/server/data-dir";

export interface FavoritoDeTabla {
  /** Base o esquema del objeto (en Mongo, la base). */
  schema: string;
  /** Tabla o colección. */
  table: string;
}

/** Un archivo para todos los perfiles: id de perfil → sus favoritos. */
type Archivo = Record<string, FavoritoDeTabla[]>;

const MAX_POR_PERFIL = 500;

function ruta(): string {
  return path.join(DATA_DIR, "favorites.json");
}

/** Validación de lo que se lee del disco: un archivo editado a mano no debe romper la app. */
export function normalizarFavoritos(entrada: unknown): FavoritoDeTabla[] {
  if (!Array.isArray(entrada)) return [];
  const vistos = new Set<string>();
  const salida: FavoritoDeTabla[] = [];
  for (const item of entrada) {
    if (!item || typeof item !== "object") continue;
    const { schema, table } = item as Record<string, unknown>;
    if (typeof schema !== "string" || typeof table !== "string") continue;
    const limpio = { schema: schema.trim(), table: table.trim() };
    if (!limpio.schema || !limpio.table) continue;
    const clave = `${limpio.schema}.${limpio.table}`;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push(limpio);
  }
  return salida.slice(0, MAX_POR_PERFIL);
}

async function leerArchivo(): Promise<Archivo> {
  try {
    const crudo = await readFile(ruta(), "utf8");
    const parsed = JSON.parse(crudo) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const salida: Archivo = {};
    for (const [id, lista] of Object.entries(parsed as Record<string, unknown>)) {
      salida[id] = normalizarFavoritos(lista);
    }
    return salida;
  } catch {
    // Sin archivo (o corrupto) se empieza vacío: los favoritos son una comodidad, no un dato crítico
    // como para impedir que la app arranque.
    return {};
  }
}

export async function leerFavoritos(profileId: string): Promise<FavoritoDeTabla[]> {
  if (!profileId) return [];
  const archivo = await leerArchivo();
  return archivo[profileId] ?? [];
}

export async function guardarFavoritos(
  profileId: string,
  favoritos: unknown
): Promise<FavoritoDeTabla[]> {
  if (!profileId) throw new Error("Falta el id del perfil");
  const archivo = await leerArchivo();
  const limpios = normalizarFavoritos(favoritos);
  archivo[profileId] = limpios;
  const destino = ruta();
  await mkdir(path.dirname(destino), { recursive: true });
  // Escritura atómica: si la app muere a mitad, el archivo anterior sigue entero. Los favoritos se
  // guardan en cada clic, así que una escritura truncada es cuestión de tiempo.
  const temporal = `${destino}.tmp`;
  await writeFile(temporal, JSON.stringify(archivo, null, 2), "utf8");
  await rename(temporal, destino);
  return limpios;
}
