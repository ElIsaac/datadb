/**
 * Hoja de contacto T5 (fase 8): renderiza TODOS los iconos (IntelliJ importados + propios) en los
 * tres temas, en 16 px y ampliados a 64 px para inspección. Se escribe en el scratch y se revisa
 * con el usuario ANTES de aplicarlos al árbol (punto de control del PLAN.md, riesgos).
 */
import { writeFileSync } from "node:fs";
import { IJ_ICONS } from "../src/icons/intellij/generated";
import { CUSTOM_ICONS } from "../src/icons/custom/custom-icons";
import { ICON_COLOR_ROLES } from "../src/theme/icon-palette";

const THEMES = [
  { name: "New UI Light", dark: false, bg: "#FFFFFF", fg: "#1F2328", chrome: "#EBECF0" },
  { name: "New UI Dark", dark: true, bg: "#2B2D30", fg: "#DFE1E5", chrome: "#333538" },
  { name: "Darcula", dark: true, bg: "#3C3F41", fg: "#BCBEC4", chrome: "#46484A" },
] as const;

function vars(dark: boolean): string {
  return ICON_COLOR_ROLES.map((r) => `--gdb-${r.token}:${dark ? r.dark : r.light}`)
    .concat([`--gdb-icbadgefg:#FFFFFF`])
    .join(";");
}

function cell(name: string, svg: string, size: number): string {
  const sized = svg.replace(/width="16" height="16"/, `width="${size}" height="${size}"`);
  return `<div class="cell"><div class="ico" style="width:${size}px;height:${size}px">${sized}</div><span>${name}</span></div>`;
}

const sections = THEMES.map((t) => {
  const rows16 = [
    ...Object.entries(IJ_ICONS).map(([n, s]) => cell(n, s, 16)),
    ...Object.entries(CUSTOM_ICONS).map(([n, s]) => cell(n + " *", s, 16)),
  ].join("");
  const big = Object.entries(CUSTOM_ICONS)
    .map(([n, s]) => cell(n, s, 64))
    .join("");
  const bigJb = ["table", "schema", "column", "function", "diagram", "run", "stop", "star", "locked", "refresh", "history"]
    .map((n) => cell(n, IJ_ICONS[n as keyof typeof IJ_ICONS], 64))
    .join("");
  return `
  <section style="${vars(t.dark)}">
    <h2 style="color:${t.fg}">${t.name} <small style="opacity:.6">(* = propio)</small></h2>
    <div class="row" style="background:${t.bg}">${rows16}</div>
    <h3 style="color:${t.fg}">Ampliados ×4 — propios vs JetBrains de referencia</h3>
    <div class="row" style="background:${t.bg}">${big}${bigJb}</div>
    <h3 style="color:${t.fg}">Simulación de badges sobre columna (PK / FK / PK+FK)</h3>
    <div class="row" style="background:${t.bg}">
      <div class="cell"><div class="ico" style="position:relative;width:16px;height:16px">${IJ_ICONS.column}${CUSTOM_ICONS.primaryKey.replace('<svg ', '<svg style="position:absolute;inset:0" ')}</div><span>PK</span></div>
      <div class="cell"><div class="ico" style="position:relative;width:16px;height:16px">${IJ_ICONS.column}${CUSTOM_ICONS.foreignKey.replace('<svg ', '<svg style="position:absolute;inset:0" ')}</div><span>FK</span></div>
      <div class="cell"><div class="ico" style="position:relative;width:16px;height:16px">${IJ_ICONS.column}${CUSTOM_ICONS.primaryKey.replace('<svg ', '<svg style="position:absolute;inset:0" ')}${CUSTOM_ICONS.foreignKey.replace('<svg ', '<svg style="position:absolute;inset:0;transform:scaleX(-1)" ')}</div><span>PK+FK</span></div>
    </div>
  </section>`;
}).join("");

const html = `<!doctype html><meta charset="utf-8"><title>Hoja de contacto T5</title>
<style>
  body{font:12px/1.4 -apple-system,sans-serif;margin:0;background:#26282E;color:#ccc}
  section{padding:16px 20px}
  .row{display:flex;flex-wrap:wrap;gap:10px;padding:12px;border-radius:8px}
  .cell{display:flex;flex-direction:column;align-items:center;gap:4px;width:84px}
  .cell span{font-size:10px;opacity:.75;text-align:center}
  .ico{display:flex;align-items:center;justify-content:center}
  h2,h3{margin:12px 0 4px;font-weight:600}
</style>${sections}`;

writeFileSync(process.argv[2] ?? "design/contact-sheet.html", html);
console.log("ok");
