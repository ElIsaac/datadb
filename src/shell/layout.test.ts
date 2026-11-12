/**
 * Tests de la lógica pura del layout (fase 9, T1-T3; R12): validación del estado guardado, ida y vuelta,
 * migración del formato de T1/T2, y las transiciones de visibilidad/modo/dock/activa que usan la barra,
 * los menús y el overlay de las No fijadas.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GROUP_SIZES,
  DEFAULT_LAYOUT,
  LAYOUT_GROUPS,
  applyGroupLayout,
  dockedIn,
  firstDocked,
  floatingWindows,
  hide,
  hideDock,
  isActive,
  isDockOccupied,
  moveTo,
  parseLayoutState,
  resolveActive,
  setActive,
  setGroupSizes,
  setMode,
  show,
  toggle,
  toolWindowActivaParaOcultar,
  toolWindowsOf,
  type LayoutState,
} from "./layout";

test("los defaults son coherentes: cada dock activa apunta a una tool window que lo ocupa", () => {
  for (const d of ["left", "bottom", "right"] as const) {
    const a = DEFAULT_LAYOUT.active[d];
    if (a !== null) {
      assert.equal(DEFAULT_LAYOUT.docks[a], d, `${a} debería vivir en ${d}`);
      assert.ok(DEFAULT_LAYOUT.visible[a], `${a} no puede estar oculta y activa`);
      assert.equal(DEFAULT_LAYOUT.modes[a], "pinned");
    }
  }
  assert.equal(resolveActive(DEFAULT_LAYOUT, "left"), "explorer");
  assert.equal(resolveActive(DEFAULT_LAYOUT, "bottom"), "results");
  assert.equal(resolveActive(DEFAULT_LAYOUT, "right"), null);
});

test("parseLayoutState: ida y vuelta exacta y tolerancia a claves ausentes", () => {
  const round = parseLayoutState(JSON.parse(JSON.stringify(DEFAULT_LAYOUT)));
  assert.deepEqual(round, DEFAULT_LAYOUT);
  const parcial = parseLayoutState({ v: 1, bar: "header" });
  assert.equal(parcial.bar, "header");
  assert.deepEqual(parcial.docks, DEFAULT_LAYOUT.docks);
  assert.deepEqual(parcial.modes, DEFAULT_LAYOUT.modes);
  assert.deepEqual(parcial.visible, DEFAULT_LAYOUT.visible);
});

test("parseLayoutState rechaza basura con mensaje (no importa a medias)", () => {
  assert.throws(() => parseLayoutState(null), /no es un objeto/);
  assert.throws(() => parseLayoutState({ v: 1, bar: "izquierda" }), /Modo de barra desconocido/);
  assert.throws(() => parseLayoutState({ v: 1, docks: { consolas: "left" } }), /Tool window desconocida/);
  assert.throws(() => parseLayoutState({ v: 1, docks: { explorer: "arriba" } }), /Dock desconocido/);
  assert.throws(() => parseLayoutState({ v: 1, modes: { explorer: "float" } }), /Modo de vista desconocido/);
  assert.throws(() => parseLayoutState({ v: 1, visible: { explorer: "si" } }), /Visibilidad inválida/);
  assert.throws(() => parseLayoutState({ v: 1, sizes: { g: { a: "22" } } }), /Tamaño inválido/);
});

/**
 * Escenario de dos tool windows fijadas y visibles en el dock izquierdo. Hasta la fase 70 era el
 * arranque de fábrica; desde T3 la columna izquierda es solo del explorador, así que las pruebas
 * de las transiciones (hide/toggle/setMode/moveTo) arman este estado a mano para no perder el caso
 * «visible pero no activa», que es el que distingue «alternar» de «toggle a lo bruto».
 */
const DOS_EN_IZQUIERDA: LayoutState = {
  ...DEFAULT_LAYOUT,
  docks: { ...DEFAULT_LAYOUT.docks, saved: "left" },
  visible: { ...DEFAULT_LAYOUT.visible, saved: true },
  active: { ...DEFAULT_LAYOUT.active, left: "explorer" },
};

