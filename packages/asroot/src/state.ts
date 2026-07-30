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
  /** True when shroud acknowledged the password — it owns scrubbing then. */
  shroudSynced: boolean;
  stats: { prompted: number; runs: number; scrubbed: number; blocked: number };
}

export function createState(): AsrootState {
  return {
    cached: null,
    shroudSynced: false,
    stats: { prompted: 0, runs: 0, scrubbed: 0, blocked: 0 },
  };
}

/** Fresh cached password, or null when missing/expired. */
export function freshPassword(st: AsrootState): string | null {
  if (st.cached && Date.now() < st.cached.expiresAt) return st.cached.value;
  st.cached = null;
  st.shroudSynced = false;
  return null;
}

/** Exact-match scrub of the sudo password from a text channel. */
export function scrubText(text: string, st: AsrootState): string | undefined {
  if (!st.cached || st.shroudSynced) return undefined;
  const r = scrubValues(text, [{ name: PASSWORD_NAME, value: st.cached.value }]);
  if (!r) return undefined;
  st.stats.scrubbed += r.hits;
  return r.text;
}

/**
 * Mask quoted text and comments with spaces (positions preserved), so a
 * downstream regex only sees words the shell would actually execute.
 *
 * Rules, mirroring bash lexing:
 *   '...'      — literal, fully masked
 *   "..."      — masked, EXCEPT embedded `...` and $(...) which still
 *                execute, so those are scanned recursively
 *   \x         — escape, both chars masked (cannot open a quote)
 *   # ...      — comment (at a word boundary), masked to end of line
 *   $( ), ` `  — command substitution: content kept visible
 */
/**
 * Mask the inside of a double-quoted string (length preserved):
 * everything is hidden EXCEPT embedded `...` and $(...) substitutions,
 * which still execute and are scanned recursively.
 */
function maskDoubleQuotedInner(inner: string): string {
  let out = "";
  let i = 0;
  while (i < inner.length) {
    const c = inner[i];
    if (c === "\\") {
      out += "  ";
      i += 2;
      continue;
    }
    if (c === "`") {
      const end = inner.indexOf("`", i + 1);
      if (end === -1) {
        out += " ".repeat(inner.length - i);
        break;
      }
      out += " " + maskQuoted(inner.slice(i + 1, end)) + " ";
      i = end + 1;
      continue;
    }
    if (c === "$" && inner[i + 1] === "(") {
      let depth = 1;
      let j = i + 2;
      while (j < inner.length && depth > 0) {
        if (inner[j] === "(") depth++;
        else if (inner[j] === ")") depth--;
        j++;
      }
      out += "  " + maskQuoted(inner.slice(i + 2, j - 1)) + " ";
      i = j;
      continue;
    }
    out += " ";
    i++;
  }
  return out;
}

export function maskQuoted(command: string): string {
  const mask = (s: string, from: number, to: number): string =>
    s.slice(0, from) + " ".repeat(to - from) + s.slice(to);

  let out = command;
  let i = 0;
  while (i < out.length) {
    const c = out[i];
    if (c === "\\") {
      out = mask(out, i, Math.min(i + 2, out.length));
      i += 2;
      continue;
    }
    if (c === "'") {
      const start = i;
      i++;
      while (i < out.length && out[i] !== "'") i++;
      i = Math.min(i + 1, out.length); // include closing quote
      out = mask(out, start, i);
      continue;
    }
    if (c === '"') {
      const start = i;
      i++;
      let inner = "";
      const innerStart = i;
      while (i < out.length && out[i] !== '"') {
        if (out[i] === "\\") {
          inner += "  ";
          i += 2;
          continue;
        }
        inner += out[i];
        i++;
      }
      // Everything inside double quotes is hidden except substitutions.
      const maskedInner = maskDoubleQuotedInner(inner);
      out = out.slice(0, innerStart) + maskedInner + out.slice(i);
      out = mask(out, start, start + 1); // opening quote
      i = innerStart + maskedInner.length;
      out = mask(out, i, Math.min(i + 1, out.length)); // closing quote
      i++;
      continue;
    }
    if (c === "#" && (i === 0 || /[\s;|&()]/.test(out[i - 1] ?? ""))) {
      const start = i;
      while (i < out.length && out[i] !== "\n") i++;
      out = mask(out, start, i);
      continue;
    }
    i++;
  }
  return out;
}

/** True if a bash command invokes sudo (word followed by an argument). */
export function referencesSudo(command: string): boolean {
  return /(?:^|[\s|;&(`])(?:\S*\/)?sudo\s+\S/.test(maskQuoted(command));
}
