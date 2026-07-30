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
}

const BUILTIN_PATTERNS: PatternRule[] = [
  // ── Vendor API keys ──────────────────────────────────────────────────
  { regex: /\bAKIA[0-9A-Z]{16}\b/g, name: "AWS_ACCESS_KEY" },
  { regex: /\b(?<![A-Za-z0-9/+])[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+])\b/g, name: "AWS_SECRET" },
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
  // Mutable capture state (accumulated across redactions)
  let capturedValues = new Map<string, { name: string; placeholder: string }>();
  let nameCounters = new Map<string, number>();
  let nextSuffix = new Map<string, number>();

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

  function allocatePlaceholder(baseName: string, _value: string): { name: string; placeholder: string } {
    const sanitized = sanitizeName(baseName);
    // Find next free name, skipping both previously captured names and reserved names
    let seq = 0;
    let name: string;
    do {
      name = seq === 0 ? `SECRET_${sanitized}` : `SECRET_${sanitized}_${seq + 1}`;
      seq++;
    } while (nameCounters.has(name) || nextSuffix.has(name));
    nextSuffix.set(sanitized, seq);
    const placeholder = toPlaceholder(sanitized, name);
    return { name, placeholder };
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
    for (const { regex, name: patternName } of state.patternRules) {
      regex.lastIndex = 0;
      out = out.replace(regex, (match) => {
        // Check if already captured (same value seen before)
        const existing = capturedValues.get(match);
        if (existing) {
          hits++;
          return existing.placeholder;
        }
        const { name, placeholder } = allocatePlaceholder(patternName, match);
        capturedValues.set(match, { name, placeholder });
        nameCounters.set(name, 1);
        captured.push({ name, placeholder, value: match });
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
      state = buildState(secrets, state.customPatterns);
    },

    refreshPatterns(patterns: CustomPatternDef[]): void {
      state = {
        ...state,
        patternRules: [...BUILTIN_PATTERNS, ...compileCustomPatterns(patterns)],
        customPatterns: patterns,
      };
    },

    knownPlaceholders(): string[] {
      return Array.from(capturedValues.values()).map((v) => v.placeholder);
    },
  };
}

export interface Redactor {
  redact(text: string): RedactionResult;
  refresh(secrets: SecretDef[]): void;
  refreshPatterns(patterns: CustomPatternDef[]): void;
  knownPlaceholders(): string[];
}
