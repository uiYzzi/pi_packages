/**
 * Rendering of Orca orchestration mail into user-message text.
 *
 * v0.2.1: the envelope is pure XML, matching pi's other injected context
 * blocks (<bd_context>, <project_context>, …). Tags give unambiguous
 * per-message boundaries; bodies are entity-escaped so worker text can
 * never break the envelope.
 */

export interface MailMessage {
  id?: string;
  type?: string;
  from?: string;
  subject?: string;
  body?: string;
  sentAt?: string;
  [key: string]: unknown;
}

const BODY_CAP = 4000;
/** Subjects are single-line in the TUI banner — keep them short. */
const SUBJECT_CAP = 200;

function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return `${escapeXml(text).replace(/"/g, "&quot;")}`;
}

function renderOne(msg: MailMessage): string {
  const attrs: string[] = [];
  if (msg.type) attrs.push(`type="${escapeAttr(msg.type)}"`);
  if (msg.id) attrs.push(`id="${escapeAttr(msg.id)}"`);
  if (msg.from) attrs.push(`from="${escapeAttr(msg.from)}"`);
  if (msg.sentAt) attrs.push(`at="${escapeAttr(msg.sentAt)}"`);

  const lines = [`<message${attrs.length ? " " + attrs.join(" ") : ""}>`];
  if (msg.subject) lines.push(`<subject>${escapeXml(msg.subject)}</subject>`);
  if (msg.body) lines.push("<body>", escapeXml(cap(msg.body, BODY_CAP)), "</body>");
  lines.push("</message>");
  return lines.join("\n");
}

/**
 * Format a batch of mail into a single XML envelope for injection.
 */
export function formatDelivery(messages: MailMessage[]): string {
  return [
    `<orca-mail count="${messages.length}" source="pi-orca-mail">`,
    `<note>Auto-injected orchestration mail. Do not poll the mailbox (no \`orca orchestration check\`); new mail arrives automatically. Reply when needed: orca orchestration reply --id &lt;message-id&gt; --body "..."</note>`,
    ...messages.map(renderOne),
    `</orca-mail>`,
  ].join("\n");
}

/**
 * TUI transcript entry payload (pi.appendEntry + registerEntryRenderer).
 * Injected user messages are invisible in the interactive TUI; this entry
 * renders a compact banner in the chat transcript so the human sees the
 * same mail the agent got. TUI-only: never enters LLM context.
 */
export interface MailEntryMessage {
  id?: string;
  type?: string;
  from?: string;
  subject?: string;
  body?: string;
}

export interface MailEntryData {
  messages: MailEntryMessage[];
}

export function mailEntryData(messages: MailMessage[]): MailEntryData {
  return {
    messages: messages.map((m) => {
      const out: MailEntryMessage = {};
      if (m.id) out.id = m.id;
      if (m.type) out.type = m.type;
      if (m.from) out.from = m.from;
      if (m.subject) out.subject = cap(m.subject, SUBJECT_CAP);
      if (m.body) out.body = cap(m.body, BODY_CAP);
      return out;
    }),
  };
}

/**
 * Short system-prompt notice appended on every agent start while the
 * bridge is active. Tells the LLM the mailbox is push-based now.
 */
export const SYSTEM_NOTICE = `

## Orca mail bridge (active extension)
Orca orchestration mail auto-arrives as \`<orca-mail>\` user messages — run-mailbox reports (worker_done/escalation/question) via this extension, direct terminal mail via Orca itself. Never poll with \`orca orchestration check\`. Reply with \`orca orchestration reply --id <msg_id> --body "..."\`; send lifecycle reports (worker_done, heartbeat) with \`orca orchestration send\`.`;
