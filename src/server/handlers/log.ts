/**
 * Handler del log SQL (fase 3, T7). Antes: GET /api/query/log, que mandaba el archivo ENTERO como descarga y que en
 * Electron no existia (la ruta de Next no corre en la app de escritorio). Ahora la UI lo muestra en una pestaña de
 * solo lectura (decision D3 del usuario) y el worker devuelve solo el final.
 */
import { readSqlLogTail, type SqlLogTail } from "@/server/query-log";

/** 1 MB: suficiente para miles de lineas sin congelar el visor. */
export const SQL_LOG_MAX_BYTES = 1024 * 1024;

export async function readLogHandler(): Promise<SqlLogTail> {
  return readSqlLogTail(SQL_LOG_MAX_BYTES);
}
