/**
 * Tema de `glide-data-grid` construido desde los tokens del repo (fase 11, T3).
 *
 * El grid pinta en un `<canvas>`, y un canvas NO se estiliza con CSS: hay que leer los tokens en
 * tiempo de ejecución y pasárselos como objeto. Por eso esto existe en vez de unas clases de
 * Tailwind.
 *
 * Dos trampas que ya costaron una medición equivocada en el spike de la fase 10:
 *
 * 1. **Los nombres de token son `--gdb-<key>`** (ver `src/theme/tokens.ts`). Pedir uno que no
 *    existe NO da error: devuelve cadena vacía y el grid se queda con sus colores por defecto, lo
 *    que parece «el grid no repinta al cambiar de tema» cuando lo que pasa es que el tema nunca le
 *    llegó. De ahí que `temaDeGrid` exija un lector y que haya un test que compruebe que ningún
 *    valor sale vacío.
 * 2. El tema hay que **reconstruirlo** cuando el usuario cambia de tema o de densidad; no basta con
 *    construirlo una vez al montar.
 *
 * La función es pura (recibe el lector de tokens) para poder probarla sin navegador.
 */

import { BLANCO, NEGRO, contraste, mix } from "@/theme/palettes";
import type { Cuadricula } from "@/theme/apply";

/** Nombres de los tokens que el grid necesita. Si falta uno, el test de abajo lo caza. */
export const TOKENS_DEL_GRID = [
  "--gdb-field",
  "--gdb-contrast",
  "--gdb-th",
  "--gdb-grid",
  "--gdb-fg",
  "--gdb-fgstrong",
  "--gdb-fgdim",
  "--gdb-muted",
  "--gdb-sel",
  "--gdb-rowhover",
  "--gdb-pressed",
  "--gdb-border",
  "--gdb-link",
  "--gdb-warnbg",
  // Edición por lotes: celda cambiada, fila nueva y fila marcada para borrar. Son los mismos
  // tokens que usaba el grid DOM (`bg-gdb-okfg/15`, `bg-gdb-fail/15`, el resalte de celda editada).
  "--gdb-diffmod",
  "--gdb-okbg",
  "--gdb-dangerbg",
  // R98: colores por tipo de dato (los de sintaxis del tema) y el acento de las casillas.
  "--gdb-num",
  "--gdb-fn",
  "--gdb-str",
  "--gdb-accent",
  "--gdb-onaccent",
] as const;

export type TokenDelGrid = (typeof TOKENS_DEL_GRID)[number];

/** Lee el valor de un token. En el navegador es `getComputedStyle`; en los tests, un objeto. */
export type LectorDeTokens = (nombre: TokenDelGrid) => string;

/** El subconjunto del `Theme` de glide que usamos. Se escribe aquí para no depender del tipo de la librería en los tests. */
export interface TemaDeGrid {
  bgCell: string;
  bgCellMedium: string;
  bgHeader: string;
  bgHeaderHovered: string;
  bgHeaderHasFocus: string;
  textDark: string;
  textMedium: string;
  textLight: string;
  textHeader: string;
  textHeaderSelected: string;
  borderColor: string;
  horizontalBorderColor: string;
  accentColor: string;
  accentLight: string;
  accentFg: string;
  drilldownBorder: string;
  linkColor: string;
  bgSearchResult: string;
  fontFamily: string;
  baseFontStyle: string;
  headerFontStyle: string;
  editorFontSize: string;
  cellHorizontalPadding: number;
  cellVerticalPadding: number;
}

/**
 * Altura de fila: la marca la densidad, igual que en el resto de la UI (`--gdb-row`).
 * Se devuelve aparte del tema porque en glide es una prop del componente, no del tema.
 */
export function alturaDeFila(valorCrudo: string, porDefecto = 24): number {
  const n = Number.parseFloat(valorCrudo);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : porDefecto;
}

