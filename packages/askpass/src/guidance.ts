/**
 * System prompt guidance injected before each agent turn. Keep it terse.
 */

import type { AskpassState } from "./state.js";

export function buildGuidance(st: AskpassState): string {
  const lines = [
    "## askpass (secret input)",
    "Need a password/API key/token? Call the `askpass` tool — never ask the user to paste it in chat.",
    "The value is never returned to you; use it in bash as `$NAME`. Never read, echo, or print it.",
  ];
  if (st.secrets.length > 0) {
    lines.push(`Captured: ${st.secrets.map((s) => `$${s.name}`).join(", ")}.`);
  }
  return lines.join("\n");
}
