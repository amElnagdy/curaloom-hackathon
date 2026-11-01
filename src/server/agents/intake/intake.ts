// The intake (#16): a short Arabic chat that profiles a new learner, then a three-question quick
// check that sets their level. A fixed greeting opens it. Each learner message is one orchestrator
// step: the model reads the whole conversation, says what it now knows about the learner, and
// writes an acknowledgement and questions for what is still missing. Code composes the reply, so the
// move to the quick check is always the same words. Its answers are scored in code and the
// LearnerProfile is built from what was heard.

import { randomUUID } from "node:crypto";
import {
  Diagnostic,
  IntakeReply,
  LearnerProfile,
  SOURCE_LANGS,
  validate,
} from "../../../../contracts/index.ts";
import {
  type Agent,
  type createOrchestrator,
  withFeedback,
} from "../../orchestrator/orchestrator.ts";
import type { Provider } from "../../providers/provider.ts";
import { type Cache, contentHash, type Store } from "../../store/store.ts";
import { requestLevel } from "../recorded-level.ts";
import {
  type DiagnosticQuestion,
  diagnosticErrors,
  prepareDiagnostic,
  scoreDiagnostic,
} from "./diagnostic.ts";

type Heard = IntakeReply["heard"];
export type Field = keyof Heard;
export type Turn =
  | { role: "interviewer"; text_ar: string }
  // `heard` names the fields this message gave, as the line under it shows. `replaced` marks a
  // message replay sent in place of the learner's own text (IntakeDeps.recorded).
  | { role: "learner"; text_ar: string; heard: Field[]; replaced?: true };
type Dialect = LearnerProfile["dialect"];
type Result = LearnerProfile["diagnostic"];
type Level = Result["level"];

// `run` names this interview's orchestrator steps, so an interview started after a reset never
// resumes the steps of the one before it.
type Interview = {
  run: string;
  status: "interview";
  turns: Turn[];
  heard: Heard;
  dialect: Dialect | null;
};
type Checking = Omit<Interview, "status"> & {
  status: "diagnostic";
  questions: DiagnosticQuestion[];
};
type Done = Omit<Checking, "status"> & {
  status: "done";
  picked: Record<string, string>;
  result: Result;
};
type IntakeState = Interview | Checking | Done;

export type IntakeView = {
  status: IntakeState["status"];
  turns: Turn[];
  heard: Heard;
  dialect: Dialect | null;
  questions: Omit<DiagnosticQuestion, "answer">[] | null;
  // The learner's answer to each question and the level they set, once the quick check is done.
  picked: Record<string, string> | null;
  result: Result | null;
  // The app's note under the closing reply when replay plans from another level (recordedLevelNote).
  level_note_ar: string | null;
};

// A call that does not fit where the interview is, such as a message during the quick check.
export class IntakeConflict extends Error {}

export type IntakeDeps = {
  orchestrator: Pick<ReturnType<typeof createOrchestrator>, "runStep">;
  store: Store;
  // Outlives every session: it keeps the quick check written for each topic.
  cache: Cache;
  sessionId: string;
  learner: { id: string; name: string };
  topic: string;
  // Replay only (#55): the recorded run's messages, in order. Replay answers a message only by its
  // exact text, so any other text at a message's place is sent as the recorded one.
  recorded?: readonly string[];
};

const STATE_DOC = "intake";
// The finished profile, for the steps after the intake to read in place of the seed's.
const PROFILE_DOC = "profile";
// With the greeting and the quick check's closing reply, the interviewer speaks at most 6 times.
const MAX_MESSAGES = 4;
const CACHE_AREA = "intake";

