/**
 * Orca environment detection.
 *
 * Orca-launched agent terminals get a set of ORCA_* env vars. The hard
 * signal is ORCA_TERMINAL_HANDLE — it only exists in a terminal Orca
 * spawned, and it is the routing identity the mail bridge needs. Other
 * ORCA_* vars (e.g. ORCA_PI_STATUS_OWNED) can leak into non-Orca child
 * processes, so they must NOT be used as the detection signal.
 */

export interface OrcaEnv {
  /** Terminal handle — routing identity for orchestration mail. */
  terminalHandle: string;
  /** Worktree the terminal belongs to, if provided. */
  worktreeId?: string;
  /** CLI executable to use (ORCA_CLI_COMMAND, else "orca"). */
  cliCommand: string;
}

/**
 * Detect whether this process is an Orca-managed agent terminal.
 * Returns null outside Orca — the extension stays fully inert.
 */
export function detectOrcaEnv(env: NodeJS.ProcessEnv = process.env): OrcaEnv | null {
  const terminalHandle = env.ORCA_TERMINAL_HANDLE;
  if (!terminalHandle) return null;
  const result: OrcaEnv = {
    terminalHandle,
    cliCommand: env.ORCA_CLI_COMMAND ?? "orca",
  };
  if (env.ORCA_WORKTREE_ID) result.worktreeId = env.ORCA_WORKTREE_ID;
  return result;
}
