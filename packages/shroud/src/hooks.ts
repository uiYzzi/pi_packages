/**
 * Extension event hooks: input, context, tool_result, before_agent_start.
 *
 * Each hook checks enabled flag, runs redaction, and exports any captured
 * secrets to process.env so they're available as shell variables.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TextContent, ImageContent } from "@earendil-works/pi-ai";
import type { Redactor, SecretDef, CapturedSecret } from "./engine.js";
import { discoverSecrets } from "./discovery.js";
import { loadConfig } from "./config.js";
import { buildGuidance } from "./guidance.js";
import { getAskpassSecrets } from "./bridge.js";

type ContentBlock = TextContent | ImageContent;

export interface ShroudState {
  enabled: boolean;
  secrets: SecretDef[];
  redactor: Redactor;
  /** Names we injected into process.env — ONLY these get cleaned up on rescan */
  ownedNames: Set<string>;
  /** Pre-existing env values saved before we overwrote */
  savedEnv: Map<string, string | undefined>;
  stats: { redactedHits: number; capturedCount: number };
}

export function createState(redactor: Redactor): ShroudState {
  return {
    enabled: true,
    secrets: [],
    redactor,
    ownedNames: new Set(),
    savedEnv: new Map(),
    stats: { redactedHits: 0, capturedCount: 0 },
  };
}

/** Re-discover secrets, rebuild redactor, export to shell. */
export function rescan(cwd: string, st: ShroudState): void {
  const config = loadConfig(cwd);
  const discovered = discoverSecrets(cwd, config.discovery);

  // Merge secrets captured by askpass (if installed). askpass wins on name
  // conflict — its value is the freshest (user just typed it).
  const merged = [...discovered];
  for (const s of getAskpassSecrets()) {
    const i = merged.findIndex((m) => m.name === s.name);
    if (i >= 0) merged[i] = s;
    else merged.push(s);
  }
  // Preserve redact-only runtime secrets (e.g. sudo passwords from asroot);
  // they are not discoverable from env or files.
  for (const s of st.secrets) {
    if (s.ephemeral && !merged.some((m) => m.name === s.name)) merged.push(s);
  }

  st.secrets = merged;
  st.redactor.refresh(st.secrets);
  st.redactor.refreshPatterns(config.patterns);
  // Pattern-captured secrets live in the redactor, not in `secrets` —
  // their env vars must survive rescan, else placeholders like
  // «... read it in bash as "$SECRET_JWT"» become dangling references.
  exportSecrets(st.secrets, st.ownedNames, st.savedEnv, new Set(st.redactor.capturedNames()));
}

/**
 * Add a secret captured at runtime (e.g. pushed by askpass via the bridge).
 * Refreshes the redactor immediately — no rescan needed.
 */
/**
 * Add a secret captured at runtime (e.g. pushed by askpass/asroot via the bridge).
 * Refreshes the redactor immediately — no rescan needed.
 * Ephemeral secrets are redact-only: never exported to the shell env.
 */
export function addRuntimeSecret(
  st: ShroudState,
  name: string,
  value: string,
  opts?: { ephemeral?: boolean },
): void {
  st.secrets = st.secrets.filter((s) => s.name !== name);
  st.secrets.push({ name, value, ephemeral: opts?.ephemeral });
  st.redactor.refresh(st.secrets);
  exportSecrets(st.secrets, st.ownedNames, st.savedEnv);
}

function exportSecrets(
  secrets: SecretDef[],
  ownedNames: Set<string>,
  savedEnv: Map<string, string | undefined>,
  keepNames: Set<string> = new Set(),
): void {
  // 1. Restore previously saved env vars that are no longer in secrets.
  //    Names in keepNames (pattern-captured secrets) are preserved.
  for (const name of ownedNames) {
    if (keepNames.has(name)) continue;
    if (!secrets.some((s) => s.name === name)) {
      const saved = savedEnv.get(name);
      if (saved === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved;
      }
      savedEnv.delete(name);
    }
  }
  ownedNames.clear();

  // 2. Set new secrets, saving existing values first.
  //    Ephemeral secrets (e.g. sudo passwords) are redact-only: never exported.
  for (const s of secrets) {
    if (s.ephemeral) continue;
    // Save existing value before overwriting (if we haven't already)
    if (!savedEnv.has(s.name)) {
      savedEnv.set(s.name, process.env[s.name]);
    }
    process.env[s.name] = s.value;
    ownedNames.add(s.name);
  }
  // 3. Preserved captured names stay owned (not restored/deleted above).
  for (const name of keepNames) {
    if (name in process.env) ownedNames.add(name);
  }
}

