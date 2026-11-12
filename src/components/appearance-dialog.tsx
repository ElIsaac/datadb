/**
 * Diálogo «Apariencia» — R98 (rediseño aprobado: `design/propuesta-apariencia.png`, hecho con Open
 * Design; plan `.planning/phases/r98-apariencia/PLAN.md`). Sustituye al panel de una sola columna de
 * la fase 7 (T10; R33, R51, R52), cuyo contenido se conserva repartido en secciones.
 *
 * Estructura (960×640): cabecera con UN buscador que filtra la sección activa · navegación izquierda
 * · contenido · vista previa en vivo a la derecha · pie con Restablecer todo / Importar… / Exportar…
 *
 * Tramo 1 (este): secciones Tema (galería + modo), Colores (tinte de entorno), Ventana (densidad,
 * barra, layout) y Avanzado (tema base + 86 colores). Tipografía (T2) y Editor/Rejilla (T3) NO
 * aparecen en la navegación hasta que existan: una sección vacía sería un control muerto.
 *
 * Importar/exportar pasan de un textarea a ARCHIVO `.json` (la maqueta); un JSON inválido se rechaza
 * entero y dice por qué, sin aplicar nada (R51).
 *
 * Todo cambio se aplica al instante (es una preferencia visual) y persiste en theme-store.
 */
import * as React from "react";
import { toast } from "sonner";
import { DropletIcon, Grid3X3Icon, PaletteIcon, PanelsTopLeftIcon, SearchIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DENSITIES, type DensityId } from "@/theme/density";
import { TOKEN_KEYS } from "@/theme/tokens";
import { DEFAULT_STATE, exportThemeState, parseThemeState, type Cuadricula } from "@/theme/apply";
import { setThemeState, updateThemeState, useThemeState } from "@/theme/theme-store";
import { setBarMode, useLayoutState, resetLayout } from "@/shell/layout-store";
import type { BarMode } from "@/shell/layout";
import { downloadText } from "@/lib/export-formats";
import { Bloque, Fila, Segmentado } from "@/components/apariencia/controles";
import { SeccionTema } from "@/components/apariencia/seccion-tema";
import { SeccionAvanzado } from "@/components/apariencia/seccion-avanzado";
import { VistaPrevia } from "@/components/apariencia/vista-previa";
import { useActiveConsole } from "@/hooks/use-app-state";
import { connectionOf } from "@/lib/console-binding";
import { PESO_DE_TINTE, TINTE_DE_EJEMPLO, colorDeTinte, fondoTenido } from "@/lib/profile-colors";

export interface AppearanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Seccion = "tema" | "colores" | "rejilla" | "ventana" | "avanzado";

const SECCIONES: Array<{ id: Seccion; label: string; icono: React.ComponentType<{ className?: string }> }> = [
  { id: "tema", label: "Tema", icono: PaletteIcon },
  { id: "colores", label: "Colores", icono: DropletIcon },
  // R98: adelantada de T3 a pedido del usuario (la cuadrícula); el resto de sus ajustes llega en T3.
  { id: "rejilla", label: "Rejilla de datos", icono: Grid3X3Icon },
  { id: "ventana", label: "Ventana", icono: PanelsTopLeftIcon },
  { id: "avanzado", label: "Avanzado", icono: SlidersHorizontalIcon },
];

/** Qué filtra el buscador de la cabecera en cada sección (sin buscador donde no hay qué filtrar). */
const BUSCADOR: Partial<Record<Seccion, string>> = {
  tema: "Buscar tema…",
  avanzado: `Filtrar ${TOKEN_KEYS.length} colores…`,
};

