import { test } from "node:test";
import assert from "node:assert/strict";
import { PALETTES, contraste, mix, tokensDePaleta, tokensResueltosDePaleta, aplicarPaleta, esPaletaActiva } from "./palettes";
import { DEFAULT_STATE, parseThemeState, resolveTokens } from "./apply";
import { TOKEN_KEYS } from "./tokens";
import { THEMES } from "./themes";

const HEX = /^#[0-9A-F]{6}$/;

test("las paletas tienen id único y anclas válidas", () => {
  const ids = new Set<string>();
  for (const p of PALETTES) {
    assert.equal(ids.has(p.id), false, `id repetido: ${p.id}`);
    ids.add(p.id);
    for (const [k, v] of Object.entries(p.anclas)) {
      assert.match(v, HEX, `${p.id}.${k} no es #RRGGBB: ${v}`);
    }
  }
  assert.ok(PALETTES.length >= 8, "el catálogo debe dar variedad real, no dos opciones");
});

test("cada paleta deriva solo tokens conocidos y todos son #RRGGBB", () => {
  for (const p of PALETTES) {
    const tokens = tokensDePaleta(p);
    for (const [k, v] of Object.entries(tokens)) {
      assert.ok((TOKEN_KEYS as readonly string[]).includes(k), `${p.id}: token desconocido ${k}`);
      assert.match(String(v), HEX, `${p.id}.${k} inválido: ${String(v)}`);
    }
    // Los que definen una paleta tienen que estar sí o sí (salvo en las FIELES, que son el tema
    // de JetBrains tal cual y no derivan nada: R98).
    if (p.fiel) continue;
    for (const clave of ["chrome", "editor", "fg", "accent", "kw", "str", "num", "comment"]) {
      assert.ok(clave in tokens, `${p.id} no define ${clave}`);
    }
  }
});

test("contraste de texto: fg/chrome y fg/editor ≥ 4,5:1 en TODAS las paletas", () => {
  for (const p of PALETTES) {
    const t = tokensResueltosDePaleta(p) as Record<string, string>;
    const enChrome = contraste(t.fg, t.chrome);
    const enEditor = contraste(t.fg, t.editor);
    assert.ok(enChrome >= 4.5, `${p.id}: fg sobre chrome da ${enChrome.toFixed(2)}`);
    assert.ok(enEditor >= 4.5, `${p.id}: fg sobre editor da ${enEditor.toFixed(2)}`);
  }
});

test("contraste de sintaxis: keywords y cadenas legibles sobre el editor", () => {
  for (const p of PALETTES) {
    const t = tokensResueltosDePaleta(p) as Record<string, string>;
    for (const clave of ["kw", "str", "num", "fn"]) {
      const c = contraste(t[clave], t.editor);
      assert.ok(c >= 3, `${p.id}: ${clave} sobre editor da ${c.toFixed(2)} (mínimo 3:1 para código)`);
    }
  }
});

test("el texto sobre el botón primario es legible (onaccent)", () => {
  // Las FIELES (R98) son el tema de JetBrains sin tocar: New UI Dark trae #3574F0 con blanco (4,28:1)
  // y es un valor medido del IDE, no una derivación nuestra. Se exime de esta regla y de la del texto
  // secundario; las de texto principal y sintaxis sí se les exigen.
  for (const p of PALETTES.filter((x) => !x.fiel)) {
    const t = tokensResueltosDePaleta(p) as Record<string, string>;
    const c = contraste(t.onaccent, t.btnprimary);
    assert.ok(c >= 4.5, `${p.id}: texto sobre el acento da ${c.toFixed(2)}`);
  }
});

test("mix interpola y no se sale de rango", () => {
  assert.equal(mix("#000000", "#FFFFFF", 0), "#000000");
  assert.equal(mix("#000000", "#FFFFFF", 1), "#FFFFFF");
  assert.equal(mix("#000000", "#FFFFFF", 0.5), "#808080");
});

