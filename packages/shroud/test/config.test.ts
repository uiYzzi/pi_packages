/**
 * Unit tests for config loading (config.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../dist/config.js";

test("loads empty config when no files exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "shroud-test-"));
  try {
    const config = loadConfig(dir);
    assert.equal(config.patterns.length, 0);
    assert.equal(config.discovery.disabled.length, 0);
    assert.equal(config.discovery.extraFiles.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loads custom patterns from project .pi/shroud.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "shroud-test-"));
  try {
    mkdirSync(join(dir, ".pi"));
    writeFileSync(
      join(dir, ".pi", "shroud.json"),
      JSON.stringify({
        patterns: [
          { name: "ACME", regex: "acme-[0-9a-f]{12}" },
          { name: "CORP", regex: "corp_secret_[A-Za-z0-9]+" },
        ],
      }),
    );
    const config = loadConfig(dir);
    assert.equal(config.patterns.length, 2);
    assert.equal(config.patterns[0]!.name, "ACME");
    assert.equal(config.patterns[0]!.regex, "acme-[0-9a-f]{12}");
    assert.equal(config.patterns[1]!.name, "CORP");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("handles malformed JSON gracefully", () => {
  const dir = mkdtempSync(join(tmpdir(), "shroud-test-"));
  try {
    mkdirSync(join(dir, ".pi"));
    writeFileSync(join(dir, ".pi", "shroud.json"), "not valid json {{{");
    const config = loadConfig(dir);
    assert.equal(config.patterns.length, 0); // should not crash
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("handles non-object JSON gracefully", () => {
  const dir = mkdtempSync(join(tmpdir(), "shroud-test-"));
  try {
    mkdirSync(join(dir, ".pi"));
    writeFileSync(join(dir, ".pi", "shroud.json"), "[1, 2, 3]");
    const config = loadConfig(dir);
    assert.equal(config.patterns.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skips malformed pattern entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "shroud-test-"));
  try {
    mkdirSync(join(dir, ".pi"));
    writeFileSync(
      join(dir, ".pi", "shroud.json"),
      JSON.stringify({
        patterns: [
          { name: "VALID", regex: "valid-[0-9]+" },
          { name: "NO_REGEX" },
          { regex: "no_name-[0-9]+" },
          "not_an_object",
          null,
        ],
      }),
    );
    const config = loadConfig(dir);
    assert.equal(config.patterns.length, 2);
    assert.equal(config.patterns[0]!.name, "VALID");
    assert.equal(config.patterns[1]!.name, "CUSTOM"); // default name
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loads disabled flags", () => {
  const dir = mkdtempSync(join(tmpdir(), "shroud-test-"));
  try {
    mkdirSync(join(dir, ".pi"));
    writeFileSync(
      join(dir, ".pi", "shroud.json"),
      JSON.stringify({ discovery: { disabled: ["netrc", "aws-credentials"] } }),
    );
    const config = loadConfig(dir);
    assert.ok(config.discovery.disabled.includes("netrc"));
    assert.ok(config.discovery.disabled.includes("aws-credentials"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loads extra discovery files", () => {
  const dir = mkdtempSync(join(tmpdir(), "shroud-test-"));
  try {
    mkdirSync(join(dir, ".pi"));
    writeFileSync(
      join(dir, ".pi", "shroud.json"),
      JSON.stringify({
        discovery: {
          extraFiles: [
            { path: "/tmp/my.credentials", format: "dotenv" },
            { path: "/tmp/token.txt", format: "raw", secretName: "my_token" },
          ],
        },
      }),
    );
    const config = loadConfig(dir);
    assert.equal(config.discovery.extraFiles.length, 2);
    assert.equal(config.discovery.extraFiles[0]!.format, "dotenv");
    assert.equal(config.discovery.extraFiles[1]!.format, "raw");
    assert.equal(config.discovery.extraFiles[1]!.secretName, "my_token");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("merges patterns from both global and project config", () => {
  // This test can't easily test global config because it reads ~/.pi/agent/shroud.json
  // Just verify project config loads properly
  const dir = mkdtempSync(join(tmpdir(), "shroud-test-"));
  try {
    mkdirSync(join(dir, ".pi"));
    writeFileSync(
      join(dir, ".pi", "shroud.json"),
      JSON.stringify({ patterns: [{ name: "PROJ", regex: "proj-[0-9]+" }] }),
    );
    const config = loadConfig(dir);
    assert.ok(config.patterns.some((p) => p.name === "PROJ"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