function exportCaptured(
  captured: CapturedSecret[],
  ownedNames: Set<string>,
  savedEnv: Map<string, string | undefined>,
): void {
  for (const c of captured) {
    // Redact-only captures (low-confidence patterns): never touch the env.
    if (c.exportable === false) continue;
    let finalName = c.name;

    // Collision: name already in process.env but we didn't put it there
    if (c.name in process.env && !ownedNames.has(c.name)) {
      let i = 2;
      do {
        finalName = `${c.name}_${i}`;
        i++;
      } while (finalName in process.env && !ownedNames.has(finalName));

      // Patch the placeholder to reference the correct shell var
      c.placeholder = c.placeholder.replace(
        /"\$\w+"/,
        `"$${finalName}"`,
      );
      c.name = finalName;
    }

    if (!savedEnv.has(finalName)) {
      savedEnv.set(finalName, process.env[finalName]);
    }
    process.env[finalName] = c.value;
    ownedNames.add(finalName);
  }
}

/** Walk content blocks and redact text fields. Returns redacted blocks + captured secrets if changed. */
function redactContentBlocks(
  content: ContentBlock[],
  redactor: Redactor,
  stats: ShroudState["stats"],
): { blocks: ContentBlock[] | undefined; captured: CapturedSecret[] } {
  let changed = false;
  const allCaptured: CapturedSecret[] = [];
  const next = content.map((block) => {
    if (block.type !== "text") return block;
    const r = redactor.redact(block.text);
    if (r.hits > 0) {
      changed = true;
      stats.redactedHits += r.hits;
      allCaptured.push(...r.captured);
      return { ...block, text: r.text };
    }
    return block;
  });
  return { blocks: changed ? next : undefined, captured: allCaptured };
}

/** Deep-redact message content. Returns redacted value + captured secrets. */
function redactValue(value: unknown, redactor: Redactor, stats: ShroudState["stats"]): { result: unknown; captured: CapturedSecret[] } {
  if (typeof value === "string") {
    const r = redactor.redact(value);
    if (r.hits > 0) stats.redactedHits += r.hits;
    return { result: r.text, captured: r.captured };
  }

  if (Array.isArray(value)) {
    let changed = false;
    const allCaptured: CapturedSecret[] = [];
    const next = value.map((item) => {
      if (!item || typeof item !== "object") return item;
      const b = item as Record<string, unknown>;
      const out: Record<string, unknown> = { ...b };
      let blockChanged = false;

      if (b.type === "text" && typeof b.text === "string") {
        const r = redactor.redact(b.text);
        if (r.hits > 0) {
          stats.redactedHits += r.hits;
          out.text = r.text;
          allCaptured.push(...r.captured);
          blockChanged = true;
        }
      }
      if (b.type === "thinking" && typeof b.thinking === "string") {
        const r = redactor.redact(b.thinking);
        if (r.hits > 0) {
          stats.redactedHits += r.hits;
          out.thinking = r.text;
          allCaptured.push(...r.captured);
          blockChanged = true;
        }
      }
      // NOTE: toolCall arguments are deliberately NOT redacted here.
      // The model generated those args itself — redaction provides zero
      // secrecy benefit, but pi drains context-hook transforms into the
      // session before tool execution, so mutating arguments corrupts the
      // very operations the agent performs (write/edit/bash payloads with
      // secret-shaped strings, e.g. a 40-char path, would land on disk
      // as «SECRET ...» placeholders).

      if (blockChanged) changed = true;
      return blockChanged ? out : item;
    });
    return { result: changed ? next : value, captured: allCaptured };
  }

  return { result: value, captured: [] };
}

// ── Hook registrations ─────────────────────────────────────────────────────

export function registerHooks(pi: ExtensionAPI, st: ShroudState): void {
  pi.on("session_start", async (_event, ctx) => {
    rescan(ctx.cwd, st);
  });

  pi.on("before_agent_start", async (event) => {
    if (!st.enabled) return;
    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildGuidance(st.secrets)}`,
    };
  });

  pi.on("input", async (event) => {
    if (!st.enabled) return { action: "continue" };
    const r = st.redactor.redact(event.text);
    exportCaptured(r.captured, st.ownedNames, st.savedEnv);
    if (r.hits === 0) return { action: "continue" };
    return { action: "transform", text: r.text, images: event.images };
  });

  pi.on("context", async (event) => {
    if (!st.enabled) return;
    let changed = false;
    const allCaptured: CapturedSecret[] = [];
    const messages = (event.messages as unknown[]).map((msg) => {
      const m = msg as Record<string, unknown>;
      if (!("content" in m)) return msg;
      const { result, captured } = redactValue(m.content, st.redactor, st.stats);
      allCaptured.push(...captured);
      if (result !== m.content) {
        changed = true;
        return { ...m, content: result };
      }
      return msg;
    });
    exportCaptured(allCaptured, st.ownedNames, st.savedEnv);
    if (changed) return { messages } as never;
  });

  pi.on("tool_result", async (event) => {
    if (!st.enabled) return;
    const { blocks, captured } = redactContentBlocks(event.content as ContentBlock[], st.redactor, st.stats);
    exportCaptured(captured, st.ownedNames, st.savedEnv);
    if (blocks) return { content: blocks } as never;
  });
}
