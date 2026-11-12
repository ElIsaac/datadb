/**
 * Modelo del layout de la ventana (fase 9, R12). Puro y testeado; el almacenamiento vive en layout-store.ts.
 *
 * - Qué tool windows existen (`TOOL_WINDOWS`), en qué dock viven, su modo de vista, si están visibles y cuál
 *   está activa en cada dock.
 * - Los tamaños de cada `Group` de react-resizable-panels, tal cual los entrega `onLayoutChanged`
 *   (id de grupo → { id de panel → flexGrow }). La librería v4 NO trae `autoSaveId` (eso era la v2),
 *   así que el guardado es nuestro.
 * - Un solo layout GLOBAL (D3 de la fase: no hay layout por perfil de conexión).
 *
 * Decisiones que se ven en los defaults (tabla D1-D5 de .planning/phases/phase-9/PLAN.md):
 *   D1 barra vertical a la izquierda por defecto, con la variante de barra única en el header activable;
 *   D2 modos Fijada / No fijada + la acción Ocultar (sin Float ni ventana aparte);
 *   D4 Guardadas e IA se anclan a la IZQUIERDA (el dock derecho queda reservado para el value editor de la
 *      fase 12); mover una tool window a otro dock es cambiar esta tabla, no código.
 *
 * T3 — modo de vista y visibilidad son DOS datos (como en IntelliJ: «View Mode» es una propiedad de la tool
 * window y «Hide» es una acción). En T1/T2 «hidden» era un tercer modo, y eso hacía que ocultar una tool
 * window No fijada y volver a abrirla la devolviera Fijada: se perdía la preferencia del usuario. Los layouts
 * guardados con `modes.x = "hidden"` se siguen leyendo (se migran a `pinned` + `visible: false`).
 *
 * Qué significa cada modo aquí:
 *   - Fijada (`pinned`): ocupa su dock (el editor se encoge para dejarle sitio) y se queda al perder foco.
 *   - No fijada (`unpinned`): se pinta ENCIMA del contenido, pegada al borde de su dock, sin mover el layout,
 *     y se oculta al perder foco (clic fuera, ⎋, foco al editor). Es más cercano al «Undock» de IntelliJ que a
 *     su «Dock Unpinned» (que sí empuja al editor); se eligió así en el PLAN para que abrir y cerrar no haga
 *     saltar el editor. Su visibilidad es transitoria: no sobrevive a un reinicio.
 */
export const TOOL_WINDOWS = [
  { id: "explorer", label: "Explorador", icon: "database" },
  { id: "saved", label: "Guardadas", icon: "bookmark" },
  { id: "ai", label: "IA", icon: "ai" },
  { id: "results", label: "Resultados", icon: "table" },
  { id: "history", label: "Historial", icon: "history" },
  // Fase 12 (T2, D1): el value editor. Vive en el dock DERECHO, que la fase 9 dejó vacío y
  // colapsado precisamente reservándolo para esto (ver `app-shell.tsx`, comentario del `right-panel`).
  // Icono `edit`: el set de IntelliJ importado (fase 8) no trae uno de «value editor», y `edit` es
  // el más cercano a lo que hace el panel (ver y modificar UN valor). Si la fase 8 amplía el set,
  // aquí es donde se cambia.
  { id: "value", label: "Valor", icon: "edit" },
] as const;

export type ToolWindowId = (typeof TOOL_WINDOWS)[number]["id"];
export const TOOL_WINDOW_IDS: readonly ToolWindowId[] = TOOL_WINDOWS.map((t) => t.id);

export type Dock = "left" | "bottom" | "right";
export const DOCKS: readonly Dock[] = ["left", "bottom", "right"];
export const DOCK_LABELS: Record<Dock, string> = { left: "Izquierda", bottom: "Abajo", right: "Derecha" };

/** D2: Fijada o No fijada. Ocultar NO es un modo: es `visible: false` (ver cabecera). */
export type ViewMode = "pinned" | "unpinned";

/** D1: barra vertical del concepto (`side`) o barra única de iconos en el header (`header`). */
export type BarMode = "side" | "header";

