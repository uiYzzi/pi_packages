/**
 * PATH shim + one-shot fifo: lets the agent run plain `sudo` in bash while
 * the password travels only through a kernel pipe.
 *
 * Layout under ~/.pi/agent/asroot/:
 *   bin/sudo      shim script, execs real sudo -S reading from $ASROOT_FIFO
 *   fifo-<uuid>   one-shot named pipe (0600), unlinked right after use
 *
 * The rewritten command text contains only paths — never the password.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";

const BASE = join(homedir(), ".pi", "agent", "asroot");
const BIN = join(BASE, "bin");

/** Password lines written per fifo; covers commands with several sudo calls. */
const FEED_LINES = 16;

let resolvedSudo: string | null = null;

function sudoPath(): string {
  if (resolvedSudo) return resolvedSudo;
  try {
    resolvedSudo = execSync("command -v sudo", { encoding: "utf8" }).trim();
  } catch {
    resolvedSudo = "/usr/bin/sudo";
  }
  return resolvedSudo;
}

/** Create the shim directory + sudo shim script. Returns the bin dir. */
export function ensureShim(): string {
  mkdirSync(BIN, { recursive: true, mode: 0o700 });
  chmodSync(BIN, 0o700);
  const shim = join(BIN, "sudo");
  const content =
    "#!/bin/bash\n" +
    "# asroot shim: feed the sudo password from $ASROOT_FIFO when set.\n" +
    'if [ -n "$ASROOT_FIFO" ]; then\n' +
    `  exec ${sudoPath()} -S -p "" "$@" < "$ASROOT_FIFO"\n` +
    "fi\n" +
    `exec ${sudoPath()} "$@"\n`;
  if (!existsSync(shim)) {
    writeFileSync(shim, content, { mode: 0o700 });
  }
  return BIN;
}

/** Create a one-shot fifo, return its path. */
export function createFifo(): string {
  mkdirSync(BASE, { recursive: true, mode: 0o700 });
  chmodSync(BASE, 0o700);
  const p = join(BASE, `fifo-${randomUUID()}`);
  execSync(`mkfifo "${p}"`);
  chmodSync(p, 0o600);
  return p;
}

/**
 * Write the password into the fifo once a reader connects, then remove it.
 * Opening a fifo for writing blocks until a reader opens the other end;
 * this promise simply resolves whenever (or if) that happens.
 */
export async function feedFifo(fifo: string, password: string): Promise<void> {
  try {
    const fh = await open(fifo, "w");
    await fh.write(`${password}\n`.repeat(FEED_LINES));
    await fh.close();
  } catch {
    /* reader never came — command may have failed before reaching sudo */
  } finally {
    try {
      unlinkSync(fifo);
    } catch {
      /* already gone */
    }
  }
}
