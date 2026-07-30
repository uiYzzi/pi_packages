/**
 * Masked secret prompt dialog rendered in pi's TUI (replaces the editor row).
 */

import type { Component, Focusable, TUI } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MaskedInput } from "./masked-input.js";

class SecretPrompt implements Component, Focusable {
  private input = new MaskedInput();
  private title: string;
  private subtitle: string;
  private theme: Theme;

  constructor(title: string, subtitle: string, theme: Theme, done: (v: string | null) => void) {
    this.title = title;
    this.subtitle = subtitle;
    this.theme = theme;
    this.input.onSubmit = (v) => done(v.length > 0 ? v : null);
    this.input.onEscape = () => done(null);
  }

  get focused(): boolean {
    return this.input.focused;
  }

  set focused(value: boolean) {
    this.input.focused = value;
  }

  invalidate(): void {
    this.input.invalidate();
  }

  handleInput(data: string): void {
    this.input.handleInput(data);
  }

  render(width: number): string[] {
    const t = this.theme;
    return [
      ` ${t.fg("accent", t.bold(`🔒 ${this.title}`))}`,
      ` ${t.fg("dim", this.subtitle)}`,
      "",
      ...this.input.render(width),
      ` ${t.fg("dim", "Enter to confirm · Esc to cancel · input is masked")}`,
    ];
  }
}

/**
 * Show a masked input dialog in the TUI.
 * Returns the entered value, or null if cancelled / empty / no TUI.
 */
export async function promptSecret(
  ctx: ExtensionContext,
  title: string,
  subtitle: string,
): Promise<string | null> {
  if (ctx.mode !== "tui" || !ctx.hasUI) return null;

  return ctx.ui.custom<string | null>(
    (tui: TUI, theme: Theme, _kb: KeybindingsManager, done: (v: string | null) => void) =>
      new SecretPrompt(title, subtitle, theme, done),
  );
}
