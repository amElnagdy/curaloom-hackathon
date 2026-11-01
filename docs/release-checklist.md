# Release checklist (#32)

The checks to pass before the public copy of this repository. A checked item has its evidence. An open item says what it needs and from whom. The last full run was on 2026-10-31, on `main` at `f780c93`, with the changes listed under each item still uncommitted.

## Replay freeze (from Nov 3)

The code freeze starts on Nov 3, 2026, Cairo time (UTC+2). The submission deadline is Nov 5, 2026, at 04:00 Cairo time, which is 02:00 UTC. From the freeze on, the recorded demo must keep working as it was recorded.

Replay finds each recording by a hash of the full request, the API path and the JSON body (`fixtureKey()` in `src/server/providers/provider.ts`). The model, the prompt text, the response schema and every parameter are part of the hash. A change to any of them leaves that request with no recording, and replay fails with `MissingRecording`.

**Do not edit from Nov 3.** Each of these feeds a model request:

- the agents' prompts and instructions under `src/server/agents/**`, and the coach's in `src/server/coach/coach.ts`;
- the contracts and response schemas in `contracts/`;
- `config/models.yaml`, with its models, reasoning effort and `max_output_tokens`;
- the request builders in `src/server/providers/meta.ts`;
- `demo/script.ts`, with the topic, Omar's messages and his short answers;
- `demo/fixtures/`, with the seed `omar.json`, the fetched pages in `pages/` and the recordings in `responses/`;
- `public/demo/omar-intake-1.wav`, whose hash is part of its transcription request.

**Allowed after the freeze.** UI, CSS, docs, the README, tests, the notices, and code that post-processes replies, such as #44's fix for the diagram labels in #38. Post-processing can still change a later request. For example, each lesson's request carries the course glossary so far, and the diagrams agent's reading prompt carries the lesson's glossary terms. The checks below catch that.

**Before merging after Nov 3.** For any change under `src/server/`, `src/app/api/`, `contracts/`, `config/` or `demo/`:

1. Run `pnpm check`. Its replay tests read all 88 recordings in `demo/fixtures/responses/` and all 37 in `demo/fixtures/pages/`, and a test fails when its request has no recording. The chain test in `src/server/agents/intake/intake.test.ts` replays the demo's path from the interview to the comeback, with the scout, the lessons, the quizzes and the diagrams.
2. Walk the presenter steps in `docs/demo.md` on `pnpm demo:replay`, from the intake to lesson 2's diagram. No red banner may name a missing recording. The tests wire each agent themselves, and the app wires it again in its route handlers under `src/app/api/`. Only the walk checks the requests the app makes.

**If a re-record cannot be avoided.** It needs `MODEL_API_KEY`, live calls, and a decision from Ahmed, the owner.

- Follow "Re-recording" in `docs/demo.md`. Set the key in `.env`, run `pnpm fixtures:record`, then `pnpm fixtures:prune`, check the new files for the key and the learner id, and walk the presenter steps on `pnpm demo:replay`. A new topic also records the scout with `PROVIDER_PROFILE=record` and `pnpm scout`.
- `pnpm fixtures:record` calls the models only for requests that have no recording, so a re-record pays only for those. The whole set of 88 recordings cost about $2.05, worked out from token counts, not from billing (`docs/submission.md`). A change early in the chain, such as the interview's prompt, can change the saved profile, and with it every request after it. That costs close to the whole set (`docs/demo.md`, "Voice in replay").
- The recorded calls on the demo's path took about 5 minutes in all (`docs/demo.md`, "Pace"). A full re-record takes longer than that, before the walk.

**No hash guard.** #47 offered an optional test that fails when the SHA-256 of the frozen files changes. The repository leaves it out on purpose. It would fail on edits the freeze allows, such as post-processing code under `src/server/agents/**`. The replay tests already fail on any request of theirs that has no recording, so the check that matters is a replay of the journey.

## Make the public copy from a fresh clone

