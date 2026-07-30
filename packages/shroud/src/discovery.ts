/**
 * Secret discovery from environment variables, .env files, and auth.json.
 *
 * Sources (priority order):
 * 1. Real process.env with sensitive-looking names
 * 2. ~/.pi/agent/auth.json (pi's own API key store)
 * 3. .env / .env.local / .env.development / .env.development.local
 *
 * Filtering rules:
 * - Name must match SENSITIVE_NAME pattern
 * - Name must NOT match NEVER_SENSITIVE or SESSION_LIKE_NAME
 * - Value length >= 8
 * - Value must NOT be trivial (true, false, localhost, 3000, etc.)
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { unquote } from "./util.js";
import type { SecretDef } from "./engine.js";
import type { DiscoveryConfig } from "./config.js";

// ── Pattern constants ──────────────────────────────────────────────────────

const SENSITIVE_NAME =
  /(SECRET|TOKEN|PASSWORD|PASSWD|PWD|API[_-]?KEY|APIKEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CLIENT[_-]?SECRET|AUTH|CREDENTIAL|DSN|DATABASE_URL|CONNECTION_STRING|SESSION|COOKIE|SIGNING|ENCRYPT|SALT|BEARER)/i;

const NEVER_SENSITIVE =
  /^(PATH|HOME|SHELL|PWD|OLDPWD|LANG|LC_|TERM|USER|LOGNAME|HOSTNAME|TMPDIR|EDITOR|PAGER|NODE_ENV|NODE_OPTIONS|npm_|PNPM_|COLORTERM|SHLVL|SSH_AUTH_SOCK|SSH_AGENT_PID|__MISE|MISE_|WARP_|XPC_|__CF|SECURITYSESSIONID|TERM_SESSION_ID|_$)/;

/**
 * Pointer-style variables: the value is a file path or config location,
 * not the secret itself (e.g. GOOGLE_APPLICATION_CREDENTIALS=/path/key.json,
 * KUBECONFIG, AWS_SHARED_CREDENTIALS_FILE). Redacting paths mangles output
 * without protecting anything — the file contents are handled separately.
 */
const POINTER_NAME = /(_FILE|_FILES|_PATH|_DIR|_HOME|_LOCATION)$/i;

const SESSION_LIKE_NAME = /(SESSION|SOCK|UUID|_PID)$/i;

const TRIVIAL_VALUE =
  /^(true|false|null|undefined|none|nil|localhost|0|1|3000|8080|development|production|staging|test|testing|changeme|change[_-]?me|password|password1|password123|passw0rd|letmein|qwerty|abc123|example|sample|dummy|placeholder|redacted|secret|token|api[_-]?key|your[_-]?.*|xxx+|<.*>|\$\{.*\}|\.*)$/i;

const MIN_VALUE_LENGTH = 8;

const DOTENV_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
];

const DOTENV_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/;

// ── Predicates ─────────────────────────────────────────────────────────────

function isSensitiveValue(name: string, value: string): boolean {
  if (NEVER_SENSITIVE.test(name)) return false;
  if (POINTER_NAME.test(name)) return false;
  if (SESSION_LIKE_NAME.test(name)) return false;
  if (!value || value.length < MIN_VALUE_LENGTH) return false;
  if (TRIVIAL_VALUE.test(value)) return false;
  return SENSITIVE_NAME.test(name);
}

// ── .env parsing ───────────────────────────────────────────────────────────

function parseDotenv(path: string): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const m = DOTENV_LINE.exec(line);
      if (!m) continue;
      // m[1]=name, m[2]=raw value
      out.set(m[1]!, unquote(m[2]!));
    }
  } catch {
    /* unreadable file, skip */
  }
  return out;
}

// ── Discovery ──────────────────────────────────────────────────────────────

/**
 * pi's own API key store. Parsed on startup so keys stored here are
 * redacted like any other secret.
 */
const AUTH_JSON_PATH = join(homedir(), ".pi", "agent", "auth.json");

function parseAuthJson(): Map<string, string> {
  const out = new Map<string, string>();
  try {
    if (!existsSync(AUTH_JSON_PATH)) return out;
    const raw = JSON.parse(readFileSync(AUTH_JSON_PATH, "utf8"));
    if (!raw || typeof raw !== "object") return out;
    for (const [provider, entry] of Object.entries(raw as Record<string, unknown>)) {
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        if (typeof e.key === "string") {
          out.set(`pi_auth_${provider}`, e.key);
        }
      }
    }
  } catch {
    /* unreadable, skip */
  }
  return out;
}

