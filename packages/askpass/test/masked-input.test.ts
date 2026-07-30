/**
 * Unit tests for MaskedInput rendering (masked-input.ts).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { MaskedInput } from "../dist/masked-input.js";

test("render masks the value with bullets", () => {
  const input = new MaskedInput();
  input.focused = true;
  input.handleInput("s3cr3t-key");
  const line = input.render(60).join("\n");
  assert.ok(line.includes("••••••••••"));
  assert.ok(!line.includes("s3cr3t"));
  assert.equal(input.getValue(), "s3cr3t-key");
});

test("editing still works through the mask", () => {
  const input = new MaskedInput();
  input.handleInput("abc");
  input.handleInput("\x1b[D"); // cursor left
  input.handleInput("\x7f"); // backspace deletes 'b'
  assert.equal(input.getValue(), "ac");
  const line = input.render(40).join("\n");
  assert.ok(!line.includes("ac"));
});