- [ ] **Choose how to publish. Owner: Ahmed.** Recommendation: create a new public repository and push a fresh `git clone` of this one to it. Keep this repository private.
  - Making this repository public also publishes its 37 issues with their comments, and the `prototype/*` branches. Every issue body carries the shared context block, which lists the judging weights and the line "No Dubai/market-specific work".
  - A copy of the working folder, instead of a clone, would carry `.env` with the live `MODEL_API_KEY`, plus `data/` and `.next/`. Push only from a clone or from `git archive`.
  - The full history passes the secret scan below, so it can go public as it is. The issue asks for a squashed copy only if the scan finds something. Squashing would also drop the commit messages that explain each change.
  - A new repository leaves 314 `#NN` issue references in 119 files pointing at issues that do not exist there. Recommendation: accept that. They still read as labels.

## Secrets

- [x] **History scan.** `gitleaks git . --redact` (gitleaks 8.30.1) on this checkout scanned 110 commits, every local branch included, and found no leaks. On a fresh clone of `origin` it scanned 109 commits and found no leaks. The issue's earlier scan, at `81ee69f`, also found none.
- [x] **Tree scan of what gets published.** `gitleaks dir . --redact` on a fresh clone, before `pnpm install`, scanned 3.02 MB and found no leaks.
- [x] **Tree scan of this working folder.** `gitleaks dir . --redact` here scanned 824 MB and found 17 leaks. Every one is in a git-ignored file that a clone does not carry:
  - `.env:1`, the real `MODEL_API_KEY`. It was never committed, as the history scan shows.
  - 15 in `.next/`, the build output: preview-mode and server-action keys, and 3 false positives on `bandKey` in compiled JavaScript.
  - `.impeccable/questions/seeds/52b02d4b592ba511.json:1`, a design-tool question key, not a secret. `.impeccable/questions/.gitignore` ignores the folder.
- [x] **Recorded responses.** No file in `demo/fixtures/responses/` holds the learner id `l_omar`, and no response body has a `user`, `organization` or `project` field. Bodies keep Meta response ids (`resp_…`), which are not credentials.
- [x] **Commit authors.** All 112 commits on every branch use the GitHub noreply address `7650147+amElnagdy@users.noreply.github.com`.
- [ ] **Scan again on the final commit, right before the push. Owner: whoever publishes.** In a fresh clone, run `gitleaks git . --redact` and `gitleaks dir . --redact`. Both must report `no leaks found`.

## A fresh clone runs the replay demo with no key

- [x] **Clone, install and replay.** On 2026-10-31, in an empty folder, with no `.env` and `MODEL_API_KEY` unset:
  1. `git clone https://github.com/amElnagdy/curaloom.git` checked out `f780c93`.
  2. `pnpm install --frozen-lockfile --store-dir <empty folder>` downloaded all 65 packages from the registry and finished in 18.1 s.
  3. The replay build ran the same steps as `pnpm demo:replay`. It called `demoServer("replay", env)` from `demo/run.ts`, emptied `.preview-data/` and ran `next build` with the server's settings: `PROVIDER_PROFILE=replay`, `DEMO_TOPIC="Excel pivot tables for data analysis"`, `REPLAY_LATENCY=0.3`. The build passed and generated 13 static pages.
  4. `next start -H 127.0.0.1 -p 3111` printed `Ready in 70ms`. `pnpm demo:replay` always uses port 3107, and another server held that port during the check, so the check used port 3111.
  5. `curl http://127.0.0.1:3111/intake` returned HTTP 200 and 35,111 bytes, titled `المقابلة | CuraLoom`, with the «ردود مسجّلة» `REPLAY` badge.
  6. `pnpm check` in the same clone passed: lint, typecheck, and 762 tests in 45 files.
- [x] **Install from a ZIP download.** GitHub's "Download ZIP" gives a folder with no `.git`. There, `pnpm install` failed with exit code 128, because the `prepare` script ran `git config core.hooksPath .githooks`. Fixed in `package.json`: the script now ends with `|| exit 0`. The same install then passes. A clone still gets the pre-commit hook.
- [ ] **Run the check again on the final commit. Owner: whoever publishes.** The build downloads the Noto fonts from Google Fonts, so it needs network once.

