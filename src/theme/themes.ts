/**
 * Los tres temas de la fase 7 (R9, R33; D3 = el claro entra). Capa 1 de R33: valores en bruto.
 *
 * Origen de cada hex: repo JetBrains/intellij-community (Apache-2.0), rama master —
 *   Darcula:      platform/platform-resources/src/themes/darcula.theme.json + esquema Darcula
 *   New UI Dark:  .../themes/expUI/expUI_dark.theme.json + expUI_darkScheme.xml
 *   New UI Light: .../themes/expUI/expUI_light.theme.json + expUI_lightScheme.xml
 * Detalle, trampas del XML y contraste medido: .planning/research/themes-jetbrains.md.
 *
 * `verified` lista los tokens leídos LITERALMENTE de esos archivos. Los marcados `// derivado` son un
 * gris/azul de la paleta con nombre que encaja con la superficie, o un valor heredado del tema padre que
 * no aparece en el archivo: hay que contrastarlos con DataGrip real antes de llamar fiel a un tema.
 * Los colores de entorno (env*) no son de JetBrains: son elección de DataDB.
 *
 * Copia generada una vez desde design/concept/themes.json; a partir de aquí ESTE archivo es la fuente.
 * Si se cambia un valor del tema por defecto, regenerar src/theme/tokens.css (`npm run gen:tokens`):
 * themes.test.ts falla si no coinciden.
 */
import type { TokenKey } from "./tokens";
import { ICON_TOKEN_KEYS, iconTokenValues } from "./icon-palette";

export type ThemeId = "darcula" | "newdark" | "newlight";

export interface ThemeDef {
  id: ThemeId;
  label: string;
  /** Activa la variante `dark:` de Tailwind (clase `.dark` en <html>). */
  dark: boolean;
  arc: number;
  verified: ReadonlySet<TokenKey>;
  v: Record<TokenKey, string>;
}

