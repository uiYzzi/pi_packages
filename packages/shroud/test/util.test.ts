/**
 * Unit tests for utility functions (util.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeRegex, sanitizeName, unquote } from "../dist/util.js";

// ── escapeRegex ────────────────────────────────────────────────────────────

test("escapeRegex escapes all special characters", () => {
  const input = "a.+*?^${}()|[]\\b";
  const escaped = escapeRegex(input);
  // The escaped string should match the literal input as a regex
  const re = new RegExp(escaped);
  assert.ok(re.test(input));
  assert.ok(!re.test("aX")); // should not match anything else
});

test("escapeRegex handles plain strings", () => {
  assert.equal(escapeRegex("hello"), "hello");
  assert.equal(escapeRegex("sk-abc123"), "sk-abc123");
});

test("escapeRegex handles empty string", () => {
  assert.equal(escapeRegex(""), "");
});

// ── sanitizeName ───────────────────────────────────────────────────────────

test("sanitizeName keeps alphanumeric and underscore", () => {
  assert.equal(sanitizeName("AWS_ACCESS_KEY"), "AWS_ACCESS_KEY");
  assert.equal(sanitizeName("OPENAI_KEY"), "OPENAI_KEY");
});

test("sanitizeName replaces dashes and special chars", () => {
  assert.equal(sanitizeName("my-api-key"), "my_api_key");
  assert.equal(sanitizeName("test.name@domain"), "test_name_domain");
});

test("sanitizeName trims leading/trailing underscores", () => {
  assert.equal(sanitizeName("-bad-name-"), "bad_name");
  assert.equal(sanitizeName("__underscored__"), "underscored");
});

test("sanitizeName returns CUSTOM for empty result", () => {
  assert.equal(sanitizeName(""), "CUSTOM");
  assert.equal(sanitizeName("---"), "CUSTOM");
  assert.equal(sanitizeName("!@#$%"), "CUSTOM");
});

test("sanitizeName handles null/undefined gracefully", () => {
  assert.equal(sanitizeName(null as unknown as string), "CUSTOM");
  assert.equal(sanitizeName(undefined as unknown as string), "CUSTOM");
});

// ── unquote ────────────────────────────────────────────────────────────────

test("unquote removes double quotes", () => {
  assert.equal(unquote('"hello world"'), "hello world");
});

test("unquote removes single quotes", () => {
  assert.equal(unquote("'hello world'"), "hello world");
});

test("unquote strips inline comment after value", () => {
  assert.equal(unquote("myvalue12345 # this is a comment"), "myvalue12345");
});

test("unquote strips inline comment with hash in quoted string", () => {
  // Hash inside quotes should not be treated as comment
  assert.equal(unquote('"value#with#hash"'), "value#with#hash");
});

test("unquote handles unquoted values", () => {
  assert.equal(unquote("plain_value"), "plain_value");
});

test("unquote handles empty string", () => {
  assert.equal(unquote(""), "");
});

test("unquote handles whitespace only", () => {
  assert.equal(unquote("   "), "");
});
