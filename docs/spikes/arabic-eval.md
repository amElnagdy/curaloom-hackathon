# Spike: Arabic quality eval (#8)

**Decision: GO with Spark 1.3 for agent work and Wonder 1.0 for curriculum design (provisional until Ahmed's spot-check).** Both models pass every bar: Spark scores 0.97 overall and Wonder 0.98. Their only shared weak spot is one disputed diacritics item.

## Question

How good is Arabic output from Muse Spark 1.3 and Muse Wonder 1.0 on the tasks the product depends on? Which model should do which task, and what mitigations are needed where a model falls below the bar?

## Method

- **Items:** 30 items in [`evals/arabic/items.jsonl`](../../evals/arabic/items.jsonl). The categories and counts follow the issue: MSA explanation 6, Egyptian dialect 4, Gulf dialect 4, term translation EN/RU/ZH/FR to Arabic 8, diacritics 3, quiz generation 5. None depends on the demo topic.
- **Runner:** [`evals/arabic/run.ts`](../../evals/arabic/run.ts), run with `pnpm eval:arabic --model <model> [--judge <model>] [--only id,id]`.
  - Each item makes one answer call and one judge call on `/responses`.
  - The judge is Spark 1.3. It returns a strict JSON verdict: a score of 0, 0.5 or 1, an `answer_key_error` flag and a reason.
  - Scoring and the pass bars live in [`evals/arabic/eval.ts`](../../evals/arabic/eval.ts), with unit tests. `answer_key_error` counts only for quiz items, where it sets the score to 0. Each item also keeps the judge's raw `judgeScore`.
- **Bars:**
  - Overall at least 0.80.
  - Term translation at least 0.85.
  - Every other category at least 0.80. This is our assumption: #8 sets no bar for these categories.
  - Quiz generation must also have no answer-key errors.
- **Run:** 2026-10-27 from Cairo, standard mode, default reasoning effort.
- **Outputs:**
  - [`results-2026-10-27-muse-spark-1.3.json`](../../evals/arabic/results-2026-10-27-muse-spark-1.3.json) and [`results-2026-10-27-muse-wonder-1.0.json`](../../evals/arabic/results-2026-10-27-muse-wonder-1.0.json). Each has every answer, score and judge reason.
  - A trace JSONL next to each, with one event per model call, carrying latency, usage and cost, and no secrets.
  - **Deviation from the issue:** files are named `results-<date>-<model>.json`, not `results-<date>.json`, so the two models do not overwrite each other. A `--only` run writes a gitignored `-partial` file instead.
  - The Spark file comes from the first version of the runner. That version applied `answer_key_error` to every category, but no Spark item had the flag set, so its scores are unaffected. That version also wrote no `judgeScore` field and no trace summaries.
- Glimmer was not run because no local instance is available. #29 runs a subset later.

## Result

| Category | Bar | Spark 1.3 | Wonder 1.0 |
|---|---|---|---|
| MSA explanation (6) | 0.80 | 1.00 | 1.00 |
| Egyptian dialect (4) | 0.80 | 1.00 | 1.00 |
| Gulf dialect (4) | 0.80 | 1.00 | 1.00 |
| Term translation (8) | 0.85 | 0.94 | 1.00 |
| Diacritics (3) | 0.80 | 0.83 | 0.83 |
| Quiz generation (5) | 0.80, no key errors | 1.00, 0 key errors | 1.00, 0 key errors |
| **Overall (30)** | 0.80 | **0.97, all bars pass** | **0.98, all bars pass** |

| | Spark 1.3 | Wonder 1.0 |
|---|---|---|
| Answer latency, median / p90 | 4.8 s / 8.6 s | 7.4 s / 11.0 s |
| Answer cost, 30 items | $0.126 | $0.421 |
| Reasoning share of answer output tokens | 91% | 86% |

The two saved runs cost **$0.90** in total, judge calls included, with no failed calls. Counting the first Wonder run, which was discarded (see below), the eval cost $1.49.

### Below-bar and partial items

- **`diac-02` (خوارزمية):** both models wrote `خَوَارِزْمِيَّةٌ`, with a fatha on the khā'. The reference is `خُوارِزْمِيَّة`, with a damma.
  - The judge scored it 0.5 for both models ("one diacritic wrong").
  - In the first Wonder run, the judge decided the reference was wrong and set `answer_key_error`. The first runner applied that flag to every category, so the item scored 0 and Wonder's diacritics fell to 0.67. That was a runner bug, which code review caught; the judge was not inconsistent. The runner now ignores the flag outside quiz items, and Wonder was run again.
  - **Ahmed decides which vowel is correct.** If both are accepted, both models score 1.00 on diacritics.
- **`term-08` (apprentissage supervisé), Spark:** answered `التعلم تحت الإشراف`, a literal rendering, and scored 0.5. Wonder gave `التعلم الخاضع للإشراف (Supervised Learning)`.

### Checks beyond the judge

- **Answer keys, checked by the agent rather than the judge:** the agent checked all 30 generated quiz questions (15 per model, from the saved runs) against their passages. Every key is correct and every question can be answered from its passage, so the quiz bar holds independently of the judge.
- **Option position bias:** Spark put the correct answer first in 8 of 15 questions, including all 3 in `quiz-05`, against about 4 expected by chance. Wonder did so in 5 of 15.
- **Lenient judge:** the judge gave 1.0 to 57 of 60 answers. These items are a regression floor for basic Arabic quality. They do not show that one model's Arabic is better than the other's.

## Decision: model per task

| Task | Model | Mitigation |
|---|---|---|
| Intake chat, dialect understanding (#16) | Spark 1.3 | None needed. Both Gulf and Egyptian messages were understood, including the coach-relevant one ("لا تطرشون لي رسايل الصبح": no morning messages). |
| Term translation and glossary (#19) | Spark 1.3 | Always show the source-language term in parentheses after the Arabic term, and make glossary entries the single source of each term's Arabic form. Spark leaves the English out unless told to. |
| Diacritics on key terms (#19) | Spark 1.3 | Diacritise only glossary headwords. Store the tashkeel in the glossary entry once, reviewed by Ahmed for demo terms, and never generate it on the fly in lesson text. |
| Lesson explanations (#19) | Spark 1.3 | None needed. |
| Quiz generation (#20) | Spark 1.3 | Use `json_schema` structured output, shuffle options in code, and validate that each question has exactly one key. |
| Grading and judge (#20, eval) | Spark 1.3 | Keep the rubric and strict JSON verdict. Put `reason` before `score`, so the model reasons before it scores, and spot-check by hand. Scope every verdict flag to the categories it applies to: the judge raised `answer_key_error` on a non-quiz item. |
| Curriculum design (#18) | Wonder 1.0 | Not measured by this eval. Wonder's Arabic matched Spark's here, so the plan stands. Its answers cost about 3.3× Spark's. |

Every category is at or above its bar for the chosen model, so no category needs a mitigation to pass. The mitigations above guard the weak spots seen in this run.

## Spot-check for Ahmed (at least 10 items)

Please read each item's answers in the two results files and fill in the last column. Your judgement is final over the judge's.

| Item | What to check | Judge: Spark / Wonder | Ahmed |
|---|---|---|---|
| `diac-02` | Is خَوارزمية (fatha) acceptable, or only خُوارزمية (damma)? | 0.5 / 0.5 | |
| `diac-03` | Full tashkeel on المتوسط الحسابي | 1 / 1 | |
| `term-04` | تعلم الآلة vs التعلم الآلي for машинное обучение | 1 / 1 | |
| `term-08` | Is التعلم تحت الإشراف acceptable? | 0.5 / 1 | |
| `egy-01` | Understood "الحتة بتاعة الـ loop"? | 1 / 1 | |
| `egy-04` | Reply to the "do I have to finish the whole course" question | 1 / 1 | |
| `gulf-01` | Hours-per-week answer is sensible for Omar | 1 / 1 | |
| `gulf-04` | Understood طرش as "send" | 1 / 1 | |
| `msa-02` | Mean vs median explanation is correct and clear | 1 / 1 | |
| `msa-04` | Overfitting explanation is correct MSA | 1 / 1 | |
| `quiz-03` | Questions on `$A1` and `A$1` are unambiguous | 1 / 1 | |

## Reuse

- **Regression:** re-run `pnpm eval:arabic --model <model>` after any prompt or model change, and compare against the results files.
- **Runner:** since #12 it calls the provider layer, routing `--model` and `--judge` as the roles `eval_answer` and `eval_judge`. Its trace lines are now the provider's trace events. The committed results files predate that change.
- **Planned:** when a demo topic is chosen, add a few items for it.
- **Slide:** the results table above is the Technical-depth slide.
