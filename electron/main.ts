/**
 * Proceso principal de Electron.
 *
 * Fase 2: ademas de la ventana, `main` es el BROKER entre el renderer y el db-worker
 * (utilityProcess que aloja sesiones, pools y drivers; R50). `main` no toca ninguna base de
 * datos: valida el remitente, aplica la lista blanca de canales y reenvia.
 *
 *   renderer --invoke--> main (valida) --postMessage--> db-worker --> drivers
 *
 * Si el worker muere: la ventana sigue viva, lo pendiente se resuelve con un error claro y
 * el worker se relanza. Las sesiones se pierden y la auto-reconexion del editor las recrea.
 */
import { app, BrowserWindow, dialog, ipcMain, safeStorage, screen, shell, utilityProcess } from "electron";
import type { UtilityProcess } from "electron";
import path from "node:path";
import { INVOKE_CHANNELS, EVENT_CHANNELS, MAIN_CHANNELS, type MainChannel } from "@/shared/contract";
import type { FromWorker, ToWorker } from "@/shared/worker-protocol";
import { opcionesDeArchivo } from "@/shared/file-dialog";
import { createBroker } from "./broker";
import { isTrustedSenderUrl } from "./sender";
import { createSecretStore, isSecretName } from "./secrets";
import { APP_NAME, prepararDirectorioDeDatos, rutaDeDato } from "./data-location";
import { actualizarEstadoMenu, instalarMenu } from "./menu";
import { clampToVisible, createWindowStateSaver, readWindowState } from "./window-state";
import type { MenuState } from "@/shared/menu-actions";

const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;
let mainWindow: BrowserWindow | null = null;

// ---------------------------------------------------------------------------------------
// Identidad y rutas (fase 5: R2 y R54). TODO esto va antes de `ready`, ver electron/data-location.ts.
// ---------------------------------------------------------------------------------------

// Fase 25 (D5) + fase 5 (R54): nombre fijo ANTES de `ready`. `safeStorage` guarda su clave maestra en el Keychain bajo
// «<nombre de la app> Safe Storage»; sin esto, en desarrollo el ítem se llamaría según package.json y, empaquetada,
// según el bundle: los secretos cifrados con uno no se podrían descifrar con el otro.
app.setName(APP_NAME);

// Fase 5 (R2): el directorio de datos se fija A MANO. Medido: `setName` NO mueve `userData` (Electron lo resuelve al
// arrancar y lo cachea), así que sin este `setPath` los datos seguirían cayendo en el directorio del `name` del
// package.json. Va antes de `whenReady` para que Chromium no empiece a escribir en el sitio viejo.
const dataLocation = prepararDirectorioDeDatos(app.getPath("appData"), app.getAppPath(), process.env);
app.setPath("userData", dataLocation.dir);
for (const linea of dataLocation.migraciones) console.log("[main] migración:", linea);

// ---------------------------------------------------------------------------------------
// Almacén de secretos (fase 25; D2-D4). Solo `main` cifra y descifra.
// ---------------------------------------------------------------------------------------
const secrets = createSecretStore(
  rutaDeDato(dataLocation.dir, "secrets"),
  {
    isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptStringAsync(plain),
    decrypt: (blob) => safeStorage.decryptStringAsync(blob),
  },
  APP_NAME
);