test("parseLayoutState migra el formato de T1/T2 (`hidden` era un modo) a Fijada + no visible", () => {
  const s = parseLayoutState({ v: 1, modes: { explorer: "hidden", ai: "pinned" }, active: { left: "explorer" } });
  assert.equal(s.modes.explorer, "pinned");
  assert.equal(s.visible.explorer, false);
  // v1 → v2 (fase 70, T3) la llevaba al dock inferior oculta; v2 → v3 (R96) la devuelve al
  // izquierdo, SIN abrirla: la activa del izquierdo cae al explorador (que aquí está oculto) → null.
  assert.equal(s.docks.saved, "left");
  assert.equal(s.visible.saved, false);
  assert.equal(s.active.left, null);
});

test("parseLayoutState v2: Guardadas se queda donde el usuario la puso", () => {
  const s = parseLayoutState({ v: 2, docks: { saved: "left" }, visible: { saved: true }, active: { left: "saved" } });
  assert.equal(s.docks.saved, "left");
  assert.equal(s.visible.saved, true);
  // R97: un dock, una tool window — el explorador (que compartía el dock) queda oculto.
  assert.equal(s.visible.explorer, false);
});

test("R97: un dock muestra UNA tool window — abrir otra del mismo dock oculta la anterior", () => {
  let s = show(DEFAULT_LAYOUT, "saved"); // ⌘2 / clic en su botón de la barra
  assert.equal(s.active.left, "saved");
  assert.equal(s.visible.explorer, false, "el explorador se oculta: no hay pestañas que lo mantengan de fondo");
  assert.deepEqual(dockedIn(s, "left"), ["saved"]);
  s = toggle(s, "explorer"); // su botón de la barra lo devuelve
  assert.equal(s.active.left, "explorer");
  assert.equal(s.visible.saved, false);
  s = toggle(s, "explorer"); // clic en el activo: el lado se cierra entero, como en DataGrip
  assert.equal(isDockOccupied(s, "left"), false);
  // Los demás docks no se tocan.
  assert.ok(s.visible.results);
  // Lo mismo en el derecho (historial y valor).
  let d = show(DEFAULT_LAYOUT, "history");
  d = show(d, "value");
  assert.deepEqual(dockedIn(d, "right"), ["value"]);
  // Mover una visible a un dock ocupado la deja sola ahí.
  const m = moveTo(show(DEFAULT_LAYOUT, "history"), "explorer", "right");
  assert.deepEqual(dockedIn(m, "right"), ["explorer"]);
  // Un layout guardado con dos visibles en el mismo dock se queda con la activa.
  const p = parseLayoutState({ v: 3, visible: { explorer: true, ai: true }, active: { left: "ai" } });
  assert.deepEqual(dockedIn(p, "left"), ["ai"]);
});

test("parseLayoutState v2 → v3 (R96): Guardadas sale del dock inferior al izquierdo", () => {
  // Abierta abajo → abierta a la izquierda y activa ahí (el usuario la estaba usando).
  const abierta = parseLayoutState({ v: 2, docks: { saved: "bottom" }, visible: { saved: true }, active: { left: "explorer" } });
  assert.equal(abierta.docks.saved, "left");
  assert.equal(abierta.active.left, "saved");
  assert.equal(abierta.active.bottom, "results", "el dock inferior se queda con los resultados");
  // Oculta abajo → oculta a la izquierda; el explorador sigue siendo la activa.
  const oculta = parseLayoutState({ v: 2, docks: { saved: "bottom" }, visible: { saved: false } });
  assert.equal(oculta.docks.saved, "left");
  assert.equal(oculta.active.left, "explorer");
  // Ya en v3, abajo es elección del usuario y se respeta.
  assert.equal(parseLayoutState({ v: 3, docks: { saved: "bottom" } }).docks.saved, "bottom");
});

test("parseLayoutState: una No fijada abierta nace cerrada (su visibilidad es transitoria)", () => {
  const s = parseLayoutState({ v: 1, modes: { ai: "unpinned" }, visible: { ai: true } });
  assert.equal(s.modes.ai, "unpinned");
  assert.equal(s.visible.ai, false);
});

test("parseLayoutState ignora una activa incoherente y cae a la primera que ocupa el dock", () => {
  const s = parseLayoutState({ v: 1, active: { left: "results" } }); // results vive abajo
  assert.equal(s.active.left, "explorer");
  const oculta = parseLayoutState({ v: 1, active: { left: "ai" }, visible: { ai: false } });
  assert.equal(oculta.active.left, "explorer");
});

