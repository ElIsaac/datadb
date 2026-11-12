import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { THEMES, THEME_IDS } from "./themes";
import { TOKEN_KEYS } from "./tokens";
import { DEFAULT_STATE, exportThemeState, generateTokensCss, parseThemeState, resetToken, themeCssVars, withToken } from "./apply";

test("los tres temas definen los 89 tokens y todos son #RRGGBB", () => {
  // 83 → 86 en la fase 70 (T1), 87 en la fase 80 (identidades de motor: enginepg/enginemysql/
  // enginemssql más MongoDB) y **89 en R92**: `col`, el color de una columna resuelta en el editor.
  assert.equal(TOKEN_KEYS.length, 89);
  for (const id of THEME_IDS) {
    for (const k of TOKEN_KEYS) {
      assert.match(THEMES[id].v[k], /^#[0-9A-F]{6}$/, `${id}.${k}`);
    }
    for (const k of THEMES[id].verified) assert.ok(TOKEN_KEYS.includes(k), `${id}: verificado desconocido ${k}`);
  }
});

test("R9: Darcula por defecto con los fondos y textos del original", () => {
  const v = THEMES[DEFAULT_STATE.base].v;
  assert.equal(DEFAULT_STATE.base, "darcula");
  assert.deepEqual([v.chrome, v.editor, v.fg, v.fgeditor], ["#3C3F41", "#2B2B2B", "#BBBBBB", "#A9B7C6"]);
});

test("R11: sintaxis SQL de Darcula", () => {
  const v = THEMES.darcula.v;
  assert.deepEqual([v.kw, v.str, v.num, v.comment], ["#CC7832", "#6A8759", "#6897BB", "#808080"]);
});

test("R10/D1: densidad por defecto New UI 24/29/40; la clásica 20/25/32", () => {
  const nu = themeCssVars(DEFAULT_STATE);
  assert.deepEqual([nu["--gdb-row"], nu["--gdb-th-h"], nu["--gdb-tab-h"]], ["24px", "29px", "40px"]);
  const cl = themeCssVars({ ...DEFAULT_STATE, density: "classic" });
  assert.deepEqual([cl["--gdb-row"], cl["--gdb-th-h"], cl["--gdb-tab-h"]], ["20px", "25px", "32px"]);
  assert.equal(nu["--gdb-indent"], "18px");
});

test("un cambio de paleta gana al tema base y no lo modifica", () => {
  const s = parseThemeState({ base: "darcula", over: { kw: "#ff00aa" } });
  assert.equal(themeCssVars(s)["--gdb-kw"], "#FF00AA");
  assert.equal(THEMES.darcula.v.kw, "#CC7832");
});

test("parseThemeState rechaza con mensaje en vez de importar a medias", () => {
  assert.throws(() => parseThemeState(null), /no es un objeto/);
  assert.throws(() => parseThemeState({ base: "monokai" }), /Tema base desconocido/);
  assert.throws(() => parseThemeState({ base: "darcula", over: { nope: "#000000" } }), /Token desconocido/);
  assert.throws(() => parseThemeState({ base: "darcula", over: { kw: "rojo" } }), /Color inválido/);
  assert.throws(() => parseThemeState({ base: "darcula", density: "xl" }), /Densidad desconocida/);
});

test("un override igual al valor del tema no se guarda; el tinte se acota a 0..1", () => {
  const s = parseThemeState({ base: "darcula", over: { kw: "#cc7832" }, tint: 7 });
  assert.deepEqual(s.over, {});
  assert.equal(s.tint, 1);
});

test("tokens.css está al día con el código (npm run gen:tokens)", () => {
  const file = readFileSync(path.join(__dirname, "tokens.css"), "utf-8");
  assert.equal(file, generateTokensCss());
});

test("R51: editar, volver al valor del tema y exportar/importar dan ida y vuelta exacta", () => {
  let s = withToken(DEFAULT_STATE, "kw", "#ff00aa");
  assert.equal(s.over.kw, "#FF00AA");
  assert.deepEqual(withToken(s, "kw", "zzz"), s, "un color inválido no cambia nada");
  assert.deepEqual(withToken(s, "kw", THEMES.darcula.v.kw).over, {}, "elegir el color del tema quita el override");
  assert.deepEqual(resetToken(s, "kw").over, {});
  s = { ...s, tint: 0.2, density: "classic" };
  assert.deepEqual(parseThemeState(JSON.parse(exportThemeState(s))), s);
});

// ---- Contraste (T12): fórmula WCAG 2.x sobre pares texto/fondo que la UI usa de verdad ----
function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** Pares que la UI pinta como texto de lectura y que DEBEN llegar a 4,5:1 en los tres temas. */
const MUST: [string, string][] = [
  ["fg", "chrome"], ["fgdim", "chrome"], ["fgdim", "field"], ["fgstrong", "listsel"],
  ["errfg", "chrome"], ["errfg", "field"], ["warnfg", "chrome"], ["okfg", "chrome"],
  ["fgeditor", "editor"], ["kw", "editor"], ["num", "editor"], ["link", "chrome"],
];
/**
 * Pares por debajo de 4,5:1 que son valores LITERALES de JetBrains (decisión suya de diseño para texto
 * secundario/decorativo). Se registran para que no empeoren; el usuario puede subirlos en la paleta (R51).
 * Mínimo exigido: 3:1, salvo `muted` (Component.infoForeground: texto terciario como tipos de columna,
 * 2,4:1 literal en Darcula) y los números de línea (decorativos), que solo no deben empeorar.
 */
const KNOWN_LOW: Record<string, string[]> = {
  darcula: ["muted/chrome", "kw/editor", "comment/editor", "str/editor", "const/editor", "lineno/gutter", "okfg/chrome", "link/chrome"],
  newdark: ["muted/chrome", "comment/editor", "lineno/gutter", "onaccent/btnprimary"],
  newlight: ["muted/chrome", "comment/editor", "lineno/gutter", "onaccent/btnprimary"],
};

test("contraste: los pares de texto de lectura llegan a 4,5:1 (salvo literales de JetBrains registrados)", () => {
  const fails: string[] = [];
  for (const id of THEME_IDS) {
    const v = THEMES[id].v;
    for (const [f, b] of MUST) {
      const r = ratio(v[f as keyof typeof v], v[b as keyof typeof v]);
      const name = `${f}/${b}`;
      if (r < 4.5 && !KNOWN_LOW[id].includes(name)) fails.push(`${id} ${name} ${r.toFixed(2)}`);
    }
    for (const name of KNOWN_LOW[id]) {
      const [f, b] = name.split("/");
      const r = ratio(v[f as keyof typeof v], v[b as keyof typeof v]);
      const min = f === "lineno" ? 1.8 : f === "muted" ? 2.3 : 3;
      if (r < min) fails.push(`${id} ${name} ${r.toFixed(2)} < ${min} (conocido pero empeoró)`);
    }
  }
  assert.deepEqual(fails, []);
});
