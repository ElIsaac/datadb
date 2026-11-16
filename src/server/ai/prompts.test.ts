import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMessages } from "./prompts";

test("buildMessages en chat inyecta Active SQL in editor cuando req.sql tiene contenido", () => {
  const messages = buildMessages(
    {
      sessionId: "s1",
      task: "chat",
      prompt: "¿Por qué está lenta esta consulta?",
      sql: "  SELECT * FROM orders WHERE total > 100;  ",
    },
    "-- Dialect: postgres\n-- Tables: 1",
    "postgres"
  );

  const last = messages[messages.length - 1];
  assert.equal(last.role, "user");
  assert.match(last.content, /Active SQL in editor:/);
  assert.match(last.content, /```sql\nSELECT \* FROM orders WHERE total > 100;\n```/);
  assert.match(last.content, /User request:\n¿Por qué está lenta esta consulta\?/);
});

test("buildMessages en chat omite Active SQL in editor cuando req.sql falta o está vacío", () => {
  const sinSql = buildMessages(
    {
      sessionId: "s1",
      task: "chat",
      prompt: "Lista las tablas",
    },
    "-- Dialect: postgres",
    "postgres"
  );
  assert.equal(sinSql[sinSql.length - 1].content, "Lista las tablas");
  assert.doesNotMatch(sinSql[sinSql.length - 1].content, /Active SQL in editor:/);

  const sqlBlanco = buildMessages(
    {
      sessionId: "s1",
      task: "chat",
      prompt: "Lista las tablas",
      sql: "   \n  ",
    },
    "-- Dialect: postgres",
    "postgres"
  );
  assert.equal(sqlBlanco[sqlBlanco.length - 1].content, "Lista las tablas");
  assert.doesNotMatch(sqlBlanco[sqlBlanco.length - 1].content, /Active SQL in editor:/);
});

test("buildMessages con dialecto mongodb menciona MongoDB y no afirma PostgreSQL", () => {
  const messages = buildMessages(
    {
      sessionId: "s1",
      task: "chat",
      prompt: "Busca órdenes recientes",
    },
    "-- Dialect: mongodb",
    "mongodb"
  );

  const system = messages[0];
  assert.equal(system.role, "system");
  assert.match(system.content, /MongoDB/);
  assert.match(system.content, /db\.collection\.find/);
  assert.doesNotMatch(system.content, /PostgreSQL/);
});
