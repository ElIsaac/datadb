import { test } from "node:test";
import assert from "node:assert/strict";
import { isTrustedSenderUrl } from "./sender";

test("en desarrollo solo se acepta el origen del dev server de Vite", () => {
  const dev = "http://localhost:5173";
  assert.equal(isTrustedSenderUrl("http://localhost:5173/", dev), true);
  assert.equal(isTrustedSenderUrl("http://localhost:5173/algo?x=1", dev), true);
  assert.equal(isTrustedSenderUrl("http://localhost:5173.evil.com/", dev), false);
  assert.equal(isTrustedSenderUrl("http://localhost:3000/", dev), false);
  assert.equal(isTrustedSenderUrl("https://evil.com/", dev), false);
});

test("en produccion solo file://", () => {
  assert.equal(isTrustedSenderUrl("file:///Applications/GestorDB.app/x/index.html", undefined), true);
  assert.equal(isTrustedSenderUrl("https://evil.com/", undefined), false);
  assert.equal(isTrustedSenderUrl("http://localhost:5173/", undefined), false);
});

test("url vacia o ausente se rechaza", () => {
  assert.equal(isTrustedSenderUrl("", "http://localhost:5173"), false);
  assert.equal(isTrustedSenderUrl(undefined, undefined), false);
});
