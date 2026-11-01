import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { KeylessQuiz } from "../../server/agents/examiner/rules.ts";
import { QuizPaper } from "./paper.tsx";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

const QUIZ: KeylessQuiz = {
  id: "q_L2_1",
  lesson_id: "L2",
  pass_threshold: 0.8,
  items: [
    {
      id: "i1",
      type: "mcq",
      prompt_ar: "ما الجدول المحوري؟",
      options_ar: ["جدول يلخص البيانات", "خلية واحدة"],
      glossary_ids: [],
    },
    {
      id: "i2",
      type: "short",
      prompt_ar: "متى تستخدم الجدول المحوري؟",
      options_ar: [],
      glossary_ids: [],
    },
  ],
};

const paper = (closed?: string) =>
  renderToStaticMarkup(<QuizPaper quiz={QUIZ} sessionId="s1" lessonId="L2" closed={closed} />);
const CLOSED = "لا يصحّح العرض المسجّل هذا الاختبار، فأسئلته هنا للقراءة فقط.";

describe("the quiz paper", () => {
  it("takes answers to an open quiz, counting them, with a submit button", () => {
    const html = paper();

    expect(html).toContain("سلّم الإجابات");
    expect(html).toContain("لم تُجب عن أي سؤال بعد");
    expect(html).not.toMatch(/<(fieldset|textarea)[^>]* disabled/);
  });

  // Replay (#55): the run never graded this quiz.
  it("shows a closed quiz's questions to read only, with its note in place of the count and the button", () => {
    const html = paper(CLOSED);

    expect(html).toContain(CLOSED);
    expect(html).toMatch(/<p role="note"/);
    expect(html).not.toContain("سلّم الإجابات");
    expect(html).not.toContain("لم تُجب عن أي سؤال بعد");
    expect(html.match(/<fieldset[^>]* disabled/g)).toHaveLength(1);
    expect(html.match(/<textarea[^>]* disabled/g)).toHaveLength(1);
  });
});
