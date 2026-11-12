/**
 * Fase 15 (R13) · Tarea T2 — tests del registro de atajos (`src/shared/keymap.ts`).
 *
 * Dos bloques, y el primero es el que de verdad importa:
 *
 *  1. INVARIANTES. No son tests de «devuelve esto»: son propiedades que el registro entero tiene
 *     que cumplir, y son la razón de existir del registro (D5). El valor de tener una tabla única
 *     es poder decir mecánicamente «no hay dos acciones con la misma tecla en el mismo contexto»;
 *     si estos tests se ponen rojos, la tabla deja de ser la fuente de verdad.
 *
 *  2. CONVERSORES. Que la forma propia de la tecla (`{ mods, key }`) se traduzca bien a los tres
 *     formatos que la app necesita: acelerador de Electron (T3, el menú), tecla de CodeMirror (T4)
 *     y texto para mostrar (T7, la referencia de Help ▸ «Atajos de teclado»).
 *
 * Runner: `npm test` → `tsx --test "src/**\/*.test.ts" "electron/**\/*.test.ts"` (node:test).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { MENU_ACTIONS } from "./menu-actions";
import {
  ACCIONES_APP,
  ACCIONES_MENU_NUEVAS,
  REGISTRO,
  aAceleradorElectron,
  aTeclaCodeMirror,
  aTextoMac,
  atajosDe,
  entradaPorId,
  huellaTecla,
  mismaTecla,
  resolver,
  textosDe,
  type Contexto,
  type Entrada,
  type Mod,
  type Tecla,
} from "./keymap";

/** Fábrica de teclas para los tests, igual que la de dentro del módulo. */
function t(key: string, ...mods: Mod[]): Tecla {
  return { mods, key };
}

/**
 * Comandos de CodeMirror que el registro puede nombrar en `accion.comando`. Es una lista blanca a
 * propósito: si una entrada inventara un comando que no existe, T4 lo metería en el keymap y
 * CodeMirror lo ignoraría en silencio (un atajo mudo). La lista sale de los `.d.ts` de
 * `@codemirror/commands`, `@codemirror/search` y `@codemirror/autocomplete`.
 */
const COMANDOS_CODEMIRROR: readonly string[] = [
  // @codemirror/autocomplete
  "startCompletion",
  // @codemirror/commands
  "toggleComment",
  "toggleBlockComment",
  "copyLineDown",
  "deleteLine",
  "insertBlankLine",
  "selectParentSyntax",
  "moveLineUp",
  "moveLineDown",
  // @codemirror/search
  "selectNextOccurrence",
  "selectSelectionMatches",
  "openSearchPanel",
  // Spike F2: el registro separa Buscar (⌘F) de Reemplazar (⌘R) en dos comandos, porque la barra
  // propia abre su segunda fila solo en el segundo. Antes los dos apuntaban a `openSearchPanel`.
  "openReplacePanel",
  "findNext",
  "findPrevious",
  "gotoLine",
];

/** Todas las teclas de una entrada: la principal y sus alias. */
function todasLasTeclas(e: Entrada): Tecla[] {
  return [e.tecla, ...(e.alias ?? [])];
}

const CONTEXTOS: readonly Contexto[] = ["global", "editor", "rejilla", "arbol"];

