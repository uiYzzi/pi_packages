/**
 * TUI commands: /shroud, /shroud-toggle, /shroud-rescan
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ShroudState } from "./hooks.js";
import { rescan } from "./hooks.js";

export function registerCommands(pi: ExtensionAPI, st: ShroudState): void {
  pi.registerCommand("shroud", {
    description: "Show shroud status (protected secrets, redaction count)",
    handler: async (_args, ctx) => {
      rescan(ctx.cwd, st);
      const names = st.secrets.map((e) => e.name).join(", ") || "(none)";
      const captured = st.redactor.knownPlaceholders().join(", ") || "(none)";
      ctx.ui.notify(
        `shroud [${st.enabled ? "on" : "off"}] | protecting ${st.secrets.length} secret(s) | ` +
          `redacted ${st.stats.redactedHits} value(s) so far\n` +
          `Referenceable as shell env: ${names}\n` +
          `Captured from context (auto-exported): ${captured}`,
        "info",
      );
    },
  });

  pi.registerCommand("shroud-toggle", {
    description: "Enable or disable shroud redaction",
    handler: async (_args, ctx) => {
      st.enabled = !st.enabled;
      ctx.ui.notify(`shroud ${st.enabled ? "enabled" : "disabled"}`, "info");
    },
  });

  pi.registerCommand("shroud-rescan", {
    description: "Re-scan environment and .env files for secrets",
    handler: async (_args, ctx) => {
      rescan(ctx.cwd, st);
      ctx.ui.notify(`shroud re-scanned: ${st.secrets.length} secret(s) protected`, "info");
    },
  });
}
