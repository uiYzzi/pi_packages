/**
 * pi-orca-mail — auto-inject Orca orchestration mail into the agent.
 *
 * Outside an Orca-managed terminal the factory returns before registering
 * a single handler: zero timers, zero processes, zero overhead.
 *
 * Inside Orca, a background loop runs blocking `orca orchestration check
 * --wait` rounds (in the extension process — never as an agent tool call)
 * and injects arriving mail as user messages:
 *   - agent idle  → pi.sendUserMessage (starts a turn, like the user typed)
 *   - agent busy  → `context` hook splices it into the in-flight request
 * A short system-prompt notice tells the LLM the mailbox is now push-based.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { detectOrcaEnv } from "./env.js";
import { MailBridge } from "./bridge.js";
import { makeOrcaCheck } from "./runner.js";
import { formatDelivery, SYSTEM_NOTICE } from "./format.js";

export default function (pi: ExtensionAPI) {
  const env = detectOrcaEnv();
  if (!env) return; // not an Orca terminal — fully inert

  let bridge: MailBridge | undefined;
  let abort: AbortController | undefined;

  pi.on("session_start", (_event, ctx) => {
    abort?.abort();
    abort = new AbortController();

    let lastErrorNotice = 0;
    bridge = new MailBridge({
      check: makeOrcaCheck(env.cliCommand),
      isIdle: () => ctx.isIdle(),
      deliver: (messages) => pi.sendUserMessage(formatDelivery(messages)),
      onError: (err) => {
        // Throttle to one notice per minute; the loop keeps retrying.
        const now = Date.now();
        if (now - lastErrorNotice > 60_000) {
          lastErrorNotice = now;
          ctx.ui.notify(`orca-mail: ${err instanceof Error ? err.message : String(err)}`, "warning");
        }
      },
    });
    void bridge.run(abort.signal).catch(() => {});
  });

  // Busy path: splice held mail into the in-flight LLM request.
  pi.on("context", (event) => {
    const batch = bridge?.takeHeld();
    if (!batch) return undefined;
    event.messages.push({
      role: "user",
      content: [{ type: "text", text: formatDelivery(batch.messages) }],
      timestamp: Date.now(),
    });
    return { messages: event.messages };
  });

  // Tell the LLM the mailbox is push-based now.
  pi.on("before_agent_start", (event) => ({
    systemPrompt: event.systemPrompt + SYSTEM_NOTICE,
  }));

  pi.on("session_shutdown", () => {
    bridge?.stop();
    abort?.abort();
    bridge = undefined;
  });
}