// Per field: what the model asks about, how the learner sees it named, the question code asks when
// the model asked nothing, and the profile's value when the learner never gave it. The scout
// searches every source language the profile accepts, so a learner who never answered gets all four.
const FIELD: {
  [F in Field]: { ask: string; ar: string; question_ar: string; unanswered: NonNullable<Heard[F]> };
} = {
  goal: {
    ask: "the role or outcome they want",
    ar: "هدفك",
    question_ar: "ما الذي تريد أن تصل إليه من هذا التعلّم؟",
    unanswered: "لم يذكره في المقابلة",
  },
  background: {
    ask: "their current work and skills",
    ar: "خلفيتك",
    question_ar: "ما عملك الآن، وما الأدوات التي تستعملها فيه؟",
    unanswered: [],
  },
  hours_per_week: {
    ask: "how many hours a week they can study",
    ar: "وقتك في الأسبوع",
    question_ar: "كم ساعة تستطيع أن تدرس في الأسبوع؟",
    unanswered: 3,
  },
  source_langs_ok: {
    ask: "whether they accept sources in English, Russian, Chinese and French, which reach them in Arabic",
    ar: "لغات المصادر",
    question_ar: "هل تقبل مصادر بالإنجليزية والروسية والصينية والفرنسية، تصلك بالعربية؟",
    unanswered: [...SOURCE_LANGS],
  },
  history_notes: {
    ask: "whether they started courses before and dropped them, and why",
    ar: "تجربتك السابقة",
    question_ar: "هل بدأت دورات من قبل وتركتها؟ وما الذي جعلك تتركها؟",
    unanswered: "",
  },
};
const FIELDS = Object.keys(FIELD) as Field[];
const named = (fields: Field[]) => fields.map((f) => FIELD[f].ar).join("، ");

const NOTHING_HEARD = Object.fromEntries(FIELDS.map((f) => [f, null])) as Heard;

const greeting = (name: string) =>
  `أهلًا ${name}! سأسألك بضعة أسئلة قصيرة لأبني لك خطة تناسبك. ما الذي تريد أن تصل إليه، وما عملك الآن؟`;

const INTERVIEW_INSTRUCTIONS =
  "You interview a new learner for a service that builds them a free personal course in Arabic from openly licensed resources in English, Russian, Chinese and French; every source reaches the learner in Arabic. The learner writes Arabic, often in a dialect such as Gulf or Egyptian. In heard, give everything the conversation so far tells you about the learner, and null for what it does not say yet: never guess. A learner who accepts any language, or does not mind as long as it reaches them in Arabic, accepts all four source languages. history_notes stays null until the learner has said whether they dropped courses before. Write ack_ar and ask_ar in clear, warm Modern Standard Arabic that a dialect speaker reads easily. ack_ar acknowledges the latest message in a few words. ask_ar asks only about what is still missing after the latest message, at most two things at a time, in plain words, in one or two short sentences; leave it empty when nothing is missing. Never ask about something the learner already said, and never ask for contact details.";

// The interviewer's last words before the quick check, whatever the model asked.
const TO_THE_CHECK = "الآن ثلاثة أسئلة سريعة عن الموضوع لنعرف من أين تبدأ.";

// Per level: its Arabic name, and what it means for the plan in the closing reply.
const LEVEL: Record<Level, { ar: string; plan_ar: string }> = {
  beginner: { ar: "مبتدئ", plan_ar: "فتبدأ خطتك من الأساسيات." },
  intermediate: { ar: "متوسط", plan_ar: "فتبدأ خطتك بمراجعة قصيرة للأساسيات ثم تتجاوزها." },
  advanced: { ar: "متقدم", plan_ar: "فتتجاوز خطتك الأساسيات إلى ما بعدها." },
};

export const levelName = (level: Level) => LEVEL[level].ar;

// The line that tells a learner at `level` their plan follows the recorded run's level, which
// replay plans them from when theirs has no recordings (recorded-level.ts); null otherwise.
export function recordedLevelNote(level: Level): string | null {
  const planned = requestLevel(level);
  if (planned === level) return null;
  return `تُبنى خطتك في هذا العرض المسجّل على مسار ال${LEVEL[planned].ar}، أما خارج العرض فيبنيها التطبيق على مستواك.`;
}

const DIAGNOSTIC_INSTRUCTIONS =
  "Write three multiple-choice questions in Arabic that check what a learner already knows about the topic, from basic to harder, so that their starting level can be set. Each question has four short options and exactly one right answer; copy the answer exactly from options_ar. Write a technical term in Arabic with the English term in parentheses after it. Do not add an option such as «I don't know»: the app adds it.";

const missingFrom = (heard: Heard) => FIELDS.filter((f) => heard[f] === null);

