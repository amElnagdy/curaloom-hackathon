// The learner's return on the plan page (#27, #26), at the top of the plan: a welcome, the ask they
// answered the coach with, and three numbered steps. While the comeback is open the first step is
// the recap; once the recap is graded the page is drawn again, and the same section shows the
// re-planner's proposal in its place: the plan in force over the proposed one, day by day, what
// code checked, every change, and the decision bar. Nothing here writes; the client pieces post.

import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  Feather,
  Hourglass,
  type LucideIcon,
  PencilLine,
  Sunrise,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { CoursePlan } from "../../../contracts/index.ts";
import {
  LIGHTER_SHARE,
  lighterCap,
  lighterWeek,
  lightestWeek,
} from "../../server/agents/architect/replan.ts";
import type { KeylessQuiz } from "../../server/agents/examiner/rules.ts";
import type { Recap } from "../../server/coach/coach.ts";
import { simDay } from "../_shell/course.ts";
import {
  arabicNumber,
  countOf,
  MINUTES,
  ordinal,
  percent,
  QUESTIONS,
  SESSIONS,
} from "../_shell/format.ts";
import { changeTally, REASON_LABEL, sessionChanges, startDay } from "../_shell/plans.ts";
import { BidiText, ReplayNote, StatusPill } from "../_shell/ui.tsx";
import { FocusOnArrival, QuizPaper } from "../quiz/paper.tsx";
import styles from "./comeback.module.css";
import { missedSessions, proposalStats, type Timeline, timeline } from "./compare.ts";
import { DetectOnOpen, ProposalActions, ReplanNow } from "./proposal.tsx";

export const PROPOSAL_TITLE_ID = "proposal-title";

// Where the comeback stands: the card while it is open, with the recap or none to take, then the
// proposal its re-plan made.
export type ComebackStage =
  | {
      kind: "card";
      due: boolean;
      away_days: number;
      reason: CoursePlan["reason"];
      recap: KeylessQuiz | null;
    }
  | { kind: "proposal"; proposal: CoursePlan; recap: Recap | null };

// The learner's check-in answer this comeback builds on, and the day they gave it.
export type Ask = { choice: "shrink" | "switch"; day: number };

const ASK_TEXT: Record<Ask["choice"], string> = {
  shrink: "طلبتَ جلسات أقصر، وسنبني عليها.",
  switch: "طلبتَ مصدرًا آخر، وسنبني عليه.",
};

const REASON_ICON: Record<CoursePlan["reason"], LucideIcon> = {
  initial: PencilLine,
  learner_edit: PencilLine,
  inactivity_d5: Feather,
  shrink: Hourglass,
  switch: ArrowLeftRight,
  comeback: Sunrise,
};

// Counts after «غبتَ», «من» and «في نحو», which take the accusative and genitive duals.
const AWAY = { one: "يومًا واحدًا", two: "يومين", few: "أيام", many: "يومًا" };
const questionsOf = (n: number) => (n === 2 ? "سؤالين" : countOf(n, QUESTIONS));
const minutesOf = (n: number) => (n === 2 ? "دقيقتين" : countOf(n, MINUTES));

type Step = { at: "done" | "now" | "next"; title: string; head?: ReactNode; body?: ReactNode };

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol>
      {steps.map((step, i) => (
        <li key={step.title} className={styles.node} data-at={step.at}>
          <span className={styles.num} aria-hidden>
            {step.at === "done" ? <Check /> : arabicNumber(i + 1)}
          </span>
          <div className={styles.nodeBody}>
            <div className={styles.nodeHead}>{step.head ?? <h3>{step.title}</h3>}</div>
            {step.body}
          </div>
        </li>
      ))}
    </ol>
  );
}

const LEGEND = {
  done: "أتممتها",
  missed: "فاتتك",
  plan: "جلسة قادمة",
  review: "مراجعة",
  band: "أسبوعك الأخف",
  out: "لم تكن في خطتك بعد",
};

// A day's number under the timeline: today and the first day by name.
const dayNum = (day: number, today: number) =>
  day === today ? "اليوم" : day === 0 ? "البدء" : arabicNumber(day);

