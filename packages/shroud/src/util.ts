/**
 * Shared utilities — zero dependencies.
 */

/** Escape a string for safe use inside a RegExp alternation. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Sanitize a name to [A-Za-z0-9_]. Returns "CUSTOM" for empty results. */
export function sanitizeName(raw: string): string {
  const cleaned = String(raw ?? "")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "CUSTOM";
}

/** Strip surrounding quotes and inline comments from a .env value. */
export function unquote(raw: string): string {
  const v = raw.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  const hash = v.indexOf(" #");
  return hash >= 0 ? v.slice(0, hash).trim() : v;
}
