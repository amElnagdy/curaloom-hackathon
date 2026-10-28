// Consent and limits (#15 slot; the consent screen is #24): Omar's seeded consent, weekly hours,
// quiet hours and opt-out, shown as disabled controls with an honest note until editing exists.
// «توقف» always stops messages (ADR-004).

import { Info, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { loadOmarSeed } from "../../../demo/seed.ts";
import { config } from "../../config.ts";
import {
  Callout,
  ChannelTag,
  Page,
  PageHead,
  Panel,
  SettingRow,
  SettingRows,
} from "../_shell/blocks.tsx";
import { simDay } from "../_shell/course.ts";
import { clockTime, countOf, HOURS } from "../_shell/format.ts";
import { StatusPill } from "../_shell/ui.tsx";
import styles from "./consent.module.css";

export const metadata: Metadata = { title: "الموافقة" };

// The words an inbound message may carry to opt out (ADR-004).
const STOP_WORDS = ["توقف", "إيقاف"];

const HOUR_CHOICES = [2, 3, 4, 5, 6, 8, 10];
const QUIET_START_CHOICES = ["20:00", "21:00", "22:00", "23:00"];
const QUIET_END_CHOICES = ["08:00", "10:00", "12:00", "14:00"];

// The learner's value is always one of the choices, even when it is not a usual one.
const withValue = <T,>(choices: T[], value: T) =>
  choices.includes(value) ? choices : [value, ...choices];

// A switch drawn from a checkbox. Read-only for now: disabled, showing the seeded value.
function Switch({ id, checked }: { id: string; checked: boolean }) {
  return (
    <input
      type="checkbox"
      role="switch"
      aria-checked={checked}
      id={id}
      className={styles.switch}
      defaultChecked={checked}
      disabled
    />
  );
}

function Select({
  id,
  label,
  value,
  options,
}: {
  id: string;
  label?: string;
  value: string;
  options: { value: string; label: string }[];
}) {
  return (
    <select id={id} className={styles.select} defaultValue={value} aria-label={label} disabled>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export default function ConsentPage() {
  const seed = loadOmarSeed(config.demoTopic);
  const { consent, profile } = seed;
  const quiet = consent.quiet_hours;
  const messagesOn = consent.granted && !consent.opted_out;
  const hours = profile.hours_per_week;
  const toTime = (v: string) => ({ value: v, label: clockTime(v) });

  return (
    <Page width="narrow">
      <PageHead
        title="حدودك والموافقة"
        pill={
          messagesOn ? (
            <StatusPill status="ready">الرسائل مفعّلة</StatusPill>
          ) : (
            <StatusPill status="neutral">الرسائل متوقفة</StatusPill>
          )
        }
        lede="أنت تحدد متى يتابعك المدرب وكيف. تستطيع تغيير ذلك أو إيقاف الرسائل في أي وقت."
      />

      <Callout icon={Info}>
        تعرض هذه الصفحة الحدود التي وافقت عليها. تعديلها من هنا لم يُفعَّل بعد، لذلك الأزرار معطّلة.
      </Callout>

      <Panel id="limits-title" title="حدود المتابعة" flush>
        <SettingRows>
          <SettingRow
            label="رسائل المدرب"
            htmlFor="consent-messages"
            help="رسائل قصيرة تذكّرك بجلستك، وتقترح خطة أخف إن تأخرت."
          >
            <span className={styles.value}>{messagesOn ? "مفعّلة" : "متوقفة"}</span>
            <Switch id="consent-messages" checked={messagesOn} />
          </SettingRow>
          <SettingRow
            label="وقتك في الأسبوع"
            htmlFor="consent-hours"
            help="يبني المهندس خطتك على هذا الوقت، ولا يتجاوزه."
          >
            <Select
              id="consent-hours"
              value={String(hours)}
              options={withValue(HOUR_CHOICES, hours).map((h) => ({
                value: String(h),
                label: countOf(h, HOURS),
              }))}
            />
          </SettingRow>
          <SettingRow
            label="ساعات الهدوء"
            labelId="consent-quiet"
            help="لا تصلك رسائل في هذه الساعات. طلبت ألا تصلك رسائل صباحية."
          >
            {quiet ? (
              <fieldset className={styles.range} aria-labelledby="consent-quiet" disabled>
                <span>من</span>
                <Select
                  id="consent-quiet-start"
                  label="بداية ساعات الهدوء"
                  value={quiet.start}
                  options={withValue(QUIET_START_CHOICES, quiet.start).map(toTime)}
                />
                <span>حتى</span>
                <Select
                  id="consent-quiet-end"
                  label="نهاية ساعات الهدوء"
                  value={quiet.end}
                  options={withValue(QUIET_END_CHOICES, quiet.end).map(toTime)}
                />
              </fieldset>
            ) : (
              <span className={styles.value}>لم تحدد ساعات هدوء</span>
            )}
          </SettingRow>
          <SettingRow
            label="كلمة الإيقاف"
            labelId="consent-stop"
            help="أرسل «توقف» أو «إيقاف» في أي وقت، فتتوقف الرسائل فورًا، ولا يصلك شيء حتى تعيد تفعيلها هنا."
          >
            <ul className={styles.words} aria-labelledby="consent-stop">
              {STOP_WORDS.map((word) => (
                <li key={word}>{word}</li>
              ))}
            </ul>
          </SettingRow>
          <SettingRow
            label="القناة"
            labelId="consent-channel"
            help="قناة محاكاة في هذا العرض. لا تُرسل رسائل حقيقية إلى أي هاتف."
          >
            <ChannelTag />
          </SettingRow>
        </SettingRows>
      </Panel>

      <Callout icon={ShieldCheck}>
        {consent.granted
          ? `وافقت على المتابعة في ${simDay(consent.granted_sim_day ?? 0)}. تُطبَّق هذه الحدود قبل أي رسالة، مهما كانت القناة.`
          : "لم توافق على المتابعة بعد، فلن تصلك أي رسالة."}
      </Callout>
    </Page>
  );
}