// ============================================================================================
// INVARIANTES
// ============================================================================================
describe("registro de atajos — invariantes", () => {
  test("1. dentro de un mismo contexto no hay ninguna tecla repetida (ni alias)", () => {
    // Es el invariante que D5 pone como ejemplo: dos acciones con la misma tecla en el mismo
    // contexto es exactamente el bug que hoy existe (`⌘K` duplicado entre el menú y la paleta).
    for (const contexto of CONTEXTOS) {
      const vistas = new Map<string, string>(); // huella → descripción de quién la usa
      for (const e of atajosDe(contexto)) {
        for (const tecla of todasLasTeclas(e)) {
          const huella = huellaTecla(tecla);
          const anterior = vistas.get(huella);
          assert.equal(
            anterior,
            undefined,
            `[${contexto}] la tecla ${aTextoMac(tecla)} está en "${anterior}" y en "${e.id}"`
          );
          vistas.set(huella, e.id);
        }
      }
    }
  });

  test("2. entre `global` y otro contexto, compartir tecla exige `porFoco` en AMBOS lados", () => {
    // `⌘⏎` ejecuta en el editor y envía los cambios en la rejilla: son dos entradas con la misma
    // tecla y contextos distintos, y solo se aceptan si están marcadas `porFoco` (que es lo que T5
    // resuelve mirando el foco). Cualquier otro solapamiento global↔específico sí sería un bug.
    const globales = atajosDe("global").flatMap((e) =>
      todasLasTeclas(e).map((tecla) => ({ e, tecla }))
    );
    for (const contexto of CONTEXTOS) {
      if (contexto === "global") continue;
      for (const especifica of atajosDe(contexto)) {
        for (const tecla of todasLasTeclas(especifica)) {
          const choque = globales.find(({ tecla: otra }) => mismaTecla(otra, tecla));
          if (!choque) continue;
          assert.ok(
            especifica.porFoco && choque.e.porFoco,
            `la tecla ${aTextoMac(tecla)} la usan "${choque.e.id}" (global) y "${especifica.id}" ` +
              `(${contexto}) y no están marcadas las dos como porFoco`
          );
        }
      }
    }
  });

  test("3. cada alias cumple D1: no coincide con la tecla principal de NINGUNA entrada", () => {
    // D1: el atajo viejo solo se conserva si no choca con otro atajo de DataGrip que la app use.
    // La forma de comprobarlo mecánicamente es esta: ninguna tecla principal puede aparecer también
    // como alias en otra fila.
    const principales = new Map<string, string>();
    for (const e of REGISTRO) principales.set(huellaTecla(e.tecla), e.id);
    for (const e of REGISTRO) {
      for (const alias of e.alias ?? []) {
        const dueno = principales.get(huellaTecla(alias));
        assert.equal(
          dueno,
          undefined,
          `el alias ${aTextoMac(alias)} de "${e.id}" choca con la tecla principal de "${dueno}"`
        );
      }
    }
  });

  test("4. toda acción apunta a algo que existe (menú, comando de CodeMirror o acción de app)", () => {
    const menuConocidas = new Set<string>([...MENU_ACTIONS, ...ACCIONES_MENU_NUEVAS]);
    const appConocidas = new Set<string>(ACCIONES_APP);
    const comandos = new Set<string>(COMANDOS_CODEMIRROR);

    for (const e of REGISTRO) {
      if (e.accion.tipo === "menu") {
        assert.ok(
          menuConocidas.has(e.accion.id),
          `"${e.id}" dispara la acción de menú "${e.accion.id}", que no está en MENU_ACTIONS ni ` +
            `en ACCIONES_MENU_NUEVAS`
        );
      } else if (e.accion.tipo === "app") {
        assert.ok(
          appConocidas.has(e.accion.id),
          `"${e.id}" dispara la acción de app "${e.accion.id}", que no está en ACCIONES_APP`
        );
      } else {
        assert.ok(
          comandos.has(e.accion.comando),
          `"${e.id}" usa el comando de CodeMirror "${e.accion.comando}", que no existe`
        );
        assert.equal(e.contexto, "editor", `"${e.id}": un comando de CodeMirror solo vive en el editor`);
      }
    }
  });

  test("5. toda entrada con procedencia M/D lleva fila de la investigación", () => {
    // La marca de la investigación (research/datagrip-ux.md §4) es lo que permite auditar de dónde
    // sale cada atajo; en las «M»/«D» sin fila no habría forma de volver a la fuente. Las "app"
    // (atajos propios de DataDB, «—» en el PLAN) no tienen fila que dar.
    for (const e of REGISTRO) {
      if (e.procedencia === "M" || e.procedencia === "D") {
        assert.ok(
          typeof e.fila === "number" && e.fila > 0,
          `"${e.id}" es [${e.procedencia}] y no lleva fila`
        );
      } else {
        assert.equal(e.fila, undefined, `"${e.id}" es de la app y no debería llevar fila`);
      }
    }
  });

  test("6. los ids y los nombres son únicos y no están vacíos", () => {
    // Sobre `porFoco` NO se impone aquí un invariante de forma, a propósito: la marca dice «T5 tiene
    // que enrutar esto por foco», y hay entradas legítimas cuyas dos mitades no están las dos en el
    // registro (la del editor, `⌘⏎` Execute #1, sí está en la tabla Global y por eso va `porFoco`;
    // las de la rejilla `⌘⌥↑`/`⌘⌥↓` #103 chocan con «cursor extra» del editor, que DataGrip tiene y
    // la app no implementa, así que no hay contraparte que exigir). El invariante duro es el 2.
    const ids = new Set<string>();
    const nombres = new Set<string>();
    for (const e of REGISTRO) {
      assert.ok(e.id.length > 0 && e.nombre.length > 0, "id y nombre siempre con contenido");
      assert.ok(!ids.has(e.id), `id repetido: ${e.id}`);
      ids.add(e.id);
      assert.ok(!nombres.has(e.nombre), `nombre repetido: ${e.nombre}`);
      nombres.add(e.nombre);
    }
  });

  test("7. conteo de entradas por contexto (fija el tamaño del registro)", () => {
    // De dónde sale cada número — las cuatro tablas de «Alcance: la tabla del registro» del PLAN
    // de la fase 15, partiendo en DOS (una entrada por atajo) las filas que traen dos atajos en una
    // sola celda:
    //   · Global  = 14 filas (líneas 83-96 del PLAN). `#68 Select Next / Previous Tab` trae `⌘⇧]`
    //               y `⌘⇧[` → 2 entradas. 14 + 1 = 15.
    //   · Editor  = 14 filas (líneas 102-115). `#41 Move Line Up/Down` (`⌥⇧↑`/`⌥⇧↓`, 2) y
    //               `#57 Find Next/Previous` (`⌘G`/`⌘⇧G`, 2) salen ya escritas como una fila con
    //               dos teclas; las demás (12) son de una sola. 12 + 2 + 2 = 16.
    //   · Rejilla = 6 filas (líneas 121-126). `#101 Add Row/Delete Row` (las dos teclas del PLAN
    //               eran `⌘N`/`⌥⌦`; T8 corrigió la de Delete Row a `⌘⌫`, 2) y
    //               `#103 Previous/Next Page` (`⌘⌥↑`/`⌘⌥↓`, 2). 4 + 2 + 2 = 8, MÁS una: la entrada
    //               `refreshGrid` que T5 añadió al ejecutar la decisión «sobre lo que
    //               reportó T2» (§1 del PLAN: la fila #18 del árbol se registra también en la
    //               rejilla, `porFoco`). 8 + 1 = 9. (T8 cambió la tecla de `refreshGrid` y `refresh`
    //               a `⌘R` —con `⌘F5` de alias— y la de `deleteRow` a `⌘⌫`, pero no el número.)
    //   · Árbol   = 1 fila (línea 132): `#18 Refresh` (`⌘R` desde T8).
    //   · Total   = 15 + 16 + 9 + 1 = 41 entradas = 35 filas de las tablas + 5 troceos + 1 de T5.
    //
    // Este test existe para que cualquier cambio en la tabla se note aquí y haya que venir a decir
    // por qué cambió el número.
    const conteo: Record<Contexto, number> = {
      global: atajosDe("global").length,
      editor: atajosDe("editor").length,
      rejilla: atajosDe("rejilla").length,
      arbol: atajosDe("arbol").length,
    };
    assert.deepEqual(conteo, { global: 15, editor: 16, rejilla: 9, arbol: 1 });
    assert.equal(REGISTRO.length, 15 + 16 + 9 + 1, "el total es la suma de los cuatro contextos");
  });
});

