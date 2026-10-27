# AGENTS.md

## Setup and checks

```sh
pnpm install
cp config/.env.example .env   # add MODEL_API_KEY for live calls
pnpm check                    # lint, typecheck, test: run before every commit
pnpm dev
```

CI (`.github/workflows/ci.yml`) runs the same checks plus `pnpm build`, with no secrets.

## Conventions

Read `docs/architecture.md` for the component map and layout, and the ADRs in `docs/adr/` that touch your area, before changing code.

- **Config:** read settings only through `src/config.ts`. The product name and demo topic are not final; take them from `config.appName` and `config.demoTopic`. `src/config-guard.test.ts` enforces this.
- **Models:** call models only through the provider layer (ADR-002), by role. Feature code imports no model SDK.
- **Time:** take time only from the clock module (ADR-004).
- **Trace:** every model call and tool call emits a trace event with `summary_ar` and `summary_en`.
- **Secrets:** keys come from `.env` only. Keep them out of code, fixtures, traces and logs.
- **Language:** learner-facing text is Arabic. Code, identifiers, commits and docs are English.
- **Tests:** Vitest, next to the code as `*.test.ts`. Test behaviour through the module's public interface.
- **Decisions:** record a hard-to-reverse choice as a new ADR in `docs/adr/`.
- **Licence:** the repo has no `LICENSE` file yet. #32 picks one before the public copy; the placeholder default is MIT or Apache-2.0.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for amElnagdy/curaloom (`gh` CLI); epics use native sub-issues, dependencies use native blocked-by links. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
