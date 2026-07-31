/**
 * Mail bridge state machine.
 *
 * Core idea: the Orca server IS the queue (an unacked batch replays
 * verbatim on the next check). The bridge is just a valve — it never
 * holds more than ONE batch locally.
 *
 *   EMPTY --check --wait--> (batch) --delivered--> INJECTED --next check carries --ack--> EMPTY
 *                          |
 *                          +-- agent busy --> HELD --context hook takes--> INJECTED
 *
 * On error the slot is left untouched and retried after a backoff, so an
 * ack is never silently dropped. `lastInjectedId` guards against double
 * injection when the server replays a batch whose ack was lost.
 *
 * Pure logic: no pi API, no child_process. All IO is injected.
 */

import type { MailMessage } from "./format.js";

export interface Batch {
  /** Orca delivery id — present whenever the server batch is ack-able. */
  deliveryId?: string;
  messages: MailMessage[];
}

type Slot =
  | { phase: "empty" }
  | { phase: "held"; batch: Batch }
  | { phase: "injected"; deliveryId?: string };

export interface BridgeDeps {
  /** One `orca orchestration check --wait` round; ackId rides along when set. */
  check: (ackDeliveryId: string | undefined, signal: AbortSignal) => Promise<Batch>;
  /** Push messages into the agent (idle path). Throwing means "agent went busy". */
  deliver: (messages: MailMessage[]) => void | Promise<void>;
  isIdle: () => boolean;
  onError?: (err: unknown) => void;
  retryDelayMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class MailBridge {
  private slot: Slot = { phase: "empty" };
  private lastInjectedId: string | undefined;
  private heldTaken: (() => void) | undefined;
  private stopped = false;

  constructor(private readonly deps: BridgeDeps) {}

  /**
   * Busy path: the `context` event hook calls this to take the held batch
   * and inject it into the outgoing LLM request. Marks it injected (the
   * loop will ack on its next round).
   */
  takeHeld(): Batch | undefined {
    if (this.slot.phase !== "held") return undefined;
    const { batch } = this.slot;
    this.markInjected(batch);
    return batch;
  }

  /** True while a batch waits for the context hook. */
  hasHeld(): boolean {
    return this.slot.phase === "held";
  }

  /**
   * The host signals the agent just went idle (pi `agent_end` /
   * `agent_settled`). Wakes the held wait so the loop can deliver the
   * batch directly instead of waiting for a context hook that may never
   * come (mail arrived during the turn's final LLM call).
   */
  notifyIdle(): void {
    this.releaseHeld();
  }

  stop(): void {
    this.stopped = true;
    this.releaseHeld();
  }

  private markInjected(batch: Batch): void {
    this.slot = batch.deliveryId
      ? { phase: "injected", deliveryId: batch.deliveryId }
      : { phase: "empty" };
    if (batch.deliveryId) this.lastInjectedId = batch.deliveryId;
    this.releaseHeld();
  }

  private releaseHeld(): void {
    const release = this.heldTaken;
    this.heldTaken = undefined;
    release?.();
  }

  async run(signal: AbortSignal): Promise<void> {
    const sleep = this.deps.sleep ?? defaultSleep;
    const retryDelay = this.deps.retryDelayMs ?? 15_000;

    while (!this.stopped && !signal.aborted) {
      // A held batch waits here until woken by one of two events:
      //   1. takeHeld()      — the context hook splices it into an in-flight request
      //   2. notifyIdle()    — agent_end/agent_settled fired; deliver directly
      // Mail arriving during a turn's FINAL LLM call never sees a context
      // event, which is why (2) exists — without it the batch would park
      // until some future turn. New mail accumulates server-side either way.
      if (this.slot.phase === "held") {
        await new Promise<void>((resolve) => {
          this.heldTaken = resolve;
        });
        if (this.slot.phase !== "held") continue; // context hook took it
        if (!this.deps.isIdle()) continue; // spurious wake — keep waiting
        const { batch } = this.slot;
        try {
          await this.deps.deliver(batch.messages);
          this.markInjected(batch);
        } catch {
          // Went busy again between the wake and deliver — stay held.
        }
        continue;
      }

      const ackId = this.slot.phase === "injected" ? this.slot.deliveryId : undefined;
      let batch: Batch;
      try {
        batch = await this.deps.check(ackId, signal);
        this.slot = { phase: "empty" }; // ack (if any) reached the server
      } catch (err) {
        if (this.stopped || signal.aborted) return;
        this.deps.onError?.(err);
        await sleep(retryDelay);
        continue;
      }

      if (batch.messages.length === 0) continue;

      if (batch.deliveryId && batch.deliveryId === this.lastInjectedId) {
        // Server replayed an already-injected batch (its ack was lost).
        // Never inject twice — just re-ack on the next pass.
        this.slot = { phase: "injected", deliveryId: batch.deliveryId };
        continue;
      }

      if (this.deps.isIdle()) {
        try {
          await this.deps.deliver(batch.messages);
          this.markInjected(batch);
          continue;
        } catch {
          // Agent went busy between isIdle() and deliver — hold it for the hook.
        }
      }
      this.slot = { phase: "held", batch };
    }
  }
}
