/**
 * asroot — transparent sudo for pi with a masked TUI password prompt.
 *
 * The agent runs plain `sudo ...` in the bash tool. The tool_call hook:
 *   1. prompts the user for the password (masked input, shows the command)
 *   2. creates a one-shot fifo and starts a blocked writer for it
 *   3. rewrites the command to prefer the asroot shim via PATH
 * The shim's `sudo -S` reads the password from the fifo.
 *
 * Password discipline: cached in extension memory for 5 minutes (mirroring
 * sudo's timestamp_timeout), validated on capture, fed through kernel pipes
 * or stdin. Never on disk, in env, in argv, in command text, in session
 * files, or in the model's context. Wiped on session shutdown.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createState } from "./state.js";
import { registerHooks } from "./hooks.js";

export default function (pi: ExtensionAPI) {
  const state = createState();
  registerHooks(pi, state);

  pi.on("session_shutdown", async () => {
    state.cached = null;
    state.shroudSynced = false;
  });
}
