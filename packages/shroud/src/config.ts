/**
 * Config loading for custom patterns, discovery file parsers, and firewall settings.
 *
 * Reads from (merged, project overrides global):
 * - ~/.pi/agent/shroud.json
 * - <cwd>/.pi/shroud.json
 *
 * Full schema:
 * {
 *   // ── Post-detection patterns ──────────────────────
 *   "patterns": [{ "name": "ACME", "regex": "acme-[0-9a-f]{12}", "flags": "i" }],
 *
 *   // ── Pre-discovery ────────────────────────────────
 *   "discovery": {
 *     "disabled": ["netrc", "aws-credentials", "docker-config"],
 *     "extraFiles": ["/path/to/custom.credentials"]
 *   }
 * }
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { CustomPatternDef } from "./engine.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ExtraFileConfig {
  /** Absolute path to the file */
  path: string;
  /** Parser format */
  format: "dotenv" | "json" | "raw" | "ini";
  /** (json only) If set, only extract these keys from JSON. If omitted, extract all string values. */
  jsonKeys?: string[];
  /** (raw only) Secret name for the single-value file. Default: basename of path. */
  secretName?: string;
}

export interface DiscoveryConfig {
  /** Disable built-in file parsers: "netrc", "aws-credentials", "docker-config" */
  disabled: string[];
  /** Extra credential files with custom parser format */
  extraFiles: ExtraFileConfig[];
}

export interface ShroudConfig {
  patterns: CustomPatternDef[];
  discovery: DiscoveryConfig;
}

// ── Paths ──────────────────────────────────────────────────────────────────

const FILENAME = "shroud.json";

function configPaths(cwd: string): string[] {
  return [
    join(homedir(), ".pi", "agent", FILENAME),
    join(cwd, ".pi", FILENAME),
  ];
}

// ── Parsing ────────────────────────────────────────────────────────────────

function parseConfig(raw: unknown): ShroudConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  return {
    patterns: parsePatterns(obj.patterns),
    discovery: parseDiscovery(obj.discovery),
  };
}

function parsePatterns(raw: unknown): CustomPatternDef[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomPatternDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    if (typeof p.regex !== "string" || p.regex.length === 0) continue;
    out.push({
      name: typeof p.name === "string" && p.name.length > 0 ? p.name : "CUSTOM",
      regex: p.regex,
      flags: typeof p.flags === "string" ? p.flags : undefined,
    });
  }
  return out;
}

function parseDiscovery(raw: unknown): DiscoveryConfig {
  if (!raw || typeof raw !== "object") return { disabled: [], extraFiles: [] };
  const d = raw as Record<string, unknown>;
  const disabled = Array.isArray(d.disabled)
    ? d.disabled.filter((x): x is string => typeof x === "string")
    : [];
  const extraFiles = parseExtraFiles(d.extraFiles);
  return { disabled, extraFiles };
}

function parseExtraFiles(raw: unknown): ExtraFileConfig[] {
  if (!Array.isArray(raw)) return [];
  const out: ExtraFileConfig[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const path = typeof f.path === "string" ? f.path : "";
    if (!path) continue;
    const format = f.format as ExtraFileConfig["format"];
    if (!["dotenv", "json", "raw", "ini"].includes(format)) continue;
    out.push({
      path,
      format,
      jsonKeys: Array.isArray(f.jsonKeys)
        ? f.jsonKeys.filter((k): k is string => typeof k === "string")
        : undefined,
      secretName: typeof f.secretName === "string" ? f.secretName : undefined,
    });
  }
  return out;
}

// ── Merging ────────────────────────────────────────────────────────────────

function mergeConfigs(global: ShroudConfig | null, project: ShroudConfig | null): ShroudConfig {
  const patterns: CustomPatternDef[] = [];
  const disabled: string[] = [];
  const extraFiles: ExtraFileConfig[] = [];

  if (global) {
    patterns.push(...global.patterns);
    disabled.push(...global.discovery.disabled);
    extraFiles.push(...global.discovery.extraFiles);
  }
  if (project) {
    patterns.push(...project.patterns);
    disabled.push(...project.discovery.disabled);
    extraFiles.push(...project.discovery.extraFiles);
  }

  return {
    patterns,
    discovery: { disabled, extraFiles },
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

export function loadConfig(cwd: string): ShroudConfig {
  let global: ShroudConfig | null = null;
  let project: ShroudConfig | null = null;

  const paths = configPaths(cwd);
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]!;
    if (!existsSync(path)) continue;
    try {
      const parsed = parseConfig(JSON.parse(readFileSync(path, "utf8")));
      if (parsed) {
        if (i === 0) global = parsed;
        else project = parsed;
      }
    } catch {
      /* unreadable or invalid JSON, skip */
    }
  }

  return mergeConfigs(global, project);
}
