/**
 * System prompt guidance injected before each agent turn.
 */

import type { SecretDef } from "./engine.js";

export function buildGuidance(secrets: SecretDef[]): string {
  const shellVars = secrets.map((e) => `$${e.name}`);
  const lines = [
    "## Secret firewall (IMPORTANT)",
    "",
    "Secret values in this session are redacted before you see them and replaced by a",
    'placeholder that looks like: «SECRET NAME redacted — ... read it in bash as "$NAME"».',
    "",
    "What this means:",
    "- The placeholder is NOT the secret value and NOT an empty/missing variable.",
    "- The REAL value IS present and live in your shell environment under its original",
    "  variable name. The env var is fully usable.",
    "- To USE a secret, reference it by name inside a `bash` command.",
    "",
    "Examples (these WORK — the value is injected by the shell, never shown to you):",
    '  bash: curl -H "Authorization: Bearer $OPENAI_API_KEY" https://api.example.com',
    '  bash: psql "$DATABASE_URL" -c \'select 1\'',
    "",
    "Rules:",
    "- Never echo, cat, print, or write a secret value to a file or to your output.",
    "- To check a secret exists without printing it:",
    '  bash: [ -n "$OPENAI_API_KEY" ] && echo present || echo missing',
  ];

  if (shellVars.length > 0) {
    lines.push("", `Currently available secret env vars: ${shellVars.join(", ")}.`);
  }

  return lines.join("\n");
}
