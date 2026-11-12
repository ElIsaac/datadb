/**
 * Lógica PURA del tema (sin DOM): estado persistible, validación, variables CSS resultantes y el
 * `tokens.css` de arranque. Se testea en Node (themes.test.ts); el DOM lo toca solo theme-store.ts.
 *
 * Capas de R33 tal como quedan en el código:
 *   1. primitivos  → los hex de cada tema (themes.ts)
 *   2. semánticos  → `--gdb-<token>` (tokens.ts), lo único que deben usar los componentes nuevos
 *   3. tema        → qué hex recibe cada `--gdb-*`: el tema base + los cambios del usuario (R51);
 *                    y los tokens de shadcn (`--background`…) apuntan a la capa 2 en globals.css.
 */
import { DEFAULT_DENSITY, DENSITIES, FIXED_METRICS, type DensityId } from "./density";
import { DEFAULT_THEME, THEMES, type ThemeId } from "./themes";
import { PALETTE_IDS } from "./palettes";
import { TOKEN_KEYS, cssVar, type TokenKey } from "./tokens";

export type ModoDeApariencia = "oscuro" | "claro" | "sistema";
export type Cuadricula = "marcada" | "suave" | "ninguna";

/** Estado persistido (localStorage) y formato de exportar/importar (R51). */
export interface ThemeState {
  v: 1;
  base: ThemeId;
  /** Solo los tokens que el usuario cambió; nunca se modifica el tema base. */
  over: Partial<Record<TokenKey, string>>;
  /**
   * Paleta aplicada (`palettes.ts`), si el estado vino de una. Es informativo: lo que manda son
   * `base` + `over`. Sirve para marcar la tarjeta activa y para saber si el usuario retocó la paleta
   * a mano (en ese caso `esPaletaActiva` da false).
   */
  palette?: string;
  /** Intensidad del tinte de entorno, 0..1 (R52). 0,5 por defecto: sutil, pedido por el usuario. */
  tint: number;
  /**
   * R98 (T1): modo de apariencia. `oscuro`/`claro` = fijo; `sistema` = sigue a macOS y aplica
   * `paletaOscura` o `paletaClara` según toque (`modo.ts`). Ausente = estado anterior a R98: el modo
   * se deduce del tema base.
   */
  modo?: ModoDeApariencia;
  /** R98: el tema elegido para el modo oscuro (id de `palettes.ts`). */
  paletaOscura?: string;
  /** R98: el tema elegido para el modo claro. */
  paletaClara?: string;
  /**
   * R98: líneas de la rejilla de resultados. `marcada` (por defecto) = líneas entre filas y columnas
   * con contraste garantizado; `suave` = más tenues; `ninguna` = sin líneas. Ausente = `marcada`.
   */
  cuadricula?: Cuadricula;
  /** R98: colorear el texto de la rejilla por tipo de dato (números, fechas, JSON). Ausente = sí. */
  coloresPorTipo?: boolean;
  density: DensityId;
}

export const DEFAULT_STATE: ThemeState = {
  v: 1,
  base: DEFAULT_THEME,
  over: {},
  tint: 0.5,
  density: DEFAULT_DENSITY,
};

const HEX = /^#[0-9A-F]{6}$/;

/** Normaliza un color a `#RRGGBB` en mayúsculas, o null si no lo es. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const up = value.trim().toUpperCase();
  return HEX.test(up) ? up : null;
}

/**
 * Valida un estado venido de fuera (localStorage o un JSON importado). Lanza con un mensaje legible:
 * el panel lo muestra y NO aplica nada (criterio de R51). Tokens desconocidos o colores inválidos son
 * error, no se ignoran en silencio: un JSON que "importa a medias" es peor que uno rechazado.
 */
