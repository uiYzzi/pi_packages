/**
 * Thin IO shell around the orca CLI.
 *
 * v0.2 scope: the bridge only watches the terminal's ACTIVE COORDINATOR
 * RUN mailbox (worker_done / escalation / question). Direct terminal-handle
 * mail is already delivered by Orca's own push-on-idle — consuming it here
 * would suppress that push and double-deliver, so terminals without an
 * active coordinator run stay fully dormant (no check at all, no errors).
 *
 * One blocking call = one server round: probe the run, then fetch the
 * oldest mail batch (waiting up to --timeout-ms), optionally acking the
 * previous batch in the same call. Kept deliberately dumb — all policy
 * lives in bridge.ts.
 */

import { spawn } from "node:child_process";
import type { Batch } from "./bridge.js";

/** Must exceed the server-side --timeout-ms so we don't kill a healthy wait. */
const SERVER_WAIT_MS = 60_000;
const HARD_TIMEOUT_MS = SERVER_WAIT_MS + 30_000;
/** How often to re-probe for an active coordinator run while dormant. */
const PROBE_INTERVAL_MS = 30_000;
/** Message types a coordinator actually waits on. */
const WATCH_TYPES = ["worker_done", "escalation", "question"];

/** Errors meaning "no active coordinator run (anymore)" — go dormant, don't spam. */
const RUN_GONE_CODES = new Set([
  "legacy_read_only",
  "run_not_found",
  "unknown_run",
  "no_active_run",
]);

/**
 * Parse the `--json` envelope: either `{ ok, result: {...} }` or a bare
 * result object. Tolerant about delivery-id field naming.
 */
export function parseCheckJson(stdout: string): Batch {
  const parsed: unknown = JSON.parse(stdout);
  if (parsed && typeof parsed === "object" && (parsed as { ok?: unknown }).ok === false) {
    const message =
      (parsed as { error?: { message?: string } }).error?.message ?? "orca check failed";
    const code = (parsed as { error?: { code?: string } }).error?.code;
    const err = new Error(message) as Error & { code?: string };
    if (typeof code === "string") err.code = code;
    throw err;
  }
  const envelope = parsed as { result?: Record<string, unknown> } | Record<string, unknown>;
  const r = ("result" in envelope && envelope.result ? envelope.result : envelope) as Record<
    string,
    unknown
  >;
  const messages = Array.isArray(r.messages) ? (r.messages as Batch["messages"]) : [];
  const deliveryId = r.deliveryId ?? r.delivery_id ?? r.id;
  const batch: Batch = { messages };
  if (typeof deliveryId === "string" && deliveryId) batch.deliveryId = deliveryId;
  return batch;
}

/**
 * Parse `run-list --json` and return the id of the active (non-legacy) run
 * coordinated by `terminalHandle`, or undefined when there is none.
 */
export function parseRunListJson(stdout: string, terminalHandle: string): string | undefined {
  const parsed: unknown = JSON.parse(stdout);
  if (parsed && typeof parsed === "object" && (parsed as { ok?: unknown }).ok === false) {
    const message =
      (parsed as { error?: { message?: string } }).error?.message ?? "orca run-list failed";
    throw new Error(message);
  }
  const envelope = parsed as { result?: { runs?: unknown } } & { runs?: unknown };
  const runs = envelope.result && "runs" in envelope.result ? envelope.result.runs : envelope.runs;
  if (!Array.isArray(runs)) return undefined;
  let best: { id: string; updated_at?: string } | undefined;
  for (const run of runs) {
    if (!run || typeof run !== "object") continue;
    const r = run as { id?: unknown; coordinator_handle?: unknown; legacy?: unknown; updated_at?: unknown };
    if (r.legacy) continue;
    if (r.coordinator_handle !== terminalHandle || typeof r.id !== "string") continue;
    if (
      !best ||
      (typeof r.updated_at === "string" && typeof best.updated_at === "string"
        ? r.updated_at > best.updated_at
        : true)
    ) {
      best = { id: r.id, updated_at: typeof r.updated_at === "string" ? r.updated_at : undefined };
    }
  }
  return best?.id;
}

function isRunGone(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  if (code && RUN_GONE_CODES.has(code)) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /legacy_read_only|no active (coordinator )?run|run not found/i.test(message);
}

interface SpawnJsonOptions {
  hardTimeoutMs: number;
}

function spawnJson(
  cliCommand: string,
  args: string[],
  signal: AbortSignal,
  options: SpawnJsonOptions,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(cliCommand, args, {
      stdio: ["ignore", "pipe", "pipe"],
      signal, // aborting kills the child
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`orca ${args[1] ?? "call"} exceeded ${options.hardTimeoutMs}ms`));
    }, options.hardTimeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (signal.aborted) return reject(new Error("aborted"));
      // The CLI also prints a JSON error envelope on failure — prefer it so
      // callers can classify by error.code.
      if (stdout.trim()) {
        resolve(stdout);
        return;
      }
      if (code !== 0) {
        return reject(new Error(stderr.trim() || `orca ${args[1] ?? "call"} exited with code ${code}`));
      }
      reject(new Error(`orca ${args[1] ?? "call"} produced no output`));
    });
  });
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Build the bridge's check function.
 *
 * Each round:
 *   1. Probe for an active coordinator run owned by this terminal.
 *      None → sleep PROBE_INTERVAL_MS and return an empty batch (dormant:
 *      terminal-handle mail is Orca push-on-idle's job, not ours).
 *   2. Run exists → one blocking `check --run <id> --wait` round over the
 *      coordinator lifecycle types, acking the previous batch when set.
 *   3. The run ending mid-wait surfaces as a run-gone CLI error → swallow
 *      into an empty batch (back to dormant probing) instead of erroring.
 */
export interface OrcaCheckOptions {
  /** Dormant re-probe interval; injectable for tests. */
  probeIntervalMs?: number;
}

export function makeOrcaCheck(
  cliCommand: string,
  terminalHandle: string,
  options: OrcaCheckOptions = {},
): (ackDeliveryId: string | undefined, signal: AbortSignal) => Promise<Batch> {
  const probeIntervalMs = options.probeIntervalMs ?? PROBE_INTERVAL_MS;
  return async (ackDeliveryId, signal) => {
    let runId: string | undefined;
    try {
      const out = await spawnJson(cliCommand, ["orchestration", "run-list", "--json"], signal, {
        hardTimeoutMs: 15_000,
      });
      runId = parseRunListJson(out, terminalHandle);
    } catch (err) {
      if (isRunGone(err)) {
        runId = undefined;
      } else {
        throw err;
      }
    }

    if (!runId) {
      await abortableSleep(probeIntervalMs, signal);
      return { messages: [] };
    }

    const args = [
      "orchestration",
      "check",
      "--run",
      runId,
      "--wait",
      "--types",
      WATCH_TYPES.join(","),
      "--timeout-ms",
      String(SERVER_WAIT_MS),
      "--json",
    ];
    if (ackDeliveryId) args.push("--ack", ackDeliveryId);

    const stdout = await spawnJson(cliCommand, args, signal, { hardTimeoutMs: HARD_TIMEOUT_MS });
    try {
      return parseCheckJson(stdout);
    } catch (err) {
      if (isRunGone(err)) return { messages: [] }; // run ended mid-round
      throw err;
    }
  };
}
