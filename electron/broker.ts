/**
 * Broker de `main`: correlaciona peticiones y respuestas del db-worker por id.
 * Sin imports de Electron para poder probarse con node:test.
 *
 * Contrato: NUNCA rechaza una promesa. Si el worker muere, failAll() resuelve todo lo
 * pendiente con un IpcResult de error (lanzar a traves de ipcMain.handle reescribiria el
 * mensaje y romperia la auto-reconexion del editor).
 */
import type { EventChannel, EventMap, InvokeChannel, IpcResult } from "@/shared/contract";
import type { FromWorker, ToWorker } from "@/shared/worker-protocol";

export function createBroker(
  post: (msg: ToWorker) => void,
  onEvent?: <E extends EventChannel>(name: E, payload: EventMap[E]) => void
) {
  let nextId = 1;
  const pending = new Map<number, (r: IpcResult<unknown>) => void>();

  return {
    request(channel: InvokeChannel, payload: unknown): Promise<IpcResult<unknown>> {
      return new Promise((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        post({ kind: "request", id, channel, payload });
      });
    },
    onWorkerMessage(msg: FromWorker): void {
      if (msg.kind === "response") {
        const resolve = pending.get(msg.id);
        if (!resolve) return; // id desconocido (p. ej. respuesta tardia tras failAll): se ignora
        pending.delete(msg.id);
        resolve(msg.result);
      } else if (msg.kind === "event") {
        onEvent?.(msg.name, msg.payload as never);
      }
    },
    failAll(message: string): void {
      const waiting = [...pending.values()];
      pending.clear();
      for (const resolve of waiting) resolve({ ok: false, error: { message, status: 500 } });
    },
    pendingCount: () => pending.size,
  };
}