// The timeline's bars are taller than the week strip's: 30 minutes is full height, so a shorter
// session reads at a glance.
const FULL_BAR = 30;

function TimelineView({
  data,
  budget,
  lighter,
}: {
  data: Timeline;
  budget: number;
  // The proposal's lighter week against its cap, for the band's label.
  lighter?: { minutes: number; cap: number };
}) {
  const { days, today, weeks, rows, moves, band } = data;
  const [before, after] = rows;
  const x = (day: number) => (days - day - 0.5) * 10;
  const versionLabel = (version: number) => `النسخة ${arabicNumber(version)}`;
  const cells = (row: typeof before, index: number) =>
    row?.days.map((d) => (
      <span
        key={d.day}
        className={styles.day}
        data-row={index}
        data-out={d.out || undefined}
        data-band={d.band || undefined}
        data-today={d.day === today || undefined}
      >
        {d.state && (
          <i
            className={styles.bar}
            data-state={d.state}
            style={{ blockSize: `${(Math.min(d.minutes, FULL_BAR) / FULL_BAR) * 100}%` }}
            title={`${simDay(d.day)}: ${countOf(d.minutes, MINUTES)}`}
          />
        )}
      </span>
    ));
  const keys = after
    ? (Object.keys(LEGEND) as (keyof typeof LEGEND)[])
    : (["done", "missed", "plan"] as const);
  return (
    <>
      <div
        className={styles.timeline}
        role="img"
        aria-label={
          after
            ? "خطتك الآن فوق الخطة المقترحة، يومًا بيوم، مع الجلسات المنقولة"
            : "خطتك الآن يومًا بيوم، والجلسات التي فاتتك"
        }
      >
        <div
          className={styles.grid}
          data-moves={after ? "" : undefined}
          style={{ "--days": days } as CSSProperties}
        >
          <span className={styles.label} />
          {weeks.map((w, i) => (
            <span key={ordinal(i)} className={styles.week}>
              الأسبوع {ordinal(i)}
              <small>
                {w.after === null ? (
                  `${countOf(w.before ?? 0, MINUTES)} من ${arabicNumber(budget)}`
                ) : w.before === null ? (
                  <>
                    جديد: <b>{countOf(w.after, MINUTES)}</b>
                  </>
                ) : (
                  <>
                    {arabicNumber(w.before)} ← <b>{countOf(w.after, MINUTES)}</b>
                  </>
                )}
              </small>
            </span>
          ))}
          <span className={styles.label}>
            <b>خطتك الآن</b>
            {before && <small>{versionLabel(before.version)}</small>}
          </span>
          {cells(before, 0)}
          {after && (
            <>
              <span className={styles.label} data-moves>
                <small>نُقلت {arabicNumber(moves.length)}</small>
              </span>
              <span className={styles.moves} style={{ gridColumn: `span ${days}` }}>
                <svg viewBox={`0 0 ${days * 10} 40`} preserveAspectRatio="none" aria-hidden>
                  {moves.map((m) => (
                    <path
                      key={m.session}
                      d={`M${x(m.from)} 0 C${x(m.from)} 22 ${x(m.to)} 18 ${x(m.to)} 40`}
                      data-missed={m.missed || undefined}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </svg>
              </span>
              <span className={styles.label}>
                <b>المقترحة</b>
                <small>{versionLabel(after.version)}</small>
              </span>
              {cells(after, 1)}
            </>
          )}
          <span className={styles.label} />
          {before?.days.map(({ day }) => (
            <span key={day} className={styles.dayNum} data-today={day === today || undefined}>
              {dayNum(day, today)}
            </span>
          ))}
          {band && lighter && (
            <>
              <span className={styles.label} />
              <span
                className={styles.bandLabel}
                style={{ gridColumn: `${band.from + 2} / span ${Math.min(7, days - band.from)}` }}
              >
                أسبوعك الأخف: {arabicNumber(lighter.minutes)} من {countOf(lighter.cap, MINUTES)}
              </span>
            </>
          )}
        </div>
      </div>
      <p className={styles.legend}>
        {keys.map((key) => (
          <span key={key}>
            <i data-state={key} aria-hidden />
            {LEGEND[key]}
          </span>
        ))}
      </p>
    </>
  );
}

// «مراجعتك ٣ من ٥ (٦٠٪)، أقل من ٨٠٪، فتبدأ الخطة بجلسة مراجعة للدرس الأول.» In replay, a recap
// graded from the recorded answers is «المراجعة المسجّلة» (#55).
function recapText(recap: Recap, lessons: CoursePlan["committed"]["lessons"]) {
  const right = recap.attempt.answers.filter((a) => a.score === 1).length;
  const score = `${arabicNumber(right)} من ${arabicNumber(recap.quiz.items.length)} (${percent(recap.attempt.score)})`;
  const gate = percent(recap.quiz.pass_threshold);
  const review = lessons.findIndex((l) => l.id === recap.review_lesson);
  const whose = recap.replaced ? "المراجعة المسجّلة" : "مراجعتك";
  const line =
    recap.below_gate && review >= 0
      ? `${whose} ${score}، أقل من ${gate}، فتبدأ الخطة بجلسة مراجعة للدرس ${ordinal(review)}.`
      : `${whose} ${score}، عند ${gate} أو فوقها، فلا مراجعة قبل درسك التالي.`;
  return { score, line };
}

const MISSED_TITLE = (n: number) =>
  n === 1
    ? "السؤال الذي أخطأت فيه"
    : n === 2
      ? "السؤالان اللذان أخطأت فيهما"
      : `الأسئلة التي أخطأت فيها (${arabicNumber(n)})`;
const RECORDED_MISSED_TITLE = (n: number) =>
  n === 1
    ? "الإجابة الخاطئة في المراجعة المسجّلة"
    : n === 2
      ? "الإجابتان الخاطئتان في المراجعة المسجّلة"
      : `الإجابات الخاطئة في المراجعة المسجّلة (${arabicNumber(n)})`;

function RecapResult({
  recap,
  lessons,
}: {
  recap: Recap;
  lessons: CoursePlan["committed"]["lessons"];
}) {
  const { line } = recapText(recap, lessons);
  const missed = recap.attempt.answers.flatMap((a) => {
    const item = recap.quiz.items.find((i) => i.id === a.item_id);
    return item && a.score < 1 ? [{ a, item }] : [];
  });
  return (
    <div className={styles.recapDone}>
      <p>{line}</p>
      {recap.replaced && (
        <ReplayNote>
          في العرض المسجّل صُحّحت إجابات المراجعة المسجّلة بدل إجاباتك، فالعرض لا يقترح مصدرًا آخر إلا
          بعدها.
        </ReplayNote>
      )}
      {missed.length > 0 && (
        <details className={styles.fold}>
          <summary>
            <ChevronDown aria-hidden className={styles.chev} />
            <span>{(recap.replaced ? RECORDED_MISSED_TITLE : MISSED_TITLE)(missed.length)}</span>
          </summary>
          <ul className={styles.missList}>
            {missed.map(({ a, item }) => (
              <li key={item.id}>
                <span className={styles.missPrompt}>
                  <BidiText text={item.prompt_ar} />
                </span>
                <span className={styles.missMine}>
                  {recap.replaced ? "الإجابة المسجّلة" : "إجابتك"}: <BidiText text={a.response} />
                </span>
                <span className={styles.missRight}>
                  الصحيحة: <BidiText text={item.answer} />
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const TAG: Record<CoursePlan["diff"][number]["op"], string> = {
  review: "مراجعة",
  move: "نقل",
  shorten: "تقصير",
  switch: "مصدر",
  drop: "حذف",
  extend: "تمديد",
};

function ProposalBody({
  current,
  original,
  proposal,
  passed,
  today,
  budget,
}: {
  current: CoursePlan;
  original: CoursePlan;
  proposal: CoursePlan;
  passed: ReadonlySet<string>;
  today: number;
  budget: number;
}) {
  const from = startDay(proposal);
  const lighter = { minutes: lighterWeek(proposal, from), cap: lighterCap(original) };
  const changes = sessionChanges(current, proposal);
  return (
    <>
      {proposal.explanation_ar && (
        <>
          <p className={styles.explain}>
            <b>لماذا تغيّرت؟</b> <BidiText text={proposal.explanation_ar} />
          </p>
          <p className={styles.byline}>كتبه مُعيد التخطيط، وتحقّق الكود من كل رقم فيه.</p>
        </>
      )}
      <TimelineView
        data={timeline(current, passed, today, proposal)}
        budget={budget}
        lighter={lighter}
      />
      <div className={styles.stats}>
        {proposalStats(current, proposal, passed, today).map((s) => (
          <div key={s.label} className={styles.stat}>
            <b>{s.value}</b>
            <span>{s.label}</span>
          </div>
        ))}
      </div>
      <p className={styles.check}>
        <Check aria-hidden />
        <span>
          أسبوعك الأخف ({simDay(from)} إلى {arabicNumber(from + 6)}):{" "}
          <b>{countOf(lighter.minutes, MINUTES)}</b>، والحد {arabicNumber(lighter.cap)}، أي{" "}
          {percent(LIGHTER_SHARE)} من أخف أسبوع في خطتك الأولى (
          {countOf(lightestWeek(original), MINUTES)}).
        </span>
      </p>
      <details className={`${styles.fold} ${styles.changesFold}`}>
        <summary>
          <ChevronDown aria-hidden className={styles.chev} />
          <span>كل التغييرات ({arabicNumber(proposal.diff.length)})</span>
          <small className={styles.summaryNote}>{changeTally(proposal.diff)}</small>
        </summary>
        <ol className={styles.changes}>
          {changes.map((c) => (
            <li key={c.text}>
              <span>{c.text}</span>
              <span className={styles.tags}>
                {c.tags.map((op) => (
                  <span key={op} className={styles.tag} data-op={op}>
                    {TAG[op]}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </>
  );
}

export function Comeback({
  sessionId,
  name,
  today,
  versions,
  passed,
  budget,
  ask,
  stage,
}: {
  sessionId: string;
  name: string;
  today: number;
  // The plan's versions, oldest first; the last is in force.
  versions: CoursePlan[];
  passed: ReadonlySet<string>;
  budget: number;
  ask: Ask | null;
  stage: ComebackStage;
}) {
  const current = versions.at(-1);
  const original = versions[0];
  if (!current || !original) return null;
  const missed = missedSessions(current, passed, today);
  const missedNote = (after: string) =>
    missed && (
      <p className={styles.missedNote}>
        فاتتك <b>{countOf(missed.count, SESSIONS)}</b>{" "}
        {missed.from === missed.to
          ? `في ${simDay(missed.from)}`
          : `بين ${simDay(missed.from)} و${simDay(missed.to)}`}
        . لا بأس، {missed.count === 2 ? "نرتّبهما" : "نرتّبها"} {after}.
      </p>
    );

  let lede: string;
  let steps: Step[];
  if (stage.kind === "card") {
    const away = `غبتَ ${countOf(stage.away_days, AWAY)}، ولا بأس.`;
    const { recap } = stage;
    const proposalNext: Step = {
      at: "next",
      title: "خطة مقترحة",
      head: (
        <>
          <h3>خطة مقترحة</h3>
          <span className={styles.nodeMeta}>بعد مراجعتك</span>
        </>
      ),
    };
    if (recap) {
      const n = recap.items.length;
      lede = `${away} أجب عن مراجعة من ${questionsOf(n)} في نحو ${minutesOf(n)}، ثم نرتّب خطتك على ما تتذكره.`;
      steps = [
        {
          at: "now",
          title: "مراجعة",
          head: (
            <>
              <h3>مراجعة</h3>
              <span className={styles.nodeMeta}>
                {countOf(n, QUESTIONS)} في نحو {minutesOf(n)}
              </span>
            </>
          ),
          body: (
            <>
              {missedNote("بعد مراجعتك")}
              <TimelineView data={timeline(current, passed, today)} budget={budget} />
              <QuizPaper
                quiz={recap}
                sessionId={sessionId}
                lessonId={recap.lesson_id}
                submitUrl={`/api/sessions/${encodeURIComponent(sessionId)}/comeback/recap`}
                intro="لا تغيّر هذه المراجعة نتائج دروسك. أسئلتها اختيار من متعدد، ويصححها الكود بمفتاحها."
                grading={{
                  title: "نصحح إجاباتك ونرتّب خطتك",
                  step: "يصحح الكود إجاباتك بمفتاحها، ثم يرتّب مُعيد التخطيط خطتك",
                  detail: "تظهر خطتك المقترحة هنا حين تجهز، ولا يتغيّر شيء في خطتك حتى تعتمدها.",
                }}
              />
            </>
          ),
        },
        proposalNext,
      ];
    } else {
      lede = `${away} نرتّب خطتك من اليوم، ثم تقرّر إن كنت تعتمدها.`;
      steps = [
        {
          at: "now",
          title: "خطة مقترحة",
          body: (
            <>
              {missedNote("من اليوم")}
              <TimelineView data={timeline(current, passed, today)} budget={budget} />
              <ReplanNow sessionId={sessionId} focusId={PROPOSAL_TITLE_ID} />
            </>
          ),
        },
      ];
    }
  } else {
    const { proposal, recap } = stage;
    const lessons = proposal.committed.lessons;
    const ReasonIcon = REASON_ICON[proposal.reason];
    lede = recap
      ? "رتّبنا خطتك على ما تتذكره. قارن خطتك الآن بالمقترحة، ثم قرّر."
      : "رتّبنا خطتك من اليوم. قارن خطتك الآن بالمقترحة، ثم قرّر.";
    const proposalNow: Step = {
      at: "now",
      title: "خطة مقترحة",
      head: (
        <>
          <h3 id={PROPOSAL_TITLE_ID} tabIndex={-1}>
            خطة مقترحة: النسخة {arabicNumber(proposal.version)}
          </h3>
          <span className={styles.reason}>
            <ReasonIcon aria-hidden />
            {REASON_LABEL[proposal.reason]}
          </span>
        </>
      ),
      body: (
        <ProposalBody
          current={current}
          original={original}
          proposal={proposal}
          passed={passed}
          today={today}
          budget={budget}
        />
      ),
    };
    steps = recap
      ? [
          {
            at: "done",
            title: "مراجعة",
            head: (
              <>
                <h3>مراجعة</h3>
                <StatusPill status={recap.below_gate ? "attention" : "ready"}>
                  {recapText(recap, lessons).score}
                </StatusPill>
              </>
            ),
            body: <RecapResult recap={recap} lessons={lessons} />,
          },
          proposalNow,
        ]
      : [proposalNow];
  }
  steps.push({
    at: "next",
    title: "موافقتك",
    head: (
      <>
        <h3>موافقتك</h3>
        <span className={styles.nodeMeta}>تعتمد الخطة الجديدة أو تبقي خطتك</span>
      </>
    ),
  });

  return (
    <section className={styles.comeback} aria-labelledby="comeback-title">
      <div className={styles.head}>
        <div>
          <h2 className={styles.title} id="comeback-title">
            أهلًا بعودتك يا {name}
          </h2>
          <p className={styles.lede}>{lede}</p>
        </div>
        {ask && (
          <p className={styles.ask}>
            {ASK_TEXT[ask.choice]}
            <small>ردّك على المدرب، {simDay(ask.day)}</small>
          </p>
        )}
      </div>
      <Steps steps={steps} />
      {stage.kind === "proposal" && (
        <div className={styles.decide}>
          <p>لن يتغيّر شيء في خطتك حتى تعتمدها.</p>
          <ProposalActions sessionId={sessionId} version={stage.proposal.version} />
        </div>
      )}
      {stage.kind === "card" && stage.due && <DetectOnOpen sessionId={sessionId} />}
      {stage.kind === "proposal" && stage.recap && (
        <FocusOnArrival quizId={stage.recap.quiz.id} headingId={PROPOSAL_TITLE_ID} />
      )}
    </section>
  );
}
