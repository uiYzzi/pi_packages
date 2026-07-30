/**
 * Masked single-line input: behaves exactly like pi-tui's Input
 * (cursor movement, word ops, paste, undo) but renders bullets.
 */

import { Input } from "@earendil-works/pi-tui";

export class MaskedInput extends Input {
  override render(width: number): string[] {
    const real = this.getValue();
    // Same code-unit length => internal cursor index survives the swap.
    this.setValue("•".repeat(real.length));
    try {
      return super.render(width);
    } finally {
      this.setValue(real);
    }
  }
}
