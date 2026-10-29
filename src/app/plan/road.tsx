"use client";

// The plan's client side (#18). Building asks the server for the plan once the intake is done and
// shows the page again when it is ready; the page's lede, status and body read from it whether the
// build failed. Road draws the modules in order; a module in the committed
// weeks lists its sessions and their sources, and the learner can move a session to another day of
// its module or make it shorter. The editor checks a change with the plan's own rules before it is sent, and the server
// checks it again.

import { CalendarClock, Check, Hourglass, RotateCcw, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useTransition,
} from "react";
import type { CoursePlan, Resource } from "../../../contracts/index.ts";
import {
  applyEdit,
  type Limits,
  moduleDays,
  type PlanEdit,
  SESSION_MINUTES,
  type Violation,
  weekMinutes,
} from "../../server/agents/architect/rules.ts";
import { Callout } from "../_shell/blocks.tsx";
import { type Session, sessionsOf, simDay } from "../_shell/course.ts";
import { arabicNumber, countOf, MINUTES, ordinal, ordinalF, WEEKS } from "../_shell/format.ts";
import { BidiText, buttonClass, cx, LangBadge, StatusPill } from "../_shell/ui.tsx";
import styles from "./plan.module.css";

type Op = PlanEdit["op"];

const planUrl = (sessionId: string, action: string) =>
  `/api/sessions/${encodeURIComponent(sessionId)}/plan/${action}`;

const post = (sessionId: string, action: string, body: object, signal?: AbortSignal) =>
  fetch(planUrl(sessionId, action), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

// While another request builds the plan the server answers 409; this one waits and asks again.
const BUSY_RETRY_MS = 3000;

const BuildFailed = createContext({ failed: false, retry: () => {} });

// The page keys it by the learner's profile, so a new profile starts a new build. It stays mounted
// once the plan is shown, so the page keeps its focus when the plan arrives.
export function Building({
  sessionId,
  build,
  children,
}: {
  sessionId: string;
  build: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!build || failed) return;
    const abort = new AbortController();
    (async () => {
      while (!abort.signal.aborted) {
        const res = await post(sessionId, "build", {}, abort.signal).catch(() => null);
        if (abort.signal.aborted) return;
        if (res?.status === 409) {
          await new Promise((resolve) => setTimeout(resolve, BUSY_RETRY_MS));
          continue;
        }
        if (res?.ok) startTransition(() => router.refresh());
        else setFailed(true);
        return;
      }
    })();
    return () => abort.abort();
  }, [build, failed, sessionId, router]);

  return <BuildFailed value={{ failed, retry: () => setFailed(false) }}>{children}</BuildFailed>;
}

export function BuildingLede({ name }: { name: string }) {
  const { failed } = useContext(BuildFailed);
  if (failed) return <b>لم نتمكن من بناء خطتك هذه المرة يا {name}.</b>;
  return (
    <>
      <b>نبني خطتك الآن يا {name}.</b> يبحث الكشّاف عن مصادر مفتوحة الترخيص، ثم يقسّم المعماري الطريق
      على وقتك. قد يستغرق ذلك دقيقتين.
    </>
  );
}

export function BuildingStatus() {
  const { failed } = useContext(BuildFailed);
  return failed ? (
    <StatusPill status="failed">تعذّر البناء</StatusPill>
  ) : (
    <StatusPill status="building">تُبنى الآن</StatusPill>
  );
}

export function BuildingBody() {
  const { failed, retry } = useContext(BuildFailed);
  if (failed) {
    return (
      <div className={styles.buildFailed} role="alert">
        <Callout icon={TriangleAlert} tone="attention">
          تعذّر بناء خطتك هذه المرة. حاول مرة أخرى بعد قليل.
        </Callout>
        <button
          type="button"
          className={buttonClass("secondary")}
          onClick={() => {
            // The button goes with the failure; focus moves to the page's title, not the body.
            document.getElementById("plan-title")?.focus();
            retry();
          }}
        >
          <RotateCcw aria-hidden />
          حاول مرة أخرى
        </button>
      </div>
    );
  }
  return (
    <div aria-busy="true">
      <div className={styles.skeleton} data-size="why" />
      <section className={styles.section} aria-label="أسبوعاك الأولان">
        <div className={styles.skeleton} data-size="strip" />
      </section>
      <section className={styles.section} aria-label="الطريق">
        <div className={styles.skeleton} data-size="road" />
      </section>
    </div>
  );
}