## Personal data

- [x] **No local paths, phone numbers or personal email addresses.** No tracked file and no commit in `git log --all -p` contains `/Users/`, `/home/`, `/private/tmp` or `LocalSites`. Nothing matches a phone number. The only email addresses are public ones inside recorded third-party pages (`info@libretexts.org` in `demo/fixtures/pages/biz.libretexts.org-66e7ea6863fe7711.json:9` and `biz.libretexts.org-b9f4e01f9ca71aa3.json:9`, `python-announce-list@python.org` in `docs/spikes/api-access.results.json:979`) and `example.com` and `example.org` placeholders in tests.
- [ ] **The owner's name. Owner: Ahmed.** Recommendation: keep it. The name is already public on the GitHub profile and in every commit, and each mention records a human decision. Where it appears:
  - `docs/submission.md:14` gives the full name, "Ahmed Nagdy (solo)". The file is covered under internal notes.
  - "Ahmed" appears in `PRODUCT.md:61`, `DESIGN.md:136` and `:280`, `.impeccable/design.json:129` and `:154`, `.impeccable/surfaces/src-app-layout-tsx.md:21`, `docs/spikes/DECISIONS.md:5`, `:6` and `:8`, `docs/spikes/api-access.md:3` and `:150`, `docs/spikes/arabic-eval.md:3`, `:54`, `:69`, `:77`, `:79` and `:81`, `docs/video-script.md:35`, and `docs/submission.md:3` and `:13`.
- [ ] **Where the owner works from. Owner: Ahmed.** Cairo and Egypt appear in `docs/spikes/api-access.md:1`, `:3`, `:7`, `:11`, `:150` and `:153`, `docs/spikes/DECISIONS.md:5`, `docs/spikes/arabic-eval.md:21` and `docs/submission.md:3`. Recommendation: keep them. The hackathon deadline is already given in Cairo time.
- [x] **The persona is fictional.** Omar, an accountant in Riyadh, appears in `PRODUCT.md:11`, `docs/video-script.md:13` and `demo/script.ts:12`. The seed `demo/fixtures/omar.json` is written for the demo, and its four resources point at `example.org`.
- [x] **Names in third-party credits stay.** `THIRD_PARTY_NOTICES.md` names authors such as Lumen Learning and Gabrielle Brixey, because their licences require the credit.

## Internal notes

None of these blocks the release. Each one needs a keep or drop decision from Ahmed. The recommendation comes first.

- [ ] `docs/submission.md`, the whole file. It was added in `f780c93` while this check ran. It holds the form answers, the submission target time and a note to save the confirmation "in a private place". Recommendation: leave it out of the public copy until the form is submitted.
- [ ] `docs/spikes/api-access.md:153` keeps the agent's original note asking Ahmed to confirm that the Geographic Use Policy allows use from Egypt, and say "The spike tried no workaround, such as a VPN". Recommendation: keep the resolution on line 150 and drop the original note.
- [ ] `docs/spikes/DECISIONS.md:8` says the detailed rules answers "are not yet written up in `rules.md`", a file that does not exist. Line 7 is the pending spike #9 with no data. Recommendation: drop the `rules.md` sentence and mark #9 as not run.
- [ ] `docs/agents/domain.md`, `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md` configure agent skills for the private tracker. Their text is adapted from `mattpocock/skills` (MIT licence), which `docs/agents/triage-labels.md:5` names. Recommendation: drop the folder from the public copy, and drop `AGENTS.md:33` to `:45`, the "Agent skills" section that points at it. If they stay, credit `mattpocock/skills` and its MIT licence in `THIRD_PARTY_NOTICES.md`.
- [ ] `AGENTS.md:30` says #32 picks the licence. Update it when the licence is chosen.
- [ ] `docs/video-script.md:3`, `:7` and `:58` to `:60` hold the recording date, the presenter setup and a rehearsal plan for Nov 3. Recommendation: keep. The file documents the demo.
- [ ] `PRODUCT.md:45` and `.impeccable/surfaces/src-app-layout-tsx.md:10` name the hackathon, the video length and the judges. `PRODUCT.md`, `DESIGN.md` and `.impeccable/` are the design briefs that ADR-007 links. Recommendation: keep.
- [ ] `docs/adr/0007-ui-css-modules-icons-fonts.md:7` and `.impeccable/surfaces/src-app-layout-tsx.md:21` name the branch `prototype/15-shell`. `docs/architecture.md:121` and `src/app/_shell/demo-bar.tsx:3` name `prototype/23-demo-bar`. A new repository lacks those branches. Recommendation: push both branches to the public repository, or accept the dead references.
- [x] `docs/spikes/arabic-eval.md:77` to `:93`, the spot-check table, records the human review behind the eval scores. Keep.
- [x] `docs/spikes/api-access.results.json` keeps the API's rate-limit headers, for example at lines 23 and 82: 3000 requests and 4,000,000 tokens. They show the account's limits, not a credential. Keep.