/**
 * R98: contraste OBJETIVO de la línea de la rejilla contra el fondo de la celda.
 *
 * Antes la línea era el token `grid` tal cual, y en los temas DERIVADOS (`palettes.ts`) ese token y
 * el fondo de celda (`field`) salen de la misma mezcla fondo→texto con un punto de diferencia: en
 * Tokyo Night quedaban #2A2D3E contra #282B3C y la cuadrícula, aunque se pintaba, no se veía (lo
 * reportó el usuario con captura). Un porcentaje fijo de mezcla tampoco sirve (en los claros, y en
 * Solarized con su texto tenue, se quedaba corto): la línea se acerca al texto lo justo para llegar
 * al contraste pedido. Lo mide `grid.test.ts` en todos los temas.
 */
const CONTRASTE_DE_LINEA: Record<Cuadricula, number> = { marcada: 1.9, suave: 1.35, ninguna: 1 };

function lineaConContraste(fondo: string, texto: string, objetivo: number): string {
  if (objetivo <= 1) return fondo;
  for (let t = 0.04; t <= 0.8; t += 0.01) {
    const c = mix(fondo, texto, t);
    if (contraste(c, fondo) >= objetivo) return c;
  }
  return mix(fondo, texto, 0.8);
}

/** ¿Lleva líneas verticales (entre columnas)? Solo «Sin líneas» las quita. */
export function bordesVerticales(cuadricula: Cuadricula = "marcada"): boolean {
  return cuadricula !== "ninguna";
}

/**
 * R98: los colores por tipo de dato (`tokenDeColorPorTipo`) ya ajustados para leerse sobre la celda.
 *
 * Salen de la sintaxis del tema, pensada para el fondo del EDITOR; la rejilla pinta sobre el fondo de
 * CAMPO, que en algunos temas es otro: en Darcula el número #6897BB sobre #45494A daba 2,9:1 y la
 * cadena 2,3:1. Si un color no llega a 3:1 se acerca al color de texto lo justo (conserva el tono).
 */
const CONTRASTE_DE_TIPO = 3;

