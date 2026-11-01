"use client";

// The live interview (#16): the chat on the inline start, «ما فهمناه منك» beside it. Each action
// posts to /api/sessions/:id/intake/{start,message,answers,reset} and answers the interview as it
// now stands. Under each learner message, a line names what the interviewer heard from it. The mic
// button records a voice message whose transcript fills the composer (#37).

import {
  ArrowRight,
  AudioLines,
  Check,
  CircleDashed,
  History,
  Languages,
  LoaderCircle,
  MessageCircle,
  Mic,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  Square,
} from "lucide-react";
import Link from "next/link";
import {
  type FormEvent,
  Fragment,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { LearnerProfile } from "../../../contracts/index.ts";
import type { Field, IntakeView, Turn } from "../../server/agents/intake/intake.ts";
import { MAX_VOICE_SECONDS } from "../../server/agents/intake/wav.ts";
import { MetaItem, PageHead, Panel } from "../_shell/blocks.tsx";
import { arabicDigits, arabicNumber, countOf, HOURS, QUESTIONS } from "../_shell/format.ts";
import {
  BidiText,
  buttonClass,
  cx,
  DirIcon,
  LangBadge,
  RecordedFill,
  Sep,
  type Status,
  StatusPill,
} from "../_shell/ui.tsx";
import { useStickToBottom } from "../_shell/use-stick-to-bottom.ts";
import styles from "./intake.module.css";
import { useVoiceMessage, type VoiceState } from "./use-voice-message.ts";

type Action = "start" | "message" | "answers" | "reset";
type Heard = IntakeView["heard"];
type Question = NonNullable<IntakeView["questions"]>[number];

const FIELDS: { field: Field; label: string }[] = [
  { field: "goal", label: "هدفك" },
  { field: "background", label: "خلفيتك" },
  { field: "hours_per_week", label: "وقتك في الأسبوع" },
  { field: "source_langs_ok", label: "لغات المصادر" },
  { field: "history_notes", label: "تجربتك السابقة" },
];
const LABEL = Object.fromEntries(FIELDS.map((f) => [f.field, f.label])) as Record<Field, string>;

const STATUS: Record<IntakeView["status"], { status: Status; label: string }> = {
  interview: { status: "building", label: "جارية" },
  diagnostic: { status: "building", label: "اختبار قصير" },
  done: { status: "ready", label: "مكتملة" },
};
const LEVEL: Record<LearnerProfile["diagnostic"]["level"], string> = {
  beginner: "مبتدئ",
  intermediate: "متوسط",
  advanced: "متقدم",
};
const DIALECT: Record<LearnerProfile["dialect"], string> = {
  msa: "الفصحى",
  gulf: "الخليجية",
  egyptian: "المصرية",
  levantine: "الشامية",
  maghrebi: "المغاربية",
  other: "لهجتك",
};
// Background tags the interviewer records, in Arabic; a tag not listed shows as written.
const BACKGROUND: Record<string, string> = {
  accounting: "المحاسبة",
  accountant: "المحاسبة",
  excel: "Excel",
  finance: "المالية",
  sql: "SQL",
  python: "Python",
};
const PLACEHOLDER: Record<IntakeView["status"], string> = {
  interview: "اكتب بلهجتك، يكفي سطر أو سطران",
  diagnostic: "أجب عن الأسئلة الثلاثة أولًا",
  done: "اكتملت المقابلة",
};

const minutes = (seconds: number) =>
  arabicDigits(`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`);
// What the composer says while a voice message is on its way. The recording's clock is hidden from
// screen readers, so they hear the status once rather than every second.
const VOICE_STATUS: Record<Exclude<VoiceState, "idle">, (seconds: number) => ReactNode> = {
  asking: () => "يطلب المتصفح إذنك باستعمال الميكروفون.",
  recording: (seconds) => (
    <>
      يسجّل الآن، اضغط زر الإيقاف حين تنتهي
      <span aria-hidden>
        <Sep />
        {minutes(seconds)} من {minutes(MAX_VOICE_SECONDS)}
      </span>
    </>
  ),
  playing: () => "تُشغَّل الرسالة الصوتية المسجّلة…",
  transcribing: () => "تتحوّل رسالتك الصوتية إلى نص تراجعه قبل الإرسال…",
};

function heardValue(field: Field, heard: Heard): ReactNode {
  switch (field) {
    case "goal":
      return heard.goal && <BidiText text={heard.goal} />;
    case "background":
      return (
        heard.background && (
          <BidiText text={heard.background.map((tag) => BACKGROUND[tag] ?? tag).join("، ")} />
        )
      );
    case "hours_per_week":
      return heard.hours_per_week !== null && countOf(heard.hours_per_week, HOURS);
    case "source_langs_ok":
      return (
        heard.source_langs_ok && (
          <span className={styles.langs}>
            {heard.source_langs_ok.map((lang) => (
              <LangBadge key={lang} lang={lang} />
            ))}
            تصلك بالعربية
          </span>
        )
      );
    case "history_notes":
      return heard.history_notes !== null && <BidiText text={heard.history_notes || "لا شيء"} />;
  }
}

export function Interview({
  sessionId,
  initial,
  recorded,
}: {
  sessionId: string;
  initial: IntakeView | null;
  // Replay only: the recorded run's messages, which the composer offers one at a time (#30), and
  // the first one spoken, whose transcription is recorded (#37). Without it the mic records.
  recorded?: { messages: readonly string[]; voiceClip: string };
}) {
  const [view, setView] = useState(initial);
  const [draft, setDraft] = useState("");
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // A transcript joins what the learner already typed, for them to edit and send.
  const fillTranscript = useCallback((text: string) => {
    setDraft((typed) => (typed.trim() ? `${typed.trimEnd()} ${text}` : text).slice(0, 1000));
    fieldRef.current?.focus();
  }, []);
  const [error, setError] = useState<string | null>(null);
  const voice = useVoiceMessage({ sessionId, onText: fillTranscript, onError: setError });
  // The message on its way, shown until the interviewer's reply replaces it.
  const [sending, setSending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Fields the latest reply heard: their rows flash once. Empty on load, so nothing flashes then.
  const [fresh, setFresh] = useState<Field[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});

  const post = useCallback(
    async (action: Action, body: object = {}): Promise<IntakeView | null> => {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/intake/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()).view;
    },
    [sessionId],
  );

  const start = useCallback(async () => {
    try {
      setView(await post("start"));
    } catch {
      setError("تعذّر بدء المقابلة. أعد تحميل الصفحة.");
    }
  }, [post]);

  const started = view !== null;
  useEffect(() => {
    if (!started) start();
  }, [started, start]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy || voice.state !== "idle") return;
    setDraft("");
    setSending(text);
    setError(null);
    setBusy(true);
    try {
      const next = await post("message", { text });
      const last = next?.turns.findLast((t) => t.role === "learner");
      setFresh(last?.role === "learner" ? last.heard : []);
      setView(next);
    } catch {
      setDraft(text);
      setError("لم يصل ردّ المحاور. أرسل رسالتك مرة أخرى.");
    } finally {
      setSending(null);
      setBusy(false);
    }
  }

  async function submitAnswers(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      setFresh([]);
      setView(await post("answers", { answers: picked }));
    } catch {
      setError("لم تُرسل إجاباتك. حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      await post("reset");
      setDraft("");
      setPicked({});
      setFresh([]);
      setView(await post("start"));
    } catch {
      setError("تعذّر البدء من جديد. حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  const status = view?.status ?? "interview";
  const turns = view?.turns ?? [];
  const questions = view?.questions ?? null;
  // The quick check sits after the interviewer's move to it, before the closing reply.
  const checkAt = status === "done" ? turns.length - 1 : turns.length;
  const thread = useStickToBottom<HTMLDivElement>(
    turns.length + (sending ? 2 : 0) + (questions ? 1 : 0),
  );
  const pill = STATUS[status];
  const dialect = view?.dialect;
  const sent = turns.filter((t) => t.role === "learner").length;
  const listening = voice.state !== "idle";
  const recording = voice.state === "recording";
  const waiting = status === "interview" && !busy && !listening;
  const nextRecorded = waiting ? recorded?.messages[sent] : undefined;
  const offerFill = nextRecorded !== undefined && draft !== nextRecorded;
  // The clip speaks the first recorded message, so it is offered until that one is sent.
  const offerVoice = waiting && recorded !== undefined && sent === 0 && !draft;

  // The quick check is taller than the thread, so it opens at its top, under the move to it. The
  // closing reply lands below a thread the reader has scrolled, so the thread jumps to it.
  const checkRef = useRef<HTMLFormElement>(null);
  const { ref: threadRef, jump } = thread;
  useEffect(() => {
    const list = threadRef.current;
    const card = checkRef.current;
    if (status === "done") jump();
    if (status !== "diagnostic" || !list || !card) return;
    const lead = card.previousElementSibling;
    const top = lead instanceof HTMLElement ? lead.offsetTop : card.offsetTop;
    list.scrollTop = top - list.clientHeight * 0.05;
  }, [status, jump, threadRef]);

  const check = questions && (
    <QuickCheck
      ref={checkRef}
      questions={questions}
      picked={view?.picked ?? picked}
      result={view?.result ?? null}
      busy={busy}
      onPick={(id, option) => setPicked((p) => ({ ...p, [id]: option }))}
      onSubmit={submitAnswers}
    />
  );

  return (
    <>
      <PageHead
        title="المقابلة"
        pill={<StatusPill status={pill.status}>{pill.label}</StatusPill>}
        meta={
          <>
            <MetaItem icon={MessageCircle}>مع المحاور</MetaItem>
            <MetaItem icon={Languages}>
              {dialect && dialect !== "msa"
                ? `يفهم ${DIALECT[dialect]}، ويرد بالفصحى`
                : "اكتب بلهجتك، ويرد المحاور بالفصحى"}
            </MetaItem>
          </>
        }
        actions={
          turns.length > 1 && (
            <button
              type="button"
              className={buttonClass("secondary", "sm")}
              onClick={reset}
              disabled={busy}
            >
              <RotateCcw aria-hidden />
              ابدأ من جديد
            </button>
          )
        }
      />

      <div className={styles.grid}>
        <Panel
          id="chat-title"
          title="المحادثة"
          sub="خمسة أشياء نحتاجها منك، ثم ثلاثة أسئلة قصيرة عن الموضوع."
          flush
          className={styles.chat}
        >
          <div className={styles.thread} ref={thread.ref} onScroll={thread.onScroll}>
            <div className={styles.messages} role="log" aria-labelledby="chat-title">
              {turns.map((turn, i) => (
                // The thread only grows, so a turn keeps its index.
                // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
                <Fragment key={i}>
                  {i === checkAt && check}
                  <Message turn={turn} />
                </Fragment>
              ))}
              {checkAt === turns.length && check}
              {view?.level_note_ar && (
                <p className={styles.note} role="note">
                  <History aria-hidden />
                  {view.level_note_ar}
                </p>
              )}
              {sending && (
                <>
                  <Message turn={{ role: "learner", text_ar: sending, heard: [] }} />
                  <div className={styles.from} role="status">
                    <span className={styles.avatar} aria-hidden>
                      م
                    </span>
                    <span className={cx(styles.bubble, styles.typing)}>
                      <span className="sr-only">المحاور يكتب ردّه</span>
                      <i />
                      <i />
                      <i />
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          <form className={styles.composer} onSubmit={send}>
            {recorded && (offerVoice || offerFill) && (
              <div className={styles.recorded}>
                {offerVoice && (
                  <RecordedFill
                    icon={AudioLines}
                    label="استمع إلى الرسالة الصوتية المسجّلة وأرسلها للتفريغ"
                    onFill={() => {
                      setError(null);
                      voice.playRecorded(recorded.voiceClip);
                    }}
                  />
                )}
                {offerFill && (
                  <RecordedFill
                    label={`املأ الرسالة المسجّلة (${arabicNumber(sent + 1)} من ${arabicNumber(recorded.messages.length)})`}
                    onFill={() => {
                      setDraft(nextRecorded);
                      fieldRef.current?.focus();
                    }}
                  />
                )}
              </div>
            )}
            {voice.state !== "idle" && (
              <p className={styles.voiceStatus} role="status">
                {recording && <span className={styles.recDot} aria-hidden />}
                {VOICE_STATUS[voice.state](voice.seconds)}
              </p>
            )}
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
            <textarea
              ref={fieldRef}
              className={styles.field}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              rows={1}
              maxLength={1000}
              disabled={status !== "interview" || busy}
              placeholder={PLACEHOLDER[status]}
              aria-label="رسالتك إلى المحاور"
              enterKeyHint="send"
            />
            {!recorded && (
              <button
                type="button"
                className={buttonClass("secondary", "md", {
                  iconOnly: true,
                  className: cx(recording && styles.stopRecording),
                })}
                onClick={
                  recording
                    ? voice.stop
                    : () => {
                        setError(null);
                        voice.record();
                      }
                }
                disabled={!recording && !waiting}
                aria-label={recording ? "أوقف التسجيل وحوّله إلى نص" : "سجّل رسالة صوتية"}
                title={recording ? "أوقف التسجيل" : "سجّل رسالة صوتية"}
              >
                {recording ? (
                  <Square aria-hidden />
                ) : voice.state === "transcribing" ? (
                  <LoaderCircle className={styles.spinning} aria-hidden />
                ) : (
                  <Mic aria-hidden />
                )}
              </button>
            )}
            <button
              type="submit"
              className={buttonClass("primary", "md", { iconOnly: true })}
              disabled={status !== "interview" || busy || listening || !draft.trim()}
              aria-label="أرسل"
            >
              <DirIcon icon={SendHorizontal} />
            </button>
          </form>
        </Panel>

        <Facts view={view} fresh={fresh} />
      </div>
    </>
  );
}

function Message({ turn }: { turn: Turn }) {
  if (turn.role === "interviewer") {
    return (
      <div className={styles.from}>
        <span className={styles.avatar} aria-hidden>
          م
        </span>
        <p className={styles.bubble}>
          <span className="sr-only">المحاور: </span>
          <BidiText text={turn.text_ar} />
        </p>
      </div>
    );
  }
  return (
    <>
      <p className={cx(styles.bubble, styles.mine)}>
        <span className="sr-only">أنت: </span>
        <BidiText text={turn.text_ar} />
      </p>
      {turn.heard.length > 0 && (
        <p className={styles.heard}>
          <Sparkles aria-hidden />
          فهم المحاور: <b>{turn.heard.map((f) => LABEL[f]).join("، ")}</b>
        </p>
      )}
    </>
  );
}

function QuickCheck({
  ref,
  questions,
  picked,
  result,
  busy,
  onPick,
  onSubmit,
}: {
  ref: Ref<HTMLFormElement>;
  questions: Question[];
  picked: Record<string, string>;
  result: IntakeView["result"];
  busy: boolean;
  onPick: (id: string, option: string) => void;
  onSubmit: (e: FormEvent) => void;
}) {
  const done = result !== null;
  const complete = questions.every((q) => picked[q.id] !== undefined);
  return (
    <form ref={ref} className={styles.check} onSubmit={onSubmit} aria-labelledby="check-title">
      <div className={styles.checkHead}>
        <h3 id="check-title">اختبار قصير</h3>
        <span className={styles.checkMeta}>
          {countOf(questions.length, QUESTIONS)}
          <Sep />
          يحدد من أين تبدأ
        </span>
      </div>
      {questions.map((q, i) => {
        const score = result?.scores.find((s) => s.question_id === q.id)?.score;
        const dontKnow = q.options_ar.at(-1);
        return (
          <fieldset key={q.id} className={styles.question} disabled={done || busy}>
            <legend>
              {arabicNumber(i + 1)}. <BidiText text={q.prompt_ar} />
              {score !== undefined && (
                <span className={cx(styles.verdict, score === 1 && styles.right)}>
                  {score === 1 ? (
                    <>
                      <Check aria-hidden />
                      صحيحة
                    </>
                  ) : picked[q.id] === dontKnow ? (
                    "لم تعرفها بعد"
                  ) : (
                    "ليست الصحيحة"
                  )}
                </span>
              )}
            </legend>
            <div className={styles.options}>
              {q.options_ar.map((option) => (
                <label
                  key={option}
                  className={cx(
                    styles.option,
                    picked[q.id] === option && styles.chosen,
                    option === dontKnow && styles.dontKnow,
                  )}
                >
                  <input
                    type="radio"
                    name={q.id}
                    value={option}
                    checked={picked[q.id] === option}
                    onChange={() => onPick(q.id, option)}
                  />
                  <BidiText text={option} />
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
      {!done && (
        <div className={styles.checkFoot}>
          <button type="submit" className={buttonClass("primary")} disabled={!complete || busy}>
            أرسل إجاباتك
          </button>
          {!complete && <span className={styles.hint}>أجب عن الأسئلة الثلاثة أولًا.</span>}
        </div>
      )}
    </form>
  );
}

function Facts({ view, fresh }: { view: IntakeView | null; fresh: Field[] }) {
  const heard = view?.heard;
  const have = FIELDS.filter(({ field }) => heard && heard[field] !== null).length;
  const result = view?.result;
  const right = result?.scores.filter((s) => s.score === 1).length ?? 0;
  return (
    <Panel
      id="facts-title"
      title="ما فهمناه منك"
      sub={
        <>
          {arabicNumber(have)} من {arabicNumber(FIELDS.length)}
          <Sep />
          عليه تُبنى خطتك
        </>
      }
      className={styles.facts}
    >
      <div className={styles.meter} aria-hidden>
        {FIELDS.map(({ field }) => (
          <i key={field} className={cx(heard && heard[field] !== null && styles.on)} />
        ))}
      </div>
      <dl className={styles.rows}>
        {FIELDS.map(({ field, label }) => {
          const value = heard ? heardValue(field, heard) : null;
          const known = heard ? heard[field] !== null : false;
          return (
            <div
              // A new key when the field fills in restarts the flash.
              key={`${field}:${known}`}
              className={cx(styles.row, fresh.includes(field) && styles.fresh)}
            >
              <span className={cx(styles.tick, known && styles.ticked)} aria-hidden>
                {known ? <Check /> : <CircleDashed />}
              </span>
              <div>
                <dt>{label}</dt>
                <dd className={cx(!known && styles.missing)}>{known ? value : "لم تذكره بعد"}</dd>
              </div>
            </div>
          );
        })}
        {result && (
          <div className={cx(styles.row, styles.fresh)}>
            <span className={cx(styles.tick, styles.ticked)} aria-hidden>
              <Check />
            </span>
            <div>
              <dt>مستواك الآن</dt>
              <dd>
                {LEVEL[result.level]}
                <span className={styles.score}>
                  <Sep />
                  {arabicNumber(right)} من {arabicNumber(result.scores.length)} صحيحة
                </span>
              </dd>
            </div>
          </div>
        )}
      </dl>
      {result && (
        <Link href="/plan" className={buttonClass("primary", "lg", { className: styles.cta })}>
          اذهب إلى خطتك
          <DirIcon icon={ArrowRight} />
        </Link>
      )}
    </Panel>
  );
}
