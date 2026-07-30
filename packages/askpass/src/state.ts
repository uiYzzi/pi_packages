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
  /**
   * True when shroud acknowledged this value via the bridge — its engine
   * covers all channels, so local scrubbing skips it.
   */
  shroudSynced?: boolean;
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
 * Values already synced to shroud are skipped — shroud's engine redacts
 * them across more channels anyway.
 */
export function scrubText(text: string, st: AskpassState): string | undefined {
  const local = st.secrets.filter((s) => !s.shroudSynced);
  if (local.length === 0) return undefined;
  const r = scrubValues(text, local);
  if (!r) return undefined;
  st.stats.scrubbed += r.hits;
  return r.text;
}
