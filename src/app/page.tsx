import { redirect } from "next/navigation";
import { connection } from "next/server";
import { learnerCourse } from "./_shell/lessons.ts";
import { nextStep, progressOf } from "./_shell/next-step.ts";

// The home of the app is the learner's next step: the interview, then the plan (#65). The logo
// links here, so it follows the learner too.
export default async function Home() {
  await connection();
  redirect(nextStep(progressOf(learnerCourse())).href);
}
