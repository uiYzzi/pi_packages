/**
 * Inter-extension bridge (optional, fully decoupled).
 *
 * Well-known globals:
 *   Symbol.for("pi-shroud")  → { addSecret(name, value) }   (exposed by shroud)
 *   Symbol.for("pi-askpass") → { listSecrets() }            (exposed by askpass)
 *
 * Duck-typed via globalThis: either package works standalone, and load
 * order does not matter —
 *   askpass captures a secret → calls shroud.addSecret() right away
 *   shroud rescans            → pulls askpass.listSecrets() to catch
 *                               anything captured before shroud loaded
 */

import type { SecretDef } from "./engine.js";
import type { ShroudState } from "./hooks.js";
import { addRuntimeSecret } from "./hooks.js";

export const SHROUD_SYMBOL = Symbol.for("pi-shroud");
export const ASKPASS_SYMBOL = Symbol.for("pi-askpass");

interface AskpassBridge {
  listSecrets(): SecretDef[];
}

/** Secrets currently held by askpass (empty when askpass absent). */
export function getAskpassSecrets(): SecretDef[] {
  try {
    const bridge = (globalThis as Record<symbol, unknown>)[ASKPASS_SYMBOL] as
      | AskpassBridge
      | undefined;
    const list = bridge?.listSecrets?.();
    if (!Array.isArray(list)) return [];
    return list.filter(
      (s): s is SecretDef =>
        !!s && typeof s.name === "string" && typeof s.value === "string" && s.value.length > 0,
    );
  } catch {
    return [];
  }
}

/** Expose shroud's redactor to other extensions (askpass pushes new captures here). */
export function registerBridge(st: ShroudState): void {
  (globalThis as Record<symbol, unknown>)[SHROUD_SYMBOL] = {
    addSecret(name: unknown, value: unknown, opts?: { ephemeral?: boolean }): void {
      if (typeof name !== "string" || typeof value !== "string") return;
      if (name.length === 0 || value.length === 0) return;
      addRuntimeSecret(st, name, value, opts);
    },
  };
}