/** Canales del renderer que atiende `main` (MAIN_CHANNELS). Nunca devuelven un valor de secreto. */
async function handleMainChannel(channel: MainChannel, payload: unknown) {
  const p = (payload ?? {}) as { name?: unknown; value?: unknown; titulo?: unknown; extensiones?: unknown };
  try {
    switch (channel) {
      case "secrets:set":
        if (!isSecretName(p.name)) return { ok: false, error: { message: "Nombre de secreto no permitido", status: 400 } };
        await secrets.set(p.name, typeof p.value === "string" ? p.value : "");
        return { ok: true, data: { ok: true } };
      case "secrets:delete":
        if (!isSecretName(p.name)) return { ok: false, error: { message: "Nombre de secreto no permitido", status: 400 } };
        await secrets.delete(p.name);
        return { ok: true, data: { ok: true } };
      /*
       * Fase 80: elegir un archivo (CA, certificado, clave) con el panel del sistema en vez de
       * escribiendo la ruta a mano. Se pide `showHiddenFiles` porque las claves SSH viven en
       * `~/.ssh`, que el panel esconde por defecto; y `openFile` solo, nunca `openDirectory`.
       * La ruta se devuelve tal cual la da el sistema (absoluta, sin resolver `~`).
       */
      case "files:pick": {
        const opciones = opcionesDeArchivo(
          typeof p.titulo === "string" ? p.titulo : undefined,
          Array.isArray(p.extensiones) ? p.extensiones.filter((e): e is string => typeof e === "string") : []
        );
        // Sin ventana padre el panel sale como ventana suelta en macOS y no queda pegado a la app.
        const r = mainWindow
          ? await dialog.showOpenDialog(mainWindow, opciones)
          : await dialog.showOpenDialog(opciones);
        if (r.canceled || r.filePaths.length === 0) return { ok: true, data: { path: null } };
        return { ok: true, data: { path: r.filePaths[0] } };
      }
      // Fase 6 (R5): el renderer dice qué se puede hacer ahora mismo y el menú se repinta en gris.
      case "menu:state":
        actualizarEstadoMenu(normalizarEstadoMenu(payload));
        return { ok: true, data: { ok: true } };
      case "secrets:status":
        return {
          ok: true,
          data: {
            available: await secrets.available(),
            stored: await secrets.status(),
            // Fase 5 (T4): si el renombre del producto dejó una key ilegible, la UI tiene que poder decirlo.
            migration: await secrets.migrationNotice(),
          },
        };
    }
  } catch (err) {
    // El mensaje nombra la operación, nunca el valor.
    console.error(`[main] ${channel} falló:`, err instanceof Error ? err.message : String(err));
    return { ok: false, error: { message: err instanceof Error ? err.message : String(err), status: 500 } };
  }
}

/**
 * Fase 6: el payload viene del renderer, así que no se confía en su forma. Cinco booleanos, y lo
 * que no sea booleano cuenta como `false` (el menú se queda corto en vez de ofrecer de más).
 */
function normalizarEstadoMenu(payload: unknown): MenuState {
  const p = (payload ?? {}) as Partial<Record<keyof MenuState, unknown>>;
  const b = (v: unknown) => v === true;
  return {
    connected: b(p.connected),
    queryRunning: b(p.queryRunning),
    txManual: b(p.txManual),
    txActive: b(p.txActive),
    hasSql: b(p.hasSql),
  };
}