test("aplicar una paleta fija su base, reemplaza overrides y conserva densidad y tinte", () => {
  const estado = aplicarPaleta(DEFAULT_STATE, "one-dark");
  assert.equal(estado.base, "darcula");
  assert.equal(estado.palette, "one-dark");
  assert.equal(estado.density, DEFAULT_STATE.density);
  assert.equal(estado.tint, DEFAULT_STATE.tint);
  const tokens = resolveTokens(estado);
  assert.equal(tokens.chrome, "#21252B");
  assert.equal(tokens.editor, "#282C34");

  // Cambiar a otra paleta NO arrastra los overrides de la anterior.
  const otra = aplicarPaleta(estado, "github-light");
  assert.equal(otra.base, "newlight");
  assert.equal(resolveTokens(otra).chrome, "#FFFFFF");
});

test("`esPaletaActiva` distingue la paleta limpia de la retocada a mano", () => {
  const limpia = aplicarPaleta(DEFAULT_STATE, "nord");
  assert.equal(esPaletaActiva(limpia, "nord"), true);
  assert.equal(esPaletaActiva(limpia, "one-dark"), false);

  const retocada = { ...limpia, over: { ...limpia.over, kw: "#FF0000" } };
  assert.equal(esPaletaActiva(retocada, "nord"), false, "un color tocado a mano rompe la paleta");
});

test("una paleta desconocida no rompe nada", () => {
  const estado = aplicarPaleta(DEFAULT_STATE, "no-existe");
  assert.deepEqual(estado, DEFAULT_STATE);
});

test("`palette` sobrevive al ida y vuelta por JSON (exportar/importar)", () => {
  const estado = aplicarPaleta(DEFAULT_STATE, "tokyo-night");
  const vuelta = parseThemeState(JSON.parse(JSON.stringify(estado)));
  assert.equal(vuelta.palette, "tokyo-night");
  assert.equal(resolveTokens(vuelta).chrome, "#1A1B26");
});

test("un id de paleta inventado se descarta al importar, pero el tema se respeta", () => {
  const estado = parseThemeState({ v: 1, base: "darcula", over: {}, tint: 0.5, density: "newui", palette: "x" });
  assert.equal(estado.palette, undefined);
  assert.equal(estado.base, "darcula");
});

test("texto secundario y números de línea siguen siendo legibles", () => {
  // Medido antes de fijar esto: Solarized Light daba 2,80:1 en el texto secundario y los números de
  // línea de Solarized Dark 2,67:1. El umbral es 4:1 para secundario (hex, ayudas) y 3:1 para los
  // números de línea, que son referencia y no contenido. (Fieles exentas: ver el test de onaccent.)
  for (const p of PALETTES.filter((x) => !x.fiel)) {
    const t = tokensResueltosDePaleta(p) as Record<string, string>;
    const muted = contraste(t.muted, t.chrome);
    const lineno = contraste(t.lineno, t.editor);
    assert.ok(muted >= 4, `${p.id}: texto secundario sobre chrome da ${muted.toFixed(2)}`);
    assert.ok(lineno >= 3, `${p.id}: números de línea sobre editor dan ${lineno.toFixed(2)}`);
  }
});

test("R98: el catálogo trae oscuros y claros de sobra, y las fieles no derivan nada", () => {
  const oscuros = PALETTES.filter((p) => p.dark).length;
  const claros = PALETTES.filter((p) => !p.dark).length;
  assert.ok(oscuros >= 20, `oscuros: ${oscuros}`);
  assert.ok(claros >= 9, `claros: ${claros}`);
  for (const p of PALETTES.filter((x) => x.fiel)) {
    const estado = aplicarPaleta(DEFAULT_STATE, p.id);
    assert.deepEqual(estado.over, {}, `${p.id}: una paleta fiel deja el tema base tal cual`);
    assert.equal(esPaletaActiva(estado, p.id), true);
  }
  // Cada tema declara su `dark` igual que su base (si no, la clase .dark de Tailwind mentiría).
  for (const p of PALETTES) assert.equal(p.dark, THEMES[p.base].dark, `${p.id}: dark ≠ base`);
});

test("una paleta sigue ACTIVA tras guardar y releer el estado (reinicio de la app)", () => {
  for (const p of PALETTES) {
    const vuelta = parseThemeState(JSON.parse(JSON.stringify(aplicarPaleta(DEFAULT_STATE, p.id))));
    assert.equal(esPaletaActiva(vuelta, p.id), true, `${p.id}: tras releer sale «retocada a mano»`);
  }
});
