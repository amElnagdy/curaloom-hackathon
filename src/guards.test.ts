// Repo-wide rules from AGENTS.md that a test can enforce.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SCANNED_DIRS = ["src", "contracts", "evals", "demo"];

function sourceFiles(dir: string): string[] {
  const path = join(ROOT, dir);
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
    .map((e) => relative(ROOT, join(e.parentPath, e.name)));
}

function offenders(forbidden: RegExp[], allowed: (file: string) => boolean): string[] {
  return SCANNED_DIRS.flatMap(sourceFiles)
    .filter((file) => !allowed(file))
    .filter((file) => forbidden.some((re) => re.test(readFileSync(join(ROOT, file), "utf8"))));
}

it("defines APP_NAME and DEMO_TOPIC only in the config module", () => {
  const forbidden = [/\bAPP_NAME\b/, /\bDEMO_TOPIC\b/, /CuraLoom/i];

  expect(offenders(forbidden, (file) => file === "src/config.ts")).toEqual([]);
});

it("calls models only through the provider layer (ADR-002)", () => {
  const forbidden = [/from\s+["'](openai|@openai\/[^"']+)["']/, /api\.meta\.ai/];

  expect(offenders(forbidden, (file) => file.startsWith("src/server/providers/"))).toEqual([]);
});

it("resolves repo files from process.cwd(), since Next.js server bundles have no import.meta.dirname", () => {
  const forbidden = [/import\.meta\.dirname/];

  expect(offenders(forbidden, (file) => file.startsWith("evals/"))).toEqual([]);
});

// Test files are not scanned: they pass fixed dates, e.g. new Date("2026-10-28T16:00:00Z").
it("reads the system time only in the clock module (ADR-004)", () => {
  const forbidden = [/\bDate\.now\s*\(/, /\bnew\s+Date\s*\(\s*\)/];

  expect(offenders(forbidden, (file) => file.startsWith("src/server/clock/"))).toEqual([]);
});

it("sends no real messages: the notifier makes no network calls (ADR-004)", () => {
  const forbidden = [
    /\bfetch\s*\(/,
    /\b(XMLHttpRequest|WebSocket)\b/,
    /from\s+["'](node:)?(http|https|http2|net|tls|dgram)["']/,
  ];

  expect(offenders(forbidden, (file) => !file.startsWith("src/server/notifier/"))).toEqual([]);
});
