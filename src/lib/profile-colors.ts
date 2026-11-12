/**
 * Colores de PERFIL de conexión: los elige el usuario y se guardan con el perfil (son datos, no tema).
 * Por eso son hex fijos y no tokens: un perfil "rojo" debe seguir siendo rojo al cambiar de tema.
 * Es la única excepción a la regla "sin hex en componentes" (src/theme/no-hardcoded-colors.test.ts).
 *
 * Relación con la fase 21 (R18, color-coding por conexión): ese color teñirá árbol, pestaña y editor
 * con la intensidad --gdb-tint. Los colores de ENTORNO del tema (--gdb-envloc/envprod/envstg) son otra
 * cosa: la paleta sugerida; decidir en la fase 21 si los presets de abajo pasan a ser esos tokens.
 */
export const DEFAULT_PROFILE_COLOR = "#3b82f6";

export const PRESET_PROFILE_COLORS = ["#3b82f6", "#10b981", "#8b5cf6", "#ef4444", "#f59e0b"] as const;

/**
 * R18 (color-coding por conexión): el color con el que se TIÑE el explorador de la conexión, o `null`
 * si esa conexión no tiñe.
 *
 * Decisión del usuario (2026-10-22): SOLO el explorador. DataGrip tiñe también el editor y la
 * pestaña; aquí se probó y el usuario lo pidió quitar de la consola («mejor solo déjalo en el
 * explorador»): el editor y la pestaña quedan con los colores del tema.
 *
 * Decisión: el azul de fábrica (`DEFAULT_PROFILE_COLOR`) NO tiñe. Todos los perfiles guardan un color
 * (el formulario arranca con el azul), y DataGrip, por defecto, no colorea ninguna fuente de datos:
 * si el azul tiñera, TODAS las conexiones saldrían azuladas y la señal («esta es producción») se
 * perdería. Elegir cualquier otro color en Conexiones activa el tinte. Hueco conocido: quien quiera
 * un tinte azul tiene que elegir un azul distinto del de fábrica (o un hex propio).
 */
export function colorDeTinte(color: string | null | undefined): string | null {
  if (!color) return null;
  const c = color.trim();
  if (!/^#[0-9a-f]{6}$/i.test(c)) return null;
  if (c.toLowerCase() === DEFAULT_PROFILE_COLOR.toLowerCase()) return null;
  return c;
}

/**
 * Cuánto pesa el color de la conexión en el explorador, en % CON la intensidad al 100 %. El valor real
 * es `intensidad × peso` (`--gdb-tint`, 0–1, Apariencia › Colores); con la de fábrica (0,5) queda a un
 * 12 %: se nota sin estorbar la lectura del árbol.
 */
export const PESO_DE_TINTE = { arbol: 24 } as const;

/** El fondo teñido como CSS: `color-mix` del color de la conexión sobre el fondo de la superficie. */
export function fondoTenido(color: string, base: string, peso: number): string {
  return `color-mix(in srgb, ${color} calc(var(--gdb-tint) * ${peso}%), ${base})`;
}

/**
 * Color con el que la vista previa de Apariencia enseña el tinte cuando la conexión de la consola no
 * tiene color: el rojo de los presets (el de «producción» en DataGrip).
 */
export const TINTE_DE_EJEMPLO: string = PRESET_PROFILE_COLORS[3];
