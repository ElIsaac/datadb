/**
 * Fase 6 (R5/T1): memoria de la geometría de la ventana principal.
 *
 * Problema que resuelve: `electron/main.ts` creaba la `BrowserWindow` con medidas FIJAS
 * (1440x900) y no registraba nada, así que cada arranque devolvía la ventana al mismo sitio. Un
 * usuario que trabaja con la ventana maximizada, o movida a su monitor secundario, tenía que
 * recolocarla a mano en cada lanzamiento.
 *
 * Este módulo guarda en disco los `bounds` (x, y, ancho, alto) y si estaba maximizada, y los
 * devuelve en el arranque siguiente. Vive separado de `main.ts` para poder probarse sin Electron:
 * NO importa `electron`. Todo lo que viene del sistema operativo (la ruta del archivo y las áreas
 * útiles de las pantallas, `screen.getAllDisplays().map(d => d.workArea)`) entra por ARGUMENTOS.
 *
 * La pieza con valor real es `clampToVisible`, y no es un adorno: el caso "se cerró con un monitor
 * externo conectado y se abre el portátil sin él" es común, y sin acotar los bounds la ventana
 * aparecería fuera de la pantalla —invisible e inusable— porque macOS la coloca en coordenadas
 * que ya no existen. Lo mismo con un monitor cuya resolución cambió: la ventana puede quedar más
 * ancha que la pantalla. `clampToVisible` se encarga de ambos casos, y por eso es una función PURA
 * (mismo `bounds` + mismas `displays` -> mismo resultado) que se prueba exhaustivamente aquí.
 *
 * Reglas generales:
 *  - Nada de este módulo puede impedir usar la app. Si el archivo no está, está corrupto o la
 *    escritura falla, se degrada a los valores por defecto del llamador. Perder la geometría de la
 *    ventana es una molestia cosmética, nunca un error fatal.
 *  - Las escrituras son ATÓMICAS (escribir a `.tmp` + `rename`), igual que `electron/secrets.ts`:
 *    un `rename` es atómico en el mismo sistema de archivos, así que un corte a mitad de escritura
 *    deja el archivo viejo intacto en vez de un `window-state.json` truncado que no se pueda leer.
 */
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";

/** Rectángulo en el sentido de Electron: `x`/`y` es la esquina superior izquierda. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Lo que se persiste: dónde estaba la ventana y si estaba maximizada. */
export interface WindowState {
  bounds: Rect;
  maximized: boolean;
}

/** El tamaño mínimo que se respeta al recolocar. Hoy son los `minWidth`/`minHeight` de `main.ts`. */
export interface MinSize {
  width: number;
  height: number;
}

/**
 * ¿Es un rectángulo utilizable? Un `NaN`, un no-numérico o un ancho/alto <= 0 no describen una
 * ventana: se tratan como "no hay estado" (el llamador usa sus valores por defecto). El alto/ancho
 * NEGATIVO es la basura típica que deja un JSON mal escrito a mano, y es preferible ignorarlo a
 * pasárselo a Electron, que lanzaría al recibir un tamaño imposible.
 */
function isValidRect(value: unknown): value is Rect {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  const nums = [r.x, r.y, r.width, r.height];
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return false;
  return (r.width as number) > 0 && (r.height as number) > 0;
}

/**
 * Lee el estado guardado. Devuelve `null` si no hay archivo, si es ilegible o si su contenido no
 * describe una ventana válida (JSON roto, `bounds` con NaN/negativos, etc.). NUNCA lanza: un
 * `window-state.json` corrupto no debe impedir arrancar; el llamador simplemente usará sus
 * valores por defecto y el archivo se reescribirá sano en el próximo guardado.
 *
 * Ojo con `maximized`: aquí NO se valida como basura. Si falta o no es booleano se asume `false`,
 * porque lo único que decide es si la ventana se reabre maximizada, y "no maximizar" es la
 * degradación segura (nunca deja al usuario con una ventana que no puede restaurar).
 */
export function readWindowState(filePath: string): WindowState | null {
  return readWindowStateSync(filePath);
}

