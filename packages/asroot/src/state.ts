/**
 * Session state for asroot.
 *
 * The sudo password is cached in memory for CACHE_MS (mirroring sudo's
 * familiar 5-minute timestamp), then dropped. While cached it is also
 * used for exact-match leak scrubbing. Never on disk, never in env,
 * never in session files.
 */

import { scrubValues } from "@uiyzzi/pi-secret-kit";

export const PASSWORD_NAME = "SUDO_PASSWORD";

/** Mirrors sudo's default timestamp_timeout. */
export const CACHE_MS = 5 * 60 * 1000;

export interface CachedPassword {
  value: string;
  expiresAt: number;
}

export interface AsrootState {
  cached: CachedPassword | null;
  stats: { prompted: number; runs: number; scrubbed: number; blocked: number };
}

export function createState(): AsrootState {
  return {
    cached: null,
    stats: { prompted: 0, runs: 0, scrubbed: 0, blocked: 0 },
  };
}

/** Fresh cached password, or null when missing/expired. */
export function freshPassword(st: AsrootState): string | null {
  if (st.cached && Date.now() < st.cached.expiresAt) return st.cached.value;
  st.cached = null;
  return null;
}

/** Exact-match scrub of the sudo password from a text channel. */
export function scrubText(text: string, st: AsrootState): string | undefined {
  if (!st.cached) return undefined;
  const r = scrubValues(text, [{ name: PASSWORD_NAME, value: st.cached.value }]);
  if (!r) return undefined;
  st.stats.scrubbed += r.hits;
  return r.text;
}

/** True if a bash command invokes sudo (word followed by an argument). */
export function referencesSudo(command: string): boolean {
  return /(?:^|[\s|;&(])sudo\s+\S/.test(command);
}