export interface LayoutState {
  /**
   * Versión del formato; 2 desde la fase 70 (T3), que sacó Guardadas del dock izquierdo; 3 desde R96, que la
   * devuelve a él (el rediseño de «Consultas guardadas» está pensado como columna lateral).
   */
  v: 1 | 2 | 3;
  bar: BarMode;
  docks: Record<ToolWindowId, Dock>;
  modes: Record<ToolWindowId, ViewMode>;
  visible: Record<ToolWindowId, boolean>;
  /**
   * Tool window activa de cada dock entre las FIJADAS visibles: es la que pinta su contenido. `null` = dock sin
   * nada que mostrar. Las No fijadas no cuentan aquí: no ocupan el dock, flotan encima.
   */
  active: Record<Dock, ToolWindowId | null>;
  /** id de grupo → { id de panel → flexGrow }. Se guardan los que la app declare con `onLayoutChanged`. */
  sizes: Record<string, Record<string, number>>;
}

export const DEFAULT_LAYOUT: LayoutState = {
  // v2 (fase 70, T3): el dock izquierdo era de UNA columna — solo el explorador — y Guardadas pasó al
  // dock inferior. v3 (R96, pedido del usuario 2026-10-22: «cámbialo a la barra lateral como en el
  // prototipo de Open Design»): Guardadas vuelve al dock IZQUIERDO, oculta de fábrica; su stripe la
  // abre ahí como pestaña junto al explorador (como «Files» junto a «Database» en DataGrip). En el
  // dock inferior la tapaba «Resultados» en cuanto se ejecutaba algo.
  v: 3,
  bar: "side",
  docks: { explorer: "left", saved: "left", ai: "left", results: "bottom", history: "right", value: "right" },
  modes: { explorer: "pinned", saved: "pinned", ai: "pinned", results: "pinned", history: "pinned", value: "pinned" },
  // El explorador y los resultados están abiertos de fábrica (la app web arranca con ambos); el historial
  // y la IA, ocultos. Guardadas nace abierta porque era el estado inicial de la app (use-app-state.tsx).
  // El value editor nace OCULTO: se abre con ⇧Enter sobre una celda (fase 12, T6). De fábrica el
  // dock derecho sigue colapsado, como lo dejó la fase 9.
  visible: { explorer: true, saved: false, ai: false, results: true, history: false, value: false },
  active: { left: "explorer", bottom: "results", right: null },
  sizes: {},
};

/**
 * T4 — Grupos de paneles cuyo tamaño se persiste, y sus tamaños de fábrica (en %, lo que entiende
 * `Group.defaultLayout` / `setLayout` de react-resizable-panels v4). Son coherentes con la visibilidad de
 * `DEFAULT_LAYOUT` (explorador abierto, dock derecho vacío): «Restablecer layout» aplica las dos cosas juntas.
 * El editor ocupa lo que dejan los docks: 22 % de explorador + 78 % de editor (el 32 % que antes tenía el panel
 * derecho pasó al editor en T2, cuando el dock derecho quedó reservado y vacío).
 */
export const LAYOUT_GROUPS = { main: "main-horizontal", editor: "editor-vertical" } as const;
export const DEFAULT_GROUP_SIZES: Record<string, Record<string, number>> = {
  [LAYOUT_GROUPS.main]: { "schema-panel": 22, "main-panel": 78, "right-panel": 0 },
  [LAYOUT_GROUPS.editor]: { "sql-editor-panel": 45, "sql-results-panel": 55 },
};

/**
 * Qué panel de cada grupo es un dock (y de cuál) y cuál rellena el resto. Hace falta porque un dock oculto está
 * COLAPSADO a 0 en el layout que entrega la librería: guardar ese 0 tal cual haría que, tras reiniciar, el dock se
 * reabriera sin tamaño conocido. Se guarda su último tamaño abierto y el panel de relleno se queda con el resto.
 */
const GROUP_SPECS: Record<string, { docks: Record<string, Dock>; fill: string }> = {
  [LAYOUT_GROUPS.main]: { docks: { "schema-panel": "left", "right-panel": "right" }, fill: "main-panel" },
  [LAYOUT_GROUPS.editor]: { docks: { "sql-results-panel": "bottom" }, fill: "sql-editor-panel" },
};

/** Un panel a menos de medio punto se trata como colapsado (la librería entrega flotantes). */
const COLLAPSED_EPSILON = 0.5;

