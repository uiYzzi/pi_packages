/**
 * Session state for askpass.
 *
 * Values live ONLY in this in-memory state and in process.env.
 * They are never written to the session, never returned in tool results,
 * and are scrubbed from any text channel that leaks them.
 */

export interface CapturedSecret {
  /** Env var name, e.g. OPENAI_API_KEY */
  name: string;
  /** The raw value. NEVER expose to the model. */
  value: string;
  /** Short human description shown in the prompt dialog. */
  description: string;
}

export interface AskpassState {
  /** Secrets captured this session, in capture order. */
  secrets: CapturedSecret[];
  /** Absolute file paths written via writeFile — read/edit blocked for the agent. */
  protectedFiles: Set<string>;
  /** Env values saved before we overwrote them (for reference/debug). */
  stats: { captured: number; scrubbed: number; blocked: number };
}

export function createState(): AskpassState {
  return {
    secrets: [],
    protectedFiles: new Set(),
    stats: { captured: 0, scrubbed: 0, blocked: 0 },
  };
}

/** Derive a valid env var name from a free-form description. */
export function deriveName(description: string): string {
  const base = description
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  const name = /^[A-Z]/.test(base) ? base : `SECRET_${base || "VALUE"}`;
  return name || "SECRET_VALUE";
}

const NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

export function isValidName(name: string): boolean {
  return NAME_RE.test(name);
}

/** Placeholder shown in place of a scrubbed value. */
export function placeholderFor(name: string): string {
  return `«SECRET ${name} redacted — use it in bash as "$${name}"»`;
}

/**
 * Exact-match scrub of captured values from a text channel.
 * Cheap: few secrets per session, short-circuits when nothing matches.
 */
export function scrubText(text: string, st: AskpassState): string | undefined {
  let out = text;
  let changed = false;
  for (const s of st.secrets) {
    // Skip trivially short values to avoid nuking common substrings
    if (s.value.length < 4) continue;
    if (out.includes(s.value)) {
      out = out.split(s.value).join(placeholderFor(s.name));
      changed = true;
      st.stats.scrubbed++;
    }
  }
  return changed ? out : undefined;
}
