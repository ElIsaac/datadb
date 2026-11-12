/**
 * Fase 5 (R2/T2): el ÚNICO punto por el que `src/server/**` conoce su directorio
 * de datos. Antes cada módulo derivaba el directorio del cwd del proceso
 * (`path.resolve(<cwd>, "data")`); aquí se centraliza en `DATA_DIR` + `dataPath(key)`.
 *
 * Por qué el worker NO puede usar `app.getPath("userData")`: todo `src/server/**`
 * corre dentro de un `utilityProcess` forkeado por `main` (electron/db-worker.ts),
 * y ese proceso no tiene `app` (es de Electron, vive solo en el proceso principal).
 * El proceso principal resuelve `userData`, lo publica en su entorno y lo hereda
 * el worker al forkar; aquí solo se CONSUME `DATADB_DATA_DIR`.
 *
 * Si la variable no está definida, se falla fuerte al cargar este módulo. Nada de
 * caer a un valor por defecto relativo al cwd: ese silencio es justo el bug que
 * esta fase elimina (los datos acabarían en el directorio de solo lectura del
 * código, o peor, mezclados con el `data/` del repo en desarrollo).
 */
import path from "node:path";
import { DATA_FILES, type DataFileKey } from "@/shared/data-dir";

const configured = process.env.DATADB_DATA_DIR;

if (!configured) {
  throw new Error(
    "DATADB_DATA_DIR no está definida: el worker (utilityProcess) tiene que recibirla de main en el fork. " +
      "El worker no puede usar app.getPath(\"userData\") porque no tiene el objeto app de Electron; " +
      "main resuelve userData y la publica en el entorno del proceso hijo."
  );
}

if (!path.isAbsolute(configured)) {
  throw new Error(
    `DATADB_DATA_DIR debe ser una ruta absoluta, pero se recibió "${configured}", que es relativa. ` +
      "Una ruta relativa se resolvería contra el cwd del worker."
  );
}

/** Directorio de datos del worker, ya resuelto y validado. */
export const DATA_DIR = configured;

/** Ruta completa de un archivo de datos a partir de su clave de `DATA_FILES`. */
export function dataPath(key: DataFileKey): string {
  return path.join(DATA_DIR, DATA_FILES[key]);
}
