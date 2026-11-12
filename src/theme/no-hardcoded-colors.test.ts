/**
 * Regla de la fase 7 (T5, T9; criterio de R33): ningún componente pinta con colores fijos.
 * Todo color de UI sale de la capa semántica (`--gdb-*` / utilidades `*-gdb-*` / tokens de shadcn),
 * para que cambiar de tema o editar la paleta repinte TODO.
 *
 * Excepciones, cada una con su porqué:
 *   - src/lib/profile-colors.ts: colores de perfil que elige el usuario (datos, no tema).
 *   - src/lib/editor-themes.ts: los presets vscode/dracula/github-dark conservan sus hex (decisión D2).
 *   - `black`/`white` con opacidad (`bg-black/10`, `ring-white/10`): capas neutras que funcionan igual
 *     en claro y oscuro (overlay del diálogo, anillo de los puntos de color).
 *   - `bg-white` del botón de los interruptores: JetBrains usa #FFFFFF en ambos temas (toggle-on-notch).
 *   - src/icons/intellij/import-lib.fixtures.ts: SVG ORIGINALES de JetBrains, datos de prueba del importador.
 *   - src/icons/intellij/import-lib.ts: traduce `white`/`black` de los SVG a hex para emparejar colores; lo que
 *     genera (generated.ts) no lleva ningún color literal y eso lo comprueba generated.test.ts.
 * Los comentarios no cuentan.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set(["theme", "server", "shared"]);
const SKIP_FILES = new Set([
  "lib/profile-colors.ts",
  "lib/editor-themes.ts",
  "icons/intellij/import-lib.fixtures.ts",
  "icons/intellij/import-lib.ts",
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    const rel = path.relative(SRC, p);
    if (statSync(p).isDirectory()) return SKIP_DIRS.has(rel) ? [] : files(p);
    return /\.(tsx|ts)$/.test(n) && !/\.test\.ts$/.test(n) && !SKIP_FILES.has(rel) ? [p] : [];
  });
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const HEX = /#[0-9A-Fa-f]{6}\b/g;
const PALETTE =
  // `border-l-*`, `ring-offset-*`, `decoration-*`… también: la primera versión solo miraba `border-` y se le
  // escaparon `border-l-green-500` / `border-l-red-500` del grid.
  /\b(?:bg|text|border(?:-[trblxyse])?|ring|ring-offset|fill|stroke|from|to|via|outline|divide|decoration|placeholder|caret|accent|shadow)-(?:zinc|slate|gray|neutral|stone|red|green|blue|amber|emerald|yellow|orange|sky|indigo|violet|rose|cyan|teal|purple|pink|lime|fuchsia|white|black)(?:-\d{2,3})?(?:\/\d+)?(?![\w-])/g;
const ALLOWED = /^(?:(?:bg|ring)-(?:black|white)\/\d+|bg-white)$/;

test("ningún componente usa hex literales ni clases de paleta de Tailwind", () => {
  const offenders: string[] = [];
  for (const f of files(SRC)) {
    const code = stripComments(readFileSync(f, "utf-8"));
    const rel = path.relative(SRC, f);
    for (const m of code.match(HEX) ?? []) offenders.push(`${rel}: ${m}`);
    for (const m of code.match(PALETTE) ?? []) if (!ALLOWED.test(m)) offenders.push(`${rel}: ${m}`);
  }
  assert.deepEqual(offenders, [], `Colores fijos encontrados (usar tokens --gdb-*):\n${offenders.join("\n")}`);
});
