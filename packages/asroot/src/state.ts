/**
 * Session state for asroot.
 *
 * The sudo password lives ONLY here (for leak scrubbing) and in sudo's
 * own timestamp cache. It is never exported to the env, never written
 * to disk, never returned in tool results.
 */

import { scrubValues } from "@uiyzzi/pi-secret-kit";

export const PASSWORD_NAME = "SUDO_PASSWORD";

export interface AsrootState {
  /** The current user's sudo password, kept for exact-match scrubbing. */
  password: string | null;
  stats: { prompted: number; runs: number; scrubbed: number; blocked: number };
}

export function createState(): AsrootState {
  return {
    password: null,
    stats: { prompted: 0, runs: 0, scrubbed: 0, blocked: 0 },
  };
}

/** Exact-match scrub of the sudo password from a text channel. */
export function scrubText(text: string, st: AsrootState): string | undefined {
  if (!st.password) return undefined;
  const r = scrubValues(text, [{ name: PASSWORD_NAME, value: st.password }]);
  if (!r) return undefined;
  st.stats.scrubbed += r.hits;
  return r.text;
}

/** True if a bash command invokes sudo (word followed by an argument). */
export function referencesSudo(command: string): boolean {
  return /(?:^|[\s|;&(])sudo\s+\S/.test(command);
}
