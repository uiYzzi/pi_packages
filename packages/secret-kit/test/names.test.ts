/**
 * Unit tests for name helpers (names.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveName, isValidName } from "../dist/names.js";

test("deriveName makes valid env var names", () => {
  assert.equal(deriveName("GitHub Token"), "GITHUB_TOKEN");
  assert.equal(deriveName("context7 api key"), "CONTEXT7_API_KEY");
  assert.equal(deriveName("123 abc"), "SECRET_123_ABC");
  assert.equal(deriveName("---"), "SECRET_VALUE");
});

test("isValidName enforces env var shape", () => {
  assert.ok(isValidName("FOO_BAR"));
  assert.ok(isValidName("_X1"));
  assert.ok(!isValidName("1FOO"));
  assert.ok(!isValidName("foo"));
  assert.ok(!isValidName("FOO-BAR"));
});
