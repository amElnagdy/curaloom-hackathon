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

1. Run `pnpm check`. Its replay tests read all 153 recordings in `demo/fixtures/responses/` and all 58 in `demo/fixtures/pages/`, and a test fails when its request has no recording. The chain test in `src/server/agents/intake/intake.test.ts` replays the demo's path from the interview to the comeback, with the scout, the lessons, the quizzes and the diagrams, once for each placement level on that level's own recordings.
2. Run `pnpm build`, then `pnpm e2e`. It clicks through the presenter steps in `docs/demo.md`, from the intake to lesson 2's diagram, on its own replay server, once for each level the short check can give, each on its own recordings: «لا أعرف بعد» three times, two right and all three right. It also leaves the path where replay keeps the learner on it, at the beginner's level and the intermediate one. It fails on any request with no recording ("The scripted walk" in `docs/demo.md`). CI runs it too. The tests wire each agent themselves, and the app wires it again in its route handlers under `src/app/api/`. Only a walk checks the requests the app makes.
3. Walk the presenter steps by hand on `pnpm demo:replay` for what the scripted walk does not check: the voice chip, the pace and how the pages look. Walk the advanced placement too (all three right in step 3), which shows another plan and no diagrams. No red banner may name a missing recording.

**If a re-record cannot be avoided.** It needs `MODEL_API_KEY`, live calls, and a decision from Ahmed, the owner.

- Follow "Re-recording" in `docs/demo.md`. Set the key in `.env`, run `pnpm fixtures:record`, then `pnpm fixtures:prune`, check the new files for the key and the learner id, and walk the presenter steps on `pnpm demo:replay`. A new topic also records the scout with `PROVIDER_PROFILE=record` and `pnpm scout`.
- `pnpm fixtures:record` calls the models only for requests that have no recording, so a re-record pays only for those. The whole set of 153 recordings cost about $4.17, worked out from token counts, not from billing (`docs/submission.md`). The 88 recorded before #98 cost $2.05, the advanced path's 30 $0.94 and the intermediate path's 35 $1.18. A change early in the chain, such as the interview's prompt, can change the saved profile, and with it every request after it. That costs close to the whole set (`docs/demo.md`, "Voice in replay").
- The recorded calls on the demo's path took about 5 minutes in all (`docs/demo.md`, "Pace"). A full re-record takes longer than that, before the walk.

**No hash guard.** #47 offered an optional test that fails when the SHA-256 of the frozen files changes. The repository leaves it out on purpose. It would fail on edits the freeze allows, such as post-processing code under `src/server/agents/**`. The replay tests already fail on any request of theirs that has no recording, so the check that matters is a replay of the journey.

## Make the public copy from a fresh clone

- [x] **Choose how to publish. Owner: Ahmed.** Done on 2026-11-04: a fresh clone of `main` at `9404d15` was pushed to the new public repository https://github.com/amElnagdy/curaloom-hackathon, and this one stays private. Recommendation was: create a new public repository and push a fresh `git clone` of this one to it. Keep this repository private.
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
- [x] **Scan again on the final commit, right before the push. Owner: whoever publishes.** On 2026-11-04, on a fresh clone at `9404d15`, both scans reported `no leaks found` (249 commits; 8.86 MB of files). In a fresh clone, run `gitleaks git . --redact` and `gitleaks dir . --redact`. Both must report `no leaks found`.

## A fresh clone runs the replay demo with no key

- [x] **Clone, install and replay.** On 2026-10-31, in an empty folder, with no `.env` and `MODEL_API_KEY` unset:
  1. `git clone https://github.com/amElnagdy/curaloom.git` checked out `f780c93`.
  2. `pnpm install --frozen-lockfile --store-dir <empty folder>` downloaded all 65 packages from the registry and finished in 18.1 s.
  3. The replay build ran the same steps as `pnpm demo:replay`. It called `demoServer("replay", env)` from `demo/run.ts`, emptied `.preview-data/` and ran `next build` with the server's settings: `PROVIDER_PROFILE=replay`, `DEMO_TOPIC="Excel pivot tables for data analysis"`, `REPLAY_LATENCY=0.3`. The build passed and generated 13 static pages.
  4. `next start -H 127.0.0.1 -p 3111` printed `Ready in 70ms`. `pnpm demo:replay` then always used port 3107, and another server held that port during the check, so the check used port 3111. Since #63, `DEMO_PORT=3111 pnpm demo:replay` does steps 3 and 4 in one command.
  5. `curl http://127.0.0.1:3111/intake` returned HTTP 200 and 35,111 bytes, titled `المقابلة | CuraLoom`, with the «ردود مسجّلة» `REPLAY` badge.
  6. `pnpm check` in the same clone passed: lint, typecheck, and 762 tests in 45 files.