// ── .netrc parser ──────────────────────────────────────────────────────────

const NETRC_PATH = join(homedir(), ".netrc");
const NETRC_LINE =
  /^\s*(machine|login|password|account)\s+(\S+)\s*$/i;

function parseNetrc(): Map<string, string> {
  const out = new Map<string, string>();
  try {
    if (!existsSync(NETRC_PATH)) return out;
    const text = readFileSync(NETRC_PATH, "utf8");
    let machine = "";
    let login = "";
    for (const line of text.split(/\r?\n/)) {
      const m = NETRC_LINE.exec(line);
      if (!m) continue;
      const [, key, val] = m;
      if (key!.toLowerCase() === "machine") { machine = val!; login = ""; }
      else if (key!.toLowerCase() === "login") { login = val!; }
      else if (key!.toLowerCase() === "password" && val!.length >= 8) {
        const name = login ? `netrc_${machine}_${login}` : `netrc_${machine}`;
        out.set(name, val!);
      }
    }
  } catch {
    /* unreadable, skip */
  }
  return out;
}

// ── AWS credentials parser ─────────────────────────────────────────────────

const AWS_CRED_PATH = join(homedir(), ".aws", "credentials");
const AWS_PROFILE = /^\s*\[([^\]]+)\]\s*$/;
const AWS_KEY = /^\s*(aws_[a-z_]+)\s*=\s*(.+)\s*$/i;

function parseAwsCredentials(): Map<string, string> {
  const out = new Map<string, string>();
  try {
    if (!existsSync(AWS_CRED_PATH)) return out;
    const text = readFileSync(AWS_CRED_PATH, "utf8");
    let profile = "default";
    for (const line of text.split(/\r?\n/)) {
      const pm = AWS_PROFILE.exec(line);
      if (pm) { profile = pm[1]!; continue; }
      const km = AWS_KEY.exec(line);
      if (km && km[2]!.length >= 8) {
        out.set(`aws_${profile}_${km[1]}`, km[2]!);
      }
    }
  } catch {
    /* unreadable, skip */
  }
  return out;
}

// ── Docker config parser ───────────────────────────────────────────────────

const DOCKER_CONFIG_PATH = join(homedir(), ".docker", "config.json");

function parseDockerConfig(): Map<string, string> {
  const out = new Map<string, string>();
  try {
    if (!existsSync(DOCKER_CONFIG_PATH)) return out;
    const raw = JSON.parse(readFileSync(DOCKER_CONFIG_PATH, "utf8"));
    const auths = (raw as Record<string, unknown>).auths;
    if (!auths || typeof auths !== "object") return out;
    for (const [reg, entry] of Object.entries(auths as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue;
      const auth = (entry as Record<string, unknown>).auth;
      if (typeof auth !== "string" || auth.length < 8) continue;
      // Decode base64 to extract user:password
      try {
        const decoded = Buffer.from(auth, "base64").toString("utf8");
        // Only capture if has credentials (user:pass format)
        if (decoded.includes(":") && decoded.length >= 8) {
          out.set(`docker_auth_${reg}`, decoded);
        }
      } catch {
        /* invalid base64, skip */
      }
    }
  } catch {
    /* unreadable, skip */
  }
  return out;
}

// ── Generic JSON parser ────────────────────────────────────────────────────

function parseJsonFile(path: string, keys?: string[]): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (keys && keys.length > 0) {
      // Extract only specified keys
      const obj = raw as Record<string, unknown>;
      for (const key of keys) {
        const val = obj[key];
        if (typeof val === "string" && val.length >= 8) {
          out.set(key, val);
        }
      }
    } else {
      // Extract all string values recursively
      collectStrings(raw, "", out);
    }
  } catch {
    /* unreadable, skip */
  }
  return out;
}

