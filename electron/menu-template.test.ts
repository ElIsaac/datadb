/**
 * Fase 15 (R13) · Tarea T3 — tests del template del menú nativo (`electron/menu-template.ts`).
 *
 * Aquí NO se toca Electron: `menu-template.ts` no importa el módulo `electron` en tiempo de
 * ejecución (sólo `import type`, que se borra al compilar), así que se puede recorrer el template
 * construido y comprobar sus aceleradores con `node:test`. Lo que se verifica:
 *
 *  1. Cada acelerador que el menú declara es EXACTAMENTE `aAceleradorElectron` de la entrada del
 *     registro: no hay ninguna tecla escrita a mano que se haya desviado del registro. Las dos
 *     únicas excepciones están declaradas (`ACELERADORES_FUERA_DEL_REGISTRO`).
 *  2. No hay dos ítems con el MISMO acelerador (dos ítems que compitan por la misma tecla es el
 *     bug que la fase entera existe para matar).
 *  3. Las cuatro acciones nuevas de `ACCIONES_MENU_NUEVAS` están ya en `MENU_ACTIONS` y tienen
 *     ítem propio (T3 completa lo que T2 dejó declarado).
 *  4. Las excepciones documentadas se comportan como dicen: el Value Editor enseña ⇧⏎ pero no lo
 *     captura en la práctica (es un acelerador de display); Hide Active Tool Window no lleva
 *     acelerador y su etiqueta enseña ⇧⎋; en dev el rol Reload pierde ⌘R (D8).
 *
 * Runner: `npm test` → `tsx --test "src/**\/*.test.ts" "electron/**\/*.test.ts"` (node:test).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { MenuItemConstructorOptions } from "electron";

import { MENU_ACTIONS, isMenuAction, type MenuAction } from "@/shared/menu-actions";
import { ACCIONES_MENU_NUEVAS, aAceleradorElectron, entradaPorId } from "@/shared/keymap";
import {
  ACELERADORES_FUERA_DEL_REGISTRO,
  ACCIONES_SOLO_MOSTRAR,
  aceleradorDeAccionDeMenu,
  construirTemplate,
  entradaDeAccionDeMenu,
} from "./menu-template";

/** Construye el template con un `emitir` que no hace nada y los valores por defecto. */
function template(dev = false): MenuItemConstructorOptions[] {
  return construirTemplate({
    estado: {
      connected: true,
      queryRunning: true,
      txManual: true,
      txActive: true,
      hasSql: true,
    },
    dev,
    appName: "DataDB",
    emitir: () => undefined,
  });
}

/** Recorre el árbol de menús (incluidos los submenús) y devuelve todos los ítems planos. */
function aplanar(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = [];
  for (const it of items) {
    out.push(it);
    if (Array.isArray(it.submenu)) out.push(...aplanar(it.submenu));
  }
  return out;
}