/** Oculta todas las tool windows que ocupan un dock (el dock se cierra entero). */
export function hideDock(s: LayoutState, dock: Dock): LayoutState {
  let next = s;
  for (const id of dockedIn(s, dock)) next = hide(next, id);
  return next;
}

/**
 * T4 — Aplica un layout medido por el usuario (arrastre o teclado sobre un separador; `onLayoutChanged` con
 * `isUserInteraction`) al estado:
 *   1. Si el usuario arrastró un dock ocupado hasta colapsarlo, eso es OCULTARLO: se ocultan sus tool windows.
 *      Si no, la barra lo seguiría marcando abierto con un panel de ancho 0 (dos verdades distintas).
 *   2. Un dock colapsado guarda su último tamaño abierto (el anterior guardado o el de fábrica), y el panel de
 *      relleno (el editor) se queda con el resto hasta 100.
 */
export function applyGroupLayout(s: LayoutState, group: string, measured: Record<string, number>): LayoutState {
  const spec = GROUP_SPECS[group];
  if (!spec) return setGroupSizes(s, group, measured);
  let next = s;
  const prev = s.sizes[group] ?? DEFAULT_GROUP_SIZES[group] ?? {};
  const out: Record<string, number> = { ...measured };
  for (const [panel, dock] of Object.entries(spec.docks)) {
    const size = measured[panel];
    if (typeof size === "number" && size >= COLLAPSED_EPSILON) continue;
    if (isDockOccupied(next, dock)) next = hideDock(next, dock);
    out[panel] = prev[panel] ?? DEFAULT_GROUP_SIZES[group]?.[panel] ?? 0;
  }
  const docksSum = Object.keys(spec.docks).reduce((acc, p) => acc + (out[p] ?? 0), 0);
  out[spec.fill] = Math.max(0, 100 - docksSum);
  return setGroupSizes(next, group, out);
}

export function isToolWindowId(v: unknown): v is ToolWindowId {
  return typeof v === "string" && (TOOL_WINDOW_IDS as readonly string[]).includes(v);
}

function isDock(v: unknown): v is Dock {
  return typeof v === "string" && (DOCKS as readonly string[]).includes(v);
}

/** Visible y Fijada: ocupa su dock. */
export function isDocked(s: Pick<LayoutState, "modes" | "visible">, id: ToolWindowId): boolean {
  return s.visible[id] && s.modes[id] === "pinned";
}

/** Visible y No fijada: flota encima del contenido (overlay). */
export function isFloating(s: Pick<LayoutState, "modes" | "visible">, id: ToolWindowId): boolean {
  return s.visible[id] && s.modes[id] === "unpinned";
}

/**
 * Valida un estado venido de fuera (localStorage). Lanza con un mensaje legible; el store descarta el valor
 * y usa los defaults, avisando en consola (mismo criterio que el estado de tema: un layout a medias es peor
 * que uno rechazado). Las claves AUSENTES se completan con los defaults; las presentes pero inválidas, no.
 */