/** Implementación de lectura; separada para poder documentar el porqué del `try` de I/O. */
function readWindowStateSync(filePath: string): WindowState | null {
  let raw: string;
  try {
    // `readFileSync`: `main.ts` llama esto en `app.whenReady`, de forma síncrona y una sola vez.
    // Un archivo diminuto (unos 80 bytes) tarda microsegundos; no vale la pena complicar la API
    // con promesas para ganar nada.
    raw = readFileSync(filePath, "utf-8");
  } catch {
    // ENOENT (no existe, el caso normal del primer arranque) y cualquier otro fallo de lectura se
    // tratan igual: no hay estado previo.
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<WindowState>;
    if (!isValidRect(parsed?.bounds)) return null;
    return { bounds: parsed.bounds, maximized: parsed.maximized === true };
  } catch {
    // JSON inválido: mismo camino que "no hay archivo".
    return null;
  }
}

/** Acota `v` al rango `[lo, hi]`. Si `hi < lo` (min más grande que la pantalla) gana `lo`. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}

/**
 * Área de la intersección entre dos rectángulos; 0 si no se tocan. Se usa para elegir la pantalla
 * con la que la ventana "más" solapa.
 */
function intersectionArea(a: Rect, b: Rect): number {
  const overlapW = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const overlapH = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (overlapW <= 0 || overlapH <= 0) return 0;
  return overlapW * overlapH;
}

/**
 * Devuelve unos bounds que de verdad se ven, dado el conjunto de áreas útiles de las pantallas
 * conectadas. PURA: no toca el sistema de archivos ni Electron.
 *
 * Lógica, en orden:
 *  1. Saneado defensivo: si `bounds` es basura (NaN, sin ancho/alto positivo), se parte de la
 *     primera pantalla y se recentra, igual que si no hubiera estado. Aunque `readWindowState` ya
 *     filtra la basura, esta función se exporta y debe ser segura por sí sola ante cualquier
 *     entrada (el llamador podría leer los bounds de otra fuente).
 *  2. Sin pantallas (`displays` vacío): no hay a qué acotar; se devuelven los bounds saneados al
 *     mínimo. En Electron esto no ocurre (siempre hay una), pero se cubre para no asumirlo.
 *  3. Se elige la pantalla con la que la ventana MÁS solapa (si solapa con alguna).
 *  4. Si NO solapa con ninguna (monitor externo desconectado): se recentra en la PRIMERA pantalla,
 *     respetando `min` y sin pasarse del área útil.
 *  5. Si solapa parcialmente: se EMPUJA lo mínimo para que quepa entera dentro de la pantalla
 *     elegida, en vez de recentrar. Recentrar en este caso sería brusco: el usuario tenía la
 *     ventana pegada a una esquina del monitor que sigue existiendo y solo asoma unos píxeles; lo
 *     que quiere es que se vea entera, no que salte al centro.
 *
 * En los pasos 4 y 5 el ancho/alto se acotan al área útil de esa pantalla y NUNCA bajan de `min`.
 * Si `min` es mayor que la pantalla (pantalla diminuta o mínimo grande), gana `min`: la ventana se
 * ancla en la esquina superior izquierda del área útil y se desborda, que es visible y usable,
 * en vez de encogerse por debajo del mínimo operativo de la UI.
 */
export function clampToVisible(bounds: Rect, displays: Rect[], min: MinSize): Rect {
  // (2) Sin pantallas no hay referencia: solo se garantiza el mínimo.
  if (displays.length === 0) {
    const width = Math.max(min.width, Number.isFinite(bounds.width) ? bounds.width : min.width);
    const height = Math.max(min.height, Number.isFinite(bounds.height) ? bounds.height : min.height);
    return { x: bounds.x, y: bounds.y, width, height };
  }

  // (1) Entrada basura -> se comporta como "no hay estado": recentrar en la primera pantalla.
  if (!isValidRect(bounds)) {
    return centeredIn(displays[0], min.width, min.height, min);
  }

  // (3) Pantalla con la que más solapa.
  let target: Rect | null = null;
  let bestArea = 0;
  for (const d of displays) {
    const area = intersectionArea(bounds, d);
    if (area > bestArea) {
      bestArea = area;
      target = d;
    }
  }

  // (4) No solapa con ninguna: se recentra en la primera pantalla conservando el tamaño guardado.
  if (target === null) {
    return centeredIn(displays[0], bounds.width, bounds.height, min);
  }

  // (5) Solapa parcialmente: empujar lo mínimo para que quepa entera dentro de `target`.
  return pushInside(bounds, target, min);
}