export function coloresDeTipo(leer: LectorDeTokens): Record<"--gdb-num" | "--gdb-fn" | "--gdb-str", string> {
  const fondo = leer("--gdb-field");
  const texto = leer("--gdb-fg");
  const legible = (color: string) => {
    if (!/^#[0-9A-F]{6}$/i.test(color) || !/^#[0-9A-F]{6}$/i.test(fondo) || !/^#[0-9A-F]{6}$/i.test(texto)) return color;
    for (let t = 0; t <= 1; t += 0.05) {
      const c = t === 0 ? color : mix(color, texto, t);
      if (contraste(c, fondo) >= CONTRASTE_DE_TIPO) return c;
    }
    return texto;
  };
  return { "--gdb-num": legible(leer("--gdb-num")), "--gdb-fn": legible(leer("--gdb-fn")), "--gdb-str": legible(leer("--gdb-str")) };
}

/**
 * R98: fondo de las celdas SELECCIONADAS, visible en todos los temas.
 *
 * glide rellena la selección (rango, fila o columna) con `accentLight`. Antes ese era el token de
 * HOVER (`rowhover`), que en casi todos los temas queda a 1,02–1,15:1 del fondo de la celda: al
 * seleccionar una o varias columnas casi no se veía nada, y cada tema «seleccionaba» distinto (lo
 * reportó el usuario comparando con la vista previa, que sí usaba `sel`). Ahora es `sel` —el token
 * que el editor de colores llama «Celdas seleccionadas»—, y si en un tema queda pegado al fondo
 * (Darcula 1,06:1, Ayu Light 1,16:1) se acerca al acento hasta llegar a 1,3:1 sin que el texto
 * baje de 3:1 (ni de lo que ya daba el tema).
 */
const CONTRASTE_DE_SELECCION = 1.3;

export function seleccionDeRejilla(leer: LectorDeTokens): string {
  const sel = leer("--gdb-sel");
  const fondo = leer("--gdb-field");
  const acento = leer("--gdb-accent");
  const texto = leer("--gdb-fg");
  if (![sel, fondo, acento, texto].every((v) => /^#[0-9A-F]{6}$/i.test(v))) return sel;
  // Dos direcciones, la primera que llegue: hacia el acento, o ALEJÁNDOSE del fondo de la celda
  // (más oscuro si la selección ya es más oscura que la celda, más claro si no). En Darcula el acento
  // no sirve —aclara la selección hasta que el texto gris deja de leerse— y lo que funciona es
  // oscurecerla.
  const lum = (h: string) => contraste(h, NEGRO);
  const alejado = lum(sel) <= lum(fondo) ? NEGRO : BLANCO;
  // Si el tema ya trae una selección visible, se respeta tal cual (también su contraste de texto,
  // que en algún tema derivado es de 2,9:1). Solo se toca la que se pierde contra el fondo, y sin
  // dejar el texto peor de lo que el propio tema lo dejaba.
  if (contraste(sel, fondo) >= CONTRASTE_DE_SELECCION) return sel;
  const textoMinimo = Math.min(3, contraste(texto, sel));
  for (let t = 0; t <= 0.7; t += 0.05) {
    for (const hacia of [acento, alejado]) {
      const c = t === 0 ? sel : mix(sel, hacia, t);
      if (contraste(c, fondo) >= CONTRASTE_DE_SELECCION && contraste(texto, c) >= textoMinimo) return c;
    }
  }
  return sel;
}

export function temaDeGrid(leer: LectorDeTokens, cuadricula: Cuadricula = "marcada"): TemaDeGrid {
  const fondo = leer("--gdb-field");
  const texto = leer("--gdb-fg");
  const esHex = (v: string) => /^#[0-9A-F]{6}$/i.test(v);
  // Si un token no es un hex (no debería pasar; los tests usan lectores de mentira), la línea cae
  // al token `grid` de siempre en vez de salir «#NaN…».
  const linea =
    esHex(fondo) && esHex(texto) ? lineaConContraste(fondo, texto, CONTRASTE_DE_LINEA[cuadricula]) : leer("--gdb-grid");
  return {
    // Celdas: el fondo de campo, y el alterno con el token de contraste (lo que el grid DOM hacía
    // con `bg-card` / `bg-secondary/40`).
    bgCell: leer("--gdb-field"),
    bgCellMedium: leer("--gdb-contrast"),
    bgHeader: leer("--gdb-th"),
    bgHeaderHovered: leer("--gdb-rowhover"),
    bgHeaderHasFocus: leer("--gdb-pressed"),
    textDark: leer("--gdb-fg"),
    textMedium: leer("--gdb-fgdim"),
    textLight: leer("--gdb-muted"),
    textHeader: leer("--gdb-fg"),
    // R98: la cabecera de una columna seleccionada se pinta con `accentColor` (el acento), así que su
    // texto es el de «texto sobre acento»; con `fgstrong` en un tema claro quedaba negro sobre azul.
    textHeaderSelected: leer("--gdb-onaccent"),
    // R98: la línea se calcula desde el fondo de la celda (ver CONTRASTE_DE_LINEA); con «Sin líneas»
    // coincide con el fondo, así que no se ve.
    borderColor: linea,
    horizontalBorderColor: linea,
    // R98: `accentColor` es el ANILLO de la celda con foco, la cabecera de columna seleccionada y el
    // tirador de relleno → el acento del tema (antes `sel`, que sobre la selección no se veía).
    // `accentLight` es el RELLENO de la selección (ver `seleccionDeRejilla`).
    accentColor: leer("--gdb-accent"),
    accentLight: seleccionDeRejilla(leer),
    accentFg: leer("--gdb-fg"),
    drilldownBorder: leer("--gdb-border"),
    linkColor: leer("--gdb-link"),
    bgSearchResult: leer("--gdb-warnbg"),
    // El grid de datos va en monoespaciada, como hoy (`font-jetbrains` en results-grid.tsx).
    fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
    baseFontStyle: "12px",
    headerFontStyle: "600 12px",
    editorFontSize: "12px",
    cellHorizontalPadding: 8,
    cellVerticalPadding: 3,
  };
}
