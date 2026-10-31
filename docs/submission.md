# Submission (#33)

The answers for the Meta Global AI Developer Hackathon form, ready to paste. Ahmed reviews every field and submits by hand. The target is Nov 4 23:00 Cairo time, five hours before the Nov 5 04:00 deadline.

The rules were checked in spike #10 with no blocker found, but the form's exact fields are not written up in the repo. Check this list against the live form, and add any field it lacks.

## Fields

| Field             | Answer                                                       | Status                          |
| ----------------- | ------------------------------------------------------------ | ------------------------------- |
| Track             | Indie                                                        | Ready                           |
| Theme             | Build for Your World                                         | Ready                           |
| Project name      | CuraLoom (working name, set in `src/config.ts`)              | Ahmed to confirm the final name |
| Team              | Ahmed Nagdy (solo)                                           | Ready                           |
| Repository        | Public URL after #32                                         | Waiting on #32                  |
| Video             | Link after upload (≤ 3:00, script in `docs/video-script.md`) | Waiting on the Nov 4 recording  |
| Short description | See below                                                    | Ready for review                |
| Long description  | See below                                                    | Ready for review                |
| Meta tools used   | See below                                                    | Ready for review                |

## Short description

An agent for Arabic-speaking adults that finds openly licensed lessons in Russian, Chinese, French and English, turns them into a personal Arabic course with quizzes that gate progress, and coaches the learner back when they stop.

## Long description

Most good learning material is not in Arabic, and adults who study alone drop long courses. The app interviews the learner in their own dialect and learns their goal, background, weekly time and past attempts. A scout agent searches the open web in four languages, and code verifies every source's licence before it is used. Muse Wonder designs a course around the learner's time. Each lesson is written in Arabic beside the source excerpt it explains, with a card for every term and the licence of every excerpt. A quiz gates each lesson at 80%.

When the learner goes quiet, a coach nudges on day 2, offers a lighter week on day 5 and checks in on day 10, within the consent and quiet hours the learner set. A stop word ends the messages for good. When the learner comes back, a five-question recap shows what they still know, and the re-planner proposes a new plan: missed sessions moved, a lighter first week, and a review first if the recap was low. Code makes every change, Muse Spark explains it in Arabic, and nothing changes until the learner accepts.

Every model call and decision shows in a live trace with its cost. The demo runs offline from recorded model answers, and says so on screen.

## Meta tools used

- **Muse Spark 1.3** handles the interview, the scout's web search with citations, lesson and quiz writing, short-answer grading, the coach's messages, and the re-plan's explanation and choice of a new source.
- **Muse Wonder 1.0** designs the course.
- **Arabic quality.** In the #8 eval, both models passed every bar on 30 items: Spark 0.98 and Wonder 1.00.

## Cost

These figures are worked out from token counts and the prices in `config/models.yaml`. They are not billing records, so check them against the Meta console.

- **Recorded demo answers:** 75 recordings, 71 Spark and 4 Wonder calls, plus 32 web searches. Together about $1.83.
- **The #8 Arabic eval:** $1.49, including one discarded run.

## Before submitting

- [ ] The video is uploaded, and its link opens in a private window while signed out.
- [ ] The repository is public (#32), and its README opens with no sign-in.
- [ ] Every field above is checked against the live form.
- [ ] The confirmation page or email is saved as a screenshot in a private place, not in this repo.
