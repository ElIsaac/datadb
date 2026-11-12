/**
 * Superficie expuesta al renderer. Deliberadamente chica:
 *  - invoke(channel, payload): solo canales de INVOKE_CHANNELS.
 *  - on(event, cb): solo eventos de EVENT_CHANNELS; devuelve la funcion para desuscribirse.
 *
 * NO se expone ipcRenderer ni sus metodos crudos: un ipcRenderer.send arbitrario anularia
 * la lista blanca. Esta lista blanca es defensa en profundidad: main aplica la suya.
 */
import { contextBridge, ipcRenderer } from "electron";
import { EVENT_CHANNELS, INVOKE_CHANNELS } from "@/shared/contract";

const invokeOk = new Set<string>(INVOKE_CHANNELS);
const eventOk = new Set<string>(EVENT_CHANNELS);

contextBridge.exposeInMainWorld("gestordb", {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  invoke(channel: string, payload?: unknown): Promise<unknown> {
    if (!invokeOk.has(channel)) {
      return Promise.resolve({
        ok: false,
        error: { message: `Canal no permitido: ${channel}`, status: 400 },
      });
    }
    return ipcRenderer.invoke(channel, payload);
  },
  on(event: string, cb: (payload: unknown) => void): () => void {
    if (!eventOk.has(event)) return () => {};
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(event, listener);
    return () => {
      ipcRenderer.removeListener(event, listener);
    };
  },
});
