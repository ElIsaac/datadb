/**
 * Barra de tool windows (fase 9, T1; R12). Dos variantes (decisión D1 del PLAN de la fase 9):
 *
 *   - `side`: barra vertical a la izquierda, la del concepto aprobado (`design/concept/`, variante B):
 *     botones de 32 px, el activo con barra de acento de 3 px a su izquierda.
 *   - `header`: barra única de iconos dentro del header, como la New UI de DataGrip (`Use Single Tool
 *     Window Bar`). Mismo botón, sin la barra de acento lateral: el activo se marca con el fondo de
 *     pestaña seleccionada.
 *
 * El clic sobre un botón alterna como en DataGrip: oculta → la abre (Fijada) y la activa; visible pero no
 * activa → la activa; ya activa → la oculta. El resultado se guarda en el store del layout (persistente).
 */
import { IjIcon } from "@/components/ij-icon";
import { ToolWindowContextMenu } from "@/components/tool-window";
import { TOOL_WINDOWS } from "@/shell/layout";
import { isToolWindowActive, toggleToolWindow, useLayoutState } from "@/shell/layout-store";
import { cn } from "@/lib/utils";

export function ToolWindowBar({ variant }: { variant: "side" | "header" }) {
  const layout = useLayoutState();

  return (
    <div
      data-tool-window-bar={variant}
      aria-label="Tool windows"
      className={cn(
        "flex shrink-0 select-none",
        variant === "side"
          ? // 40 px: los 32 del botón + 4 de aire a cada lado (concepto, #bar)
            "w-10 flex-col items-center gap-0.5 border-r border-gdb-contrast bg-gdb-chrome py-1.5"
          : "items-center gap-0.5"
      )}
    >
      {TOOL_WINDOWS.map((tw) => {
        const isVisible = layout.visible[tw.id];
        const isActive = isToolWindowActive(layout, tw.id);
        const unpinned = layout.modes[tw.id] === "unpinned";
        // T3: clic derecho → el mismo menú de opciones que el ⋮ (modo de vista, Mover a, Ocultar).
        return (
          <ToolWindowContextMenu key={tw.id} id={tw.id}>
          <button
            type="button"
            data-tool-window-button={tw.id}
            // Marca común a todos los conmutadores (barra y header): el overlay de una No fijada no trata
            // el clic en SU conmutador como «clic fuera» (si no, se cerraría y el toggle la reabriría).
            data-tool-window-toggle={tw.id}
            onClick={() => toggleToolWindow(tw.id)}
            title={`${tw.label}${unpinned ? " · No fijada" : ""}${isVisible ? "" : " (oculta)"}`}
            aria-pressed={isActive}
            className={cn(
              "relative grid place-items-center rounded-md transition-colors",
              variant === "side" ? "size-8" : "size-7 [-webkit-app-region:no-drag]",
              isActive
                ? "bg-gdb-twtabsel text-gdb-fgstrong"
                : "text-gdb-fgdim hover:bg-gdb-hover hover:text-gdb-fg"
            )}
          >
            {isActive && variant === "side" && (
              // Barra de acento de 3 px del concepto (.tw-btn.on::before): a la izquierda del botón,
              // dentro de los 4 px de aire de la barra.
              <span aria-hidden className="absolute top-1.5 bottom-1.5 -left-1 w-[3px] rounded-full bg-gdb-accent" />
            )}
            <IjIcon name={tw.icon} />
          </button>
          </ToolWindowContextMenu>
        );
      })}
    </div>
  );
}