// ============================================================================================
// El registro es la única fuente de los aceleradores
// ============================================================================================
describe("T3 — el menú declara los aceleradores del registro", () => {
  test("cada ítem con id de acción tiene el acelerador derivado del registro (o el override)", () => {
    // Una misma acción puede aparecer en dos menús (hoy sólo `ai.settings`: «Settings…» en el de la
    // app, que conserva ⌘,, y «AI Settings…» en el de IA, sin acelerador). La regla es: si el
    // registro le da acelerador, AL MENOS un ítem lo declara y NINGUNO declara otro distinto.
    const porId = new Map<string, (string | undefined)[]>();
    for (const it of aplanar(template())) {
      if (!it.id) continue; // roles (undo, copy, reload…) y separadores no llevan id de acción
      assert.ok(isMenuAction(it.id), `el ítem del menú trae un id que no es una acción de menú: ${it.id}`);
      porId.set(it.id, [...(porId.get(it.id) ?? []), it.accelerator]);
    }
    for (const [id, accel] of porId) {
      const esperado = aceleradorDeAccionDeMenu(id as MenuAction) ?? ACELERADORES_FUERA_DEL_REGISTRO[id as MenuAction];
      const definidos = accel.filter((a): a is string => a !== undefined);
      for (const a of definidos) {
        assert.equal(
          a,
          esperado,
          `el ítem "${id}" declara ${JSON.stringify(a)} y el registro/override dice ${JSON.stringify(esperado)}`
        );
      }
      if (esperado !== undefined) {
        assert.ok(definidos.includes(esperado), `ningún ítem de "${id}" declara su acelerador ${esperado}`);
      }
    }
  });

  test("cada acelerador del menú es `aAceleradorElectron` de su entrada del registro", () => {
    // La comprobación explícita que pide la tarea: ninguno se desvía del conversor del registro.
    for (const it of aplanar(template())) {
      const id = it.id;
      if (!id || !isMenuAction(id) || !it.accelerator) continue;
      if (id in ACELERADORES_FUERA_DEL_REGISTRO) continue; // fuera de R13, con override documentado

      const entrada = entradaDeAccionDeMenu(id);
      assert.ok(entrada, `"${id}" está en el menú pero no en el registro`);
      assert.equal(
        it.accelerator,
        aAceleradorElectron(entrada.tecla),
        `"${id}" debería salir del registro como ${aAceleradorElectron(entrada.tecla)}`
      );
    }
  });

  test("no hay dos ítems del menú con el mismo acelerador", () => {
    const vistos = new Map<string, string>();
    for (const it of aplanar(template(true))) {
      if (!it.accelerator) continue;
      const dueno = vistos.get(it.accelerator);
      assert.equal(dueno, undefined, `el acelerador ${it.accelerator} lo usan "${dueno}" y "${it.id ?? it.label}"`);
      vistos.set(it.accelerator, it.id ?? String(it.label));
    }
  });

  test("T8: ningún ítem del menú captura una tecla de borrado (⌫/⌦/⌘⌫)", () => {
    // §5.1 de `T8-oraculo.md`: `⌘⌫` pasó a ser la tecla de Delete Row en la rejilla (y sigue siendo
    // deleteLine en el editor). En macOS un acelerador de menú captura la tecla SIEMPRE, así que si
    // el rol nativo `delete` del menú Edit (o cualquier ítem) declarara `⌘⌫`, el renderer no la
    // vería y el enrutador no podría servirla. Se comprueba en dos niveles: el template no le pone
    // acelerador al rol, y ningún ítem acaba en Backspace/Delete. Medido además contra Electron:
    // un `new MenuItem({role:"delete"})` sale con `accelerator: null` (sonda `f15-t8-rol-delete.out`).
    const del = aplanar(template()).find((it) => it.role === "delete");
    assert.ok(del, "falta el rol delete del menú Edit");
    assert.equal(del.accelerator, undefined, "el rol delete no puede declarar acelerador");
    for (const it of aplanar(template())) {
      if (!it.accelerator) continue;
      assert.ok(
        !/(^|\+)(Backspace|Delete)$/i.test(it.accelerator),
        `"${it.id ?? it.label}" capturaría una tecla de borrado: ${it.accelerator}`
      );
    }
  });

  test("los aceleradores de dos ítems con el MISMO id no chocan", () => {
    // `ai.settings` sale en dos menús (Settings… y AI Settings…) a propósito; el test de unicidad de
    // aceleradores de arriba es el que garantiza que la copia no repite ⌘,.
    const porId = new Map<string, Set<string>>();
    for (const it of aplanar(template())) {
      if (!it.id || !it.accelerator) continue;
      const set = porId.get(it.id) ?? new Set<string>();
      set.add(it.accelerator);
      porId.set(it.id, set);
    }
    for (const [id, set] of porId) {
      assert.ok(set.size <= 1, `"${id}" declara dos aceleradores distintos: ${[...set].join(", ")}`);
    }
  });

  test("los aceleradores clave del registro llegan al menú con su texto exacto", () => {
    // Valores copiados a mano de la tabla del PLAN, para que un cambio silencioso en los
    // conversores se vea aquí además de en keymap.test.ts.
    const accs = new Map<string, Set<string>>();
    for (const it of aplanar(template())) {
      if (!it.id || !it.accelerator) continue;
      const set = accs.get(it.id) ?? new Set<string>();
      set.add(it.accelerator);
      accs.set(it.id, set);
    }
    const es = (id: string, acc: string) =>
      assert.ok(accs.get(id)?.has(acc), `"${id}" debería declarar ${acc}; declara ${[...(accs.get(id) ?? [])]}`);
    es("file.newConsole", "Shift+Cmd+Q"); // ⌘⇧Q (#11)
    es("query.cancel", "Cmd+F2"); // ⌘F2 (#3)
    es("query.execute", "Cmd+Return"); // ⌘⏎ (#1)
    es("view.toolWindow.explorer", "Cmd+1"); // ⌘1 (#80)
    es("view.toolWindow.saved", "Cmd+2"); // ⌘2 (#81)
    es("view.toolWindow.results", "Cmd+8"); // ⌘8 (#85)
    es("view.toolWindow.history", "Cmd+Alt+E"); // ⌘⌥E (#8)
    es("view.erDiagram", "Shift+Cmd+Alt+U"); // ⌘⌥⇧U (#6)
    es("view.nextTab", "Shift+Cmd+]"); // ⌘⇧] (#68)
    es("view.prevTab", "Shift+Cmd+["); // ⌘⇧[ (#68)
    es("view.commandPalette", "Shift+Cmd+A"); // ⌘⇧A (#52)
    es("edit.formatSql", "Cmd+Alt+L"); // ⌘⌥L (#30) — el `control alt L` del XML de DataGrip es ⌥⌘L,
    // no ⌃⌥L: en `keymaps/$default.xml` el modificador `control` es ⌘ y `meta` es ⌃. Lo confirma el
    // menú de la app viva (`Reformat Code` → CmdChar=L, CmdModifiers=2 = ⌥+⌘). Ver §5.1 de
    // `research/rea-datagrip.md`.
    es("ai.settings", "Cmd+,"); // ⌘, (#79) — sólo el «Settings…» del menú de la app
    es("query.explain", "Shift+Cmd+J"); // ⇧⌘J (app, #—)
  });
});