export function parseThemeState(input: unknown): ThemeState {
  if (!input || typeof input !== "object") throw new Error("El JSON no es un objeto.");
  const o = input as Record<string, unknown>;
  const base = o.base as ThemeId;
  if (!(base in THEMES)) throw new Error(`Tema base desconocido: ${String(o.base)}`);
  const over: Partial<Record<TokenKey, string>> = {};
  if (o.over !== undefined) {
    if (!o.over || typeof o.over !== "object") throw new Error("\"over\" debe ser un objeto.");
    for (const [k, val] of Object.entries(o.over as Record<string, unknown>)) {
      if (!(TOKEN_KEYS as readonly string[]).includes(k)) throw new Error(`Token desconocido: ${k}`);
      const hex = normalizeHex(val);
      if (!hex) throw new Error(`Color inválido para ${k}: ${String(val)}`);
      if (hex !== THEMES[base].v[k as TokenKey]) over[k as TokenKey] = hex;
    }
  }
  let tint = DEFAULT_STATE.tint;
  if (o.tint !== undefined) {
    if (typeof o.tint !== "number" || !Number.isFinite(o.tint)) throw new Error("\"tint\" debe ser un número.");
    tint = Math.min(1, Math.max(0, o.tint));
  }
  let density = DEFAULT_STATE.density;
  if (o.density !== undefined) {
    if (!(String(o.density) in DENSITIES)) throw new Error(`Densidad desconocida: ${String(o.density)}`);
    density = o.density as DensityId;
  }
  // La paleta se conserva al importar/leer si es un id conocido; un id raro no invalida el tema.
  const palette =
    typeof o.palette === "string" && PALETTE_IDS.includes(o.palette) ? o.palette : undefined;
  // R98: modo y tema de cada modo. Como la paleta: un valor raro se descarta sin invalidar el tema.
  const modo = o.modo === "oscuro" || o.modo === "claro" || o.modo === "sistema" ? o.modo : undefined;
  const paletaOscura =
    typeof o.paletaOscura === "string" && PALETTE_IDS.includes(o.paletaOscura) ? o.paletaOscura : undefined;
  const paletaClara =
    typeof o.paletaClara === "string" && PALETTE_IDS.includes(o.paletaClara) ? o.paletaClara : undefined;
  const cuadricula =
    o.cuadricula === "marcada" || o.cuadricula === "suave" || o.cuadricula === "ninguna" ? o.cuadricula : undefined;
  return {
    v: 1,
    base,
    over,
    tint,
    density,
    ...(palette ? { palette } : {}),
    ...(modo ? { modo } : {}),
    ...(paletaOscura ? { paletaOscura } : {}),
    ...(paletaClara ? { paletaClara } : {}),
    ...(cuadricula ? { cuadricula } : {}),
    ...(typeof o.coloresPorTipo === "boolean" ? { coloresPorTipo: o.coloresPorTipo } : {}),
  };
}

/**
 * Cambia un token (R51). Si el color coincide con el del tema base, se quita el override en vez de
 * guardarlo: así "volver al valor del tema" y "elegir el mismo color" dan el mismo estado.
 * Devuelve el estado sin cambios si el color no es válido.
 */
export function withToken(state: ThemeState, key: TokenKey, value: string): ThemeState {
  const hex = normalizeHex(value);
  if (!hex) return state;
  const over = { ...state.over };
  if (hex === THEMES[state.base].v[key]) delete over[key];
  else over[key] = hex;
  return { ...state, over };
}

/** Quita el override de un token (botón ↺ del panel). */
export function resetToken(state: ThemeState, key: TokenKey): ThemeState {
  const over = { ...state.over };
  delete over[key];
  return { ...state, over };
}

/** Texto de exportación: el mismo formato que acepta parseThemeState (ida y vuelta exacta). */
export function exportThemeState(state: ThemeState): string {
  return JSON.stringify(state, null, 2);
}

/** Tokens efectivos: tema base + cambios del usuario. */
export function resolveTokens(state: ThemeState): Record<TokenKey, string> {
  return { ...THEMES[state.base].v, ...state.over } as Record<TokenKey, string>;
}

/** Todas las variables CSS que el estado produce (lo que theme-store escribe en <html>). */
export function themeCssVars(state: ThemeState): Record<string, string> {
  const tokens = resolveTokens(state);
  const d = DENSITIES[state.density];
  const out: Record<string, string> = {};
  for (const k of TOKEN_KEYS) out[cssVar(k)] = tokens[k];
  out["--gdb-row"] = `${d.row}px`;
  out["--gdb-th-h"] = `${d.th}px`;
  out["--gdb-tab-h"] = `${d.tab}px`;
  out["--gdb-indent"] = `${FIXED_METRICS.indent}px`;
  out["--gdb-icon"] = `${FIXED_METRICS.icon}px`;
  out["--gdb-arc"] = `${THEMES[state.base].arc}px`;
  out["--gdb-tint"] = String(state.tint);
  return out;
}

/**
 * Contenido de src/theme/tokens.css: el estado por defecto como `:root` (para que la primera
 * pintura, antes de que corra JS, ya sea Darcula y no haya parpadeo) + las utilidades de Tailwind
 * (`bg-gdb-chrome`, `text-gdb-kw`…). Lo escribe scripts/gen-tokens.ts; el test exige que coincidan.
 */
export function generateTokensCss(): string {
  const vars = themeCssVars(DEFAULT_STATE);
  const root = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`).join("\n");
  const tw = TOKEN_KEYS.map((k) => `  --color-gdb-${k}: var(${cssVar(k)});`).join("\n");
  return [
    "/* GENERADO por scripts/gen-tokens.ts desde src/theme/*.ts — no editar a mano. */",
    "/* Estado por defecto: tema Darcula (R9), densidad New UI (D1), tinte 0,5 (R52). */",
    ":root {",
    root,
    "}",
    "",
    "/* Utilidades de Tailwind sobre la capa semántica: bg-gdb-chrome, text-gdb-kw, border-gdb-sep… */",
    "@theme inline {",
    tw,
    "}",
    "",
  ].join("\n");
}