// Session lengths the editor offers, longest first: the four nearest below the current length.
const LENGTHS = [10, 15, 20, 25, 30, 40, 45, 60, 75];
const shorterThan = (minutes: number) =>
  LENGTHS.filter((m) => m < minutes && m >= SESSION_MINUTES.min)
    .slice(-4)
    .reverse();

export function Road({
  sessionId,
  plan,
  limits,
  sources,
  editable,
}: {
  sessionId: string;
  plan: CoursePlan;
  limits: Limits;
  // Each resource's language and original title, to name a session's sources.
  sources: Record<string, Pick<Resource, "lang" | "title">>;
  editable: boolean;
}) {
  const [open, setOpen] = useState<{ id: string; op: Op } | null>(null);
  const sessions = sessionsOf(plan);
  // Days 0 to committedDays - 1 are the committed weeks.
  const committedDays = plan.committed.weeks * 7;
  const lesson = (s: Session) => plan.committed.lessons.find((l) => l.id === s.lesson_id);

  return (
    <ol className={styles.road}>
      {plan.road.map((step, index) => {
        const days = moduleDays(plan, index);
        const committed = days !== undefined && days.from < committedDays;
        const own = sessions.filter((s) => lesson(s)?.module === index);
        return (
          <li key={step.module} className={styles.node} data-committed={committed}>
            <span className={styles.num} aria-hidden>
              {arabicNumber(index + 1)}
            </span>
            <div className={styles.nodeBody}>
              <div className={styles.nodeHead}>
                <h3>
                  <BidiText text={step.module} />
                </h3>
                <span className={styles.nodeMeta}>{countOf(step.weeks, WEEKS)}</span>
                <StatusPill status={committed ? "ready" : "waiting"} quiet>
                  {committed ? "تلتزم بها الآن" : "لاحقًا"}
                </StatusPill>
              </div>
              {!committed && (
                <p className={styles.later}>نخطّط لها معك بعد الأسبوعين، على ما تعلّمته فيهما.</p>
              )}
              {committed && own.length === 0 && (
                <p className={styles.later}>لا جلسات لهذه الوحدة في أسبوعيك الأولين.</p>
              )}
              {committed && own.length > 0 && (
                <ul className={styles.agenda}>
                  {own.map((s) => {
                    const editing = open?.id === s.id ? open.op : undefined;
                    return (
                      <li
                        key={s.id}
                        className={styles.agendaRow}
                        data-editing={editing !== undefined}
                      >
                        <div className={styles.dayBox}>
                          <small>{s.day === 0 ? "يوم" : "اليوم"}</small>
                          <b>{s.day === 0 ? "البدء" : arabicNumber(s.day)}</b>
                        </div>
                        <div className={styles.rowTitle}>
                          <BidiText text={lesson(s)?.title_ar ?? ""} />
                          <small>
                            الجلسة {ordinalF(sessions.indexOf(s))}
                            {s.resource_ids.map((id) => {
                              const source = sources[id];
                              return (
                                source && (
                                  <span key={id} className={styles.rowSource}>
                                    <span className="sr-only">، </span>
                                    <LangBadge lang={source.lang} />
                                    <bdi lang={source.lang} title={source.title}>
                                      {source.title}
                                    </bdi>
                                  </span>
                                )
                              );
                            })}
                          </small>
                        </div>
                        <span className={styles.rowMinutes}>{countOf(s.minutes, MINUTES)}</span>
                        {editable && (
                          <span className={styles.rowActions}>
                            <button
                              type="button"
                              className={buttonClass("ghost", "sm")}
                              aria-expanded={editing === "move"}
                              onClick={() =>
                                setOpen(editing === "move" ? null : { id: s.id, op: "move" })
                              }
                            >
                              <CalendarClock aria-hidden />
                              انقل
                            </button>
                            <button
                              type="button"
                              className={buttonClass("ghost", "sm")}
                              aria-expanded={editing === "shorten"}
                              disabled={shorterThan(s.minutes).length === 0}
                              onClick={() =>
                                setOpen(editing === "shorten" ? null : { id: s.id, op: "shorten" })
                              }
                            >
                              <Hourglass aria-hidden />
                              أقصر
                            </button>
                          </span>
                        )}
                        {editing && days && (
                          <Editor
                            key={editing}
                            sessionId={sessionId}
                            plan={plan}
                            limits={limits}
                            session={s}
                            op={editing}
                            days={{ from: days.from, to: Math.min(days.to, committedDays) }}
                            onClose={() => setOpen(null)}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const SAVE_FAILED = "تعذّر حفظ التعديل. حاول مرة أخرى بعد قليل.";

type Days = { from: number; to: number };

// What the editor offers and says for each kind of edit.
const EDITS: Record<
  Op,
  {
    legend: string;
    prompt: string;
    label: (value: number) => string;
    current: (s: Session) => number;
    options: (s: Session, days: Days) => number[];
    edit: (s: Session, value: number) => PlanEdit;
  }
> = {
  move: {
    legend: "انقلها إلى",
    prompt: "اختر يومًا من أيام وحدتها.",
    label: simDay,
    current: (s) => s.day,
    options: (s, { from, to }) =>
      Array.from({ length: to - from }, (_, i) => from + i).filter((day) => day !== s.day),
    edit: (s, day) => ({ op: "move", session_id: s.id, day }),
  },
  shorten: {
    legend: "مدتها بالدقائق",
    prompt: "اختر مدة أقصر.",
    label: arabicNumber,
    current: (s) => s.minutes,
    options: (s) => shorterThan(s.minutes),
    edit: (s, minutes) => ({ op: "shorten", session_id: s.id, minutes }),
  },
};

function Editor({
  sessionId,
  plan,
  limits,
  session,
  op,
  days,
  onClose,
}: {
  sessionId: string;
  plan: CoursePlan;
  limits: Limits;
  session: Session;
  op: Op;
  // The committed days of the session's module, [from, to).
  days: Days;
  onClose: () => void;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<string[] | null>(null);
  const [refreshing, startTransition] = useTransition();

  const kind = EDITS[op];
  const edit = choice === null ? null : kind.edit(session, choice);
  const result = edit && applyEdit(plan, edit, limits);
  const week = Math.floor((edit?.op === "move" ? edit.day : session.day) / 7);
  const busy = saving || refreshing;
  const taken = (value: number) =>
    op === "move" && plan.committed.sessions.some((s) => s.day === value && s.id !== session.id);

  const pick = (value: number) => {
    setChoice(value);
    setRefused(null);
  };

  async function save() {
    if (!edit || !result?.ok) return;
    setSaving(true);
    try {
      const res = await post(sessionId, "edit", edit);
      if (res.ok) {
        // The page comes back with the new version, which closes this editor.
        startTransition(() => router.refresh());
        return;
      }
      const body: { violations?: Violation[] } = await res.json().catch(() => ({}));
      setRefused(body.violations?.map((v) => v.ar) ?? [SAVE_FAILED]);
      // A conflict may mean the plan is no longer the learner's: their profile changed since the
      // page was drawn. The page drawn again shows what is theirs now.
      if (res.status === 409) startTransition(() => router.refresh());
    } catch {
      setRefused([SAVE_FAILED]);
    } finally {
      setSaving(false);
    }
  }

  const problems = refused ?? (result && !result.ok ? result.violations.map((v) => v.ar) : null);

  return (
    <div className={styles.editor}>
      <fieldset className={styles.chips}>
        <legend className={styles.editorLabel}>{kind.legend}</legend>
        <div>
          <button type="button" className={styles.chip} data-now disabled>
            {kind.label(kind.current(session))}
          </button>
          {kind.options(session, days).map((value) => (
            <button
              key={value}
              type="button"
              className={styles.chip}
              aria-pressed={choice === value}
              data-taken={taken(value)}
              title={taken(value) ? "في هذا اليوم جلسة أخرى" : undefined}
              onClick={() => pick(value)}
            >
              {kind.label(value)}
            </button>
          ))}
        </div>
      </fieldset>
      <div className={styles.editorEnd}>
        <p className={cx(styles.editorCheck, problems && styles.editorProblem)} aria-live="polite">
          {problems ? (
            <>
              <TriangleAlert aria-hidden />
              {problems.join("، ")}
            </>
          ) : result?.ok ? (
            <>
              <Check aria-hidden />
              الأسبوع {ordinal(week)}: {arabicNumber(weekMinutes(result.plan)[week] ?? 0)} من{" "}
              {arabicNumber(limits.budget_minutes)} دقيقة من وقتك
            </>
          ) : (
            kind.prompt
          )}
        </p>
        <button type="button" className={buttonClass("ghost", "sm")} onClick={onClose}>
          إلغاء
        </button>
        <button
          type="button"
          className={buttonClass("primary", "sm")}
          disabled={!result?.ok || busy || refused !== null}
          onClick={save}
        >
          {busy ? "يحفظ…" : "احفظ"}
        </button>
      </div>
    </div>
  );
}
