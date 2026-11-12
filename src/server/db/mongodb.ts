/**
 * Driver de MongoDB — SOLO CONEXIÓN, por ahora.
 *
 * Decisión del usuario (2026-10-20): «pasemos por la conexión a Mongo, solo que aquí la vista va a
 * cambiar; primero pasemos por la conexión». Su MongoDB se alcanza con TLS por archivos y a través
 * de un proxy SSH, con autenticación normal (SCRAM). Este driver cubre exactamente eso:
 *
 *   - abrir el túnel SSH si el perfil lo pide (ver `src/server/net/ssh-tunnel.ts`),
 *   - leer los PEM de TLS y pasarlos al driver oficial,
 *   - autenticarse contra `authSource` (por defecto `admin`),
 *   - `ping`, `listDatabases` y listar las colecciones de la base (el árbol ya tiene qué mostrar).
 *
 * Lo que NO hace, y lo dice con un error explícito en vez de devolver algo vacío: ejecutar
 * consultas, DDL, transacciones y EXPLAIN. Implementar `executeQuery` a base de `find` sería fingir
 * que hay SQL: cuando llegue la vista de Mongo, tendrá su propio camino (aggregation pipeline) y su
 * propio editor. Un error honesto es mejor que una rejilla vacía que parece un fallo de red.
 */
import { BSON, MongoClient, type Document, type MongoClientOptions } from "mongodb";
import { normalizarConsulta } from "@/shared/mongo-query";

// `mongodb` no exporta `EJSON` suelto; viene dentro del espacio de nombres `BSON`.
const { EJSON } = BSON;
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";
import type { ConnectionProfile, ExplainNode, QueryResult, SchemaNode } from "@/lib/types";
import type { MongoFindResult } from "@/shared/mongo-view";
import type { DatabaseDriver } from "./types";
import { abrirTunelSsh, type TunelSsh } from "@/server/net/ssh-tunnel";
import { normalizarSsh, normalizarTls, problemasDeRed, type SshConfig, type TlsConfig } from "@/shared/connection-net";

/** Error de una operación que todavía no existe para Mongo (la vista llega después). */
const SIN_VISTA = "MongoDB: la conexión funciona, pero la vista de consultas todavía no está.";

export class MongodbDriver implements DatabaseDriver {
  private readonly config: ConnectionProfile;
  private cliente: MongoClient | null = null;
  private tunel: TunelSsh | null = null;
  private conectando: Promise<MongoClient> | null = null;

  constructor(config: ConnectionProfile) {
    this.config = config;
  }

  /** TLS normalizado (siempre presente, aunque sea «deshabilitado»). */
  private get tls(): TlsConfig {
    return normalizarTls(this.config.tls);
  }

  private get ssh(): SshConfig {
    return normalizarSsh(this.config.ssh);
  }

