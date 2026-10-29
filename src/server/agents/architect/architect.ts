// The architect (#18) designs the learner's course: the whole road to their goal as modules of whole
// weeks, and a schedule for the first two weeks only, the part the learner commits to. The
// curriculum model writes a PlanDraft from the learner's brief and the scout's resources. Code
// numbers the lessons and sessions, builds the CoursePlan and checks it against the plan rules; a
// draft that breaks one fails the attempt, and the orchestrator's retry sends the broken rules back.

import {
  CoursePlan,
  type LearnerProfile,
  PlanDraft,
  type Resource,
  validate,
} from "../../../../contracts/index.ts";
import {
  type Agent,
  type createOrchestrator,
  withFeedback,
} from "../../orchestrator/orchestrator.ts";
import { contentHash, type Store } from "../../store/store.ts";
import type { Tracer } from "../../trace/trace.ts";
import {
  applyEdit,
  type Limits,
  type PlanEdit,
  planViolations,
  type Violation,
  weekMinutes,
} from "./rules.ts";

export const COMMITTED_WEEKS = 2;

// All the architect knows about the learner. It has no name or contact field, so neither can reach
// a prompt.
export type ArchitectBrief = {
  topic: string;
  goal: string;
  level: LearnerProfile["diagnostic"]["level"];
  background: string[];
  hours_per_week: number;
  history_notes: string;
  resources: Pick<Resource, "id" | "title" | "lang" | "type" | "why_ar">[];
};

// Only a resource whose licence code verified can enter a course.
export function architectBrief(profile: LearnerProfile, resources: Resource[]): ArchitectBrief {
  const verified = resources.filter((r) => r.licence.verified);
  if (!verified.length) throw new Error("No resource with a verified licence to plan from");
  return {
    topic: profile.topic,
    goal: profile.goal,
    level: profile.diagnostic.level,
    background: profile.background,
    hours_per_week: profile.hours_per_week,
    history_notes: profile.history_notes,
    resources: verified.map(({ id, title, lang, type, why_ar }) => ({
      id,
      title,
      lang,
      type,
      why_ar,
    })),
  };
}

export const limitsOf = (brief: ArchitectBrief): Limits => ({
  budget_minutes: Math.floor(brief.hours_per_week * 60),
  resource_ids: brief.resources.map((r) => r.id),
});

export type ArchitectRun = {
  orchestrator: Pick<ReturnType<typeof createOrchestrator>, "runStep">;
  sessionId: string;
  brief: ArchitectBrief;
};

// The brief names the step, so a second run for the same learner and resources returns the saved
// plan without a model call.
export function runArchitect({
  orchestrator,
  sessionId,
  brief,
}: ArchitectRun): Promise<CoursePlan> {
  return orchestrator.runStep(sessionId, architect, brief, {
    key: `architect:${contentHash(brief)}`,
  });
}

const LAST_DAY = COMMITTED_WEEKS * 7 - 1;

const INSTRUCTIONS = `You design a personal course for an adult Arabic-speaking learner, taught from the openly licensed resources listed. Plan the whole road to the learner's goal as modules in teaching order, each taking whole weeks; the first module starts on day 0, and each next one starts the day the one before it ends. Commit only to the first ${COMMITTED_WEEKS} weeks, days 0 to ${LAST_DAY}: give lessons only to the modules that fall in them, and leave lessons empty for later modules. Every session of a lesson falls within its module's weeks. Each lesson draws on one or more of the listed resources, by id copied exactly, and takes one or more sessions of 20 to 45 minutes. In each week the sessions together take no more than the learner's weekly minutes; a learner who dropped long courses before is better served by short sessions and time to spare. Spread a week's sessions over different days. Write the titles and the rationale in clear Modern Standard Arabic. The rationale tells the learner, in two to four sentences addressed to them, why the plan is shaped this way.`;

const briefLines = (brief: ArchitectBrief) =>
  [
    `Topic: ${brief.topic}`,
    `The learner's goal: ${brief.goal}`,
    `Level: ${brief.level}`,
    `Background: ${brief.background.join(", ") || "not given"}`,
    `Weekly time: ${brief.hours_per_week} hours (${limitsOf(brief).budget_minutes} minutes)`,
    `Notes from the interview: ${brief.history_notes || "none"}`,
    "",
    "Resources (id | language | type | title | why it suits the learner):",
    ...brief.resources.map((r) => `${r.id} | ${r.lang} | ${r.type} | ${r.title} | ${r.why_ar}`),
  ].join("\n");

// Lessons are numbered in road order and sessions by day; a session teaches from its lesson's
// resources.
function planFromDraft(draft: PlanDraft): CoursePlan {
  const lessons = draft.road
    .flatMap((step, module) => step.lessons.map((lesson) => ({ ...lesson, module })))
    .map((lesson, i) => ({ ...lesson, id: `L${i + 1}` }));
  const sessions = lessons
    .flatMap((lesson) =>
      lesson.sessions.map(({ day, minutes }) => ({
        day,
        minutes,
        lesson_id: lesson.id,
        resource_ids: [...new Set(lesson.resource_ids.map((id) => id.trim()))],
      })),
    )
    .toSorted((a, b) => a.day - b.day)
    .map((session, i) => ({ id: `s${i + 1}`, ...session }));
  return {
    id: `plan_${contentHash(draft)}`,
    road: draft.road.map((step) => ({ module: step.title_ar.trim(), weeks: step.weeks })),
    committed: {
      start: "day0",
      weeks: COMMITTED_WEEKS,
      lessons: lessons.map(({ id, title_ar, module }) => ({
        id,
        title_ar: title_ar.trim(),
        module,
      })),
      sessions,
    },
    rationale_ar: draft.rationale_ar.trim(),
    version: 1,
    reason: "initial",
  };
}