// The model often ends its acknowledgement without a stop, and the question follows it.
const sentence = (text: string) => (/[.!?؟…]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`);

type InterviewInput = {
  name: string;
  topic: string;
  turns: Turn[];
  text: string;
  missing: Field[];
  // `text` is the recorded message replay sent in place of the learner's (IntakeDeps.recorded).
  replaced: boolean;
};

const interviewer: Agent<InterviewInput, typeof IntakeReply> = {
  name: "intake",
  output: IntakeReply,
  async run(ctx, { name, topic, turns, text, missing, replaced }) {
    if (replaced) {
      const n = turns.filter((t) => t.role === "learner").length + 1;
      ctx.trace({
        kind: "decision",
        summary_ar: `أُرسلت الرسالة المسجّلة رقم ${n} بدل رسالتك، فالعرض المسجّل لا يجيب إلا عنها`,
        summary_en: `Replay: sent recorded message ${n} in place of the learner's, which has no recording`,
      });
    }
    const conversation = [
      ...turns.map((t) => `${t.role === "learner" ? "Learner" : "Interviewer"}: ${t.text_ar}`),
      `Learner: ${text}`,
    ].join("\n");
    const input = [
      `Topic: ${topic}`,
      `The learner's name: ${name}`,
      `Still missing before the latest message: ${missing.map((f) => `${f} (${FIELD[f].ask})`).join("; ")}`,
      "",
      "Conversation so far:",
      conversation,
    ].join("\n");
    const { json } = await ctx.provider.structured({
      role: "agent_default",
      trace: {
        agent: "intake",
        summary_ar: "قرأ رسالة المتعلم وكتب الرد التالي",
        summary_en: "Read the learner's latest message and wrote the next reply",
      },
      instructions: INTERVIEW_INSTRUCTIONS,
      input: withFeedback(ctx, input),
      schema: { name: "IntakeReply", schema: IntakeReply },
    });
    const reply = validate(IntakeReply, json);
    // Field names only: the trace never holds the learner's words.
    const heard = missing.filter((f) => reply.heard[f] !== null);
    const still = missing.filter((f) => reply.heard[f] === null);
    ctx.trace({
      kind: "decision",
      summary_ar: heard.length ? `فهم من رسالتك: ${named(heard)}` : "لم تضف رسالتك شيئًا مما ينقص",
      summary_en: `Heard: ${heard.join(", ") || "nothing new"}. Still missing: ${still.join(", ") || "nothing"}`,
    });
    return reply;
  },
};

// The questions depend only on the topic and the prompt, so they are written once and cached
// outside every session, under a hash of the request.
const diagnosticWriter = (cache: Cache): Agent<{ topic: string }, typeof Diagnostic> => ({
  name: "intake",
  output: Diagnostic,
  async run(ctx, { topic }) {
    const input = `Topic: ${topic}`;
    const key = `diagnostic_${contentHash([DIAGNOSTIC_INSTRUCTIONS, input])}`;
    const saved = cache.read<Diagnostic>(CACHE_AREA, key);
    if (saved) {
      ctx.trace({
        kind: "decision",
        summary_ar: "استعمل أسئلة سابقة لهذا الموضوع",
        summary_en: `Quick-check questions read from the cache (${CACHE_AREA}/${key}); no model call`,
      });
      return saved;
    }
    const { json } = await ctx.provider.structured({
      role: "agent_default",
      trace: {
        agent: "intake",
        summary_ar: "كتب ثلاثة أسئلة قصيرة لتحديد مستواك",
        summary_en: "Wrote the three quick-check questions",
      },
      instructions: DIAGNOSTIC_INSTRUCTIONS,
      input: withFeedback(ctx, input),
      schema: { name: "Diagnostic", schema: Diagnostic },
    });
    const errors = diagnosticErrors(validate(Diagnostic, json));
    if (errors.length) throw new Error(`Diagnostic questions unusable: ${errors.join("; ")}`);
    cache.write(CACHE_AREA, key, json);
    return json;
  },
});

type ProfileInput = {
  learner: IntakeDeps["learner"];
  topic: string;
  heard: Heard;
  dialect: Dialect | null;
  diagnostic: Result;
};

