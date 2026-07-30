/**
 * Unit tests for scrubValues (scrub.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { placeholderFor, scrubValues } from "../dist/scrub.js";

test("scrubs exact values with placeholder", () => {
  const out = scrubValues("token is ghp_abcdef123 ok?", [
    { name: "GH_TOKEN", value: "ghp_abcdef123" },
  ]);
  assert.equal(out?.hits, 1);
  assert.ok(out?.text.includes(placeholderFor("GH_TOKEN")));
  assert.ok(!out?.text.includes("ghp_abcdef123"));
});

test("skips short values and misses", () => {
  assert.equal(scrubValues("pin 123", [{ name: "PIN", value: "123" }]), undefined);
  assert.equal(scrubValues("nothing", [{ name: "K", value: "abcdef" }]), undefined);
});

test("scrubs multiple occurrences and multiple secrets", () => {
  const out = scrubValues("aaaa bbbb aaaa", [
    { name: "A", value: "aaaa" },
    { name: "B", value: "bbbb" },
  ]);
  assert.equal(out?.hits, 2);
  assert.ok(!out?.text.includes("aaaa"));
  assert.ok(!out?.text.includes("bbbb"));
});
