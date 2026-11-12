/**
 * Túnel SSH para llegar a una base que no está expuesta (decisión del usuario, 2026-10-20: su
 * MongoDB se alcanza por un proxy SSH, con TLS y autenticación normal encima).
 *
 * CÓMO FUNCIONA: se abre un `Client` de `ssh2` contra el salto y se levanta un servidor TCP en
 * `127.0.0.1` con puerto efímero. Cada conexión local se reenvía por el canal SSH al destino real
 * (`forwardOut`). El driver, entonces, habla con `127.0.0.1:<puerto>` como si la base estuviera en
 * la propia máquina — no sabe que hay un salto en medio, y eso es lo que permite que TLS siga
 * funcionando igual (el certificado se valida contra el host REAL, que es lo que el usuario espera).
 *
 * TRAMPAS QUE ESTÁN RESUELTAS AQUÍ:
 *  - **El `host` del certificado.** Al conectar por `127.0.0.1`, el driver validaría el certificado
 *    contra `127.0.0.1` y fallaría. Por eso `hostDestino` se expone aparte: el driver lo usa como
 *    `tlsServerName`/SNI (ver `mongodb.ts`).
 *  - **Cierre ordenado.** `close()` cierra primero el servidor local (no acepta más conexiones),
 *    luego el cliente SSH. Si el SSH se cae solo, se cierra el servidor para que el driver no se
 *    quede conectando a un puerto muerto.
 *  - **Sin logs de credenciales.** Ni la contraseña ni la clave privada se imprimen; los errores se
 *    reportan con el `message` del propio `ssh2`, que no las incluye.
 */
import { createServer, type Server, type Socket } from "node:net";
import { readFile } from "node:fs/promises";
import { Client } from "ssh2";
import type { SshConfig } from "@/shared/connection-net";

export interface TunelSsh {
  /** Host local al que hay que conectar (siempre `127.0.0.1`). */
  host: string;
  /** Puerto local efímero. */
  port: number;
  /** Host REAL del destino, para validar el certificado TLS contra él. */
  hostDestino: string;
  /** Puerto REAL del destino. */
  puertoDestino: number;
  /**
   * Motivo del último reenvío rechazado por el salto, o `null`. Sirve para algo muy concreto: si el
   * `sshd` del salto tiene `AllowTcpForwarding no`, el socket local se cierra sin más y el driver
   * reporta «socket disconnected», que no dice nada. Con esto el mensaje añade el motivo real.
   */
  motivoFallo(): string | null;
  cerrar(): Promise<void>;
}

export interface SecretosSsh {
  /** Contraseña del usuario del salto (`auth: "password"`). */
  password?: string;
  /** Frase de paso de la clave privada (`auth: "key"`). */
  passphrase?: string;
}

const TIMEOUT_MS = 20_000;

/**
 * Abre el túnel. Lanza con un mensaje legible si el salto rechaza la autenticación o no responde:
 * el formulario lo muestra tal cual, y en el log queda sin credenciales.
 */
export async function abrirTunelSsh(
  config: SshConfig,
  destino: { host: string; port: number },
  secretos: SecretosSsh,
  deps: { ClientCtor?: typeof Client; leerArchivo?: (ruta: string) => Promise<string> } = {}
): Promise<TunelSsh> {
  const Ctor = deps.ClientCtor ?? Client;
  const leer = deps.leerArchivo ?? ((ruta: string) => readFile(ruta, "utf8"));

  const opciones: Parameters<Client["connect"]>[0] = {
    host: config.host,
    port: config.port,
    username: config.user,
    readyTimeout: TIMEOUT_MS,
  };
  if (config.auth === "key") {
    if (!config.keyFile) throw new Error("SSH: falta la clave privada");
    // La clave se lee aquí y no se guarda en el perfil: el JSON solo tiene la ruta.
    opciones.privateKey = await leer(config.keyFile);
    if (secretos.passphrase) opciones.passphrase = secretos.passphrase;
  } else {
    opciones.password = secretos.password ?? "";
  }

  const cliente = new Ctor();
  const conectado = new Promise<void>((resolver, rechazar) => {
    const temporizador = setTimeout(() => {
      cliente.destroy();
      rechazar(new Error(`SSH: el salto ${config.host}:${config.port} no respondió en ${TIMEOUT_MS / 1000} s`));
    }, TIMEOUT_MS);

    cliente.once("ready", () => {
      clearTimeout(temporizador);
      resolver();
    });
    cliente.once("error", (err) => {
      clearTimeout(temporizador);
      rechazar(new Error(`SSH: ${err.message}`));
    });
  });

  cliente.connect(opciones);
  await conectado;

  let errorDeReenvio: string | null = null;

  // Servidor local en un puerto efímero (0 = el SO elige uno libre: dos túneles no chocan).
  const servidor: Server = createServer((socket: Socket) => {
    cliente.forwardOut("127.0.0.1", socket.remotePort ?? 0, destino.host, destino.port, (err, canal) => {
      if (err) {
        // Un salto con `AllowTcpForwarding no` llega aquí: se guarda el motivo para que el driver
        // pueda decir qué pasó en vez de «socket disconnected».
        errorDeReenvio = err.message;
        socket.destroy();
        return;
      }
      socket.pipe(canal).pipe(socket);
      canal.on("error", () => socket.destroy());
      socket.on("error", () => canal.destroy());
    });
  });

  const puerto = await new Promise<number>((resolver, rechazar) => {
    servidor.once("error", (err) => rechazar(new Error(`SSH: no se pudo abrir el puerto local (${err.message})`)));
    /*
     * `unref()`: un túnel abierto no debe impedir que el proceso termine. En la app no cambia nada
     * (la ventana mantiene vivo el proceso), pero en las pruebas y en un worker que se cierra, un
     * servidor escuchando dejaba el proceso colgado para siempre.
     */
    servidor.unref();
    servidor.listen(0, "127.0.0.1", () => {
      const dir = servidor.address();
      if (dir && typeof dir === "object") resolver(dir.port);
      else rechazar(new Error("SSH: el túnel no devolvió un puerto local"));
    });
  });

  let cerrado = false;
  const cerrar = async () => {
    if (cerrado) return;
    cerrado = true;
    await new Promise<void>((resolver) => servidor.close(() => resolver()));
    cliente.end();
    // Un `end()` puede quedarse esperando al otro extremo: se destruye tras un margen corto.
    setTimeout(() => cliente.destroy(), 500).unref?.();
  };

  // Si el salto se cae por su cuenta, el servidor local se cierra para no dejar un puerto muerto.
  cliente.on("close", () => {
    if (!cerrado) {
      cerrado = true;
      servidor.close();
    }
  });

  return {
    host: "127.0.0.1",
    port: puerto,
    hostDestino: destino.host,
    puertoDestino: destino.port,
    motivoFallo: () => errorDeReenvio,
    cerrar,
  };
}
