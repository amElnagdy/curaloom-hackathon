// /lesson opens the lesson the learner is on (#34): the first open lesson not passed yet.
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { currentLesson, learnerCourse } from "../_shell/lessons.ts";
import { LessonWaiting } from "./states.tsx";

export const metadata: Metadata = { title: "الدرس" };

export default async function CurrentLessonPage() {
  await connection();
  const course = learnerCourse();
  const current = course && currentLesson(course.states);
  if (current) redirect(`/lesson/${current.planned.id}`);
  return <LessonWaiting />;
}