test("hide: ocultar la activa pasa la activa a la siguiente; si no queda ninguna, null", () => {
  let s: LayoutState = DOS_EN_IZQUIERDA;
  s = hide(s, "explorer");
  assert.equal(s.active.left, "saved");
  s = hide(s, "saved");
  assert.equal(s.active.left, null); // ai está oculta por defecto: el dock queda vacío
  assert.equal(isDockOccupied(s, "left"), false);
});

test("toggle: oculta → muestra; Fijada visible no activa → activa; activa → oculta", () => {
  let s: LayoutState = DOS_EN_IZQUIERDA;
  s = toggle(s, "saved"); // visible pero no activa (la activa es el explorador)
  assert.equal(s.active.left, "saved");
  assert.ok(s.visible.saved);
  s = toggle(s, "saved"); // activa → oculta
  assert.equal(s.visible.saved, false);
  assert.equal(s.active.left, "explorer");
  s = toggle(s, "ai"); // oculta → la muestra y la activa
  assert.ok(s.visible.ai);
  assert.equal(s.active.left, "ai");
});

test("ocultar conserva el modo: una No fijada vuelve No fijada (no Fijada, como en T1/T2)", () => {
  let s = setMode(DEFAULT_LAYOUT, "ai", "unpinned");
  s = show(s, "ai");
  s = hide(s, "ai");
  s = toggle(s, "ai");
  assert.equal(s.modes.ai, "unpinned");
  assert.deepEqual(floatingWindows(s), ["ai"]);
});

test("No fijada: no ocupa el dock, la barra la marca activa y solo hay un overlay a la vez", () => {
  let s = setMode(DEFAULT_LAYOUT, "results", "unpinned"); // estaba visible: pasa al overlay
  assert.deepEqual(floatingWindows(s), ["results"]);
  assert.equal(isDockOccupied(s, "bottom"), false); // el dock inferior se colapsa: el editor no se encoge
  assert.equal(s.active.bottom, null);
  assert.ok(isActive(s, "results"));
  s = setMode(s, "history", "unpinned");
  s = show(s, "history"); // abrir otra No fijada cierra la anterior (perdió el foco)
  assert.deepEqual(floatingWindows(s), ["history"]);
  assert.equal(s.visible.results, false);
});

test("setMode: volver a Fijada mete la tool window visible en su dock como activa", () => {
  let s = setMode(DOS_EN_IZQUIERDA, "saved", "unpinned");
  assert.equal(s.active.left, "explorer");
  s = setMode(s, "saved", "pinned");
  assert.equal(s.active.left, "saved");
  assert.deepEqual(floatingWindows(s), []);
});

test("moveTo: cambia el dock, reasigna la activa del origen y activa la del destino", () => {
  const s = moveTo(DOS_EN_IZQUIERDA, "saved", "right");
  assert.equal(s.docks.saved, "right");
  assert.equal(s.active.right, "saved");
  assert.equal(s.active.left, "explorer");
  assert.ok(isDockOccupied(s, "right"));
  const t = moveTo(DOS_EN_IZQUIERDA, "explorer", "bottom");
  assert.equal(t.active.left, "saved"); // la siguiente que ocupa el izquierdo
  assert.equal(t.active.bottom, "explorer");
  const oculta = moveTo(DEFAULT_LAYOUT, "ai", "right"); // oculta: cambia de dock pero no lo ocupa
  assert.equal(oculta.docks.ai, "right");
  assert.equal(oculta.active.right, null);
});

test("setGroupSizes: guarda por grupo, ignora valores no finitos y no toca otros grupos", () => {
  let s = setGroupSizes(DEFAULT_LAYOUT, "main-horizontal", { "schema-panel": 22, "main-panel": 56 });
  s = setGroupSizes(s, "main-horizontal", { "schema-panel": Number.NaN, "main-panel": 50 });
  assert.deepEqual(s.sizes["main-horizontal"], { "main-panel": 50 });
  s = setGroupSizes(s, "editor-vertical", { "sql-editor-panel": 45 });
  assert.deepEqual(Object.keys(s.sizes).sort(), ["editor-vertical", "main-horizontal"]);
});

