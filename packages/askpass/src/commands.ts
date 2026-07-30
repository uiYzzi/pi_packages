/**
 * /askpass commands: manual capture and listing.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { promptSecret, isValidName } from "@uiyzzi/pi-secret-kit";
import { type AskpassState } from "./state.js";
import { notifyShroud } from "@uiyzzi/pi-secret-kit";

export function registerCommands(pi: ExtensionAPI, st: AskpassState): void {
  pi.registerCommand("askpass", {
    description: "Capture a secret into an env var: /askpass NAME [description...]",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const name = (parts.shift() ?? "").toUpperCase();
      if (!isValidName(name)) {
        ctx.ui.notify("Usage: /askpass NAME [description...] — NAME must match [A-Z_][A-Z0-9_]*", "error");
        return;
      }
      const description = parts.join(" ") || name;

      const value = await promptSecret(
        ctx,
        description,
        `Stored as $${name} — the value is never shown to the agent`,
      );
      if (value === null) {
        ctx.ui.notify("Cancelled", "warning");
        return;
      }

      process.env[name] = value;
      st.secrets = st.secrets.filter((s) => s.name !== name);
      st.secrets.push({ name, value, description });
      st.stats.captured++;
      const synced = notifyShroud(name, value);
      ctx.ui.notify(
        `Captured $${name} — usable in bash, hidden from the agent` +
          (synced ? " (shroud redactor synced)" : ""),
        "info",
      );
    },
  });

  pi.registerCommand("askpass-list", {
    description: "List secrets captured by askpass (names only, never values)",
    handler: async (_args, ctx) => {
      if (st.secrets.length === 0) {
        ctx.ui.notify("askpass: no secrets captured this session", "info");
        return;
      }
      const lines = st.secrets.map((s) => `$${s.name} — ${s.description}`).join("\n");
      ctx.ui.notify(
        `askpass: ${st.secrets.length} secret(s)\n${lines}\n` +
          `stats: ${st.stats.captured} captured, ${st.stats.scrubbed} leak(s) scrubbed, ${st.stats.blocked} read(s) blocked`,
        "info",
      );
    },
  });
}
