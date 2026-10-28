// Settings (#15 slot): the demo layer's settings, read from config. The model profile is read-only;
// the simulated clock's controls stay disabled until the clock module exists (#23).

import { CalendarPlus, FastForward, Info, Play } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { DEMO_SESSION_ID } from "../../../demo/session.ts";
import { config, PROVIDER_PROFILES, type ProviderProfile } from "../../config.ts";
import { Callout, Page, PageHead, Panel, SettingRow, SettingRows } from "../_shell/blocks.tsx";
import { buttonClass, cx, SimClockPill } from "../_shell/ui.tsx";
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

export default function SettingsPage() {
  const profile = PROFILE[config.providerProfile];

  return (
    <Page width="narrow">
      <PageHead
        title="الإعدادات"
        lede="إعدادات العرض التجريبي: الساعة المحاكاة، ووضع النماذج، واسم التطبيق. تُقرأ كلها من ملف الإعدادات."
      />

      <Panel id="clock-title" title="الساعة المحاكاة" flush>
        <SettingRows>
          {config.simClock ? (
            <SettingRow
              label="الوقت الآن"
              labelId="clock-now"
              help="يرى المدرب هذا الوقت. تقديم الساعة يُطلق رسائل المدرب المستحقة بالترتيب، مرة واحدة لكل رسالة."
            >
              <SimClockPill now={null} running={false} />
              <fieldset className={styles.buttons} aria-labelledby="clock-now" disabled>
                <button type="button" className={buttonClass("secondary", "sm")} disabled>
                  <Play aria-hidden />
                  تشغيل الساعة
                </button>
                <button
                  type="button"
                  className={buttonClass("secondary", "sm")}
                  aria-label="قدّم ساعة"
                  disabled
                >
                  <FastForward aria-hidden />
                  ساعة
                </button>
                <button
                  type="button"
                  className={buttonClass("secondary", "sm")}
                  aria-label="قدّم يومًا"
                  disabled
                >
                  <CalendarPlus aria-hidden />
                  يوم
                </button>
              </fieldset>
            </SettingRow>
          ) : (
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
          )}
        </SettingRows>
        {config.simClock && (
          <div className={styles.panelNote}>
            <Callout icon={Info}>
              الأزرار معطّلة حتى تُبنى وحدة الساعة المحاكاة. الساعة لم تبدأ بعد.
            </Callout>
          </div>
        )}
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
            help="لم يُحدَّد موضوع الدورة بعد. كل المحتوى الحالي بيانات تجريبية."
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