// ============================================================================================
// Las acciones nuevas (T3 completa lo que T2 declaró) y las excepciones documentadas
// ============================================================================================
describe("T3 — acciones nuevas y excepciones del menú", () => {
  test("las 4 acciones de ACCIONES_MENU_NUEVAS ya están en MENU_ACTIONS", () => {
    // T2 las declaró aparte y el test de keymap las unía de forma provisional; T3 las mete en la
    // lista cerrada. Este test es el que evita que vuelvan a separarse.
    for (const a of ACCIONES_MENU_NUEVAS) {
      assert.ok(
        (MENU_ACTIONS as readonly string[]).includes(a),
        `"${a}" debería estar ya en MENU_ACTIONS`
      );
    }
  });

  test("las 4 acciones nuevas tienen ítem propio en el menú", () => {
    const ids = new Set(aplanar(template()).map((it) => it.id).filter(Boolean));
    for (const a of ACCIONES_MENU_NUEVAS) assert.ok(ids.has(a), `falta el ítem de "${a}" en el menú`);
    assert.ok(ids.has("help.shortcuts"), "falta Help ▸ Keyboard Shortcuts (help.shortcuts)");
  });

  test("el Value Editor enseña ⇧⏎ (display) aunque en macOS no lo capture el menú", () => {
    assert.deepEqual([...ACCIONES_SOLO_MOSTRAR], ["view.toolWindow.value"]);
    assert.equal(aceleradorDeAccionDeMenu("view.toolWindow.value"), "Shift+Return");
    const value = aplanar(template()).find((it) => it.id === "view.toolWindow.value");
    assert.ok(value);
    assert.equal(value.accelerator, "Shift+Return");
  });

  test("Hide Active Tool Window no lleva acelerador y enseña ⇧⎋ en la etiqueta", () => {
    assert.equal(aceleradorDeAccionDeMenu("view.hideToolWindow"), undefined);
    const hide = aplanar(template()).find((it) => it.id === "view.hideToolWindow");
    assert.ok(hide, "falta el ítem de Hide Active Tool Window");
    assert.equal(hide.accelerator, undefined);
    assert.match(String(hide.label), /⇧⎋/);
  });

  test("los alias globales NO se cuelan como acelerador del menú", () => {
    // ⇧⌘F, ⌘⇧U y ⌘K son alias (D1) que un MenuItem no puede llevar: los servirá el enrutador. El
    // registro SÍ los conserva; el menú NO los declara.
    const accelerators = new Set(aplanar(template()).map((it) => it.accelerator).filter(Boolean));
    assert.ok(!accelerators.has("Shift+Cmd+F"), "⇧⌘F es alias del enrutador, no acelerador del menú");
    assert.ok(!accelerators.has("Shift+Cmd+U"), "⌘⇧U es alias del enrutador, no acelerador del menú");
    assert.ok(!accelerators.has("Cmd+K"), "⌘K es alias de la paleta, no acelerador del menú");
  });

  test("D8: en dev el rol Reload pierde ⌘R y forceReload no choca", () => {
    const items = aplanar(template(true));
    const reload = items.find((it) => it.role === "reload");
    const force = items.find((it) => it.role === "forceReload");
    assert.ok(reload, "en dev debe existir el rol Reload");
    assert.ok(force, "en dev debe existir el rol forceReload");
    assert.notEqual(reload.accelerator, "Cmd+R", "D8: Reload no puede quedarse con ⌘R en dev");
    assert.equal(reload.accelerator, "Shift+Cmd+R");
    assert.equal(force.accelerator, "Shift+Cmd+Alt+R");
    // En la app empaquetada ni siquiera existen (D4 de la fase 7).
    const prod = aplanar(template(false));
    assert.equal(prod.find((it) => it.role === "reload"), undefined);
    assert.equal(prod.find((it) => it.role === "toggleDevTools"), undefined);
  });

  test("el menú Help existe y su ítem es help.shortcuts", () => {
    const help = template().find((it) => it.label === "Help");
    assert.ok(help, "falta el menú Help (se borró la decisión «D9: sin menú Help»)");
    assert.ok(Array.isArray(help.submenu));
    const shortcuts = (help.submenu as MenuItemConstructorOptions[]).find((it) => it.id === "help.shortcuts");
    assert.ok(shortcuts);
    assert.equal(shortcuts.accelerator, undefined, "Keyboard Shortcuts no tiene atajo: se llega por el menú");
  });
});

