// The 404 page (#15), inside the shell: an unknown URL, or a page that calls notFound() (/dev/bidi
// in a production build). Its way back is the learner's next step (#65), which is the interview
// until it is done. The top bar's breadcrumb names it by its title's id (top-bar.tsx).

import { ArrowRight, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { EmptyState, Page } from "./_shell/blocks.tsx";
import { learnerCourse } from "./_shell/lessons.ts";
import { nextStep, type Progress, progressOf } from "./_shell/next-step.ts";
import { buttonClass, DirIcon } from "./_shell/ui.tsx";

export const metadata: Metadata = { title: "لم نجد هذه الصفحة" };

const WHERE: Record<Progress, string> = {
  new: "ابدأ المقابلة لنبني لك خطة تناسب هدفك ووقتك.",
  planning: "تجد حال الخطة في صفحتها.",
  ready: "خطتك ودروسك في مكانها.",
};

export default async function NotFound() {
  await connection();
  const progress = progressOf(learnerCourse());
  const next = nextStep(progress);
  return (
    <Page width="reading">
      <EmptyState
        icon={SearchX}
        heading="h1"
        title="لم نجد هذه الصفحة"
        titleId="not-found-title"
        text={`ربما تغيّر الرابط أو نُسخ ناقصًا. ${WHERE[progress]}`}
        actions={
          <Link href={next.href} className={buttonClass("primary", "lg")}>
            {next.label}
            <DirIcon icon={ArrowRight} />
          </Link>
        }
      />
    </Page>
  );
}
