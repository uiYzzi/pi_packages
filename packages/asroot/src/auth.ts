/**
 * Password supply: reuse the in-memory cache while fresh (CACHE_MS,
 * mirroring sudo's timestamp_timeout), otherwise prompt the user via the
 * masked TUI input, showing the exact command about to run.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { promptSecret, notifyShroud } from "@uiyzzi/pi-secret-kit";
import { validatePassword } from "./sudo.js";
import {
  CACHE_MS,
  PASSWORD_NAME,
  freshPassword,
  type AsrootState,
} from "./state.js";

const MAX_CMD_PREVIEW = 100;

/**
 * Return a valid sudo password, prompting when the cache is cold/expired.
 * Throws on cancel, wrong password, or non-TUI mode.
 */
export async function ensurePassword(
  ctx: ExtensionContext,
  st: AsrootState,
  command: string,
): Promise<string> {
  const fresh = freshPassword(st);
  if (fresh !== null) return fresh;

  if (ctx.mode !== "tui" || !ctx.hasUI) {
    throw new Error("asroot needs an interactive TUI to ask for the sudo password.");
  }

  const preview =
    command.length > MAX_CMD_PREVIEW ? `${command.slice(0, MAX_CMD_PREVIEW)}…` : command;
  const user = process.env.USER ?? "current user";

  const password = await promptSecret(
    ctx,
    "Root access requested",
    `${user} · sudo ${preview}`,
  );
  if (password === null) {
    throw new Error("User cancelled the password prompt.");
  }

  st.stats.prompted++;
  if (!(await validatePassword(password))) {
    throw new Error("sudo rejected the password. The next sudo will prompt again.");
  }

  st.cached = { value: password, expiresAt: Date.now() + CACHE_MS };
  // Redact-only push while cached: shroud scrubs it everywhere, exports nothing.
  // When it acknowledges, it owns scrubbing for this password.
  st.shroudSynced = notifyShroud(PASSWORD_NAME, password, { ephemeral: true });
  return password;
}
