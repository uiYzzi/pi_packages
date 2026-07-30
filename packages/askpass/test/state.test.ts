/**
 * Unit tests for askpass state helpers (state.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createState,
  deriveName,
  isValidName,
  placeholderFor,
  scrubText,
} from "../dist/state.js";

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

test("scrubText redacts captured values with placeholder", () => {
  const st = createState();
  st.secrets.push({ name: "GH_TOKEN", value: "ghp_abcdef123", description: "x" });
  const out = scrubText("token is ghp_abcdef123 ok?", st);
  assert.ok(out?.includes(placeholderFor("GH_TOKEN")));
  assert.ok(!out?.includes("ghp_abcdef123"));
  assert.equal(st.stats.scrubbed, 1);
});

test("scrubText skips short values and misses", () => {
  const st = createState();
  st.secrets.push({ name: "PIN", value: "123", description: "y" });
  assert.equal(scrubText("pin 123", st), undefined);
  assert.equal(scrubText("nothing here", st), undefined);
});
