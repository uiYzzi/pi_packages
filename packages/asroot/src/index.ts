/**
 * asroot — sudo for pi with a masked TUI password prompt.
 *
 * The sudo password comes from pi's own TUI (secret-kit's MaskedInput)
 * instead of any external askpass helper.
 *
 * Password discipline:
 *  - entered via masked prompt, kept only in extension memory (for scrubbing)
 *  - fed to `sudo -S -k -v` over stdin — never argv, never env, never disk
 *  - pushed to shroud as an ephemeral (redact-only) secret when installed
 *  - exact-match scrubbed from user input and tool output
 *  - raw `sudo` in the bash tool is blocked, steering the agent here
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createState } from "./state.js";
import { registerAsrootTool } from "./tool.js";
import { registerHooks } from "./hooks.js";
import { registerCommands } from "./commands.js";

export default function (pi: ExtensionAPI) {
  const state = createState();

  registerAsrootTool(pi, state);
  registerHooks(pi, state);
  registerCommands(pi, state);
}
