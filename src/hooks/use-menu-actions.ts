/**
 * Fase 6 (R5): el ÚNICO punto del renderer donde se atienden las acciones del menú nativo.
 *
 * El menú vive en el proceso `main`, que no sabe hacer nada de esto: manda el id de la acción por
 * el evento `menu:action` y aquí se traduce al MISMO camino que ya usan la paleta de comandos y
 * los botones de la barra. La regla de la fase: cero lógica nueva: si una acción no era alcanzable
 * desde fuera de su componente, lo que se añadió fue un listener de `window` en ese componente
 * (`sql-editor.tsx`, `app-shell.tsx`, `console-connection-bar.tsx`), no una segunda
 * implementación aquí.
 *
 * El `Record<MenuAction, …>` es deliberado: añadir una entrada al menú sin manejarla aquí NO
 * compila. Es lo que evita las entradas mudas, que es el riesgo real de un menú «completo».
 *
 * También publica a `main` el estado que decide qué entradas van en gris (`menu:state`).
 *
 * Fase 15 (T6): este archivo crece con las cinco acciones nuevas del menú (`view.erDiagram`,
 * `view.hideToolWindow`, `view.nextTab`, `view.prevTab`, `help.shortcuts`) y con `ejecutarAccionDeMenu`,
 * la función que el enrutador de atajos de la tarea siguiente usará para disparar una acción por este
 * mismo camino (nada de una segunda implementación).
 */
import * as React from "react";

import { invoke } from "@/lib/ipc-client";
import { hideActiveToolWindow, showToolWindow, toggleToolWindow } from "@/shell/layout-store";
import { isMenuAction, type MenuAction, type MenuState } from "@/shared/menu-actions";

/** Dispara el evento global que ya escucha el componente dueño de la acción. */
function emitirEnVentana(nombre: string): void {
  window.dispatchEvent(new CustomEvent(nombre));
}

/**
 * Fase 15 (T6, #6) — «Show Diagram» (⌘⌥⇧U / alias ⌘⇧U). Reutiliza el camino que YA existe en el
 * editor sin tocarlo: `sql-editor.tsx` escucha el evento `cm-open-er-diagram` sobre el contenedor de
 * CodeMirror (`cmRef.current.editor`, la caja `.cm-theme`) y abre el diagrama de la tabla bajo el
 * cursor. Aquí se dispara el MISMO CustomEvent (burbujeante) sobre cada `.cm-editor` montado: al subir
 * por el DOM llega a ese contenedor y su listener lo atiende igual que si viniera del keymap `Mod-Shift-u`.
 * Sólo el editor SQL tiene listener para ese nombre, así que los demás editores (value editor, log,
 * preview) lo ignoran sin efecto. Si no hay ningún `.cm-editor` — la pestaña activa no es la consola
 * SQL — no hay cursor del que sacar la tabla y no se hace nada (se anota, no se finge).
 */
function abrirDiagramaErDesdeMenu(): void {
  const editores = document.querySelectorAll<HTMLElement>(".cm-editor");
  if (editores.length === 0) {
    console.warn(
      "[menu] Show Diagram necesita el cursor sobre una tabla en la consola SQL, y ahora mismo no hay editor montado"
    );
    return;
  }
  for (const el of editores) el.dispatchEvent(new CustomEvent("cm-open-er-diagram", { bubbles: true }));
}

/**
 * Qué hace cada entrada del menú. Los `gestordb:*` son los mismos eventos que usa la paleta de
 * comandos; `toggleToolWindow`/`showToolWindow` son las funciones de módulo del store de layout.
 */