## Material from other competitions or markets

- [x] **None in the tree or the history.** No tracked file and no commit in `git log --all -p` matches Dubai, دبي, UAE, Emirates, competition, Devpost, lablab or Kaggle. The one place-specific detail is the persona's city, Riyadh, which is product content.
- [ ] **The GitHub issues.** All 37 issue bodies repeat "No Dubai/market-specific work" in their shared context block. They stay private if the public copy is a new repository, as recommended above.

## Licence

- [ ] **Choose the project licence. Owner: Ahmed.** The placeholder default is MIT or Apache-2.0. Recommendation: MIT. Neither choice conflicts with a dependency, because the repository ships no dependency code, and MIT is the shorter text. Pick Apache-2.0 if an explicit patent grant matters. Then:
  1. Add `LICENSE` at the repository root.
  2. Set `"license"` in `package.json`.
  3. Replace the placeholder in `README.md`'s "Licence" section, and update `AGENTS.md:30`.
  4. In `LICENSE` or `README.md`, say that the licence does not cover the third-party text in `demo/fixtures/` or the model output built on it. The next section explains why.

## Third-party notices

- [x] **`THIRD_PARTY_NOTICES.md` is generated.** `pnpm notices` (`scripts/notices.ts`) writes it from `package.json`, `pnpm licenses list`, `src/app/layout.tsx`, the `lucide-react` imports in `src/`, and `demo/fixtures/`. It lists:
  - 12 direct dependencies with their versions and licences, and all 64 installed packages by licence;
  - the three Noto fonts, under OFL-1.1;
  - lucide-react under ISC, with the 18 icons in use that Lucide marks as derived from Feather, under MIT;
  - the 11 recorded source pages, each with its licence, its licence statement and the app's credit line.
- [x] **Licences to know about in the installed packages.** `@img/sharp-libvips-darwin-arm64` is LGPL-3.0-or-later. It comes with `sharp`, an optional dependency of `next`, and the app does not import `next/image`. `caniuse-lite` is CC-BY-4.0 data, and `lightningcss` is MPL-2.0. The repository ships none of them. They matter only to someone who ships a build.
- [x] **The credit line has one source.** The lesson page and the notices script both call `creditLine()` from `src/app/_shell/format.ts`.
- [ ] **Run `pnpm notices` again before publishing. Owner: whoever publishes.** Run it after any dependency, font, icon or fixture change. The file names the platform it ran on, because optional packages differ by system.

## Fixture content licences

`demo/fixtures/pages/` holds the text of 11 third-party pages. The scout's licence checker finds 8 under CC BY-SA 4.0 (Wikipedia and Wikibooks, in English, French and Russian), 1 under CC BY 4.0, 1 under CC BY-NC-SA 4.0 and 1 under MPL-2.0. `THIRD_PARTY_NOTICES.md` lists each one. Since #28, the folder also holds the HTML of 6 of those pages, which the diagrams agent reads for figures, and 2 public domain images from Wikimedia Commons with their file pages. The notices list those too.

