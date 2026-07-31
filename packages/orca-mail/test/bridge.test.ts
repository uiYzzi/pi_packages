import { test } from "node:test";
import assert from "node:assert/strict";
import { MailBridge, type Batch, type BridgeDeps } from "../dist/bridge.js";

const tick = () => new Promise<void>((r) => setImmediate(r));

/**
 * A bridge whose async surfaces are all scriptable from the test.
 * Nothing starts until start() is called — queue the rounds first.
 */
function rig(overrides: Partial<BridgeDeps> = {}) {
  const calls: { ackId: string | undefined }[] = [];
  const delivered: Batch["messages"][] = [];
  const errors: unknown[] = [];
  const queue: (Batch | Error)[] = [];
  const deps: BridgeDeps = {
    check: (ackId) => {
      calls.push({ ackId });
      const next = queue.shift();
      if (next === undefined) {
        // Idle wait: yield to the event loop like the real 60s spawn would.
        return new Promise((res) => setImmediate(() => res({ messages: [] })));
      }
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    deliver: (m) => {
      delivered.push(m);
    },
    isIdle: () => true,
    onError: (e) => errors.push(e),
    sleep: () => Promise.resolve(),
    ...overrides,
  };
  const bridge = new MailBridge(deps);
  const start = () => {
    const controller = new AbortController();
    const done = bridge.run(controller.signal);
    return {
      done,
      /** Always-safe cleanup: releases held waits AND aborts. */
      stop: () => {
        bridge.stop();
        controller.abort();
      },
    };
  };
  return { bridge, calls, delivered, errors, queue, start };
}

const batch = (deliveryId: string, n = 1): Batch => ({
  deliveryId,
  messages: Array.from({ length: n }, (_, i) => ({ id: `${deliveryId}-m${i}`, body: "x" })),
});
const empty = (): Batch => ({ messages: [] });

test("idle: delivers immediately, acks on the next check round", async (t) => {
  const r = rig();
  r.queue.push(batch("d1"));
  const s = r.start();
  t.after(s.stop);
  await tick();
  assert.equal(r.delivered.length, 1);
  await tick();
  assert.deepEqual(r.calls.slice(0, 2).map((c) => c.ackId), [undefined, "d1"]);
  s.stop();
  await s.done.catch(() => {});
});

test("busy: batch is held until the context hook takes it; then acked", async (t) => {
  const r = rig({ isIdle: () => false });
  r.queue.push(batch("d1"));
  const s = r.start();
  t.after(s.stop);
  await tick();
  assert.equal(r.delivered.length, 0);
  assert.ok(r.bridge.hasHeld());

  const held = r.bridge.takeHeld();
  assert.equal(held?.deliveryId, "d1");
  await tick();
  await tick();
  assert.deepEqual(r.calls.slice(0, 2).map((c) => c.ackId), [undefined, "d1"]);
  s.stop();
  await s.done.catch(() => {});
});

test("takeHeld returns undefined when nothing is held", () => {
  const bridge = new MailBridge({
    check: () => Promise.reject(new Error("x")),
    deliver: () => {},
    isIdle: () => true,
  });
  assert.equal(bridge.takeHeld(), undefined);
});

test("deliver throwing (agent went busy) falls back to held", async (t) => {
  const r = rig({
    deliver: () => {
      throw new Error("Agent is already processing");
    },
  });
  r.queue.push(batch("d1"));
  const s = r.start();
  t.after(s.stop);
  await tick();
  assert.ok(r.bridge.hasHeld());
  s.stop();
  await s.done.catch(() => {});
});

test("server replay of an injected batch is acked again but never re-injected", async (t) => {
  const r = rig();
  // round 1: d1 delivered; round 2 (ack d1): server replays d1 (ack was lost);
  // round 3 must re-ack d1; round 4 fetches fresh d2.
  r.queue.push(batch("d1"), batch("d1"), empty(), batch("d2"));
  const s = r.start();
  t.after(s.stop);
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(r.delivered.length, 2, "d1 injected once, d2 injected once");
  assert.equal(r.delivered[0]?.[0]?.id, "d1-m0");
  assert.equal(r.delivered[1]?.[0]?.id, "d2-m0");
  assert.deepEqual(r.calls.slice(0, 5).map((c) => c.ackId), [undefined, "d1", "d1", undefined, "d2"]);
  s.stop();
  await s.done.catch(() => {});
});

test("check errors keep the unacked slot and retry after backoff", async (t) => {
  const r = rig();
  // round 1: deliver d1; round 2: ack attempt fails; round 3: retry acks fine.
  r.queue.push(batch("d1"), new Error("runtime down"), empty());
  const s = r.start();
  t.after(s.stop);
  for (let i = 0; i < 4; i++) await tick();
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.calls.slice(0, 3).map((c) => c.ackId), [undefined, "d1", "d1"]);
  s.stop();
  await s.done.catch(() => {});
});

test("stop() while held unblocks the loop and exits", async (t) => {
  const r = rig({ isIdle: () => false });
  r.queue.push(batch("d1"));
  const s = r.start();
  t.after(s.stop);
  await tick();
  assert.ok(r.bridge.hasHeld());
  s.stop();
  await s.done.catch(() => {});
});
