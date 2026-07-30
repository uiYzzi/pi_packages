/**
 * Extension hooks: transparent sudo for the agent.
 *
 * The agent runs plain `sudo ...` in the bash tool. The tool_call hook:
 *   1. gets a valid password (5-minute memory cache, else masked prompt)
 *   2. creates a one-shot fifo and starts a blocked writer for it
 *   3. rewrites the command to prefer the asroot shim via PATH
 * The shim's `sudo -S` reads the password from the fifo. The command text
 * only ever contains paths — never the password.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { referencesSudo, scrubText, type AsrootState } from "./state.js";
import { ensurePassword } from "./auth.js";
import { createFifo, ensureShim, feedFifo } from "./shim.js";

export function buildGuidance(): string {
  return [
    "## asroot (sudo)",
    "Run sudo in bash normally — the password is fed transparently outside your view",
    "(the user is prompted in a masked TUI input when needed).",
    "Never ask for the password, never read or echo it.",
  ].join("\n");
}

export function registerHooks(pi: ExtensionAPI, st: AsrootState): void {
  pi.on("before_agent_start", async (event) => {
    return { systemPrompt: `${event.systemPrompt}\n\n${buildGuidance()}` };
  });

  // Transparent sudo: rewrite bash commands that invoke sudo.
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("bash", event)) return;
    if (!referencesSudo(event.input.command)) return;

    let password: string;
    try {
      password = await ensurePassword(ctx, st, event.input.command);
    } catch (err) {
      st.stats.blocked++;
      return {
        block: true,
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    const bin = ensureShim();
    const fifo = createFifo();
    // Fire-and-forget: resolves when the shim reads (or the fifo is cleaned up).
    void feedFifo(fifo, password);

    event.input.command =
      `export PATH="${bin}:$PATH" ASROOT_FIFO="${fifo}"; ` + event.input.command;
    st.stats.runs++;
  });

  // Scrub the password if it leaks into user input or tool output while cached.
  pi.on("input", async (event) => {
    const scrubbed = scrubText(event.text, st);
    if (scrubbed === undefined) return { action: "continue" as const };
    return { action: "transform" as const, text: scrubbed, images: event.images };
  });

  pi.on("tool_result", async (event) => {
    if (!st.cached) return;
    let changed = false;
    const content = event.content.map((block) => {
      if (block.type !== "text") return block;
      const scrubbed = scrubText(block.text, st);
      if (scrubbed === undefined) return block;
      changed = true;
      return { ...block, text: scrubbed };
    });
    if (changed) return { content } as never;
  });
}
