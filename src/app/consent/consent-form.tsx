"use client";

// The consent form (#24): coach messages on or off, quiet hours, intensity and the channel, saved
// through POST /api/sessions/:id/consent. Turning messages off is the same opt-out as «توقف».

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import type { Consent } from "../../../contracts/index.ts";
import { Panel, SettingRow, SettingRows } from "../_shell/blocks.tsx";
import { clockTime } from "../_shell/format.ts";
import { buttonClass, cx } from "../_shell/ui.tsx";
import styles from "./consent.module.css";

type Choice = {
  messages: boolean;
  start: string;
  end: string;
  intensity: Consent["intensity"];
};

const QUIET_START_CHOICES = ["20:00", "21:00", "22:00", "23:00"];
const QUIET_END_CHOICES = ["06:00", "07:00", "08:00", "09:00", "10:00", "12:00"];

const INTENSITIES: { value: Consent["intensity"]; label: string; help: string }[] = [
  { value: "gentle", label: "لطيف", help: "رسائل أقصر بنبرة هادئة." },
  { value: "normal", label: "عادي", help: "رسائل مباشرة بنبرة عادية." },
];

const CHANNELS = [
  { value: "simulated", label: "هاتف محاكى", soon: false },
  { value: "whatsapp", label: "واتساب", soon: true },
  { value: "email", label: "البريد", soon: true },
];

// The learner's value is always one of the choices, even when it is not a usual one.
const withValue = (choices: string[], value: string) =>
  choices.includes(value) ? choices : [value, ...choices];

type Status = "idle" | "saving" | "saved" | "failed";

export function ConsentForm({ sessionId, consent }: { sessionId: string; consent: Consent }) {
  const router = useRouter();
  const quiet = consent.quiet_hours ?? { start: "22:00", end: "08:00" };
  const saved: Choice = {
    messages: consent.granted && !consent.opted_out,
    start: quiet.start,
    end: quiet.end,
    intensity: consent.intensity,
  };
  const [choice, setChoice] = useState(saved);
  // What the server holds: the page's consent, or the last save until the refreshed page brings it.
  const [held, setHeld] = useState(saved);
  const [status, setStatus] = useState<Status>("idle");
  const changed = (Object.keys(held) as (keyof Choice)[]).some((k) => held[k] !== choice[k]);

  const pick = (next: Partial<Choice>) => {
    setChoice((c) => ({ ...c, ...next }));
    setStatus("idle");
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    setStatus("saving");
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/consent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: choice.messages,
          quiet_hours: { start: choice.start, end: choice.end },
          intensity: choice.intensity,
        }),
      });
      setStatus(res.ok ? "saved" : "failed");
      if (res.ok) {
        setHeld(choice);
        router.refresh();
      }
    } catch {
      setStatus("failed");
    }
  }

  const toTime = (v: string) => (
    <option key={v} value={v}>
      {clockTime(v)}
    </option>
  );
  const firstYes = choice.messages && !consent.granted;

  return (
    <form onSubmit={save} className={styles.form}>
      <Panel id="limits-title" title="حدود المتابعة" flush>
        <SettingRows>
          <SettingRow
            label="رسائل المدرب"
            htmlFor="consent-messages"
            help="أوقفها هنا أو بكلمة «توقف»، ولن يصلك شيء حتى تعيد تفعيلها."
          >
            <span className={styles.value}>{choice.messages ? "مفعّلة" : "متوقفة"}</span>
            <input
              type="checkbox"
              role="switch"
              aria-checked={choice.messages}
              id="consent-messages"
              className={styles.switch}
              checked={choice.messages}
              onChange={(e) => pick({ messages: e.target.checked })}
            />
          </SettingRow>
          <SettingRow
            label="ساعات الهدوء"
            labelId="consent-quiet"
            help="لا تصلك رسائل في هذه الساعات. ما يحلّ موعده فيها يُؤجَّل إلى نهايتها."
          >
            <fieldset className={styles.range} aria-labelledby="consent-quiet">
              <span>من</span>
              <select
                id="consent-quiet-start"
                aria-label="بداية ساعات الهدوء"
                className={styles.select}
                value={choice.start}
                onChange={(e) => pick({ start: e.target.value })}
              >
                {withValue(QUIET_START_CHOICES, choice.start).map(toTime)}
              </select>
              <span>حتى</span>
              <select
                id="consent-quiet-end"
                aria-label="نهاية ساعات الهدوء"
                className={styles.select}
                value={choice.end}
                onChange={(e) => pick({ end: e.target.value })}
              >
                {withValue(QUIET_END_CHOICES, choice.end).map(toTime)}
              </select>
            </fieldset>
          </SettingRow>
          <SettingRow
            label="أسلوب المتابعة"
            labelId="consent-intensity"
            help={INTENSITIES.find((i) => i.value === choice.intensity)?.help}
          >
            <div className={styles.segments} role="radiogroup" aria-labelledby="consent-intensity">
              {INTENSITIES.map((i) => (
                <label
                  key={i.value}
                  className={cx(styles.segment, choice.intensity === i.value && styles.segmentOn)}
                >
                  <input
                    type="radio"
                    name="intensity"
                    value={i.value}
                    checked={choice.intensity === i.value}
                    onChange={() => pick({ intensity: i.value })}
                  />
                  {i.label}
                </label>
              ))}
            </div>
          </SettingRow>
          <SettingRow
            label="القناة"
            labelId="consent-channel"
            help="في هذا العرض تصل الرسائل إلى هاتف محاكى، لا إلى هاتف حقيقي."
          >
            <div className={styles.segments} role="radiogroup" aria-labelledby="consent-channel">
              {CHANNELS.map((c) => (
                <label
                  key={c.value}
                  className={cx(styles.segment, !c.soon && styles.segmentOn)}
                  data-soon={c.soon || undefined}
                >
                  <input
                    type="radio"
                    name="channel"
                    value={c.value}
                    checked={!c.soon}
                    disabled={c.soon}
                    readOnly
                  />
                  {c.label}
                  {c.soon && <small>قريبًا</small>}
                </label>
              ))}
            </div>
          </SettingRow>
        </SettingRows>
      </Panel>

      <div className={styles.actions}>
        <button
          type="submit"
          className={buttonClass("primary", "lg")}
          disabled={!changed || status === "saving"}
        >
          {firstYes ? "وافق وفعّل الرسائل" : "احفظ"}
        </button>
        <p className={styles.status} role="status" data-failed={status === "failed" || undefined}>
          {status === "saving"
            ? "يحفظ…"
            : status === "saved"
              ? "حُفظت حدودك، ويطبّقها المدرب على كل رسالة من الآن."
              : status === "failed"
                ? "لم تُحفظ. حاول مرة أخرى."
                : ""}
        </p>
      </div>
    </form>
  );
}
