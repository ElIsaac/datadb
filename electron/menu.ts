/**
 * Fase 6 (R5): el menú nativo de macOS.
 *
 * Qué reemplaza: hasta ahora la app llevaba el menú POR DEFECTO de Electron (medido en la línea
 * base del PLAN de la fase 6). Ese menú tenía dos problemas serios:
 *
 *  1. `File` solo contenía «Close Window»: ni una sola acción de la app.
 *  2. `View` exponía `Reload` (⌘R), `Force Reload` y `Toggle Developer Tools` al usuario final.
 *     ⌘R recarga el renderer y se lleva por delante las consolas abiertas y sus resultados sin
 *     preguntar. Aquí esas tres entradas existen SOLO en desarrollo (D4).
 *
 * LO QUE NO SE PUEDE PERDER AL SUSTITUIRLO (y no da ningún error si se pierde): en macOS, ⌘C, ⌘V,
 * ⌘X, ⌘Z y ⌘A los sirve el MENÚ, no el navegador. Por eso el menú `Edit` se construye con **roles**
 * de Electron (`copy`, `paste`, `undo`, …) y no con `click` propios: los roles son los que hacen
 * que esas teclas sigan funcionando en CodeMirror y en cualquier campo de texto.
 *
 * Cómo dispara las acciones: `main` no sabe ejecutar ninguna. Manda el id por el evento
 * `menu:action` y el renderer lo traduce al MISMO camino que ya usan la paleta de comandos y los
 * botones de la barra (`src/hooks/use-menu-actions.ts`). Nada de una segunda implementación.
 *
 * Fase 15 (T3, R13): el TEMPLATE ya no se escribe aquí. Vive en `electron/menu-template.ts`, que lo
 * construye desde el REGISTRO ÚNICO de atajos (`src/shared/keymap.ts`): los aceleradores salen del
 * registro (`aAceleradorElectron`) en vez de estar escritos a mano aquí. Este archivo sólo conserva
 * lo que de verdad necesita Electron — `app`, `Menu`, la ventana a la que enviar y el estado que
 * decide qué entradas van en gris — y aplica el template. Ver la cabecera de `menu-template.ts`
 * para las reglas (sólo los globales con ⌘ se declaran como acelerador; ⇧⏎ del Value Editor se
 * muestra pero no captura; los alias globales los servirá el enrutador).
 *
 * El menú va en inglés (D1, decisión del usuario): como DataGrip y como el resto de apps de
 * desarrollo. Consecuencia asumida: las tool windows aparecen aquí con su nombre en inglés aunque
 * sus stripes laterales estén en español.
 */
import { app, Menu, type BrowserWindow } from "electron";

import { DEFAULT_MENU_STATE, type MenuAction, type MenuState } from "@/shared/menu-actions";
import { construirTemplate } from "./menu-template";

/** Último estado publicado por el renderer; decide qué entradas van en gris (D8). */
let estado: MenuState = DEFAULT_MENU_STATE;
let ventana: BrowserWindow | null = null;

/** Envía la acción al renderer. Si no hay ventana, no pasa nada: el menú no puede hacer más. */
function emitir(action: MenuAction): void {
  ventana?.webContents.send("menu:action", { action });
}

/** (Re)construye y aplica el menú. Idempotente: se puede llamar en cada cambio de estado. */
export function aplicarMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      construirTemplate({
        estado,
        dev: !app.isPackaged,
        appName: app.getName(),
        emitir,
      })
    )
  );
}

/** Lo llama `main` al arrancar, una vez. */
export function instalarMenu(win: BrowserWindow): void {
  ventana = win;
  aplicarMenu();
}

/**
 * Lo llama el canal `menu:state`. Reconstruye solo si algo cambió de verdad: el renderer publica
 * su estado en cada render relevante y rehacer el menú en cada tecla sería un desperdicio visible
 * (la barra parpadea).
 */
export function actualizarEstadoMenu(nuevo: MenuState): void {
  const igual =
    nuevo.connected === estado.connected &&
    nuevo.queryRunning === estado.queryRunning &&
    nuevo.txManual === estado.txManual &&
    nuevo.txActive === estado.txActive &&
    nuevo.hasSql === estado.hasSql;
  if (igual) return;
  estado = nuevo;
  aplicarMenu();
}
