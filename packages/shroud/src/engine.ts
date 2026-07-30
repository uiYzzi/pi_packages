/**
 * High-performance redaction engine.
 *
 * Strategy:
 * 1. Literal value matching: all secret values are compiled into a single
 *    alternation regex (value1|value2|...) → one pass.
 * 2. Pattern matching: built-in + custom token-shape regexes run as a second
 *    pass, capturing unknown secrets for auto-export.
 * 3. Immutable state: refresh() atomically swaps the entire state object.
 * 4. Placeholders are stable per secret name; pattern-captured secrets get
 *    auto-generated names (SECRET_JWT, SECRET_JWT_2, ...).
 */

import { escapeRegex, sanitizeName } from "./util.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SecretDef {
  name: string;
  value: string;
  /**
   * Redact-only secret (e.g. a sudo password pushed by asroot).
   * NOT exported to the shell env and NOT listed as a usable var.
   */
  ephemeral?: boolean;
}

export interface CustomPatternDef {
  name: string;
  regex: string;
  flags?: string;
}

export interface CapturedSecret {
  name: string;
  placeholder: string;
  value: string;
  /** False = redact-only; do not export to shell env. */
  exportable?: boolean;
}

export interface RedactionResult {
  text: string;
  hits: number;
  captured: CapturedSecret[];
}

// ── Built-in token patterns ────────────────────────────────────────────────

interface PatternRule {
  regex: RegExp;
  name: string;
  /** Optional post-match filter; return false to reject a false positive. */
  validate?: (match: string) => boolean;
  /**
   * If false, captured values are redact-only (ephemeral placeholder, no
   * shell-env export). Use for low-confidence shapes where the captured
   * value may be a false positive — exporting it would pollute the env
   * and the bash-hint placeholder would be a lie.
   */
  exportable?: boolean;
}

/**
 * Real AWS secret access keys are 40-char base64-ish and (statistically
 * ~99.9%) contain at least one digit, one uppercase, and one lowercase
 * letter. Bare lowercase strings like file paths (e.g.
 * "backend/src/qingtian/api/middleware/auth", exactly 40 chars of
 * [A-Za-z0-9/]) must NOT match.
 * Slashes are also rejected: paths are the dominant false-positive shape,
 * and the user's own real keys are already covered by literal discovery
 * (env / ~/.aws/credentials), so the pattern only hunts unknown keys.
 */
function looksLikeAwsSecret(match: string): boolean {
  if (match.includes("/") || match.includes("+")) return false;
  return /[0-9]/.test(match) && /[A-Z]/.test(match) && /[a-z]/.test(match);
}

/**
 * Placeholder credentials common in docs/examples. If the userinfo is one
 * of these shapes, the URL is documentation, not a leaked secret.
 * e.g. postgres://user:pass@host, https://admin:admin@host
 */
const PLACEHOLDER_USER = /^(?:user(?:name)?|admin|test|demo|example|sample|foo|bar|changeme|change_me|root|guest|scott|tiger|your[_-]?\w*|\$\{[^}]*\}|<[^>]*>|\.*|x+)$/i;
const PLACEHOLDER_PASS = /^(?:pass(?:word)?|passwd|admin|test|demo|example|sample|foo|bar|changeme|change_me|secret|root|guest|tiger|hunter2|your[_-]?\w*|\$\{[^}]*\}|<[^>]*>|\.*|x+)$/i;

function looksLikeConnectionString(match: string): boolean {
  // match shape: scheme://userinfo@  (userinfo = user:pass)
  const userinfo = match.slice(match.indexOf("://") + 3, match.lastIndexOf("@"));
  const colon = userinfo.indexOf(":");
  if (colon < 0) return false;
  const user = userinfo.slice(0, colon);
  const pass = userinfo.slice(colon + 1);
  // Docs/examples use placeholder creds — not a leaked secret.
  if (PLACEHOLDER_USER.test(user) && PLACEHOLDER_PASS.test(pass)) return false;
  if (PLACEHOLDER_PASS.test(pass)) return false;
  return true;
}

