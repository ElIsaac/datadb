/**
 * Despachador del utilityProcess: canal -> handler, resultado envuelto en IpcResult y
 * eventos de progreso de query. NO importa nada de Electron para poder probarse con node:test.
 * Nunca lanza: todo resultado (incluidos errores sincronos) sale como IpcResult.
 */
import type { EventChannel, EventMap, InvokeChannel, InvokeMap, IpcResult, WorkerChannel } from "@/shared/contract";
import { errorToPayload } from "@/server/handlers/errors";

export type Emit = <E extends EventChannel>(name: E, payload: EventMap[E]) => void;
/**
 * Fase 3 (T6): los handlers reciben el emisor de eventos como segundo argumento. Solo lo usa el chat de IA (que emite
 * sus trozos mientras dura la peticion); los demas lo ignoran y siguen siendo identicos a lo que hacian las rutas.
 */
export type Handlers = {
  [C in WorkerChannel]: (req: InvokeMap[C]["req"], ctx: { emit: Emit }) => Promise<InvokeMap[C]["res"]>;
};

export function createRouter(handlers: Partial<Handlers>, emit: Emit) {
  return async function route(channel: InvokeChannel, payload: unknown): Promise<IpcResult<unknown>> {
    const handler = handlers[channel as WorkerChannel] as ((p: unknown, ctx: { emit: Emit }) => Promise<unknown>) | undefined;
    if (!handler) {
      return { ok: false, error: { message: `Canal desconocido: ${channel}`, status: 400 } };
    }

    // Decision 2 de la fase 2: el progreso viaja como eventos discretos. Se emiten aqui, en
    // el transporte, para que el handler siga siendo identico al de la ruta HTTP.
    const isQuery = channel === "query:execute";
    const { opId = "", sessionId = "" } = (payload ?? {}) as { opId?: string; sessionId?: string };
    const startedAt = Date.now();
    if (isQuery) emit("query:started", { opId, sessionId, startedAt });

    try {
      const data = await handler(payload, { emit });
      if (isQuery) emit("query:finished", { opId, sessionId, durationMs: Date.now() - startedAt, ok: true });
      return { ok: true, data };
    } catch (err) {
      if (isQuery) emit("query:finished", { opId, sessionId, durationMs: Date.now() - startedAt, ok: false });
      return { ok: false, error: errorToPayload(err) };
    }
  };
}
