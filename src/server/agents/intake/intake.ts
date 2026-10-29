// The intake (#16): a short Arabic chat that profiles a new learner, then a three-question quick
// check that sets their level. A fixed greeting opens it. Each learner message is one orchestrator
// step: the model reads the whole conversation, says what it now knows about the learner and writes
// the next reply, asking only for what is still missing. Once nothing is missing, the quick check
// follows; its answers are scored in code and the LearnerProfile is built from what was heard.

import { createHash, randomUUID } from "node:crypto";
import {
  Diagnostic,
  IntakeReply,
  LearnerProfile,
  SOURCE_LANGS,
  validate,
} from "../../../../contracts/index.ts";
import type { Agent, AgentContext, createOrchestrator } from "../../orchestrator/orchestrator.ts";
import type { Cache, Store } from "../../store/store.ts";
import {
  type DiagnosticQuestion,
  diagnosticErrors,
  prepareDiagnostic,
  scoreDiagnostic,
} from "./diagnostic.ts";

export type Turn = { role: "interviewer" | "learner"; text_ar: string };
type Heard = IntakeReply["heard"];
type Field = keyof Heard;
type Dialect = LearnerProfile["dialect"];
type Level = LearnerProfile["diagnostic"]["level"];

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
type Done = Omit<Checking, "status"> & { status: "done"; picked: Record<string, string> };
type IntakeState = Interview | Checking | Done;

export type IntakeView = {
  status: IntakeState["status"];
  turns: Turn[];
  heard: Heard;
  questions: Omit<DiagnosticQuestion, "answer">[] | null;
  // The learner's answer to each question, once the quick check is done.
  picked: Record<string, string> | null;
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
};

const STATE_DOC = "intake";
// The finished profile, which the other pages read in place of the seed's.
const PROFILE_DOC = "profile";
// With the greeting and the quick check's closing reply, the interviewer speaks at most 6 times.
const MAX_MESSAGES = 4;
const CACHE_AREA = "intake";

// What to ask for each field, for the model.
const ASK: Record<Field, string> = {
  goal: "the role or outcome they want",
  background: "their current work and skills",
  hours_per_week: "how many hours a week they can study",
  source_langs_ok:
    "whether they accept sources in English, Russian, Chinese and French, which reach them in Arabic",
  history_notes: "whether they started courses before and dropped them, and why",
};
const FIELDS = Object.keys(ASK) as Field[];

// The fields as the activity feed names them to the learner.
const FIELD_AR: Record<Field, string> = {
  goal: "هدفك",
  background: "خلفيتك",
  hours_per_week: "وقتك في الأسبوع",
  source_langs_ok: "لغات المصادر",
  history_notes: "تجربتك السابقة",
};

const NOTHING_HEARD = Object.fromEntries(FIELDS.map((f) => [f, null])) as Heard;

// For a field still missing after the last message. The scout searches every source language the
// profile accepts, so a learner who never answered gets all four.
const DEFAULTS = (topic: string): { [F in Field]: NonNullable<Heard[F]> } => ({
  goal: topic,
  background: [],
  hours_per_week: 3,
  source_langs_ok: [...SOURCE_LANGS],
  history_notes: "",
});

const greeting = (name: string) =>
  `أهلًا ${name}! سأسألك بضعة أسئلة قصيرة لأبني لك خطة تناسبك. ما الذي تريد أن تصل إليه، وما عملك الآن؟`;

const INTERVIEW_INSTRUCTIONS =
  "You interview a new learner for a service that builds them a free personal course in Arabic from openly licensed resources in English, Russian, Chinese and French; every source reaches the learner in Arabic. The learner writes Arabic, often in a dialect such as Gulf or Egyptian. In heard, give everything the conversation so far tells you about the learner, and null for what it does not say yet: never guess. A learner who accepts any language, or does not mind as long as it reaches them in Arabic, accepts all four source languages. history_notes stays null until the learner has said whether they dropped courses before. reply_ar is your next message: clear, warm Modern Standard Arabic that a dialect speaker reads easily, at most three short sentences. Acknowledge the latest message in a few words, then ask only about what is still missing, at most two things at a time, in plain words. Never ask about something the learner already said, and never ask for contact details.";

const LEVEL_AR: Record<Level, string> = {
  beginner: "مبتدئ",
  intermediate: "متوسط",
  advanced: "متقدم",
};

const CLOSING: Record<Level, string> = {
  beginner: "مستواك الآن: مبتدئ، فتبدأ خطتك من الأساسيات.",
  intermediate: "مستواك الآن: متوسط، فتبدأ خطتك بمراجعة قصيرة للأساسيات ثم تتجاوزها.",
  advanced: "مستواك الآن: متقدم، فتتجاوز خطتك الأساسيات إلى ما بعدها.",
};

const NEXT_IS_CHECK =
  "thank the learner and say that a quick check of three questions on the topic comes next";

const DIAGNOSTIC_INSTRUCTIONS =
  "Write three multiple-choice questions in Arabic that check what a learner already knows about the topic, from basic to harder, so that their starting level can be set. Each question has four short options and exactly one right answer; copy the answer exactly from options_ar. Write a technical term in Arabic with the English term in parentheses after it. Do not add an option such as «I don't know»: the app adds it.";

