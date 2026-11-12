/**
 * R98 (T1) — sección «Tema» del diálogo «Apariencia»: modo (Oscuro | Claro | Seguir al sistema),
 * chips de filtro con conteo real y la galería de tarjetas con miniatura.
 *
 * Lo que decide qué tema queda aplicado vive en `theme/modo.ts` (puro, con tests); aquí solo se pinta
 * y se llama. La búsqueda NO está aquí: es el buscador único de la cabecera del diálogo (corrección
 * a la maqueta, que traía dos).
 */
import * as React from "react";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PALETTES, esPaletaActiva, paletaPorId, tokensResueltosDePaleta } from "@/theme/palettes";
import { conteosDeTemas, temasVisibles, type FiltroDeTemas } from "@/theme/galeria";
import { cambiarModo, elegirTema, fijarPaletaDeModo, modoDe, paletaDelModo } from "@/theme/modo";
import type { ModoDeApariencia, ThemeState } from "@/theme/apply";
import { getThemeState, setThemeState, sistemaEsOscuro } from "@/theme/theme-store";
import { MiniaturaTema } from "./miniatura-tema";
import { Segmentado } from "./controles";

/** Desplegable de tema para un modo (solo temas de ese modo). */
function SelectorDeTemaDeModo({ oscuro, state }: { oscuro: boolean; state: ThemeState }) {
  const valor = paletaDelModo(state, oscuro);
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[11px] text-gdb-fgdim">{oscuro ? "Tema para modo oscuro" : "Tema para modo claro"}</span>
      <Select
        value={valor}
        onValueChange={(id) =>
          id && setThemeState(fijarPaletaDeModo(getThemeState(), oscuro, String(id), sistemaEsOscuro()))
        }
      >
        <SelectTrigger
          size="sm"
          data-testid={oscuro ? "tema-modo-oscuro" : "tema-modo-claro"}
          className="h-7 w-full rounded-md border-gdb-border bg-gdb-field px-2 text-xs text-gdb-fg hover:bg-gdb-hover"
        >
          <SelectValue>{(id: string) => paletaPorId(id)?.label ?? id}</SelectValue>
        </SelectTrigger>
        <SelectContent className="max-h-72 border-gdb-border bg-popover p-1 text-gdb-fg">
          {PALETTES.filter((p) => p.dark === oscuro).map((p) => (
            <SelectItem key={p.id} value={p.id} className="rounded px-2 py-1 text-xs">
              {p.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

export function SeccionTema({ state, busqueda }: { state: ThemeState; busqueda: string }) {
  const [filtro, setFiltro] = React.useState<FiltroDeTemas>("todos");
  const modo = modoDe(state);
  const conteos = conteosDeTemas(PALETTES, busqueda);
  const temas = temasVisibles(PALETTES, filtro, busqueda);
  const sistemaOscuro = sistemaEsOscuro();
  // Con «Seguir al sistema», elegir un tema del otro modo lo deja recordado sin aplicarlo: se avisa.
  const [aviso, setAviso] = React.useState<string | null>(null);

  const elegir = (id: string) => {
    const antes = getThemeState();
    const despues = elegirTema(antes, id, sistemaEsOscuro());
    setThemeState(despues);
    const p = paletaPorId(id);
    setAviso(
      p && despues.palette !== id
        ? `${p.label} se usará cuando macOS esté en modo ${p.dark ? "oscuro" : "claro"}.`
        : null
    );
  };

  return (
    <div className="flex flex-col gap-3" data-testid="seccion-tema">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-gdb-fgdim">Modo</span>
        <Segmentado<ModoDeApariencia>
          label="Modo"
          testid="tema-modo"
          value={modo}
          options={[
            { id: "oscuro", label: "Oscuro" },
            { id: "claro", label: "Claro" },
            { id: "sistema", label: "Seguir al sistema" },
          ]}
          onChange={(m) => {
            setAviso(null);
            setThemeState(cambiarModo(getThemeState(), m, sistemaEsOscuro()));
          }}
        />
        {modo === "sistema" && (
          <span className="text-[11px] text-gdb-fgdim">macOS está en modo {sistemaOscuro ? "oscuro" : "claro"}</span>
        )}
      </div>

      {modo === "sistema" && (
        <div className="flex gap-3">
          <SelectorDeTemaDeModo oscuro state={state} />
          <SelectorDeTemaDeModo oscuro={false} state={state} />
        </div>
      )}

      {/* Chips de filtro: el número es el total real con la búsqueda aplicada. */}
      <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Filtrar temas">
        {(
          [
            ["todos", "Todos"],
            ["oscuros", "Oscuros"],
            ["claros", "Claros"],
          ] as const
        ).map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={filtro === id}
            data-testid={`tema-filtro-${id}`}
            onClick={() => setFiltro(id)}
            className={cn(
              "flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[11px] transition-colors",
              filtro === id
                ? "border-gdb-focus bg-gdb-listsel text-gdb-fgstrong"
                : "border-gdb-border text-gdb-fgdim hover:bg-gdb-hover hover:text-gdb-fg"
            )}
          >
            {rotulo}
            <span className="font-jetbrains text-[10px] tabular-nums opacity-80">{conteos[id]}</span>
          </button>
        ))}
      </div>

      {aviso && (
        <p className="rounded-md border border-gdb-border bg-gdb-hover px-2.5 py-1.5 text-[11px] text-gdb-fg" role="status" data-testid="tema-aviso">
          {aviso}
        </p>
      )}

      {temas.length === 0 ? (
        <p className="py-10 text-center text-xs text-gdb-fgdim" data-testid="tema-sin-resultados">
          Ningún tema se llama así.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2.5" data-testid="tema-galeria">
          {temas.map((p) => {
            const activa = esPaletaActiva(state, p.id);
            // Del modo contrario con «Seguir al sistema»: recordado para el otro modo (no aplicado).
            const recordada = !activa && (state.paletaOscura === p.id || state.paletaClara === p.id) && modo === "sistema";
            const t = tokensResueltosDePaleta(p);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => elegir(p.id)}
                aria-pressed={activa}
                data-testid={`tema-${p.id}`}
                title={p.label}
                className={cn(
                  "group relative flex flex-col gap-1.5 rounded-lg border p-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-gdb-focus",
                  activa
                    ? "border-gdb-focus bg-gdb-listsel/40 ring-1 ring-gdb-focus"
                    : "border-gdb-sep hover:border-gdb-border hover:bg-gdb-hover"
                )}
              >
                <MiniaturaTema t={t} />
                {/* Solo el nombre: los colores ya los enseña la miniatura (cada dato una vez). */}
                <span className="truncate px-0.5 text-[11.5px] text-gdb-fg">{p.label}</span>
                {activa && (
                  <span className="absolute top-2.5 right-2.5 grid size-4 place-items-center rounded-full bg-gdb-btnprimary text-gdb-onaccent">
                    <CheckIcon className="size-3" strokeWidth={3} />
                  </span>
                )}
                {recordada && (
                  <span className="absolute top-2.5 right-2.5 rounded bg-gdb-chrome/90 px-1 text-[9.5px] text-gdb-fg">
                    {p.dark ? "para oscuro" : "para claro"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