// ============================================================================================
// CONVERSORES
// ============================================================================================
describe("aAceleradorElectron", () => {
  test("produce los nombres de key code de Electron (Return, no Enter; Up, no ArrowUp)", () => {
    // Nombres válidos según la doc de Electron (`Available key codes`): `Return` (alias `Enter`),
    // `Escape`, `Backspace`, `Delete`, `Up`/`Down`/`Left`/`Right`, `Space`, `Plus`, `F1`-`F24` y la
    // puntuación literal. Por eso `Enter` sale como `Return` y `ArrowUp` como `Up`.
    assert.equal(aAceleradorElectron(t("L", "Meta", "Alt")), "Cmd+Alt+L");
    assert.equal(aAceleradorElectron(t("Enter", "Meta", "Shift")), "Shift+Cmd+Return");
    assert.equal(aAceleradorElectron(t("F2", "Meta")), "Cmd+F2");
    assert.equal(aAceleradorElectron(t("]", "Meta", "Shift")), "Shift+Cmd+]");
    assert.equal(aAceleradorElectron(t(",", "Meta")), "Cmd+,");
    assert.equal(aAceleradorElectron(t("/", "Meta")), "Cmd+/");
    assert.equal(aAceleradorElectron(t("[", "Meta", "Shift")), "Shift+Cmd+[");
    assert.equal(aAceleradorElectron(t("Escape", "Shift")), "Shift+Escape");
    assert.equal(aAceleradorElectron(t("Backspace", "Meta")), "Cmd+Backspace");
    assert.equal(aAceleradorElectron(t("Delete", "Alt")), "Alt+Delete");
    assert.equal(aAceleradorElectron(t("ArrowUp", "Alt")), "Alt+Up");
    assert.equal(aAceleradorElectron(t("ArrowDown", "Meta", "Alt")), "Cmd+Alt+Down");
    assert.equal(aAceleradorElectron(t("ArrowLeft", "Meta", "Shift")), "Shift+Cmd+Left");
    assert.equal(aAceleradorElectron(t("Space", "Ctrl")), "Ctrl+Space");
    assert.equal(aAceleradorElectron(t("Q", "Meta", "Shift")), "Shift+Cmd+Q");
  });

  test("el orden de los modificadores es indiferente y no se repiten", () => {
    assert.equal(
      aAceleradorElectron({ mods: ["Alt", "Meta"], key: "L" }),
      aAceleradorElectron({ mods: ["Meta", "Alt"], key: "L" })
    );
    assert.equal(aAceleradorElectron({ mods: ["Meta", "Meta"], key: "L" }), "Cmd+L");
  });

  test("F1-F24 son válidos", () => {
    for (let n = 1; n <= 24; n++) {
      assert.equal(aAceleradorElectron(t(`F${n}`)), `F${n}`);
      assert.equal(aAceleradorElectron(t(`F${n}`, "Meta")), `Cmd+F${n}`);
    }
  });

  test("combinaciones de tres modificadores", () => {
    assert.equal(aAceleradorElectron(t("L", "Meta", "Alt", "Shift")), "Shift+Cmd+Alt+L");
    assert.equal(aAceleradorElectron(t("U", "Meta", "Alt", "Shift")), "Shift+Cmd+Alt+U");
    assert.equal(aAceleradorElectron(t("G", "Meta", "Ctrl")), "Cmd+Ctrl+G");
    assert.equal(aAceleradorElectron(t("Backspace", "Meta", "Alt", "Ctrl")), "Cmd+Ctrl+Alt+Backspace");
  });
});

