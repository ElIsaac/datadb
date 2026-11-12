import { test } from "node:test";
import assert from "node:assert/strict";
import { unwrap } from "./ipc-client";
import { ApiError } from "./api-error";

test("unwrap devuelve data cuando ok", () => {
  assert.equal(unwrap({ ok: true, data: 5 }), 5);
});

test("unwrap lanza ApiError con mensaje y status exactos", () => {
  assert.throws(
    () => unwrap({ ok: false, error: { message: "Session not found", status: 401 } }),
    (err: unknown) =>
      err instanceof ApiError && err.message === "Session not found" && err.status === 401
  );
});

test("CONTRATO con la auto-reconexion: String(err) matchea /session not found/i", () => {
  // sql-editor.tsx (~233) hace exactamente esto sobre el error de runQuery.
  for (const message of ["Session not found", "Error: Session not found"]) {
    try {
      unwrap({ ok: false, error: { message, status: message.startsWith("Error") ? 500 : 401 } });
      assert.fail("debia lanzar");
    } catch (err) {
      assert.match(String(err), /session not found/i);
    }
  }
});
