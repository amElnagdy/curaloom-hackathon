// Settings (#15 slot): the demo layer's settings, read from config. The model profile is read-only,
// in Arabic, with the setting names folded away (#64); the simulated clock moves from here (#23), and
// the coach's consent shows here, edited on /consent (#24). Before the intake the consent is the
// sample learner's, marked as an example.

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { Consent } from "../../../contracts/index.ts";
import { loadOmarSeed } from "../../../demo/seed.ts";
import { DEMO_SESSION_ID } from "../../../demo/session.ts";
import { config, loadConfig, PROVIDER_PROFILES, type ProviderProfile } from "../../config.ts";
import { ladderMarks } from "../../server/coach/ladder.ts";
import { sessionSim } from "../../server/coach/session.ts";
import { createFileStore } from "../../server/store/store.ts";
import { Page, PageHead, Panel, SettingRow, SettingRows } from "../_shell/blocks.tsx";
import { CONSENT_PILL, consentState, consentText, SAMPLE_PILL, simDay } from "../_shell/course.ts";
import { clockTime } from "../_shell/format.ts";
import { planKind } from "../_shell/lessons.ts";
import { buttonClass, cx, MODE, StatusPill } from "../_shell/ui.tsx";
import { ClockControls } from "./clock-controls.tsx";
import styles from "./settings.module.css";

export const metadata: Metadata = { title: "الإعدادات" };

// A technical value: Latin, left to right, isolated from the Arabic around it.
function Tech({ children }: { children: string }) {
  return (
    <bdi className={styles.tech} dir="ltr" lang="en">
      {children}
    </bdi>
  );
}

const PROFILE_HELP: Record<ProviderProfile, string> = {
  replay: "يعرض ردود النماذج المسجّلة: لا اتصال بالنماذج ولا تكلفة. هذا وضع العرض.",
  record: "يستدعي النماذج ويحفظ ردودها لتُعرض لاحقًا. يحتاج إلى مفتاح النماذج.",
  live: "يستدعي النماذج مباشرة في كل خطوة. يحتاج إلى مفتاح النماذج.",
};

// Config's default topic is a placeholder, so a server started without one has no topic. demo/run.ts
// tells the two apart the same way.
const topicOf = (topic: string) => (topic === loadConfig({}).demoTopic ? undefined : topic);

const INTENSITY: Record<Consent["intensity"], string> = { gentle: "لطيف", normal: "عادي" };

// The consent as one line: whether messages go out, since when, and within which limits. `sample`
// names the sample learner whose consent it is before the intake.
function consentLine(consent: Consent, sample?: string): string {
  if (consentState(consent) !== "on") return consentText(consent, sample);
  const quiet = consent.quiet_hours;
  return [
    `الرسائل مفعّلة ${sample ? `بموافقة ${sample}` : "بموافقتك"} منذ ${simDay(consent.granted_sim_day ?? 0)}`,
    quiet ? `لا رسائل من ${clockTime(quiet.start)} حتى ${clockTime(quiet.end)}` : "",
    `الأسلوب ${INTENSITY[consent.intensity]}`,
  ]
    .filter(Boolean)
    .join("، ")
    .concat(".");
}

export default async function SettingsPage() {
  // The consent is the session's, so the page renders on each request.
  await connection();
  const topic = topicOf(config.demoTopic);
  const store = createFileStore();
  const { learner, sim } = sessionSim(store, DEMO_SESSION_ID, loadOmarSeed(config.demoTopic));
  const consent = sim.consent();
  const sample = planKind(store, DEMO_SESSION_ID) === "sample" ? learner.name : undefined;
  const pill = sample ? SAMPLE_PILL : CONSENT_PILL[consentState(consent)];

  return (
    <Page width="narrow">
      <PageHead
        title="الإعدادات"
        lede="إعدادات العرض التجريبي: الساعة المحاكاة، ومتابعة المدرب، ووضع النماذج، واسم التطبيق."
      />

      <Panel id="clock-title" title="الساعة المحاكاة" flush>
        {config.simClock ? (
          <ClockControls sessionId={DEMO_SESSION_ID} days={ladderMarks().map((m) => m.day)} />
        ) : (
          <SettingRows>
            <SettingRow
              label="الساعة المحاكاة متوقفة"
              labelId="clock-off"
              help={
                <>
                  يعمل التطبيق بالوقت الحقيقي. لتفعيلها، احذف هذا السطر من ملف <Tech>.env</Tech>.
                </>
              }
            >
              <Tech>SIM_CLOCK=false</Tech>
            </SettingRow>
          </SettingRows>
        )}
      </Panel>

      <Panel id="coach-title" title="المدرب" flush>
        <SettingRows>
          <SettingRow
            label="رسائل المدرب"
            labelId="coach-consent"
            help={consentLine(consent, sample)}
          >
            <StatusPill status={pill.status}>{pill.label}</StatusPill>
            <Link href="/consent" className={buttonClass("secondary", "sm")}>
              عدّل حدودك
            </Link>
          </SettingRow>
        </SettingRows>
      </Panel>

      <Panel id="models-title" title="النماذج" flush>
        <SettingRows>
          <SettingRow
            label="وضع النماذج"
            labelId="profile-label"
            help={PROFILE_HELP[config.providerProfile]}
          >
            {/* Read-only: the profile comes from the server's settings, not from this page. */}
            <ul className={styles.segments} aria-labelledby="profile-label">
              {PROVIDER_PROFILES.map((p) => {
                const current = p === config.providerProfile;
                return (
                  <li
                    key={p}
                    className={cx(styles.segment, current && styles.segmentOn)}
                    aria-current={current || undefined}
                  >
                    {MODE[p].label}
                  </li>
                );
              })}
            </ul>
          </SettingRow>
        </SettingRows>
        <details className={styles.techFold}>
          <summary>تفاصيل تقنية</summary>
          <p>
            يتغير الوضع من ملف <Tech>.env</Tech> فقط، وتُوجَّه كل مهمة إلى نموذجها في ملف الأدوار.
          </p>
          <dl>
            <dt>الوضع</dt>
            <dd>
              <Tech>{`PROVIDER_PROFILE=${config.providerProfile}`}</Tech>
            </dd>
            <dt>ملف الأدوار</dt>
            <dd>
              <Tech>config/models.yaml</Tech>
            </dd>
          </dl>
        </details>
      </Panel>

      <Panel id="app-title" title="التطبيق" flush>
        <SettingRows>
          <SettingRow
            label="اسم التطبيق"
            labelId="app-name"
            help="يظهر في الشعار وفي عنوان كل صفحة، ويُقرأ من إعدادات الخادم."
          >
            <bdi className={styles.name}>{config.appName}</bdi>
          </SettingRow>
          <SettingRow
            label="موضوع العرض"
            labelId="app-topic"
            help={
              topic
                ? "الموضوع الذي تُبنى عليه دورة العرض."
                : "لم يُحدَّد موضوع للعرض على هذا الخادم. حدّده في إعدادات الخادم قبل أن تبدأ المقابلة."
            }
          >
            {topic ? <Tech>{topic}</Tech> : <StatusPill status="neutral">لم يُحدَّد</StatusPill>}
          </SettingRow>
          <SettingRow
            label="جلسة العرض"
            labelId="app-session"
            help="الجلسة التي تعرضها الواجهة ويقرأ منها سجل الوكلاء."
          >
            <Tech>{DEMO_SESSION_ID}</Tech>
          </SettingRow>
        </SettingRows>
      </Panel>
    </Page>
  );
}
