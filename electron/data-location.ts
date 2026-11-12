/**
 * Fase 5 (R2, T3): dónde viven los datos de la app, y las dos migraciones de una sola vez que
 * hacen falta para llegar ahí. Todo esto corre en `main`, SÍNCRONO y ANTES de `app.whenReady()`,
 * por dos motivos que no son negociables:
 *
 *  1. `app.setPath("userData", …)` tiene que ejecutarse antes de que Chromium toque el perfil. Si
 *     se hace después, la sesión queda partida entre dos directorios (cachés en uno, localStorage
 *     en otro) y el usuario pierde el layout sin que nada falle de forma visible.
 *  2. El almacén de secretos y el worker se construyen con la ruta ya resuelta. Si la migración
 *     fuera asíncrona, el worker podría arrancar mirando un directorio a medio migrar.
 *
 * Dos hallazgos medidos que explican por qué este archivo existe (fase 5, línea base del PLAN):
 *
 *  - **`app.setName()` NO mueve `app.getPath("userData")`.** Electron resuelve esa ruta al arrancar
 *    y la cachea; `setName` solo cambia `app.getName()` (de ahí sale el ítem del Keychain) y
 *    `getPath("logs")`. Comprobado con Electron real: tras `setName`, `userData` seguía apuntando
 *    al directorio anterior. Por eso la ruta se fija a mano con `setPath` y no se confía ni en
 *    `setName` ni en el campo `name` del `package.json`.
 *  - Por ese mismo motivo, hasta la fase 5 el producto vivía con DOS nombres a la vez: el ítem del
 *    Keychain decía `GestorDB` (de `setName`) y el directorio de datos decía `gestordb` (del
 *    `package.json`). R54 los unifica en `DataDB`.
 */
import fs from "node:fs";
import path from "node:path";

import { DATA_FILES, resolveDataDir } from "@/shared/data-dir";

/** Nombre de producto actual (R54). Manda sobre el ítem del Keychain y sobre el directorio de datos. */
export const APP_NAME = "DataDB";

/**
 * Directorio de datos ANTERIOR, dentro de `appData`. Salía del campo `name` del `package.json`
 * (`gestordb`), no de `setName`. Es el que hay que renombrar para no perder lo que contiene.
 */
const LEGACY_USER_DATA_DIR_NAME = "gestordb";

export interface DataLocation {
  /** Directorio final de datos, ya creado. */
  dir: string;
  /** Qué migraciones corrieron de verdad en este arranque (para loguearlo; vacío en los siguientes). */
  migraciones: string[];
}

/**
 * Renombra el directorio de datos viejo al nuevo, si procede.
 *
 * Es un `rename` del directorio ENTERO, no de nuestros seis JSON, y eso es deliberado: ahí dentro
 * vive también `Local Storage/leveldb`, que es donde Chromium guarda el layout de tool windows
 * (`gestordb-layout-v1`), el tema, la caché de esquema y los favoritos. Copiar solo nuestros
 * archivos habría tirado todo eso sin que nada diera error. Al ser el mismo volumen, el rename es
 * instantáneo aunque el directorio pese cientos de MB (la mayor parte son cachés de Chromium).
 *
 * No hace nada si el destino ya existe: en ese caso el usuario ya arrancó la versión nueva y pisar
 * sus datos con los viejos sería destructivo.
 */
function renombrarDirectorioViejo(appData: string, destino: string, migraciones: string[]): void {
  const viejo = path.join(appData, LEGACY_USER_DATA_DIR_NAME);
  if (viejo === destino) return;
  if (!fs.existsSync(viejo) || fs.existsSync(destino)) return;
  try {
    fs.renameSync(viejo, destino);
    migraciones.push(`directorio de datos renombrado: ${viejo} -> ${destino}`);
  } catch (err) {
    // No se traga: si falla, la app arranca con un directorio vacío y el usuario tiene que saber
    // por qué dejó de ver sus perfiles.
    console.error(`[main] no se pudo renombrar ${viejo} a ${destino}:`, err instanceof Error ? err.message : String(err));
  }
}

