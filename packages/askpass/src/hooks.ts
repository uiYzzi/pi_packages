/**
 * Extension hooks: prompt injection, read protection, leak scrubbing.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { relative, resolve } from "node:path";
import { buildGuidance } from "./guidance.js";
import { scrubText, type AskpassState } from "./state.js";

/** Resolve an agent-supplied path against cwd (strip leading @). */
function resolveAgentPath(cwd: string, p: string): string {
  return resolve(cwd, p.replace(/^@/, ""));
}

/** True if path targets a protected file. */
function isProtectedPath(abs: string, st: AskpassState): boolean {
  return st.protectedFiles.has(abs);
}

/** True if a bash command references a protected file (absolute or cwd-relative). */
function referencesProtectedFile(command: string, cwd: string, st: AskpassState): string | undefined {
  for (const abs of st.protectedFiles) {
    if (command.includes(abs)) return abs;
    const rel = relative(cwd, abs);
    if (rel && !rel.startsWith("..") && rel.length > 0 && command.includes(rel)) return abs;
  }
  return undefined;
}

export function registerHooks(pi: ExtensionAPI, st: AskpassState): void {
  // Inject usage guidance + capture list into the system prompt every turn.
  pi.on("before_agent_start", async (event) => {
    return { systemPrompt: `${event.systemPrompt}\n\n${buildGuidance(st)}` };
  });

  // Block agent file/shell access to files we wrote secrets to.
  pi.on("tool_call", async (event, ctx) => {
    if (st.protectedFiles.size === 0) return;

    if (isToolCallEventType("read", event) || isToolCallEventType("edit", event)) {
      const abs = resolveAgentPath(ctx.cwd, event.input.path);
      if (isProtectedPath(abs, st)) {
        st.stats.blocked++;
        return {
          block: true,
          reason: `askpass: "${abs}" contains a secret. Use the env var in bash instead.`,
        };
      }
    }

    if (isToolCallEventType("write", event)) {
      const abs = resolveAgentPath(ctx.cwd, event.input.path);
      if (isProtectedPath(abs, st)) {
        st.stats.blocked++;
        return { block: true, reason: `askpass: "${abs}" is protected (contains a secret).` };
      }
    }

    if (isToolCallEventType("bash", event)) {
      const hit = referencesProtectedFile(event.input.command, ctx.cwd, st);
      if (hit) {
        st.stats.blocked++;
        return {
          block: true,
          reason: `askpass: "${hit}" contains a secret. Use the env var ("$NAME") instead of reading the file.`,
        };
      }
    }
  });

  // Scrub captured values from user input (user pastes the same secret into chat).
  pi.on("input", async (event) => {
    if (st.secrets.length === 0) return { action: "continue" as const };
    const scrubbed = scrubText(event.text, st);
    if (scrubbed === undefined) return { action: "continue" as const };
    return { action: "transform" as const, text: scrubbed, images: event.images };
  });

  // Scrub captured values from tool results (e.g. `echo $NAME` in bash).
  pi.on("tool_result", async (event) => {
    if (st.secrets.length === 0) return;
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
