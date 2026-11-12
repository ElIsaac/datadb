import { promises as fs } from "fs";
import type { QueryHistoryEntry } from "@/lib/types";
// Fase 5 (R2): el directorio de datos lo resuelve el único módulo src/server/data-dir.ts.
import { DATA_DIR, dataPath } from "./data-dir";

const QUERY_HISTORY_PATH = dataPath("queryHistory");
const SQL_LOG_PATH = dataPath("sqlLog");

/** Máximo de entradas conservadas en disco por conexión. */
const MAX_ENTRIES_PER_CONNECTION = 500;

type QueryHistoryFile = Record<string, QueryHistoryEntry[]>;

async function loadFile(): Promise<QueryHistoryFile> {
  try {
    const raw = await fs.readFile(QUERY_HISTORY_PATH, "utf-8");
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as QueryHistoryFile;
    }
    return {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

async function saveFile(data: QueryHistoryFile): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${QUERY_HISTORY_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, QUERY_HISTORY_PATH);
}

/**
 * Escrituras secuenciales para evitar condiciones de carrera entre
 * múltiples queries que terminan casi al mismo tiempo (read-modify-write
 * sobre el mismo archivo).
 */
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(fn, fn);
  writeQueue = result.catch(() => undefined);
  return result;
}

export async function loadQueryHistory(connectionId: string): Promise<QueryHistoryEntry[]> {
  const data = await loadFile();
  return data[connectionId] ?? [];
}

export async function appendQueryHistoryEntry(
  connectionId: string,
  entry: QueryHistoryEntry
): Promise<void> {
  await enqueueWrite(async () => {
    const data = await loadFile();
    const list = data[connectionId] ?? [];
    list.unshift(entry);
    if (list.length > MAX_ENTRIES_PER_CONNECTION) {
      list.length = MAX_ENTRIES_PER_CONNECTION;
    }
    data[connectionId] = list;
    await saveFile(data);
  });
}

export async function clearQueryHistoryLog(connectionId: string): Promise<void> {
  await enqueueWrite(async () => {
    const data = await loadFile();
    delete data[connectionId];
    await saveFile(data);
  });
}

export interface SqlLogLine {
  timestamp: string;
  connectionId: string;
  sql: string;
  durationMs: number;
  rowCount?: number;
  affectedRows?: number;
  error?: string;
}

/**
 * Log SQL completo, append-only, cross-conexión, pensado para auditoría o
 * debugging (equivalente a "Help | Show SQL Log" de DataGrip). No tiene
 * límite de tamaño — a diferencia del historial por conexión, este archivo
 * crece indefinidamente y queda a criterio del usuario rotarlo/borrarlo.
 */
export async function appendSqlLogLine(entry: SqlLogLine): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.appendFile(SQL_LOG_PATH, JSON.stringify(entry) + "\n");
}

/** Lo que devuelve `readSqlLogTail` (y el canal `log:read`). */
export interface SqlLogTail {
  /** Ruta absoluta del archivo del log SQL (fase 5 R2: ya no es relativa a nada). */
  path: string;
  exists: boolean;
  /** Tamaño total del archivo en bytes. */
  totalBytes: number;
  /** Bytes que se devuelven en `content`. */
  shownBytes: number;
  /** true si se devolvio solo el final del archivo. */
  truncated: boolean;
  /** El limite pedido (lo que la UI anuncia: «mostrando solo el ultimo 1 MB»). */
  maxBytes: number;
  content: string;
}

/**
 * Fase 3 (T7): lee el FINAL del log SQL, hasta `maxBytes`. El archivo no tiene limite de tamano (ver arriba), asi que
 * leerlo entero para mostrarlo podria congelar la UI. Si se corta, se descarta la primera linea (quedaria a medias) y
 * se avisa con `truncated`. La ruta es fija: el renderer no puede pedir otro archivo.
 */
export async function readSqlLogTail(maxBytes: number): Promise<SqlLogTail> {
  // Fase 5 (R2): el cwd ya no es nada (la ruta sale de userData), así que se muestra la ruta absoluta.
  const shown = SQL_LOG_PATH;
  let handle: Awaited<ReturnType<typeof fs.open>>;
  try {
    handle = await fs.open(SQL_LOG_PATH, "r");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { path: shown, exists: false, totalBytes: 0, shownBytes: 0, truncated: false, maxBytes, content: "" };
    }
    throw err;
  }
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - maxBytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    let content = buffer.toString("utf-8");
    if (start > 0) content = content.slice(content.indexOf("\n") + 1);
    return {
      path: shown,
      exists: true,
      totalBytes: size,
      shownBytes: Buffer.byteLength(content),
      truncated: start > 0,
      maxBytes,
      content,
    };
  } finally {
    await handle.close();
  }
}
