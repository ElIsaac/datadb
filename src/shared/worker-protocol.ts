/**
 * Protocolo de mensajes entre `main` y el utilityProcess (db-worker).
 * Solo tipos: lo importan electron/main.ts, electron/broker.ts y electron/db-worker.ts.
 */
import type { EventChannel, EventMap, InvokeChannel, IpcResult } from "./contract";
import type { SecretName } from "./secrets";

/** main -> worker */
export type ToWorker =
  | { kind: "request"; id: number; channel: InvokeChannel; payload: unknown }
  | { kind: "shutdown" }
  /** Fase 25: respuesta a un `secret-request`. `error` si el almacén falló (no se inventa un «no hay»). */
  | { kind: "secret-response"; id: number; value?: string | null; has?: boolean; error?: string };

/** worker -> main */
export type FromWorker =
  | { kind: "ready" }
  | { kind: "response"; id: number; result: IpcResult<unknown> }
  | { kind: "event"; name: EventChannel; payload: EventMap[EventChannel] }
  | { kind: "shutdown-done" }
  /**
   * Fase 25: el worker pide un secreto a `main` (el único con safeStorage) justo antes de usarlo. `has` solo pregunta
   * si existe, sin descifrar.
   */
  /**
   * Fase 17: además de leer (`get`) y preguntar (`has`), el worker GUARDA y BORRA secretos. Guardar
   * es la única forma de que la contraseña de una conexión no llegue nunca a `connections.json`: el
   * formulario la manda al worker (que ya la tenía) y el worker la cifra en `main`.
   */
  | { kind: "secret-request"; id: number; op: "get" | "has" | "set" | "delete"; name: SecretName; value?: string };
