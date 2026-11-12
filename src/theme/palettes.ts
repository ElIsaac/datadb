/**
 * PALETAS de color (2026-10-20) — presets con nombre que se cambian de un clic.
 *
 * Qué añade sobre lo que ya había: `themes.ts` define TRES temas base medidos contra JetBrains
 * (Darcula, New UI Dark, New UI Light) y el panel de Apariencia deja retocar los 86 tokens uno a uno.
 * Eso sirve para afinar, pero no para "quiero que se vea como One Dark": retocar 86 colores a mano
 * no es personalización, es trabajo. Aquí cada paleta aporta sus colores ANCLA y el resto se DERIVA
 * del tema base con reglas fijas (hover = fondo + 10 % de texto, borde = fondo + 18 %, etc.).
 *
 * Reglas de diseño:
 *  - Una paleta NO toca la sintaxis ni el chrome del tema base más de lo que declara: lo que no
 *    define se queda como estaba, así que el resultado sigue siendo coherente con Darcula/Light.
 *  - Los tokens de IDENTIDAD (colores de motor) y los de ACCESIBILIDAD (error/aviso/ok) se quedan
 *    del tema base: son semánticos, no estéticos, y una paleta no debe volver ilegible un error.
 *  - El contraste de texto se verifica en `palettes.test.ts` (≥ 4,5:1 sobre chrome y editor). Una
 *    paleta que no lo cumpla no entra: es la diferencia entre una paleta y un accidente.
 */
import { THEMES, type ThemeId } from "./themes";
import type { ThemeState } from "./apply";
import type { TokenKey } from "./tokens";

/** Colores de ancla: los que definen el carácter de la paleta. */
interface Anclas {
  /** Fondo del chrome (barras, paneles, diálogos). */
  bg: string;
  /** Fondo del editor. */
  editor: string;
  /** Texto normal. */
  fg: string;
  /** Acento: botón primario, foco, pestaña activa, enlaces. */
  accent: string;
  kw: string;
  str: string;
  num: string;
  comment: string;
  fn: string;
  const: string;
}

export interface PaletteDef {
  id: string;
  label: string;
  /** Tema base del que hereda los tokens que no declara. */
  base: ThemeId;
  dark: boolean;
  anclas: Anclas;
  /**
   * R98 (T1): tema FIEL — se aplica el tema base de JetBrains tal cual (sin overrides derivados). Es el
   * caso de «New UI Dark» y «New UI Light»: sus 86 colores están medidos contra JetBrains y derivarlos
   * de diez anclas los empeoraría. Las anclas solo sirven para la muestra de la tarjeta.
   */
  fiel?: true;
}

// ---------------------------------------------------------------------------------------------
// Aritmética de color (hex, sin dependencias)
// ---------------------------------------------------------------------------------------------

const hexRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

const rgbHex = ([r, g, b]: [number, number, number]): string =>
  "#" +
  [r, g, b]
    .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

/** Mezcla `a` con `b` al porcentaje `t` (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexRgb(a);
  const [br, bg, bb] = hexRgb(b);
  return rgbHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

/** Luminancia relativa (WCAG 2.x). */
function luminancia(hex: string): number {
  const canal = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexRgb(hex).map(canal) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre dos colores (1 = iguales, 21 = negro sobre blanco). */
/** Extremos para empujar un color «hacia el negro» o «hacia el blanco» fuera de `src/theme/` (que no admite hex). */
export const NEGRO = "#000000";
export const BLANCO = "#FFFFFF";

export function contraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  const [claro, oscuro] = la > lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (oscuro + 0.05);
}

/**
 * Texto legible SOBRE un color dado. Elige el que MÁS contrasta —no un umbral—: con un acento claro
 * (el cian de Nord) el blanco parecía aceptable (3,95:1) y el negro da 10:1. Es el error clásico de
 * los botones «bonitos» que no se leen.
 */
function sobre(color: string): string {
  return contraste(color, "#FFFFFF") >= contraste(color, "#000000") ? "#FFFFFF" : "#000000";
}