/** Respuesta a un `secret-request` del worker (fase 25). */
async function answerSecretRequest(self: UtilityProcess, msg: Extract<FromWorker, { kind: "secret-request" }>) {
  let reply: ToWorker;
  try {
    // Fase 17: el worker también GUARDA secretos (la contraseña de un perfil, al crear o editar la
    // conexión) y pregunta por uno concreto. Leer sigue siendo exclusivo del worker; el renderer no
    // puede llamar aquí.
    if (msg.op === "has") {
      reply = { kind: "secret-response", id: msg.id, has: await secrets.has(msg.name) };
    } else if (msg.op === "set") {
      // El valor es obligatorio en `set`: sin él, el almacén lanzaría un error genérico.
      if (typeof msg.value !== "string" || !msg.value) throw new Error("El secreto llegó vacío");
      await secrets.set(msg.name, msg.value);
      reply = { kind: "secret-response", id: msg.id, has: true };
    } else if (msg.op === "delete") {
      await secrets.delete(msg.name);
      reply = { kind: "secret-response", id: msg.id, has: false };
    } else {
      reply = { kind: "secret-response", id: msg.id, value: await secrets.get(msg.name) };
    }
  } catch (err) {
    console.error(`[main] no se pudo leer el secreto ${msg.name}:`, err instanceof Error ? err.message : String(err));
    reply = { kind: "secret-response", id: msg.id, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(reply);
}

// ---------------------------------------------------------------------------------------
// db-worker (utilityProcess)
// ---------------------------------------------------------------------------------------
let worker: UtilityProcess | null = null;
let quitting = false;
const crashTimes: number[] = [];
const MAX_CRASHES = 3; // en CRASH_WINDOW_MS; despues se deja de relanzar para no entrar en bucle
const CRASH_WINDOW_MS = 10_000;

const broker = createBroker(
  (msg) => worker?.postMessage(msg),
  (name, payload) => {
    // Solo eventos de la lista blanca llegan al renderer.
    if ((EVENT_CHANNELS as readonly string[]).includes(name)) {
      mainWindow?.webContents.send(name, payload);
    }
  }
);

function prefixLines(prefix: string, chunk: Buffer, log: (...a: unknown[]) => void): void {
  for (const line of chunk.toString().split("\n")) if (line.trim()) log(prefix, line);
}

function startWorker(): void {
  // Fase 5 (R2): el worker no tiene `app`, así que no puede resolver `userData` por su cuenta. `main` se lo pasa ya
  // resuelto por el entorno y `src/server/data-dir.ts` falla fuerte si no llega: nada de caer a un valor relativo al
  // cwd, que es justo el bug que esta fase elimina.
  // Fase 25 (D6): la key de IA por variable de entorno es solo un respaldo de DESARROLLO. Empaquetada, el worker no
  // recibe esas variables: la única fuente es el almacén cifrado.
  const env: NodeJS.ProcessEnv = { ...process.env, DATADB_DATA_DIR: dataLocation.dir };
  if (app.isPackaged) for (const k of Object.keys(env)) if (/^(OPENROUTER|OPENAI)_/.test(k)) delete env[k];
  worker = utilityProcess.fork(path.join(__dirname, "db-worker.js"), [], {
    serviceName: `${APP_NAME} DB`,
    stdio: "pipe",
    // El cwd ya no determina dónde escribe nada (eso lo hace DATADB_DATA_DIR); se fija igualmente para que un
    // `path.resolve` accidental en una dependencia no apunte a un directorio impredecible.
    cwd: app.getAppPath(),
    env,
  });
  const self = worker;

  // Los errores se loguean donde ocurren, no se tragan: stdout/stderr del worker a la
  // consola de main con prefijo.
  self.stdout?.on("data", (c: Buffer) => prefixLines("[db-worker]", c, console.log));
  self.stderr?.on("data", (c: Buffer) => prefixLines("[db-worker]", c, console.error));

  self.on("message", (msg: FromWorker) => {
    if (msg.kind === "ready") console.log("[main] db-worker listo (pid", self.pid, ")");
    else if (msg.kind === "shutdown-done") shutdownResolve?.();
    else if (msg.kind === "secret-request") void answerSecretRequest(self, msg);
    else broker.onWorkerMessage(msg);
  });

  self.on("exit", (code) => {
    if (worker === self) worker = null;
    if (quitting) return;
    console.error(`[main] db-worker termino inesperadamente (codigo ${code}).`);
    broker.failAll("El proceso de base de datos se reinicio. Vuelve a ejecutar.");

    const now = Date.now();
    crashTimes.push(now);
    while (crashTimes.length && now - crashTimes[0] > CRASH_WINDOW_MS) crashTimes.shift();
    if (crashTimes.length > MAX_CRASHES) {
      console.error("[main] db-worker se cae en bucle; no se relanza. Reinicia la app.");
      return;
    }
    startWorker();
  });
}

let shutdownResolve: (() => void) | null = null;
async function stopWorker(): Promise<void> {
  const self = worker;
  if (!self) return;
  await Promise.race([
    new Promise<void>((resolve) => {
      shutdownResolve = resolve;
      self.postMessage({ kind: "shutdown" });
    }),
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]);
  // Si no cerro a tiempo, kill() manda SIGTERM y sessions.ts cierra los pools en ese handler.
  self.kill();
}

// ---------------------------------------------------------------------------------------
// Canales IPC
// ---------------------------------------------------------------------------------------
function registerIpc(): void {
  for (const channel of INVOKE_CHANNELS) {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      // Frontera de confianza: nada llega al worker sin pasar por aqui.
      const trusted =
        event.sender === mainWindow?.webContents &&
        isTrustedSenderUrl(event.senderFrame?.url, RENDERER_DEV_URL);
      if (!trusted) {
        console.error(`[main] remitente no autorizado en ${channel}:`, event.senderFrame?.url);
        return { ok: false, error: { message: "Remitente no autorizado", status: 401 } };
      }
      if ((MAIN_CHANNELS as readonly string[]).includes(channel)) {
        return handleMainChannel(channel as MainChannel, payload);
      }
      if (!worker) {
        return {
          ok: false,
          error: { message: "El proceso de base de datos no esta disponible.", status: 500 },
        };
      }
      return broker.request(channel, payload);
    });
  }
}

// ---------------------------------------------------------------------------------------
// Ventana
// ---------------------------------------------------------------------------------------
/** Tamaño por defecto la primera vez, y mínimo que se respeta siempre. */
const VENTANA_POR_DEFECTO = { width: 1440, height: 900 };
const VENTANA_MINIMA = { width: 1024, height: 640 };

/**
 * Fase 6 (R5, T1): guarda la geometría con debounce. Vive fuera de `createWindow` para que el
 * cierre ordenado pueda hacerle `flush()` sin depender de que la ventana siga viva.
 */