const README_MIGRADO = `Este directorio es el "data/" que GestorDB usaba junto al código del repo.

La fase 5 movió los datos de la app a app.getPath("userData"), que es donde deben vivir: dentro de
una app empaquetada el directorio del código es de solo lectura, así que la ruta anterior no podía
funcionar fuera de desarrollo.

Sus archivos se COPIARON al destino nuevo y este directorio se renombró para que no queden dos
fuentes de verdad vivas. En particular, "connections.json" guarda contraseñas en texto plano hasta
la fase 17 (R6), y tener dos copias de eso por despiste es un coste de seguridad gratuito.

Si todo funciona, se puede borrar.
`;

/**
 * Copia los archivos de datos del `data/` que vivía junto al código (desarrollo) al directorio
 * nuevo, y aparta el viejo. Idempotente y no destructiva:
 *
 *  - no pisa un archivo que ya exista en el destino (un `data/` viejo no puede machacar datos nuevos);
 *  - copia en vez de mover, para que un fallo a mitad no deje al usuario sin nada;
 *  - al terminar renombra el origen a `data.migrado/` con un README dentro, de forma que no queden
 *    dos `connections.json` vivos con contraseñas en claro.
 */
function migrarDataDelRepo(origenBase: string, destino: string, migraciones: string[]): void {
  const origen = path.join(origenBase, "data");
  if (!fs.existsSync(origen) || !fs.statSync(origen).isDirectory()) return;

  const copiados: string[] = [];
  for (const archivo of Object.values(DATA_FILES)) {
    const src = path.join(origen, archivo);
    const dst = path.join(destino, archivo);
    if (!fs.existsSync(src) || fs.existsSync(dst)) continue;
    try {
      fs.copyFileSync(src, dst);
      // Los secretos y los perfiles son privados: se conservan los permisos restrictivos.
      fs.chmodSync(dst, 0o600);
      copiados.push(archivo);
    } catch (err) {
      console.error(`[main] no se pudo copiar ${src}:`, err instanceof Error ? err.message : String(err));
    }
  }

  const apartado = path.join(origenBase, "data.migrado");
  if (!fs.existsSync(apartado)) {
    try {
      fs.renameSync(origen, apartado);
      fs.writeFileSync(path.join(apartado, "LEEME.txt"), README_MIGRADO, "utf-8");
      migraciones.push(
        copiados.length > 0
          ? `data/ del repo migrado (${copiados.join(", ")}) y apartado a data.migrado/`
          : "data/ del repo apartado a data.migrado/ (no había nada que copiar)"
      );
    } catch (err) {
      console.error("[main] no se pudo apartar data/:", err instanceof Error ? err.message : String(err));
    }
  }
}

/**
 * Resuelve el directorio de datos, corre las migraciones pendientes y lo deja creado.
 *
 * `appPath` es `app.getAppPath()`: en desarrollo, la raíz del repo (donde vivía `data/`); en la app
 * empaquetada, el interior del bundle, donde no hay `data/` y la segunda migración no hace nada.
 */
export function prepararDirectorioDeDatos(appData: string, appPath: string, env: NodeJS.ProcessEnv): DataLocation {
  // `resolveDataDir` es la única fuente de verdad de la regla (incluido el override DATADB_DATA_DIR,
  // que usan los tests y las sondas para no tocar los datos reales del usuario).
  const dir = resolveDataDir({ userData: path.join(appData, APP_NAME), env });
  const migraciones: string[] = [];

  // El renombre del directorio solo aplica cuando NO hay override: con override, el destino es un
  // directorio aislado a propósito y traerle los datos reales sería justo lo contrario de lo que se pide.
  if (dir === path.join(appData, APP_NAME)) {
    renombrarDirectorioViejo(appData, dir, migraciones);
  }

  fs.mkdirSync(dir, { recursive: true });

  if (dir === path.join(appData, APP_NAME)) {
    migrarDataDelRepo(appPath, dir, migraciones);
  }

  return { dir, migraciones };
}

/** Ruta de un archivo de datos dentro del directorio ya resuelto. */
export function rutaDeDato(dir: string, clave: keyof typeof DATA_FILES): string {
  return path.join(dir, DATA_FILES[clave]);
}
