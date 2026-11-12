/**
 * Catálogo de tokens semánticos de color (capa 2 de R33).
 *
 * Cada token se publica como variable CSS `--gdb-<clave>` y como utilidad de Tailwind
 * (`bg-gdb-<clave>`, `text-gdb-<clave>`…). Los nombres salen del concepto visual
 * (`design/concept/`), donde se validaron sobre las tres superficies; aquí llevan el prefijo
 * `gdb-` porque varios (`border`, `accent`, `muted`) chocan con los tokens de shadcn, que siguen
 * siendo la API de los componentes y se reasignan a estos en `globals.css` (T3).
 *
 * El orden y la agrupación son los del panel «Apariencia» (T10, R51).
 */
export const TOKEN_GROUPS = [
  { title: "Chrome", tokens: [
    { key: "chrome", label: "Fondo de paneles" },
    { key: "contrast", label: "Bordes de contraste" },
    { key: "fg", label: "Texto" },
    { key: "fgstrong", label: "Texto activo / seleccionado" },
    { key: "fgdim", label: "Texto e iconos atenuados" },
    { key: "muted", label: "Texto secundario" },
    { key: "sep", label: "Separadores" },
    { key: "statusborder", label: "Borde de la barra de estado" },
    { key: "field", label: "Campos de texto" },
    { key: "border", label: "Borde de componente" },
    { key: "borderstrong", label: "Borde marcado" },
    { key: "focus", label: "Anillo de foco" },
  ] },
  { title: "Interacción", tokens: [
    { key: "hover", label: "Hover" },
    { key: "pressed", label: "Pulsado" },
    { key: "rowhover", label: "Hover de fila" },
    { key: "treesel", label: "Selección en árbol" },
    { key: "listsel", label: "Selección en listas" },
    { key: "accent", label: "Acento (subrayado de pestaña)" },
    { key: "link", label: "Enlaces" },
    { key: "btn", label: "Botón" },
    { key: "btnprimary", label: "Botón primario" },
    { key: "onaccent", label: "Texto sobre acento" },
  ] },
  { title: "Pestañas y tool windows", tokens: [
    { key: "twactive", label: "Header de tool window" },
    { key: "twtabsel", label: "Pestaña de tool window activa" },
    { key: "tabsbg", label: "Tira de pestañas de editor" },
    { key: "tabactive", label: "Pestaña de editor activa" },
  ] },
  { title: "Grid", tokens: [
    { key: "th", label: "Cabecera de columnas" },
    { key: "thsep", label: "Separador de cabecera" },
    { key: "grid", label: "Rejilla" },
    { key: "sel", label: "Celdas seleccionadas" },
    { key: "diffmod", label: "Celda modificada" },
  ] },
  { title: "Editor", tokens: [
    { key: "editor", label: "Fondo del editor" },
    { key: "fgeditor", label: "Texto del editor" },
    { key: "gutter", label: "Gutter" },
    { key: "lineno", label: "Números de línea" },
    { key: "linenocur", label: "Número de la línea actual" },
    { key: "caret", label: "Cursor" },
    { key: "caretrow", label: "Fila del cursor" },
    { key: "stmtoutline", label: "Contorno de la sentencia actual" },
  ] },
  { title: "Sintaxis SQL", tokens: [
    { key: "kw", label: "Palabras clave" },
    { key: "str", label: "Cadenas" },
    { key: "num", label: "Números" },
    { key: "comment", label: "Comentarios" },
    { key: "fn", label: "Funciones" },
    { key: "const", label: "Constantes / booleanos" },
    // Columna de una tabla, en el color que DataGrip le da al campo resuelto. Va aparte de `const`
    // aunque en Darcula comparta tono: si mañana se quiere distinguir, se cambia aquí y no hay que
    // tocar el coloreado (que pide el token por su nombre, no por parecido).
    { key: "col", label: "Columnas" },
  ] },
  { title: "Estados", tokens: [
    { key: "err", label: "Error (subrayado)" },
    { key: "errfg", label: "Texto de error" },
    { key: "warn", label: "Advertencia" },
    { key: "warnbg", label: "Fondo de advertencia" },
    { key: "warnfg", label: "Texto de advertencia" },
    { key: "dangerbg", label: "Fondo de peligro (PROD)" },
    { key: "dangerfg", label: "Texto de peligro" },
    { key: "dangerborder", label: "Borde de peligro" },
    { key: "okfg", label: "Correcto" },
    { key: "okbg", label: "Fondo correcto" },
    { key: "live", label: "Conexión activa" },
    { key: "fail", label: "Fallo / cancelar" },
    // Fase 70 (T1): identidad de MOTOR. No son semánticos (no significan estado): identifican al
    // motor donde eso ayuda a reconocerlo de un vistazo — la lista del modal de conexiones.
    { key: "enginepg", label: "PostgreSQL" },
    { key: "enginemysql", label: "MySQL" },
    { key: "enginemssql", label: "SQL Server" },
    { key: "enginemongo", label: "MongoDB" },
  ] },
  { title: "Iconos", tokens: [
    { key: "ico", label: "Icono genérico" },
    { key: "icodb", label: "Base de datos" },
    { key: "icotbl", label: "Tabla" },
    { key: "icokey", label: "Clave" },
    { key: "icocol", label: "Columna" },
    // Fase 8 (R34, D3): colores de los iconos de IntelliJ; valores y origen en src/theme/icon-palette.ts.
    // Los ico* de arriba son del concepto y se retiran cuando el árbol use los iconos nuevos (T3).
    { key: "icstroke", label: "Iconos: trazo" },
    { key: "icfill", label: "Iconos: relleno" },
    { key: "icsecondary", label: "Iconos: trazo secundario" },
    { key: "icmuted", label: "Iconos: atenuado (cerrar)" },
    { key: "icgreen", label: "Iconos: verde (ejecutar, correcto)" },
    { key: "icgreenbg", label: "Iconos: fondo verde" },
    { key: "icred", label: "Iconos: rojo (parar, error)" },
    { key: "icredbg", label: "Iconos: fondo rojo" },
    { key: "icyellow", label: "Iconos: amarillo (aviso, favorito)" },
    { key: "icyellowfg", label: "Iconos: símbolo sobre amarillo" },
    { key: "icbadgefg", label: "Iconos: símbolo sobre verde/rojo" },
    { key: "icblue", label: "Iconos: azul" },
    { key: "icpurple", label: "Iconos: violeta" },
  ] },
  { title: "Búsqueda y avisos", tokens: [
    { key: "sehead", label: "Buscar en todo: cabecera" },
    { key: "setab", label: "Buscar en todo: pestaña activa" },
    { key: "notif", label: "Aviso (fondo)" },
    { key: "notiffg", label: "Aviso (texto)" },
    { key: "notiflink", label: "Aviso (enlaces)" },
    { key: "hash", label: "Guías del árbol" },
  ] },
  { title: "Entornos (colores del tinte)", tokens: [
    { key: "envloc", label: "Local / desarrollo" },
    { key: "envprod", label: "Producción" },
    { key: "envstg", label: "Staging / pruebas" },
  ] },
] as const;

export type TokenKey = (typeof TOKEN_GROUPS)[number]["tokens"][number]["key"];

/** Todas las claves (83), en el orden del catálogo. */
export const TOKEN_KEYS: readonly TokenKey[] = TOKEN_GROUPS.flatMap((g) => g.tokens.map((t) => t.key));

/** Nombre de la variable CSS de un token. */
export const cssVar = (k: TokenKey) => `--gdb-${k}` as const;