- [x] **Install from a ZIP download.** GitHub's "Download ZIP" gives a folder with no `.git`. There, `pnpm install` failed with exit code 128, because the `prepare` script ran `git config core.hooksPath .githooks`. Fixed in `package.json`: the script now ends with `|| exit 0`. The same install then passes. A clone still gets the pre-commit hook.
- [ ] **Run the check again on the final commit. Owner: whoever publishes.** In a fresh clone, run `pnpm install --frozen-lockfile`, then `pnpm demo:replay`. If another server holds port 3107, add `DEMO_PORT=3111` (any free port), and the command says so before it builds. When it prints `Ready`, `curl http://127.0.0.1:<port>/intake` must return HTTP 200 with the «ردود مسجّلة» `REPLAY` badge. Then run `pnpm check`. Since #43 the Noto fonts ship in `src/app/fonts/`, so the build needs no network.

## A fresh clone runs the live journey in under 10 minutes (#41)

- [ ] **Time the live path. Owner: whoever fixes #124.** On 2026-11-03, on a fresh clone of `75dacca` (macOS, Node 24.14.0), with `MODEL_API_KEY` set and `DEMO_PORT=3111`, the path from `pnpm demo:live` to passing lesson 1's quiz took 12 m 03 s (10 m 52 s without a 71 s wait before the walk), then 10 m 10 s. The cost was $0.91, then $0.75. The build took 13 s, then 9 s. One call hung until its 120 s timeout, failed calls made the scout step run again, and the topic check rejected one plan. These added 1 to 3 minutes each, so both runs missed the target. #124 has the stage times and the code-only options. After its fix, time the path again and update "Measured live run" in `README.md`.

## Personal data

- [x] **No local paths, phone numbers or personal email addresses.** No tracked file and no commit in `git log --all -p` contains `/Users/`, `/home/`, `/private/tmp` or `LocalSites`. Nothing matches a phone number. The only email addresses are public ones inside recorded third-party pages (`info@libretexts.org` in `demo/fixtures/pages/biz.libretexts.org-66e7ea6863fe7711.json:9` and `biz.libretexts.org-b9f4e01f9ca71aa3.json:9`, `python-announce-list@python.org` in `docs/spikes/api-access.results.json:979`) and `example.com` and `example.org` placeholders in tests.
- [ ] **The owner's name. Owner: Ahmed.** Recommendation: keep it. The name is already public on the GitHub profile and in every commit, and each mention records a human decision. Where it appears:
  - `docs/submission.md:14` gives the full name, "Ahmed Nagdy (solo)". The file is covered under internal notes.
  - "Ahmed" appears in `PRODUCT.md:61`, `DESIGN.md:136` and `:280`, `.impeccable/design.json:129` and `:154`, `.impeccable/surfaces/src-app-layout-tsx.md:21`, `docs/spikes/DECISIONS.md:5`, `:6` and `:8`, `docs/spikes/api-access.md:3` and `:150`, `docs/spikes/arabic-eval.md:3`, `:54`, `:69`, `:77`, `:79` and `:81`, and `docs/submission.md:3` and `:13`.
- [ ] **Where the owner works from. Owner: Ahmed.** Cairo and Egypt appear in `docs/spikes/api-access.md:1`, `:3`, `:7`, `:11`, `:150` and `:153`, `docs/spikes/DECISIONS.md:5`, `docs/spikes/arabic-eval.md:21` and `docs/submission.md:3`. Recommendation: keep them. The hackathon deadline is already given in Cairo time.
- [x] **The persona is fictional.** Omar, an accountant in Riyadh, appears in `PRODUCT.md:11`, `docs/video-script.md:11` and `demo/script.ts:12`. The seed `demo/fixtures/omar.json` is written for the demo, and its four resources point at `example.org`.
- [x] **Names in third-party credits stay.** `THIRD_PARTY_NOTICES.md` names authors such as Lumen Learning and Gabrielle Brixey, because their licences require the credit.

## Internal notes

None of these blocks the release. Each one needs a keep or drop decision from Ahmed. The recommendation comes first.

