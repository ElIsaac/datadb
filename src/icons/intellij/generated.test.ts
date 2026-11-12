/**
 * Reglas sobre el resultado del importador (fase 8, T6 b/c; R34). Fallan si alguien edita generated.ts a mano o si
 * una importación futura cuela un color literal, un id repetido o un icono sin procedencia registrada.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { IJ_ICONS } from "./generated";
import { ICON_TOKEN_KEYS } from "@/theme/icon-palette";

const manifest = readFileSync(path.join(__dirname, "MANIFEST.md"), "utf8");
const cfg = JSON.parse(readFileSync(path.join(__dirname, "icons.json"), "utf8")) as { commit: string; icons: Record<string, string> };

test("generated.ts tiene exactamente los iconos de icons.json", () => {
  assert.deepEqual(Object.keys(IJ_ICONS).sort(), Object.keys(cfg.icons).sort());
});

test("D3: ningún icono lleva un color literal; todos pintan con tokens de icono conocidos", () => {
  for (const [name, svg] of Object.entries(IJ_ICONS)) {
    assert.doesNotMatch(svg, /#[0-9A-Fa-f]{3,8}\b|"(white|black)"/, `${name}: color literal`);
    for (const m of svg.matchAll(/var\(--gdb-([a-z]+)\)/g)) {
      assert.ok((ICON_TOKEN_KEYS as readonly string[]).includes(m[1]), `${name}: token desconocido ${m[1]}`);
    }
  }
});

test("ningún id interno se repite entre iconos (chocarían en el DOM)", () => {
  const seen = new Map<string, string>();
  for (const [name, svg] of Object.entries(IJ_ICONS)) {
    for (const m of svg.matchAll(/\bid="([^"]+)"/g)) {
      assert.ok(!seen.has(m[1]), `id ${m[1]} en ${name} y en ${seen.get(m[1])}`);
      seen.set(m[1], name);
    }
  }
});

test("R34: cada icono tiene su procedencia en MANIFEST.md (ruta, cabecera Apache 2.0, sha256) y el commit fijado", () => {
  assert.ok(manifest.includes(cfg.commit), "commit");
  for (const [name, rel] of Object.entries(cfg.icons)) {
    const row = manifest.split("\n").find((l) => l.startsWith(`| \`${name}\` |`));
    assert.ok(row, `${name}: sin fila en el manifiesto`);
    assert.ok(row.includes(`\`${rel}\``), `${name}: ruta`);
    assert.match(row, /JetBrains s\.r\.o\..*Apache 2\.0 license/, `${name}: cabecera`);
    assert.match(row, /\| `[0-9a-f]{16}` \| `[0-9a-f]{16}` \|/, `${name}: sha256`);
  }
});
