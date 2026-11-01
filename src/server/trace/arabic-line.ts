// The rule for a trace event's Arabic line (#59, DESIGN.md «Trace Drawer»), which the tests of every
// module that traces check each summary_ar against. The line has Arabic, no raw id, and no foreign
// word except a model id, a tool name, a URL or a host. Search queries, image file names, licence
// ids and glossary labels stay in summary_en, which the drawer shows just below.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadModels } from "../providers/models.ts";
import { createFileStore } from "../store/store.ts";
import type { TraceEvent } from "./trace.ts";

// The ids the English line carries: events, the learner, model roles, coach rungs, step keys,
// lessons, quizzes, resources and hashes.
const RAW_ID =
  /\b(evt_\d|l_[a-z]|agent_default|[a-z]+_a\d+_d\d|coach_d\d|(intake|scout|architect|replan|lesson|quiz|grade|diagrams|coach):\S|L\d+\b|q_L\d|r_[0-9a-f]{8}|[0-9a-f]{12})/;

const TOOLS = ["fetch_page", "fetch_image", "web_search", "licence_check"];

// A host as `new URL(…).host` gives it. An image file name has the same shape, so its extension
// rules it out.
const HOST = /^([a-z0-9-]+\.)+[a-z]{2,}$/;
const FILE_EXTENSION = /\.(png|jpe?g|gif|svg|webp|tiff?|pdf)$/i;
const WEB_ADDRESS = /^https?:\/\/\S+$/;
const FOREIGN_LETTER = /(?!\p{Script=Arabic})\p{L}/u;

let named: ReadonlySet<string> | undefined;
const namedWords = () => {
  named ??= new Set([...Object.values(loadModels().roles).map((r) => r.model), ...TOOLS]);
  return named;
};

const allowed = (word: string) =>
  namedWords().has(word) ||
  (HOST.test(word) && !FILE_EXTENSION.test(word)) ||
  WEB_ADDRESS.test(word);

// What keeps `line` from being an Arabic trace line, one problem per entry; none when it is one.
export function arabicLineProblems(line: string): string[] {
  const problems: string[] = [];
  if (!/\p{Script=Arabic}/u.test(line)) problems.push("no Arabic letter");
  for (const token of line.split(/[\s«»()،؛,]+/)) {
    const word = token.replace(/^\p{P}+|\p{P}+$/gu, "");
    if (RAW_ID.test(word)) problems.push(`raw id ${word}`);
    else if (FOREIGN_LETTER.test(word) && !allowed(word)) problems.push(`foreign word ${word}`);
  }
  return problems;
}

// Every trace event of every session in a data folder, such as one a test made.
export function tracedIn(root: string): TraceEvent[] {
  const sessions = join(root, "sessions");
  if (!existsSync(sessions)) return [];
  const store = createFileStore(root);
  return readdirSync(sessions).flatMap((id) => store.readTrace<TraceEvent>(id));
}