/**
 * Los tokens que una paleta DERIVA de sus anclas. Se derivan (y no se listan) porque son los que
 * no aportan carácter: si cada paleta tuviera que declarar `hover`, `pressed` y `thsep`, serían
 * 86 números por paleta y el resultado se rompería en cuanto uno no armonizara.
 */
export function tokensDePaleta(def: PaletteDef): Partial<Record<TokenKey, string>> {
  if (def.fiel) return {};
  const { bg, editor, fg, accent, kw, str, num, comment, fn, const: cst } = def.anclas;
  const hacia = (t: number) => mix(bg, fg, t); // tinte hacia el texto: sirve en oscuro y en claro
  /*
    El color del botón primario NO es el acento tal cual: el acento vive de focos y subrayados, donde
    un tono vivo va bien; un botón necesita que el texto se lea. En los temas oscuros se oscurece el
    acento (medido: el #4A88C7 de Darcula con texto blanco daba 3,73:1, por debajo de 4,5) y el color
    del texto se elige por contraste real.
  */
  const btnprimary = def.dark ? mix(accent, "#000000", 0.3) : accent;

  return {
    // --- Chrome y superficies ---
    chrome: bg,
    contrast: mix(bg, fg, 0.06),
    fg,
    fgstrong: mix(fg, def.dark ? "#FFFFFF" : "#000000", 0.55),
    // El factor depende del tema: en CLARO, acercar el texto al fondo lo aclara y le quita contraste
    // (Solarized Light se quedaba en 3,7:1 para el texto secundario). En oscuro hace falta más
    // separación para que se note que es secundario.
    fgdim: mix(fg, bg, def.dark ? 0.22 : 0.12),
    muted: mix(fg, bg, def.dark ? 0.15 : 0.08),
    sep: hacia(0.16),
    statusborder: hacia(0.2),
    field: hacia(0.08),
    border: hacia(0.18),
    borderstrong: hacia(0.3),
    focus: accent,

    // --- Interacción ---
    hover: hacia(0.1),
    pressed: hacia(0.16),
    rowhover: mix(editor, fg, 0.06),
    treesel: mix(bg, accent, 0.35),
    listsel: mix(bg, accent, 0.28),
    accent,
    link: accent,
    btn: hacia(0.08),
    btnprimary,
    onaccent: sobre(btnprimary),

    // --- Pestañas y tool windows ---
    tabsbg: bg,
    tabactive: hacia(0.12),
    twactive: hacia(0.06),
    twtabsel: hacia(0.14),
    setab: hacia(0.08),
    sehead: hacia(0.12),

    // --- Editor ---
    editor,
    fgeditor: fg,
    caret: fg,
    caretrow: mix(editor, fg, 0.05),
    gutter: mix(editor, bg, 0.55),
    lineno: mix(fg, editor, def.dark ? 0.3 : 0.2),
    linenocur: fg,
    sel: mix(editor, accent, 0.38),

    // --- Rejilla de datos ---
    grid: mix(editor, fg, 0.09),
    th: hacia(0.1),
    thsep: hacia(0.2),

    // --- Sintaxis ---
    kw,
    str,
    num,
    comment,
    fn,
    const: cst,

    // --- Notificaciones ---
    notif: hacia(0.1),
    notiffg: fg,
  };
}

// ---------------------------------------------------------------------------------------------
// El catálogo
// ---------------------------------------------------------------------------------------------

