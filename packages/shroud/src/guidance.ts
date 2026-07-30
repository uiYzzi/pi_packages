/**
 * System prompt guidance injected before each agent turn. Keep it terse.
 */

import type { SecretDef } from "./engine.js";

export function buildGuidance(secrets: SecretDef[]): string {
  const lines = [
    "## Secret firewall",
    "Secret values are redacted from your context and replaced by placeholders like",
    '«SECRET NAME redacted — ... read it in bash as "$NAME"».',
    "The real values are live in your shell env under those names — fully usable.",
    'Use them in bash, e.g. curl -H "Authorization: Bearer $OPENAI_API_KEY" ...',
    "Never echo, cat, print, or write a secret value anywhere.",
  ];

  if (secrets.length > 0) {
    lines.push(`Available: ${secrets.map((e) => `$${e.name}`).join(", ")}.`);
  }

  return lines.join("\n");
}
