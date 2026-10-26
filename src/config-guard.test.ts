import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");
const SCANNED_DIRS = ["src", "contracts", "evals", "demo"];
const CONFIG_MODULE = "src/config.ts";
const FORBIDDEN = [/\bAPP_NAME\b/, /\bDEMO_TOPIC\b/, /CuraLoom/i];

function sourceFiles(dir: string): string[] {
  const path = join(ROOT, dir);
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name))
    .map((e) => relative(ROOT, join(e.parentPath, e.name)));
}

it("defines APP_NAME and DEMO_TOPIC only in the config module", () => {
  const offenders = SCANNED_DIRS.flatMap(sourceFiles)
    .filter((file) => file !== CONFIG_MODULE)
    .filter((file) => FORBIDDEN.some((re) => re.test(readFileSync(join(ROOT, file), "utf8"))));

  expect(offenders).toEqual([]);
});
