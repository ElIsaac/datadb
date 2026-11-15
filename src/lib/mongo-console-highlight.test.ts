import assert from "node:assert/strict";
import test from "node:test";
import { highlightMongoLines } from "./mongo-console-highlight";

function sliceTokens(line: string, tokens: { from: number; to: number; cls: string }[]) {
  return tokens.map((t) => [line.slice(t.from, t.to), t.cls] as const);
}

test("highlightMongoLines colors MQL command parts", () => {
  const line = 'db.users.find({ "activo": true, $or: [{ age: { $gte: 18 } }] }).limit(25)';
  const [tokens] = highlightMongoLines([line]);
  const pairs = sliceTokens(line, tokens);

  assert.deepEqual(
    pairs.filter(([, cls]) => cls !== "ld-op"),
    [
      ["db", "ld-kw"],
      ["users", "ld-col"],
      ["find", "ld-fn"],
      ['"activo"', "ld-col"],
      ["true", "ld-kw"],
      ["$or", "ld-type"],
      ["age", "ld-col"],
      ["$gte", "ld-type"],
      ["18", "ld-num"],
      ["limit", "ld-fn"],
      ["25", "ld-num"],
    ]
  );
});

test("highlightMongoLines colors JSON output keys, strings, numbers, and keywords", () => {
  const lines = ['{', '  "_id": "abc",', '  "count": -3.5,', '  "ok": false,', '  "extra": null', '}'];
  const result = highlightMongoLines(lines);

  assert.deepEqual(sliceTokens(lines[1], result[1]), [
    ['"_id"', "ld-col"],
    [":", "ld-op"],
    ['"abc"', "ld-str"],
    [",", "ld-op"],
  ]);
  assert.deepEqual(sliceTokens(lines[2], result[2]), [
    ['"count"', "ld-col"],
    [":", "ld-op"],
    ["-3.5", "ld-num"],
    [",", "ld-op"],
  ]);
  assert.deepEqual(sliceTokens(lines[3], result[3]), [
    ['"ok"', "ld-col"],
    [":", "ld-op"],
    ["false", "ld-kw"],
    [",", "ld-op"],
  ]);
  assert.deepEqual(sliceTokens(lines[4], result[4]), [
    ['"extra"', "ld-col"],
    [":", "ld-op"],
    ["null", "ld-kw"],
  ]);
});

test("highlightMongoLines handles line and multi-line comments", () => {
  const lines = ["/* bloque", "   sigue */ db.items.countDocuments({}) // fin"];
  const result = highlightMongoLines(lines);

  assert.deepEqual(sliceTokens(lines[0], result[0]), [["/* bloque", "ld-com"]]);
  assert.deepEqual(
    sliceTokens(lines[1], result[1]).filter(([, cls]) => cls !== "ld-op"),
    [
      ["   sigue */", "ld-com"],
      ["db", "ld-kw"],
      ["items", "ld-col"],
      ["countDocuments", "ld-fn"],
      ["// fin", "ld-com"],
    ]
  );
});
