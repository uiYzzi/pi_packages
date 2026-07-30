/**
 * The `askpass` tool: agent asks, user types into a masked TUI input,
 * value goes straight to process.env / file / exec env — never to the model.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { execFile } from "node:child_process";
import { mkdir, appendFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  promptSecret,
  deriveName,
  isValidName,
  placeholderFor,
} from "@uiyzzi/pi-secret-kit";
import { scrubText, type AskpassState } from "./state.js";
import { notifyShroud } from "@uiyzzi/pi-secret-kit";

const parameters = Type.Object({
  description: Type.String({
    description: 'What the secret is for, shown in the dialog, e.g. "GitHub token"',
  }),
  name: Type.Optional(
    Type.String({
      description: "Env var name (e.g. GITHUB_TOKEN). Derived from description if omitted.",
    }),
  ),
  writeFile: Type.Optional(
    Type.String({
      description: "Also write to this file: appends NAME=value (raw=true: overwrite with raw value).",
    }),
  ),
  raw: Type.Optional(
    Type.Boolean({ description: "With writeFile: write raw value instead of NAME=value." }),
  ),
  exec: Type.Optional(
    Type.String({
      description: "Shell command run after capture; secret available as $PI_SECRET and $<name>.",
    }),
  ),
});

export type AskpassInput = Static<typeof parameters>;

function runExec(
  cmd: string,
  env: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolveExec, reject) => {
    execFile(
      "bash",
      ["-c", cmd],
      { env: { ...process.env, ...env }, signal, timeout: 60_000 },
      (error, stdout, stderr) => {
        // Non-zero exit comes through as error with code attached
        const code =
          error && typeof (error as { code?: unknown }).code === "number"
            ? ((error as { code: number }).code ?? 1)
            : error
              ? 1
              : 0;
        resolveExec({ stdout: String(stdout), stderr: String(stderr), code });
      },
    );
  });
}

export function registerAskpassTool(pi: ExtensionAPI, st: AskpassState): void {
  pi.registerTool({
    name: "askpass",
    label: "Askpass",
    description:
      "Ask the user for a secret (password, API key, token) via a masked TUI input. " +
      "The value is exported as a shell env var and NEVER returned to you.",
    promptSnippet: "Ask the user for a secret via masked TUI input; value hidden from the model",
    promptGuidelines: [
      "Use the askpass tool for any password, API key, or token — never ask the user to paste secrets into the chat.",
      "After askpass, use the value in bash as $<name>; never read, echo, or print it.",
    ],
    parameters,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const p = params as AskpassInput;
      const name = (p.name ?? deriveName(p.description)).toUpperCase();
      if (!isValidName(name)) {
        throw new Error(`Invalid env var name "${name}". Use [A-Z_][A-Z0-9_]*.`);
      }

      if (ctx.mode !== "tui" || !ctx.hasUI) {
        throw new Error(
          "askpass needs an interactive TUI. Ask the user to run /askpass instead.",
        );
      }

      const value = await promptSecret(
        ctx,
        p.description,
        `Stored as $${name} — the value is never shown to the agent`,
      );
      if (value === null) {
        throw new Error("User cancelled the secret input. Ask how to proceed.");
      }

      // 1. Export to shell env (never returned to the model)
      process.env[name] = value;
      st.secrets = st.secrets.filter((s) => s.name !== name);
      st.secrets.push({ name, value, description: p.description });
      st.stats.captured++;

      // Teach shroud's redactor right away when it is installed
      const shroudSynced = notifyShroud(name, value);

      const confirmations: string[] = [`Secret captured and exported as $${name}.`];

      // 2. Optional: write to file
      if (p.writeFile) {
        const abs = resolve(ctx.cwd, p.writeFile.replace(/^@/, ""));
        await withFileMutationQueue(abs, async () => {
          await mkdir(dirname(abs), { recursive: true });
          if (p.raw) {
            await writeFile(abs, value, { mode: 0o600 });
          } else {
            await appendFile(abs, `${name}=${value}\n`, { mode: 0o600 });
          }
        });
        st.protectedFiles.add(abs);
        confirmations.push(`Written to ${abs} (read access for the agent is blocked).`);
      }

      // 3. Optional: exec with the secret in env, output scrubbed
      if (p.exec) {
        const r = await runExec(p.exec, { [name]: value, PI_SECRET: value }, signal ?? undefined);
        const scrub = (s: string) => scrubText(s, st) ?? s;
        confirmations.push(
          `Command exited with code ${r.code}.` +
            (r.stdout ? `\nstdout:\n${scrub(r.stdout).trimEnd()}` : "") +
            (r.stderr ? `\nstderr:\n${scrub(r.stderr).trimEnd()}` : ""),
        );
      }

      confirmations.push(
        `Value hidden from you — use it in bash as "$${name}".`,
      );

      return {
        content: [{ type: "text", text: confirmations.join("\n") }],
        details: { name, description: p.description, placeholder: placeholderFor(name), shroudSynced },
      };
    },
  });
}