// Built in code from what the interview heard; a step, so the profile is checked against its
// contract and traced like any agent output.
const profileBuilder: Agent<ProfileInput, typeof LearnerProfile> = {
  name: "intake",
  output: LearnerProfile,
  async run(ctx, { learner, topic, heard, dialect, diagnostic }) {
    const missing = missingFrom(heard);
    if (missing.length) {
      ctx.trace({
        kind: "decision",
        summary_ar: `لم تذكر ${named(missing)}، فاستُعملت قيمة افتراضية`,
        summary_en: `Not answered in the intake, so defaults used: ${missing.join(", ")}`,
      });
    }
    const right = diagnostic.scores.filter((s) => s.score === 1).length;
    ctx.trace({
      kind: "decision",
      summary_ar: `الاختبار القصير: ${right} من ${diagnostic.scores.length}، والمستوى ${LEVEL[diagnostic.level].ar}`,
      summary_en: `Quick check: ${right} of ${diagnostic.scores.length} right; level ${diagnostic.level}`,
    });
    const planned = requestLevel(diagnostic.level);
    if (planned !== diagnostic.level) {
      ctx.trace({
        kind: "decision",
        summary_ar: `يبني العرض المسجّل خطتك على مسار ال${LEVEL[planned].ar}، لا على مستواك ال${LEVEL[diagnostic.level].ar}`,
        summary_en: `Replay has no recordings for level ${diagnostic.level}, so the recorded demo plans on the ${planned} path; the profile keeps ${diagnostic.level}`,
      });
    }
    const notes = [
      heard.history_notes ?? "",
      missing.length ? `لم تذكر في المقابلة: ${named(missing)}.` : "",
    ];
    return {
      id: learner.id,
      name: learner.name,
      locale: "ar",
      dialect: dialect ?? "msa",
      goal: heard.goal ?? FIELD.goal.unanswered,
      topic,
      hours_per_week: heard.hours_per_week ?? FIELD.hours_per_week.unanswered,
      background: heard.background ?? FIELD.background.unanswered,
      source_langs_ok: heard.source_langs_ok ?? FIELD.source_langs_ok.unanswered,
      diagnostic,
      history_notes: notes.filter(Boolean).join(" "),
    } satisfies LearnerProfile;
  },
};

// What the learner may see: the questions without their answers.
const viewOf = (state: IntakeState): IntakeView => ({
  status: state.status,
  turns: state.turns,
  heard: state.heard,
  dialect: state.dialect,
  questions:
    state.status === "interview"
      ? null
      : state.questions.map(({ answer: _, ...question }) => question),
  picked: state.status === "done" ? state.picked : null,
  result: state.status === "done" ? state.result : null,
  level_note_ar: state.status === "done" ? recordedLevelNote(state.result.level) : null,
});

// The session's interview, or null before it starts.
export function intakeView(store: Store, sessionId: string): IntakeView | null {
  const state = store.readDoc<IntakeState>(sessionId, STATE_DOC);
  return state ? viewOf(state) : null;
}

// Names a learner says in the intake that the transcriber spells its own way unless told: the spike
// heard «بايثون» as «بيثون» (docs/spikes/api-access.md). These are the tools, course sites and role
// of a move into data analysis, in the Arabic script the transcript comes back in.
const VOICE_KEYWORDS = [
  "إكسل",
  "بايثون",
  "باور بي آي",
  "كورسيرا",
  "يوديمي",
  "محلل بيانات",
  "تحليل البيانات",
];

// The learner's voice message (#37) as text for the composer, which the learner reads and sends or
// not. Only while the interview waits for a message, so no transcription is paid for outside it.
export async function transcribeVoice(
  { store, sessionId, provider }: { store: Store; sessionId: string; provider: Provider },
  audio: Uint8Array,
): Promise<string> {
  if (intakeView(store, sessionId)?.status !== "interview") {
    throw new IntakeConflict("The interview is not waiting for a message");
  }
  const { text } = await provider.transcribe({
    role: "transcribe",
    audio,
    keywords: VOICE_KEYWORDS,
    // Never the learner's words: the transcript goes back to the page only.
    trace: {
      agent: "intake",
      summary_ar: "حوّل رسالتك الصوتية إلى نص تراجعه قبل الإرسال",
      summary_en: "Transcribed the learner's voice message into the composer",
    },
  });
  return text.trim();
}

