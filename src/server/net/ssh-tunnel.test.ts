/**
 * Tests del túnel SSH. No abren una conexión de verdad: inyectan un `Client` falso para comprobar
 * las tres cosas que se rompen en silencio — que el reenvío llega al destino correcto, que la
 * autenticación usa la clave/contraseña adecuada, y que cerrar deja el puerto local muerto.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Duplex } from "node:stream";
import { connect } from "node:net";
import { abrirTunelSsh } from "./ssh-tunnel";
import type { SshConfig } from "@/shared/connection-net";

/** Cliente SSH falso: un `Duplex` por canal que devuelve lo que recibe, en mayúsculas. */
class ClienteFalso extends EventEmitter {
  opciones: Record<string, unknown> | null = null;
  reenvios: Array<{ host: string; port: number }> = [];
  cerrado = false;
  fallar = false;

  connect(opciones: Record<string, unknown>) {
    this.opciones = opciones;
    setTimeout(() => {
      if (this.fallar) this.emit("error", new Error("All configured authentication methods failed"));
      else this.emit("ready");
    }, 0);
  }

  forwardOut(_srcIp: string, _srcPort: number, host: string, port: number, cb: (err: Error | null, canal?: Duplex) => void) {
    this.reenvios.push({ host, port });
    const canal = new Duplex({
      read() {},
      write(chunk, _enc, done) {
        this.push(String(chunk).toUpperCase());
        done();
      },
    });
    cb(null, canal);
  }

  end() {
    this.cerrado = true;
    this.emit("close");
  }

  destroy() {
    this.cerrado = true;
  }
}

/** `abrirTunelSsh` hace `new Ctor()`: esta fábrica devuelve siempre la MISMA instancia para poder
 * inspeccionarla después. Una flecha no sirve (`new` sobre una flecha lanza), de ahí la función. */
function fabrica(cliente: ClienteFalso) {
  return function () {
    return cliente;
  } as unknown as typeof import("ssh2").Client;
}

const configBase: SshConfig = {
  enabled: true,
  host: "jump.interno",
  port: 2222,
  user: "dev",
  auth: "password",
};

test("el túnel reenvía al destino REAL y devuelve el puerto local", async () => {
  const falso = new ClienteFalso();
  const tunel = await abrirTunelSsh(
    configBase,
    { host: "mongo.interno", port: 27017 },
    { password: "secreto" },
    { ClientCtor: fabrica(falso), leerArchivo: async () => "" }
  );
  assert.equal(tunel.host, "127.0.0.1");
  assert.ok(tunel.port > 0);
  // El host real se expone aparte: es contra él que se valida el certificado TLS.
  assert.equal(tunel.hostDestino, "mongo.interno");

  const eco = await new Promise<string>((resolver, rechazar) => {
    const socket = connect(tunel.port, "127.0.0.1", () => socket.write("hola"));
    socket.once("data", (d) => {
      socket.end();
      resolver(String(d));
    });
    socket.once("error", rechazar);
  });
  assert.equal(eco, "HOLA");
  assert.deepEqual(falso.reenvios[0], { host: "mongo.interno", port: 27017 });
  await tunel.cerrar();
});

test("autenticación por contraseña: viaja al salto y no queda en el objeto devuelto", async () => {
  const falso = new ClienteFalso();
  const tunel = await abrirTunelSsh(
    configBase,
    { host: "mongo.interno", port: 27017 },
    { password: "secreto" },
    { ClientCtor: fabrica(falso), leerArchivo: async () => "" }
  );
  assert.equal(falso.opciones?.password, "secreto");
  assert.equal(falso.opciones?.username, "dev");
  assert.equal(falso.opciones?.port, 2222);
  assert.equal(JSON.stringify(tunel).includes("secreto"), false);
  await tunel.cerrar();
});

test("autenticación por clave: lee el archivo y pasa la frase de paso", async () => {
  const falso = new ClienteFalso();
  let leido = "";
  await abrirTunelSsh(
    { ...configBase, auth: "key", keyFile: "~/.ssh/id_ed25519" },
    { host: "mongo.interno", port: 27017 },
    { passphrase: "frase" },
    {
      ClientCtor: fabrica(falso),
      leerArchivo: async (ruta) => {
        leido = ruta;
        return "-----BEGIN KEY-----";
      },
    }
  );
  assert.equal(leido, "~/.ssh/id_ed25519");
  assert.equal(falso.opciones?.privateKey, "-----BEGIN KEY-----");
  assert.equal(falso.opciones?.passphrase, "frase");
  assert.equal(falso.opciones?.password, undefined);
});

test("si el salto rechaza la autenticación, falla con un mensaje de SSH", async () => {
  const falso = new ClienteFalso();
  falso.fallar = true;
  await assert.rejects(
    () =>
      abrirTunelSsh(
        configBase,
        { host: "mongo.interno", port: 27017 },
        { password: "mala" },
        { ClientCtor: fabrica(falso), leerArchivo: async () => "" }
      ),
    /SSH: All configured authentication methods failed/
  );
});

test("cerrar el túnel deja el puerto local sin aceptar conexiones", async () => {
  const falso = new ClienteFalso();
  const tunel = await abrirTunelSsh(
    configBase,
    { host: "mongo.interno", port: 27017 },
    { password: "secreto" },
    { ClientCtor: fabrica(falso), leerArchivo: async () => "" }
  );
  await tunel.cerrar();
  await assert.rejects(
    () =>
      new Promise((_resolver, rechazar) => {
        const socket = connect(tunel.port, "127.0.0.1");
        socket.once("error", rechazar);
        socket.once("connect", () => {
          socket.destroy();
          rechazar(new Error("el puerto sigue abierto"));
        });
      }),
    /ECONNREFUSED|el puerto sigue abierto/
  );
  assert.equal(falso.cerrado, true);
});

test("un perfil con clave pero sin ruta no abre nada", async () => {
  const falso = new ClienteFalso();
  await assert.rejects(
    () =>
      abrirTunelSsh(
        { ...configBase, auth: "key" },
        { host: "mongo.interno", port: 27017 },
        {},
        { ClientCtor: fabrica(falso), leerArchivo: async () => "" }
      ),
    /falta la clave privada/
  );
  assert.equal(falso.opciones, null);
});