  /**
   * Abre la conexión perezosamente y la reutiliza. El túnel se abre UNA vez y se reutiliza para
   * todas las conexiones del pool: abrir uno por operación multiplicaría los saltos SSH.
   */
  private async obtenerCliente(): Promise<MongoClient> {
    if (this.cliente) return this.cliente;
    if (this.conectando) return this.conectando;

    this.conectando = (async () => {
      const problemas = problemasDeRed(this.tls, this.ssh);
      if (problemas.length) throw new Error(problemas.join(" · "));

      let host = this.config.host;
      let port = this.config.port;

      if (this.ssh.enabled) {
        this.tunel = await abrirTunelSsh(
          this.ssh,
          { host: this.config.host, port: this.config.port },
          {
            password: this.config.sshPassword,
            passphrase: this.config.sshPassphrase,
          }
        );
        host = this.tunel.host;
        port = this.tunel.port;
      }

      const opciones: MongoClientOptions = {
        authSource: this.config.database && this.config.database !== "admin" ? "admin" : "admin",
        serverSelectionTimeoutMS: 15_000,
        connectTimeoutMS: 15_000,
        // Un pool chico: la app es de escritorio y cada operación es del usuario, no de una cola.
        maxPoolSize: 4,
      };
      if (this.config.user) {
        opciones.auth = { username: this.config.user, password: this.config.password };
      }

      const tls = this.tls;
      const uri = construirUri({ host, port, database: this.config.database });
      if (tls.mode !== "deshabilitado") {
        opciones.tls = true;
        // Un certificado firmado por una CA privada no valida contra las raíces del sistema: se
        // pasa la CA explícita. En «requerido» se acepta cualquier certificado, que es lo que el
        // usuario quiere decir cuando su servidor usa uno autofirmado.
        opciones.tlsAllowInvalidCertificates = tls.mode === "requerido";
        if (tls.caFile) opciones.ca = await readFile(tls.caFile);
        if (tls.mode === "mutuo") {
          if (tls.certFile) opciones.cert = await readFile(tls.certFile);
          if (tls.keyFile) opciones.key = await readFile(tls.keyFile);
        }
        /*
         * EL PUNTO DELICADO: con túnel SSH la URI apunta a 127.0.0.1, pero el certificado está
         * emitido para el host real. `servername` es lo que Node usa para SNI **y** para validar la
         * identidad del certificado, así que se fija al host real. Sin esto, todo MongoDB detrás de
         * un salto fallaría con «Hostname/IP does not match certificate's altnames».
         */
        const nombre = tls.serverName || (this.tunel ? this.tunel.hostDestino : this.config.host);
        if (nombre && !isIP(nombre)) {
          // Node prohíbe un `servername` que sea una IP. Para IPs se valida con
          // `checkServerIdentity` (abajo), que sí soporta las IP del SAN.
          opciones.servername = nombre;
        }
        if (this.tunel && nombre) {
          /*
           * Con túnel el socket va a 127.0.0.1 pero el certificado está emitido para el host real
           * (o para su IP). `checkServerIdentity` valida contra ESE nombre y no contra localhost:
           * sin esto, o fallaba la validación, o había que desactivarla entera.
           */
          opciones.checkServerIdentity = (_host, cert) => checkServerIdentity(nombre, cert);
        }
      }

      // `directConnection`: con túnel, el puerto local es UN servidor, no una semilla de replica
      // set (el driver intentaría descubrir miembros en direcciones que el túnel no expone).
      const cliente = new MongoClient(uri, { ...opciones, ...(this.tunel ? { directConnection: true } : {}) });
      await cliente.connect();
      this.cliente = cliente;
      return cliente;
    })();

    try {
      return await this.conectando;
    } catch (err) {
      // Si falló a mitad no se deja el túnel abierto ni la promesa cacheada: el siguiente intento
      // (volver a pulsar «Probar conexión») empieza de cero en vez de heredar el fallo.
      await this.limpiar();
      throw err;
    } finally {
      this.conectando = null;
    }
  }

  private async limpiar() {
    const tunel = this.tunel;
    this.tunel = null;
    const cliente = this.cliente;
    this.cliente = null;
    if (cliente) await cliente.close().catch(() => undefined);
    if (tunel) await tunel.cerrar().catch(() => undefined);
  }

  async testConnection(): Promise<void> {
    const cliente = await this.obtenerCliente();
    await cliente.db("admin").command({ ping: 1 });
  }

  async listDatabases(): Promise<string[]> {
    const cliente = await this.obtenerCliente();
    const { databases } = await cliente.db("admin").admin().listDatabases();
    return databases.map((d) => d.name).sort((a, b) => a.localeCompare(b));
  }

