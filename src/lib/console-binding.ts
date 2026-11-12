/**
 * Conexión PEREZOSA de las consolas (R91).
 *
 * Pedido del usuario (2026-10-21): «al cerrar y volver a abrir, la consola pierde su conexión y tengo
 * que elegir conexión y base otra vez; que se guarde y que al ejecutar se conecte sola — una conexión
 * perezosa: si abro esa consola no se conecta hasta que ejecute».
 *
 * CAUSA de lo que veía: el workspace guardaba la `Session` entera en `localStorage`, pero su
 * `sessionId` muere con el worker. Al reabrir, la validación de `app-shell` veía «Session not found»
 * y ponía la sesión a `null`: la consola perdía también el perfil, el logo del motor y la base.
 *
 * MODELO NUEVO: cada consola tiene dos cosas separadas:
 *   - `session`: la sesión VIVA o `null`. Todo lo que habla con el worker la usa y nada cambia ahí.
 *   - `binding`: a qué perfil y base está atada (`ConsoleBinding`). Se persiste; la sesión no.
 * La UI pinta `session ?? binding` (motor, nombre, base) y, al ejecutar sin sesión, `openBinding`
 * conecta el perfil y cambia a la base guardada. Es el modelo de DataGrip: la consola pertenece a
 * una fuente de datos y la fuente se conecta al primer uso.
 *
 * Todo lo de este archivo es puro (o recibe sus dependencias) para probarlo sin worker ni React.
 */
import type { ConnectionProfile, ConsoleBinding, Session, SqlConsole } from "@/lib/types";

/** La conexión dormida que corresponde a una sesión viva. Sin perfil guardado no hay cómo reabrirla. */
export function bindingFromSession(session: Session): ConsoleBinding | null {
  if (!session.profileId) return null;
  return {
    profileId: session.profileId,
    name: session.name,
    type: session.type,
    database: session.database,
    color: session.color,
    readOnly: session.readOnly,
  };
}

/** La conexión dormida de un perfil guardado (arranque sin consolas atadas). */
export function bindingFromProfile(profile: ConnectionProfile): ConsoleBinding {
  return {
    profileId: profile.id,
    name: profile.name,
    type: profile.type,
    database: profile.database || undefined,
    color: profile.color,
    readOnly: profile.readOnly,
  };
}

/**
 * R18: lleva el nombre y el COLOR actuales de un perfil a todas las consolas atadas a él (sesión viva
 * y conexión dormida).
 *
 * La consola guarda una COPIA de esos datos al conectarse (y se persiste así entre reinicios), de modo
 * que al cambiar el color en Conexiones solo se enteraba la consola que se reconectaba; las demás —y
 * todas, tras reiniciar— seguían con el color viejo y el explorador no se teñía. `readOnly` NO se toca
 * aquí: cambia lo que el servidor permite y se aplica al reconectar, no por un repintado.
 */
export function refrescarPerfilEnConsolas<C extends Pick<SqlConsole, "session" | "binding">>(
  consolas: readonly C[],
  perfil: Pick<ConnectionProfile, "id" | "name" | "color">
): C[] {
  return consolas.map((c) => {
    const tocaSesion = c.session?.profileId === perfil.id;
    const tocaAtadura = c.binding?.profileId === perfil.id;
    if (!tocaSesion && !tocaAtadura) return c;
    return {
      ...c,
      session: tocaSesion && c.session ? { ...c.session, name: perfil.name, color: perfil.color } : c.session,
      binding: tocaAtadura && c.binding ? { ...c.binding, name: perfil.name, color: perfil.color } : c.binding,
    };
  });
}

/**
 * La conexión DORMIDA con la que se puede reconectar una consola (R101): la atadura si la hay y, si
 * no, la que se deduce de su sesión viva. `null` = la consola no está atada a nada y hay que elegir
 * perfil. Difiere de `connectionOf` en el FIN: aquélla es para PINTAR (dice `live`), ésta para
 * CONECTAR (devuelve lo que `openBinding` sabe abrir).
 */
export function bindingParaConectar(
  console_: Pick<SqlConsole, "session" | "binding">
): ConsoleBinding | null {
  if (console_.binding) return console_.binding;
  return console_.session ? bindingFromSession(console_.session) : null;
}

/**
 * Lo que la UI pinta de la conexión de una consola: la sesión viva si la hay y, si no, la dormida.
 * `live` distingue las dos (la barra marca la dormida como «se conecta al ejecutar»).
 */
export function connectionOf(
  console_: Pick<SqlConsole, "session" | "binding">
): (Pick<ConsoleBinding, "name" | "type" | "database" | "color" | "readOnly"> & { profileId?: string; live: boolean }) | null {
  if (console_.session) return { ...console_.session, live: true };
  if (console_.binding) return { ...console_.binding, live: false };
  return null;
}

export interface OpenBindingDeps {
  connect: (profileId: string) => Promise<Session>;
  switchDatabase: (sessionId: string, database: string) => Promise<Session>;
}

/**
 * Abre la conexión dormida: conecta el perfil y, si la base guardada no es la de fábrica del perfil,
 * cambia a ella. Sin el cambio de base, la consola se reabría contra OTRA base que la que el usuario
 * dejó elegida (el mismo defecto tenía la reconexión por sesión expirada: reconectaba al perfil y
 * perdía la base; ahora también pasa por aquí).
 *
 * Si el cambio de base falla (la base ya no existe), se devuelve la sesión del perfil y el error
 * viaja en `databaseError`: mejor ejecutar contra la base por defecto avisando que no ejecutar.
 */
export async function openBinding(
  binding: Pick<ConsoleBinding, "profileId" | "database">,
  deps: OpenBindingDeps
): Promise<{ session: Session; databaseError?: string }> {
  const session = await deps.connect(binding.profileId);
  if (!binding.database || binding.database === session.database) return { session };
  try {
    return { session: await deps.switchDatabase(session.sessionId, binding.database) };
  } catch (err) {
    return { session, databaseError: String(err) };
  }
}

/** Forma persistida de una consola (lo mínimo para restaurarla). */
export interface PersistedConsoleSnapshot {
  id: string;
  name: string;
  sql: string;
  /** Formato anterior a R91. Se sigue LEYENDO para migrar; ya no se escribe. */
  session?: Session | null;
  binding?: ConsoleBinding | null;
  activeSavedQueryId: string | null;
  savedQuerySnapshot: string;
}

/**
 * Consolas restauradas al arrancar: SIEMPRE sin sesión (la de antes murió con el worker) y con su
 * conexión dormida, sacada de `binding` o, en un archivo viejo, de la `session` que se guardaba.
 */
export function restoreConsoles(snapshots: PersistedConsoleSnapshot[]): SqlConsole[] {
  return snapshots.map((c) => ({
    id: c.id,
    name: c.name,
    sql: c.sql,
    session: null,
    binding: c.binding ?? (c.session ? bindingFromSession(c.session) : null),
    resultTabs: [],
    activeResultTabId: null,
    activeSavedQueryId: c.activeSavedQueryId,
    savedQuerySnapshot: c.savedQuerySnapshot,
  }));
}

/** Lo que se guarda de cada consola: la conexión dormida (al día con la sesión viva), nunca la sesión. */
export function persistConsoles(consoles: SqlConsole[]): PersistedConsoleSnapshot[] {
  return consoles.map((c) => ({
    id: c.id,
    name: c.name,
    sql: c.sql,
    binding: c.binding ?? (c.session ? bindingFromSession(c.session) : null),
    activeSavedQueryId: c.activeSavedQueryId,
    savedQuerySnapshot: c.savedQuerySnapshot,
  }));
}

