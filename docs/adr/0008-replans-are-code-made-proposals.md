# ADR-008: Re-plans are code-made proposals, made once per comeback

**Status:** Accepted (2026-10-31)

## Context

The coach chases a learner who stops studying (#25). When they come back, their plan is out of date: sessions sit on days that have passed, and a learner back after ten days rarely manages a full week. #26 asks for a lighter first week, shorter sessions or another source, and #27 asks for a short recap before the plan changes.

A plan change touches what the learner sees on every page: the week strip, the road, the lessons and the quiz gate. A model can lay out a plan, but its layout has to be checked against every plan rule and still needs a code fallback when it fails. A plan that changes without the learner's say also breaks the trust the coach is trying to win back.

## Decision

- **Code makes every change.** `replan()` in `src/server/agents/architect/replan.ts` is pure. It keeps the sessions of passed lessons before today as history, and lays the lessons not yet passed again from today in order. A review of the lesson the recap flags comes first. The first week back takes at most 60% of the first version's lightest week, and each of its sessions at most 20 minutes. Days still count from day 0 of the course, so a module that needs more days grows and the modules after it move back. The result passes every plan rule plus the re-plan rules (`replanViolations`), or it is refused.
- **The diff is data.** Each version carries `diff` (`PlanChange`: review, move, shorten, switch, drop, extend), computed from the version before it. Pages build their change lines from it in code.
- **Spark writes only the explanation.** The `replan` role gets a brief of facts (`ReplanBrief`) with the recap as a band, never a score. `noteViolations` refuses a note that invents numbers. Any failure falls back to `templateNote`. For a switch, Spark may pick the replacement from code's candidates, and code checks the pick.
- **A re-plan is a proposal.** It waits in `SavedPlan.pending` until the learner accepts or rejects it by version. An edit waits too (409).
- **One comeback per anchor.** A check-in reply records what the learner asked for and changes nothing. The comeback is detected once per ladder anchor, on a reply or when the plan page sees them back. It finishes with a recap graded in code (multiple choice only), then a re-plan proposal, and the ladder resets to active from that day.

## Consequences

- Re-plans are deterministic and tested on the recorded plan's worked numbers, with a seeded property test over random plans.
- The demo video can show a plan that changed honestly: the before and after strips and every change come from code, and the words come from Spark.
- A learner can always say no. Rejecting keeps the active version, and the next comeback recomputes from it.
- A model never decides session days or minutes. Giving Spark the layout later means a new writer checked by the same `replanViolations`, not a new data shape.