export function AppearanceDialog({ open, onOpenChange }: AppearanceDialogProps) {
  const state = useThemeState();
  const layout = useLayoutState();
  // R18: la conexión de la consola con foco, para que la vista previa tiña con SU color.
  const conexionActiva = connectionOf(useActiveConsole());
  const conexionDeMuestra = conexionActiva
    ? { nombre: conexionActiva.name, color: colorDeTinte(conexionActiva.color) }
    : null;
  const [seccion, setSeccion] = React.useState<Seccion>("tema");
  const [busqueda, setBusqueda] = React.useState("");
  const [errorDeImportacion, setErrorDeImportacion] = React.useState<string | null>(null);
  const archivoRef = React.useRef<HTMLInputElement>(null);

  const irA = (s: Seccion) => {
    setSeccion(s);
    setBusqueda("");
  };

  const importar = async (archivo: File) => {
    try {
      const texto = await archivo.text();
      // R51: un JSON inválido se rechaza ENTERO, con el motivo visible; no se aplica nada.
      setThemeState(parseThemeState(JSON.parse(texto)));
      setErrorDeImportacion(null);
      toast.success(`Apariencia importada de ${archivo.name}`);
    } catch (err) {
      const msg = err instanceof SyntaxError ? `JSON mal formado: ${err.message}` : String((err as Error).message ?? err);
      setErrorDeImportacion(`No se importó nada de ${archivo.name}: ${msg}`);
      console.error("[apariencia] importación rechazada", err);
    }
  };

  const placeholder = BUSCADOR[seccion];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        data-testid="appearance-dialog"
        // El `sm:max-w-sm` de la base gana a un `w-[…]` suelto: hay que pisar el max-w también.
        className="flex h-[640px] max-h-[92vh] w-[960px] max-w-[96vw] flex-col gap-0 overflow-hidden bg-gdb-chrome p-0 text-gdb-fg sm:max-w-[960px]"
      >
        {/* Cabecera */}
        <header className="flex h-11 shrink-0 items-center gap-3 border-b border-gdb-sep px-4">
          <DialogTitle className="text-sm font-semibold text-gdb-fgstrong">Apariencia</DialogTitle>
          <DialogDescription className="sr-only">Tema, colores y ventana de DataDB. Los cambios se aplican al instante.</DialogDescription>
          <div className="ml-auto flex items-center gap-2">
            {placeholder && (
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-gdb-fgdim" />
                <input
                  type="text"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && busqueda) {
                      // ⎋ con texto limpia la búsqueda; sin texto, cierra el diálogo (lo de siempre).
                      e.stopPropagation();
                      setBusqueda("");
                    }
                  }}
                  placeholder={placeholder}
                  aria-label={placeholder}
                  data-testid="apariencia-buscar"
                  className="h-7 w-[220px] rounded-md border border-gdb-sep bg-gdb-editor pr-2 pl-7 text-xs text-gdb-fg outline-none placeholder:text-gdb-muted hover:border-gdb-border focus-visible:border-gdb-focus"
                />
              </div>
            )}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              title="Cerrar"
              aria-label="Cerrar"
              className="grid size-7 place-items-center rounded-md text-gdb-fgdim hover:bg-gdb-hover hover:text-gdb-fg"
            >
              <XIcon className="size-4" />
            </button>
          </div>
        </header>

        {/* Cuerpo: navegación · contenido · vista previa */}
        <div className="grid min-h-0 flex-1 grid-cols-[180px_minmax(0,1fr)_300px]">
          <nav className="flex flex-col gap-0.5 border-r border-gdb-sep p-2" aria-label="Secciones">
            {SECCIONES.map(({ id, label, icono: Icono }) => (
              <button
                key={id}
                type="button"
                onClick={() => irA(id)}
                aria-current={seccion === id ? "page" : undefined}
                data-testid={`apariencia-seccion-${id}`}
                className={cn(
                  "flex h-7 items-center gap-2 rounded-md px-2 text-left text-xs transition-colors",
                  seccion === id ? "bg-gdb-listsel text-gdb-fgstrong" : "text-gdb-fg hover:bg-gdb-hover"
                )}
              >
                <Icono className="size-3.5 shrink-0 opacity-80" />
                {label}
              </button>
            ))}
          </nav>

          <main className="min-h-0 overflow-y-auto p-4" data-testid="apariencia-contenido">
            {seccion === "tema" && <SeccionTema state={state} busqueda={busqueda} />}

            {seccion === "colores" && (
              <Bloque titulo="Entorno">
                <Fila
                  etiqueta="Tinte de conexión"
                  ayuda="Cuánto se tiñe el explorador con el color de la conexión. El azul de fábrica no tiñe; el color se elige en Conexiones."
                >
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(state.tint * 100)}
                    aria-label="Intensidad del tinte de entorno"
                    onChange={(e) => updateThemeState({ tint: Number(e.target.value) / 100 })}
                    className="w-40 accent-[var(--gdb-accent)]"
                  />
                  <span className="w-10 text-xs tabular-nums">{Math.round(state.tint * 100)} %</span>
                  <span
                    data-testid="tint-sample"
                    className="rounded border border-gdb-border px-2 py-0.5 font-jetbrains text-[11px] text-gdb-fgeditor"
                    // R18: la muestra con el color REAL de la conexión (o el rojo de ejemplo) sobre el
                    // fondo del explorador y con su mismo peso.
                    style={{
                      background: fondoTenido(conexionDeMuestra?.color ?? TINTE_DE_EJEMPLO, "var(--sidebar)", PESO_DE_TINTE.arbol),
                    }}
                  >
                    {conexionDeMuestra?.color ? conexionDeMuestra.nombre : "ejemplo"} · explorador
                  </span>
                </Fila>
                <p className="mt-2 text-[11px] text-gdb-fgdim">
                  El color de acento y la tipografía llegan en el siguiente tramo. Para cambiar un color
                  concreto, usa{" "}
                  <button type="button" className="text-gdb-link underline-offset-2 hover:underline" onClick={() => irA("avanzado")}>
                    Avanzado
                  </button>
                  .
                </p>
              </Bloque>
            )}

            {seccion === "rejilla" && (
              <Bloque titulo="Rejilla de datos">
                <Fila etiqueta="Cuadrícula" ayuda="Líneas entre filas y columnas de los resultados">
                  <Segmentado<Cuadricula>
                    label="Cuadrícula"
                    testid="rejilla-cuadricula"
                    value={state.cuadricula ?? "marcada"}
                    options={[
                      { id: "marcada", label: "Marcada" },
                      { id: "suave", label: "Suave" },
                      { id: "ninguna", label: "Sin líneas" },
                    ]}
                    onChange={(cuadricula) => updateThemeState({ cuadricula })}
                  />
                </Fila>
                <Fila
                  etiqueta="Colores por tipo de dato"
                  ayuda="Números, fechas y JSON con los colores de sintaxis del tema; los booleanos van como casilla"
                >
                  <Segmentado<"si" | "no">
                    label="Colores por tipo de dato"
                    testid="rejilla-colores-tipo"
                    value={state.coloresPorTipo === false ? "no" : "si"}
                    options={[
                      { id: "si", label: "Sí" },
                      { id: "no", label: "No" },
                    ]}
                    onChange={(v) => updateThemeState({ coloresPorTipo: v === "si" })}
                  />
                </Fila>
                <p className="mt-2 text-[11px] text-gdb-fgdim">
                  Las líneas se calculan con el tema para que se vean en todos. Filas alternas y cómo se
                  muestra NULL llegan en el tramo 3.
                </p>
              </Bloque>
            )}

            {seccion === "ventana" && (
              <Bloque titulo="Ventana">
                <Fila etiqueta="Densidad">
                  <Segmentado<DensityId>
                    label="Densidad"
                    value={state.density}
                    options={Object.values(DENSITIES).map((d) => ({ id: d.id, label: d.label }))}
                    onChange={(density) => updateThemeState({ density })}
                  />
                </Fila>
                {/* Fase 9 (R12, D1): «Use Single Tool Window Bar» de DataGrip. */}
                <Fila etiqueta="Barra de tool windows">
                  <Segmentado<BarMode>
                    label="Barra de tool windows"
                    value={layout.bar}
                    options={[
                      { id: "side", label: "Vertical" },
                      { id: "header", label: "En el header" },
                    ]}
                    onChange={(bar) => setBarMode(bar)}
                  />
                </Fila>
                <Fila etiqueta="Paneles">
                  <Button size="sm" variant="outline" onClick={() => resetLayout()} title="Paneles, docks y modos de vista por defecto">
                    Restablecer layout
                  </Button>
                </Fila>
              </Bloque>
            )}

            {seccion === "avanzado" && <SeccionAvanzado state={state} busqueda={busqueda} />}
          </main>

          <VistaPrevia state={state} conexion={conexionDeMuestra} />
        </div>

        {/* Pie */}
        <footer className="flex h-[52px] shrink-0 items-center gap-2 border-t border-gdb-sep px-4">
          <Button
            size="sm"
            variant="ghost"
            data-testid="apariencia-restablecer"
            onClick={() => {
              setThemeState(DEFAULT_STATE);
              setErrorDeImportacion(null);
              toast("Apariencia de fábrica restablecida");
            }}
          >
            Restablecer todo
          </Button>
          <Button size="sm" variant="outline" onClick={() => archivoRef.current?.click()} data-testid="apariencia-importar">
            Importar…
          </Button>
          <Button
            size="sm"
            variant="outline"
            data-testid="apariencia-exportar"
            onClick={() => {
              downloadText("datadb-apariencia.json", exportThemeState(state));
              toast.success("Apariencia exportada a datadb-apariencia.json");
            }}
          >
            Exportar…
          </Button>
          <input
            ref={archivoRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            data-testid="apariencia-archivo"
            onChange={(e) => {
              const archivo = e.target.files?.[0];
              e.target.value = ""; // permitir reimportar el mismo archivo
              if (archivo) void importar(archivo);
            }}
          />
          {errorDeImportacion ? (
            <p role="alert" className="ml-2 min-w-0 flex-1 truncate text-[11px] text-gdb-errfg" title={errorDeImportacion} data-testid="apariencia-error">
              {errorDeImportacion}
            </p>
          ) : (
            <span className="ml-auto flex items-center gap-1.5 text-[11px] text-gdb-fgdim">
              <span className="size-1.5 rounded-full bg-gdb-okfg" />
              Los cambios se aplican al instante
            </span>
          )}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