// ============================================================================================
// Consultas del registro que el menú usa
// ============================================================================================
describe("T3 — entradaDeAccionDeMenu", () => {
  test("encuentra la entrada del registro de cada acción de menú y no inventa", () => {
    assert.equal(entradaDeAccionDeMenu("query.execute")?.id, "execute");
    assert.equal(entradaDeAccionDeMenu("view.commandPalette")?.id, "findAction");
    assert.equal(entradaDeAccionDeMenu("file.saveQuery"), undefined, "Save Query no tiene fila en el registro");
    assert.equal(entradaDeAccionDeMenu("no-existe"), undefined);
  });

  test("cada acción de menú que R13 cubre tiene como mucho una entrada del registro", () => {
    const porAccion = new Map<string, string[]>();
    for (const e of [entradaPorId("execute"), entradaPorId("findAction"), entradaPorId("reformatCode")]) {
      assert.ok(e);
      const list = porAccion.get(e.accion.tipo === "menu" ? e.accion.id : "") ?? [];
      list.push(e.id);
      if (e.accion.tipo === "menu") porAccion.set(e.accion.id, list);
    }
    for (const [accion, entradas] of porAccion) {
      assert.equal(entradas.length, 1, `la acción ${accion} tiene ${entradas.length} entradas en el registro`);
    }
  });

  test("hay un ítem por cada acción de MENU_ACTIONS (ninguna entrada muda en el menú)", () => {
    const ids = new Set(aplanar(template()).map((it) => it.id).filter(Boolean));
    for (const a of MENU_ACTIONS as readonly MenuAction[]) {
      assert.ok(ids.has(a), `la acción "${a}" está en MENU_ACTIONS pero no tiene ítem en el menú`);
    }
  });
});