- [ ] **One page is NonCommercial. Owner: Ahmed.** "7.2: PivotTables for Data Analysis" by Gabrielle Brixey on LibreTexts (`demo/fixtures/pages/biz.libretexts.org-b9f4e01f9ca71aa3.json`) is CC BY-NC-SA 4.0. No recorded lesson quotes it, but the replayed scout reads it to check its licence, so deleting the file breaks `pnpm demo:replay`. A public, non-commercial repository that credits the author fits the licence's terms. The organizers' perpetual licence over the submission may count as commercial use. Recommendation: keep it with the notice, unless Ahmed reads the hackathon terms as commercial. The alternative is to record the scout again, live, so it is not cited, and then record the chain again.
- [ ] **The pages are full copies, not excerpts.** The issue asks for "only openly licensed excerpts with attribution". Each file holds the whole page text, because replay runs the licence check on it again. Recommendation: keep the full text. The notices give the attribution.
- [x] **The MPL-2.0 page stays.** The LibreOffice help page in Chinese is under MPL-2.0. The scout rejects it, because MPL-2.0 is not on its allowlist, but replay needs the file to reach that rejection. MPL-2.0 allows the copy under its own terms, and the notice names the licence.
- [ ] **ShareAlike reaches the recordings. Owner: Ahmed.** 15 recorded calls carry the text of CC BY-SA pages: the lesson-writing calls, and the quiz-writing and answer-check calls that hold the lessons' excerpts. The files hold that text and replies built on it, so they carry CC BY-SA 4.0, not the project licence. No recorded call carries the CC BY-NC-SA or the MPL-2.0 page's text. `demo/fixtures/LICENSE.md` states this, and "Recorded model replies" in `THIRD_PARTY_NOTICES.md` lists the files. See step 4 under "Licence".
- [ ] **Publishing model output. Owner: Ahmed.** The 88 recordings in `demo/fixtures/responses/`, the eval results in `evals/arabic/` and `docs/spikes/api-access.results.json` hold Muse model output. Check that the Meta Model API terms allow publishing it.
- [ ] **The README GIF shows source text. Owner: Ahmed.** `docs/media/demo.gif` shows an excerpt of the French Wikipedia article «Tableur» (CC BY-SA 4.0), with its badge and source line, and part of the Russian «Сводная таблица» excerpt. It also shows the two public domain diagrams. Recommendation: keep it, since the frames carry the credit the app writes. If the project licence is not CC BY-SA compatible, say in the notices that the GIF's excerpt stays under CC BY-SA.
- [x] **Project-written fixtures.** `demo/fixtures/omar.json` is written for the demo. `evals/arabic/items.jsonl` cites no source and has no URL, so the items appear to be written for this eval.

## No hardcoded product name outside config

- [x] **Code.** `src/guards.test.ts:24` fails if `APP_NAME`, `DEMO_TOPIC` or "CuraLoom" appears in any non-test `.ts` or `.tsx` file under `src/`, `contracts/`, `evals/` or `demo/`, except `src/config.ts`. `scripts/notices.ts` reads `config.appName`. No recorded request or reply contains the name, so a rename does not break replay.
- [x] **Generated and README text take it from config.** `THIRD_PARTY_NOTICES.md` writes `config.appName`, the same way the app does. `README.md:1`, `:3`, `:5` and `:27` write the name as config has it and say it is a working name.
- [ ] **Docs and metadata that name it. Owner: whoever renames.** A rename has to change each of these:
  - `src/config.ts:56`, the default, and `src/config.test.ts:8` and `:65`;
  - `config/.env.example:7`;
  - `package.json:2`, the package name `curaloom`;
  - `README.md:1`, `:3`, `:5` and `:27`;
  - `DESIGN.md:2` and `:130`, and `.impeccable/design.json:4`;
  - `PRODUCT.md:54`;
  - `docs/submission.md:13`;
  - `AGENTS.md:37`, the repository slug `amElnagdy/curaloom`, and the repository name itself.

  Then run `pnpm notices` to rewrite the credit lines.

## Trace events and logs

- [x] **No new model or tool calls.** This work adds `scripts/notices.ts`, which reads files and runs `pnpm licenses list` and Biome. It calls no model, so it needs no trace events. The tree scan above found no secret in code.
