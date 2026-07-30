/**
 * Unit tests for asroot state helpers (state.ts).
 * sudo process helpers need a real sudo and are not unit-tested.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createState, referencesSudo, scrubText, PASSWORD_NAME } from "../dist/state.js";
import { placeholderFor } from "@uiyzzi/pi-secret-kit";

test("referencesSudo matches real invocations", () => {
  assert.ok(referencesSudo("sudo ls /var/root"));
  assert.ok(referencesSudo("sudo -n true"));
  assert.ok(referencesSudo("echo ok && sudo rm x"));
  assert.ok(referencesSudo("echo ok;sudo rm x"));
  assert.ok(referencesSudo("echo ok | sudo tee /etc/x"));
  assert.ok(referencesSudo("(sudo id)"));
});

test("referencesSudo ignores lookalikes", () => {
  assert.ok(!referencesSudo("pseudo random"));
  assert.ok(!referencesSudo("echo sudo"));
  assert.ok(!referencesSudo("ls /tmp"));
});

test("scrubText redacts the password and counts hits", () => {
  const st = createState();
  st.password = "hunter2hunter2";
  const out = scrubText("pw hunter2hunter2 leaked", st);
  assert.ok(out?.includes(placeholderFor(PASSWORD_NAME)));
  assert.ok(!out?.includes("hunter2hunter2"));
  assert.equal(st.stats.scrubbed, 1);
});

test("scrubText no-ops without a password", () => {
  const st = createState();
  assert.equal(scrubText("anything", st), undefined);
});
