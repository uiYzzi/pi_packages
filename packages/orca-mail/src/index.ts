/**
 * pi-orca-mail — auto-inject Orca orchestration mail into the agent.
 *
 * Outside an Orca-managed terminal the factory returns before registering
 * a single handler: zero timers, zero processes, zero overhead.
 *
 * Inside Orca, the bridge watches ONLY the terminal's active coordinator
 * run mailbox (worker_done / escalation / question) — mail Orca's own
 * push-on-idle never delivers. Direct terminal-handle mail is left to
 * Orca's push. Without an active coordinator run the bridge stays dormant:
 * no check processes, no error spam. Injection:
 *   - agent idle  → pi.sendMessage triggerTurn (starts a turn; display:false,
 *     the TUI shows a 📬 transcript entry instead of the raw envelope)
 *   - agent busy  → `context` hook splices it into the in-flight request
 * A short system-prompt notice tells the LLM the run mailbox is push-based.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { detectOrcaEnv } from "./env.js";
import { MailBridge } from "./bridge.js";
import { makeOrcaCheck } from "./runner.js";
import { formatDelivery, mailEntryData, SYSTEM_NOTICE, type MailEntryData } from "./format.js";

export default function (pi: ExtensionAPI) {
  const env = detectOrcaEnv();
  if (!env) return; // not an Orca terminal — fully inert

  // Injected user messages are invisible in the interactive TUI, so mirror
  // every delivered batch as a transcript entry (TUI-only, no LLM context).
  pi.registerEntryRenderer("orca-mail", (entry, { expanded }, theme) => {
    const messages = (entry.data as MailEntryData | undefined)?.messages ?? [];
    const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
    if (messages.length === 0) {
      box.addChild(new Text("📬 orca mail"));
      return box;
    }
    for (const msg of messages) {
      const head = `📬 [${msg.type ?? "mail"}] ${msg.subject ?? "(no subject)"}`;
      box.addChild(new Text(theme.bold(head) + (msg.from ? theme.fg("dim", ` — ${msg.from}`) : "")));
      if (expanded) {
        if (msg.id) box.addChild(new Text(theme.fg("dim", `id: ${msg.id}`)));
        if (msg.body) box.addChild(new Text(msg.body));
      }
    }
    return box;
  });

  let bridge: MailBridge | undefined;
  let abort: AbortController | undefined;

  pi.on("session_start", (_event, ctx) => {
    abort?.abort();
    abort = new AbortController();

    let lastErrorNotice = 0;
    bridge = new MailBridge({
      check: makeOrcaCheck(env.cliCommand, env.terminalHandle),
      isIdle: () => ctx.isIdle(),
      deliver: (messages) => {
        // display:false keeps the raw XML out of the TUI (the appendEntry
        // banner is the visible face); the envelope still enters context
        // and triggerTurn starts a turn while idle. Throws if the agent
        // went busy — the batch then stays held for the hook / idle wake.
        pi.sendMessage(
          { customType: "orca-mail", content: formatDelivery(messages), display: false },
          { triggerTurn: true },
        );
        pi.appendEntry("orca-mail", mailEntryData(messages));
      },
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
    pi.appendEntry("orca-mail", mailEntryData(batch.messages));
    event.messages.push({
      role: "user",
      content: [{ type: "text", text: formatDelivery(batch.messages) }],
      timestamp: Date.now(),
    });
    return { messages: event.messages };
  });

  // Mail held during a turn's final LLM call sees no context event —
  // wake the bridge when the agent goes idle so it delivers directly.
  const wakeOnIdle = () => bridge?.notifyIdle();
  pi.on("agent_end", wakeOnIdle);
  pi.on("agent_settled", wakeOnIdle);

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
