// /quiz opens the quiz of the lesson the learner is on (#34).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { currentLesson, learnerCourse } from "../_shell/lessons.ts";
import { QuizWaiting } from "./waiting.tsx";

export const metadata: Metadata = { title: "الاختبار" };

export default async function CurrentQuizPage() {
  await connection();
  const course = learnerCourse();
  const current = course && currentLesson(course.states);
  if (current) redirect(`/quiz/${current.planned.id}`);
  return <QuizWaiting lessonId={undefined} />;
}
