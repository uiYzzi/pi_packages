/**
 * Unit tests for guidance text generation (guidance.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGuidance } from "../dist/guidance.js";

test("guidance includes shell var list when secrets present", () => {
  const guidance = buildGuidance([
    { name: "OPENAI_API_KEY", value: "sk-test123456789" },
    { name: "DATABASE_URL", value: "postgres://localhost/test" },
  ]);
  assert.ok(guidance.includes("$OPENAI_API_KEY"));
  assert.ok(guidance.includes("$DATABASE_URL"));
  assert.ok(guidance.includes("redacted"));
  assert.ok(guidance.includes("placeholder"));
});

test("guidance works with empty secrets list", () => {
  const guidance = buildGuidance([]);
  assert.ok(guidance.includes("redacted"));
  assert.ok(!guidance.includes("Available:"));
});

test("guidance includes usage rules", () => {
  const guidance = buildGuidance([{ name: "KEY", value: "some_value_12345678" }]);
  assert.ok(guidance.includes("Never echo"));
  assert.ok(guidance.includes("bash"));
  assert.ok(guidance.includes("curl"));
});

test("guidance stays terse", () => {
  const guidance = buildGuidance([{ name: "KEY", value: "some_value_12345678" }]);
  assert.ok(guidance.split("\n").length <= 10);
});
