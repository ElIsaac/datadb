/**
 * Fase 5 (R2/T2): ÚNICA fuente de verdad del directorio de datos de la app.
 *
 * Antes de esta tarea, CINCO módulos de `src/server` resolvían su directorio con
 * `path.resolve(<cwd>, "data")` (cwd = directorio de proceso). Eso funciona en
 * desarrollo por accidente (el cwd es el repo) pero es inválido en una app
 * empaquetada, donde el directorio del código es de solo lectura. R2 exige que
 * TODOS los datos vivan en `app.getPath("userData")` y que UN ÚNICO módulo
 * resuelva esa ruta.
 *
 * Este módulo es PURO a propósito: no importa Electron ni `node:process`, para poder
 * probarse con `node:test` sin arrancar la app. `resolveDataDir` recibe `userData`
 * y `env` como argumentos en vez de leerlos de variables globales.
 *
 * Por qué existe el override `DATADB_DATA_DIR`: los tests y las sondas por CDP
 * (que inspeccionan la app viva) hoy escriben en el `data/` del repo. En una app
 * empaquetada ese directorio es de solo lectura y, en desarrollo, sin override
 * cada sonda tocaría los datos REALES del usuario (perfiles con credenciales de
 * producción). El override permite apuntar a un directorio temporal aislado.
 * Si el override está presente pero es una ruta RELATIVA, se lanza un error: una
 * ruta relativa reintroduce exactamente el bug del cwd que esta tarea elimina.
 */
import path from "node:path";

/**
 * Los OCHO nombres de archivo de datos de la app, en un solo sitio. Los cinco
 * primeros son de `src/server`; `secrets` lo consume `electron/main.ts` (en esa
 * otra tarea se importará de aquí para no duplicar el literal); `windowState`
 * (fase 6, R5/T1) lo consume el módulo `electron/window-state.ts`.
 *
 * `windowState` NO es un dato de negocio como los demás: guarda la geometría de
 * la ventana (bounds + maximizado) para reabrirla donde el usuario la dejó. Vive
 * aquí igual que el resto para que TODO lo que DataDB escribe en `userData` esté
 * enumerado en un único sitio (un archivo de datos sin registrar es el que se
 * olvida al migrar, al limpiar o al exportar).
 */
export const DATA_FILES = {
  connections: "connections.json",
  queryHistory: "query-history.json",
  sqlLog: "sql-log.jsonl",
  savedQueries: "saved-queries.json",
  aiChats: "ai-chats.json",
  aiSettings: "ai-settings.json",
  secrets: "secrets.json",
  windowState: "window-state.json",
} as const;

/** Clave de `DATA_FILES` (p. ej. `"connections"`), no el nombre del archivo. */
export type DataFileKey = keyof typeof DATA_FILES;

export interface ResolveDataDirInput {
  /** Valor de `app.getPath("userData")`. Lo calcula `main`; aquí llega ya resuelto. */
  userData: string;
  /** Entorno del que se lee el override opcional `DATADB_DATA_DIR`. */
  env: Record<string, string | undefined>;
}

/**
 * Resuelve el directorio de datos. Regla:
 *  - `DATADB_DATA_DIR` ausente o vacía -> `userData`.
 *  - `DATADB_DATA_DIR` presente y ABSOLUTA -> gana el override.
 *  - `DATADB_DATA_DIR` presente y RELATIVA -> lanza (ver cabecera).
 */
export function resolveDataDir({ userData, env }: ResolveDataDirInput): string {
  const override = env.DATADB_DATA_DIR;
  if (override === undefined || override === "") {
    return userData;
  }
  if (!path.isAbsolute(override)) {
    throw new Error(
      `DATADB_DATA_DIR debe ser una ruta absoluta, pero se recibió "${override}", que es relativa. ` +
        "Una ruta relativa se resuelve contra el cwd (el bug que esta fase elimina) y en una app " +
        "empaquetada apuntaría al directorio de solo lectura del código."
    );
  }
  return override;
}
