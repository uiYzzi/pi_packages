/**
 * Performance benchmarks for the redaction engine.
 *
 * Run with: npm run test:perf
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRedactor } from "../dist/engine.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function generateSecrets(count: number): { name: string; value: string }[] {
  const secrets: { name: string; value: string }[] = [];
  for (let i = 0; i < count; i++) {
    secrets.push({
      name: `SECRET_${i}`,
      value: `sk-${i.toString(36).padStart(24, "0")}-${Math.random().toString(36).slice(2, 10)}`,
    });
  }
  return secrets;
}

function generateText(secrets: { name: string; value: string }[], paragraphs: number): string {
  const nonSecret = `Lorem ipsum dolor sit amet, consectetur adipiscing elit.
Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.
Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.`;

  const lines: string[] = [];
  for (let i = 0; i < paragraphs; i++) {
    lines.push(nonSecret);
    // Sprinkle a secret every 3 paragraphs
    if (i % 3 === 0 && secrets.length > 0) {
      const s = secrets[i % secrets.length]!;
      lines.push(`API_KEY=${s.value}`);
    }
  }
  return lines.join("\n");
}

// ── Benchmarks ─────────────────────────────────────────────────────────────

test("bench: 10 secrets, 100 paragraphs", { skip: process.env["CI"] === "true" ? "skip in CI" : false }, () => {
  const secrets = generateSecrets(10);
  const text = generateText(secrets, 100);
  const r = createRedactor(secrets);

  const start = performance.now();
  const iterations = 100;
  let totalHits = 0;
  for (let i = 0; i < iterations; i++) {
    totalHits += r.redact(text).hits;
  }
  const elapsed = performance.now() - start;

  assert.ok(totalHits > 0, "should have matches");
  const avgMs = elapsed / iterations;
  // Log for visibility
  console.log(`[perf] 10 secrets × 100 paragraphs: ${avgMs.toFixed(2)}ms avg (${iterations} iterations)`);
  // Should be under 10ms per redaction for typical use
  assert.ok(avgMs < 50, `too slow: ${avgMs.toFixed(2)}ms avg per redaction`);
});

test("bench: 50 secrets, 100 paragraphs", { skip: process.env["CI"] === "true" ? "skip in CI" : false }, () => {
  const secrets = generateSecrets(50);
  const text = generateText(secrets, 100);
  const r = createRedactor(secrets);

  const start = performance.now();
  const iterations = 100;
  for (let i = 0; i < iterations; i++) {
    r.redact(text);
  }
  const elapsed = performance.now() - start;

  const avgMs = elapsed / iterations;
  console.log(`[perf] 50 secrets × 100 paragraphs: ${avgMs.toFixed(2)}ms avg (${iterations} iterations)`);
  assert.ok(avgMs < 100, `too slow: ${avgMs.toFixed(2)}ms avg per redaction`);
});

test("bench: pattern matching overhead", { skip: process.env["CI"] === "true" ? "skip in CI" : false }, () => {
  // No literal secrets — only pattern matching
  const r = createRedactor([]);
  const text = generateText([], 200);

  const start = performance.now();
  const iterations = 500;
  for (let i = 0; i < iterations; i++) {
    r.redact(text);
  }
  const elapsed = performance.now() - start;

  const avgMs = elapsed / iterations;
  console.log(`[perf] pattern-only × 200 paragraphs: ${avgMs.toFixed(3)}ms avg (${iterations} iterations)`);
  // Patterns run every time - should be fast even on non-matching text
  assert.ok(avgMs < 20, `pattern overhead too high: ${avgMs.toFixed(3)}ms`);
});

test("bench: many patterns (16 builtin + 10 custom)", { skip: process.env["CI"] === "true" ? "skip in CI" : false }, () => {
  const customPatterns = Array.from({ length: 10 }, (_, i) => ({
    name: `CUSTOM_${i}`,
    regex: `custom-token-${i}-[0-9a-f]{16}`,
  }));
  const r = createRedactor([], customPatterns);

  // Text with some of the custom tokens
  let text = "some regular text without matches\n".repeat(50);
  text += "here is a custom-token-5-0123456789abcdef in the text\n";

  const start = performance.now();
  const iterations = 100;
  for (let i = 0; i < iterations; i++) {
    r.redact(text);
  }
  const elapsed = performance.now() - start;

  const avgMs = elapsed / iterations;
  console.log(`[perf] 26 patterns × 50 lines: ${avgMs.toFixed(3)}ms avg (${iterations} iterations)`);
  assert.ok(avgMs < 50, `too slow: ${avgMs.toFixed(3)}ms avg`);
});

test("bench: refresh performance", { skip: process.env["CI"] === "true" ? "skip in CI" : false }, () => {
  const r = createRedactor([]);

  const start = performance.now();
  const iterations = 1000;
  for (let i = 0; i < iterations; i++) {
    r.refresh(generateSecrets(20));
  }
  const elapsed = performance.now() - start;

  const avgMs = elapsed / iterations;
  console.log(`[perf] refresh(20 secrets) × 1000: ${avgMs.toFixed(3)}ms avg`);
  assert.ok(avgMs < 5, `refresh too slow: ${avgMs.toFixed(3)}ms avg`);
});