const architect: Agent<ArchitectBrief, typeof CoursePlan> = {
  name: "architect",
  output: CoursePlan,
  async run(ctx, brief) {
    const { json } = await ctx.provider.structured({
      role: "curriculum",
      trace: {
        agent: "architect",
        summary_ar: "يصمّم طريق دورتك وجدول أسبوعيك الأولين",
        summary_en: `Designing the road and the first ${COMMITTED_WEEKS} weeks from ${brief.resources.length} resources`,
      },
      instructions: INSTRUCTIONS,
      input: withFeedback(ctx, briefLines(brief)),
      schema: { name: "PlanDraft", schema: PlanDraft },
    });
    const plan = planFromDraft(validate(PlanDraft, json));
    const { budget_minutes } = limitsOf(brief);
    const violations = planViolations(plan, limitsOf(brief));
    if (violations.length) {
      throw new Error(`The plan breaks its rules: ${violations.map((v) => v.en).join("; ")}`);
    }
    const weeks = plan.road.reduce((sum, step) => sum + step.weeks, 0);
    const minutes = weekMinutes(plan);
    ctx.trace({
      kind: "decision",
      summary_ar: `صمّم طريق دورتك: الوحدات ${plan.road.length}، والأسابيع ${weeks}، والجلسات في أسبوعيك الأولين ${plan.committed.sessions.length}، ودقائق كل أسبوع منهما ${minutes.join(" و")} من ${budget_minutes}`,
      summary_en: `Planned ${plan.road.length} modules over ${weeks} weeks; committed ${plan.committed.sessions.length} sessions: ${minutes.map((m, i) => `week ${i + 1}: ${m} of ${budget_minutes} minutes`).join(", ")}`,
    });
    return plan;
  },
};

const PLAN_DOC = "plan";

// The session's plan: every version, oldest first, the resources the scout found for it and the
// limits each version must fit.
export type SavedPlan = { versions: CoursePlan[]; resources: Resource[]; limits: Limits };

// An edit before there is a plan to edit.
export class PlanConflict extends Error {}

export class PlanEditRejected extends Error {
  violations: Violation[];

  constructor(violations: Violation[]) {
    super(`The edit breaks the plan's rules: ${violations.map((v) => v.en).join("; ")}`);
    this.violations = violations;
  }
}

export function savedPlan(store: Store, sessionId: string): SavedPlan | undefined {
  return store.readDoc<SavedPlan>(sessionId, PLAN_DOC);
}

export type PlannerDeps = {
  orchestrator: Pick<ReturnType<typeof createOrchestrator>, "runStep">;
  store: Store;
  tracer: Tracer;
  sessionId: string;
  // The learner the plan is for, and where their resources come from: the route passes the
  // intake's profile and a scout run.
  profile(): LearnerProfile;
  findResources(profile: LearnerProfile): Promise<Resource[]>;
};

export function createPlanner({
  orchestrator,
  store,
  tracer,
  sessionId,
  profile,
  findResources,
}: PlannerDeps) {
  const save = (plan: SavedPlan) => {
    store.writeDoc(sessionId, PLAN_DOC, plan);
    return plan;
  };
  // An edit's verdict is finished work, so the activity feed does not show the architect working.
  const report = (summary_ar: string, summary_en: string) =>
    tracer.emit({ agent: "architect", kind: "output", summary_ar, summary_en });

  return {
    // The session's plan, built on the first call.
    async build(): Promise<SavedPlan> {
      const existing = savedPlan(store, sessionId);
      if (existing) return existing;
      const learner = profile();
      const resources = await findResources(learner);
      const brief = architectBrief(learner, resources);
      const plan = await runArchitect({ orchestrator, sessionId, brief });
      return save({ versions: [plan], resources, limits: limitsOf(brief) });
    },

    // Throws PlanEditRejected, with the broken rules, for an edit the plan cannot take.
    edit(edit: PlanEdit): SavedPlan {
      const saved = savedPlan(store, sessionId);
      const latest = saved?.versions.at(-1);
      if (!saved || !latest) throw new PlanConflict("There is no plan to edit yet");
      const result = applyEdit(latest, edit, saved.limits);
      const what = describeEdit(latest, edit);
      if (!result.ok) {
        report(
          `لم يُقبل تعديلك: ${result.violations.map((v) => v.ar).join("، ")}`,
          `Learner edit refused (${what.en}): ${result.violations.map((v) => v.en).join("; ")}`,
        );
        throw new PlanEditRejected(result.violations);
      }
      report(
        `عدّلتَ خطتك: ${what.ar}`,
        `Learner edit: ${what.en}; plan version ${result.plan.version}`,
      );
      return save({ ...saved, versions: [...saved.versions, result.plan] });
    },

    // Back to no plan: the pages fall back to the seed's, and the next build reads the saved step.
    reset() {
      store.deleteDoc(sessionId, PLAN_DOC);
    },
  };
}

export type Planner = ReturnType<typeof createPlanner>;

function describeEdit(plan: CoursePlan, edit: PlanEdit): { ar: string; en: string } {
  const session = plan.committed.sessions.find((s) => s.id === edit.session_id);
  if (edit.op === "move") {
    return {
      ar: `نقلتَ جلسة إلى ${edit.day === 0 ? "يوم البدء" : `اليوم ${edit.day}`}`,
      en: `moved session ${edit.session_id} from day ${session?.day} to day ${edit.day}`,
    };
  }
  return {
    ar: `قصّرتَ جلسة إلى ${edit.minutes} دقيقة`,
    en: `shortened session ${edit.session_id} from ${session?.minutes} to ${edit.minutes} minutes`,
  };
}
