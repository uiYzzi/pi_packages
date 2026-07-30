/**
 * askpass — masked TUI secret prompt for pi.
 *
 * The agent requests a secret, the user types it into a masked input in
 * pi's TUI, and the value goes straight into the shell environment —
 * never into the model's context.
 *
 * Defense in depth:
 *  - tool result contains only a confirmation (never the value)
 *  - system prompt guidance forbids the agent from asking for/reading secrets
 *  - read/edit/write/bash access to files written by askpass is blocked
 *  - exact-match scrubbing redacts the value if it ever leaks into
 *    user input or tool output (e.g. `echo $NAME`)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createState } from "./state.js";
import { registerAskpassTool } from "./tool.js";
import { registerHooks } from "./hooks.js";
import { registerCommands } from "./commands.js";
import { registerBridge } from "./bridge.js";

export default function (pi: ExtensionAPI) {
  const state = createState();

  registerAskpassTool(pi, state);
  registerHooks(pi, state);
  registerCommands(pi, state);
  registerBridge(state);
}