- [ ] `docs/submission.md`, the whole file. It was added in `f780c93` while this check ran. It holds the form answers, the submission target time and a note to save the confirmation "in a private place". Recommendation: leave it out of the public copy until the form is submitted.
- [ ] `docs/spikes/api-access.md:153` keeps the agent's original note asking Ahmed to confirm that the Geographic Use Policy allows use from Egypt, and say "The spike tried no workaround, such as a VPN". Recommendation: keep the resolution on line 150 and drop the original note.
- [ ] `docs/spikes/DECISIONS.md:8` says the detailed rules answers "are not yet written up in `rules.md`", a file that does not exist. Line 7 is the pending spike #9 with no data. Recommendation: drop the `rules.md` sentence and mark #9 as not run.
- [ ] `docs/agents/domain.md`, `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md` configure agent skills for the private tracker. Their text is adapted from `mattpocock/skills` (MIT licence), which `docs/agents/triage-labels.md:5` names. Recommendation: drop the folder from the public copy, and drop `AGENTS.md:33` to `:45`, the "Agent skills" section that points at it. If they stay, credit `mattpocock/skills` and its MIT licence in `THIRD_PARTY_NOTICES.md`.
- [x] `AGENTS.md:30` names the chosen licence, Apache-2.0 (#39).
- [ ] `docs/video-script.md:3` and its "Before recording" section hold the shot-list date and the presenter setup. Recommendation: keep. The file documents the demo.
- [ ] `PRODUCT.md:45` and `.impeccable/surfaces/src-app-layout-tsx.md:10` name the hackathon, the video length and the judges. `PRODUCT.md`, `DESIGN.md` and `.impeccable/` are the design briefs that ADR-007 links. Recommendation: keep.
- [ ] `docs/adr/0007-ui-css-modules-icons-fonts.md:7` and `.impeccable/surfaces/src-app-layout-tsx.md:21` name the branch `prototype/15-shell`. `docs/architecture.md:121` and `src/app/_shell/demo-bar.tsx:3` name `prototype/23-demo-bar`. A new repository lacks those branches. Recommendation: push both branches to the public repository, or accept the dead references.
- [x] `docs/spikes/arabic-eval.md:77` to `:93`, the spot-check table, records the human review behind the eval scores. Keep.
- [x] `docs/spikes/api-access.results.json` keeps the API's rate-limit headers, for example at lines 23 and 82: 3000 requests and 4,000,000 tokens. They show the account's limits, not a credential. Keep.

## Material from other competitions or markets

- [x] **None in the tree or the history.** No tracked file and no commit in `git log --all -p` matches Dubai, دبي, UAE, Emirates, competition, Devpost, lablab or Kaggle. The one place-specific detail is the persona's city, Riyadh, which is product content.
- [ ] **The GitHub issues.** All 37 issue bodies repeat "No Dubai/market-specific work" in their shared context block. They stay private if the public copy is a new repository, as recommended above.

## Licence

- [x] **Choose the project licence. Owner: Ahmed.** Ahmed chose Apache-2.0 on Nov 1 (#39). It conflicts with no dependency, because the repository ships no dependency code.
  1. `LICENSE` at the repository root holds the text of https://www.apache.org/licenses/LICENSE-2.0.txt unchanged (SHA-256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`).
  2. `package.json` sets `"license": "Apache-2.0"` and keeps `"private": true`.
  3. `README.md`'s "Licence" section names the licence and the copyright holder, and `AGENTS.md:30` names the licence.
  4. `README.md`, `LICENSE-CONTENT.md` and `demo/fixtures/LICENSE.md` say that the licence does not cover the third-party text in `demo/fixtures/` or the model output built on it. The next section explains why.

## Third-party notices

- [x] **`THIRD_PARTY_NOTICES.md` is generated.** `pnpm notices` (`scripts/notices.ts`) writes it from `package.json`, `pnpm licenses list`, `pnpm-lock.yaml`, `src/app/layout.tsx`, the `lucide-react` imports in `src/`, and `demo/fixtures/`. It writes the same file on every system, and CI fails when the committed file is out of date. Since #116 it also writes `ATTRIBUTION.md`, and CI checks that file too. The notices list:
  - 13 direct dependencies with their versions and licences, the 60 packages pnpm installs on every system by licence, and the 72 platform binaries in the lockfile by family;
  - the three Noto fonts, under OFL-1.1;
  - lucide-react under ISC, with the 18 icons in use that Lucide marks as derived from Feather, under MIT;
  - the 14 recorded source pages, each with its licence, its licence statement and the app's credit line.
- [x] **Licences to know about in the installed packages.** The libvips binaries, such as `@img/sharp-libvips-linux-x64`, are LGPL-3.0-or-later, and sharp's Windows and WebAssembly builds bundle libvips too. They come with `sharp`, an optional dependency of `next`, and the app does not import `next/image`. `caniuse-lite` is CC-BY-4.0 data, and `lightningcss` is MPL-2.0. The repository ships none of them. They matter only to someone who ships a build.
- [x] **The credit line has one source.** The lesson page and the notices script both call `creditLine()` from `src/app/_shell/format.ts`.
- [ ] **Run `pnpm notices` again before publishing. Owner: whoever publishes.** Run it after any dependency, font, icon or fixture change. CI runs it too and fails when either committed file differs.

## Fixture content licences

`demo/fixtures/pages/` holds the text of 14 third-party pages. The scout's licence checker finds 10 under CC BY-SA 4.0 (Wikipedia, Wikibooks and Wikiversity, in English, French, Russian and Chinese), 1 under CC BY 4.0, 1 under CC BY-NC-SA 4.0 and 2 under MPL-2.0. `THIRD_PARTY_NOTICES.md` lists each one. Since #28, the folder also holds the HTML of 7 of those pages, which the diagrams agent reads for figures, and 2 public domain images from Wikimedia Commons with their file pages, plus the file pages of 3 images the agent skips for their licences. The notices list those too. The intermediate and advanced recordings (#98) added 21 page files, none of them NonCommercial or NoDerivatives.

- [ ] **One page is NonCommercial. Owner: Ahmed.** "7.2: PivotTables for Data Analysis" by Gabrielle Brixey on LibreTexts (`demo/fixtures/pages/biz.libretexts.org-b9f4e01f9ca71aa3.json`) is CC BY-NC-SA 4.0. No recorded lesson quotes it, but the replayed scout reads it to check its licence, so deleting the file breaks `pnpm demo:replay`. A public, non-commercial repository that credits the author fits the licence's terms. The organizers' perpetual licence over the submission may count as commercial use. Recommendation: keep it with the notice, unless Ahmed reads the hackathon terms as commercial. The alternative is to record the scout again, live, so it is not cited, and then record the chain again.
- [ ] **The pages are full copies, not excerpts.** The issue asks for "only openly licensed excerpts with attribution". Each file holds the whole page text, because replay runs the licence check on it again. Recommendation: keep the full text. The notices give the attribution.
- [x] **The MPL-2.0 pages stay.** Two LibreOffice help pages in Chinese are under MPL-2.0. The scout rejects them, because MPL-2.0 is not on its allowlist, but replay needs the files to reach that rejection. MPL-2.0 allows the copy under its own terms, and the notices name the licence.
- [x] **ShareAlike reaches the recordings. Owner: Ahmed.** Ahmed decided on Nov 2 to comply with ShareAlike (#116). 37 recorded calls carry the text of CC BY-SA pages, 22 of them from the intermediate and advanced paths (#98): the lesson-writing calls, and the quiz-writing and answer-check calls that hold the lessons' excerpts. The files hold that text and replies built on it, so they are shared under CC BY-SA 4.0, not the project licence. No recorded call carries the text of the CC BY-NC-SA page or of either MPL-2.0 page.
  - `LICENSE-CONTENT.md` says what CC BY-SA 4.0 covers: these recordings, the lessons and quizzes in them, what the demo GIF shows of them, and lessons the app writes from a CC BY-SA source when it runs live. It says what the Arabic changed, and that CC BY-SA does not cover the code.
  - `ATTRIBUTION.md`, which `pnpm notices` writes from the recordings, credits each of the 10 CC BY-SA pages the recordings name, with its authors, link, licence and version, and says whether the recordings adapt it. It lists the 37 calls with the pages each one adapts, and the 29 other Wikipedia, Wikibooks and Wikiversity pages that the search replies only link to. A grep for links to those projects across `demo/fixtures/responses/` finds the same 39 pages. CI fails when the file is out of date.
  - `README.md`'s "Licence" section and `demo/fixtures/LICENSE.md` point to both files.
  - The lesson page already shows each source's licence beside its link, copies its credit line, and says when the Arabic explanation carries a ShareAlike licence.
- [ ] **Publishing model output. Owner: Ahmed.** The 153 recordings in `demo/fixtures/responses/`, the eval results in `evals/arabic/` and `docs/spikes/api-access.results.json` hold Muse model output. Check that the Meta Model API terms allow publishing it.
- [ ] **The README GIF shows source text. Owner: Ahmed.** `docs/media/demo.gif` shows CC BY-SA 4.0 excerpts of three Wikipedia articles and the Arabic lesson and quiz written from them. The French «Tableur» card shows its badge but is cut off before its source line. The Russian «Сводная таблица» card shows its source line, and the English "Pivot table" card shows its badge. The GIF also shows one public domain diagram, the pivot table, in its Arabic and original views. Recommendation: keep it. Apache-2.0 does not cover CC BY-SA text, so `README.md`'s "Licence" section names the three articles and says that material stays under CC BY-SA 4.0.
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
