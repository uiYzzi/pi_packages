/**
 * askpass's side of the inter-extension bridge: exposes captured secrets
 * so shroud can pull them on rescan (covers anything captured before
 * shroud loaded). Pushing is done via notifyShroud from @uiyzzi/pi-secret-kit.
 */

import type { AskpassState } from "./state.js";

export const ASKPASS_SYMBOL = Symbol.for("pi-askpass");

/** Expose captured secrets so shroud can pull them on rescan. */
export function registerBridge(st: AskpassState): void {
  (globalThis as Record<symbol, unknown>)[ASKPASS_SYMBOL] = {
    listSecrets(): { name: string; value: string; description: string }[] {
      return st.secrets.map(({ name, value, description }) => ({ name, value, description }));
    },
  };
}