/** Tamaño acotado al área útil de `display` sin bajar de `min`. Si `min` excede la pantalla, gana `min`. */
function fitSize(width: number, height: number, display: Rect, min: MinSize): { width: number; height: number } {
  return {
    width: Math.max(min.width, Math.min(width, display.width)),
    height: Math.max(min.height, Math.min(height, display.height)),
  };
}

/**
 * Centra una ventana del tamaño deseado (acotado al área útil y al mínimo) en `display`.
 * El tamaño deseado llega como parámetros sueltos porque se usa en dos casos: al recentrar por
 * falta de solape se conserva el tamaño del estado guardado, y al recentrar por entrada basura se
 * usa el mínimo (no hay tamaño en el que confiar).
 */
function centeredIn(display: Rect, desiredWidth: number, desiredHeight: number, min: MinSize): Rect {
  const { width, height } = fitSize(desiredWidth, desiredHeight, display, min);
  return {
    width,
    height,
    x: Math.round(display.x + (display.width - width) / 2),
    y: Math.round(display.y + (display.height - height) / 2),
  };
}

/**
 * Mueve `bounds` lo mínimo para que quede dentro de `display`, conservando el tamaño (acotado). El
 * `clamp` de x/y usa como tope `display.x + display.width - width`; cuando `width === display.width`
 * ese tope colapsa a `display.x`, y cuando `min` fuerza `width > display.width` el `clamp` deja x en
 * `display.x` (ancla a la izquierda) porque el rango queda invertido y gana el límite inferior.
 */
function pushInside(bounds: Rect, display: Rect, min: MinSize): Rect {
  const { width, height } = fitSize(bounds.width, bounds.height, display, min);
  const maxX = display.x + display.width - width;
  const maxY = display.y + display.height - height;
  return {
    width,
    height,
    x: clamp(bounds.x, display.x, Math.max(display.x, maxX)),
    y: clamp(bounds.y, display.y, Math.max(display.y, maxY)),
  };
}

/**
 * Escritura atómica del estado. `mkdir` por si el directorio de datos aún no existe (primer
 * arranque), luego `.tmp` + `rename`. Un fallo aquí se LOGUEA y se traga a propósito (ver cabecera):
 * no poder guardar la geometría es irrelevante para usar el programa.
 */
async function writeWindowState(filePath: string, state: WindowState): Promise<void> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state), "utf-8");
    await fs.rename(tmp, filePath);
  } catch (err) {
    console.error(`No se pudo guardar el estado de la ventana (${path.basename(filePath)}):`, err);
  }
}

/**
 * Guarda con DEBOUNCE. El caso de uso real es el evento `resize`/`move` de la ventana, que dispara
 * decenas de veces por segundo mientras se arrastra: escribir a disco en cada evento sería basura
 * innecesaria. `save(state)` reinicia el temporizador; solo se escribe una vez, `delayMs` después
 * de la ÚLTIMA llamada (por defecto 400 ms), con el estado más reciente.
 *
 * `flush()` fuerza la escritura pendiente de inmediato: `main.ts` lo llama en `before-quit`, cuando
 * ya no habrá más eventos ni tiempo de esperar el debounce. Devuelve `void` porque la escritura es
 * asíncrona (fs); dispara la promesa y no la espera —en un cierre no se puede bloquear el proceso—,
 * pero el `rename` atómico garantiza que el archivo queda bien aunque el proceso termine enseguida
 * en el caso normal.
 */
export function createWindowStateSaver(
  filePath: string,
  delayMs = 400
): {
  save(state: WindowState): void;
  flush(): void;
} {
  let timer: NodeJS.Timeout | null = null;
  // Estado pendiente de escribir. `null` = nada que escribir (ya se escribió o nunca se guardó).
  let pending: WindowState | null = null;

  function fire(): void {
    const state = pending;
    pending = null;
    if (state === null) return;
    void writeWindowState(filePath, state);
  }

  function cancelTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  return {
    save(state: WindowState): void {
      pending = state;
      cancelTimer();
      timer = setTimeout(() => {
        timer = null;
        fire();
      }, delayMs);
    },

    flush(): void {
      // Se cancela el temporizador y se escribe ya: si no había nada pendiente, `fire` no hace nada.
      cancelTimer();
      fire();
    },
  };
}
