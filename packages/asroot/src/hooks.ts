/**
 * Extension hooks: prompt injection, sudo steering, leak scrubbing.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { referencesSudo, scrubText, type AsrootState } from "./state.js";

export function buildGuidance(): string {
  return [
    "## asroot (sudo)",
    "Need root? Call the `asroot` tool — the user is prompted for their password in a masked TUI input.",
    "Never run sudo in bash, never ask for the password, never read or echo it.",
  ].join("\n");
}

export function registerHooks(pi: ExtensionAPI, st: AsrootState): void {
  pi.on("before_agent_start", async (event) => {
    return { systemPrompt: `${event.systemPrompt}\n\n${buildGuidance()}` };
  });

  // Steer agent away from raw sudo: it can't work non-interactively anyway.
  pi.on("tool_call", async (event) => {
    if (isToolCallEventType("bash", event) && referencesSudo(event.input.command)) {
      st.stats.blocked++;
      return {
        block: true,
        reason: "asroot: sudo is blocked in bash. Use the asroot tool instead.",
      };
    }
  });

  // Scrub the password if it ever leaks into user input or tool output.
  pi.on("input", async (event) => {
    const scrubbed = scrubText(event.text, st);
    if (scrubbed === undefined) return { action: "continue" as const };
    return { action: "transform" as const, text: scrubbed, images: event.images };
  });

  pi.on("tool_result", async (event) => {
    if (!st.password) return;
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
