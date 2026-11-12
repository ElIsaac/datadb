/**
 * Store del layout de la ventana (fase 9, R12). Patrón de `src/theme/theme-store.ts`: estado en módulo,
 * persistencia en localStorage, suscripción con `useSyncExternalStore`. La lógica pura vive en `layout.ts`.
 *
 * La clave es única y global (D3): un layout, no uno por conexión. Un valor guardado corrupto NO tumba la app:
 * se descarta, se avisa en consola y se usan los defaults.
 *
 * Es la ÚNICA fuente de verdad de la visibilidad de paneles (T2 retiró los cuatro flags del reducer de la app).
 */
import { useSyncExternalStore } from "react";
import {
  DEFAULT_LAYOUT,
  applyGroupLayout,
  hide,
  isActive,
  isToolWindowId,
  moveTo,
  parseLayoutState,
  resolveActive,
  setActive,
  setGroupSizes,
  setMode,
  show,
  toggle,
  toolWindowActivaParaOcultar,
  type BarMode,
  type Dock,
  type LayoutState,
  type ToolWindowId,
  type ViewMode,
} from "./layout";

const STORAGE_KEY = "gestordb-layout-v1";

function load(): LayoutState {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_LAYOUT;
  try {
    return parseLayoutState(JSON.parse(raw));
  } catch (err) {
    console.error("[layout] Estado guardado inválido; se usa el layout por defecto", err);
    return DEFAULT_LAYOUT;
  }
}

let state: LayoutState = load();
const listeners = new Set<() => void>();

export function getLayoutState(): LayoutState {
  return state;
}

export function setLayoutState(next: LayoutState) {
  if (next === state) return;
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("[layout] No se pudo guardar el layout", err);
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Estado completo del layout (re-renderiza al cambiar). */
export function useLayoutState(): LayoutState {
  return useSyncExternalStore(subscribe, getLayoutState, () => DEFAULT_LAYOUT);
}

// — Acciones (envoltorios de las funciones puras + persistencia) ————————————————————————————————

export function setBarMode(bar: BarMode) {
  setLayoutState({ ...state, bar });
}

/** Fijada / No fijada (D2). Ocultar es `hideToolWindow`, no un modo. */
export function setToolWindowMode(id: ToolWindowId, mode: ViewMode) {
  setLayoutState(setMode(state, id, mode));
}

export function setDockActive(dock: Dock, id: ToolWindowId | null) {
  setLayoutState(setActive(state, dock, id));
}

export function moveToolWindow(id: ToolWindowId, dock: Dock) {
  setLayoutState(moveTo(state, id, dock));
}

export function saveGroupSizes(group: string, sizes: Record<string, number>) {
  setLayoutState(setGroupSizes(state, group, sizes));
}

/**
 * T4 — `onLayoutChanged` de los `Group`: solo se guarda lo que hizo el USUARIO (arrastre o teclado sobre un
 * separador). Los cambios programáticos — collapse/expand al mostrar u ocultar un dock, `setLayout` del reset,
 * el montaje — no se guardan: la visibilidad ya vive en el store y guardarlos pisaría el tamaño abierto con un 0.
 */
export function commitGroupLayout(group: string, measured: Record<string, number>, isUserInteraction: boolean) {
  if (!isUserInteraction) return;
  setLayoutState(applyGroupLayout(state, group, measured));
}

// T4: «Restablecer layout» tiene que devolver también los TAMAÑOS de los grupos ya montados, y eso es imperativo
// (`groupRef.setLayout`): `defaultLayout` solo se lee al montar. La shell se suscribe aquí y aplica
// `DEFAULT_GROUP_SIZES`; el store no conoce refs de React.
const resetListeners = new Set<() => void>();

export function onLayoutReset(l: () => void) {
  resetListeners.add(l);
  return () => {
    resetListeners.delete(l);
  };
}

/** «Restablecer layout» (Apariencia): vuelve a los defaults de la fase, conservando el modo de barra. */
export function resetLayout() {
  setLayoutState({ ...DEFAULT_LAYOUT, bar: state.bar });
  resetListeners.forEach((l) => l());
}

/**
 * El gesto de la barra de tool windows y de los botones del header, igual que DataGrip: oculta → la muestra
 * (en su modo); Fijada visible pero no activa → la activa; activa o No fijada abierta → la oculta.
 */
export function toggleToolWindow(id: ToolWindowId) {
  setLayoutState(toggle(state, id));
}

/** «Ocultar» (× de la pestaña, `−` del overlay, menú ⋮, minimizar de la tira de resultados, perder foco). */
export function hideToolWindow(id: ToolWindowId) {
  if (state.visible[id]) setLayoutState(hide(state, id));
}

/** ¿Es la tool window la que la barra y el header marcan como activa? */
export function isToolWindowActive(s: LayoutState, id: ToolWindowId): boolean {
  return isActive(s, id);
}

/**
 * Muestra una tool window sin alternar: si estaba oculta la abre (en su modo) y, si es Fijada, la activa; si ya
 * estaba visible y activa, no hace nada. Es lo que necesitan los flujos que «abren» algo (comando del palette,
 * IA tras generar SQL, resultados tras ejecutar), donde alternar cerraría el panel si ya estaba abierto.
 */
export function showToolWindow(id: ToolWindowId) {
  if (state.visible[id] && (state.modes[id] === "unpinned" || resolveActive(state, state.docks[id]) === id)) return;
  setLayoutState(show(state, id));
}

/**
 * Fase 15 (T6, #87) — «Hide Active Tool Window» (⇧⎋). Oculta la tool window que el usuario tiene «activa»,
 * resolviéndola con `toolWindowActivaParaOcultar` (pura, con tests) a partir de una pista de foco tomada del DOM:
 * del dock o de la No fijada abierta que contiene `document.activeElement`. Sin pista de foco, el resolver cae a
 * la No fijada abierta y, si no, a la activa del primer dock ocupado (desempate documentado en `layout.ts`).
 *
 * Devuelve el id oculto, o `null` si no había ninguna tool window visible que ocultar. Es la MISMA operación que el
 * ⎋ del overlay, el × de las pestañas y el ítem «Ocultar» del menú ⋮: llama a `hideToolWindow`, no reimplementa nada.
 */
export function hideActiveToolWindow(): ToolWindowId | null {
  const id = toolWindowActivaParaOcultar(state, pistaDeFocoActivo());
  if (!id) return null;
  hideToolWindow(id);
  return id;
}

/**
 * Pista de foco para `hideActiveToolWindow`: mira si `document.activeElement` vive dentro de una tool window No
 * fijada (`data-tool-window-overlay`) o de un dock (`data-tool-window-dock`). Son los atributos que pinta
 * `tool-window.tsx`, así que no hay que inventar un registro de foco: el DOM ya lo sabe.
 */
function pistaDeFocoActivo(): { dock: Dock } | { overlay: ToolWindowId } | null {
  if (typeof document === "undefined") return null;
  const el = document.activeElement;
  if (!(el instanceof Element)) return null;
  const overlay = el.closest("[data-tool-window-overlay]");
  if (overlay) {
    const id = overlay.getAttribute("data-tool-window-overlay");
    if (id && isToolWindowId(id)) return { overlay: id };
  }
  const dock = el.closest("[data-tool-window-dock]");
  if (dock) {
    const d = dock.getAttribute("data-tool-window-dock");
    if (d === "left" || d === "bottom" || d === "right") return { dock: d };
  }
  return null;
}
