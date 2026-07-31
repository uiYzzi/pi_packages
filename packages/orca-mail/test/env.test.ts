import { test } from "node:test";
import assert from "node:assert/strict";
import { detectOrcaEnv } from "../dist/env.js";

test("returns null without ORCA_TERMINAL_HANDLE", () => {
  assert.equal(detectOrcaEnv({}), null);
});

test("leaked non-identity ORCA_* vars do NOT count as Orca", () => {
  // e.g. a child process that inherited ORCA_PI_STATUS_OWNED only
  assert.equal(detectOrcaEnv({ ORCA_PI_STATUS_OWNED: "3866" }), null);
  assert.equal(
    detectOrcaEnv({ ORCA_APP_VERSION: "1.4.162", ORCA_USER_DATA_PATH: "/x" }),
    null,
  );
});

test("detects a real Orca agent terminal", () => {
  const env = detectOrcaEnv({
    ORCA_TERMINAL_HANDLE: "term-abc",
    ORCA_WORKTREE_ID: "repo::/path",
  });
  assert.ok(env);
  assert.equal(env.terminalHandle, "term-abc");
  assert.equal(env.worktreeId, "repo::/path");
  assert.equal(env.cliCommand, "orca"); // default
});

test("honors ORCA_CLI_COMMAND override", () => {
  const env = detectOrcaEnv({
    ORCA_TERMINAL_HANDLE: "term-abc",
    ORCA_CLI_COMMAND: "orca-ide",
  });
  assert.equal(env?.cliCommand, "orca-ide");
});

test("worktreeId omitted when absent", () => {
  const env = detectOrcaEnv({ ORCA_TERMINAL_HANDLE: "term-abc" });
  assert.equal(env?.worktreeId, undefined);
});