export function parseLayoutState(input: unknown): LayoutState {
  if (!input || typeof input !== "object") throw new Error("El layout guardado no es un objeto.");
  const o = input as Record<string, unknown>;

  let bar = DEFAULT_LAYOUT.bar;
  if (o.bar !== undefined) {
    if (o.bar !== "side" && o.bar !== "header") throw new Error(`Modo de barra desconocido: ${String(o.bar)}`);
    bar = o.bar;
  }

  const docks = { ...DEFAULT_LAYOUT.docks };
  if (o.docks !== undefined) {
    if (!o.docks || typeof o.docks !== "object") throw new Error('"docks" debe ser un objeto.');
    for (const [k, val] of Object.entries(o.docks as Record<string, unknown>)) {
      if (!isToolWindowId(k)) throw new Error(`Tool window desconocida en "docks": ${k}`);
      if (!isDock(val)) throw new Error(`Dock desconocido para ${k}: ${String(val)}`);
      docks[k] = val;
    }
  }

  const modes = { ...DEFAULT_LAYOUT.modes };
  const visible = { ...DEFAULT_LAYOUT.visible };
  if (o.visible !== undefined) {
    if (!o.visible || typeof o.visible !== "object") throw new Error('"visible" debe ser un objeto.');
    for (const [k, val] of Object.entries(o.visible as Record<string, unknown>)) {
      if (!isToolWindowId(k)) throw new Error(`Tool window desconocida en "visible": ${k}`);
      if (typeof val !== "boolean") throw new Error(`Visibilidad inválida para ${k}: ${String(val)}`);
      visible[k] = val;
    }
  }
  if (o.modes !== undefined) {
    if (!o.modes || typeof o.modes !== "object") throw new Error('"modes" debe ser un objeto.');
    for (const [k, val] of Object.entries(o.modes as Record<string, unknown>)) {
      if (!isToolWindowId(k)) throw new Error(`Tool window desconocida en "modes": ${k}`);
      if (val === "hidden") {
        // Formato de T1/T2: «oculta» era un modo. Se migra a Fijada + no visible.
        modes[k] = "pinned";
        visible[k] = false;
      } else if (val === "pinned" || val === "unpinned") {
        modes[k] = val;
      } else {
        throw new Error(`Modo de vista desconocido para ${k}: ${String(val)}`);
      }
    }
  }
  /*
    Migración v1 → v2 (fase 70, T3). El dock izquierdo deja de hospedar Guardadas: la columna es
    del explorador. Se mueve Guardadas al dock inferior y se oculta, que es el estado de fábrica
    nuevo; su contenido no se toca y sigue alcanzable desde su stripe y el menú Ver.
  */
  const version = typeof o.v === "number" ? o.v : 1;
  if (version < 2) {
    if (docks.saved === "left") {
      docks.saved = "bottom";
      visible.saved = false;
    }
    // T4: el historial deja el dock inferior (que queda con la rejilla de resultados, sin pestañas
    // de tool window) y se va al derecho, oculto, junto al value editor.
    if (docks.history === "bottom") {
      docks.history = "right";
      visible.history = false;
    }
  }
  /*
    Migración → v3 (R96). Guardadas vuelve al dock izquierdo. En v2 «abajo» era su sitio de fábrica y
    no se distingue de una elección del usuario, así que se mueve siempre desde abajo; si estaba
    abierta, se abre en el izquierdo como la activa (el usuario la estaba usando).
  */
  let guardadasActivaEnIzquierdo = false;
  if (version < 3 && docks.saved === "bottom") {
    docks.saved = "left";
    guardadasActivaEnIzquierdo = visible.saved && modes.saved === "pinned";
  }

  // Una No fijada abierta es transitoria (se cierra al perder foco): al arrancar, nace cerrada.
  for (const id of TOOL_WINDOW_IDS) if (modes[id] === "unpinned") visible[id] = false;

  const active = { ...DEFAULT_LAYOUT.active };
  if (o.active !== undefined) {
    if (!o.active || typeof o.active !== "object") throw new Error('"active" debe ser un objeto.');
    for (const [k, val] of Object.entries(o.active as Record<string, unknown>)) {
      if (!isDock(k)) throw new Error(`Dock desconocido en "active": ${k}`);
      if (val !== null && !isToolWindowId(val)) throw new Error(`Tool window desconocida en "active.${k}": ${String(val)}`);
      // La activa de un dock solo vale si esa tool window vive en ese dock y lo ocupa (fijada y visible): si no,
      // se ignora y se cae a la primera que lo ocupe (coherencia con moveTo/hide/setMode).
      active[k] = val !== null && docks[val] === k && visible[val] && modes[val] === "pinned" ? val : null;
    }
  }

  const sizes: Record<string, Record<string, number>> = {};
  if (o.sizes !== undefined) {
    if (!o.sizes || typeof o.sizes !== "object") throw new Error('"sizes" debe ser un objeto.');
    for (const [group, val] of Object.entries(o.sizes as Record<string, unknown>)) {
      if (!val || typeof val !== "object") throw new Error(`Los tamaños del grupo ${group} deben ser un objeto.`);
      const panels: Record<string, number> = {};
      for (const [panel, size] of Object.entries(val as Record<string, unknown>)) {
        if (typeof size !== "number" || !Number.isFinite(size) || size < 0) {
          throw new Error(`Tamaño inválido en ${group}.${panel}: ${String(size)}`);
        }
        panels[panel] = size;
      }
      sizes[group] = panels;
    }
  }

  if (guardadasActivaEnIzquierdo) active.left = "saved";
  const out: LayoutState = { v: 3, bar, docks, modes, visible, active, sizes };
  for (const d of DOCKS) if (out.active[d] === null) out.active[d] = firstDocked(out, d);
  // R97: un dock muestra UNA tool window. Un layout guardado con dos fijadas visibles en el mismo dock
  // (antes salían como pestañas) se queda con la activa; las demás pasan a ocultas (su botón de la
  // barra las vuelve a abrir).
  for (const d of DOCKS) {
    const activa = out.active[d];
    for (const id of TOOL_WINDOW_IDS) {
      if (id !== activa && out.docks[id] === d && isDocked(out, id)) out.visible[id] = false;
    }
  }
  return out;
}

