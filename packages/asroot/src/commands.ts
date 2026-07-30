/**
 * /asroot command: run a command as root manually.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runSudo } from "./sudo.js";
import { ensureSudo } from "./auth.js";
import { scrubText, type AsrootState } from "./state.js";

const MAX_NOTIFY = 600;

export function registerCommands(pi: ExtensionAPI, st: AsrootState): void {
  pi.registerCommand("asroot", {
    description: "Run a command as root: /asroot <command...>",
    handler: async (args, ctx) => {
      const command = args.trim();
      if (!command) {
        ctx.ui.notify("Usage: /asroot <command...>", "error");
        return;
      }
      try {
        await ensureSudo(ctx, st, command);
      } catch (err) {
        ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
        return;
      }

      const r = await runSudo(command, 60_000);
      st.stats.runs++;
      const scrub = (s: string) => scrubText(s, st) ?? s;
      const body = (scrub(r.stdout) + scrub(r.stderr)).trim();
      const preview =
        body.length > MAX_NOTIFY ? `${body.slice(0, MAX_NOTIFY)}\n…(truncated)` : body;

      ctx.ui.notify(
        `exit ${r.code}${preview ? `\n${preview}` : ""}`,
        r.code === 0 ? "info" : "error",
      );
    },
  });
}