describe("aTeclaCodeMirror", () => {
  test("Mod es Cmd y las letras van en minúscula", () => {
    assert.equal(aTeclaCodeMirror(t("L", "Meta", "Alt")), "Mod-Alt-l");
    assert.equal(aTeclaCodeMirror(t("Enter", "Shift")), "Shift-Enter");
    assert.equal(aTeclaCodeMirror(t("ArrowUp", "Alt")), "Alt-ArrowUp");
    assert.equal(aTeclaCodeMirror(t("G", "Ctrl")), "Ctrl-g");
    assert.equal(aTeclaCodeMirror(t("G", "Meta", "Ctrl")), "Mod-Ctrl-g");
    assert.equal(aTeclaCodeMirror(t("F", "Meta", "Shift")), "Mod-Shift-f");
  });

  test("los nombres de tecla son los de CodeMirror (Enter, Escape, Backspace, Delete, Space…)", () => {
    assert.equal(aTeclaCodeMirror(t("Enter", "Meta")), "Mod-Enter");
    assert.equal(aTeclaCodeMirror(t("Escape", "Shift")), "Shift-Escape");
    assert.equal(aTeclaCodeMirror(t("Backspace", "Meta")), "Mod-Backspace");
    assert.equal(aTeclaCodeMirror(t("Delete", "Alt")), "Alt-Delete");
    assert.equal(aTeclaCodeMirror(t("Space", "Ctrl")), "Ctrl-Space");
    assert.equal(aTeclaCodeMirror(t("/", "Meta")), "Mod-/");
    assert.equal(aTeclaCodeMirror(t("]", "Meta", "Shift")), "Mod-Shift-]");
    assert.equal(aTeclaCodeMirror(t(",", "Meta")), "Mod-,");
  });

  test("flechas y F1-F12", () => {
    for (const flecha of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
      assert.equal(aTeclaCodeMirror(t(flecha, "Alt")), `Alt-${flecha}`);
    }
    for (let n = 1; n <= 12; n++) {
      assert.equal(aTeclaCodeMirror(t(`F${n}`, "Meta")), `Mod-F${n}`);
    }
  });

  test("combinaciones de tres modificadores", () => {
    assert.equal(aTeclaCodeMirror(t("L", "Meta", "Alt", "Shift")), "Mod-Alt-Shift-l");
    assert.equal(aTeclaCodeMirror(t("ArrowUp", "Alt", "Shift")), "Alt-Shift-ArrowUp");
  });
});

