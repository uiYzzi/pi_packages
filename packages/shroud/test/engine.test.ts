/**
 * Unit tests for the redaction engine (engine.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRedactor } from "../dist/engine.js";

// ── Literal value redaction ────────────────────────────────────────────────

test("redacts single secret value", () => {
  const r = createRedactor([{ name: "API_KEY", value: "sk-abc123def456ghi789jkl012" }]);
  const out = r.redact("Authorization: Bearer sk-abc123def456ghi789jkl012");
  assert.ok(!out.text.includes("sk-abc123def456ghi789jkl012"));
  assert.ok(out.text.includes('"$API_KEY"'));
  assert.equal(out.hits, 1);
});

test("redacts multiple occurrences of same secret", () => {
  const r = createRedactor([{ name: "TOKEN", value: "supersecret12345" }]);
  const out = r.redact("token: supersecret12345 and again: supersecret12345");
  assert.equal(out.hits, 2);
  assert.ok(!out.text.includes("supersecret12345"));
});

test("redacts multiple different secrets", () => {
  const r = createRedactor([
    { name: "DB", value: "postgres://u:pass123@db:5432/app" },
    { name: "API", value: "sk-abcdefghijklmnop" },
  ]);
  const out = r.redact("db=postgres://u:pass123@db:5432/app key=sk-abcdefghijklmnop");
  assert.ok(!out.text.includes("pass123"));
  assert.ok(!out.text.includes("sk-abcdefghijklmnop"));
  assert.ok(out.text.includes('"$DB"'));
  assert.ok(out.text.includes('"$API"'));
  assert.equal(out.hits, 2);
});

test("longer secret matched greedily over shorter prefix", () => {
  // If we have "abc" and "abcdef", "abcdef" should match as one, not "abc" + "def"
  const r = createRedactor([
    { name: "SHORT", value: "abc123" },
    { name: "LONG", value: "abc123xyz" },
  ]);
  const out = r.redact("prefix abc123xyz suffix");
  assert.ok(!out.text.includes("abc123"));
  assert.ok(out.text.includes('"$LONG"'));
  assert.equal(out.hits, 1);
});

test("no redaction for non-matching text", () => {
  const r = createRedactor([{ name: "KEY", value: "real-secret-key-123" }]);
  const out = r.redact("server listening on port 3000");
  assert.equal(out.text, "server listening on port 3000");
  assert.equal(out.hits, 0);
});

test("empty string returns empty with zero hits", () => {
  const r = createRedactor([{ name: "K", value: "something12345" }]);
  const out = r.redact("");
  assert.equal(out.text, "");
  assert.equal(out.hits, 0);
});

test("values shorter than 8 chars are ignored", () => {
  // In engine.ts, we filter values.length < 8 in buildState
  const r = createRedactor([{ name: "SHORT", value: "abc12" }]);
  const out = r.redact("prefix abc12 suffix");
  // Should remain unchanged since value too short to compile
  assert.ok(out.text.includes("abc12"));
  assert.equal(out.hits, 0);
});

// ── Refresh ────────────────────────────────────────────────────────────────

test("refresh updates secret list atomically", () => {
  const r = createRedactor([{ name: "OLD", value: "old_secret_value" }]);
  r.refresh([{ name: "NEW", value: "new_secret_value" }]);
  const out = r.redact("using new_secret_value, not old_secret_value");
  assert.ok(!out.text.includes("new_secret_value"));
  assert.ok(out.text.includes("old_secret_value")); // old not redacted after refresh
});

// ── Pattern-based detection ────────────────────────────────────────────────

test("catches JWT token pattern", () => {
  const r = createRedactor([]);
  const jwt =
    "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ1c2VyLTEyMyJ9.c2lnLXVzZXItMTIz";
  const out = r.redact(`Authorization: Bearer ${jwt}`);
  assert.ok(!out.text.includes(jwt));
  assert.ok(out.text.includes('"$SECRET_JWT"'));
  assert.equal(out.hits, 1);
});

test("catches AWS access key pattern", () => {
  const r = createRedactor([]);
  const out = r.redact("key: AKIAIOSFODNN7EXAMPLE leaked");
  assert.ok(!out.text.includes("AKIAIOSFODNN7EXAMPLE"));
  assert.ok(out.text.includes('"$SECRET_AWS_ACCESS_KEY"'));
});

test("catches OpenAI key pattern", () => {
  const r = createRedactor([]);
  const out = r.redact("key: sk-proj-abcdefghijklmnopqrstuvwxyz123456 leaked");
  assert.ok(!out.text.includes("sk-proj"));
  assert.ok(out.text.includes('"$SECRET_OPENAI_KEY"'));
});

test("catches GitHub token pattern", () => {
  const r = createRedactor([]);
  const out = r.redact("ghp_abcdefghijklmnopqrstuvwxyz1234567890ab leaked");
  assert.ok(!out.text.includes("ghp_"));
  assert.ok(out.text.includes('"$SECRET_GITHUB_TOKEN"'));
});

test("catches private key block", () => {
  const r = createRedactor([]);
  const key = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7
-----END PRIVATE KEY-----`;
  const out = r.redact(`key material:\n${key}\nend`);
  assert.ok(!out.text.includes("PRIVATE KEY"), "private key should be redacted");
});

test("catches X.509 certificate block", () => {
  const r = createRedactor([]);
  const cert = `-----BEGIN CERTIFICATE-----
MIIDazCCAlOgAwIBAgIUBR...
-----END CERTIFICATE-----`;
  const out = r.redact(`cert:\n${cert}\nend`);
  assert.ok(!out.text.includes("CERTIFICATE"), "certificate should be redacted");
});

test("catches OPENSSH private key block", () => {
  const r = createRedactor([]);
  const key = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAA...
-----END OPENSSH PRIVATE KEY-----`;
  const out = r.redact(key);
  assert.ok(!out.text.includes("OPENSSH"), "openssh key should be redacted");
});

test("catches GitLab token pattern", () => {
  const r = createRedactor([]);
  const out = r.redact("glpat-abcdefghijklmnopqrstuvwxyz12 leaked");
  assert.ok(!out.text.includes("glpat-"));
  assert.ok(out.text.includes('"$SECRET_GITLAB_TOKEN"'));
});

test("catches npm token pattern", () => {
  const r = createRedactor([]);
  const out = r.redact("npm_abcdefghijklmnopqrstuvwxyz1234567890ab leaked");
  assert.ok(!out.text.includes("npm_"));
  assert.ok(out.text.includes('"$SECRET_NPM_TOKEN"'));
});

test("catches Google API key", () => {
  const r = createRedactor([]);
  // Google API keys: exactly AIza + 35 = 39 chars
  const key = "AIzaSyDqkB2n0EXAMPLEKEYabcdefghijkl1234";
  const out = r.redact(`${key} leaked`);
  assert.ok(!out.text.includes("AIza"));
  assert.ok(out.text.includes('"$SECRET_GOOGLE_API_KEY"'));
});

test("catches connection string with credentials", () => {
  const r = createRedactor([]);
  const out = r.redact("uri=postgres://admin:secretpass@db.example.com:5432/app");
  assert.ok(!out.text.includes("secretpass"), "password should be redacted");
  assert.ok(out.text.includes('"$SECRET_CONNECTION_STRING"'));
});

test("catches mongodb connection string", () => {
  const r = createRedactor([]);
  const out = r.redact("mongodb://root:hunter2@mongo.example.com:27017/admin");
  assert.ok(!out.text.includes("hunter2"));
  assert.ok(out.text.includes('"$SECRET_CONNECTION_STRING"'));
});

test("does not redact connection string without credentials", () => {
  const r = createRedactor([]);
  const out = r.redact("postgres://localhost:5432/app");
  assert.ok(out.text.includes("postgres://"));
  assert.equal(out.hits, 0);
});

// ── Auto-capture and export ────────────────────────────────────────────────

test("captured secrets returned in result", () => {
  const r = createRedactor([]);
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
  const out = r.redact(`token: ${jwt}`);
  assert.equal(out.captured.length, 1);
  assert.equal(out.captured[0]!.name, "SECRET_JWT");
  assert.equal(out.captured[0]!.value, jwt);
});

test("same pattern value captured only once", () => {
  const r = createRedactor([]);
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
  r.redact(`first: ${jwt}`);
  const out = r.redact(`second: ${jwt}`);
  assert.equal(out.captured.length, 0); // already captured
  assert.equal(out.hits, 1); // still hits
});

test("distinct JWT values get distinct placeholder names", () => {
  const r = createRedactor([]);
  const jwt1 =
    "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ1c2VyLTEyMyJ9.c2lnLXVzZXItMTIz";
  const jwt2 =
    "eyJhbGciOiJub25lIiwidHlwIjoiSldUIl0.eyJzdWIiOiJ1c2VyLTQ1NiJ9.c2lnLXVzZXItNDU2";
  const out = r.redact(`${jwt1} and ${jwt2}`);
  assert.ok(out.text.includes('"$SECRET_JWT"'));
  assert.ok(out.text.includes('"$SECRET_JWT_2"'));
  assert.equal(out.captured.length, 2);
});

// ── Custom patterns ────────────────────────────────────────────────────────

test("custom pattern catches and captures match", () => {
  const r = createRedactor([], [{ name: "ACME", regex: "acme-[0-9a-f]{12}" }]);
  const token = "acme-0123456789ab";
  const out = r.redact(`token is ${token} ok`);
  assert.ok(!out.text.includes(token));
  assert.ok(out.text.includes('"$SECRET_ACME"'));
  assert.equal(out.captured.length, 1);
  assert.equal(out.captured[0]!.value, token);
});

test("custom pattern with flags", () => {
  const r = createRedactor([], [{ name: "ACME", regex: "acme-[0-9a-f]{12}", flags: "i" }]);
  const out = r.redact("ACME-AAAAAAAAAAAA and acme-bbbbbbbbbbbb");
  assert.ok(out.text.includes('"$SECRET_ACME"'));
  assert.ok(out.text.includes('"$SECRET_ACME_2"'));
});

test("invalid custom regex is skipped silently", () => {
  const r = createRedactor([], [{ name: "BAD", regex: "([" }]);
  const out = r.redact("nothing to redact here");
  assert.equal(out.hits, 0);
});

// ── Edge cases ─────────────────────────────────────────────────────────────

test("regex special characters in secret values are escaped", () => {
  const r = createRedactor([{ name: "REGEX", value: "a.+*?^${}()|[]\\b" }]);
  const out = r.redact("literal a.+*?^${}()|[]\\b text");
  assert.ok(!out.text.includes("a.+*"));
  assert.ok(out.text.includes('"$REGEX"'));
});

test("placeholder does not match secret pattern", () => {
  const r = createRedactor([{ name: "KEY", value: "sk-abc123def4567890" }]);
  // Redact once, placeholder should not trigger another match
  const out = r.redact("key: sk-abc123def4567890");
  assert.equal(out.hits, 1); // not 2+
});

test("knownPlaceholders returns captured entries", () => {
  const r = createRedactor([]);
  assert.equal(r.knownPlaceholders().length, 0);
  const jwt =
    "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJ1c2VyLTEyMyJ9.c2lnLXVzZXItMTIz";
  r.redact(jwt);
  assert.equal(r.knownPlaceholders().length, 1);
});

test("value exactly 8 chars is redacted", () => {
  const r = createRedactor([{ name: "K8", value: "12345678" }]);
  const out = r.redact("value: 12345678 end");
  assert.ok(!out.text.includes("12345678"));
  assert.equal(out.hits, 1);
});

test("value exactly 7 chars is NOT redacted", () => {
  const r = createRedactor([{ name: "K7", value: "1234567" }]);
  const out = r.redact("value: 1234567 end");
  assert.ok(out.text.includes("1234567"));
  assert.equal(out.hits, 0);
});
