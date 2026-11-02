"use client";

// The simulated clock's controls (#23): +1 hour, +1 day, jump to a day of the coach's ladder (the
// demo bar's days, #64), and reset, through useSimClock, so the time shown is live across tabs. Like
// the demo bar, the forward moves wait for the learner's plan after the intake (#61); reset does not.

import { CalendarPlus, FastForward, Info, RotateCcw } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import type { CoachEvent } from "../../../contracts/index.ts";
import { compareSimTime, startOfDay } from "../../server/clock/time.ts";
import { Callout, SettingRow, SettingRows } from "../_shell/blocks.tsx";
import { simDay } from "../_shell/course.ts";
import { countOf, MESSAGES } from "../_shell/format.ts";
import { buttonClass, SimClockPill } from "../_shell/ui.tsx";
import { type SimMove, useSimClock, WAITS_FOR_PLAN } from "../_shell/use-sim-clock.ts";
import styles from "./settings.module.css";

const PASSED = "بلغت الساعة هذا اليوم. أعد الضبط لتعود إليه.";

function firedNote(events: CoachEvent[]): ReactNode {
  if (events.length === 0) return "لم يحلّ موعد أي رسالة من المدرب.";
  const days = events.map((e) => simDay(e.sim_day)).join("، ");
  return (
    <>
      حلّ موعد {countOf(events.length, MESSAGES)} من المدرب: {days}.{" "}
      <Link href="/coach">افتح رسائل المدرب</Link>
    </>
  );
}

export function ClockControls({ sessionId, days }: { sessionId: string; days: number[] }) {
  const { now, busy, move: moveClock, waitsForPlan } = useSimClock(sessionId);
  const [note, setNote] = useState<ReactNode>(null);

  async function move(m: SimMove) {
    const outcome = await moveClock(m);
    if (outcome.kind === "past") setNote("لا تعود الساعة إلى الوراء. أعد الضبط أولًا.");
    else if (outcome.kind === "failed") setNote("تعذّر تحريك الساعة.");
    else if (m.action === "reset") window.location.reload();
    else setNote(firedNote(outcome.events));
  }

  const disabled = busy || now === null;
  const passed = (day: number) => now !== null && compareSimTime(startOfDay(day), now) <= 0;
  const forward = {
    disabled: disabled || waitsForPlan,
    "aria-describedby": waitsForPlan ? "clock-waits" : undefined,
    title: waitsForPlan ? WAITS_FOR_PLAN : undefined,
  };

  return (
    <>
      <SettingRows>
        <SettingRow
          label="الوقت الآن"
          labelId="clock-now"
          help="يرى المدرب هذا الوقت. تقديم الساعة يُطلق رسائل المدرب المستحقة بالترتيب، مرة واحدة لكل رسالة."
        >
          <SimClockPill now={now} running={false} />
          <fieldset className={styles.buttons} aria-labelledby="clock-now" {...forward}>
            <button
              type="button"
              className={buttonClass("secondary", "sm")}
              aria-label="قدّم ساعة"
              onClick={() => move({ action: "advance", body: { minutes: 60 } })}
            >
              <FastForward aria-hidden />
              ساعة
            </button>
            <button
              type="button"
              className={buttonClass("secondary", "sm")}
              aria-label="قدّم يومًا"
              onClick={() => move({ action: "advance", body: { days: 1 } })}
            >
              <CalendarPlus aria-hidden />
              يوم
            </button>
          </fieldset>
        </SettingRow>
        <SettingRow
          label="انتقل إلى يوم"
          labelId="clock-jump"
          help="تنتقل الساعة إلى بداية اليوم، ٩:٠٠ ص، وتُطلق في طريقها كل رسالة حلّ موعدها. الساعة لا تعود إلى الوراء، فالأيام التي مضت معطّلة حتى تعيد الضبط."
        >
          <fieldset className={styles.buttons} aria-labelledby="clock-jump" {...forward}>
            {days.map((day) => (
              <button
                key={day}
                type="button"
                className={buttonClass("secondary", "sm")}
                disabled={passed(day)}
                title={passed(day) && !waitsForPlan ? PASSED : undefined}
                onClick={() => move({ action: "set", body: { day } })}
              >
                {simDay(day)}
              </button>
            ))}
          </fieldset>
        </SettingRow>
        <SettingRow
          label="إعادة الضبط"
          labelId="clock-reset"
          help="تعيد الجلسة إلى بيانات العرض: يوم البدء، والموافقة كما كانت، ولا رسائل مرسلة."
        >
          <button
            type="button"
            className={buttonClass("secondary", "sm")}
            disabled={disabled}
            onClick={() => move({ action: "reset" })}
          >
            <RotateCcw aria-hidden />
            إعادة الضبط
          </button>
        </SettingRow>
      </SettingRows>
      {waitsForPlan && (
        <div className={styles.panelNote} id="clock-waits">
          <Callout icon={Info}>
            {WAITS_FOR_PLAN}. <Link href="/plan">افتح خطتك</Link>
          </Callout>
        </div>
      )}
      <div className={note ? styles.panelNote : undefined} role="status">
        {note && <Callout icon={Info}>{note}</Callout>}
      </div>
    </>
  );
}
