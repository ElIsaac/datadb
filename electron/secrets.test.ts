import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSecretStore, SecretUnavailableError, type Cipher } from "./secrets";

/** Cifrador falso pero no trivial: invierte y prefija, para que el valor NO aparezca en claro en el archivo. */
function fakeCipher(opts: { available?: boolean; rotate?: boolean } = {}): Cipher & { encrypts: number } {
  const c = {
    encrypts: 0,
    async isAvailable() {
      return opts.available ?? true;
    },
    async encrypt(plain: string) {
      c.encrypts++;
      return Buffer.from("ENC:" + [...plain].reverse().join(""));
    },
    async decrypt(blob: Buffer) {
      const s = blob.toString();
      assert.ok(s.startsWith("ENC:"));
      return { result: [...s.slice(4)].reverse().join(""), shouldReEncrypt: opts.rotate ?? false };
    },
  };
  return c;
}

async function tmpFile() {
  const dir = await mkdtemp(path.join(process.env.TMPDIR ?? os.tmpdir(), "secrets-"));
  return { file: path.join(dir, "secrets.json"), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const KEY = "sk-or-v1-abcdef0123456789";

test("guardar, leer, estado y borrar; el valor nunca está en claro en disco", async () => {
  const { file, cleanup } = await tmpFile();
  try {
    const store = createSecretStore(file, fakeCipher());
    assert.equal(await store.get("ai.openrouter"), null);
    await store.set("ai.openrouter", `  ${KEY}  `);
    const raw = await readFile(file, "utf-8");
    assert.ok(!raw.includes(KEY), "el archivo no contiene la key en claro");
    assert.equal((await stat(file)).mode & 0o777, 0o600, "permisos 0600");
    assert.equal(await store.get("ai.openrouter"), KEY, "se recorta y se recupera");
    assert.deepEqual(await store.status(), { "ai.openrouter": true, "ai.openai": false, "ai.gateway": false });
    await store.delete("ai.openrouter");
    assert.equal(await store.get("ai.openrouter"), null);
  } finally {
    await cleanup();
  }
});

test("sin cifrado del sistema no se guarda nada (nunca texto plano)", async () => {
  const { file, cleanup } = await tmpFile();
  try {
    const store = createSecretStore(file, fakeCipher({ available: false }));
    await assert.rejects(() => store.set("ai.openrouter", KEY), SecretUnavailableError);
    await assert.rejects(() => readFile(file), /ENOENT/);
  } finally {
    await cleanup();
  }
});

test("nombres fuera de la lista cerrada, valores vacíos o enormes → error", async () => {
  const { file, cleanup } = await tmpFile();
  try {
    const store = createSecretStore(file, fakeCipher());
    await assert.rejects(() => store.set("db.prod" as never, "x"), /no permitido/);
    await assert.rejects(() => store.get("../etc" as never), /no permitido/);
    await assert.rejects(() => store.set("ai.openai", "   "), /vacío/);
    await assert.rejects(() => store.set("ai.openai", "x".repeat(5000)), /largo/);
  } finally {
    await cleanup();
  }
});

test("si la clave del SO rotó, se re-cifra y se guarda al leer", async () => {
  const { file, cleanup } = await tmpFile();
  try {
    const cipher = fakeCipher({ rotate: true });
    const store = createSecretStore(file, cipher);
    await store.set("ai.gateway", "tok");
    const before = cipher.encrypts;
    assert.equal(await store.get("ai.gateway"), "tok");
    assert.equal(cipher.encrypts, before + 1);
  } finally {
    await cleanup();
  }
});

test("un archivo corrupto no se sobrescribe a ciegas", async () => {
  const { file, cleanup } = await tmpFile();
  try {
    await writeFile(file, "{ no es json");
    const store = createSecretStore(file, fakeCipher());
    await assert.rejects(() => store.set("ai.openai", "k"), /No se pudo leer el almacén/);
    assert.equal(await readFile(file, "utf-8"), "{ no es json");
  } finally {
    await cleanup();
  }
});