/** Primera tool window que ocupa un dock (fijada y visible), en el orden del catálogo, o null. */
export function firstDocked(s: Pick<LayoutState, "docks" | "modes" | "visible">, dock: Dock): ToolWindowId | null {
  return TOOL_WINDOW_IDS.find((id) => s.docks[id] === dock && isDocked(s, id)) ?? null;
}

/** Tool windows de un dock, en el orden del catálogo. Incluye las ocultas (la barra las muestra igual). */
export function toolWindowsOf(docks: Record<ToolWindowId, Dock>, dock: Dock): ToolWindowId[] {
  return TOOL_WINDOW_IDS.filter((id) => docks[id] === dock);
}

/** Tool windows que ocupan un dock ahora mismo (fijadas y visibles), en el orden del catálogo. */
export function dockedIn(s: LayoutState, dock: Dock): ToolWindowId[] {
  return toolWindowsOf(s.docks, dock).filter((id) => isDocked(s, id));
}

/**
 * ¿Hay que reservarle sitio al dock? Solo si alguna de SUS tool windows lo ocupa (regla de T2: nunca atar la
 * visibilidad del dock a una tool window concreta). Las No fijadas no cuentan: flotan, no ocupan.
 */
export function isDockOccupied(s: LayoutState, dock: Dock): boolean {
  return dockedIn(s, dock).length > 0;
}

/** Tool windows No fijadas abiertas ahora (el overlay). En la práctica, como mucho una: ver `show`. */
export function floatingWindows(s: LayoutState): ToolWindowId[] {
  return TOOL_WINDOW_IDS.filter((id) => isFloating(s, id));
}

/** La activa de un dock tras un cambio: la que toca pintar (o null si el dock quedó vacío). */
export function resolveActive(s: LayoutState, dock: Dock): ToolWindowId | null {
  const a = s.active[dock];
  if (a && s.docks[a] === dock && isDocked(s, a)) return a;
  return firstDocked(s, dock);
}

/** ¿La marca la barra como activa? Fijada: visible y activa de su dock. No fijada: visible (está encima). */
export function isActive(s: LayoutState, id: ToolWindowId): boolean {
  if (!s.visible[id]) return false;
  return s.modes[id] === "unpinned" || resolveActive(s, s.docks[id]) === id;
}

/**
 * Fase 15 (T6, #87): qué tool window debe ocultar «Hide Active Tool Window» (⇧⎋). PURA y testeable:
 * la pista de foco la deduce el llamador (`layout-store.hideActiveToolWindow` la saca de
 * `document.activeElement`) y aquí sólo se traduce a un id, sin tocar el DOM.
 *
 * Orden:
 *   1. Foco dentro de una No fijada abierta → esa (está encima y es la última que el usuario abrió).
 *   2. Foco dentro de un dock → la activa de ESE dock (`resolveActive`).
 *   3. Sin pista de foco → la No fijada abierta; si no hay, la activa del primer dock ocupado en el
 *      orden derecha → abajo → izquierda. Es un desempate DOCUMENTADO (el store no guarda un
 *      histórico de foco, un MRU real): aproxima «la última tool window que se abrió».
 * Devuelve el id a ocultar, o `null` si no hay ninguna tool window visible que ocultar.
 */
export function toolWindowActivaParaOcultar(
  s: LayoutState,
  pista: { dock: Dock } | { overlay: ToolWindowId } | null
): ToolWindowId | null {
  if (pista && "overlay" in pista) return isFloating(s, pista.overlay) ? pista.overlay : null;
  if (pista && "dock" in pista) {
    const id = resolveActive(s, pista.dock);
    return id && s.visible[id] ? id : null;
  }
  const flotante = floatingWindows(s)[0];
  if (flotante) return flotante;
  for (const dock of ["right", "bottom", "left"] as const) {
    const id = resolveActive(s, dock);
    if (id && s.visible[id]) return id;
  }
  return null;
}

