import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDelivery, SYSTEM_NOTICE } from "../dist/format.js";

test("header carries count and the no-poll instruction", () => {
  const text = formatDelivery([{ subject: "hi", body: "x" }]);
  assert.match(text, /1 message\(s\)/);
  assert.match(text, /check --wait/);
  assert.match(text, /auto-injected/);
});

test("renders type/from/id/subject/body", () => {
  const text = formatDelivery([
    {
      id: "msg_1",
      type: "worker_done",
      from: "term-9",
      subject: "done",
      body: "fixed the thing",
      sentAt: "2026-04-26T10:00:00Z",
    },
  ]);
  for (const needle of ["type=worker_done", "from=term-9", "id=msg_1", "Subject: done", "fixed the thing"]) {
    assert.ok(text.includes(needle), `missing ${needle}`);
  }
});

test("question messages get a reply hint with the id", () => {
  const text = formatDelivery([{ id: "msg_q", type: "question", body: "proceed?" }]);
  assert.match(text, /orca orchestration reply --id msg_q --body/);
});

test("non-question messages get no reply hint", () => {
  const text = formatDelivery([{ id: "msg_s", type: "status", body: "fyi" }]);
  assert.doesNotMatch(text, /orchestration reply/);
});

test("long bodies are capped", () => {
  const text = formatDelivery([{ body: "x".repeat(10_000) }]);
  assert.match(text, /truncated/);
  assert.ok(text.length < 6000);
});

test("system notice forbids mailbox polling", () => {
  assert.match(SYSTEM_NOTICE, /never need to run `orca orchestration check`/);
  assert.match(SYSTEM_NOTICE, /orchestration reply/);
});
