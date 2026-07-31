import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCheckJson, parseRunListJson, makeOrcaCheck } from "../dist/runner.js";

test("parses the { ok, result } envelope", () => {
  const out = JSON.stringify({
    ok: true,
    result: { deliveryId: "d1", messages: [{ id: "m1", body: "hi" }] },
  });
  const b = parseCheckJson(out);
  assert.equal(b.deliveryId, "d1");
  assert.equal(b.messages.length, 1);
});

test("parses a bare result object and snake_case delivery id", () => {
  const b = parseCheckJson(JSON.stringify({ delivery_id: "d2", messages: [] }));
  assert.equal(b.deliveryId, "d2");
});

test("timeout result (no messages) has no deliveryId requirement", () => {
  const b = parseCheckJson(JSON.stringify({ ok: true, result: { count: 0, messages: [] } }));
  assert.equal(b.messages.length, 0);
  assert.equal(b.deliveryId, undefined);
});

test("ok:false throws with the server message and code", () => {
  let caught: unknown;
  try {
    parseCheckJson(
      JSON.stringify({ ok: false, error: { code: "legacy_read_only", message: "no ack" } }),
    );
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof Error);
  assert.match(caught.message, /no ack/);
  assert.equal((caught as { code?: string }).code, "legacy_read_only");
});

test("invalid JSON throws", () => {
  assert.throws(() => parseCheckJson("not json"));
});

// --- parseRunListJson ---

const HANDLE = "term_self";

function runList(runs: unknown[]): string {
  return JSON.stringify({ ok: true, result: { runs } });
}

test("run-list: picks the run coordinated by this terminal", () => {
  const out = runList([
    { id: "run_other", coordinator_handle: "term_other", legacy: 0 },
    { id: "run_mine", coordinator_handle: HANDLE, legacy: 0 },
  ]);
  assert.equal(parseRunListJson(out, HANDLE), "run_mine");
});

test("run-list: ignores legacy runs and other terminals", () => {
  const out = runList([
    { id: "run_legacy_local", coordinator_handle: HANDLE, legacy: 1 },
    { id: "run_other", coordinator_handle: "term_other", legacy: 0 },
  ]);
  assert.equal(parseRunListJson(out, HANDLE), undefined);
});

test("run-list: multiple own runs → most recently updated wins", () => {
  const out = runList([
    { id: "run_old", coordinator_handle: HANDLE, legacy: 0, updated_at: "2026-07-31T03:00:00Z" },
    { id: "run_new", coordinator_handle: HANDLE, legacy: 0, updated_at: "2026-07-31T07:00:00Z" },
  ]);
  assert.equal(parseRunListJson(out, HANDLE), "run_new");
});

test("run-list: ok:false throws", () => {
  assert.throws(
    () => parseRunListJson(JSON.stringify({ ok: false, error: { message: "no runtime" } }), HANDLE),
    /no runtime/,
  );
});

// --- makeOrcaCheck with a stub CLI ---

function writeStubCli(dir: string): string {
  const script = `#!/bin/sh
# Stub orca CLI: behaviour driven by files in "${dir}".
# $2 is the orchestration sub-command (run-list|check).
if [ "$2" = "run-list" ]; then
  cat "${dir}/run-list.json"
  exit 0
fi
if [ "$2" = "check" ]; then
  echo "$@" > "${dir}/check-args.txt"
  if [ -f "${dir}/check-exit1.json" ]; then
    cat "${dir}/check-exit1.json"
    exit 1
  fi
  cat "${dir}/check.json"
  exit 0
fi
exit 64
`;
  const path = join(dir, "orca-stub");
  writeFileSync(path, script, { mode: 0o755 });
  return path;
}

const ac = () => new AbortController();

test("dormant: no coordinator run → empty batch without calling check", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orca-mail-"));
  const cli = writeStubCli(dir);
  writeFileSync(
    join(dir, "run-list.json"),
    runList([{ id: "run_other", coordinator_handle: "term_other", legacy: 0 }]),
  );
  const check = makeOrcaCheck(cli, HANDLE, { probeIntervalMs: 5 });
  const batch = await check(undefined, ac().signal);
  assert.equal(batch.messages.length, 0);
  assert.equal(existsSync(join(dir, "check-args.txt")), false); // check never spawned
});

test("active run: blocking check with --run/--types, ack rides along", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orca-mail-"));
  const cli = writeStubCli(dir);
  writeFileSync(
    join(dir, "run-list.json"),
    runList([{ id: "run_mine", coordinator_handle: HANDLE, legacy: 0 }]),
  );
  writeFileSync(
    join(dir, "check.json"),
    JSON.stringify({
      ok: true,
      result: { deliveryId: "d9", messages: [{ id: "m1", type: "worker_done" }] },
    }),
  );
  const check = makeOrcaCheck(cli, HANDLE, { probeIntervalMs: 5 });
  const batch = await check("d8", ac().signal);
  assert.equal(batch.deliveryId, "d9");
  assert.equal(batch.messages.length, 1);

  const args = readFileSync(join(dir, "check-args.txt"), "utf8");
  assert.match(args, /--run run_mine/);
  assert.match(args, /--types worker_done,escalation,question/);
  assert.match(args, /--ack d8/);
});

test("run gone mid-check (legacy_read_only envelope, exit 1) → empty batch, no throw", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orca-mail-"));
  const cli = writeStubCli(dir);
  writeFileSync(
    join(dir, "run-list.json"),
    runList([{ id: "run_mine", coordinator_handle: HANDLE, legacy: 0 }]),
  );
  writeFileSync(
    join(dir, "check-exit1.json"),
    JSON.stringify({ ok: false, error: { code: "legacy_read_only", message: "inspect-only" } }),
  );
  const check = makeOrcaCheck(cli, HANDLE, { probeIntervalMs: 5 });
  const batch = await check(undefined, ac().signal);
  assert.equal(batch.messages.length, 0);
  assert.equal(batch.deliveryId, undefined);
});

test("run-list failing hard (non-run-gone) rejects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orca-mail-"));
  const cli = writeStubCli(dir);
  writeFileSync(
    join(dir, "run-list.json"),
    JSON.stringify({ ok: false, error: { message: "runtime unreachable" } }),
  );
  const check = makeOrcaCheck(cli, HANDLE, { probeIntervalMs: 5 });
  await assert.rejects(() => check(undefined, ac().signal), /runtime unreachable/);
});
