/**
 * Duck-typed bridge to pi-shroud (optional).
 *
 * shroud exposes Symbol.for("pi-shroud") → { addSecret(name, value, opts?) }.
 * When shroud is absent the call is a silent no-op.
 */

export const SHROUD_SYMBOL = Symbol.for("pi-shroud");

interface ShroudBridge {
  addSecret(name: string, value: string, opts?: { ephemeral?: boolean }): void;
}

export interface NotifyOptions {
  /**
   * Redact-only: shroud scrubs the value everywhere but does NOT export it
   * to the shell env and does NOT list it as a usable variable.
   * Use for values the agent must never wield, e.g. sudo passwords.
   */
  ephemeral?: boolean;
}

/**
 * Push a freshly captured secret into shroud's redactor (if installed).
 * Returns true when shroud accepted it.
 */
export function notifyShroud(name: string, value: string, opts?: NotifyOptions): boolean {
  try {
    const bridge = (globalThis as Record<symbol, unknown>)[SHROUD_SYMBOL] as
      | ShroudBridge
      | undefined;
    if (typeof bridge?.addSecret !== "function") return false;
    bridge.addSecret(name, value, opts);
    return true;
  } catch {
    return false;
  }
}
