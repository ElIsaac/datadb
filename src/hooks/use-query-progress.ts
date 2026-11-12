/**
 * Progreso de queries en curso (fase 3, T4; R4 pide «progreso para queries largas»).
 *
 * Escucha los eventos `query:started` / `query:finished` que emite el worker (decision 2 de la fase 2: eventos
 * discretos, no MessagePort) y devuelve la operacion en curso de una sesion con su tiempo transcurrido, que se
 * refresca cada 100 ms mientras haya algo corriendo (y no hace nada cuando no).
 *
 * Por que eventos y no el estado `running` del reducer: el reducer sabe que la CONSOLA esta ejecutando, pero no
 * cuando empezo cada sentencia de un lote ni cuando la base respondio; el worker si (los eventos salen del transporte,
 * alrededor del handler). Asi el contador mide la query de verdad, no el tiempo de la UI.
 *
 * Que NO hace (como DataGrip, que tampoco da porcentaje): no hay avance porcentual — los drivers no lo exponen.
 */
import * as React from "react";
import type { EventMap } from "@/shared/contract";

export interface RunningQuery {
  opId: string;
  sessionId: string;
  startedAt: number;
}

// Estado del modulo: una sola suscripcion al puente para toda la app, compartida por todos los consumidores.
const running = new Map<string, RunningQuery>();
const listeners = new Set<() => void>();
let subscribed = false;

function notify() {
  for (const l of listeners) l();
}

function ensureSubscribed() {
  if (subscribed || typeof window === "undefined" || !window.gestordb?.on) return;
  subscribed = true;
  window.gestordb.on("query:started", (e: EventMap["query:started"]) => {
    // startedAt viene del reloj del worker; mismo equipo, mismo reloj de pared: se puede restar con Date.now().
    running.set(e.opId, { opId: e.opId, sessionId: e.sessionId, startedAt: e.startedAt });
    notify();
  });
  window.gestordb.on("query:finished", (e: EventMap["query:finished"]) => {
    running.delete(e.opId);
    notify();
  });
}

/** La operacion mas antigua en curso de esa sesion (en un lote, la sentencia actual) y su tiempo transcurrido. */
export function useQueryProgress(sessionId: string | undefined): { op: RunningQuery; elapsedMs: number } | null {
  // `now` vive en el estado (no se llama a Date.now() al renderizar: el render debe ser puro). Lo actualizan los
  // eventos y el reloj; un `now` algo atrasado respecto a un started recien llegado da 0, no un negativo.
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    ensureSubscribed();
    const onChange = () => setNow(Date.now());
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  const op = sessionId
    ? [...running.values()].filter((r) => r.sessionId === sessionId).sort((a, b) => a.startedAt - b.startedAt)[0]
    : undefined;

  // Reloj: solo mientras haya una operacion visible.
  React.useEffect(() => {
    if (!op) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [op]);

  if (!op) return null;
  return { op, elapsedMs: Math.max(0, now - op.startedAt) };
}

/** «3,2 s» (coma decimal, como el resto de la UI en español); a partir de un minuto, «1 min 05 s». */
export function formatElapsed(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)} min ${String(total % 60).padStart(2, "0")} s`;
}
