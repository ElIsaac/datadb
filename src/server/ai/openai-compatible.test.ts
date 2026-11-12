/**
 * Fase 25 (T3/T4): el cliente compatible con OpenAI contra un servidor HTTP local de verdad. Sin worker no hay
 * almacén de secretos (getSecret → null), así que la key sale de la variable de entorno del test.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createOpenAiCompatibleProvider } from "./openai-compatible";
import { MISSING_KEY_MESSAGE, activeModelOf, activeModelPatch, isLocalBaseUrl, DEFAULT_AI_SETTINGS } from "@/lib/ai-types";

type Seen = { path: string; auth?: string; extra?: string; body?: Record<string, unknown> };
const seen: Seen[] = [];

const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  seen.push({ path: req.url ?? "", auth: req.headers.authorization, extra: req.headers["x-datadb-client"] as string, body: raw ? JSON.parse(raw) : undefined });
  if (req.headers.authorization === "Bearer mala") {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: { message: "Incorrect API key" } }));
  }
  if (req.url === "/v1/models") return res.end(JSON.stringify({ data: [{ id: "gpt-a", object: "model" }, { id: "gpt-b", object: "model" }] }));
  if (req.url === "/v1/chat/completions") {
    const body = JSON.parse(raw);
    if (!body.stream) return res.end(JSON.stringify({ choices: [{ message: { content: "hola" } }], usage: { prompt_tokens: 3, completion_tokens: 1 } }));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "pienso" } }] })}\n\n`);
    const line = `data: ${JSON.stringify({ choices: [{ delta: { content: "uno " } }] })}\n\n`;
    res.write(line.slice(0, 15)); // línea SSE partida
    res.write(line.slice(15));
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "dos" } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } })}\n\n`);
    res.write("data: [DONE]\n\n");
    return res.end();
  }
  res.statusCode = 404;
  res.end("{}");
});
let port = 0;
before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
after(() => server.close());

function provider(opts: { local?: boolean; envVar?: string; extra?: boolean } = {}) {
  return createOpenAiCompatibleProvider({
    id: "openai",
    label: "Prueba",
    baseUrl: () => `http://127.0.0.1:${port}/v1/`,
    secretName: "ai.openai",
    envVar: opts.envVar,
    keyOptional: () => opts.local ?? false,
    extraHeaders: opts.extra ? () => ({ "X-DataDB-Client": "desktop" }) : undefined,
    testPath: "/models",
  });
}
const opts = { model: "gpt-a", messages: [{ role: "user", content: "hola" }], temperature: 0 };

test("sin key y con URL remota → el mensaje de «configura la key»; con URL local se llama sin Authorization", async () => {
  await assert.rejects(() => provider().complete(opts), (e: Error) => e.message === MISSING_KEY_MESSAGE);
  seen.length = 0;
  const r = await provider({ local: true }).complete(opts);
  assert.equal(r.text, "hola");
  assert.equal(seen[0].auth, undefined);
  assert.equal(seen[0].path, "/v1/chat/completions", "la barra final de la URL base no duplica la ruta");
  assert.equal(r.usage?.costUsd, undefined, "sin coste: el proveedor no lo manda");
});

test("con key (variable de entorno de desarrollo) va en Authorization, más las cabeceras propias del proveedor", async () => {
  process.env.TEST_PROVIDER_KEY = "sk-buena";
  seen.length = 0;
  await provider({ envVar: "TEST_PROVIDER_KEY", extra: true }).complete(opts);
  assert.equal(seen[0].auth, "Bearer sk-buena");
  assert.equal(seen[0].extra, "desktop");
  assert.equal(seen[0].body?.model, "gpt-a");
});

test("streaming: NDJSON de razonamiento (reasoning_content), contenido (con línea partida) y uso", async () => {
  const stream = await provider({ local: true }).streamComplete(opts);
  const text = await new Response(stream).text();
  const events = text.trim().split("\n").map((l) => JSON.parse(l) as { type: string; text: string });
  assert.deepEqual(events.map((e) => e.type), ["reasoning", "content", "content", "usage"]);
  assert.equal(events.filter((e) => e.type === "content").map((e) => e.text).join(""), "uno dos");
});

test("Probar: key mala → mensaje traducido; buena → ok. Catálogo sin precio ni contexto", async () => {
  process.env.TEST_BAD_KEY = "mala";
  const bad = await provider({ envVar: "TEST_BAD_KEY" }).testKey();
  assert.equal(bad.ok, false);
  assert.match(bad.message, /Clave de Prueba inválida: Incorrect API key/);
  const good = await provider({ local: true }).testKey();
  assert.equal(good.ok, true);
  const models = await provider({ local: true }).listModels();
  assert.equal(models.stale, false);
  assert.deepEqual(models.models, [{ id: "gpt-a", name: "gpt-a" }, { id: "gpt-b", name: "gpt-b" }]);
});

test("sin URL configurada (gateway sin backend) → error que lo dice", async () => {
  const p = createOpenAiCompatibleProvider({ id: "gateway", label: "Gateway DataDB", baseUrl: () => "", secretName: "ai.gateway", keyOptional: () => true, testPath: "/models" });
  await assert.rejects(() => p.complete(opts), /Falta la URL de Gateway DataDB/);
  assert.match((await p.testKey()).message, /Falta la URL/);
});

test("ajustes por proveedor: modelo activo y parche del proveedor activo; URL local", () => {
  const s = { ...DEFAULT_AI_SETTINGS, provider: "openai" as const };
  assert.equal(activeModelOf(s).model, "gpt-4o-mini");
  assert.deepEqual(activeModelPatch(s, { model: "gpt-b" }), { openai: { ...s.openai, model: "gpt-b" } });
  assert.deepEqual(activeModelPatch(DEFAULT_AI_SETTINGS, { model: "x/y" }), { model: "x/y" });
  assert.ok(isLocalBaseUrl("http://localhost:11434/v1"));
  assert.ok(isLocalBaseUrl("http://127.0.0.1:1234/v1"));
  assert.ok(!isLocalBaseUrl("https://api.openai.com/v1"));
  assert.ok(!isLocalBaseUrl("no es url"));
});