export const THEMES: Record<ThemeId, ThemeDef> = {
  darcula: {
    id: "darcula",
    label: "Darcula (clásico)",
    dark: true,
    /** Component.arc del tema (px); alimenta `--radius` de shadcn. */
    arc: 5,
    // Darcula clásico: Component.arc 5 (Button.arc 6).
    verified: new Set<TokenKey>(["accent", "border", "btn", "btnprimary", "caret", "caretrow", "chrome", "comment", "const", "contrast", "dangerbg", "diffmod", "editor", "err", "fail", "enginepg", "enginemysql", "enginemongo", "enginemssql", "fg", "fgeditor", "field", "fn", "focus", "grid", "gutter", "hash", "hover", "kw", "lineno", "linenocur", "link", "listsel", "muted", "notif", "notiffg", "num", "pressed", "rowhover", "sehead", "sel", "sep", "setab", "statusborder", "str", "tabactive", "tabsbg", "th", "thsep", "twactive", "twtabsel", "warn", "warnbg", ...ICON_TOKEN_KEYS]),
    v: {
    // Iconos (fase 8): literales de los SVG de expui; Darcula usa los oscuros (D2).
    ...iconTokenValues(true),
    chrome: "#3C3F41",
    contrast: "#323232",
    fg: "#BBBBBB",
    fgstrong: "#FFFFFF", // derivado
    fgdim: "#B6B9BA", // derivado: antes #A4A7A9, daba 3,8:1 sobre campos (#45494A); ahora >=4,6:1
    muted: "#787878",
    sep: "#515151",
    statusborder: "#464646",
    field: "#45494A",
    border: "#646464",
    borderstrong: "#5D6163", // derivado
    focus: "#466D94",
    hover: "#4C5052",
    pressed: "#5C6164",
    rowhover: "#464A4D",
    treesel: "#0D293E", // derivado
    listsel: "#113A5C",
    accent: "#4A88C7",
    link: "#589DF6",
    btn: "#4C5052",
    btnprimary: "#365880",
    onaccent: "#FFFFFF", // derivado
    twactive: "#3B4754",
    twtabsel: "#313B45",
    tabsbg: "#3C3F41",
    tabactive: "#4E5254",
    th: "#45484A",
    thsep: "#333638",
    grid: "#4F5152",
    sel: "#214283",
    diffmod: "#374752",
    editor: "#2B2B2B",
    fgeditor: "#A9B7C6",
    gutter: "#313335",
    lineno: "#606366",
    linenocur: "#A4A3A3",
    caret: "#BBBBBB",
    caretrow: "#323232",
    stmtoutline: "#356F42", // medido en captura de DataGrip (2026-10-21); no viene de un archivo de tema
    kw: "#CC7832",
    str: "#6A8759",
    num: "#6897BB",
    comment: "#808080",
    fn: "#FFC66D",
    const: "#9876AA",
    // Columna resuelta: el morado de «campo» de Darcula. Es el MISMO valor que `const` a propósito
    // (DataGrip pinta ambos con esa familia), pero con clave propia para poder separarlos sin tocar
    // el lexer.
    col: "#9876AA",
    err: "#BC3F3C",
    errfg: "#F3A7A7", // derivado: texto de error legible (>=4,5:1 sobre chrome, campo y su tinte); fail es color de barra de progreso
    warn: "#BE9117",
    warnbg: "#52503A",
    warnfg: "#F2C55C", // derivado: Yellow7 de la New UI; >=5,3:1 sobre chrome, campo y tinte de aviso
    dangerbg: "#593D41",
    dangerfg: "#F0C8C6", // derivado
    dangerborder: "#7B5156", // derivado
    okfg: "#5FB95F", // derivado
    okbg: "#2A3D2C", // derivado
    live: "#499C54", // derivado
    fail: "#E74848",
    enginepg: "#5B9BD5", // marca: PostgreSQL azul acero, legible sobre chrome #3C3F41
    enginemysql: "#E48E00", // marca: MySQL naranja-delfín
    enginemssql: "#CC4B4B", // marca: SQL Server rojo (aclarado para el tema oscuro)
    enginemongo: "#47A248", // marca: MongoDB verde hoja
    ico: "#9AA7B4", // derivado
    icodb: "#8FB4D8", // derivado
    icotbl: "#7AA7D6", // derivado
    icokey: "#E0B550", // derivado
    icocol: "#7A8186", // derivado
    sehead: "#45494A",
    setab: "#555A5E",
    notif: "#4E5052",
    notiffg: "#BBBBBB",
    notiflink: "#589DF6", // derivado
    hash: "#505355",
    envloc: "#629755", // derivado
    envprod: "#C75450", // derivado
    envstg: "#D9A343", // derivado
    },
  },
  newdark: {
    id: "newdark",
    label: "New UI Dark",
    dark: true,
    /** Component.arc del tema (px); alimenta `--radius` de shadcn. */
    arc: 8,
    // New UI: Component.arc y Button.arc 8.
    verified: new Set<TokenKey>(["border", "btn", "btnprimary", "caret", "caretrow", "chrome", "comment", "const", "contrast", "dangerbg", "editor", "err", "fail", "enginepg", "enginemysql", "enginemongo", "enginemssql", "fg", "fgdim", "fgeditor", "fgstrong", "field", "fn", "focus", "grid", "hash", "hover", "kw", "lineno", "linenocur", "link", "listsel", "live", "muted", "notif", "notiffg", "num", "okfg", "onaccent", "pressed", "rowhover", "sel", "sep", "setab", "str", "tabactive", "tabsbg", "thsep", "treesel", "warn", ...ICON_TOKEN_KEYS]),
    v: {
    // Iconos (fase 8): literales de los SVG de expui; Darcula usa los oscuros (D2).
    ...iconTokenValues(true),
    chrome: "#2B2D30",
    contrast: "#1E1F22",
    fg: "#DFE1E5",
    fgstrong: "#FFFFFF",
    fgdim: "#9DA0A8",
    muted: "#6F737A",
    sep: "#393B40",
    statusborder: "#393B40", // derivado
    field: "#2B2D30",
    border: "#4E5157",
    borderstrong: "#5A5D63", // derivado
    focus: "#3574F0",
    hover: "#393B40",
    pressed: "#43454A",
    rowhover: "#393B40",
    treesel: "#2E436E",
    listsel: "#2E436E",
    accent: "#3574F0", // derivado
    link: "#6B9BFA",
    btn: "#2B2D30",
    btnprimary: "#3574F0",
    onaccent: "#FFFFFF",
    twactive: "#2B2D30", // derivado
    twtabsel: "#393B40", // derivado
    tabsbg: "#1E1F22",
    tabactive: "#1E1F22",
    th: "#2B2D30", // derivado
    thsep: "#1E1F22",
    grid: "#1E1F22",
    sel: "#2E436E",
    diffmod: "#25324D", // derivado
    editor: "#1E1F22",
    fgeditor: "#BCBEC4",
    gutter: "#1E1F22", // derivado
    lineno: "#4B5059",
    linenocur: "#A1A3AB",
    caret: "#CED0D6",
    caretrow: "#26282E",
    stmtoutline: "#356F42", // medido en captura de DataGrip New UI oscuro (2026-10-21)
    kw: "#CF8E6D",
    str: "#6AAB73",
    num: "#2AACB8",
    comment: "#7A7E85",
    fn: "#56A8F5",
    const: "#C77DBB",
    col: "#C77DBB",
    err: "#FA6675",
    errfg: "#EB938D", // derivado: Red9 de la paleta New UI, legible como texto (fail es ProgressBar.failedColor)
    warn: "#F2C55C",
    warnbg: "#3D3223", // derivado
    warnfg: "#F2C55C", // derivado: texto legible de advertencia (warn es color de subrayado; en claro, Yellow1 de la paleta)
    dangerbg: "#402929",
    dangerfg: "#F7CCC6", // derivado
    dangerborder: "#5E3838", // derivado
    okfg: "#73BD79",
    okbg: "#253627", // derivado
    live: "#57965C",
    fail: "#BD5757",
    enginepg: "#3D7EBB", // marca oscurecida para fondo claro
    enginemysql: "#B36B00",
    enginemssql: "#B23A3A",
    enginemongo: "#3F8F3F",
    ico: "#9DA0A8", // derivado
    icodb: "#83ACFC", // derivado
    icotbl: "#6B9BFA", // derivado
    icokey: "#F2C55C", // derivado
    icocol: "#6F737A", // derivado
    sehead: "#2B2D30", // derivado
    setab: "#2E436E",
    notif: "#393B40",
    notiffg: "#F0F1F2",
    notiflink: "#6B9BFA", // derivado
    hash: "#4E5157",
    envloc: "#5FAD65", // derivado
    envprod: "#DB5C5C", // derivado
    envstg: "#F2C55C", // derivado
    },
  },
  newlight: {
    id: "newlight",
    label: "New UI Light",
    dark: false,
    /** Component.arc del tema (px); alimenta `--radius` de shadcn. */
    arc: 8,
    // New UI: Component.arc y Button.arc 8.
    verified: new Set<TokenKey>(["accent", "border", "btnprimary", "caretrow", "chrome", "comment", "const", "contrast", "dangerbg", "editor", "fail", "enginepg", "enginemysql", "enginemongo", "enginemssql", "fgeditor", "fgstrong", "field", "fn", "focus", "grid", "gutter", "hover", "kw", "lineno", "linenocur", "link", "listsel", "live", "muted", "notif", "notiffg", "notiflink", "num", "okfg", "onaccent", "rowhover", "sel", "sep", "setab", "str", "tabactive", "tabsbg", "th", "thsep", "treesel", "warn", "warnbg", ...ICON_TOKEN_KEYS]),
    v: {
    // Iconos (fase 8): literales de los SVG de expui; Darcula usa los oscuros (D2).
    ...iconTokenValues(false),
    chrome: "#F7F8FA",
    contrast: "#EBECF0",
    fg: "#27282E", // derivado
    fgstrong: "#000000",
    fgdim: "#6C707E", // derivado
    muted: "#818594",
    sep: "#EBECF0",
    statusborder: "#EBECF0", // derivado
    field: "#FFFFFF",
    border: "#C9CCD6",
    borderstrong: "#A8ADBD", // derivado
    focus: "#3574F0",
    hover: "#EDF3FF",
    pressed: "#DFE1E5", // derivado
    rowhover: "#EDF3FF",
    treesel: "#D4E2FF",
    listsel: "#D4E2FF",
    accent: "#3574F0",
    link: "#315FBD",
    btn: "#FFFFFF", // derivado
    btnprimary: "#3574F0",
    onaccent: "#FFFFFF",
    twactive: "#F7F8FA", // derivado
    twtabsel: "#DFE1E5", // derivado
    tabsbg: "#FFFFFF",
    tabactive: "#FFFFFF",
    th: "#F7F8FA",
    thsep: "#EBECF0",
    grid: "#EBECF0",
    sel: "#A6D2FF",
    diffmod: "#D4E2FF", // derivado
    editor: "#FFFFFF",
    fgeditor: "#080808",
    gutter: "#FFFFFF",
    lineno: "#AEB3C2",
    linenocur: "#767A8A",
    caret: "#000000", // derivado
    caretrow: "#F5F8FE",
    stmtoutline: "#7DB88A", // derivado: el verde medido, aclarado para fondo claro
    kw: "#0033B3",
    str: "#067D17",
    num: "#1750EB",
    comment: "#8C8C8C",
    fn: "#00627A",
    const: "#871094",
    col: "#871094",
    err: "#DB3B4B", // derivado
    errfg: "#AD2B38", // derivado: Red1 de la paleta New UI Light, legible como texto
    warn: "#F2BF57",
    warnbg: "#FCF4D4",
    warnfg: "#835203", // derivado: Yellow1 oscurecido hasta >=4,6:1 sobre su tinte (Yellow1 #A46704 daba 4,0)
    dangerbg: "#FFE8E8",
    dangerfg: "#AD2B38", // derivado
    dangerborder: "#F2B6BB", // derivado
    okfg: "#067D17",
    okbg: "#E3F7E7", // derivado
    live: "#55A76A",
    fail: "#E55765",
    enginepg: "#6FB0EA",
    enginemysql: "#F0A030",
    enginemssql: "#E06060",
    enginemongo: "#2E8B57",
    ico: "#6C707E", // derivado
    icodb: "#3369D6", // derivado
    icotbl: "#3574F0", // derivado
    icokey: "#DF9303", // derivado
    icocol: "#818594", // derivado
    sehead: "#F7F8FA", // derivado
    setab: "#D4E2FF",
    notif: "#27282E",
    notiffg: "#F7F8FA",
    notiflink: "#88ADF7",
    hash: "#C9CCD6", // derivado
    envloc: "#208A3C", // derivado
    envprod: "#DB3B4B", // derivado
    envstg: "#DF9303", // derivado
    },
  },
};

export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

/** R9: Darcula es el tema por defecto. (La densidad por defecto es la New UI: ver density.ts, D1.) */
export const DEFAULT_THEME: ThemeId = "darcula";
