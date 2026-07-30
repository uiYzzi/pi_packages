/**
 * Unit tests for askpass state (state.ts).
 * Name/scrub primitives live in @uiyzzi/pi-secret-kit and are tested there.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createState, scrubText } from "../dist/state.js";
import { placeholderFor } from "@uiyzzi/pi-secret-kit";

test("scrubText redacts captured values and counts hits", () => {
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
  assert.equal(st.stats.scrubbed, 0);
});