function collectStrings(obj: unknown, prefix: string, out: Map<string, string>): void {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      collectStrings(obj[i], `${prefix}_${i}`, out);
    }
    return;
  }
  for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}_${key}` : key;
    if (typeof val === "string" && val.length >= 8) {
      out.set(fullKey, val);
    } else if (val && typeof val === "object") {
      collectStrings(val, fullKey, out);
    }
  }
}

// ── Generic INI parser ─────────────────────────────────────────────────────

const INI_SECTION = /^\s*\[([^\]]+)\]\s*$/;
const INI_KEYVAL = /^\s*([^=]+?)\s*=\s*(.+)\s*$/;

function parseIniFile(path: string): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const text = readFileSync(path, "utf8");
    let section = "";
    for (const line of text.split(/\r?\n/)) {
      const sm = INI_SECTION.exec(line);
      if (sm) { section = sm[1]!; continue; }
      const km = INI_KEYVAL.exec(line);
      if (km) {
        const name = section ? `${section}_${km[1]}` : km[1]!;
        const value = unquote(km[2]!);
        if (value.length >= 8) out.set(name, value);
      }
    }
  } catch {
    /* unreadable, skip */
  }
  return out;
}

/**
 * Discover secrets from process.env, auth.json, credential files, .env files, and user-configured extra files.
 * Priority: env > auth.json > credential files > extra files > dotenv. Sorted longest-value-first.
 */
export function discoverSecrets(cwd: string, discovery: DiscoveryConfig = { disabled: [], extraFiles: [] }): SecretDef[] {
  const byName = new Map<string, { value: string; source: "env" | "auth" | "file" | "dotenv" }>();

  // 1. process.env (highest priority)
  for (const [name, value] of Object.entries(process.env)) {
    if (typeof value === "string" && isSensitiveValue(name, value)) {
      byName.set(name, { value, source: "env" });
    }
  }

  // 2. auth.json (pi's API key store)
  for (const [name, value] of parseAuthJson()) {
    if (!byName.has(name)) {
      byName.set(name, { value, source: "auth" });
    }
  }

  // 3. Static credential files (non-standard key formats, no pattern coverage)
  if (!discovery.disabled.includes("netrc")) {
    for (const [name, value] of parseNetrc()) {
      if (!byName.has(name)) byName.set(name, { value, source: "file" });
    }
  }
  if (!discovery.disabled.includes("aws-credentials")) {
    for (const [name, value] of parseAwsCredentials()) {
      if (!byName.has(name)) byName.set(name, { value, source: "file" });
    }
  }
  if (!discovery.disabled.includes("docker-config")) {
    for (const [name, value] of parseDockerConfig()) {
      if (!byName.has(name)) byName.set(name, { value, source: "file" });
    }
  }

  // 3.5. User-configured extra files
  for (const file of discovery.extraFiles) {
    if (!existsSync(file.path)) continue;
    try {
      switch (file.format) {
        case "dotenv":
          for (const [name, value] of parseDotenv(file.path)) {
            if (isSensitiveValue(name, value) && !byName.has(name)) {
              byName.set(name, { value, source: "file" });
            }
          }
          break;
        case "json":
          for (const [name, value] of parseJsonFile(file.path, file.jsonKeys)) {
            if (!byName.has(name)) byName.set(name, { value, source: "file" });
          }
          break;
        case "ini":
          for (const [name, value] of parseIniFile(file.path)) {
            if (isSensitiveValue(name, value) && !byName.has(name)) {
              byName.set(name, { value, source: "file" });
            }
          }
          break;
        case "raw": {
          const text = readFileSync(file.path, "utf8").trim();
          if (text.length >= 8) {
            const name = file.secretName || file.path.split("/").pop() || "raw_secret";
            if (!byName.has(name)) byName.set(name, { value: text, source: "file" });
          }
          break;
        }
      }
    } catch {
      /* unreadable, skip */
    }
  }

  // 4. .env files (fallback)
  for (const file of DOTENV_FILES) {
    const path = join(cwd, file);
    if (!existsSync(path)) continue;
    for (const [name, value] of parseDotenv(path)) {
      if (isSensitiveValue(name, value) && !byName.has(name)) {
        byName.set(name, { value, source: "dotenv" });
      }
    }
  }

  const entries: SecretDef[] = [];
  for (const [name, { value }] of byName) {
    if (!value) continue;
    entries.push({ name, value });
  }

  // Sort longest first for regex alternation priority
  entries.sort((a, b) => b.value.length - a.value.length);
  return entries;
}
