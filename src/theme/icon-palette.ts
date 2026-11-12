/**
 * Colores de los iconos de IntelliJ como tokens de la paleta (fase 8, D3 de R34: los iconos siguen la paleta editable).
 *
 * Cada icono de `expui/` viene en dos SVG (claro y `_dark`) con el mismo dibujo y colores distintos. El importador
 * (src/icons/intellij/import-lib.ts) guarda una sola geometría y cambia cada color por `var(--gdb-<token>)` según el
 * PAR (claro, oscuro) que ocupa ese color. Los valores de abajo son los LITERALES de JetBrains: los temas oscuros
 * (Darcula y New UI Dark) toman `dark` y New UI Light toma `light` (D2: un solo set, el de la New UI).
 *
 * Medido sobre `expui/` @151fb580c8 (ver .planning/phases/phase-8/PLAN.md, «Diseño de D3»). Los `*Aliases` son tonos
 * casi iguales que se NORMALIZAN al rol; el icono deja de ser idéntico al de JetBrains en ese tono y el manifiesto lo
 * registra. Solo se añaden alias medidos en iconos realmente importados, nunca por suposición.
 */
export interface IconColorRole {
  token: string;
  label: string;
  light: string;
  dark: string;
  lightAliases?: readonly string[];
  darkAliases?: readonly string[];
}

export const ICON_COLOR_ROLES = [
  { token: "icstroke", label: "Iconos: trazo", light: "#6C707E", dark: "#CED0D6" },
  { token: "icfill", label: "Iconos: relleno", light: "#EBECF0", dark: "#43454A" },
  // #969AAB: chevronLeft (2021) usa un gris algo más claro que chevronRight con el MISMO oscuro; se unifica.
  { token: "icsecondary", label: "Iconos: trazo secundario", light: "#818594", dark: "#B4B8BF", lightAliases: ["#969AAB"] },
  // closeSmall: en el tema oscuro JetBrains lo OSCURECE (#6F737A) en vez de aclararlo; por eso es un rol propio y no
  // un alias de icsecondary (normalizarlo lo habría vuelto mucho más brillante).
  { token: "icmuted", label: "Iconos: atenuado (cerrar)", light: "#A8ADBD", dark: "#6F737A" },
  { token: "icgreen", label: "Iconos: verde (ejecutar, correcto)", light: "#208A3C", dark: "#57965C", lightAliases: ["#55A76A"] },
  { token: "icgreenbg", label: "Iconos: fondo verde", light: "#F2FCF3", dark: "#253627" },
  { token: "icred", label: "Iconos: rojo (parar, error)", light: "#DB3B4B", dark: "#DB5C5C", lightAliases: ["#E55765"] },
  { token: "icredbg", label: "Iconos: fondo rojo", light: "#FFF7F7", dark: "#402929", darkAliases: ["#5E3838"] },
  { token: "icyellow", label: "Iconos: amarillo (aviso, favorito)", light: "#FFAF0F", dark: "#F2C55C" },
  { token: "icyellowfg", label: "Iconos: símbolo sobre amarillo", light: "#FFFFFF", dark: "#5E4D33" },
  { token: "icbadgefg", label: "Iconos: símbolo sobre verde/rojo", light: "#FFFFFF", dark: "#FFFFFF" },
  { token: "icblue", label: "Iconos: azul", light: "#3574F0", dark: "#548AF7", lightAliases: ["#4682FA"] },
  { token: "icpurple", label: "Iconos: violeta", light: "#834DF0", dark: "#A571E6" },
] as const satisfies readonly IconColorRole[];

export type IconTokenKey = (typeof ICON_COLOR_ROLES)[number]["token"];

/** Valores por defecto de los tokens de icono para un tema claro u oscuro. */
export function iconTokenValues(dark: boolean): Record<IconTokenKey, string> {
  return Object.fromEntries(ICON_COLOR_ROLES.map((r) => [r.token, dark ? r.dark : r.light])) as Record<IconTokenKey, string>;
}

export const ICON_TOKEN_KEYS: readonly IconTokenKey[] = ICON_COLOR_ROLES.map((r) => r.token);
