// Settings (#15 slot): the demo layer's settings, read from config. The model profile is read-only;
// the simulated clock moves from here (#23), and the coach's consent shows here, edited on /consent
// (#24).

import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import type { ReactNode } from "react";
import type { Consent } from "../../../contracts/index.ts";
import { loadOmarSeed } from "../../../demo/seed.ts";
import { DEMO_SESSION_ID } from "../../../demo/session.ts";
import { config, PROVIDER_PROFILES, type ProviderProfile } from "../../config.ts";
import { sessionSim } from "../../server/coach/session.ts";
import { createFileStore } from "../../server/store/store.ts";
import { Page, PageHead, Panel, SettingRow, SettingRows } from "../_shell/blocks.tsx";
import { simDay } from "../_shell/course.ts";
import { clockTime } from "../_shell/format.ts";
import { buttonClass, cx, StatusPill } from "../_shell/ui.tsx";
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

const PROFILE: Record<ProviderProfile, { label: string; help: ReactNode }> = {
  replay: {
    label: "مسجّل",
    help: "يعرض ردود النماذج المسجلة: لا اتصال بالنماذج ولا تكلفة. هذا وضع العرض.",
  },
  record: {
    label: "تسجيل",
    help: (
      <>
        يستدعي النماذج ويحفظ ردودها لتُعرض لاحقًا. يحتاج مفتاحًا في ملف <Tech>.env</Tech>.
      </>
    ),
  },
  live: {
    label: "مباشر",
    help: (
      <>
        يستدعي النماذج مباشرة في كل خطوة. يحتاج مفتاحًا في ملف <Tech>.env</Tech>.
      </>
    ),
  },
};

const INTENSITY: Record<Consent["intensity"], string> = { gentle: "لطيف", normal: "عادي" };

// The consent as one line: whether messages go out, since when, and within which limits.
function consentLine(consent: Consent): string {
  if (consent.opted_out)
    return `أوقفتها في ${simDay(consent.opted_out_sim_day ?? 0)}، فلا يصلك شيء حتى تعيد تفعيلها.`;
  if (!consent.granted) return "لم توافق على المتابعة بعد، فلا يصلك شيء.";
  const quiet = consent.quiet_hours;
  return [
    `مفعّلة منذ ${simDay(consent.granted_sim_day ?? 0)}`,
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
  const profile = PROFILE[config.providerProfile];
  const store = createFileStore();
  const consent = sessionSim(store, DEMO_SESSION_ID, loadOmarSeed(config.demoTopic)).sim.consent();
  const messagesOn = consent.granted && !consent.opted_out;

  return (
    <Page width="narrow">
      <PageHead
        title="الإعدادات"
        lede="إعدادات العرض التجريبي: الساعة المحاكاة، ومتابعة المدرب، ووضع النماذج، واسم التطبيق."
      />

      <Panel id="clock-title" title="الساعة المحاكاة" flush>
        {config.simClock ? (
          <ClockControls sessionId={DEMO_SESSION_ID} />
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
          <SettingRow label="رسائل المدرب" labelId="coach-consent" help={consentLine(consent)}>
            {messagesOn ? (
              <StatusPill status="ready">مفعّلة</StatusPill>
            ) : (
              <StatusPill status="neutral">متوقفة</StatusPill>
            )}
            <Link href="/consent" className={buttonClass("secondary", "sm")}>
              عدّل حدودك
            </Link>
          </SettingRow>
        </SettingRows>
      </Panel>

      <Panel id="models-title" title="النماذج" flush>
        <SettingRows>
          <SettingRow label="وضع النماذج" labelId="profile-label" help={profile.help}>
            {/* Read-only: the profile comes from PROVIDER_PROFILE in .env, not from this page. */}
            <ul className={styles.segments} aria-labelledby="profile-label">
              {PROVIDER_PROFILES.map((p) => {
                const current = p === config.providerProfile;
                return (
                  <li
                    key={p}
                    className={cx(styles.segment, current && styles.segmentOn)}
                    aria-current={current || undefined}
                  >
                    {PROFILE[p].label}
                    <Tech>{p}</Tech>
                  </li>
                );
              })}
            </ul>
          </SettingRow>
          <SettingRow
            label="من أين يُضبط"
            labelId="profile-source"
            help={
              <>
                يتغير الوضع من ملف <Tech>.env</Tech> فقط، وتُوجَّه كل مهمة إلى نموذجها في ملف الأدوار.
              </>
            }
          >
            <span className={styles.files}>
              <Tech>PROVIDER_PROFILE</Tech>
              <Tech>config/models.yaml</Tech>
            </span>
          </SettingRow>
        </SettingRows>
      </Panel>

      <Panel id="app-title" title="التطبيق" flush>
        <SettingRows>
          <SettingRow
            label="اسم العمل"
            labelId="app-name"
            help="اسم مؤقت لم يُعتمد بعد. يُقرأ من الإعدادات ولا يُكتب في الشيفرة."
          >
            <bdi className={styles.name}>{config.appName}</bdi>
          </SettingRow>
          <SettingRow
            label="موضوع العرض"
            labelId="app-topic"
            help="لم يُحدَّد موضوع الدورة بعد، فالمحتوى الحالي مكتوب على موضوع مؤقت."
          >
            <Tech>{config.demoTopic}</Tech>
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