export const PALETTES: readonly PaletteDef[] = [
  {
    id: "darcula",
    label: "Darcula",
    base: "darcula",
    dark: true,
    // R98: FIEL — es el tema de fábrica (R9) tal cual. Antes se DERIVABA de estas anclas y el
    // resultado no era el Darcula de fábrica: con la app recién instalada ninguna tarjeta salía activa.
    fiel: true,
    anclas: {
      bg: "#3C3F41", editor: "#2B2B2B", fg: "#BBBBBB", accent: "#4A88C7",
      kw: "#CC7832", str: "#6A8759", num: "#6897BB", comment: "#808080",
      fn: "#FFC66D", const: "#9876AA",
    },
  },
  {
    id: "islands-dark",
    label: "Islands Dark",
    base: "darcula",
    dark: true,
    // El tema que el usuario tiene puesto en DataGrip: chrome casi negro y editor un punto más claro.
    anclas: {
      bg: "#1E1F22", editor: "#2B2D30", fg: "#CED0D6", accent: "#4E9BE8",
      kw: "#CF8E6D", str: "#6AAB73", num: "#2AACB8", comment: "#7A7E85",
      fn: "#56A8F5", const: "#C77DBB",
    },
  },
  {
    id: "one-dark",
    label: "One Dark",
    base: "darcula",
    dark: true,
    anclas: {
      bg: "#21252B", editor: "#282C34", fg: "#ABB2BF", accent: "#61AFEF",
      kw: "#C678DD", str: "#98C379", num: "#D19A66", comment: "#5C6370",
      fn: "#61AFEF", const: "#E5C07B",
    },
  },
  {
    id: "monokai",
    label: "Monokai",
    base: "darcula",
    dark: true,
    anclas: {
      bg: "#1F201B", editor: "#272822", fg: "#F8F8F2", accent: "#A6E22E",
      kw: "#F92672", str: "#E6DB74", num: "#AE81FF", comment: "#75715E",
      fn: "#66D9EF", const: "#AE81FF",
    },
  },
  {
    id: "nord",
    label: "Nord",
    base: "darcula",
    dark: true,
    anclas: {
      bg: "#2E3440", editor: "#2E3440", fg: "#D8DEE9", accent: "#88C0D0",
      kw: "#81A1C1", str: "#A3BE8C", num: "#B48EAD", comment: "#616E88",
      fn: "#88C0D0", const: "#B48EAD",
    },
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    base: "darcula",
    dark: true,
    anclas: {
      bg: "#1A1B26", editor: "#1A1B26", fg: "#C0CAF5", accent: "#7AA2F7",
      kw: "#BB9AF7", str: "#9ECE6A", num: "#FF9E64", comment: "#565F89",
      fn: "#7AA2F7", const: "#E0AF68",
    },
  },
  {
    id: "solarized-dark",
    label: "Solarized Dark",
    base: "darcula",
    dark: true,
    anclas: {
      bg: "#002B36", editor: "#002B36", fg: "#93A1A1", accent: "#268BD2",
      kw: "#859900", str: "#2AA198", num: "#D33682", comment: "#586E75",
      fn: "#268BD2", const: "#B58900",
    },
  },
  {
    id: "github-dark",
    label: "GitHub Dark",
    base: "darcula",
    dark: true,
    anclas: {
      bg: "#0D1117", editor: "#0D1117", fg: "#C9D1D9", accent: "#58A6FF",
      kw: "#FF7B72", str: "#A5D6FF", num: "#79C0FF", comment: "#8B949E",
      fn: "#D2A8FF", const: "#FFA657",
    },
  },
  {
    id: "solarized-light",
    label: "Solarized Light",
    base: "newlight",
    dark: false,
    // Los tonos oficiales de Solarized son para su fondo oscuro; sobre crema el verde oliva daba
    // 2,97:1. Se oscurecen hasta cumplir 3:1 para código sin salirse de la familia de la paleta.
    anclas: {
      bg: "#FDF6E3", editor: "#FDF6E3", fg: "#586E75", accent: "#1F6FA8",
      kw: "#6B7A00", str: "#0F7A72", num: "#A6256B", comment: "#8A9698",
      fn: "#1F6FA8", const: "#8A6700",
    },
  },
  {
    id: "github-light",
    label: "GitHub Light",
    base: "newlight",
    dark: false,
    anclas: {
      bg: "#FFFFFF", editor: "#FFFFFF", fg: "#24292F", accent: "#0969DA",
      kw: "#CF222E", str: "#0A3069", num: "#0550AE", comment: "#6E7781",
      fn: "#8250DF", const: "#953800",
    },
  },
  // ---------------------------------------------------------------------------------------------
  // R98 (T1, 2026-10-22): catálogo ampliado. Colores oficiales de cada tema; donde el oficial no
  // llegaba al contraste mínimo de `palettes.test.ts` (sobre todo en los CLAROS, pensados para
  // pantallas con más brillo) se oscureció dentro de la misma familia y se anota.
  // ---------------------------------------------------------------------------------------------
  {
    id: "newdark",
    label: "New UI Dark",
    base: "newdark",
    dark: true,
    fiel: true,
    anclas: {
      bg: "#2B2D30", editor: "#1E1F22", fg: "#DFE1E5", accent: "#3574F0",
      kw: "#CF8E6D", str: "#6AAB73", num: "#2AACB8", comment: "#7A7E85",
      fn: "#56A8F5", const: "#C77DBB",
    },
  },
  {
    id: "dracula",
    label: "Dracula",
    base: "darcula",
    dark: true,
    anclas: {
      bg: "#21222C", editor: "#282A36", fg: "#F8F8F2", accent: "#BD93F9",
      kw: "#FF79C6", str: "#F1FA8C", num: "#BD93F9", comment: "#6272A4",
      fn: "#50FA7B", const: "#8BE9FD",
    },
  },
  {
    id: "catppuccin-mocha",
    label: "Catppuccin Mocha",
    base: "darcula",
    dark: true,
    anclas: {
      bg: "#181825", editor: "#1E1E2E", fg: "#CDD6F4", accent: "#89B4FA",
      kw: "#CBA6F7", str: "#A6E3A1", num: "#FAB387", comment: "#7F849C",
      fn: "#89B4FA", const: "#F9E2AF",
    },
  },
  {
    id: "catppuccin-macchiato",
    label: "Catppuccin Macchiato",
    base: "darcula",
    dark: true,
    anclas: {
      bg: "#1E2030", editor: "#24273A", fg: "#CAD3F5", accent: "#8AADF4",
      kw: "#C6A0F6", str: "#A6DA95", num: "#F5A97F", comment: "#8087A2",
      fn: "#8AADF4", const: "#EED49F",
    },
  },
  {
    id: "gruvbox-dark",
    label: "Gruvbox Dark",
    base: "darcula",
    dark: true,
    anclas: {
      bg: "#1D2021", editor: "#282828", fg: "#EBDBB2", accent: "#83A598",
      kw: "#FB4934", str: "#B8BB26", num: "#D3869B", comment: "#928374",
      fn: "#FABD2F", const: "#8EC07C",
    },
  },
  {
    id: "rose-pine",
    label: "Rosé Pine",
    base: "darcula",
    dark: true,
    // La keyword oficial es «pine» (#31748F), que sobre la base da menos de 3:1: se usa «love».
    anclas: {
      bg: "#191724", editor: "#1F1D2E", fg: "#E0DEF4", accent: "#C4A7E7",
      kw: "#EB6F92", str: "#F6C177", num: "#EBBCBA", comment: "#6E6A86",
      fn: "#9CCFD8", const: "#C4A7E7",
    },
  },
  {
    id: "everforest-dark",
    label: "Everforest Dark",
    base: "darcula",
    dark: true,
    anclas: {
      bg: "#272E33", editor: "#2D353B", fg: "#D3C6AA", accent: "#A7C080",
      kw: "#E67E80", str: "#A7C080", num: "#D699B6", comment: "#859289",
      fn: "#83C092", const: "#DBBC7F",
    },
  },
  {
    id: "kanagawa",
    label: "Kanagawa",
    base: "darcula",
    dark: true,
    anclas: {
      bg: "#16161D", editor: "#1F1F28", fg: "#DCD7BA", accent: "#7E9CD8",
      kw: "#957FB8", str: "#98BB6C", num: "#D27E99", comment: "#727169",
      fn: "#7E9CD8", const: "#FFA066",
    },
  },
  {
    id: "ayu-dark",
    label: "Ayu Dark",
    base: "darcula",
    dark: true,
    anclas: {
      bg: "#0B0E14", editor: "#0D1017", fg: "#BFBDB6", accent: "#E6B450",
      kw: "#FF8F40", str: "#AAD94C", num: "#D2A6FF", comment: "#636A72",
      fn: "#FFB454", const: "#D2A6FF",
    },
  },
  {
    id: "ayu-mirage",
    label: "Ayu Mirage",
    base: "darcula",
    dark: true,
    anclas: {
      bg: "#1F2430", editor: "#242936", fg: "#CCCAC2", accent: "#FFCC66",
      kw: "#FFAD66", str: "#D5FF80", num: "#DFBFFF", comment: "#6C7A8B",
      fn: "#FFD173", const: "#DFBFFF",
    },
  },
  {
    id: "material-palenight",
    label: "Material Palenight",
    base: "darcula",
    dark: true,
    anclas: {
      bg: "#202331", editor: "#292D3E", fg: "#A6ACCD", accent: "#82AAFF",
      kw: "#C792EA", str: "#C3E88D", num: "#F78C6C", comment: "#676E95",
      fn: "#82AAFF", const: "#FFCB6B",
    },
  },
  {
    id: "material-oceanic",
    label: "Material Oceanic",
    base: "darcula",
    dark: true,
    anclas: {
      bg: "#1E282D", editor: "#263238", fg: "#B0BEC5", accent: "#80CBC4",
      kw: "#C792EA", str: "#C3E88D", num: "#F78C6C", comment: "#546E7A",
      fn: "#82AAFF", const: "#FFCB6B",
    },
  },
  {
    id: "night-owl",
    label: "Night Owl",
    base: "darcula",
    dark: true,
    anclas: {
      bg: "#010E1A", editor: "#011627", fg: "#D6DEEB", accent: "#7FDBCA",
      kw: "#C792EA", str: "#ECC48D", num: "#F78C6C", comment: "#637777",
      fn: "#82AAFF", const: "#ADDB67",
    },
  },
  {
    id: "alto-contraste-oscuro",
    label: "Alto contraste oscuro",
    base: "darcula",
    dark: true,
    // Para pantallas con reflejo o vista cansada: negro puro y colores saturados (≥ 7:1).
    anclas: {
      bg: "#000000", editor: "#000000", fg: "#FFFFFF", accent: "#3FA9FF",
      kw: "#FF9E3D", str: "#7EE787", num: "#79C0FF", comment: "#B0B0B0",
      fn: "#FFD866", const: "#E5A3FF",
    },
  },
  {
    id: "newlight",
    label: "New UI Light",
    base: "newlight",
    dark: false,
    fiel: true,
    anclas: {
      bg: "#F7F8FA", editor: "#FFFFFF", fg: "#27282E", accent: "#3574F0",
      kw: "#0033B3", str: "#067D17", num: "#1750EB", comment: "#8C8C8C",
      fn: "#00627A", const: "#871094",
    },
  },
  {
    id: "catppuccin-latte",
    label: "Catppuccin Latte",
    base: "newlight",
    dark: false,
    // Cadena, número y constante oficiales (#40A02B, #FE640B, #DF8E1D) dan < 3:1 sobre la base:
    // se oscurecen dentro de su tono.
    anclas: {
      bg: "#E6E9EF", editor: "#EFF1F5", fg: "#4C4F69", accent: "#1E66F5",
      kw: "#8839EF", str: "#2F7A1F", num: "#C24E07", comment: "#8C8FA1",
      fn: "#1E66F5", const: "#9A6312",
    },
  },
  {
    id: "gruvbox-light",
    label: "Gruvbox Light",
    base: "newlight",
    dark: false,
    anclas: {
      bg: "#F2E5BC", editor: "#FBF1C7", fg: "#3C3836", accent: "#076678",
      kw: "#9D0006", str: "#79740E", num: "#8F3F71", comment: "#928374",
      fn: "#9A5F0C", const: "#427B58",
    },
  },
  {
    id: "rose-pine-dawn",
    label: "Rosé Pine Dawn",
    base: "newlight",
    dark: false,
    // «gold» (#EA9D34) y «rose» (#D7827E) se quedan en 2:1 sobre el crema: oscurecidos.
    anclas: {
      bg: "#F2E9E1", editor: "#FAF4ED", fg: "#575279", accent: "#907AA9",
      kw: "#B4637A", str: "#9A6209", num: "#A9564F", comment: "#9893A5",
      fn: "#286983", const: "#3E7C86",
    },
  },
  {
    id: "ayu-light",
    label: "Ayu Light",
    base: "newlight",
    dark: false,
    // Ayu Light es de bajo contraste por diseño; se oscurecen keyword, cadena y función.
    anclas: {
      bg: "#F3F4F5", editor: "#FCFCFC", fg: "#5C6166", accent: "#E59400",
      kw: "#C2560A", str: "#5A7A00", num: "#8E5FC2", comment: "#9A9DA0",
      fn: "#A06A08", const: "#2E8F6F",
    },
  },
  {
    id: "everforest-light",
    label: "Everforest Light",
    base: "newlight",
    dark: false,
    anclas: {
      bg: "#EFEBD4", editor: "#FDF6E3", fg: "#5C6A72", accent: "#8DA101",
      kw: "#D13E3B", str: "#677700", num: "#B44E96", comment: "#939F91",
      fn: "#2A8562", const: "#A87A00",
    },
  },
  {
    id: "alto-contraste-claro",
    label: "Alto contraste claro",
    base: "newlight",
    dark: false,
    anclas: {
      bg: "#FFFFFF", editor: "#FFFFFF", fg: "#000000", accent: "#0050C8",
      kw: "#0000C0", str: "#006100", num: "#A00050", comment: "#5A5A5A",
      fn: "#6A00A8", const: "#8A4B00",
    },
  },
];

