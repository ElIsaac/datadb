/**
 * Fase 15 (R13, D4/T7): Help ▸ «Atajos de teclado» — la referencia DENTRO de la app.
 *
 * Regla de D4: la lista se GENERA del registro (`src/shared/keymap.ts`), el mismo que aplica los
 * atajos. Aquí no hay ni una tecla escrita a mano: el agrupado, el texto de cada atajo y los alias
 * salen de `construirReferencia()` / `filtrarReferencia()` (`src/shared/keymap-referencia.ts`), que
 * tiene sus propios tests. Este componente sólo pinta.
 *
 * Lo que pide el PLAN y se ve aquí:
 *   · Agrupada por contexto (Global · Editor SQL · Rejilla de datos · Árbol de esquema).
 *   · Nombre de la acción como en DataGrip + el atajo en texto de macOS + los alias (D1).
 *   · La procedencia `[M]` / `[D]` / «—» (atajo propio de DataDB) y, para las `[D]`, la nota de D2
 *     «convertida desde el keymap de Windows, sin verificar en un DataGrip real» como leyenda
 *     visible (y en el `title` de cada etiqueta [D]).
 *   · Un buscador por nombre de acción o por tecla (incluidos los alias).
 *
 * Para la MEDICIÓN final (T8), el DOM expone dos ganchos estables:
 *   · `data-testid="referencia-de-atajos"` en el contenido del diálogo.
 *   · `data-atajo-id="<id del registro>"` en cada fila, para comparar lo pintado con el registro.
 *
 * Se monta una sola vez, en `app-shell.tsx`; lo abre la acción de menú `help.shortcuts` (que llega
 * como evento `gestordb:shortcuts`).
 */
import * as React from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  NOTA_D2,
  construirReferencia,
  etiquetaProcedencia,
  filtrarReferencia,
  totalDeFilas,
  type FilaReferencia,
} from "@/shared/keymap-referencia";

export interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * La referencia completa se construye UNA vez, al cargar el módulo: sale del registro, que es
 * estático (no depende de estado ni de props). El filtro sí se recalcula por consulta.
 */
const REFERENCIA = construirReferencia();

/** Una tecla en su píldora, como en la paleta de comandos. */
function Tecla({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border/50 bg-muted/50 px-1.5 py-0.5 font-jetbrains text-[10px] text-foreground">
      {children}
    </kbd>
  );
}

/** Color de la etiqueta de procedencia: verde las verificadas, ámbar las convertidas sin verificar. */
function colorProcedencia(p: FilaReferencia["procedencia"]): string {
  if (p === "M") return "text-gdb-okfg";
  if (p === "D") return "text-gdb-warnfg";
  return "text-muted-foreground";
}

function Fila({ fila }: { fila: FilaReferencia }) {
  return (
    <div
      data-atajo-id={fila.id}
      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 rounded px-2 py-1 hover:bg-muted"
    >
      <span className="truncate text-xs" title={fila.nota ?? fila.nombre}>
        {fila.nombre}
      </span>
      <span className="flex items-center justify-end gap-1.5">
        <Tecla>{fila.atajo}</Tecla>
        {/* Alias de la app que D1 conserva al lado del atajo de DataGrip; se marcan como tales. */}
        {fila.alias.map((a) => (
          <Tecla key={a}>
            <span className="text-muted-foreground">{a}</span>
          </Tecla>
        ))}
      </span>
      <span
        className={cn("w-12 text-right text-[10px] tabular-nums", colorProcedencia(fila.procedencia))}
        title={fila.procedencia === "D" ? NOTA_D2 : fila.procedencia === "M" ? "Verificada en la página oficial de DataGrip" : "Atajo propio de DataDB; DataGrip no lo tiene"}
      >
        {etiquetaProcedencia(fila.procedencia)}
        {typeof fila.fila === "number" && <span className="ml-1 text-muted-foreground">#{fila.fila}</span>}
      </span>
    </div>
  );
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  const [consulta, setConsulta] = React.useState("");

  const grupos = React.useMemo(() => filtrarReferencia(REFERENCIA, consulta), [consulta]);
  const mostrados = totalDeFilas(grupos);

  // Cerrar limpia el buscador: al reabrir, la referencia vuelve completa (y así lo que la medición
  // final lee del DOM no depende de una búsqueda anterior).
  const cambiarApertura = (abierto: boolean) => {
    if (!abierto) setConsulta("");
    onOpenChange(abierto);
  };

  return (
    <Dialog open={open} onOpenChange={cambiarApertura}>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-3 sm:max-w-3xl"
        data-testid="referencia-de-atajos"
      >
        <div>
          <DialogTitle>Atajos de teclado</DialogTitle>
          <DialogDescription>
            Generados del registro de atajos de la app: si un atajo cambia, esta lista cambia con él.
          </DialogDescription>
        </div>

        <input
          type="text"
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          placeholder="Buscar por nombre o tecla (p. ej. «reformat» o «⌘⌥L»)…"
          aria-label="Buscar atajos por nombre o tecla"
          data-testid="buscador-de-atajos"
          spellCheck={false}
          className="h-8 rounded-md border border-input bg-gdb-field px-2.5 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
        />

        {/* Leyenda de la procedencia: la marca [M]/[D] sale de la investigación (research/datagrip-ux.md
            §4) y la nota de D2 es literalmente la que exige el PLAN, visible aquí una vez. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          <span>
            <span className="text-gdb-okfg">[M]</span> verificada en la página oficial de DataGrip
          </span>
          <span>
            <span className="text-gdb-warnfg">[D]</span> {NOTA_D2}
          </span>
          <span>
            <span className="text-muted-foreground">—</span> atajo propio de DataDB
          </span>
          <span className="ml-auto tabular-nums">{mostrados} de {REFERENCIA.flatMap((g) => g.filas).length} atajos</span>
        </div>

        <ScrollArea className="-mx-2 min-h-0 flex-1">
          <div className="px-2">
            {grupos.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground" data-testid="sin-resultados">
                Ningún atajo coincide con «{consulta.trim()}».
              </p>
            )}
            {grupos.map((grupo) => (
              <section key={grupo.contexto} data-contexto={grupo.contexto} className="mb-3">
                <h4 className="px-2 pb-1 pt-2 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {grupo.titulo}
                </h4>
                {grupo.filas.map((fila) => (
                  <Fila key={fila.id} fila={fila} />
                ))}
              </section>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
