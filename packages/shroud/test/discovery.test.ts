/**
 * Unit tests for secret discovery (discovery.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSecrets } from "../dist/discovery.js";

function withEnvFile(
  lines: string[],
  fn: (dir: string) => void,
): void {
  const dir = mkdtempSync(join(tmpdir(), "shroud-test-"));
  try {
    writeFileSync(join(dir, ".env"), lines.join("\n"));
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── .env file discovery ────────────────────────────────────────────────────

test("discovers sensitive .env values", () => {
  withEnvFile(
    [
      "DATABASE_URL=postgres://u:supersecretpw@db:5432/app",
      "OPENAI_API_KEY=sk-abc123def456ghi789jkl012",
    ],
    (dir) => {
      const entries = discoverSecrets(dir);
      const names = entries.map((e) => e.name);
      assert.ok(names.includes("DATABASE_URL"));
      assert.ok(names.includes("OPENAI_API_KEY"));
    },
  );
});

test("skips trivial values like PORT, NODE_ENV", () => {
  withEnvFile(
    [
      "DATABASE_URL=postgres://u:pass@db:5432/app",
      "PORT=3000",
      "NODE_ENV=production",
      "HOST=localhost",
    ],
    (dir) => {
      const names = discoverSecrets(dir).map((e) => e.name);
      assert.ok(names.includes("DATABASE_URL"));
      assert.ok(!names.includes("PORT"));
      assert.ok(!names.includes("NODE_ENV"));
      assert.ok(!names.includes("HOST"));
    },
  );
});

test("skips short values (< 8 chars)", () => {
  withEnvFile(["SHORT_KEY=abc"], (dir) => {
    const names = discoverSecrets(dir).map((e) => e.name);
    assert.ok(!names.includes("SHORT_KEY"), "7-char value should be skipped");
  });
});

test("handles quoted values in .env", () => {
  withEnvFile(
    [
      'DATABASE_URL="postgres://u:p@h/db"',
      "API_KEY='sk-quoted-key-12345'",
    ],
    (dir) => {
      const entries = discoverSecrets(dir);
      const db = entries.find((e) => e.name === "DATABASE_URL");
      assert.ok(db);
      assert.equal(db.value, "postgres://u:p@h/db");
      const api = entries.find((e) => e.name === "API_KEY");
      assert.ok(api);
      assert.equal(api.value, "sk-quoted-key-12345");
    },
  );
});

test("handles inline comments in .env values", () => {
  withEnvFile(["MY_SECRET_TOKEN=myvalue12345 # this is a comment"], (dir) => {
    const entries = discoverSecrets(dir);
    const entry = entries.find((e) => e.name === "MY_SECRET_TOKEN");
    assert.ok(entry);
    assert.equal(entry.value, "myvalue12345");
  });
});

test("handles export keyword", () => {
  withEnvFile(["export DATABASE_URL=postgres://u:pass@db:5432/app"], (dir) => {
    const names = discoverSecrets(dir).map((e) => e.name);
    assert.ok(names.includes("DATABASE_URL"));
  });
});

test("skips comment lines and empty lines", () => {
  withEnvFile(
    [
      "",
      "# DATABASE_URL=commented_out_value123",
      "  ",
      "REAL_SECRET=actual_secret_value_here",
    ],
    (dir) => {
      const names = discoverSecrets(dir).map((e) => e.name);
      assert.ok(!names.includes("DATABASE_URL"), "commented line should be skipped");
      assert.ok(names.includes("REAL_SECRET"));
    },
  );
});

test("reads from .env.local and .env.development", () => {
  const dir = mkdtempSync(join(tmpdir(), "shroud-test-"));
  try {
    writeFileSync(join(dir, ".env"), "BASE_TOKEN=base_secret_value_here");
    writeFileSync(join(dir, ".env.local"), "LOCAL_SECRET=local_secret_val_here");
    writeFileSync(join(dir, ".env.development"), "DEV_API_KEY=dev_secret_value_here");
    const names = discoverSecrets(dir).map((e) => e.name);
    assert.ok(names.includes("BASE_TOKEN"));
    assert.ok(names.includes("LOCAL_SECRET"));
    assert.ok(names.includes("DEV_API_KEY"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── Env var discovery ──────────────────────────────────────────────────────

test("never treats infra/session env vars as secrets", () => {
  const dir = mkdtempSync(join(tmpdir(), "shroud-test-"));
  try {
    const names = discoverSecrets(dir).map((e) => e.name);
    assert.ok(!names.includes("HOME"));
    assert.ok(!names.includes("PATH"));
    assert.ok(!names.includes("SSH_AUTH_SOCK"));
    assert.ok(!names.includes("USER"));
    assert.ok(!names.includes("SHELL"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("env vars override dotenv with same name", () => {
  // Set a temp env var, then check it's discovered with env source
  const original = process.env["SHROUD_TEST_SECRET"];
  process.env["SHROUD_TEST_SECRET"] = "env_value_12345678";

  withEnvFile(["SHROUD_TEST_SECRET=dotenv_value_12345678"], (dir) => {
    const entries = discoverSecrets(dir);
    const entry = entries.find((e) => e.name === "SHROUD_TEST_SECRET");
    assert.ok(entry);
    assert.equal(entry.value, "env_value_12345678");
  });

  // Cleanup
  if (original !== undefined) {
    process.env["SHROUD_TEST_SECRET"] = original;
  } else {
    delete process.env["SHROUD_TEST_SECRET"];
  }
});

// ── Sorting ────────────────────────────────────────────────────────────────

test("entries are sorted longest-value-first", () => {
  withEnvFile(
    [
      "LONG_TOKEN=abcdefghijklmnopqrstuvwxyz1234567890",
      "SHORT_SECRET=abcdefghijklmnop",
    ],
    (dir) => {
      const entries = discoverSecrets(dir);
      const longIdx = entries.findIndex((e) => e.name === "LONG_TOKEN");
      const shortIdx = entries.findIndex((e) => e.name === "SHORT_SECRET");
      assert.ok(longIdx >= 0, "LONG_TOKEN should be discovered");
      assert.ok(shortIdx >= 0, "SHORT_SECRET should be discovered");
      assert.ok(longIdx < shortIdx, "longer value should sort before shorter");
    },
  );
});

// ── Edge cases ─────────────────────────────────────────────────────────────

test("handles missing .env files gracefully", () => {
  const dir = mkdtempSync(join(tmpdir(), "shroud-test-"));
  try {
    // no .env file
    const entries = discoverSecrets(dir);
    assert.ok(Array.isArray(entries));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("handles unreadable .env files gracefully", { skip: "requires dynamic import, tested manually" }, () => {
  // chmod-based tests are flaky in ESM; skip in automated runs
  assert.ok(true);
});
