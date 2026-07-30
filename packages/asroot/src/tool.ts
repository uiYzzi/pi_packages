/**
 * The `asroot` tool: run a shell command as root. The sudo password comes
 * from a masked TUI prompt and never enters the model's context.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { runSudo } from "./sudo.js";
import { ensureSudo } from "./auth.js";
import { scrubText, type AsrootState } from "./state.js";

const parameters = Type.Object({
  command: Type.String({ description: "Shell command to run as root." }),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in seconds (default 60, max 600)." }),
  ),
});

export type AsrootInput = Static<typeof parameters>;

export function registerAsrootTool(pi: ExtensionAPI, st: AsrootState): void {
  pi.registerTool({
    name: "asroot",
    label: "Asroot",
    description:
      "Run a shell command as root via sudo. The user is prompted for their password " +
      "in a masked TUI input; the password NEVER reaches you. Output is scrubbed.",
    promptSnippet: "Run a command as root; sudo password via masked TUI prompt, hidden from the model",
    promptGuidelines: [
      "Use the asroot tool for anything needing root — never run sudo in bash and never ask for the user's password.",
    ],
    parameters,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const p = params as AsrootInput;
      if (!p.command.trim()) throw new Error("Empty command.");

      await ensureSudo(ctx, st, p.command);
      if (signal?.aborted) {
        return { content: [{ type: "text", text: "Cancelled" }], details: {} };
      }

      const timeoutMs = Math.min(Math.max(p.timeout ?? 60, 1), 600) * 1000;
      const r = await runSudo(p.command, timeoutMs);
      st.stats.runs++;

      const scrub = (s: string) => scrubText(s, st) ?? s;
      const out = scrub(r.stdout).trimEnd();
      const err = scrub(r.stderr).trimEnd();

      const text =
        `exit code ${r.code}` +
        (out ? `\nstdout:\n${out}` : "") +
        (err ? `\nstderr:\n${err}` : "");

      if (r.code !== 0) {
        throw new Error(text);
      }
      return {
        content: [{ type: "text", text }],
        details: { command: p.command, code: r.code },
      };
    },
  });
}
