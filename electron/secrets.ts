/**
 * Almacén de secretos de la app (fase 25, T1; decisiones D2-D4 de aquel PLAN). Vive en `main`, el único proceso con
 * `safeStorage` (cifrado del SO; en macOS la clave maestra está en el Keychain, ítem «<nombre de la app> Safe
 * Storage» — hoy «DataDB Safe Storage»).
 *
 * Qué guarda: las keys de IA de cada proveedor y el token del gateway. La fase 17 (R6) guardará aquí también las
 * contraseñas de las conexiones, por eso los nombres son un espacio genérico (`ai.*`, luego `db.<perfil>`), y no un
 * archivo por tipo de secreto.
 *
 * Reglas (no negociables, `.hermes.md` § Seguridad):
 *  - En disco solo hay blobs cifrados en base64 (`data/secrets.json`, permisos 0600). Nunca el valor en claro.
 *  - Si el cifrado del SO no está disponible, NO se guarda: error visible. Jamás se cae a texto plano.
 *  - El renderer puede guardar, borrar y preguntar «¿hay?»; NUNCA leer. Leer solo lo pide el worker, justo antes de
 *    llamar al proveedor (mensaje `secret-get` del protocolo main <-> worker).
 *  - Ningún log imprime un valor; los errores nombran el secreto, no su contenido.
 *
 * Sin imports de Electron: el cifrador se inyecta (en `main`, `safeStorage`; en los tests, uno falso), así se prueba
 * con node:test. La ruta se inyecta también: desde la fase 5 (R2) es el directorio de datos en `userData`.
 *
 * Fase 5 (T4), lo que obliga a que el archivo recuerde con qué NOMBRE de app se cifró: `safeStorage` deriva el ítem
 * del Keychain de `app.getName()`. Al renombrar el producto de GestorDB a DataDB, la clave maestra pasa a ser otra y
 * los blobs viejos quedan ilegibles para siempre. Medido en el spike de T1: NO hay forma de migrarlos (el `setName`
 * en caliente no cambia de ítem; lo cifrado después del renombre tampoco se descifra en el arranque siguiente). Así
 * que la regla es no fallar en silencio: al detectar el cambio de nombre se descartan los blobs inservibles, se anota
 * de qué nombre venían y la UI lo dice para que el usuario escriba la key una vez. Nunca un error críptico de
 * descifrado en mitad de una petición de IA.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import { SECRET_NAMES, isSecretName, type SecretName } from "@/shared/secrets";

export { SECRET_NAMES, isSecretName, type SecretName };

/** Tope de tamaño de un secreto: una key real mide < 200 caracteres; esto solo evita basura gigante. */
export const MAX_SECRET_LENGTH = 4096;

