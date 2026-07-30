/**
 * sudo process helpers.
 *
 * Password discipline:
 *  - stdin only, never argv (ps-visible), never env (inherited by children)
 *  - validated with `sudo -S -k -v`, then sudo's own timestamp cache
 *    authorizes subsequent `sudo -n` runs (default ~5 min on macOS)
 */

import { spawn } from "node:child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

function collect(
  args: string[],
  opts: { input?: string; timeoutMs?: number },
): Promise<RunResult> {
  return new Promise((resolveRun, reject) => {
    const child = spawn("sudo", args, {
      stdio: [opts.input !== undefined ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer =
      opts.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, opts.timeoutMs)
        : undefined;

    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) {
        resolveRun({ stdout, stderr: stderr + "\n[asroot] timed out", code: 124 });
        return;
      }
      resolveRun({ stdout, stderr, code: code ?? 1 });
    });

    if (opts.input !== undefined && child.stdin) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}

/** True when sudo credentials are already cached (timestamp unexpired). */
export async function sudoCached(): Promise<boolean> {
  const r = await collect(["-n", "true"], { timeoutMs: 10_000 });
  return r.code === 0;
}

/**
 * Validate a password against sudo. On success the timestamp cache is
 * primed, so later `sudo -n` calls need no password.
 * `-k` forces re-authentication so a stale cache cannot mask a wrong guess.
 */
export async function validatePassword(password: string): Promise<boolean> {
  const r = await collect(["-S", "-k", "-v"], {
    input: `${password}\n`,
    timeoutMs: 15_000,
  });
  return r.code === 0;
}

/** Run a shell command as root. Requires a valid sudo timestamp. */
export async function runSudo(command: string, timeoutMs: number): Promise<RunResult> {
  return collect(["-n", "bash", "-c", command], { timeoutMs });
}
