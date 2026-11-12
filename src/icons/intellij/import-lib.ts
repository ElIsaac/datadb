/**
 * Lógica PURA del importador de iconos de IntelliJ (fase 8, T1; R34). Sin red ni disco: lo usa
 * scripts/import-intellij-icons.ts y lo prueban los tests con SVG reales.
 *
 * Qué hace con cada icono de `platform/icons/src/expui/` (New UI, D2):
 *   1. Exige la cabecera Apache 2.0 de JetBrains en la primera línea del SVG (regla de R34). Hay archivos del repo
 *      sin ella (p. ej. `toolwindows/toolWindowAskAI.svg`): se rechazan, no se "asume" la licencia del repo.
 *   2. Comprueba que la versión clara y la `_dark` son el MISMO dibujo, y solo cambian los colores. Tolera tres
 *      diferencias de formato medidas en el set: colores escritos por nombre (`white`), coordenadas que difieren menos
 *      de 0,01 px y un recorte 16×16 sin efecto que envuelve la versión oscura. Cualquier otra diferencia aborta.
 *   3. Sustituye cada color de la geometría clara por `var(--gdb-ic*)` según el par (claro, oscuro) que ocupa ese
 *      color en las dos versiones (D3: los iconos siguen la paleta). Un par desconocido aborta.
 *   4. Prefija los ids internos con el nombre del icono, para que dos iconos distintos no choquen en el DOM.
 *
 * Diseño y medición (718 de 792 pares del set son el mismo dibujo): .planning/phases/phase-8/PLAN.md, "Diseño de D3".
 */

import { ICON_COLOR_ROLES } from "@/theme/icon-palette";

/** Cabecera que exige R34. Ej.: `<!-- Copyright 2000-2023 JetBrains s.r.o. and contributors. Use of this source code is governed by the Apache 2.0 license. -->` */
// La redacción de 2021 añade «…license that can be found in the LICENSE file.»: también es Apache 2.0.
const APACHE_HEADER = /^<!--\s*(Copyright [^>]*JetBrains s\.r\.o\.[^>]*Apache 2\.0 license[^>]*?)\s*-->/;

export function licenseHeader(svg: string): string | null {
  const m = APACHE_HEADER.exec(svg.trimStart());
  return m ? m[1].trim() : null;
}

const NAMED: Record<string, string> = { white: "#FFFFFF", black: "#000000" };
const COLOR_ATTR = /\b(fill|stroke|stop-color|flood-color)="(#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}|white|black)"/g;

function normHex(c: string): string {
  if (c in NAMED) return NAMED[c];
  const h = c.toUpperCase();
  return h.length === 4 ? "#" + [...h.slice(1)].map((x) => x + x).join("") : h;
}

/** Quita comentarios, el recorte 16×16 sin efecto y normaliza espacios. */
function strip(svg: string): string {
  let s = svg.replace(/<!--[\s\S]*?-->/g, "");
  // Recorte que no recorta: <g clip-path="url(#X)"> … </g> + <defs><clipPath id="X"><rect width="16" height="16" fill="white"/></clipPath></defs>
  const clip = /<defs>\s*<clipPath id="([^"]+)">\s*<rect width="16" height="16" fill="white"\/>\s*<\/clipPath>\s*<\/defs>/.exec(s);
  if (clip) {
    const id = clip[1];
    s = s.replace(clip[0], "");
    const open = new RegExp(`<g clip-path="url\\(#${id}\\)">`);
    if (open.test(s)) s = s.replace(open, "").replace(/<\/g>(?![\s\S]*<\/g>)/, "");
  }
  return s.replace(/\s+/g, " ").replace(/> </g, "><").trim();
}

/** Plantilla del dibujo: colores → marcador y números redondeados a 2 decimales. */
function shape(svg: string): string {
  return strip(svg)
    .replace(COLOR_ATTR, (_m, attr) => `${attr}="#C"`)
    .replace(/-?\d+\.\d+/g, (n) => String(Math.round(parseFloat(n) * 100) / 100));
}

function colors(svg: string): string[] {
  return [...strip(svg).matchAll(COLOR_ATTR)].map((m) => normHex(m[2]));
}

export interface ColorizeResult {
  svg: string;
  /** Tokens usados por el icono. */
  tokens: string[];
  /** Colores de JetBrains que se cambiaron por el valor canónico del rol (para el manifiesto). */
  normalized: string[];
}

/**
 * Convierte el par claro/oscuro de un icono en un único SVG con colores `var(--gdb-ic*)`.
 * Lanza con un mensaje que nombra el icono y el motivo.
 */
export function colorize(name: string, lightSvg: string, darkSvg: string): ColorizeResult {
  if (!licenseHeader(lightSvg)) throw new Error(`${name}: sin cabecera Apache 2.0 de JetBrains (R34)`);
  if (shape(lightSvg) !== shape(darkSvg)) throw new Error(`${name}: la versión clara y la oscura no son el mismo dibujo`);
  const lc = colors(lightSvg);
  const dc = colors(darkSvg);
  const tokens = new Set<string>();
  const normalized = new Set<string>();
  let i = 0;
  const body = strip(lightSvg).replace(COLOR_ATTR, (_m, attr: string) => {
    const l = lc[i];
    const d = dc[i];
    i++;
    const role = ICON_COLOR_ROLES.find(
      (r) =>
        (r.light === l || ("lightAliases" in r && (r.lightAliases as readonly string[]).includes(l))) &&
        (r.dark === d || ("darkAliases" in r && (r.darkAliases as readonly string[]).includes(d)))
    );
    if (!role) throw new Error(`${name}: par de color desconocido ${l} → ${d} (añadirlo a ICON_COLOR_ROLES en src/theme/icon-palette.ts)`);
    if (role.light !== l) normalized.add(`${l}→${role.token}`);
    if (role.dark !== d) normalized.add(`${d} (oscuro)→${role.token}`);
    tokens.add(role.token);
    return `${attr}="var(--gdb-${role.token})"`;
  });
  return { svg: prefixIds(name, body), tokens: [...tokens].sort(), normalized: [...normalized].sort() };
}

/** `id="x"` → `id="ij-<name>-x"`, y sus referencias `url(#x)` / `href="#x"`. */
export function prefixIds(name: string, svg: string): string {
  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  let out = svg;
  for (const id of ids) {
    const nid = `ij-${name}-${id}`;
    out = out
      .split(`id="${id}"`).join(`id="${nid}"`)
      .split(`url(#${id})`).join(`url(#${nid})`)
      .split(`href="#${id}"`).join(`href="#${nid}"`);
  }
  return out;
}
