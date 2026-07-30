# pi-askpass

Masked TUI secret prompt for [pi](https://github.com/earendil-works/pi-mono).
Inspired by `kimi-asksecret` / `askpass.sh`: the agent asks for a secret, **you**
type it into a masked input right inside pi's TUI, and the value goes straight
into the shell environment — it **never enters the model's context**.

```
agent: calls askpass { description: "GitHub token" }
you:   🔒 GitHub token
       Stored as $GITHUB_TOKEN — the value is never shown to the agent
       > ••••••••••••
agent: sees only "Secret captured and exported as $GITHUB_TOKEN"
agent: bash → curl -H "Authorization: Bearer $GITHUB_TOKEN" ...
```

## Install

```bash
pi install ./packages/askpass        # local
# or once published:
pi install npm:@uiyzzi/pi-askpass
```

Build after pulling changes: `npm install && npm run build`.

## What you get

### Tool: `askpass`

Callable by the agent. Parameters:

| param | required | description |
|---|---|---|
| `description` | ✓ | What the secret is for, shown in the dialog |
| `name` | | Env var name (derived from description if omitted) |
| `writeFile` | | Also write to this file (`NAME=value` appended, mode 0600) |
| `raw` | | With `writeFile`: overwrite with raw value instead |
| `exec` | | Shell command run right after capture; secret available as `$PI_SECRET` and `$<name>` |

The tool result contains **only a confirmation** — never the value.

### Commands

- `/askpass NAME [description...]` — capture a secret manually (no agent involved)
- `/askpass-list` — list captured names and stats (never values)

### Agent guidance (injected every turn)

A system-prompt section instructs the agent to:

- always use `askpass` when a secret is needed, never ask you to paste it in chat
- use captured secrets via `$NAME` in `bash`
- never read/echo/print the value or the files it was written to

## How the value is kept away from the model

1. **Tool result** carries only a confirmation string and the env var name.
2. **Prompt injection** — guidance forbids the agent from trying to view it.
3. **File protection** — files written via `writeFile` are blocked for the
   `read`/`edit`/`write` tools, and `bash` commands referencing them are blocked.
4. **Leak scrubbing** — exact-match redaction if the value ever appears in user
   input or tool output (e.g. `echo $NAME`): replaced with
   `«SECRET NAME redacted — use it in bash as "$NAME"»`.

Pairs well with [pi-shroud](../shroud/): shroud pattern-matches and redacts
*all* known secret values in every channel; askpass covers the entry point.

### shroud integration (automatic)

When both are installed, they sync over a decoupled `globalThis` bridge
(`Symbol.for("pi-askpass")` / `Symbol.for("pi-shroud")`) — no shared code,
either works standalone, load order does not matter:

- **push**: every secret askpass captures is pushed into shroud's redactor
  immediately (no rescan gap). The tool result `details.shroudSynced` and the
  `/askpass` notification show whether shroud received it.
- **pull**: on rescan (`session_start`, `/shroud-rescan`) shroud pulls
  askpass's captured list, so secrets captured before shroud loaded are
  covered too. On name conflict askpass's value wins (freshest).

## Layout

```
src/
  index.ts         entry — wires everything
  tool.ts          askpass tool (prompt → env/file/exec)
  dialog.ts        ctx.ui.custom masked prompt dialog
  masked-input.ts  pi-tui Input subclass rendering bullets
  hooks.ts         guidance injection, file protection, leak scrubbing
  commands.ts      /askpass, /askpass-list
  bridge.ts        optional shroud sync (globalThis symbol bridge)
  state.ts         session state + name/scrub helpers
```
