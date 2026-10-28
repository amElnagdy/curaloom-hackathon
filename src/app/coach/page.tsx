// Coach messages (#15 slot; the notifier and coach are #22 and #25): Omar's seeded coach event on a
// simulated phone, labelled as a simulated channel (ADR-004), beside the queue and the limits the
// coach keeps (quiet hours, weekly time, «توقف»).

import {
  BatteryFull,
  Check,
  Clock,
  MessageSquare,
  Moon,
  OctagonX,
  Signal,
  Smartphone,
  Wifi,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";
import type { CoachEvent } from "../../../contracts/index.ts";
import { loadOmarSeed } from "../../../demo/seed.ts";
import { config } from "../../config.ts";
import {
  ChannelTag,
  EmptyState,
  MarkItem,
  MarkList,
  Page,
  PageHead,
  Panel,
  Stack,
} from "../_shell/blocks.tsx";
import { COACH_STATUS, COACH_TITLE, simDay } from "../_shell/course.ts";
import { clockTime, countOf, HOURS } from "../_shell/format.ts";
import { BidiText, buttonClass, cx, Meta, StatusPill } from "../_shell/ui.tsx";
import styles from "./coach.module.css";

export const metadata: Metadata = { title: "رسائل المدرب" };

// One coach event in the phone thread, as its status allows.
function ThreadEvent({ event }: { event: CoachEvent }) {
  if (event.status === "suppressed_quiet_hours") {
    return <li className={styles.system}>أُجّلت رسالة لأن موعدها وقع في ساعات الهدوء.</li>;
  }
  if (event.status === "suppressed_opt_out") {
    return <li className={styles.system}>لم تُرسل رسالة، لأن الرسائل متوقفة بطلبك.</li>;
  }
  const queued = event.status === "queued";
  return (
    <li className={cx(styles.bubble, queued && styles.queued)}>
      <p>
        <BidiText text={event.message_ar} />
      </p>
      <p className={styles.bubbleMeta}>
        {queued ? <Clock aria-hidden /> : <Check aria-hidden />}
        {queued ? "مجدولة، لم تُرسل بعد" : "أُرسلت"}
      </p>
    </li>
  );
}

export default function CoachPage() {
  const seed = loadOmarSeed(config.demoTopic);
  const { consent, profile } = seed;
  const events = [...seed.coach_events].sort((a, b) => a.sim_day - b.sim_day);
  const quiet = consent.quiet_hours;
  const quietText = quiet
    ? `لا رسائل من ${clockTime(quiet.start)} حتى ${clockTime(quiet.end)}`
    : "لم تحدد ساعات هدوء";
  const consentDay = consent.granted_sim_day ?? 0;
  const days = [...new Set(events.map((e) => e.sim_day))];

  return (
    <Page>
      <PageHead
        title="رسائل المدرب"
        pill={<ChannelTag />}
        lede="يرسل المدرب رسائل قصيرة بالفصحى ضمن الحدود التي وضعتها. في هذا العرض تصل الرسائل إلى هاتف محاكى، لا إلى هاتف حقيقي."
      />

      <div className={styles.layout}>
        <Stack>
          <Panel id="queue-title" title="الرسائل المجدولة">
            {events.length === 0 ? (
              <EmptyState
                inline
                icon={MessageSquare}
                text="لا رسائل مجدولة بعد. يجدولها المدرب بعد أن تجهز خطتك."
              />
            ) : (
              <MarkList>
                {events.map((event) => {
                  const { status, label } = COACH_STATUS[event.status];
                  return (
                    <MarkItem
                      key={event.id}
                      mark={<MessageSquare />}
                      title={COACH_TITLE[event.type]}
                      detail={
                        event.status === "queued" ? (
                          <Meta parts={[simDay(event.sim_day), "تُرسل خارج ساعات الهدوء"]} />
                        ) : (
                          simDay(event.sim_day)
                        )
                      }
                      value={<StatusPill status={status}>{label}</StatusPill>}
                    />
                  );
                })}
              </MarkList>
            )}
            <p className={styles.note}>
              تُرسل الرسالة حين تبلغ الساعة المحاكاة يومها. الساعة لم تبدأ بعد، وتجدها في{" "}
              <Link href="/settings">الإعدادات</Link>.
            </p>
          </Panel>

          <Panel
            id="limits-title"
            title="ما يلتزم به المدرب"
            aside={
              <Link href="/consent" className={buttonClass("ghost", "sm")}>
                حدودك
              </Link>
            }
          >
            <MarkList>
              <MarkItem
                mark={<Moon />}
                title="ساعات الهدوء"
                detail={`${quietText}، فلا تصلك رسائل صباحية.`}
              />
              <MarkItem
                mark={<Clock />}
                title="وقتك في الأسبوع"
                detail={`يقترح الجلسات ضمن ${countOf(profile.hours_per_week, HOURS)} في الأسبوع، ولا يتجاوزها.`}
              />
              <MarkItem
                mark={<OctagonX />}
                title="كلمة «توقف»"
                detail="أرسلها في أي وقت، فتتوقف الرسائل فورًا."
              />
              <MarkItem
                mark={<Smartphone />}
                title="القناة"
                detail="محاكاة: تظهر الرسائل في هذا الهاتف فقط."
              />
            </MarkList>
          </Panel>
        </Stack>

        <section className={styles.phone} aria-label={`هاتف ${profile.name} المحاكى`}>
          <div className={styles.screen}>
            <div className={styles.statusBar} aria-hidden>
              {/* The phone shows the simulated clock, which has not started (#23). */}
              <span>لم تبدأ</span>
              <span className={styles.statusIcons}>
                <Signal />
                <Wifi />
                <BatteryFull />
              </span>
            </div>
            <div className={styles.chatBar}>
              <span className={styles.avatar} aria-hidden>
                م
              </span>
              <span className={styles.who}>
                <b>المدرب</b>
                <small>
                  <Meta parts={["قناة محاكاة", "لا تصل رسائل حقيقية"]} />
                </small>
              </span>
            </div>
            <ol className={styles.thread} aria-label="الرسائل">
              <li className={styles.day}>{simDay(consentDay)}</li>
              <li className={styles.system}>
                {consent.granted
                  ? `وافق ${profile.name} على رسائل المدرب. ${quietText}.`
                  : `لم يوافق ${profile.name} على رسائل المدرب بعد.`}
              </li>
              {days.map((d) => (
                <Fragment key={d}>
                  {d !== consentDay && <li className={styles.day}>{simDay(d)}</li>}
                  {events
                    .filter((e) => e.sim_day === d)
                    .map((event) => (
                      <ThreadEvent key={event.id} event={event} />
                    ))}
                </Fragment>
              ))}
            </ol>
            <div className={styles.compose}>
              <button type="button" className={styles.stop} disabled aria-describedby="reply-note">
                <OctagonX aria-hidden />
                توقف
              </button>
              <span className={styles.field} id="reply-note">
                الرد من هذا الهاتف غير متاح بعد
              </span>
            </div>
          </div>
        </section>
      </div>
    </Page>
  );
}
