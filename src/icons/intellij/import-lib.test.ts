import { test } from "node:test";
import assert from "node:assert/strict";
import { colorize, licenseHeader, prefixIds } from "./import-lib";
import { FIXTURES } from "./import-lib.fixtures";
import { ICON_COLOR_ROLES, ICON_TOKEN_KEYS } from "@/theme/icon-palette";
import { TOKEN_GROUPS } from "@/theme/tokens";

const [refreshL, refreshD] = FIXTURES.refresh;

test("R34: acepta la cabecera Apache 2.0 de JetBrains y rechaza un SVG sin ella", () => {
  assert.match(licenseHeader(refreshL) ?? "", /^Copyright 2000-2023 JetBrains s\.r\.o\. and contributors\..*Apache 2\.0 license\.$/);
  // Redacción de 2021 (chevronLeft): «…Apache 2.0 license that can be found in the LICENSE file.»
  assert.match(licenseHeader(FIXTURES.chevronLeft[0]) ?? "", /Apache 2\.0 license that can be found in the LICENSE file\.$/);
  const [askL, askD] = FIXTURES.askAI;
  assert.equal(licenseHeader(askL), null, "toolWindowAskAI dice solo «Copyright © JetBrains», sin licencia");
  assert.throws(() => colorize("askAI", askL, askD), /sin cabecera Apache 2\.0/);
});

test("refresh: un solo SVG con el trazo como token y sin colores literales", () => {
  const r = colorize("refresh", refreshL, refreshD);
  assert.deepEqual(r.tokens, ["icstroke"]);
  assert.equal((r.svg.match(/var\(--gdb-icstroke\)/g) ?? []).length, 4);
  assert.doesNotMatch(r.svg, /#[0-9A-Fa-f]{3,6}\b/);
  assert.doesNotMatch(r.svg, /<!--/, "la cabecera va al manifiesto, no al SVG en línea");
  assert.deepEqual(r.normalized, []);
});

test("tolera las tres diferencias de formato medidas en el set y nada más", () => {
  // dataTables: la oscura envuelve el dibujo en un recorte 16x16 sin efecto.
  assert.deepEqual(colorize("dataTables", ...FIXTURES.dataTables).tokens, ["icfill", "icstroke"]);
  // warning: `white` por nombre en la clara frente a #5E4D33 en la oscura.
  assert.deepEqual(colorize("warning", ...FIXTURES.warning).tokens, ["icyellow", "icyellowfg"]);
  // push: coordenadas que difieren en 0,0001 px.
  assert.deepEqual(colorize("push", ...FIXTURES.push).tokens, ["icstroke"]);
  // Un cambio real de dibujo (otra coordenada) aborta.
  const otro = refreshD.replace("M2.5 9V8", "M3.5 9V8");
  assert.throws(() => colorize("refresh", refreshL, otro), /no son el mismo dibujo/);
});

test("un par de color desconocido aborta en vez de inventar un token", () => {
  const raro = refreshD.replaceAll("#CED0D6", "#123456");
  assert.throws(() => colorize("refresh", refreshL, raro), /par de color desconocido #6C707E → #123456/);
});

test("run: verde y fondo verde con los valores de JetBrains en los dos temas", () => {
  const r = colorize("run", ...FIXTURES.run);
  assert.deepEqual(r.tokens, ["icgreen", "icgreenbg"]);
  const g = ICON_COLOR_ROLES.find((x) => x.token === "icgreen")!;
  assert.deepEqual([g.light, g.dark], ["#208A3C", "#57965C"]);
});

test("los ids internos se prefijan con el nombre del icono (dos iconos no chocan en el DOM)", () => {
  const s = prefixIds("x", '<g clip-path="url(#c0)"><use href="#c0"/></g><clipPath id="c0"/>');
  assert.equal(s, '<g clip-path="url(#ij-x-c0)"><use href="#ij-x-c0"/></g><clipPath id="ij-x-c0"/>');
});

test("cada rol de color de icono es un token del grupo «Iconos» del panel Apariencia, y viceversa", () => {
  const grupo = TOKEN_GROUPS.find((g) => g.title === "Iconos")!.tokens.map((t) => t.key as string).filter((k) => k.startsWith("ic") && !k.startsWith("ico"));
  assert.deepEqual([...grupo].sort(), [...ICON_TOKEN_KEYS].sort());
});
