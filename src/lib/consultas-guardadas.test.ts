import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  casaConBusqueda,
  dondeAbrir,
  fechaRelativa,
  ligarAPerfiles,
  lineaCoincidente,
  perteneceA,
  trozosResaltados,
  vistaDeConsultas,
} from "./consultas-guardadas";
import type { SavedQuery } from "./types";

/* R96 — la tool window «Consultas guardadas» rediseñada (propuesta de Open Design aprobada). */

const q = (p: Partial<SavedQuery> & { id: string; name: string }): SavedQuery => ({
  sql: "select 1",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...p,
});

const ACME = { profileId: "p-acme", name: "Acme" };
const fichas = q({
  id: "1",
  name: "Fichas",
  sql: "SELECT ficha.id\nFROM clients_deposits_clientdeposit ficha\nWHERE ficha.id = 6300196",
  profileId: "p-acme",
  connectionId: "Acme",
  updatedAt: "2026-10-21T23:00:00.000Z",
});
const vieja = q({ id: "2", name: "Depósitos sin conciliar", connectionId: "Acme", updatedAt: "2026-10-20T10:00:00.000Z" });
const local = q({ id: "3", name: "Pruebas de índices", profileId: "p-local", connectionId: "Local Postgres" });

describe("perteneceA", () => {
  test("el perfil manda: renombrar la conexión no deja huérfanas sus consultas", () => {
    assert.equal(perteneceA(fichas, { profileId: "p-acme", name: "Acme (renombrada)" }), true);
    assert.equal(perteneceA(local, ACME), false);
  });
  test("una consulta de antes de R96 (sin perfil) se reconoce por el nombre", () => {
    assert.equal(perteneceA(vieja, ACME), true);
    assert.equal(perteneceA(vieja, null), false);
  });
});

describe("vistaDeConsultas", () => {
  const todas = [local, vieja, fichas];
  test("«Esta conexión»: un grupo, la más reciente primero", () => {
    const v = vistaDeConsultas(todas, { alcance: "conexion", busqueda: "", orden: "recientes", conexion: ACME });
    assert.equal(v.length, 1);
    assert.deepEqual(v[0].consultas.map((c) => c.name), ["Fichas", "Depósitos sin conciliar"]);
  });
  test("«Todas»: agrupada por conexión, la de la consola primero, y la vieja junto a la nueva", () => {
    const v = vistaDeConsultas(todas, {
      alcance: "todas",
      busqueda: "",
      orden: "nombre",
      conexion: ACME,
      nombreDePerfil: (id) => ({ "p-acme": "Acme", "p-local": "Local Postgres" })[id],
    });
    assert.deepEqual(v.map((g) => [g.nombre, g.consultas.length]), [["Acme", 2], ["Local Postgres", 1]]);
    assert.deepEqual(v[0].consultas.map((c) => c.name), ["Depósitos sin conciliar", "Fichas"]);
  });
  test("la búsqueda mira nombre y SQL, sin acentos ni mayúsculas", () => {
    assert.equal(casaConBusqueda(vieja, "depositos"), true);
    assert.equal(casaConBusqueda(fichas, "CLIENTS_DEPOSITS"), true);
    assert.equal(casaConBusqueda(local, "fichas"), false);
  });
});

describe("resaltado", () => {
  test("marca la coincidencia conservando el texto original", () => {
    assert.deepEqual(trozosResaltados("Depósitos del día", "deposito"), [
      { texto: "Depósito", coincide: true },
      { texto: "s del día", coincide: false },
    ]);
    assert.deepEqual(trozosResaltados("Fichas", ""), [{ texto: "Fichas", coincide: false }]);
  });
  test("la línea de SQL solo cuando la coincidencia no está en el nombre", () => {
    assert.equal(lineaCoincidente(fichas, "clientdeposit"), "FROM clients_deposits_clientdeposit ficha");
    assert.equal(lineaCoincidente(fichas, "fichas"), null);
  });
});

describe("fechaRelativa", () => {
  const ahora = new Date(2026, 9, 21, 18, 0, 0);
  test("minutos, horas, ayer y fecha corta", () => {
    assert.equal(fechaRelativa(new Date(2026, 9, 21, 17, 55).toISOString(), ahora), "hace 5 min");
    assert.equal(fechaRelativa(new Date(2026, 9, 21, 15, 0).toISOString(), ahora), "hace 3 h");
    assert.equal(fechaRelativa(new Date(2026, 9, 20, 9, 0).toISOString(), ahora), "ayer");
    assert.equal(fechaRelativa(new Date(2026, 9, 12, 9, 0).toISOString(), ahora), "12 oct");
    assert.equal(fechaRelativa(new Date(2025, 0, 3).toISOString(), ahora), "3 ene 2025");
  });
});

describe("dondeAbrir", () => {
  test("nunca pisa texto: con SQL escrito abre consola nueva", () => {
    assert.equal(dondeAbrir({ sql: "select now()", activeSavedQueryId: null }, fichas, ACME), "nueva");
  });
  test("consola vacía de la misma conexión (o sin conexión): la usa", () => {
    assert.equal(dondeAbrir({ sql: "  ", activeSavedQueryId: null }, fichas, ACME), "actual");
    assert.equal(dondeAbrir({ sql: "", activeSavedQueryId: null }, fichas, null), "actual");
  });
  test("consola vacía de OTRA conexión: nueva (no correr el SQL contra otra base)", () => {
    assert.equal(dondeAbrir({ sql: "", activeSavedQueryId: null }, local, ACME), "nueva");
  });
  test("si la consola ya es esa consulta, se queda en ella", () => {
    assert.equal(dondeAbrir({ sql: "editado", activeSavedQueryId: "1" }, fichas, ACME), "actual");
  });
});

/* R96 — las consultas guardadas antes de R96 se ligan a su perfil al listarlas (servidor). */

const qv = (p: Partial<SavedQuery> & { id: string }): SavedQuery => ({
  name: "x",
  sql: "select 1",
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-02T00:00:00.000Z",
  ...p,
});

test("liga por nombre único, sin tocar la fecha de modificación", () => {
  const { consultas, cambiadas } = ligarAPerfiles(
    [qv({ id: "1", connectionId: "Acme" }), qv({ id: "2", connectionId: "Acme", profileId: "otro" })],
    [{ id: "p1", name: "Acme" }]
  );
  assert.equal(cambiadas, 1);
  assert.equal(consultas[0].profileId, "p1");
  assert.equal(consultas[0].updatedAt, "2026-10-02T00:00:00.000Z");
  assert.equal(consultas[1].profileId, "otro", "la que ya tenía perfil no se toca");
});

test("nombre ambiguo o sin perfil: no se liga", () => {
  const { cambiadas } = ligarAPerfiles(
    [qv({ id: "1", connectionId: "Dup" }), qv({ id: "2", connectionId: "Borrada" }), qv({ id: "3" })],
    [
      { id: "a", name: "Dup" },
      { id: "b", name: "Dup" },
    ]
  );
  assert.equal(cambiadas, 0);
});
