/**
 * Rendering of Orca orchestration mail into user-message text.
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

function cap(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text;
}

function renderOne(msg: MailMessage, index: number): string {
  const head: string[] = [`── message ${index + 1}`];
  if (msg.type) head.push(`type=${msg.type}`);
  if (msg.from) head.push(`from=${msg.from}`);
  if (msg.id) head.push(`id=${msg.id}`);
  if (msg.sentAt) head.push(`at=${msg.sentAt}`);
  const parts = [head.join(" ")];
  if (msg.subject) parts.push(`Subject: ${msg.subject}`);
  if (msg.body) parts.push(cap(msg.body, BODY_CAP));
  if (msg.type === "question" && msg.id) {
    parts.push(`Reply with: orca orchestration reply --id ${msg.id} --body "..."`);
  }
  return parts.join("\n");
}

/**
 * Format a batch of mail into a single user-prompt text for injection.
 */
export function formatDelivery(messages: MailMessage[]): string {
  const header =
    `📬 Orca orchestration mail — ${messages.length} message(s) arrived.\n` +
    `This mail was auto-injected by the orca-mail extension. ` +
    `Do NOT run \`orca orchestration check --wait\` yourself; new mail will keep arriving automatically.`;
  return [header, ...messages.map(renderOne)].join("\n\n");
}

/**
 * Short system-prompt notice appended on every agent start while the
 * bridge is active. Tells the LLM the mailbox is push-based now.
 */
export const SYSTEM_NOTICE = `

## Orca mail bridge (active extension)
This session runs in an Orca-managed terminal. Orca orchestration mail is injected into your context automatically as user messages — you never need to run \`orca orchestration check\` or \`check --wait\`; do not poll the mailbox. When an injected message needs an answer, reply via bash with \`orca orchestration reply --id <msg_id> --body "..."\`. Lifecycle reports (worker_done, heartbeat) still go through \`orca orchestration send\` as usual.`;
