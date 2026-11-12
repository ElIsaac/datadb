import { test } from "node:test";
import assert from "node:assert/strict";
import { HandlerError, errorToPayload } from "./errors";

test("HandlerError conserva mensaje y status exactos", () => {
  assert.deepEqual(errorToPayload(new HandlerError("Session not found", 401)), {
    message: "Session not found",
    status: 401,
  });
});

test("un Error generico se serializa como String(err) con 500, igual que las rutas", () => {
  // Las rutas hacen error(String(err), 500): el mensaje lleva el prefijo "Error: ".
  assert.deepEqual(errorToPayload(new Error("boom")), { message: "Error: boom", status: 500 });
});

test("un throw de string se respeta", () => {
  assert.deepEqual(errorToPayload("raro"), { message: "raro", status: 500 });
});

test("el texto de un error de sesion perdida sigue matcheando la auto-reconexion", () => {
  const p = errorToPayload(new HandlerError("Session not found", 401));
  assert.match(p.message, /session not found/i);
});
