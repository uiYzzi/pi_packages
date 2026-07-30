/**
 * Exact-match scrubbing of secret values from text channels.
 */

export interface ScrubEntry {
  name: string;
  value: string;
}

/** Placeholder shown in place of a scrubbed value. */
export function placeholderFor(name: string): string {
  return `«SECRET ${name} redacted — use it in bash as "$${name}"»`;
}

export interface ScrubResult {
  text: string;
  hits: number;
}

/**
 * Replace exact occurrences of entry values with placeholders.
 * Values shorter than 4 chars are skipped (common-substring false positives).
 * Returns undefined when nothing matched (cheap path).
 */
export function scrubValues(text: string, entries: ScrubEntry[]): ScrubResult | undefined {
  let out = text;
  let hits = 0;
  for (const s of entries) {
    if (s.value.length < 4) continue;
    if (out.includes(s.value)) {
      out = out.split(s.value).join(placeholderFor(s.name));
      hits++;
    }
  }
  return hits > 0 ? { text: out, hits } : undefined;
}
