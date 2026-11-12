import { test } from "node:test";
import assert from "node:assert/strict";
import { INVOKE_CHANNELS, EVENT_CHANNELS } from "./contract";

test("las listas blancas no tienen duplicados", () => {
  assert.equal(new Set(INVOKE_CHANNELS).size, INVOKE_CHANNELS.length);
  assert.equal(new Set(EVENT_CHANNELS).size, EVENT_CHANNELS.length);
});

test("los 9 canales de la fase 2 estan en la lista blanca", () => {
  for (const c of [
    "profiles:list", "session:connect", "session:get", "databases:list", "savedQueries:list",
    "history:list", "schema:get", "query:execute", "query:cancel",
  ]) assert.ok((INVOKE_CHANNELS as readonly string[]).includes(c), c);
});
