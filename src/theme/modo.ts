/**
 * R98 (T1) — modo de apariencia: Oscuro | Claro | Seguir al sistema. Lógica PURA (sin DOM ni
 * `matchMedia`): quien sabe si macOS está en oscuro es `theme-store.ts`, que lo pasa como booleano.
 *
 * El modelo es el de macOS y el de la propuesta aprobada (`design/propuesta-apariencia.png`): cada
 * modo RECUERDA su tema (`paletaOscura`, `paletaClara`). Elegir una tarjeta oscura la deja como el
 * tema del modo oscuro; con «Seguir al sistema» se aplica la del modo en que esté macOS y, al
 * cambiar macOS, la otra — sin tocar la app.
 */
import { aplicarPaleta, paletaPorId } from "./palettes";
import { THEMES } from "./themes";
import type { ModoDeApariencia, ThemeState } from "./apply";

/** Temas de cada modo cuando el usuario aún no eligió (los de fábrica de JetBrains). */
export const PALETA_OSCURA_DE_FABRICA = "darcula";
export const PALETA_CLARA_DE_FABRICA = "newlight";

/** Modo efectivo: el guardado o, en estados anteriores a R98, el que dicta el tema base. */
export function modoDe(state: ThemeState): ModoDeApariencia {
  return state.modo ?? (THEMES[state.base].dark ? "oscuro" : "claro");
}

/** El tema recordado de cada modo (o el actual, si es de ese modo y no hay otro recordado). */
export function paletaDelModo(state: ThemeState, oscuro: boolean): string {
  const guardada = oscuro ? state.paletaOscura : state.paletaClara;
  if (guardada) return guardada;
  const actual = state.palette ? paletaPorId(state.palette) : undefined;
  if (actual && actual.dark === oscuro) return actual.id;
  return oscuro ? PALETA_OSCURA_DE_FABRICA : PALETA_CLARA_DE_FABRICA;
}

/** ¿Qué tema toca mostrar ahora? `sistemaOscuro` = macOS está en modo oscuro. */
export function paletaQueToca(state: ThemeState, sistemaOscuro: boolean): string {
  const modo = modoDe(state);
  const oscuro = modo === "sistema" ? sistemaOscuro : modo === "oscuro";
  return paletaDelModo(state, oscuro);
}

/** Aplica la paleta que toca si no es ya la activa (no pisa retoques hechos sobre la activa). */
function alinear(state: ThemeState, sistemaOscuro: boolean): ThemeState {
  const id = paletaQueToca(state, sistemaOscuro);
  return state.palette === id ? state : aplicarPaleta(state, id);
}

/**
 * Clic en una tarjeta de la galería. El tema queda como el de SU modo. En modo fijo, además, el modo
 * pasa al del tema (elegir «Catppuccin Latte» estando en oscuro es pedir el modo claro). Con «Seguir
 * al sistema» solo se aplica si macOS está en ese modo; si no, queda recordado para cuando cambie.
 */
export function elegirTema(state: ThemeState, id: string, sistemaOscuro: boolean): ThemeState {
  const paleta = paletaPorId(id);
  if (!paleta) return state;
  const conRecuerdo: ThemeState = paleta.dark ? { ...state, paletaOscura: id } : { ...state, paletaClara: id };
  if (modoDe(state) === "sistema") {
    const recordado: ThemeState = { ...conRecuerdo, modo: "sistema" };
    return paleta.dark === sistemaOscuro ? aplicarPaleta(recordado, id) : recordado;
  }
  return aplicarPaleta({ ...conRecuerdo, modo: paleta.dark ? "oscuro" : "claro" }, id);
}

/** El segmentado «Modo». Fija los recuerdos de ambos modos para que no dependan del tema actual. */
export function cambiarModo(state: ThemeState, modo: ModoDeApariencia, sistemaOscuro: boolean): ThemeState {
  const fijado: ThemeState = {
    ...state,
    modo,
    paletaOscura: paletaDelModo(state, true),
    paletaClara: paletaDelModo(state, false),
  };
  return alinear(fijado, sistemaOscuro);
}

/** Los desplegables «Tema para modo oscuro / claro» (solo con «Seguir al sistema»). */
export function fijarPaletaDeModo(
  state: ThemeState,
  oscuro: boolean,
  id: string,
  sistemaOscuro: boolean
): ThemeState {
  const paleta = paletaPorId(id);
  if (!paleta || paleta.dark !== oscuro) return state;
  const next: ThemeState = oscuro ? { ...state, paletaOscura: id } : { ...state, paletaClara: id };
  return alinear(next, sistemaOscuro);
}

/** macOS cambió de modo (o arranca la app): con «Seguir al sistema», aplica el tema que toca. */
export function sincronizarConSistema(state: ThemeState, sistemaOscuro: boolean): ThemeState {
  return modoDe(state) === "sistema" ? alinear(state, sistemaOscuro) : state;
}