/** Recalcula la activa de cada dock tras un cambio (solo toca las que dejaron de ser válidas). */
function fixActive(s: LayoutState): LayoutState {
  const active = { ...s.active };
  for (const d of DOCKS) active[d] = resolveActive(s, d);
  return { ...s, active };
}

/**
 * Muestra una tool window. Fijada → la activa en su dock. No fijada → la abre encima y cierra las otras No
 * fijadas abiertas: el overlay es uno (abrir otra equivale a que la anterior perdiera el foco).
 *
 * R97 (pedido del usuario, 2026-10-22: «la barra izquierda y el header del panel repiten lo mismo; quedémonos
 * con los iconos de la barra»): un dock muestra UNA tool window, como cada lado de DataGrip (abrir «Files»
 * oculta «Database» y viceversa). Abrir una Fijada OCULTA las demás Fijadas de su dock, así que el dock ya
 * no necesita su tira de pestañas: el botón de la barra es el único conmutador.
 */
export function show(s: LayoutState, id: ToolWindowId): LayoutState {
  const visible = { ...s.visible, [id]: true };
  if (s.modes[id] === "unpinned") {
    for (const other of TOOL_WINDOW_IDS) if (other !== id && s.modes[other] === "unpinned") visible[other] = false;
    return fixActive({ ...s, visible });
  }
  for (const other of TOOL_WINDOW_IDS) {
    if (other !== id && s.docks[other] === s.docks[id] && s.modes[other] === "pinned") visible[other] = false;
  }
  return fixActive({ ...s, visible, active: { ...s.active, [s.docks[id]]: id } });
}

/** «Ocultar»: deja de verse; conserva su modo y su dock. Si era la activa de su dock, pasa a la siguiente. */
export function hide(s: LayoutState, id: ToolWindowId): LayoutState {
  return fixActive({ ...s, visible: { ...s.visible, [id]: false } });
}

/**
 * El gesto de la barra y de los botones del header (como DataGrip): oculta → la muestra; Fijada visible pero
 * no activa → la activa; activa (o No fijada abierta) → la oculta.
 */
export function toggle(s: LayoutState, id: ToolWindowId): LayoutState {
  if (!s.visible[id]) return show(s, id);
  if (s.modes[id] === "pinned" && resolveActive(s, s.docks[id]) !== id) return setActive(s, s.docks[id], id);
  return hide(s, id);
}

/**
 * Cambia el modo de vista (D2). Si está visible sigue visible en el modo nuevo: pasar a No fijada la saca del
 * dock al overlay (y cierra otras No fijadas abiertas); pasar a Fijada la mete en su dock como activa.
 */
export function setMode(s: LayoutState, id: ToolWindowId, mode: ViewMode): LayoutState {
  const next = { ...s, modes: { ...s.modes, [id]: mode } };
  return s.visible[id] ? show(next, id) : fixActive(next);
}

/** «Mover a ▸ …»: cambia el dock de una tool window; si lo ocupa, la deja activa en el destino. */
export function moveTo(s: LayoutState, id: ToolWindowId, dock: Dock): LayoutState {
  const next = fixActive({ ...s, docks: { ...s.docks, [id]: dock } });
  // R97: si llega visible, ocupa el destino ella sola (`show` oculta a las que estaban ahí).
  return isDocked(next, id) ? show(next, id) : next;
}

/** Activa una tool window en un dock (clic en la barra o en una pestaña). */
export function setActive(s: LayoutState, dock: Dock, id: ToolWindowId | null): LayoutState {
  return { ...s, active: { ...s.active, [dock]: id } };
}

/** Guarda los tamaños de un grupo (onLayoutChanged de react-resizable-panels). Ignora valores no finitos. */
export function setGroupSizes(s: LayoutState, group: string, sizes: Record<string, number>): LayoutState {
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(sizes)) if (typeof v === "number" && Number.isFinite(v) && v >= 0) clean[k] = v;
  return { ...s, sizes: { ...s.sizes, [group]: clean } };
}
