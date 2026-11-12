import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bindingFromSession,
  bindingParaConectar,
  connectionOf,
  openBinding,
  refrescarPerfilEnConsolas,
  persistConsoles,
  restoreConsoles,
  type PersistedConsoleSnapshot,
} from "@/lib/console-binding";
import type { Session } from "@/lib/types";

/**
 * R91 — conexión perezosa de las consolas. Reproduce la queja del usuario (2026-10-21): al cerrar y
 * reabrir la app la consola perdía su conexión, su logo y su base.
 */

const SESION: Session = {
  sessionId: "s-viva",
  name: "Acme",
  type: "mysql",
  database: "tienda-db-prod",
  color: "#E5484D",
  profileId: "perfil-1",
  readOnly: false,
};

test("un archivo VIEJO (con la sesión guardada) se restaura dormido, con perfil y base", () => {
  const viejo: PersistedConsoleSnapshot[] = [
    { id: "c1", name: "Consola 1", sql: "select 1", session: SESION, activeSavedQueryId: null, savedQuerySnapshot: "" },
  ];
  const [c] = restoreConsoles(viejo);
  assert.equal(c.session, null, "la sesión de antes murió con el worker: no se reutiliza su id");
  assert.deepEqual(c.binding, {
    profileId: "perfil-1",
    name: "Acme",
    type: "mysql",
    database: "tienda-db-prod",
    color: "#E5484D",
    readOnly: false,
  });
  assert.equal(c.sql, "select 1");
});

test("se guarda la conexión dormida al día con la sesión viva, y NUNCA la sesión", () => {
  const [c] = restoreConsoles([
    { id: "c1", name: "Consola 1", sql: "", binding: null, activeSavedQueryId: null, savedQuerySnapshot: "" },
  ]);
  const viva = { ...c, session: { ...SESION, database: "otra_base" } };
  const [guardada] = persistConsoles([viva]);
  assert.equal("session" in guardada, false);
  assert.equal(guardada.binding?.database, "otra_base", "la base elegida en la sesión es la que se guarda");
  assert.equal(JSON.stringify(guardada).includes("s-viva"), false, "el sessionId no va a disco");
});

test("ida y vuelta: guardar y restaurar conserva perfil, motor y base", () => {
  const [c] = restoreConsoles([
    { id: "c1", name: "C", sql: "x", session: SESION, activeSavedQueryId: null, savedQuerySnapshot: "" },
  ]);
  const [otra] = restoreConsoles(persistConsoles([c]));
  assert.deepEqual(otra.binding, c.binding);
});

test("una sesión sin perfil guardado (formulario sin guardar) no deja conexión dormida", () => {
  assert.equal(bindingFromSession({ ...SESION, profileId: undefined }), null);
});

test("bindingParaConectar: con atadura devuelve ESA atadura (no una deducida)", () => {
  const binding = bindingFromSession(SESION);
  assert.equal(bindingParaConectar({ session: null, binding }), binding);
});

test("bindingParaConectar: sin atadura la deduce de la sesión viva", () => {
  const c = { session: SESION, binding: null };
  assert.deepEqual(bindingParaConectar(c), bindingFromSession(SESION));
});

test("bindingParaConectar: sin atadura ni sesión no hay con qué reconectar → null", () => {
  assert.equal(bindingParaConectar({ session: null, binding: null }), null);
});

test("connectionOf pinta la viva si la hay, y si no la dormida", () => {
  const binding = bindingFromSession(SESION);
  assert.equal(connectionOf({ session: null, binding })?.live, false);
  assert.equal(connectionOf({ session: null, binding })?.type, "mysql");
  assert.equal(connectionOf({ session: SESION, binding })?.live, true);
  assert.equal(connectionOf({ session: null, binding: null }), null);
});

test("abrir la dormida conecta el perfil y vuelve a la base guardada", async () => {
  const llamadas: string[] = [];
  const deps = {
    connect: async (id: string) => {
      llamadas.push(`connect ${id}`);
      return { ...SESION, sessionId: "nueva", database: "base_del_perfil" };
    },
    switchDatabase: async (sid: string, db: string) => {
      llamadas.push(`switch ${sid} ${db}`);
      return { ...SESION, sessionId: sid, database: db };
    },
  };
  const { session, databaseError } = await openBinding({ profileId: "perfil-1", database: "tienda-db-prod" }, deps);
  assert.deepEqual(llamadas, ["connect perfil-1", "switch nueva tienda-db-prod"]);
  assert.equal(session.database, "tienda-db-prod");
  assert.equal(databaseError, undefined);

  // Si la base ya es la del perfil, no hay cambio de base.
  llamadas.length = 0;
  await openBinding({ profileId: "perfil-1", database: "base_del_perfil" }, deps);
  assert.deepEqual(llamadas, ["connect perfil-1"]);
});

test("si la base guardada ya no existe, se conecta igual y se avisa", async () => {
  const { session, databaseError } = await openBinding(
    { profileId: "p", database: "borrada" },
    {
      connect: async () => ({ ...SESION, database: "defecto" }),
      switchDatabase: async () => {
        throw new Error("Unknown database 'borrada'");
      },
    }
  );
  assert.equal(session.database, "defecto");
  assert.match(databaseError ?? "", /borrada/);
});

test("si el perfil no conecta, el error sube (la consola sigue dormida)", async () => {
  await assert.rejects(
    openBinding({ profileId: "p" }, {
      connect: async () => {
        throw new Error("ECONNREFUSED");
      },
      switchDatabase: async () => SESION,
    }),
    /ECONNREFUSED/
  );
});

test("R18: el color nuevo de un perfil llega a todas sus consolas (viva y dormida) y a ninguna otra", () => {
  const binding = bindingFromSession(SESION)!;
  const otra = { ...binding, profileId: "otro", color: "#10b981" };
  const consolas = [
    { id: "a", session: SESION, binding },
    { id: "b", session: null, binding },
    { id: "c", session: null, binding: otra },
    { id: "d", session: null, binding: null },
  ];
  const r = refrescarPerfilEnConsolas(consolas, { id: SESION.profileId!, name: "Renombrado", color: "#ef4444" });
  assert.equal(r[0].session?.color, "#ef4444");
  assert.equal(r[0].binding?.color, "#ef4444");
  assert.equal(r[1].binding?.color, "#ef4444");
  assert.equal(r[1].binding?.name, "Renombrado");
  assert.equal(r[2], consolas[2], "la consola de otro perfil no se toca");
  assert.equal(r[3], consolas[3]);
  assert.equal(r[0].session?.readOnly, SESION.readOnly, "readOnly no se toca por un repintado");
});
