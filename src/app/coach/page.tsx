// Coach messages (#15 slot; the coach is #25): the coach events the scheduler fired on the sim
// clock (#23), delivered by the notifier (#22) to a simulated phone, labelled as a simulated channel
// (ADR-004), beside the queue and the limits the coach keeps (quiet hours, weekly time, «توقف»).
// The learner replies from the phone, and «توقف» stops the messages.

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
import { connection } from "next/server";
import { Fragment } from "react";
import { loadOmarSeed } from "../../../demo/seed.ts";
import { DEMO_SESSION_ID } from "../../../demo/session.ts";
import { config } from "../../config.ts";
import { hhmm, parseSimTime } from "../../server/clock/time.ts";
import { sessionSim } from "../../server/coach/session.ts";
import { phoneThread, readInbox, type ThreadItem } from "../../server/notifier/adapters.ts";
import { createFileStore } from "../../server/store/store.ts";
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
import { COACH_STATUS, COACH_TITLE, simDay, simTimeText } from "../_shell/course.ts";
import { clockTime, countOf, HOURS } from "../_shell/format.ts";
import { BidiText, buttonClass, cx, Meta, StatusPill } from "../_shell/ui.tsx";
import styles from "./coach.module.css";
import { RefreshOnCoachEvents, ReplyBox } from "./phone.tsx";

export const metadata: Metadata = { title: "رسائل المدرب" };

// "day 2 12:00" as «١٢:٠٠ ظهرًا».
const timeOf = (simTs: string) => clockTime(hhmm(parseSimTime(simTs).minute));

// One line of the phone thread.
function ThreadLine({ item }: { item: ThreadItem }) {
  switch (item.kind) {
    case "suppressed":
      return <li className={styles.system}>لم تُرسل رسالة، لأن الرسائل متوقفة.</li>;
    case "sent":
      return (
        <li className={cx(styles.bubble, styles.mine)}>
          <p>
            <BidiText text={item.text} />
          </p>
          <p className={styles.bubbleMeta}>{timeOf(item.at)}</p>
        </li>
      );
    case "held":
      return (
        <li className={cx(styles.bubble, styles.queued)}>
          <p>
            <BidiText text={item.text} />
          </p>
          <p className={styles.bubbleMeta}>
            <Clock aria-hidden />
            {`في ساعات الهدوء، تصل ${timeOf(item.until)}`}
          </p>
        </li>
      );
    case "received":
      return (
        <li className={styles.bubble}>
          <p>
            <BidiText text={item.text} />
          </p>
          {item.cta && (
            <Link
              href="/lesson"
              className={buttonClass("primary", "sm", { className: styles.cta })}
            >
              {item.cta.label_ar}
            </Link>
          )}
          <p className={styles.bubbleMeta}>
            <Check aria-hidden />
            <Meta
              parts={
                item.held_from
                  ? [timeOf(item.at), `أُجّلت من ${timeOf(item.held_from)} لساعات الهدوء`]
                  : [timeOf(item.at)]
              }
            />
          </p>
        </li>
      );
  }
}

export default async function CoachPage() {
  // The phone reads the session store, so the page renders on each request.
  await connection();
  const seed = loadOmarSeed(config.demoTopic);
  const store = createFileStore();
  const { learner: profile, sim } = sessionSim(store, DEMO_SESSION_ID, seed);
  const consent = sim.consent();
  const now = sim.now();
  const events = [...sim.coachEvents()].sort((a, b) => a.sim_day - b.sim_day);
  const thread = phoneThread(readInbox(store, DEMO_SESSION_ID), sim.outbox());
  const quiet = consent.quiet_hours;
  const quietText = quiet
    ? `لا رسائل من ${clockTime(quiet.start)} حتى ${clockTime(quiet.end)}`
    : "لم تحدد ساعات هدوء";
  // The day the learner agreed takes its place among the thread's days.
  const consentDay = consent.granted ? (consent.granted_sim_day ?? 0) : null;
  const dayOf = (item: ThreadItem) => parseSimTime(item.at).day;
  const days = [
    ...new Set([...thread.map(dayOf), ...(consentDay === null ? [] : [consentDay])]),
  ].sort((a, b) => a - b);

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
              تُرسل الرسالة حين تبلغ الساعة المحاكاة يومها. الساعة الآن {simTimeText(now)}، وتحرّكها
              من <Link href="/settings">الإعدادات</Link>.
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
              <MarkItem mark={<Moon />} title="ساعات الهدوء" detail={`${quietText}.`} />
              <MarkItem
                mark={<Clock />}
                title="وقتك في الأسبوع"
                detail={`يقترح الجلسات ضمن ${countOf(profile.hours_per_week, HOURS)} في الأسبوع، ولا يتجاوزها.`}
              />
              <MarkItem
                mark={<OctagonX />}
                title="كلمة «توقف»"
                detail={
                  consent.opted_out
                    ? `توقفت الرسائل في ${simDay(consent.opted_out_sim_day ?? now.day)}، وتعيد تفعيلها من صفحة حدودك.`
                    : "أرسلها في أي وقت، فتتوقف الرسائل فورًا."
                }
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
              <span>{clockTime(hhmm(now.minute))}</span>
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
            <div className={styles.thread}>
              <ol className={styles.messages} aria-label="الرسائل">
                {consentDay === null && (
                  <li className={styles.system}>
                    {`لم يوافق ${profile.name} على رسائل المدرب بعد.`}
                  </li>
                )}
                {days.map((d) => (
                  <Fragment key={d}>
                    <li className={styles.day}>{simDay(d)}</li>
                    {d === consentDay && (
                      <li className={styles.system}>
                        {`وافق ${profile.name} على رسائل المدرب. ${quietText}.`}
                      </li>
                    )}
                    {thread
                      .filter((item) => dayOf(item) === d)
                      .map((item) => (
                        <ThreadLine key={item.id} item={item} />
                      ))}
                  </Fragment>
                ))}
              </ol>
            </div>
            <ReplyBox sessionId={DEMO_SESSION_ID} optedOut={consent.opted_out} />
          </div>
        </section>
      </div>
      <RefreshOnCoachEvents />
    </Page>
  );
}