export const PALETTE_IDS = PALETTES.map((p) => p.id);

/**
 * R98 (T1): los 86 colores EFECTIVOS de un tema (base + lo que la paleta deriva). Es lo que pinta la
 * miniatura de cada tarjeta de la galería: así la tarjeta se ve exactamente como quedará la app.
 */
export function tokensResueltosDePaleta(def: PaletteDef): Record<TokenKey, string> {
  return { ...THEMES[def.base].v, ...tokensDePaleta(def) } as Record<TokenKey, string>;
}

export function paletaPorId(id: string): PaletteDef | undefined {
  return PALETTES.find((p) => p.id === id);
}

/**
 * Aplica una paleta: fija su tema base y REEMPLAZA los overrides con los derivados de la paleta.
 *
 * ¿Por qué reemplaza y no mezcla? Porque cambiar de paleta es empezar de nuevo: si se mezclaran,
 * los retoques de la paleta anterior se quedarían encima de la nueva y el resultado no sería la
 * paleta que el usuario eligió. Los retoques manuales posteriores SÍ se acumulan (los hace
 * `withToken` sobre este estado).
 */
export function aplicarPaleta(state: ThemeState, id: string): ThemeState {
  const paleta = paletaPorId(id);
  if (!paleta) return state;
  return {
    ...state,
    base: paleta.base,
    over: tokensDePaleta(paleta) as Record<string, string>,
    density: state.density,
    tint: state.tint,
    palette: paleta.id,
  };
}

