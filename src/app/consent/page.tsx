// Consent and limits (#24): the learner turns coach messages on or off and sets quiet hours and the
// intensity; the page explains what the coach sends. Until consent is saved no message goes out,
// and «توقف» always stops them (ADR-004).

import { CalendarClock, Hand, MessageCircleQuestion, ShieldCheck, Sunrise } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";
import { loadOmarSeed } from "../../../demo/seed.ts";
import { DEMO_SESSION_ID } from "../../../demo/session.ts";
import { config } from "../../config.ts";
import { sessionSim } from "../../server/coach/session.ts";
import { createFileStore } from "../../server/store/store.ts";
import {
  Callout,
  Columns,
  MarkItem,
  MarkList,
  Page,
  PageHead,
  Panel,
  Stack,
} from "../_shell/blocks.tsx";
import { simDay } from "../_shell/course.ts";
import { countOf, HOURS } from "../_shell/format.ts";
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
  { mark: <Hand />, title: "بعدها", detail: "رسالة واحدة في الأسبوع على الأكثر." },
];

export default async function ConsentPage() {
  // The consent is the session's, so the page renders on each request.
  await connection();
  const store = createFileStore();
  const { learner, sim } = sessionSim(store, DEMO_SESSION_ID, loadOmarSeed(config.demoTopic));
  const consent = sim.consent();
  const messagesOn = consent.granted && !consent.opted_out;

  return (
    <Page>
      <PageHead
        title="حدودك والموافقة"
        pill={
          messagesOn ? (
            <StatusPill status="ready">الرسائل مفعّلة</StatusPill>
          ) : (
            <StatusPill status="neutral">الرسائل متوقفة</StatusPill>
          )
        }
        lede={`أنت تحدد إن كان المدرب يتابعك، ومتى، وكيف. خطتك مبنية على ${countOf(learner.hours_per_week, HOURS)} في الأسبوع، ولا يطلب المدرب أكثر منها.`}
      />

      <Columns>
        <ConsentForm sessionId={DEMO_SESSION_ID} consent={consent} />
        <Stack>
          <Panel id="ladder-title" title="ما الذي يرسله المدرب" sub="حين تغيب عن جلساتك:">
            <MarkList label="رسائل المدرب">
              {LADDER.map((step) => (
                <MarkItem key={step.title} {...step} />
              ))}
            </MarkList>
          </Panel>
          <Callout icon={ShieldCheck} tone={messagesOn ? "ready" : "neutral"}>
            {consent.opted_out
              ? `أوقفت الرسائل في ${simDay(consent.opted_out_sim_day ?? 0)}، فلن يصلك شيء حتى تعيد تفعيلها.`
              : consent.granted
                ? `وافقت على المتابعة في ${simDay(consent.granted_sim_day ?? 0)}. «توقف» توقفها في أي وقت.`
                : "لم توافق على المتابعة بعد، فلن تصلك أي رسالة."}
          </Callout>
        </Stack>
      </Columns>
    </Page>
  );
}