  /**
   * El «esquema» de Mongo: una sola sección con la base activa y sus colecciones. Las columnas
   * llegarían de muestrear documentos; eso es parte de la vista que viene después, así que aquí van
   * vacías y el árbol ya puede listar las colecciones con su nombre.
   */
  async getSchema(): Promise<SchemaNode[]> {
    const cliente = await this.obtenerCliente();
    const base = this.config.database || "admin";
    const colecciones = await cliente.db(base).listCollections({}, { nameOnly: true }).toArray();
    return [
      {
        name: base,
        tables: colecciones
          .map((c) => ({
            name: c.name,
            type: (c.type === "view" ? "view" : "table") as "table" | "view",
            columns: [],
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        routines: [],
        triggers: [],
      },
    ];
  }

  /**
   * Documentos de una colección (fase 81). Filtro, proyección y orden llegan como TEXTO: se
   * interpretan con `EJSON.parse`, que entiende la notación con envoltorios
   * (`{"_id": {"$oid": "…"}}`). Un texto inválido se convierte en un error que dice qué pasó — la
   * barra de consulta lo muestra en línea en vez de dejar la lista vacía sin explicación.
   */
  async findDocuments(
    coleccion: string,
    opciones: { filtro?: string; proyeccion?: string; orden?: string; skip?: number; limit?: number } = {}
  ): Promise<MongoFindResult> {
    const cliente = await this.obtenerCliente();
    const base = this.config.database || "admin";
    const filtro = parsearJson(opciones.filtro, "filtro");
    const proyeccion = parsearJson(opciones.proyeccion, "proyección");
    const orden = parsearOrden(opciones.orden);
    const limit = acotar(opciones.limit, 25, 1, 1000);
    const skip = acotar(opciones.skip, 0, 0, Number.MAX_SAFE_INTEGER);

    const inicio = Date.now();
    const cole = cliente.db(base).collection(coleccion);
    const total = await cole.countDocuments(filtro as Document);
    let cursor = cole.find(filtro as Document, { ...(proyeccion ? { projection: proyeccion as Document } : {}) });
    if (skip) cursor = cursor.skip(skip);
    if (limit) cursor = cursor.limit(limit);
    if (orden) cursor = cursor.sort(orden);
    const crudos = await cursor.toArray();
    return {
      documentos: crudos.map(aEjson),
      total,
      ms: Date.now() - inicio,
    };
  }

  /**
   * Rutas de campo de la colección, muestreadas (fase 83). Es lo que alimenta el autocompletado:
   * Mongo Compass también detecta los campos, y aquí hacen falta para no teclearlos a ciegas.
   *
   * Se muestrea con `find().limit()` y no con `$sample` a propósito: `$sample` no está en todas las
   * implementaciones compatibles (DocumentDB entre ellas) y un autocompletado no puede depender de
   * un operador que el servidor del usuario quizá no tenga.
   */
  async sampleFields(coleccion: string, limite = 50): Promise<string[]> {
    const cliente = await this.obtenerCliente();
    const base = this.config.database || "admin";
    const docs = await cliente
      .db(base)
      .collection(coleccion)
      .find({})
      .limit(Math.min(Math.max(limite, 1), 200))
      .toArray();
    const rutas = new Set<string>();
    for (const doc of docs) recorrer(doc, "", rutas, 0);
    return [...rutas].sort((a, b) => a.localeCompare(b));
  }

  /**
   * Actualiza campos de UN documento (fase 85).
   *
   * TRES DECISIONES QUE IMPORTAN:
   *  - **Solo se escribe lo que cambió** (`$set` de esos campos): reenviar el documento entero pisaría
   *    cambios que otra persona hizo entre la carga y el guardado.
   *  - **Se exige que los campos sigan con el valor que tenía el usuario** (`antes`): el filtro lleva
   *    `_id` + esos valores, así que si alguien los tocó entretanto no coincide ningún documento y se
   *    devuelve un conflicto en vez de sobrescribir a ciegas.
   *  - **Solo lectura se comprueba aquí**, no solo en la UI: el perfil manda.
   */
  async updateDocument(
    coleccion: string,
    id: unknown,
    cambios: Record<string, unknown>,
    antes: Record<string, unknown> = {}
  ): Promise<{ documento: Record<string, unknown> }> {
    if (this.config.readOnly) {
      throw new Error("Este perfil es de solo lectura: no se puede guardar.");
    }
    const campos = Object.keys(cambios);
    if (campos.length === 0) throw new Error("No hay cambios que guardar");
    if (campos.includes("_id")) throw new Error("El _id no se puede modificar");

    const cliente = await this.obtenerCliente();
    const base = this.config.database || "admin";
    // Los valores vuelven del renderer como EJSON plano; se rehidratan para que un `{$oid}` sea un
    // ObjectId y un `{$numberInt}` un número de BSON, no un objeto cualquiera.
    const docId = EJSON.parse(JSON.stringify({ v: id }), { relaxed: false }).v;
    const set = EJSON.parse(JSON.stringify(cambios), { relaxed: false }) as Record<string, unknown>;
    const filtroAntes = EJSON.parse(JSON.stringify(antes), { relaxed: false }) as Record<string, unknown>;

    const filtro: Record<string, unknown> = { _id: docId as Document["_id"] };
    for (const [campo, valor] of Object.entries(filtroAntes)) {
      // Un campo que no existía no puede formar parte del filtro: `{campo: null}` encontraría también
      // documentos sin el campo y el conflicto se dispararía sin motivo.
      if (valor !== undefined) filtro[campo] = valor;
    }

    const resultado = await cliente
      .db(base)
      .collection(coleccion)
      .findOneAndUpdate(filtro as Document, { $set: set }, { returnDocument: "after" });

    if (!resultado) {
      throw new Error(
        "El documento cambió en el servidor desde que lo abriste: recargá para ver los valores nuevos."
      );
    }
    return { documento: aEjson(resultado) };
  }

  /**
   * Inserta un documento (fase 86). El `_id` lo pone el servidor si no viene; si viene, Mongo lo
   * respeta y falla si ya existe (duplicado), que es lo que se quiere al duplicar un documento con
   * su id copiado por error.
   */
  async insertDocument(
    coleccion: string,
    documento: Record<string, unknown>
  ): Promise<{ documento: Record<string, unknown> }> {
    if (this.config.readOnly) throw new Error("Este perfil es de solo lectura: no se puede insertar.");
    if (!documento || Object.keys(documento).length === 0) throw new Error("El documento está vacío");
    const cliente = await this.obtenerCliente();
    const base = this.config.database || "admin";
    const doc = EJSON.parse(JSON.stringify(documento), { relaxed: false }) as Document;
    const { insertedId } = await cliente.db(base).collection(coleccion).insertOne(doc);
    const creado = await cliente.db(base).collection(coleccion).findOne({ _id: insertedId });
    return { documento: aEjson((creado ?? { ...doc, _id: insertedId }) as Document) };
  }

  /**
   * Borra UN documento por `_id` (fase 86). Devuelve cuántos se borraron: 0 significa que ya no
   * estaba (otra persona lo borró), y la UI lo dice en vez de fingir que borró.
   */
  async deleteDocument(coleccion: string, id: unknown): Promise<{ eliminados: number }> {
    if (this.config.readOnly) throw new Error("Este perfil es de solo lectura: no se puede borrar.");
    const cliente = await this.obtenerCliente();
    const base = this.config.database || "admin";
    const docId = EJSON.parse(JSON.stringify({ v: id }), { relaxed: false }).v;
    const r = await cliente.db(base).collection(coleccion).deleteOne({ _id: docId as Document["_id"] });
    return { eliminados: r.deletedCount ?? 0 };
  }

  /** Solo el total, para el contador de la barra sin traer documentos. */
  async countDocuments(coleccion: string, filtro?: string): Promise<{ total: number }> {
    const cliente = await this.obtenerCliente();
    const base = this.config.database || "admin";
    const total = await cliente.db(base).collection(coleccion).countDocuments(parsearJson(filtro, "filtro") as Document);
    return { total };
  }

  async executeQuery(): Promise<QueryResult> {
    throw new Error(SIN_VISTA);
  }

  async executeBatch(): Promise<{ affectedRows: number }> {
    throw new Error(SIN_VISTA);
  }

  async getTableDdl(): Promise<string> {
    throw new Error(SIN_VISTA);
  }

  async getRoutineDdl(): Promise<string> {
    throw new Error(SIN_VISTA);
  }

  async getTriggerDdl(): Promise<string> {
    throw new Error(SIN_VISTA);
  }

  async cancelQuery(): Promise<void> {
    // Sin consultas en curso no hay nada que cancelar; cuando exista la vista, esto matará el
    // cursor abierto (los cursores de Mongo se cancelan con `killCursors`).
  }

  async beginTransaction(): Promise<unknown> {
    throw new Error(SIN_VISTA);
  }

  async commitTransaction(): Promise<void> {
    throw new Error(SIN_VISTA);
  }

  async rollbackTransaction(): Promise<void> {
    throw new Error(SIN_VISTA);
  }

  async explainQuery(): Promise<ExplainNode> {
    throw new Error(SIN_VISTA);
  }

  async close(): Promise<void> {
    await this.limpiar();
  }
}

/**
 * URI de conexión SIN credenciales: el usuario y la contraseña van en `MongoClientOptions.auth`,
 * que el driver escapa solo. Ponerlos en la cadena obligaba a `encodeURIComponent` a mano y una
 * contraseña con `@` o `/` rompía la URI con un error («invalid scheme») que no decía nada.
 */
export function construirUri({
  host,
  port,
  database,
}: {
  host: string;
  port: number;
  database?: string;
}): string {
  const base = database && database.trim() ? `/${encodeURIComponent(database.trim())}` : "";
  return `mongodb://${host}:${port}${base}`;
}

/** Entero acotado, con respaldo: un `limit` basura no debe reventar la consulta. */
function acotar(valor: number | undefined, porDefecto: number, min: number, max: number): number {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return porDefecto;
  return Math.min(max, Math.max(min, Math.floor(valor)));
}

/**
 * Texto del usuario → objeto. Vacío es «sin filtro» (no un error): la barra de consulta arranca
 * vacía y vacío significa «todo». Los errores nombran el campo para que se sepa cuál corregir.
 */
export function parsearJson(texto: string | undefined, campo: string): Record<string, unknown> {
  const limpio = (texto ?? "").trim();
  if (!limpio) return {};
  try {
    // El texto llega con la sintaxis de Compass (`{ campo: valor }`, `ObjectId("…")`); se
    // normaliza a JSON estricto antes de parsear.
    const valor = EJSON.parse(normalizarConsulta(limpio), { relaxed: false });
    if (valor === null || typeof valor !== "object" || Array.isArray(valor)) {
      throw new Error(`el ${campo} tiene que ser un objeto, p. ej. { "campo": "valor" }`);
    }
    return valor as Record<string, unknown>;
  } catch (err) {
    const detalle = err instanceof Error ? err.message : String(err);
    throw new Error(`${campo} inválido: ${detalle}`);
  }
}

/**
 * Orden: acepta `{ campo: 1 }` (lo que escribe todo el mundo) y también una lista
 * `[["campo", 1]]`. Se normaliza a la forma que espera el driver.
 */
export function parsearOrden(texto: string | undefined): [string, 1 | -1][] | null {
  const limpio = (texto ?? "").trim();
  if (!limpio) return null;
  let valor: unknown;
  try {
    valor = EJSON.parse(normalizarConsulta(limpio), { relaxed: false });
  } catch (err) {
    throw new Error(`orden inválido: ${err instanceof Error ? err.message : String(err)}`);
  }
  const pares: [string, unknown][] = Array.isArray(valor)
    ? (valor as unknown[]).map((p) => (Array.isArray(p) ? [String(p[0]), p[1]] : ["", 0]))
    : Object.entries(valor as Record<string, unknown>);
  const salida: [string, 1 | -1][] = [];
  for (const [campo, dir] of pares) {
    if (!campo) continue;
    salida.push([campo, Number(dir) === -1 ? -1 : 1]);
  }
  return salida.length ? salida : null;
}

/**
 * Documento de BSON → JSON plano con EJSON relajado.
 *
 * El IPC clona con structured clone, que no conoce `ObjectId`, `Date`, `Decimal128`, `Long` ni
 * `Binary`: sin esta conversión llegan como `{}` (se pierde el valor) o revientan la clonación.
 * Con EJSON quedan como `{$oid: "…"}`, `{$date: "…"}`, etc., y el renderer los pinta como
 * `ObjectId('…')`.
 */
export function aEjson(doc: Document): Record<string, unknown> {
  return JSON.parse(EJSON.stringify(doc, { relaxed: true })) as Record<string, unknown>;
}

/** Profundidad máxima del muestreo: más allá no aporta y llena la lista de basura. */
const PROFUNDIDAD_MAXIMA = 3;

/**
 * ¿Es un valor de BSON que NO hay que recorrer? Un `ObjectId` es un objeto con campos internos
 * (`i0`, `i1`…) y, sin este filtro, el autocompletado ofrecía `_id.i0` como si fuera un campo de la
 * colección. Lo mismo con `Date`, `Decimal128`, `Long` y `Binary`.
 */
function esValorBson(valor: unknown): boolean {
  if (valor instanceof Date || valor instanceof RegExp || Buffer.isBuffer(valor)) return true;
  if (!valor || typeof valor !== "object") return false;
  const tipo = (valor as { _bsontype?: string })._bsontype;
  return typeof tipo === "string";
}

/** Acumula las rutas (`detalle.pais`) de un documento, sin repetirlas. */
function recorrer(valor: unknown, prefijo: string, rutas: Set<string>, profundidad: number): void {
  if (profundidad > PROFUNDIDAD_MAXIMA) return;
  if (esValorBson(valor)) return;
  if (Array.isArray(valor)) {
    for (const item of valor) {
      // Los arrays de objetos aportan las rutas de sus elementos (`tags.nombre`); los de escalares
      // no aportan nada nuevo (el campo ya está listado).
      if (item && typeof item === "object" && !esValorBson(item)) recorrer(item, prefijo, rutas, profundidad + 1);
    }
    return;
  }
  if (!valor || typeof valor !== "object") return;
  for (const [clave, v] of Object.entries(valor as Record<string, unknown>)) {
    const ruta = prefijo ? `${prefijo}.${clave}` : clave;
    rutas.add(ruta);
    if (v && typeof v === "object") recorrer(v, ruta, rutas, profundidad + 1);
  }
}