export function createIntake({
  orchestrator,
  store,
  cache,
  sessionId,
  learner,
  topic,
  recorded,
}: IntakeDeps) {
  const read = () => store.readDoc<IntakeState>(sessionId, STATE_DOC);
  const save = (state: IntakeState) => store.writeDoc(sessionId, STATE_DOC, state);

  return {
    view: () => intakeView(store, sessionId),

    start(): IntakeView {
      const existing = read();
      if (existing) return viewOf(existing);
      const state: Interview = {
        run: randomUUID().slice(0, 8),
        status: "interview",
        turns: [{ role: "interviewer", text_ar: greeting(learner.name) }],
        heard: NOTHING_HEARD,
        dialect: null,
      };
      save(state);
      return viewOf(state);
    },

    async message(written: string): Promise<IntakeView> {
      const state = read();
      if (state?.status !== "interview") {
        throw new IntakeConflict("The interview is not waiting for a message");
      }
      const sent = state.turns.filter((t) => t.role === "learner").length + 1;
      const missing = missingFrom(state.heard);
      const standIn = recorded?.[sent - 1];
      const replaced = standIn !== undefined && standIn !== written;
      const text = replaced ? standIn : written;
      // The text is in the key: after a failed step, a different message is a new step.
      const reply = await orchestrator.runStep(
        sessionId,
        interviewer,
        { name: learner.name, topic, turns: state.turns, text, missing, replaced },
        { key: `intake:${state.run}:message:${sent}:${contentHash(text)}` },
      );
      const heard = Object.fromEntries(
        FIELDS.map((f) => [f, reply.heard[f] ?? state.heard[f]]),
      ) as Heard;
      const [first] = missingFrom(heard);
      const asking = first !== undefined && sent < MAX_MESSAGES;
      const ask = asking ? reply.ask_ar.trim() || FIELD[first].question_ar : TO_THE_CHECK;
      const next = {
        ...state,
        turns: [
          ...state.turns,
          {
            role: "learner",
            text_ar: text,
            heard: missing.filter((f) => heard[f] !== null),
            ...(replaced && { replaced: true as const }),
          },
          { role: "interviewer", text_ar: `${sentence(reply.ack_ar)} ${ask}` },
        ] satisfies Turn[],
        heard,
        dialect: reply.dialect,
      };
      if (asking) {
        save(next);
        return viewOf(next);
      }
      const diagnostic = await orchestrator.runStep(
        sessionId,
        diagnosticWriter(cache),
        { topic },
        { key: `intake:${state.run}:diagnostic` },
      );
      const checking: Checking = {
        ...next,
        status: "diagnostic",
        questions: prepareDiagnostic(diagnostic),
      };
      save(checking);
      return viewOf(checking);
    },

    // Back to no interview: the next start() greets the learner again, and the pages fall back to
    // the seed's profile.
    reset() {
      store.deleteDoc(sessionId, STATE_DOC);
      store.deleteDoc(sessionId, PROFILE_DOC);
    },

    // Throws InvalidAnswers for answers that skip a question or are not among its options.
    async answer(picked: Record<string, string>): Promise<IntakeView> {
      const state = read();
      if (state?.status !== "diagnostic") {
        throw new IntakeConflict("The quick check is not waiting for answers");
      }
      const diagnostic = scoreDiagnostic(state.questions, picked);
      const profile = await orchestrator.runStep(
        sessionId,
        profileBuilder,
        { learner, topic, heard: state.heard, dialect: state.dialect, diagnostic },
        { key: `intake:${state.run}:profile` },
      );
      store.writeDoc(sessionId, PROFILE_DOC, profile);
      const { ar, plan_ar } = LEVEL[diagnostic.level];
      // plan_ar describes this level's plan, which replay does not build when it plans from another
      // level; the note under the reply says so instead.
      const plan = requestLevel(diagnostic.level) === diagnostic.level ? `، ${plan_ar}` : ".";
      const closing = `شكرًا يا ${learner.name}، اكتملت المقابلة. مستواك الآن: ${ar}${plan}`;
      const done: Done = {
        ...state,
        status: "done",
        picked,
        result: diagnostic,
        turns: [...state.turns, { role: "interviewer", text_ar: closing }],
      };
      save(done);
      return viewOf(done);
    },
  };
}

export type Intake = ReturnType<typeof createIntake>;

export function savedProfile(store: Store, sessionId: string): LearnerProfile | undefined {
  return store.readDoc<LearnerProfile>(sessionId, PROFILE_DOC);
}
