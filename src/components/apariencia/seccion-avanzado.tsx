/**
 * R98 (T1) — sección «Avanzado» del diálogo «Apariencia»: el tema base y los 86 colores uno a uno
 * (lo que antes ocupaba todo el diálogo; R33, R51). Se filtra con el buscador único de la cabecera.
 */
import * as React from "react";
import { RotateCcwIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { THEMES, THEME_IDS, type ThemeId } from "@/theme/themes";
import { PALETTES } from "@/theme/palettes";
import { TOKEN_GROUPS, type TokenKey } from "@/theme/tokens";
import { resetToken, resolveTokens, withToken, type ThemeState } from "@/theme/apply";
import { normalizarBusqueda } from "@/theme/galeria";
import { getThemeState, setThemeState, updateThemeState } from "@/theme/theme-store";
import { Fila, Segmentado } from "./controles";

/** Fila de un color. El hex se edita libre y solo se aplica cuando es un #RRGGBB válido. */
function FilaDeColor({
  tokenKey,
  label,
  value,
  verified,
  modified,
}: {
  tokenKey: TokenKey;
  label: string;
  value: string;
  verified: boolean;
  modified: boolean;
}) {
  const [draft, setDraft] = React.useState(value);
  // Si el valor cambia desde fuera (otro tema, ↺, importar), el borrador lo sigue.
  React.useEffect(() => setDraft(value), [value]); // eslint-disable-line react-hooks/set-state-in-effect
  const apply = (v: string) => setThemeState(withToken(getThemeState(), tokenKey, v));
  return (
    <div className="flex h-7 items-center gap-2 rounded px-2 hover:bg-gdb-hover" data-token={tokenKey}>
      <span
        className={cn("w-3 text-center text-[11px]", verified ? "text-gdb-okfg" : "text-gdb-fgdim")}
        title={verified ? "Verificado en el archivo del tema de JetBrains" : "Derivado o heredado: sin verificar literal"}
      >
        {verified ? "●" : "○"}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-gdb-fg">
        {label}
        {modified && <span className="ml-1 text-gdb-accent" title="Modificado">●</span>}
      </span>
      <button
        type="button"
        title="Volver al valor del tema"
        aria-label={`Volver al valor del tema: ${label}`}
        onClick={() => setThemeState(resetToken(getThemeState(), tokenKey))}
        className={cn("text-gdb-fgdim hover:text-gdb-fg", !modified && "invisible")}
      >
        <RotateCcwIcon className="size-3" />
      </button>
      <input
        type="color"
        aria-label={`Color: ${label}`}
        value={value.toLowerCase()}
        onChange={(e) => apply(e.target.value)}
        className="h-5 w-7 cursor-pointer rounded border border-gdb-border bg-transparent p-0"
      />
      <input
        type="text"
        aria-label={`Hex: ${label}`}
        value={draft}
        maxLength={7}
        spellCheck={false}
        onChange={(e) => {
          setDraft(e.target.value);
          if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) apply(e.target.value);
        }}
        onBlur={() => setDraft(value)}
        className={cn(
          "h-5 w-[68px] rounded border bg-gdb-field px-1.5 font-jetbrains text-[11px] text-gdb-fg outline-none focus:border-gdb-focus",
          /^#[0-9a-fA-F]{6}$/.test(draft) ? "border-gdb-border" : "border-gdb-dangerborder"
        )}
      />
    </div>
  );
}

export function SeccionAvanzado({ state, busqueda }: { state: ThemeState; busqueda: string }) {
  const theme = THEMES[state.base];
  const tokens = resolveTokens(state);
  const b = normalizarBusqueda(busqueda);
  const grupos = TOKEN_GROUPS.map((g) => ({
    ...g,
    tokens: g.tokens.filter((t) => !b || normalizarBusqueda(t.label).includes(b) || t.key.includes(b)),
  })).filter((g) => g.tokens.length > 0);
  const paleta = state.palette ? PALETTES.find((p) => p.id === state.palette) : undefined;
  const cambios = Object.keys(state.over).length;

  return (
    <div className="flex flex-col gap-2" data-testid="seccion-avanzado">
      <Fila etiqueta="Tema base" ayuda="Elegir un tema ya fija su base; cambiarla aquí a mano te saca del tema">
        <Segmentado<ThemeId>
          label="Tema base"
          value={state.base}
          options={THEME_IDS.map((id) => ({ id, label: THEMES[id].label }))}
          onChange={(base) => updateThemeState({ base })}
        />
      </Fila>
      <div className="flex items-center justify-between border-t border-gdb-sep pt-2 text-[11px]">
        <span className="text-gdb-fg" data-testid="avanzado-cambios">
          {cambios > 0 ? `${cambios} colores sobre ${theme.label}` : `Colores de ${theme.label}`}
          {paleta && <span className="text-gdb-fgdim"> · tema {paleta.label}</span>}
        </span>
        <span
          className="text-gdb-fgdim"
          title="● = valor leído tal cual del archivo de tema de JetBrains. ○ = derivado o heredado."
        >
          <span className="text-gdb-okfg">●</span> de JetBrains · ○ derivado
        </span>
      </div>
      {grupos.length === 0 ? (
        <p className="py-8 text-center text-xs text-gdb-fgdim">Ningún color se llama así.</p>
      ) : (
        <div className="grid grid-cols-1 gap-x-4">
          {grupos.map((g) => (
            <div key={g.title} className="mb-2">
              <h4 className="px-2 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-gdb-fgdim uppercase">{g.title}</h4>
              {g.tokens.map((t) => (
                <FilaDeColor
                  key={t.key}
                  tokenKey={t.key}
                  label={t.label}
                  value={tokens[t.key]}
                  verified={theme.verified.has(t.key)}
                  modified={t.key in state.over}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
