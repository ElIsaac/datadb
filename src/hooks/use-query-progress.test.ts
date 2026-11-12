import { test } from "node:test";
import assert from "node:assert/strict";
import { formatElapsed } from "./use-query-progress";

test("formatElapsed: coma decimal por debajo del minuto y min/s a partir de ahí", () => {
  assert.equal(formatElapsed(0), "0,0 s");
  assert.equal(formatElapsed(3240), "3,2 s");
  assert.equal(formatElapsed(59_940), "59,9 s");
  assert.equal(formatElapsed(65_000), "1 min 05 s");
});
