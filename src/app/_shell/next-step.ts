// Where the learner's path goes on from any page (#65): the interview until it is done, then the
// plan page, which builds the plan, shows it, or says why it could not and offers the way back.
// The home redirect, the logo, the 404 and the pages' empty states all point there.

import type { LearnerCourse } from "./lessons.ts";

// "new": no interview yet, so the pages show the seed's example; "planning": the interview is done
// and the plan is being built, or could not be; "ready": the learner's own plan exists.
export type Progress = "new" | "planning" | "ready";

export type NextStep = { href: "/intake" | "/plan"; label: string };

// While there is no plan, no link promises «خطتك»: the plan page shows the build, or its failure.
const NEXT: Record<Progress, NextStep> = {
  new: { href: "/intake", label: "ابدأ المقابلة" },
  planning: { href: "/plan", label: "إلى صفحة الخطة" },
  ready: { href: "/plan", label: "اذهب إلى خطتك" },
};

export const nextStep = (progress: Progress): NextStep => NEXT[progress];

// learnerCourse() is the seed's example before the interview, and undefined only between the
// interview and the plan.
export function progressOf(course: Pick<LearnerCourse, "sample"> | undefined): Progress {
  if (!course) return "planning";
  return course.sample ? "new" : "ready";
}
