/**
 * Reglas sobre los iconos PROPIOS de DataDB (fase 8, T5; R34 + D1/D3).
 *
 * Son el complemento de generated.test.ts: aquellos se descargan de JetBrains (Apache 2.0), estos se dibujan aquí.
 * Los tests fallan si un icono propio mete un color literal, usa un token de icono inexistente, repite un id, choca
 * con el nombre de un icono importado o se queda sin registrar en MANIFEST.md como `origen: propio`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CUSTOM_ICONS, CUSTOM_ICON_ORIGIN } from "./custom-icons";
import { IJ_ICONS } from "../intellij/generated";
import { ICON_TOKEN_KEYS } from "@/theme/icon-palette";

const manifest = readFileSync(path.resolve(__dirname, "../intellij/MANIFEST.md"), "utf8");

/**
 * El alcance de T5 (.planning/phases/phase-8/icon-map.md + corrección de T3 con el trigger) MÁS el
 * embudo de la fase 13. Se amplía aquí a conciencia, no por conveniencia: el test existe para que un
 * icono propio sin revisar no entre de rondón, así que cada ampliación deja su rastro en este listado
 * y en el manifiesto (`CUSTOM_ICON_ORIGIN`).
 */
const ESPERADOS = [
  "database",
  "view",
  "procedure",
  "trigger",
  "primaryKey",
  "foreignKey",
  "explainPlan",
  "connect",
  "disconnect",
  "console",
  "ai",
  // Fase 13 (R38): el embudo de la fila de filtros.
  "filter",
] as const;

test("T5: están dibujados los iconos propios del alcance (11 de la fase 8 + el embudo de la 13)", () => {
  assert.deepEqual(Object.keys(CUSTOM_ICONS).sort(), [...ESPERADOS].sort());
  assert.deepEqual(Object.keys(CUSTOM_ICON_ORIGIN).sort(), [...ESPERADOS].sort());
});

test("D3: ningún icono propio lleva color literal y todos pintan con tokens de icono conocidos", () => {
  for (const [name, svg] of Object.entries(CUSTOM_ICONS)) {
    assert.doesNotMatch(svg, /#[0-9A-Fa-f]{3,8}\b|"(white|black)"/, `${name}: color literal`);
    for (const m of svg.matchAll(/var\(--gdb-([a-z]+)\)/g)) {
      assert.ok((ICON_TOKEN_KEYS as readonly string[]).includes(m[1]), `${name}: token desconocido ${m[1]}`);
    }
  }
});

test("gramática expui: viewBox 16×16 y ningún atributo de tamaño distinto", () => {
  for (const [name, svg] of Object.entries(CUSTOM_ICONS)) {
    assert.match(svg, /viewBox="0 0 16 16"/, `${name}: viewBox`);
    assert.match(svg, /<svg width="16" height="16"/, `${name}: tamaño base`);
  }
});

test("ningún icono propio declara ids internos (no pueden chocar en el DOM)", () => {
  for (const [name, svg] of Object.entries(CUSTOM_ICONS)) {
    assert.doesNotMatch(svg, /\bid="/, `${name}: id interno`);
  }
});

test("ningún nombre propio choca con uno importado de IntelliJ", () => {
  const choques = Object.keys(CUSTOM_ICONS).filter((n) => n in IJ_ICONS);
  assert.deepEqual(choques, []);
});

test("R34: cada icono propio está registrado en MANIFEST.md como origen propio y con su motivo", () => {
  for (const name of ESPERADOS) {
    const row = manifest.split("\n").find((l) => l.startsWith(`| \`${name}\` |`));
    assert.ok(row, `${name}: sin fila en el manifiesto`);
    assert.ok(row!.includes("| propio |"), `${name}: la fila no declara origen propio`);
    assert.ok(row!.includes(CUSTOM_ICON_ORIGIN[name]), `${name}: motivo`);
  }
});
