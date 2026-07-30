/**
 * shroud — High-performance secret firewall for pi.
 *
 * Secrets stay usable as shell env vars ($OPENAI_API_KEY, $DATABASE_URL)
 * but their VALUES are never visible to the model. Redaction happens on
 * three channels: user input, model context, and tool output.
 *
 * Pattern-matched tokens (JWTs, AWS keys, etc.) are auto-captured and
 * exported to shell as $SECRET_JWT, $SECRET_AWS_ACCESS_KEY, etc.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createRedactor } from "./engine.js";
import { createState, registerHooks } from "./hooks.js";
import { registerCommands } from "./commands.js";
import { registerBridge } from "./bridge.js";

export default function (pi: ExtensionAPI) {
  const redactor = createRedactor();
  const state = createState(redactor);

  registerHooks(pi, state);
  registerCommands(pi, state);
  registerBridge(state);
}
