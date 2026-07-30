/**
 * Inter-extension bridge (optional, fully decoupled).
 *
 * Well-known globals:
 *   Symbol.for("pi-askpass") → { listSecrets() }          (exposed here)
 *   Symbol.for("pi-shroud")  → { addSecret(name, value) } (exposed by shroud)
 *
 * Duck-typed via globalThis: both packages work standalone, load order
 * does not matter. When shroud is present, every freshly captured secret
 * is pushed into its redactor immediately — no rescan gap.
 */

import type { AskpassState } from "./state.js";

export const ASKPASS_SYMBOL = Symbol.for("pi-askpass");
export const SHROUD_SYMBOL = Symbol.for("pi-shroud");

interface ShroudBridge {
  addSecret(name: string, value: string): void;
}

/** Expose captured secrets so shroud can pull them on rescan. */
export function registerBridge(st: AskpassState): void {
  (globalThis as Record<symbol, unknown>)[ASKPASS_SYMBOL] = {
    listSecrets(): { name: string; value: string; description: string }[] {
      return st.secrets.map(({ name, value, description }) => ({ name, value, description }));
    },
  };
}

/**
 * Push a freshly captured secret into shroud's redactor (if installed).
 * Returns true when shroud accepted it.
 */
export function notifyShroud(name: string, value: string): boolean {
  try {
    const bridge = (globalThis as Record<symbol, unknown>)[SHROUD_SYMBOL] as
      | ShroudBridge
      | undefined;
    if (typeof bridge?.addSecret !== "function") return false;
    bridge.addSecret(name, value);
    return true;
  } catch {
    return false;
  }
}
