/**
 * Store del tema en el renderer. Reemplaza a `next-themes`, que de hecho nunca estuvo montado
 * (ver phases/phase-7/PLAN.md, "Hallazgos"). Aplica el estado escribiendo variables CSS en <html>
 * — en tiempo de ejecución, porque la paleta es editable (R51) — y alterna la clase `.dark` para
 * las variantes `dark:` de Tailwind/shadcn.
 *
 * Persistencia: localStorage (en Electron vive en userData, así que sobrevive a reinicios).
 * Un valor guardado corrupto NO tumba la app: se descarta, se avisa en consola y se usa el
 * por defecto (el usuario no pierde nada que pudiera recuperar: el JSON roto era inservible).
 */
import { useSyncExternalStore } from "react";
import { DEFAULT_STATE, parseThemeState, resolveTokens, themeCssVars, type ThemeState } from "./apply";
import { THEMES } from "./themes";
import { sincronizarConSistema } from "./modo";
import type { TokenKey } from "./tokens";

const STORAGE_KEY = "gestordb-theme-v1";

function load(): ThemeState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_STATE;
  try {
    return parseThemeState(JSON.parse(raw));
  } catch (err) {
    console.error("[theme] Estado guardado inválido; se usa el tema por defecto", err);
    return DEFAULT_STATE;
  }
}

/**
 * R98 (T1): ¿macOS está en modo oscuro? Electron deja `nativeTheme.themeSource` en «system», así que
 * `prefers-color-scheme` del renderer sigue al sistema (y su evento `change` llega al cambiarlo).
 */
const consultaOscuro =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;
export function sistemaEsOscuro(): boolean {
  return consultaOscuro?.matches ?? true;
}

// Con «Seguir al sistema», el tema del arranque es el del modo en que esté macOS ahora.
let state: ThemeState = sincronizarConSistema(load(), sistemaEsOscuro());
const listeners = new Set<() => void>();

function applyToDocument(s: ThemeState) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  for (const [k, v] of Object.entries(themeCssVars(s))) el.style.setProperty(k, v);
  const dark = THEMES[s.base].dark;
  el.classList.toggle("dark", dark);
  el.style.colorScheme = dark ? "dark" : "light";
  el.dataset.theme = s.base;
  el.dataset.density = s.density;
}

applyToDocument(state);

// macOS cambió de modo con la app abierta: si el usuario eligió «Seguir al sistema», se cambia el tema.
consultaOscuro?.addEventListener("change", (e) => {
  const siguiente = sincronizarConSistema(state, e.matches);
  if (siguiente !== state) setThemeState(siguiente);
});

export function getThemeState(): ThemeState {
  return state;
}

export function setThemeState(next: ThemeState) {
  state = next;
  applyToDocument(state);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("[theme] No se pudo guardar el tema", err);
  }
  listeners.forEach((l) => l());
}

export function updateThemeState(patch: Partial<ThemeState>) {
  // Cambiar de tema base descarta los cambios de paleta: eran relativos al tema anterior. Y si el
  // usuario cambia el tema a mano deja de estar «en» una paleta: `palette` se limpia para que la
  // tarjeta del panel no diga «Retocada a mano» cuando en realidad eligió otro tema.
  const cambiaBase = Boolean(patch.base && patch.base !== state.base);
  const over = cambiaBase ? {} : state.over;
  const palette = cambiaBase && patch.palette === undefined ? undefined : (patch.palette ?? state.palette);
  setThemeState({ ...state, over, palette, ...patch });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Estado completo del tema (re-renderiza al cambiar). */
export function useThemeState(): ThemeState {
  return useSyncExternalStore(subscribe, getThemeState, () => DEFAULT_STATE);
}

/**
 * Tokens resueltos como hex, para los pocos sitios que no pueden usar `var(--gdb-*)`:
 * atributos SVG de librerías (React Flow), exportar a PNG, canvas.
 */
export function useThemeTokens(): { dark: boolean; tokens: Record<TokenKey, string> } {
  const s = useThemeState();
  return { dark: THEMES[s.base].dark, tokens: resolveTokens(s) };
}