describe("aTextoMac", () => {
  test("símbolos y teclas nombradas", () => {
    assert.equal(aTextoMac(t("L", "Meta", "Alt")), "⌘⌥L");
    assert.equal(aTextoMac(t("Enter", "Shift")), "⇧⏎");
    assert.equal(aTextoMac(t("F2", "Meta")), "⌘F2");
    assert.equal(aTextoMac(t("Space", "Ctrl")), "⌃Space");
    assert.equal(aTextoMac(t("Escape", "Shift")), "⇧⎋");
    assert.equal(aTextoMac(t("Backspace", "Meta")), "⌘⌫");
    assert.equal(aTextoMac(t("Delete", "Alt")), "⌥⌦");
    assert.equal(aTextoMac(t("/", "Meta")), "⌘/");
    assert.equal(aTextoMac(t("[", "Meta", "Shift")), "⌘⇧[");
    assert.equal(aTextoMac(t("]", "Meta", "Shift")), "⌘⇧]");
    assert.equal(aTextoMac(t(",", "Meta")), "⌘,");
  });

  test("flechas y F1-F12", () => {
    assert.equal(aTextoMac(t("ArrowUp", "Alt")), "⌥↑");
    assert.equal(aTextoMac(t("ArrowDown", "Meta", "Alt")), "⌘⌥↓");
    assert.equal(aTextoMac(t("ArrowLeft", "Meta", "Shift")), "⌘⇧←");
    assert.equal(aTextoMac(t("ArrowRight")), "→");
    for (let n = 1; n <= 12; n++) assert.equal(aTextoMac(t(`F${n}`, "Meta")), `⌘F${n}`);
  });

  test("combinaciones de tres modificadores (orden de DataGrip ⌘⌃⌥⇧)", () => {
    // El orden es el de DataGrip (⌘ ⌃ ⌥ ⇧), que es el que usan el PLAN y research §4 (`⌘⌥⇧U`,
    // `⌘⌃G`, `⌥⇧↑`). Ver la cabecera de keymap.ts: la HIG de Apple recomienda ⌃⌥⇧⌘, pero con ese
    // orden `⌘⌥L` saldría `⌥⌘L` y la comparación de la referencia (T8) contra las tablas fallaría.
    assert.equal(aTextoMac(t("L", "Meta", "Alt", "Shift")), "⌘⌥⇧L");
    assert.equal(aTextoMac(t("U", "Meta", "Alt", "Shift")), "⌘⌥⇧U");
    assert.equal(aTextoMac(t("G", "Meta", "Ctrl")), "⌘⌃G");
    assert.equal(aTextoMac(t("ArrowUp", "Alt", "Shift")), "⌥⇧↑");
  });

  test("textosDe devuelve la principal y los alias, en texto", () => {
    const e = entradaPorId("showDiagram");
    assert.ok(e);
    assert.deepEqual(textosDe(e), ["⌘⌥⇧U", "⌘⇧U"]);
  });
});