const missingFrom = (heard: Heard) => FIELDS.filter((f) => heard[f] === null);

const withFeedback = (ctx: AgentContext, input: string) =>
  ctx.feedback ? `${input}\n\nThe previous attempt failed: ${ctx.feedback.join("; ")}` : input;

type InterviewInput = {
  name: string;
  topic: string;
  turns: Turn[];
  missing: Field[];
  last: boolean;
};

const interviewer: Agent<InterviewInput, typeof IntakeReply> = {
  name: "intake",
  output: IntakeReply,
  async run(ctx, { name, topic, turns, missing, last }) {
    const conversation = turns
      .map((t) => `${t.role === "learner" ? "Learner" : "Interviewer"}: ${t.text_ar}`)
      .join("\n");
    const input = [
      `Topic: ${topic}`,
      `The learner's name: ${name}`,
      `Still missing before the latest message: ${missing.map((f) => `${f} (${ASK[f]})`).join("; ")}`,
      last
        ? `This is the learner's last message in the interview, so ask nothing more: ${NEXT_IS_CHECK}.`
        : `If the latest message gives everything still missing, ask nothing more: ${NEXT_IS_CHECK}.`,
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
      summary_ar: heard.length
        ? `فهم من رسالتك: ${heard.map((f) => FIELD_AR[f]).join("، ")}`
        : "لم تضف رسالتك شيئًا مما ينقص",
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
    const key = `diagnostic_${createHash("sha256")
      .update(JSON.stringify([DIAGNOSTIC_INSTRUCTIONS, input]))
      .digest("hex")
      .slice(0, 16)}`;
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
  diagnostic: LearnerProfile["diagnostic"];
};

// Built in code from what the interview heard; a step, so the profile is checked against its
// contract and traced like any agent output.
const profileBuilder: Agent<ProfileInput, typeof LearnerProfile> = {
  name: "intake",
  output: LearnerProfile,
  async run(ctx, { learner, topic, heard, dialect, diagnostic }) {
    const defaults = DEFAULTS(topic);
    const missing = missingFrom(heard);
    if (missing.length) {
      ctx.trace({
        kind: "decision",
        summary_ar: `لم تذكر ${missing.map((f) => FIELD_AR[f]).join("، ")}، فاستُعملت قيمة افتراضية`,
        summary_en: `Not answered in the intake, so defaults used: ${missing.join(", ")}`,
      });
    }
    const right = diagnostic.scores.filter((s) => s.score === 1).length;
    ctx.trace({
      kind: "decision",
      summary_ar: `الاختبار القصير: ${right} من ${diagnostic.scores.length}، والمستوى ${LEVEL_AR[diagnostic.level]}`,
      summary_en: `Quick check: ${right} of ${diagnostic.scores.length} right; level ${diagnostic.level}`,
    });
    const notes = [
      heard.history_notes ?? "",
      missing.length ? `Not answered in the intake: ${missing.join(", ")}.` : "",
    ];
    return {
      id: learner.id,
      name: learner.name,
      locale: "ar",
      dialect: dialect ?? "msa",
      goal: heard.goal ?? defaults.goal,
      topic,
      hours_per_week: heard.hours_per_week ?? defaults.hours_per_week,
      background: heard.background ?? defaults.background,
      source_langs_ok: heard.source_langs_ok ?? defaults.source_langs_ok,
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
  questions:
    state.status === "interview"
      ? null
      : state.questions.map(({ answer: _, ...question }) => question),
  picked: state.status === "done" ? state.picked : null,
});

// The session's interview, or null before it starts.
export function intakeView(store: Store, sessionId: string): IntakeView | null {
  const state = store.readDoc<IntakeState>(sessionId, STATE_DOC);
  return state ? viewOf(state) : null;
}

export function createIntake({
  orchestrator,
  store,
  cache,
  sessionId,
  learner,
  topic,
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

    async message(text: string): Promise<IntakeView> {
      const state = read();
      if (state?.status !== "interview") {
        throw new IntakeConflict("The interview is not waiting for a message");
      }
      const turns: Turn[] = [...state.turns, { role: "learner", text_ar: text }];
      const answers = turns.filter((t) => t.role === "learner").length;
      const reply = await orchestrator.runStep(
        sessionId,
        interviewer,
        {
          name: learner.name,
          topic,
          turns,
          missing: missingFrom(state.heard),
          last: answers >= MAX_MESSAGES,
        },
        { key: `intake:${state.run}:message:${answers}` },
      );
      const heard = Object.fromEntries(
        FIELDS.map((f) => [f, reply.heard[f] ?? state.heard[f]]),
      ) as Heard;
      const next = {
        ...state,
        turns: [...turns, { role: "interviewer" as const, text_ar: reply.reply_ar }],
        heard,
        dialect: reply.dialect,
      };
      if (missingFrom(heard).length && answers < MAX_MESSAGES) {
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
      const closing = `شكرًا يا ${learner.name}، اكتملت المقابلة. ${CLOSING[diagnostic.level]}`;
      const done: Done = {
        ...state,
        status: "done",
        picked,
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
