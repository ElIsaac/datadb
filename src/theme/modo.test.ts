import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_STATE, parseThemeState, resolveTokens } from "./apply";
import { aplicarPaleta } from "./palettes";
import { cambiarModo, elegirTema, fijarPaletaDeModo, modoDe, paletaQueToca, sincronizarConSistema } from "./modo";

/* R98 (T1): modo Oscuro | Claro | Seguir al sistema, cada uno con su tema recordado. */

test("sin modo guardado (estado anterior a R98) el modo sale del tema base", () => {
  assert.equal(modoDe(DEFAULT_STATE), "oscuro");
  assert.equal(modoDe(aplicarPaleta(DEFAULT_STATE, "github-light")), "claro");
});

test("elegir una tarjeta fija el modo del tema y la recuerda para ese modo", () => {
  let s = elegirTema(DEFAULT_STATE, "tokyo-night", false);
  assert.equal(s.palette, "tokyo-night");
  assert.equal(s.modo, "oscuro");
  s = elegirTema(s, "catppuccin-latte", false);
  assert.equal(s.modo, "claro", "elegir un tema claro estando en oscuro pide el modo claro");
  assert.equal(s.paletaOscura, "tokyo-night", "y el oscuro se recuerda");
  s = cambiarModo(s, "oscuro", false);
  assert.equal(s.palette, "tokyo-night", "volver a oscuro trae el tema recordado");
});

test("Seguir al sistema: aplica el del modo de macOS y cambia sola al cambiar macOS", () => {
  let s = elegirTema(DEFAULT_STATE, "nord", true);
  s = elegirTema(s, "github-light", true); // en modo fijo: pasa a claro
  s = cambiarModo(s, "sistema", true); // macOS en oscuro
  assert.equal(s.palette, "nord");
  s = sincronizarConSistema(s, false); // macOS pasa a claro
  assert.equal(s.palette, "github-light");
  assert.equal(resolveTokens(s).chrome, "#FFFFFF");
  s = sincronizarConSistema(s, true);
  assert.equal(s.palette, "nord");
});

test("Seguir al sistema: elegir un tema del OTRO modo lo recuerda sin aplicarlo", () => {
  let s = cambiarModo(elegirTema(DEFAULT_STATE, "nord", true), "sistema", true);
  s = elegirTema(s, "gruvbox-light", true);
  assert.equal(s.palette, "nord", "macOS sigue en oscuro: no cambia lo que se ve");
  assert.equal(s.paletaClara, "gruvbox-light");
  assert.equal(paletaQueToca(s, false), "gruvbox-light");
});

test("los desplegables de cada modo solo aceptan temas de ese modo", () => {
  const s = cambiarModo(DEFAULT_STATE, "sistema", false);
  assert.equal(fijarPaletaDeModo(s, true, "github-light", false), s, "un claro no vale como tema oscuro");
  const t = fijarPaletaDeModo(s, false, "rose-pine-dawn", false);
  assert.equal(t.palette, "rose-pine-dawn", "y si es el modo actual de macOS se aplica");
});

test("sincronizar no pisa retoques si el tema que toca ya es el activo", () => {
  const s = cambiarModo(elegirTema(DEFAULT_STATE, "nord", true), "sistema", true);
  const retocada = { ...s, over: { ...s.over, kw: "#FF0000" } };
  assert.equal(sincronizarConSistema(retocada, true), retocada);
});

test("modo y temas de cada modo sobreviven a exportar/importar; un id raro se descarta", () => {
  const s = cambiarModo(elegirTema(DEFAULT_STATE, "kanagawa", true), "sistema", true);
  const vuelta = parseThemeState(JSON.parse(JSON.stringify(s)));
  assert.equal(vuelta.modo, "sistema");
  assert.equal(vuelta.paletaOscura, "kanagawa");
  const raro = parseThemeState({ ...JSON.parse(JSON.stringify(s)), paletaClara: "inventada", modo: "x" });
  assert.equal(raro.paletaClara, undefined);
  assert.equal(raro.modo, undefined);
});
