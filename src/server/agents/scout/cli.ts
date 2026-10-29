// `pnpm scout` (#17): runs the scout on the demo session and prints its resources per language, its
// rejections with their reasons, and the run's cost. The topic is config.demoTopic: set it in the
// shell for one run. A second run with the same topic and languages returns the saved result, from
// the session or, after `rm -rf data/sessions/demo`, from data/cache/scout.

import { loadOmarSeed } from "../../../../demo/seed.ts";
import { DEMO_SESSION_ID } from "../../../../demo/session.ts";
import { config, loadConfig } from "../../../config.ts";
import { createOrchestrator } from "../../orchestrator/orchestrator.ts";
import { loadModels } from "../../providers/models.ts";
import { createProvider, type Provider } from "../../providers/provider.ts";
import { createFileCache, createFileStore } from "../../store/store.ts";
import { createPageFetcher } from "../../tools/fetch-page.ts";
import { runScout, scoutBrief } from "./scout.ts";

// With no topic set, config holds the placeholder default; a paid search for it is wasted.
if (config.demoTopic === loadConfig({}).demoTopic) {
  console.error(
    "No demo topic is set. Set it in the shell for this run (see config/.env.example).",
  );
  process.exit(1);
}

let provider: Provider | undefined;
let modelCalls = 0;
const orchestrator = createOrchestrator({
  store: createFileStore(),
  makeProvider: (onTrace) => {
    provider = createProvider({
      models: loadModels(),
      profile: config.providerProfile,
      apiKey: config.modelApiKey,
      onTrace: (event) => {
        modelCalls++;
        onTrace(event);
      },
    });
    return provider;
  },
});
const pages = createPageFetcher({
  profile: config.providerProfile,
  userAgent: `${config.appName}-scout/0.1 (checks the licence of open learning resources)`,
});
const brief = scoutBrief(loadOmarSeed(config.demoTopic).profile);

console.log(
  `Scout: "${brief.topic}" in ${brief.langs.join(", ")} (profile ${config.providerProfile}, session ${DEMO_SESSION_ID})`,
);
const { resources, rejected } = await runScout({
  orchestrator,
  sessionId: DEMO_SESSION_ID,
  brief,
  pages,
  cache: createFileCache(),
});

console.log(`\nResources: ${resources.length}`);
for (const lang of brief.langs) {
  const inLang = resources.filter((r) => r.lang === lang);
  console.log(`  ${lang}: ${inLang.length}`);
  for (const r of inLang) {
    console.log(`    ${r.score.toFixed(2)}  ${r.licence.spdx} (${r.licence.use})  ${r.title}`);
    console.log(`          ${r.url}`);
  }
}

const reasons = new Map<string, number>();
for (const r of rejected) reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
console.log(`\nRejected: ${rejected.length}`);
for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count} x ${reason}`);
}

const saved = modelCalls ? "" : " (the saved result, from the session or the cache)";
console.log(
  `\nCost: $${(provider?.totalCostUsd() ?? 0).toFixed(4)} over ${modelCalls} model calls${saved}`,
);
