import { test } from "node:test";
import assert from "node:assert/strict";
import { createRouter } from "./router";
import { HandlerError } from "@/server/handlers/errors";

test("canal desconocido -> error 400 sin lanzar", async () => {
  const route = createRouter({}, () => {});
  assert.deepEqual(await route("nope:nope" as never, {}), {
    ok: false,
    error: { message: "Canal desconocido: nope:nope", status: 400 },
  });
});

test("exito -> { ok: true, data }", async () => {
  const route = createRouter({ "databases:list": async () => ["a"] } as never, () => {});
  assert.deepEqual(await route("databases:list", { sessionId: "s" }), { ok: true, data: ["a"] });
});

test("HandlerError -> mensaje y status intactos", async () => {
  const route = createRouter(
    { "schema:get": async () => { throw new HandlerError("Session not found", 401); } } as never,
    () => {}
  );
  assert.deepEqual(await route("schema:get", { sessionId: "s" }), {
    ok: false,
    error: { message: "Session not found", status: 401 },
  });
});

test("query:execute emite started y finished con el mismo opId, tambien si falla", async () => {
  const ev: Array<[string, Record<string, unknown>]> = [];
  const route = createRouter(
    { "query:execute": async () => { throw new Error("x"); } } as never,
    (name, payload) => ev.push([name, payload as unknown as Record<string, unknown>])
  );
  await route("query:execute", { sessionId: "s", sql: "select 1", opId: "op-1" });
  assert.deepEqual(ev.map(([n]) => n), ["query:started", "query:finished"]);
  assert.equal(ev[0][1].opId, "op-1");
  assert.equal(ev[1][1].opId, "op-1");
  assert.equal(ev[1][1].ok, false);
});

test("los demas canales no emiten eventos", async () => {
  const ev: string[] = [];
  const route = createRouter({ "schema:get": async () => [] } as never, (n) => ev.push(n));
  await route("schema:get", { sessionId: "s" });
  assert.deepEqual(ev, []);
});

test("un handler sincrono que lanza tambien se convierte en IpcResult", async () => {
  const route = createRouter({ "profiles:list": (() => { throw new Error("sync"); }) as never }, () => {});
  const r = await route("profiles:list", undefined);
  assert.equal(r.ok, false);
});
