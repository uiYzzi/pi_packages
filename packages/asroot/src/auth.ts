/**
 * Shared core: make sure we have sudo rights, prompting the user via the
 * masked TUI input when sudo's timestamp cache is cold.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { promptSecret, notifyShroud } from "@uiyzzi/pi-secret-kit";
import { sudoCached, validatePassword } from "./sudo.js";
import { PASSWORD_NAME, type AsrootState } from "./state.js";

const MAX_CMD_PREVIEW = 80;

/**
 * Ensure sudo is usable. Returns normally when ready; throws on cancel,
 * wrong password, or non-TUI mode.
 */
export async function ensureSudo(
  ctx: ExtensionContext,
  st: AsrootState,
  command: string,
): Promise<void> {
  if (await sudoCached()) return;

  if (ctx.mode !== "tui" || !ctx.hasUI) {
    throw new Error("asroot needs an interactive TUI to ask for the sudo password.");
  }

  const preview =
    command.length > MAX_CMD_PREVIEW ? `${command.slice(0, MAX_CMD_PREVIEW)}…` : command;
  const user = process.env.USER ?? "current user";

  const password = await promptSecret(
    ctx,
    "Administrator access required",
    `Enter password for ${user} to run: ${preview}`,
  );
  if (password === null) {
    throw new Error("User cancelled the password prompt. Ask how to proceed.");
  }

  st.stats.prompted++;
  if (!(await validatePassword(password))) {
    throw new Error("sudo rejected the password. You may call asroot again to retry.");
  }

  // Keep for leak scrubbing; push to shroud as redact-only (never exported).
  st.password = password;
  notifyShroud(PASSWORD_NAME, password, { ephemeral: true });
}