const ACCIONES: Record<MenuAction, () => void> = {
  // --- File ---
  "file.newConsole": () => emitirEnVentana("gestordb:new-console"),
  "file.newConnection": () => emitirEnVentana("gestordb:new-connection"),
  "file.saveQuery": () => emitirEnVentana("gestordb:save-query"),
  "file.disconnect": () => emitirEnVentana("gestordb:disconnect"),

  // --- Edit ---
  "edit.formatSql": () => emitirEnVentana("gestordb:format-sql"),

  // --- View ---
  // Las tool windows se alternan (abrir/cerrar), igual que al pulsar su stripe.
  "view.toolWindow.explorer": () => toggleToolWindow("explorer"),
  "view.toolWindow.saved": () => toggleToolWindow("saved"),
  "view.toolWindow.ai": () => toggleToolWindow("ai"),
  "view.toolWindow.results": () => toggleToolWindow("results"),
  "view.toolWindow.history": () => toggleToolWindow("history"),
  "view.toolWindow.value": () => toggleToolWindow("value"),
  "view.commandPalette": () => emitirEnVentana("gestordb:command-palette"),
  "view.appearance": () => emitirEnVentana("gestordb:appearance"),

  // Fase 15 (T6): las cuatro acciones nuevas del registro más Help.
  //  · view.erDiagram      — dispara `cm-open-er-diagram` al editor (ver `abrirDiagramaErDesdeMenu`).
  //  · view.hideToolWindow — oculta la tool window activa/con foco (⇧⎋; la sirve el enrutador).
  //  · view.nextTab/prevTab — pestaña siguiente/anterior. Necesitan el ESTADO de la app (consolas +
  //    pestañas de tabla), que no vive aquí: se emite un evento y lo resuelve el armazón (`app-shell`),
  //    que sí tiene el reducer y el orden de pestañas. Mismo patrón que `gestordb:new-console`.
  //  · help.shortcuts      — abre Help ▸ «Atajos de teclado» (el diálogo vive en el armazón).
  "view.erDiagram": () => abrirDiagramaErDesdeMenu(),
  "view.hideToolWindow": () => {
    hideActiveToolWindow();
  },
  "view.nextTab": () => emitirEnVentana("gestordb:next-tab"),
  "view.prevTab": () => emitirEnVentana("gestordb:prev-tab"),

  // --- Help ---
  "help.shortcuts": () => emitirEnVentana("gestordb:shortcuts"),

  // --- Query ---
  "query.execute": () => emitirEnVentana("gestordb:execute"),
  "query.executeAll": () => emitirEnVentana("gestordb:execute-all"),
  "query.cancel": () => emitirEnVentana("gestordb:cancel-query"),
  "query.explain": () => emitirEnVentana("gestordb:explain-plan"),
  "query.txAuto": () => emitirEnVentana("gestordb:tx-auto"),
  "query.txManual": () => emitirEnVentana("gestordb:tx-manual"),
  "query.commit": () => emitirEnVentana("gestordb:commit"),
  "query.rollback": () => emitirEnVentana("gestordb:rollback"),

  // --- AI ---
  // Estos cuatro ya eran alcanzables desde fuera antes de la fase 6: son los que usa la paleta.
  "ai.textToSql": () => emitirEnVentana("gestordb:ai-sql"),
  "ai.explainQuery": () => emitirEnVentana("gestordb:ai-explain"),
  "ai.chat": () => showToolWindow("ai"),
  "ai.settings": () => emitirEnVentana("gestordb:ai-settings"),
};

/**
 * Fase 15 (T6) — ejecuta UNA acción de menú por el MISMO camino que el evento `menu:action`.
 *
 * Para qué: el enrutador del renderer que llega en la tarea siguiente tiene que ejecutar acciones
 * que NO se disparan desde el menú nativo (los alias globales `⇧⌘F`/`⌘⇧U`/`⌘K`, el `⇧⎋`, los atajos
 * por foco). La tentación es que el enrutador llame a la función de turno directamente; eso sería la
 * SEGUNDA implementación de cada acción, que es justo lo que la fase 6 evitó. Esto exporta el camino
 * único.
 *
 * CÓMO LLAMARLA DESDE UN MÓDULO NO-REACT
 * --------------------------------------
 * No necesita React ni un hook: `ACCIONES` es un `Record` de funciones de módulo, sin estado de la
 * app capturado. Basta con
 *
 *     import { ejecutarAccionDeMenu } from "@/hooks/use-menu-actions";
 *     ejecutarAccionDeMenu("view.nextTab");
 *
 * desde cualquier módulo del renderer. (El archivo se llama `use-menu-actions` porque además exporta
 * dos hooks — `useMenuActions` y `useMenuState` —, pero `ejecutarAccionDeMenu` es una función normal.)
 * Las acciones que sí necesitan estado de la app (`view.nextTab`/`view.prevTab`) lo obtienen emitiendo
 * un evento de `window` que resuelve el armazón: desde fuera se llaman igual, sin pasar nada.
 *
 * No valida el id: recibe `MenuAction`, así que un id inventado no compila. En la frontera (el
 * payload que llega de `main`) la validación la hace `isMenuAction` antes de llamar aquí.
 */
export function ejecutarAccionDeMenu(accion: MenuAction): void {
  ACCIONES[accion]();
}

/** Escucha `menu:action` y ejecuta. Se monta UNA vez, en el armazón de la app. */
export function useMenuActions(): void {
  React.useEffect(() => {
    // Fuera de Electron (o si el puente no está) no hay menú: no es un error, simplemente no hay
    // nada que escuchar.
    const puente = window.gestordb;
    if (!puente?.on) return;

    return puente.on("menu:action", (payload) => {
      const accion = (payload as { action?: unknown } | undefined)?.action;
      if (!isMenuAction(accion)) {
        // No debería pasar nunca (main manda ids de la lista cerrada), pero si pasa se dice:
        // una acción de menú que no hace nada y tampoco se queja es el peor resultado posible.
        console.error("[menu] acción desconocida recibida de main:", accion);
        return;
      }
      ejecutarAccionDeMenu(accion);
    });
  }, []);
}

/**
 * Publica a `main` el estado que decide qué entradas están activas. `main` ignora las
 * publicaciones que no cambian nada, así que llamarlo en cada render es barato.
 *
 * Si falla, no se avisa al usuario: lo peor que pasa es que una entrada del menú se quede
 * habilitada de más y, al pulsarla, la acción falle con el error visible de siempre.
 */
export function useMenuState(estado: MenuState): void {
  React.useEffect(() => {
    void invoke("menu:state", estado).catch((err) => {
      console.error("[menu] no se pudo publicar el estado del menú", err);
    });
    // `estado` llega memoizado desde AppShell (los cinco booleanos como deps del useMemo), así que
    // esto no se dispara en cada render: solo cuando alguno cambia de verdad.
  }, [estado]);
}