test("toolWindowsOf y firstDocked respetan el orden del catálogo", () => {
  assert.deepEqual(toolWindowsOf(DOS_EN_IZQUIERDA.docks, "left"), ["explorer", "saved", "ai"]);
  // R96: Guardadas vuelve a la columna izquierda (oculta de fábrica, como la IA).
  assert.deepEqual(toolWindowsOf(DEFAULT_LAYOUT.docks, "left"), ["explorer", "saved", "ai"]);
  // T4: el dock inferior es de los resultados (el historial se fue al derecho, oculto).
  assert.deepEqual(toolWindowsOf(DEFAULT_LAYOUT.docks, "bottom"), ["results"]);
  // Fase 12 (T2): el dock derecho dejó de estar vacío — ahí vive el value editor. Sigue COLAPSADO
  // de fábrica porque `visible.value` es false, que es cosa distinta de no tener nada asignado.
  assert.deepEqual(toolWindowsOf(DEFAULT_LAYOUT.docks, "right"), ["history", "value"]);
  assert.equal(DEFAULT_LAYOUT.visible.value, false, "de fábrica el panel del valor está oculto");
  assert.equal(DEFAULT_LAYOUT.active.right, null, "y el dock derecho no tiene tool window activa");
  assert.equal(firstDocked(DEFAULT_LAYOUT, "bottom"), "results");
});

test("fase 12 (T2): un layout guardado ANTES del value editor sigue cargando", () => {
  // El riesgo real de añadir una tool window es romperle el layout a quien ya usaba la app. El
  // parser parte de DEFAULT_LAYOUT y superpone sólo las claves conocidas, así que un layout sin
  // `value` debe cargar con el valor de fábrica y SIN tocar lo que el usuario tenía colocado.
  const guardadoV1 = {
    v: 1,
    bar: "header",
    docks: { explorer: "left", saved: "bottom", ai: "left", results: "bottom", history: "bottom" },
    modes: { explorer: "unpinned", saved: "pinned", ai: "pinned", results: "pinned", history: "pinned" },
    visible: { explorer: true, saved: true, ai: true, results: true, history: false },
    active: { left: "explorer", bottom: "results", right: null },
    sizes: { "main-horizontal": { "schema-panel": 30, "main-panel": 70 } },
  };
  const s = parseLayoutState(guardadoV1);
  assert.equal(s.docks.value, "right", "la tool window nueva toma su dock de fábrica");
  assert.equal(s.visible.value, false, "y nace oculta, sin abrirle el dock derecho a nadie");
  // Lo que el usuario tenía colocado se respeta tal cual.
  assert.equal(s.bar, "header");
  // Salvo Guardadas: de v1/v2 «abajo» era su sitio de fábrica y R96 la devuelve al izquierdo.
  assert.equal(s.docks.saved, "left");
  assert.equal(s.modes.explorer, "unpinned");
  // Guardadas estaba abierta: R96 la lleva al izquierdo como activa y, por R97 (un dock, una tool
  // window), la IA que estaba ahí pasa a oculta (su botón de la barra la reabre).
  assert.equal(s.active.left, "saved");
  assert.equal(s.visible.ai, false);
  assert.deepEqual(s.sizes["main-horizontal"], { "schema-panel": 30, "main-panel": 70 });
});

test("setActive acepta null para vaciar un dock", () => {
  const s = setActive(DEFAULT_LAYOUT, "left", null);
  assert.equal(s.active.left, null);
});

test("applyGroupLayout (T4): guarda el arrastre tal cual cuando todos los docks están abiertos", () => {
  const s = applyGroupLayout(DEFAULT_LAYOUT, LAYOUT_GROUPS.main, { "schema-panel": 30, "main-panel": 70, "right-panel": 0 });
  assert.deepEqual(s.sizes[LAYOUT_GROUPS.main], { "schema-panel": 30, "main-panel": 70, "right-panel": 0 });
  assert.ok(s.visible.explorer);
});

test("applyGroupLayout (T4): un dock oculto (colapsado a 0) conserva su último tamaño abierto", () => {
  let s = applyGroupLayout(DEFAULT_LAYOUT, LAYOUT_GROUPS.main, { "schema-panel": 30, "main-panel": 70, "right-panel": 0 });
  s = hideDock(s, "left");
  // Con el explorador oculto, el usuario mueve otro separador: la librería entrega schema-panel = 0.
  s = applyGroupLayout(s, LAYOUT_GROUPS.main, { "schema-panel": 0, "main-panel": 75, "right-panel": 25 });
  assert.deepEqual(s.sizes[LAYOUT_GROUPS.main], { "schema-panel": 30, "main-panel": 45, "right-panel": 25 });
});

