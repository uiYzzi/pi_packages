/**
 * Thin IO shell around `orca orchestration check --wait`.
 *
 * One blocking call = one server round: fetch the oldest mail batch
 * (waiting up to --timeout-ms), optionally acking the previous batch in
 * the same call. Kept deliberately dumb — all policy lives in bridge.ts.
 */

import { spawn } from "node:child_process";
import type { Batch } from "./bridge.js";

/** Must exceed the server-side --timeout-ms so we don't kill a healthy wait. */
const SERVER_WAIT_MS = 60_000;
const HARD_TIMEOUT_MS = SERVER_WAIT_MS + 30_000;

/**
 * Parse the `--json` envelope: either `{ ok, result: {...} }` or a bare
 * result object. Tolerant about delivery-id field naming.
 */
export function parseCheckJson(stdout: string): Batch {
  const parsed: unknown = JSON.parse(stdout);
  if (parsed && typeof parsed === "object" && (parsed as { ok?: unknown }).ok === false) {
    const message =
      (parsed as { error?: { message?: string } }).error?.message ?? "orca check failed";
    throw new Error(message);
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

export function makeOrcaCheck(
  cliCommand: string,
): (ackDeliveryId: string | undefined, signal: AbortSignal) => Promise<Batch> {
  return (ackDeliveryId, signal) =>
    new Promise<Batch>((resolve, reject) => {
      const args = [
        "orchestration",
        "check",
        "--wait",
        "--timeout-ms",
        String(SERVER_WAIT_MS),
        "--json",
      ];
      if (ackDeliveryId) args.push("--ack", ackDeliveryId);

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
        reject(new Error(`orca check exceeded ${HARD_TIMEOUT_MS}ms`));
      }, HARD_TIMEOUT_MS);

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (signal.aborted) return reject(new Error("aborted"));
        if (code !== 0) {
          return reject(new Error(stderr.trim() || `orca check exited with code ${code}`));
        }
        try {
          resolve(parseCheckJson(stdout));
        } catch (err) {
          reject(err);
        }
      });
    });
}