const BUILTIN_PATTERNS: PatternRule[] = [
  // ── Vendor API keys ──────────────────────────────────────────────────
  { regex: /\bAKIA[0-9A-Z]{16}\b/g, name: "AWS_ACCESS_KEY" },
  {
    regex: /\b(?<![A-Za-z0-9/+])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+])\b/g,
    name: "AWS_SECRET",
    validate: looksLikeAwsSecret,
    exportable: false,
  },
  { regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g, name: "OPENAI_KEY" },
  { regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, name: "GITHUB_TOKEN" },
  { regex: /\bgithub_pat_[A-Za-z0-9_]{36,}\b/g, name: "GITHUB_PAT" },
  { regex: /\bglpat-[A-Za-z0-9_-]{20,}\b/g, name: "GITLAB_TOKEN" },
  { regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, name: "SLACK_TOKEN" },
  { regex: /\bnpm_[A-Za-z0-9]{36,}\b/g, name: "NPM_TOKEN" },
  { regex: /\bAIza[0-9A-Za-z_-]{35}\b/g, name: "GOOGLE_API_KEY" },
  { regex: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, name: "SENDGRID_KEY" },
  { regex: /\btvly-[A-Za-z0-9]{32,}\b/g, name: "TWILIO_TOKEN" },
  { regex: /\bfc-[A-Za-z0-9_-]{32,}\b/g, name: "FIREBASE_CREDENTIAL" },
  // ── JWT ─────────────────────────────────────────────────────────────
  { regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, name: "JWT" },
  // ── PEM blocks (PRIVATE KEY, CERTIFICATE, PUBLIC KEY, OPENSSH, etc.) ─
  {
    regex: /-----BEGIN[A-Z ]*(?:PRIVATE|PUBLIC|RSA|DSA|EC|OPENSSH|PGP|DH|ENCRYPTED|CERTIFICATE|X509|PKCS7|TRUSTED)[A-Z ]*-----[\s\S]*?-----END[A-Z ]*(?:PRIVATE|PUBLIC|RSA|DSA|EC|OPENSSH|PGP|DH|ENCRYPTED|CERTIFICATE|X509|PKCS7|TRUSTED)[A-Z ]*-----/g,
    name: "PEM_BLOCK",
  },
  // ── Connection strings (scheme://user:pass@host) ─────────────────────
  {
    regex: /\b(?:postgres|mysql|mongodb|redis|https?|amqp|mqtt|jdbc):\/\/[^:@\s]+:[^@\s]+@/g,
    name: "CONNECTION_STRING",
    validate: looksLikeConnectionString,
    exportable: false,
  },
];

// ── Placeholder helpers ────────────────────────────────────────────────────

function toPlaceholder(secretName: string, shellVar: string): string {
  return `«SECRET ${secretName} redacted — the real value is live in your shell env; read it in bash as "$${shellVar}"»`;
}

function toEphemeralPlaceholder(secretName: string): string {
  return `«SECRET ${secretName} redacted»`;
}

// ── Compilation ────────────────────────────────────────────────────────────

interface ValueEntry {
  /** The exact secret value to match */
  value: string;
  /** Replacement placeholder */
  placeholder: string;
}

interface CompiledState {
  literalRe: RegExp | null;
  valueMap: Map<string, string>;
  patternRules: PatternRule[];
  /** Custom patterns stored separately for clean refresh */
  customPatterns: CustomPatternDef[];
}

/**
 * Compile literal values into a single alternation regex.
 * Values are sorted longest-first so longer matches take priority
 * (the first alternation branch that matches wins).
 */
function compileLiteralRegex(values: ValueEntry[]): RegExp | null {
  if (values.length === 0) return null;
  // Deduplicate by value (same value → same placeholder, later dedup handles)
  const unique = new Map<string, string>();
  for (const v of values) unique.set(v.value, v.placeholder);

  // Sort longest first for greedy match priority in alternation
  const sorted = Array.from(unique.entries()).sort((a, b) => b[0].length - a[0].length);

  const pattern = sorted.map(([val]) => escapeRegex(val)).join("|");
  return new RegExp(pattern, "g");
}

