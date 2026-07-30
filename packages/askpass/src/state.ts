/**
 * Session state for askpass.
 *
 * Values live ONLY in this in-memory state and in process.env.
 * They are never written to the session, never returned in tool results,
 * and are scrubbed from any text channel that leaks them.
 */

import { scrubValues } from "@uiyzzi/pi-secret-kit";

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
  stats: { captured: number; scrubbed: number; blocked: number };
}

export function createState(): AskpassState {
  return {
    secrets: [],
    protectedFiles: new Set(),
    stats: { captured: 0, scrubbed: 0, blocked: 0 },
  };
}

/**
 * Exact-match scrub of captured values from a text channel.
 * Cheap: few secrets per session, short-circuits when nothing matches.
 */
export function scrubText(text: string, st: AskpassState): string | undefined {
  const r = scrubValues(text, st.secrets);
  if (!r) return undefined;
  st.stats.scrubbed += r.hits;
  return r.text;
}
