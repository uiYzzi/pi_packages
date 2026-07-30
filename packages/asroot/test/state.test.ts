/**
 * Unit tests for asroot state helpers (state.ts).
 * sudo process helpers need a real sudo and are not unit-tested.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createState,
  freshPassword,
  referencesSudo,
  scrubText,
  PASSWORD_NAME,
} from "../dist/state.js";
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

test("freshPassword returns value while fresh, drops when expired", () => {
  const st = createState();
  st.cached = { value: "hunter2hunter2", expiresAt: Date.now() + 60_000 };
  assert.equal(freshPassword(st), "hunter2hunter2");

  st.cached = { value: "hunter2hunter2", expiresAt: Date.now() - 1 };
  assert.equal(freshPassword(st), null);
  assert.equal(st.cached, null);
});

test("scrubText redacts the cached password and counts hits", () => {
  const st = createState();
  st.cached = { value: "hunter2hunter2", expiresAt: Date.now() + 60_000 };
  const out = scrubText("pw hunter2hunter2 leaked", st);
  assert.ok(out?.includes(placeholderFor(PASSWORD_NAME)));
  assert.ok(!out?.includes("hunter2hunter2"));
  assert.equal(st.stats.scrubbed, 1);
});

test("scrubText no-ops without a cached password", () => {
  const st = createState();
  assert.equal(scrubText("anything", st), undefined);
});

test("scrubText skips when shroud owns scrubbing", () => {
  const st = createState();
  st.cached = { value: "hunter2hunter2", expiresAt: Date.now() + 60_000 };
  st.shroudSynced = true;
  assert.equal(scrubText("pw hunter2hunter2 leaked", st), undefined);
});

test("expiry resets shroudSynced", () => {
  const st = createState();
  st.cached = { value: "hunter2hunter2", expiresAt: Date.now() - 1 };
  st.shroudSynced = true;
  assert.equal(freshPassword(st), null);
  assert.equal(st.shroudSynced, false);
});
