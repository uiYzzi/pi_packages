import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCheckJson } from "../dist/runner.js";

test("parses the { ok, result } envelope", () => {
  const out = JSON.stringify({
    ok: true,
    result: { deliveryId: "d1", messages: [{ id: "m1", body: "hi" }] },
  });
  const b = parseCheckJson(out);
  assert.equal(b.deliveryId, "d1");
  assert.equal(b.messages.length, 1);
});

test("parses a bare result object and snake_case delivery id", () => {
  const b = parseCheckJson(JSON.stringify({ delivery_id: "d2", messages: [] }));
  assert.equal(b.deliveryId, "d2");
});

test("timeout result (no messages) has no deliveryId requirement", () => {
  const b = parseCheckJson(JSON.stringify({ ok: true, result: { count: 0, messages: [] } }));
  assert.equal(b.messages.length, 0);
  assert.equal(b.deliveryId, undefined);
});

test("ok:false throws with the server message", () => {
  assert.throws(
    () => parseCheckJson(JSON.stringify({ ok: false, error: { message: "no runtime" } })),
    /no runtime/,
  );
});

test("invalid JSON throws", () => {
  assert.throws(() => parseCheckJson("not json"));
});