/** Lo que el almacén necesita del SO. En `main` es `safeStorage` (API async). */
export interface Cipher {
  isAvailable(): Promise<boolean>;
  encrypt(plain: string): Promise<Buffer>;
  /** `shouldReEncrypt`: la clave del SO rotó; el almacén re-cifra y guarda. */
  decrypt(blob: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

/**
 * Nombre de la app ANTES de la fase 5. Un `secrets.json` sin campo `appName` lo escribió esa versión, porque el campo
 * nació con el renombre: es el único caso posible, no una suposición.
 */
export const LEGACY_APP_NAME = "GestorDB";

interface SecretsFile {
  v: 1;
  /** Nombre de `app.getName()` con el que se cifraron estos blobs (fase 5). Ausente = `LEGACY_APP_NAME`. */
  appName?: string;
  /** Si el nombre cambió: de qué nombre venía, para que la UI lo diga UNA vez. Se borra al guardar una key nueva. */
  migratedFrom?: string;
  /** Secretos que se perdieron en ese cambio de nombre: la UI solo avisa en los campos afectados. */
  migratedSecrets?: SecretName[];
  /** nombre -> blob cifrado en base64 */
  secrets: Partial<Record<SecretName, string>>;
}

/** Lo que la UI necesita saber para explicar por qué una key dejó de estar. `null` = nada que explicar. */
export interface MigrationNotice {
  from: string;
  secrets: SecretName[];
}

export class SecretUnavailableError extends Error {
  constructor() {
    super(
      "El cifrado del sistema (Keychain) no está disponible: no se guarda el secreto. DataDB nunca guarda una " +
        "credencial en texto plano."
    );
    this.name = "SecretUnavailableError";
  }
}

export function createSecretStore(filePath: string, cipher: Cipher, appName: string = "DataDB") {
  /** ¿Existe el archivo? Distingue «no hay nada guardado» de «hay algo y es de otro nombre de app». */
  async function exists(): Promise<boolean> {
    try {
      await fs.stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async function read(): Promise<SecretsFile> {
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as SecretsFile;
      if (parsed?.v !== 1 || typeof parsed.secrets !== "object") throw new Error("formato desconocido");
      return parsed;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { v: 1, secrets: {} };
      // Un archivo corrupto no se sobrescribe a ciegas (se perderían los demás secretos): se informa.
      throw new Error(`No se pudo leer el almacén de secretos (${path.basename(filePath)}): ${String(err)}`);
    }
  }

  async function write(file: SecretsFile): Promise<void> {
    // Cada escritura sella con qué nombre de app se cifró, que es lo que permite detectar el renombre.
    file.appName = appName;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
    await fs.rename(tmp, filePath);
  }

  function assertName(name: unknown): asserts name is SecretName {
    if (!isSecretName(name)) throw new Error(`Nombre de secreto no permitido: ${String(name)}`);
  }

  return {
    async available(): Promise<boolean> {
      return cipher.isAvailable();
    },

    async set(name: SecretName, value: string): Promise<void> {
      assertName(name);
      if (typeof value !== "string" || !value.trim()) throw new Error("El valor está vacío");
      if (value.length > MAX_SECRET_LENGTH) throw new Error("El valor es demasiado largo");
      if (!(await cipher.isAvailable())) throw new SecretUnavailableError();
      const blob = await cipher.encrypt(value.trim());
      const file = await read();
      file.secrets[name] = blob.toString("base64");
      // El aviso de «se perdió al renombrar» se apaga solo en cuanto el usuario escribe la key de ese proveedor.
      if (file.migratedSecrets?.length) {
        file.migratedSecrets = file.migratedSecrets.filter((n) => n !== name);
        if (file.migratedSecrets.length === 0) {
          delete file.migratedSecrets;
          delete file.migratedFrom;
        }
      }
      await write(file);
    },

    /**
     * Fase 17: ¿hay algo guardado con ese nombre? Sirve para los nombres DINÁMICOS (`db.<id>`),
     * que `status()` no enumera. Solo devuelve un booleano: es lo único que puede cruzar al renderer.
     */
    async has(name: SecretName): Promise<boolean> {
      assertName(name);
      const file = await read();
      return Boolean(file.secrets[name]);
    },

    async get(name: SecretName): Promise<string | null> {
      assertName(name);
      const file = await read();
      const b64 = file.secrets[name];
      if (!b64) return null;
      if (!(await cipher.isAvailable())) throw new SecretUnavailableError();
      const { result, shouldReEncrypt } = await cipher.decrypt(Buffer.from(b64, "base64"));
      if (shouldReEncrypt) {
        file.secrets[name] = (await cipher.encrypt(result)).toString("base64");
        await write(file);
      }
      return result;
    },

    async delete(name: SecretName): Promise<void> {
      assertName(name);
      const file = await read();
      if (!(name in file.secrets)) return;
      delete file.secrets[name];
      await write(file);
    },

    /** Qué hay guardado (solo booleanos: esto SÍ puede llegar al renderer). */
    async status(): Promise<Record<SecretName, boolean>> {
      const file = await read();
      return Object.fromEntries(SECRET_NAMES.map((n) => [n, Boolean(file.secrets[n])])) as Record<SecretName, boolean>;
    },

    /**
     * Fase 5 (T4). Se llama UNA vez al arrancar, antes de que nadie pida un secreto.
     *
     * Si el archivo se cifró con otro nombre de app, sus blobs ya no se pueden descifrar (ver cabecera: medido, no
     * supuesto). En vez de dejar que el fallo aparezca más tarde como un error de descifrado incomprensible en mitad
     * de una petición de IA, aquí se descartan y se anota de dónde venían. Devuelve el aviso para loguearlo, o `null`
     * si no había nada que hacer (que es el caso de todos los arranques siguientes).
     *
     * Deliberadamente NO borra el ítem viejo del Keychain: no cuesta nada dejarlo y borrar credenciales del SO que ya
     * no son de esta app no es asunto suyo.
     */
    async reconcileAppName(): Promise<MigrationNotice | null> {
      if (!(await exists())) return null; // nunca se guardó nada: no hay nada que migrar ni que avisar
      const file = await read();
      const writtenBy = file.appName ?? LEGACY_APP_NAME;
      if (writtenBy === appName) return null; // el caso normal

      const perdidos = (Object.keys(file.secrets) as SecretName[]).filter(isSecretName);
      file.secrets = {};
      if (perdidos.length > 0) {
        file.migratedFrom = writtenBy;
        file.migratedSecrets = perdidos;
      }
      await write(file); // sella el nombre nuevo: esto no se vuelve a ejecutar
      return perdidos.length > 0 ? { from: writtenBy, secrets: perdidos } : null;
    },

    /** El aviso pendiente, para que la UI lo muestre junto al campo afectado. Solo nombres, nunca un valor. */
    async migrationNotice(): Promise<MigrationNotice | null> {
      const file = await read();
      if (!file.migratedFrom || !file.migratedSecrets?.length) return null;
      return { from: file.migratedFrom, secrets: file.migratedSecrets };
    },
  };
}

export type SecretStore = ReturnType<typeof createSecretStore>;
