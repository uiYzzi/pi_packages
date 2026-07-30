/**
 * sudo process helpers.
 *
 * Password discipline:
 *  - stdin only, never argv (ps-visible), never env (inherited by children)
 *  - no reliance on sudo's timestamp cache: it is keyed per-tty and pi's
 *    spawned processes have none, so every run is fed the password directly
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

/**
 * Validate a password against sudo.
 * `-k` drops any cached timestamp so a stale one cannot mask a wrong guess.
 */
export async function validatePassword(password: string): Promise<boolean> {
  const r = await collect(["-S", "-k", "-p", "", "-v"], {
    input: `${password}\n`,
    timeoutMs: 15_000,
  });
  return r.code === 0;
}

/** Run a shell command as root, feeding the password over stdin. */
export async function runSudo(
  command: string,
  timeoutMs: number,
  password: string,
): Promise<RunResult> {
  return collect(["-S", "-p", "", "bash", "-c", command], {
    input: `${password}\n`,
    timeoutMs,
  });
}
