// The 404 page (#15), inside the shell: an unknown URL, or a page that calls notFound() (/dev/bidi
// in a production build).

import { ArrowRight, SearchX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, Page } from "./_shell/blocks.tsx";
import { buttonClass, DirIcon } from "./_shell/ui.tsx";

export const metadata: Metadata = { title: "لم نجد هذه الصفحة" };

export default function NotFound() {
  return (
    <Page width="reading">
      <EmptyState
        icon={SearchX}
        heading="h1"
        title="لم نجد هذه الصفحة"
        titleId="not-found-title"
        text="ربما تغيّر الرابط أو نُسخ ناقصًا. خطتك ودروسك في مكانها."
        actions={
          <Link href="/plan" className={buttonClass("primary", "lg")}>
            اذهب إلى خطتك
            <DirIcon icon={ArrowRight} />
          </Link>
        }
      />
    </Page>
  );
}
