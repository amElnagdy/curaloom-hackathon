# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is an Arabic-speaking adult learning a new professional skill around a job. The persona is Omar, 28, an accountant in Riyadh moving into junior data analysis.

- **Time:** about 5 hours a week.
- **Languages:** speaks Gulf Arabic and reads English.
- **History:** has dropped online courses (Coursera) before.

His job is to learn the skill well enough to change roles, in Arabic, from the best material available in any language, and to actually finish.

He uses the product on both devices:

- **Laptop:** study sessions, lessons and the plan.
- **Phone:** coach messages and quick check-ins.

Design decisions serve the learner first.

## Product Purpose

The product finds openly licensed learning resources in English, Russian, Chinese and French and builds the learner a personal course in Arabic. The course has:

- a plan;
- lessons shown side by side with the original source excerpt;
- a bilingual glossary;
- quizzes that gate progress at 80%.

A coach notices when the learner goes quiet, chases him within the limits he set, and re-plans when life gets in the way. Success means the learner keeps going and passes lessons. It does not mean the learner finished reading material.

## Positioning

Arabic speakers get a course assembled for them from open sources in other languages, not a translation of one course. Every lesson keeps the original excerpt, its source and its licence beside the Arabic. A coach adapts the plan to the learner's real week instead of leaving him to drop out.

## Operating Context

- Lessons, quizzes and the plan are done in study sessions on a laptop. Coach messages and short recaps arrive on the phone.
- The learner sets the boundaries: weekly hours, quiet hours (Omar asked for no morning messages), and opt-out at any time. The word "توقف" always stops messages.
- The product is first shown in the Meta Global AI Developer Hackathon (Indie track). The demo video is 3 minutes at 1080p, recorded on Nov 4 2026. The demo runs from recorded model responses (replay mode) with a simulated clock and a simulated phone inbox. A trace panel shows what the agents are doing. This demo layer is secondary to the learner's experience and must not crowd it.

## Capabilities and Constraints

- Agents: intake, scout, architect, lesson builder, examiner, coach. All model calls go through Meta's models via one provider layer (Muse Spark 1.3 and Muse Wonder 1.0).
- Every resource needs a licence checked in code and a citation. A model's claim that a licence was verified does not count.
- The interface is right-to-left Arabic, and it must show embedded English, Russian and Chinese text correctly (bidirectional isolation).
- Messages are sent only through a simulated channel. No real messages go to learners.
- **Open decisions:**
  - The product name is not final. "CuraLoom" is a working name, read from config and never hardcoded.
  - The demo topic is not decided. It is read from config.

## Brand Commitments

- **Voice:** learner-facing text is simple Modern Standard Arabic everywhere, including coach messages. The product understands dialect input (Gulf, Egyptian) but answers in MSA.
- **Name:** no logo or name is committed yet (see the open decisions above).

## Evidence on Hand

- `demo/fixtures/omar.json` holds a seeded learner session: profile, consent, plan, lesson, glossary, quiz, attempt, mastery and a coach event.
- `demo/fixtures/responses/` holds real recorded model outputs for each agent-output contract.
- `docs/spikes/arabic-eval.md` records Arabic quality results for Spark and Wonder.
- None of the following exist yet: real users, testimonials, usage metrics, partner institutions or press. Do not fabricate them.

## Product Principles

1. **Learner first.** Every screen serves Omar's next step. Demo and agent machinery stay available but secondary.
2. **Show the source.** Arabic explanations sit beside the original excerpt, its language, locator and licence. Nothing is presented without provenance.
3. **Respect his time and boundaries.** Plans fit the hours he has, and messages respect quiet hours and opt-out.
4. **Finishing beats coverage.** Use small committed steps, mastery gates and re-plans instead of long syllabi and guilt.
5. **Arabic first, other languages visible.** Arabic leads. Source-language text stays legible, correctly isolated and clearly secondary.

## Accessibility & Inclusion

- Arabic must be correct in RTL layout, and directional icons must mirror correctly.
- Embedded mixed-direction text must render correctly.
- Arabic body text must be readable on laptop and phone.
- The app shell must reach at least 90 on the Lighthouse accessibility score (#15).
