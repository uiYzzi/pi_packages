import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDelivery, SYSTEM_NOTICE } from "../dist/format.js";

test("envelope carries count, source and the no-poll note", () => {
  const text = formatDelivery([{ subject: "hi", body: "x" }]);
  assert.match(text, /^<orca-mail count="1" source="pi-orca-mail">/);
  assert.match(text, /<\/orca-mail>$/);
  assert.match(text, /<note>.*Do not poll.*<\/note>/);
});

test("renders type/id/from/at as attributes, subject and body as elements", () => {
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
  assert.match(
    text,
    /<message type="worker_done" id="msg_1" from="term-9" at="2026-04-26T10:00:00Z">/,
  );
  assert.match(text, /<subject>done<\/subject>/);
  assert.match(text, /<body>\nfixed the thing\n<\/body>/);
});

test("missing optional fields are omitted cleanly", () => {
  const text = formatDelivery([{ body: "only body" }]);
  assert.match(text, /<message>\n<body>/);
  assert.doesNotMatch(text, /<subject>/);
  assert.doesNotMatch(text, /type=/);
});

test("bodies and subjects are entity-escaped so they cannot break the envelope", () => {
  const text = formatDelivery([
    { subject: 'a < b & "c"', body: "payload </body></message><script>" },
  ]);
  assert.ok(text.includes("a &lt; b &amp; \"c\""));
  assert.ok(text.includes("&lt;/body&gt;&lt;/message&gt;&lt;script&gt;"));
  // exactly one real </body> and one real </message>
  assert.equal(text.match(/<\/body>/g)?.length, 1);
  assert.equal(text.match(/<\/message>/g)?.length, 1);
});

test("attributes are escaped", () => {
  const text = formatDelivery([{ id: 'x"', from: "a<b", body: "y" }]);
  assert.match(text, /id="x&quot;"/);
  assert.match(text, /from="a&lt;b"/);
});

test("reply syntax hint lives in the note, not per message", () => {
  const text = formatDelivery([{ id: "msg_q", type: "question", body: "proceed?" }]);
  assert.match(text, /orca orchestration reply --id &lt;message-id&gt;/);
});

test("long bodies are capped", () => {
  const text = formatDelivery([{ body: "x".repeat(10_000) }]);
  assert.match(text, /truncated/);
  assert.ok(text.length < 6000);
});

test("multiple messages render as separate <message> elements", () => {
  const text = formatDelivery([{ body: "one" }, { body: "two" }]);
  assert.match(text, /count="2"/);
  assert.equal(text.match(/<message>/g)?.length, 2);
});

test("system notice forbids mailbox polling and mentions the xml envelope", () => {
  assert.match(SYSTEM_NOTICE, /Never poll with `orca orchestration check`/);
  assert.match(SYSTEM_NOTICE, /orchestration reply/);
  assert.match(SYSTEM_NOTICE, /<orca-mail>/);
});