// ============================================================================================
// CONSULTAS
// ============================================================================================
describe("consultas del registro", () => {
  test("atajosDe devuelve solo el contexto pedido", () => {
    assert.ok(atajosDe("arbol").every((e) => e.contexto === "arbol"));
    assert.equal(atajosDe("arbol").length, 1);
  });

  test("entradaPorId encuentra y no inventa", () => {
    assert.equal(entradaPorId("execute")?.nombre, "Execute");
    assert.equal(entradaPorId("no-existe"), undefined);
  });

  test("resolver prioriza el contexto por foco", () => {
    // El caso que da sentido a `porFoco`: la MISMA tecla en dos contextos.
    assert.equal(resolver(t("Enter", "Meta"), "editor")?.id, "execute");
    assert.equal(resolver(t("Enter", "Meta"), "rejilla")?.id, "submitChanges");
    assert.equal(resolver(t("Enter", "Shift"), "editor")?.id, "startNewLine");
    assert.equal(resolver(t("Enter", "Shift"), "rejilla")?.id, "openInValueEditor");
    assert.equal(resolver(t("ArrowUp", "Meta", "Alt"), "rejilla")?.id, "previousPage");
  });

  test("resolver cae a global y también resuelve los alias", () => {
    assert.equal(resolver(t("L", "Meta", "Alt"), "editor")?.id, "reformatCode");
    assert.equal(resolver(t("K", "Meta"), "editor")?.id, "findAction", "⌘K es alias de la paleta");
    assert.equal(resolver(t("F", "Meta", "Shift"), "editor")?.id, "reformatCode", "⇧⌘F alias");
    assert.equal(resolver(t("U", "Meta", "Shift"), "rejilla")?.id, "showDiagram");
    assert.equal(resolver(t("Z", "Meta"), "editor"), undefined, "una tecla que no está, no está");
  });

  test("T8: ⌘R y ⌘⌫ por contexto; ⌘F5 alias de refresh/refreshGrid; ⌥⌦ eliminado", () => {
    // §5.1 de `T8-oraculo.md`: el keymap activo (`Mac OS X 10.5+.xml`) declara `Refresh` como
    // `meta R` (PISA el `control F5` heredado → `⌘F5` no está asignado a nada) y `⌘⌫` es la tecla
    // de `EditorDeleteLine`, que `Console.TableResult.DeleteRows` toma prestada. La MISMA tecla
    // vale otra cosa en el editor, así que el contexto decide (como con `⌘D`).
    assert.equal(resolver(t("R", "Meta"), "editor")?.id, "replace", "⌘R en el editor abre Reemplazar (#54)");
    assert.equal(resolver(t("R", "Meta"), "arbol")?.id, "refresh", "⌘R en el árbol refresca el esquema (#18)");
    assert.equal(resolver(t("R", "Meta"), "rejilla")?.id, "refreshGrid", "⌘R en la rejilla re-ejecuta (#18)");
    assert.equal(resolver(t("Backspace", "Meta"), "editor")?.id, "deleteLine", "⌘⌫ en el editor borra la línea (#35)");
    assert.equal(resolver(t("Backspace", "Meta"), "rejilla")?.id, "deleteRow", "⌘⌫ en la rejilla borra la fila marcada (#101)");
    // Los alias de D1: ⌘F5 sigue resolviendo en árbol y rejilla; ⌫/⌦ siguen borrando filas.
    assert.equal(resolver(t("F5", "Meta"), "arbol")?.id, "refresh");
    assert.equal(resolver(t("F5", "Meta"), "rejilla")?.id, "refreshGrid");
    assert.equal(resolver(t("Backspace"), "rejilla")?.id, "deleteRow");
    assert.equal(resolver(t("Delete"), "rejilla")?.id, "deleteRow");
    // ⌥⌦ se ELIMINÓ de la entrada (en DataGrip es borrar hasta el final de la palabra): ya no
    // resuelve en ningún contexto.
    assert.equal(resolver(t("Delete", "Alt"), "rejilla"), undefined);
    assert.equal(resolver(t("Delete", "Alt"), "editor"), undefined);
    // Y ninguna de las dos teclas sale de su contexto: en `global` no hay nada registrado.
    assert.equal(resolver(t("R", "Meta"), "global"), undefined);
    assert.equal(resolver(t("Backspace", "Meta"), "global"), undefined);
  });

  test("invariante de coherencia: resolver nunca devuelve una entrada de otro contexto sin porFoco", () => {
    for (const contexto of CONTEXTOS) {
      for (const e of atajosDe(contexto)) {
        for (const tecla of todasLasTeclas(e)) {
          const resuelta = resolver(tecla, contexto);
          assert.ok(resuelta, `${e.id} debería resolverse en su contexto`);
          assert.equal(
            resuelta.id,
            e.id,
            `resolver(${aTextoMac(tecla)}, ${contexto}) devolvió ${resuelta.id} y no ${e.id}`
          );
        }
      }
    }
  });
});
