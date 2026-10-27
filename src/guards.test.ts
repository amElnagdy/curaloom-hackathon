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
