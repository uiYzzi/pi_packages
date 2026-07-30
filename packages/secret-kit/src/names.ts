/**
 * Env-var name helpers shared by secret-handling extensions.
 */

const NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

export function isValidName(name: string): boolean {
  return NAME_RE.test(name);
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