function compileCustomPatterns(patterns: CustomPatternDef[]): PatternRule[] {
  const rules: PatternRule[] = [];
  for (const p of patterns) {
    if (!p || typeof p.regex !== "string" || p.regex.length === 0) continue;
    let flags = typeof p.flags === "string" ? p.flags : "";
    if (!flags.includes("g")) flags += "g";
    try {
      rules.push({ regex: new RegExp(p.regex, flags), name: sanitizeName(p.name) });
    } catch {
      /* invalid regex, skip */
    }
  }
  return rules;
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createRedactor(
  initial: SecretDef[] = [],
  customPatterns: CustomPatternDef[] = [],
): Redactor {
  // Mutable capture state (accumulated across redactions).
  // patternName is kept so refresh() can re-validate stale captures.
  let capturedValues = new Map<
    string,
    { name: string; placeholder: string; patternName: string }
  >();
  let nameCounters = new Map<string, number>();

  // Reserve names from initial secrets so pattern-captured names don't collide
  for (const s of initial) {
    const sanitized = sanitizeName(s.name);
    nameCounters.set(`SECRET_${sanitized}`, 1);
  }

  function buildState(secrets: SecretDef[], custom: CustomPatternDef[]): CompiledState {
    const values: ValueEntry[] = [];
    for (const s of secrets) {
      if (s.value.length >= 8) {
        values.push({
          value: s.value,
          placeholder: s.ephemeral
            ? toEphemeralPlaceholder(s.name)
            : toPlaceholder(s.name, s.name),
        });
      }
    }
    return {
      literalRe: compileLiteralRegex(values),
      valueMap: new Map(values.map((v) => [v.value, v.placeholder])),
      patternRules: [...BUILTIN_PATTERNS, ...compileCustomPatterns(custom)],
      customPatterns: custom,
    };
  }

  let state = buildState(initial, customPatterns);

  // ── Name allocation for captured secrets ───────────────────────────────

  function allocatePlaceholder(
    baseName: string,
    _value: string,
    exportable = true,
  ): { name: string; placeholder: string } {
    const sanitized = sanitizeName(baseName);
    // Find next free name, skipping both previously captured names and reserved names
    let seq = 0;
    let name: string;
    do {
      name = seq === 0 ? `SECRET_${sanitized}` : `SECRET_${sanitized}_${seq + 1}`;
      seq++;
    } while (nameCounters.has(name));
    const placeholder = exportable
      ? toPlaceholder(sanitized, name)
      : toEphemeralPlaceholder(sanitized);
    return { name, placeholder };
  }

  /**
   * Drop captures whose originating rule now rejects the value (e.g. a
   * false positive captured before a validate filter was added). Kept
   * captures survive refresh so placeholders already present in the
   * conversation stay stable.
   */
  function revalidateCaptures(): void {
    for (const [value, entry] of capturedValues) {
      const rule = state.patternRules.find((r) => r.name === entry.patternName);
      // Rule gone (custom pattern removed) or now rejects the value → drop
      if (!rule || (rule.validate && !rule.validate(value))) {
        capturedValues.delete(value);
      }
    }
  }

  // ── Redaction ──────────────────────────────────────────────────────────

  function redact(text: string): RedactionResult {
    if (!text) return { text, hits: 0, captured: [] };

    const captured: CapturedSecret[] = [];
    let out = text;
    let hits = 0;

    // Phase 1: Replace literal values using compiled alternation regex
    if (state.literalRe) {
      out = out.replace(state.literalRe, (match) => {
        hits++;
        return state.valueMap.get(match) ?? match;
      });
    }

    // Phase 2: Pattern-based detection (token shapes)
    for (const { regex, name: patternName, validate, exportable } of state.patternRules) {
      regex.lastIndex = 0;
      out = out.replace(regex, (match) => {
        // Post-match filter: reject false positives (e.g. 40-char paths)
        if (validate && !validate(match)) return match;
        // Check if already captured (same value seen before)
        const existing = capturedValues.get(match);
        if (existing) {
          hits++;
          return existing.placeholder;
        }
        const { name, placeholder } = allocatePlaceholder(patternName, match, exportable !== false);
        capturedValues.set(match, { name, placeholder, patternName });
        nameCounters.set(name, 1);
        captured.push({ name, placeholder, value: match, exportable: exportable !== false });
        hits++;
        return placeholder;
      });
    }

    return { text: out, hits, captured };
  }

  // ── Public API ─────────────────────────────────────────────────────────

  return {
    redact,

    refresh(secrets: SecretDef[]): void {
      state = buildState(secrets, state.customPatterns);
      // Drop stale captures the (possibly updated) rules no longer accept
      revalidateCaptures();
      // Rebuild name reservation from secrets
      const nc = new Map<string, number>();
      for (const s of secrets) {
        nc.set(`SECRET_${sanitizeName(s.name)}`, 1);
      }
      // Keep existing captured names reserved
      for (const entry of capturedValues.values()) {
        nc.set(entry.name, 1);
      }
      nameCounters = nc;
    },

    refreshPatterns(patterns: CustomPatternDef[]): void {
      state = {
        ...state,
        patternRules: [...BUILTIN_PATTERNS, ...compileCustomPatterns(patterns)],
        customPatterns: patterns,
      };
      revalidateCaptures();
    },

    knownPlaceholders(): string[] {
      return Array.from(capturedValues.values()).map((v) => v.placeholder);
    },

    /** Names of pattern-captured secrets (for env preservation on rescan). */
    capturedNames(): string[] {
      return Array.from(capturedValues.values()).map((v) => v.name);
    },
  };
}

export interface Redactor {
  redact(text: string): RedactionResult;
  refresh(secrets: SecretDef[]): void;
  refreshPatterns(patterns: CustomPatternDef[]): void;
  knownPlaceholders(): string[];
  capturedNames(): string[];
}
