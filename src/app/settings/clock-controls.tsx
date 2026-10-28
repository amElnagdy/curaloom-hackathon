"use client";

// The simulated clock's controls (#23): +1 hour, +1 day, jump to day 2, 5, 10 or 17, and reset,
// through POST /api/sessions/:id/sim/*. The time shown follows the trace stream, so it is live
// across tabs; right after a move it shows the route's answer until the stream catches up.

import { CalendarPlus, FastForward, Info, RotateCcw } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import type { CoachEvent } from "../../../contracts/index.ts";
import {
  compareSimTime,
  formatSimTime,
  parseSimTime,
  type SimTime,
  startOfDay,
} from "../../server/clock/time.ts";
import { Callout, SettingRow, SettingRows } from "../_shell/blocks.tsx";
import { simDay } from "../_shell/course.ts";
import { countOf, MESSAGES } from "../_shell/format.ts";
import { useTrace } from "../_shell/trace-provider.tsx";
import { buttonClass, SimClockPill } from "../_shell/ui.tsx";
import styles from "./settings.module.css";

const JUMP_DAYS = [2, 5, 10, 17];

type Move = { action: "advance" | "set" | "reset"; body?: unknown };

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

export function ClockControls({ sessionId }: { sessionId: string }) {
  const { simNow } = useTrace();
  const [answered, setAnswered] = useState<SimTime | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<ReactNode>(null);

  // The stream's next clock event replaces the route's answer.
  const streamed = simNow && formatSimTime(simNow);
  useEffect(() => {
    if (streamed) setAnswered(null);
  }, [streamed]);
  const now = answered ?? simNow;

  async function move({ action, body }: Move) {
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/sim/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (res.status === 409) {
        setNote("لا تعود الساعة إلى الوراء. أعد الضبط أولًا.");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = (await res.json()) as { now: string; events: CoachEvent[] };
      setAnswered(parseSimTime(result.now));
      setNote(
        action === "reset"
          ? "عادت الجلسة إلى بيانات العرض، والساعة إلى يوم البدء."
          : firedNote(result.events),
      );
    } catch {
      setNote("تعذّر تحريك الساعة.");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || now === null;
  const passed = (day: number) => now !== null && compareSimTime(startOfDay(day), now) <= 0;

  return (
    <>
      <SettingRows>
        <SettingRow
          label="الوقت الآن"
          labelId="clock-now"
          help="يرى المدرب هذا الوقت. تقديم الساعة يُطلق رسائل المدرب المستحقة بالترتيب، مرة واحدة لكل رسالة."
        >
          <SimClockPill now={now} running={false} />
          <fieldset className={styles.buttons} aria-labelledby="clock-now" disabled={disabled}>
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
          help="تنتقل الساعة إلى بداية اليوم، ٩:٠٠ ص، وتُطلق في طريقها كل رسالة حلّ موعدها."
        >
          <fieldset className={styles.buttons} aria-labelledby="clock-jump" disabled={disabled}>
            {JUMP_DAYS.map((day) => (
              <button
                key={day}
                type="button"
                className={buttonClass("secondary", "sm")}
                disabled={passed(day)}
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
      <div className={note ? styles.panelNote : undefined} role="status">
        {note && <Callout icon={Info}>{note}</Callout>}
      </div>
    </>
  );
}
