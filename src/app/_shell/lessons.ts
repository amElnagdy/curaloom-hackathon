// The learner's course as the lesson, quiz and plan pages read it (#34): the latest plan, its
// written lessons and glossary, the quizzes taken under it, and where the quiz gate leaves each
// lesson. Before the intake it is the seed's example. Server only, since it reads the store.

import type {
  CoursePlan,
  GlossaryEntry,
  Lesson,
  Mastery,
  Resource,
} from "../../../contracts/index.ts";
import { loadOmarSeed } from "../../../demo/seed.ts";
import { DEMO_SESSION_ID } from "../../../demo/session.ts";
import { config } from "../../config.ts";
import { planFor } from "../../server/agents/architect/architect.ts";
import { type SavedQuizzes, savedQuizzes } from "../../server/agents/examiner/examiner.ts";
import { lessonOpen } from "../../server/agents/examiner/rules.ts";
import { savedProfile } from "../../server/agents/intake/intake.ts";
import { savedLessons } from "../../server/agents/lesson/lesson.ts";
import { createFileStore, type Store } from "../../server/store/store.ts";
import { type CourseModule, latestPlan, lessonPlace, type Session } from "./course.ts";
import { ordinal } from "./format.ts";

export type PlannedLesson = CoursePlan["committed"]["lessons"][number];

// One lesson of the plan as the pages show it: its place, whether it is written, and where the quiz
// gate leaves it.
export type CourseLesson = {
  planned: PlannedLesson;
  // Its index in plan order: «الدرس الأول» is 0.
  position: number;
  // Its first session, and the module whose weeks hold it.
  session: Session | undefined;
  module: CourseModule | undefined;
  written: boolean;
  open: boolean;
  passed: boolean;
  // The best quiz score so far; undefined before the first attempt.
  best: number | undefined;
};

export function courseLessons(
  plan: CoursePlan,
  written: Set<string>,
  mastery: Mastery[],
): CourseLesson[] {
  const ids = plan.committed.lessons.map((l) => l.id);
  return plan.committed.lessons.map((planned, position) => {
    const own = mastery.find((m) => m.lesson_id === planned.id);
    return {
      planned,
      position,
      ...lessonPlace(plan, planned.id),
      written: written.has(planned.id),
      open: lessonOpen(ids, mastery, planned.id),
      passed: own?.passed === true,
      best: own && own.attempts > 0 ? own.best_score : undefined,
    };
  });
}

// The tab title of a lesson's page or its quiz's (#64), numbered so that two lessons' tabs differ:
// «الدرس الأول», «اختبار الدرس الأول». A lesson outside the plan has no number.
export function lessonTabTitle(
  lessons: CourseLesson[] | undefined,
  lessonId: string,
  page: "lesson" | "quiz",
): string {
  const state = lessons?.find((l) => l.planned.id === lessonId);
  const lesson = state ? `الدرس ${ordinal(state.position)}` : "الدرس";
  return page === "quiz" ? `اختبار ${lesson}` : lesson;
}

// The lesson the learner is on: the first open one not passed yet, or the last once all are passed.
export const currentLesson = (lessons: CourseLesson[]): CourseLesson | undefined =>
  lessons.find((l) => l.open && !l.passed) ?? lessons.findLast((l) => l.open);

export type LearnerCourse = {
  // The seed's example, shown before the intake.
  sample: boolean;
  name: string;
  plan: CoursePlan;
  // Every version of the plan, oldest first; `plan` is the last.
  versions: CoursePlan[];
  resources: Resource[];
  lessons: Record<string, Lesson>;
  glossary: GlossaryEntry[];
  quizzes: SavedQuizzes;
  states: CourseLesson[];
};

// The course the pages show; undefined while there is none, before the learner's plan is built.
export function learnerCourse(): LearnerCourse | undefined {
  const store = createFileStore();
  const seed = loadOmarSeed(config.demoTopic);
  const learner = savedProfile(store, DEMO_SESSION_ID);
  if (!learner) {
    const plan = latestPlan(seed);
    if (!plan) return undefined;
    const lessons = Object.fromEntries(seed.lessons.map((l) => [l.id, l]));
    return {
      sample: true,
      name: seed.profile.name,
      plan,
      versions: seed.plans.toSorted((a, b) => a.version - b.version),
      resources: seed.resources,
      lessons,
      glossary: seed.glossary,
      quizzes: {
        for_plan: plan.id,
        quizzes: seed.quizzes,
        attempts: seed.attempts,
        mastery: seed.mastery,
      },
      states: courseLessons(plan, new Set(Object.keys(lessons)), seed.mastery),
    };
  }
  const saved = planFor(store, DEMO_SESSION_ID, learner);
  const plan = saved?.versions.at(-1);
  if (!saved || !plan) return undefined;
  const written = savedLessons(store, DEMO_SESSION_ID, plan);
  const quizzes = savedQuizzes(store, DEMO_SESSION_ID, plan.id);
  const lessons = written?.lessons ?? {};
  return {
    sample: false,
    name: learner.name,
    plan,
    versions: saved.versions,
    resources: saved.resources,
    lessons,
    glossary: written?.glossary ?? [],
    quizzes,
    states: courseLessons(plan, new Set(Object.keys(lessons)), quizzes.mastery),
  };
}

// Whose plan the session follows: the seed's example before the intake, the learner's own once it
// is built, and none between the two, while the coach has no study of theirs to follow (#61).
export type PlanKind = "sample" | "own" | "none";

export function planKind(store: Store, sessionId: string): PlanKind {
  const learner = savedProfile(store, sessionId);
  if (!learner) return "sample";
  return planFor(store, sessionId, learner)?.versions.at(-1) ? "own" : "none";
}