test("applyGroupLayout (T4): arrastrar un dock ocupado hasta colapsarlo lo oculta (barra y panel coinciden)", () => {
  const s = applyGroupLayout(DEFAULT_LAYOUT, LAYOUT_GROUPS.editor, { "sql-editor-panel": 100, "sql-results-panel": 0 });
  assert.equal(s.visible.results, false);
  assert.equal(isDockOccupied(s, "bottom"), false);
  assert.deepEqual(s.sizes[LAYOUT_GROUPS.editor], { "sql-editor-panel": 45, "sql-results-panel": 55 }); // el de fábrica
  const t = applyGroupLayout(DEFAULT_LAYOUT, LAYOUT_GROUPS.main, { "schema-panel": 0, "main-panel": 100, "right-panel": 0 });
  assert.equal(t.visible.explorer, false);
  assert.equal(t.visible.saved, false); // el dock entero: Guardadas también vivía ahí
});

test("los tamaños de fábrica de cada grupo suman 100", () => {
  for (const [g, sizes] of Object.entries(DEFAULT_GROUP_SIZES)) {
    assert.equal(Object.values(sizes).reduce((a, b) => a + b, 0), 100, g);
  }
});

// ---------------------------------------------------------------------------
// Fase 15 (T6): Hide Active Tool Window (⇧⎋, #87) — el resolver PURO
// ---------------------------------------------------------------------------

test("toolWindowActivaParaOcultar: el foco dentro de un dock manda, y el overlay gana al dock", () => {
  // Pista de dock: la activa de ESE dock (quien tiene el foco decide).
  assert.equal(toolWindowActivaParaOcultar(DEFAULT_LAYOUT, { dock: "left" }), "explorer");
  assert.equal(toolWindowActivaParaOcultar(DEFAULT_LAYOUT, { dock: "bottom" }), "results");
  assert.equal(
    toolWindowActivaParaOcultar(DEFAULT_LAYOUT, { dock: "right" }),
    null,
    "el dock derecho no tiene nada visible de fábrica"
  );
  // Pista de overlay que no está flotando: nada que ocultar (no se oculta lo que no se ve).
  assert.equal(toolWindowActivaParaOcultar(DEFAULT_LAYOUT, { overlay: "ai" }), null);
});

test("toolWindowActivaParaOcultar: la No fijada abierta gana como overlay y como respaldo sin foco", () => {
  let s = setMode(DEFAULT_LAYOUT, "ai", "unpinned");
  s = show(s, "ai");
  assert.deepEqual(floatingWindows(s), ["ai"]);
  assert.equal(toolWindowActivaParaOcultar(s, { overlay: "ai" }), "ai");
  assert.equal(
    toolWindowActivaParaOcultar(s, null),
    "ai",
    "sin pista de foco se oculta la que está encima (la última abierta)"
  );
  assert.equal(
    toolWindowActivaParaOcultar(s, { dock: "left" }),
    "explorer",
    "con el foco en un dock, ese dock manda sobre el overlay"
  );
});

test("toolWindowActivaParaOcultar: sin pista ni overlay cae a la activa del primer dock ocupado", () => {
  // Sin el izquierdo, el siguiente dock ocupado en el orden documentado (derecha → abajo → izquierda)
  // es el inferior con Resultados.
  const sinIzquierdo = hideDock(DEFAULT_LAYOUT, "left");
  assert.equal(toolWindowActivaParaOcultar(sinIzquierdo, null), "results");
  // Con la derecha ocupada (value editor visible y activo), esa gana.
  const conDerecha = show(DEFAULT_LAYOUT, "value");
  assert.equal(toolWindowActivaParaOcultar(conDerecha, null), "value");
  // Nada visible: no hay nada que ocultar (no se toca el estado).
  const vacio: LayoutState = {
    ...DEFAULT_LAYOUT,
    visible: { ...DEFAULT_LAYOUT.visible, explorer: false, saved: false, results: false },
  };
  assert.equal(toolWindowActivaParaOcultar(vacio, null), null);
  assert.equal(toolWindowActivaParaOcultar(vacio, { dock: "left" }), null);
});
