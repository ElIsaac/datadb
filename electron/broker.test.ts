import { test } from "node:test";
import assert from "node:assert/strict";
import { createBroker } from "./broker";
import type { ToWorker } from "@/shared/worker-protocol";

test("request envia el mensaje y se resuelve con el result de ese id", async () => {
  const sent: Extract<ToWorker, { kind: "request" }>[] = [];
  const b = createBroker((m) => { if (m.kind === "request") sent.push(m); });
  const p = b.request("schema:get", { sessionId: "s" });
  assert.equal(sent[0].kind, "request");
  assert.equal(sent[0].channel, "schema:get");
  b.onWorkerMessage({ kind: "response", id: sent[0].id, result: { ok: true, data: 1 } });
  assert.deepEqual(await p, { ok: true, data: 1 });
  assert.equal(b.pendingCount(), 0);
});

test("respuestas fuera de orden se correlacionan por id", async () => {
  const sent: Extract<ToWorker, { kind: "request" }>[] = [];
  const b = createBroker((m) => { if (m.kind === "request") sent.push(m); });
  const p1 = b.request("databases:list", { sessionId: "a" });
  const p2 = b.request("databases:list", { sessionId: "b" });
  b.onWorkerMessage({ kind: "response", id: sent[1].id, result: { ok: true, data: "segunda" } });
  b.onWorkerMessage({ kind: "response", id: sent[0].id, result: { ok: true, data: "primera" } });
  assert.deepEqual(await p1, { ok: true, data: "primera" });
  assert.deepEqual(await p2, { ok: true, data: "segunda" });
});

test("failAll resuelve (no rechaza) todo lo pendiente con error 500 y vacia el mapa", async () => {
  const b = createBroker(() => {});
  const p1 = b.request("schema:get", {});
  const p2 = b.request("history:list", {});
  b.failAll("el proceso se reinicio");
  const expected = { ok: false, error: { message: "el proceso se reinicio", status: 500 } };
  assert.deepEqual(await p1, expected);
  assert.deepEqual(await p2, expected);
  assert.equal(b.pendingCount(), 0);
});

test("una response con id desconocido se ignora sin lanzar", () => {
  const b = createBroker(() => {});
  assert.doesNotThrow(() => b.onWorkerMessage({ kind: "response", id: 999, result: { ok: true, data: 0 } }));
});

test("los eventos del worker se reenvian al callback", () => {
  const got: Array<[string, unknown]> = [];
  const b = createBroker(() => {}, (name, payload) => got.push([name, payload]));
  const payload = { opId: "x", sessionId: "s", startedAt: 1 };
  b.onWorkerMessage({ kind: "event", name: "query:started", payload });
  assert.deepEqual(got, [["query:started", payload]]);
});