const guardarVentana = createWindowStateSaver(rutaDeDato(dataLocation.dir, "windowState"));

function createWindow(): void {
  // Geometría recordada, acotada a una pantalla que exista AHORA: cerrar con un monitor externo
  // conectado y abrir sin él no puede dejar la ventana fuera de la pantalla.
  const guardada = readWindowState(rutaDeDato(dataLocation.dir, "windowState"));
  const areasUtiles = screen.getAllDisplays().map((d) => d.workArea);
  const bounds = guardada
    ? clampToVisible(guardada.bounds, areasUtiles, VENTANA_MINIMA)
    : null;

  const win = new BrowserWindow({
    ...(bounds ?? VENTANA_POR_DEFECTO),
    minWidth: VENTANA_MINIMA.width,
    minHeight: VENTANA_MINIMA.height,
    show: false,
    // Barra de titulo estilo IntelliJ: los semaforos de macOS sobre el chrome de la app.
    titleBarStyle: "hiddenInset",
    // Fondo del editor Darcula (#2B2B2B): evita el flash blanco antes del primer paint.
    backgroundColor: "#2B2B2B",
    webPreferences: {
      // electron-vite compila cada entrada con el nombre de su archivo fuente:
      // electron/preload.ts -> out/preload/preload.js (verificado con el script build:desktop).
      preload: path.join(__dirname, "../preload/preload.js"),
      // R3: el renderer no tiene Node. Todo acceso pasa por el preload con superficie explicita.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;

  // D3 (decisión del usuario): se restaura el maximizado, pero NUNCA la pantalla completa. Si la
  // cerraste en pantalla completa, reabre en ventana.
  if (guardada?.maximized) win.maximize();

  // Fase 6: el menú necesita saber a qué ventana mandarle las acciones.
  instalarMenu(win);

  // La geometría se anota en cada cambio; el saver hace el debounce. `getNormalBounds` da el
  // tamaño de la ventana SIN maximizar, que es lo que hay que recordar para poder restaurarla.
  const anotar = () => guardarVentana.save({ bounds: win.getNormalBounds(), maximized: win.isMaximized() });
  win.on("resize", anotar);
  win.on("move", anotar);
  win.on("maximize", anotar);
  win.on("unmaximize", anotar);

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  win.once("ready-to-show", () => win.show());

  // Cualquier enlace externo va al navegador del sistema, nunca a una ventana de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (RENDERER_DEV_URL) {
    // Desarrollo: servidor de Vite con hot reload.
    void win.loadURL(RENDERER_DEV_URL);
  } else {
    // Produccion: HTML ya compilado dentro del bundle.
    void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

void app.whenReady().then(async () => {
  // Fase 5 (T4): si los secretos se cifraron con el nombre de app anterior, sus blobs ya no se pueden descifrar
  // (medido en el spike de T1: la clave maestra del Keychain cuelga de `app.getName()` y no hay forma de migrarla).
  // Se resuelve AQUÍ, antes de que el worker pueda pedir un secreto, para que el fallo no aparezca más tarde como un
  // error de descifrado incomprensible en mitad de una petición de IA. `safeStorage` exige `ready`, de ahí que esto
  // no esté arriba con el resto de la preparación de rutas.
  try {
    const aviso = await secrets.reconcileAppName();
    if (aviso) {
      console.warn(
        `[main] la app se llamaba «${aviso.from}»: ${aviso.secrets.length} secreto(s) quedaron ilegibles al renombrarla ` +
          `(${aviso.secrets.join(", ")}). Hay que volver a escribirlos en Ajustes; la UI lo avisa.`
      );
    }
  } catch (err) {
    // Que esto falle no puede impedir que la app arranque: sin secretos, la IA pide la key y el resto funciona igual.
    console.error("[main] no se pudo revisar el almacén de secretos:", err instanceof Error ? err.message : String(err));
  }

  startWorker();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// DataDB es de ventana unica: sin ventana no hay nada que hacer, asi que se cierra
// (incluso en macOS, donde lo habitual seria seguir vivo).
app.on("window-all-closed", () => app.quit());

// Cierre ordenado: el worker cierra los pools antes de que la app termine (maximo 3 s).
app.on("before-quit", (event) => {
  if (quitting) return;
  quitting = true;
  // Fase 6: el saver de la geometría tiene debounce; si el usuario redimensiona y cierra de
  // inmediato, lo último no se habría escrito. `flush()` lo fuerza antes de que el proceso muera.
  guardarVentana.flush();
  event.preventDefault();
  void stopWorker().finally(() => app.quit());
});
