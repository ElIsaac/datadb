import type {
  EventMap,
  InvokeChannel,
  InvokeMap,
  IpcResult,
} from "@/shared/contract";

declare global {
  interface Window {
    /** Puente expuesto por electron/preload.ts. Undefined fuera de Electron (desde la fase 3 la app no funciona sin él). */
    gestordb?: {
      versions: { electron: string; chrome: string; node: string };
      invoke<C extends InvokeChannel>(
        channel: C,
        payload?: InvokeMap[C]["req"]
      ): Promise<IpcResult<InvokeMap[C]["res"]>>;
      on<E extends keyof EventMap>(
        event: E,
        cb: (payload: EventMap[E]) => void
      ): () => void;
    };
  }
}

export {};
