// Consent and limits (#24): the learner turns coach messages on or off and sets quiet hours and the
// intensity; the page explains what the coach sends. Until consent is saved no message goes out,
// and «توقف» always stops them (ADR-004). The pill names the consent in one of three states (#57),
// and before the intake the page shows the seed's consent as an example, in the sample learner's name.

import { CalendarClock, Hand, MessageCircleQuestion, Sunrise } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { loadOmarSeed } from "../../../demo/seed.ts";
import { DEMO_SESSION_ID } from "../../../demo/session.ts";
import { config } from "../../config.ts";
import { sessionSim } from "../../server/coach/session.ts";
import { createFileStore } from "../../server/store/store.ts";
import { Columns, MarkItem, MarkList, Page, PageHead, Panel } from "../_shell/blocks.tsx";
import { CONSENT_PILL, consentState, SAMPLE_PILL } from "../_shell/course.ts";
import { countOf, HOURS } from "../_shell/format.ts";
import { planKind } from "../_shell/lessons.ts";
import { StatusPill } from "../_shell/ui.tsx";
import { ConsentForm } from "./consent-form.tsx";

export const metadata: Metadata = { title: "الموافقة" };

// What the coach sends while the learner is away, counted from the last quiz they took (#25).
const LADDER = [
  { mark: <Sunrise />, title: "بعد يومين", detail: "مهمة قصيرة من عشر دقائق تعيدك إلى درسك." },
  { mark: <CalendarClock />, title: "بعد خمسة أيام", detail: "اقتراح أسبوع أخف." },
  {
    mark: <MessageCircleQuestion />,
    title: "بعد عشرة أيام",
    detail: "سؤال واحد: نوقف مؤقتًا، أم نصغّر الخطة، أم نغيّر الموضوع؟",
  },
  { mark: <Hand />, title: "بعد ذلك", detail: "رسالة واحدة في الأسبوع على الأكثر." },
];

export default async function ConsentPage() {
  // The consent is the session's, so the page renders on each request.
  await connection();
  const store = createFileStore();
  const { learner, sim } = sessionSim(store, DEMO_SESSION_ID, loadOmarSeed(config.demoTopic));
  const consent = sim.consent();
  const sample = planKind(store, DEMO_SESSION_ID) === "sample";
  const { status, label } = sample ? SAMPLE_PILL : CONSENT_PILL[consentState(consent)];
  const limits = `أنت تحدد إن كان المدرب يتابعك، ومتى، وكيف. خطتك مبنية على ${countOf(learner.hours_per_week, HOURS)} في الأسبوع، ولا يطلب المدرب أكثر منها.`;

  return (
    <Page>
      <PageHead
        title="حدودك والموافقة"
        pill={<StatusPill status={status}>{label}</StatusPill>}
        lede={
          sample ? (
            <>
              <b>هذه حدود مثال.</b> أكمل <Link href="/intake">المقابلة</Link> لتضع حدودك أنت: إن كان
              المدرب يتابعك، ومتى، وكيف.
            </>
          ) : (
            limits
          )
        }
      />

      <Columns>
        <ConsentForm
          sessionId={DEMO_SESSION_ID}
          consent={consent}
          sample={sample ? learner.name : undefined}
        />
        <Panel id="ladder-title" title="ما الذي يرسله المدرب" sub="حين تغيب عن جلساتك:">
          <MarkList>
            {LADDER.map((step) => (
              <MarkItem key={step.title} {...step} />
            ))}
          </MarkList>
        </Panel>
      </Columns>
    </Page>
  );
}