/** ¿El estado actual es exactamente esta paleta (sin retoques)? Sirve para marcar la tarjeta. */
export function esPaletaActiva(state: ThemeState, id: string): boolean {
  const paleta = paletaPorId(id);
  if (!paleta) return false;
  // R98: una paleta FIEL es su tema base sin cambios; también lo es el estado sin paleta anotada
  // (la apariencia de fábrica, o un estado anterior a las paletas), si su base coincide.
  if (paleta.fiel) {
    return (state.palette === id || state.palette === undefined) &&
      state.base === paleta.base &&
      Object.keys(state.over).length === 0;
  }
  if (state.palette !== id || state.base !== paleta.base) return false;
  const derivados = tokensDePaleta(paleta);
  const over = state.over as Record<string, string>;
  const claves = Object.keys(derivados) as TokenKey[];
  /*
    Se comparan los colores EFECTIVOS (override o, si no hay, el del tema base), no los overrides
    crudos: al leer el estado guardado, `parseThemeState` descarta los overrides que coinciden con el
    tema base, así que tras reiniciar la app la paleta perdía esas claves y salía «retocada a mano»
    sin que nadie la hubiera tocado (lo destapó la vista previa de R98).
  */
  const base = THEMES[paleta.base].v;
  return claves.every((k) => (over[k] ?? base[k]) === derivados[k]) &&
    Object.keys(over).filter((k) => !(k in derivados)).length === 0;
}
