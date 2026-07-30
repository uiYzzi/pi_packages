/**
 * pi-secret-kit — shared masked-input UI and secret-handling utilities.
 */

export { MaskedInput } from "./masked-input.js";
export { SecretPrompt, promptSecret } from "./dialog.js";
export { deriveName, isValidName } from "./names.js";
export { scrubValues, placeholderFor, type ScrubEntry, type ScrubResult } from "./scrub.js";
export { notifyShroud, SHROUD_SYMBOL, type NotifyOptions } from "./bridge.js";
