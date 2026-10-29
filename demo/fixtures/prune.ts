// `pnpm fixtures:prune` deletes the recorded model responses that no test replays. A fixture is
// named by a hash of its request, so a changed prompt or contract leaves the old one behind. It runs
// the tests with every fixture read logged, then deletes the fixtures nothing read. A fixture only
// the app needs (a demo run) survives only if a replay test reads it.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FIXTURES = join(process.cwd(), "demo/fixtures/responses");

const work = mkdtempSync(join(tmpdir(), "fixtures-prune-"));
const log = join(work, "read.txt");
const preload = join(work, "log-reads.cjs");
writeFileSync(
  preload,
  `const fs = require("node:fs");
const read = fs.readFileSync;
fs.readFileSync = function (path, ...rest) {
  if (String(path).includes("fixtures/responses/")) {
    fs.appendFileSync(${JSON.stringify(log)}, String(path).split("/").pop() + "\\n");
  }
  return read.call(this, path, ...rest);
};
`,
);

// In replay: a recording run would call the model. Forked workers each load the preload.
const { RECORD_FIXTURES: _, ...env } = process.env;
const run = spawnSync(
  "pnpm",
  ["exec", "vitest", "run", "--pool=forks", "--exclude", ".claude/**"],
  { stdio: "inherit", env: { ...env, NODE_OPTIONS: `--require "${preload}"` } },
);
const read = new Set(existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []);
rmSync(work, { recursive: true, force: true });

if (run.status !== 0) {
  console.error("The tests failed, so no fixture was deleted.");
  process.exit(1);
}
// No read at all means the log missed the provider, not that every fixture is stale.
if (read.size === 0) {
  console.error(
    "No fixture read was logged, so none was deleted. Does replay still use readFileSync?",
  );
  process.exit(1);
}

const stale = readdirSync(FIXTURES).filter((name) => !read.has(name));
for (const name of stale) rmSync(join(FIXTURES, name));
console.log(
  stale.length
    ? `Deleted ${stale.length} fixture(s) no test replays:\n${stale.join("\n")}`
    : `All ${read.size} fixtures are replayed by a test; none deleted.`,
);
