import { describe, expect, it } from "vitest";
import type { Consent } from "../../../contracts/index.ts";
import { loadOmarSeed } from "../../../demo/seed";
import { startOfDay } from "../../server/clock/time";
import { ladderAt } from "../../server/coach/ladder";
import type { InboxEntry } from "../../server/notifier/adapters.ts";
import {
  CONSENT_PILL,
  coachEventStatus,
  consentState,
  consentText,
  courseStatus,
  ladderText,
  quizState,
  simDay,
  stoppedAt,
} from "./course";

const seed = () => loadOmarSeed("x");

describe("quizState", () => {
  it("asks for a retry when the best score is below the gate", () => {
    // The seed: one attempt at 75% on a quiz that passes at 80%.
    expect(quizState(seed(), "L1")).toMatchObject({
      status: "attention",
      label: "أعد المحاولة",
      gate: 0.8,
      best: 0.75,
      tries: 1,
      passed: false,
    });
  });

  it("shows a passed quiz as passed", () => {
    const s = seed();
    s.mastery = [{ lesson_id: "L1", best_score: 0.9, passed: true, attempts: 2 }];

    expect(quizState(s, "L1")).toMatchObject({ status: "ready", passed: true, best: 0.9 });
  });

  it("has no best score before the first attempt", () => {
    const s = seed();
    s.attempts = [];
    s.mastery = [];

    expect(quizState(s, "L1")).toMatchObject({ status: "waiting", tries: 0, best: undefined });
  });

  it("has no state for a lesson without a quiz", () => {
    expect(quizState(seed(), "L9")).toBeUndefined();
  });
});

describe("courseStatus", () => {
  it("names the ready module while later modules still wait", () => {
    // The seed's plan has three modules; only the first has a lesson.
    expect(courseStatus(seed())).toEqual({ status: "ready", label: "الوحدة الأولى جاهزة" });
  });

  it("calls the course ready only when every module has lessons", () => {
    const s = seed();
    const plan = s.plans[0];
    if (!plan) throw new Error("the seed has a plan");
    plan.road = plan.road.slice(0, 1);

    expect(courseStatus(s)).toEqual({ status: "ready", label: "دورتك جاهزة" });
  });

  it("waits while no module has lessons", () => {
    const s = seed();
    s.lessons = [];

    expect(courseStatus(s).status).toBe("waiting");
  });
});

describe("simDay", () => {
  it("names day 0 instead of showing an Arabic-Indic zero", () => {
    expect(simDay(0)).not.toMatch(/٠/);
    expect(simDay(3)).toBe("اليوم ٣");
  });
});

describe("ladderText", () => {
  const facts = { anchor: 0, pause: null, messages_on: true };

  it("names where the coach is and the day of its next message", () => {
    expect(ladderText(ladderAt(facts, startOfDay(5)), "on")).toBe(
      "المدرب عرض عليك أسبوعًا أخف. رسالته التالية في اليوم ١٠.",
    );
  });

  it("gives the end of a pause the learner chose", () => {
    const pause = { anchor: 0, from: startOfDay(10), until: startOfDay(17) };

    expect(ladderText(ladderAt({ ...facts, pause }, startOfDay(12)), "on")).toBe(
      "المدرب في استراحة طلبتها حتى اليوم ١٧، ٩:٠٠ ص.",
    );
  });

  it("names no next message while the messages are off, and why", () => {
    const off = ladderAt({ ...facts, messages_on: false }, startOfDay(5));

    expect(ladderText(off, "not_asked")).toBe("المدرب لا يرسل شيئًا قبل موافقتك.");
    expect(ladderText(off, "stopped")).toBe("المدرب لا يرسل رسائل، فهي متوقفة بطلبك.");
  });
});

// The consent before the consent screen saves one (session.ts), and after it does.
const NOT_ASKED: Consent = {
  learner_id: "l_new",
  channel: "simulated",
  granted: false,
  granted_sim_day: null,
  quiet_hours: { start: "22:00", end: "08:00" },
  opted_out: false,
  opted_out_sim_day: null,
  intensity: "gentle",
};
const ON: Consent = { ...NOT_ASKED, granted: true, granted_sim_day: 0 };
const STOPPED: Consent = { ...ON, opted_out: true, opted_out_sim_day: 3 };

describe("consentState", () => {
  it("tells a learner never asked from one who stopped the messages", () => {
    expect(consentState(NOT_ASKED)).toBe("not_asked");
    expect(consentState(ON)).toBe("on");
    expect(consentState(STOPPED)).toBe("stopped");
    // Messages turned off on the consent screen before ever turning them on.
    const turnedOff: Consent = { ...NOT_ASKED, opted_out: true, opted_out_sim_day: 0 };
    expect(consentState(turnedOff)).toBe("stopped");
  });

  it("calls only a stopped consent stopped", () => {
    expect(CONSENT_PILL.not_asked.label).toBe("لم تُطلب موافقتك بعد");
    expect(consentText(NOT_ASKED)).not.toMatch(/متوقفة/);
    expect(consentText(ON)).toBe(
      "الرسائل مفعّلة بموافقتك منذ يوم البدء، وتكفي كلمة «توقف» لإيقافها في أي وقت.",
    );
    expect(consentText(STOPPED)).toBe(
      "الرسائل متوقفة بطلبك منذ اليوم ٣، فلا يصلك شيء حتى تعيد تفعيلها.",
    );
  });

  it("names the sample learner as the one who agreed or stopped, before the intake", () => {
    expect(consentText(ON, "عمر")).toBe(
      "الرسائل مفعّلة بموافقة عمر منذ يوم البدء، وتكفي كلمة «توقف» لإيقافها في أي وقت.",
    );
    expect(consentText(STOPPED, "عمر")).toBe(
      "الرسائل متوقفة بطلب عمر منذ اليوم ٣، فلا يصله شيء حتى يعيد تفعيلها.",
    );
  });
});

// The phone's «توقف» at `sim_ts` and the notifier's confirmation of it, as the inbox keeps them.
const confirmed = (sim_ts: string): InboxEntry[] => [
  { id: "in_1", direction: "in", text: "توقف", cta: null, template: null, sim_ts },
  {
    id: "opt_out_x",
    direction: "out",
    text: "أوقفنا رسائل المدرب كما طلبت.",
    cta: null,
    template: "opt_out_confirmation",
    sim_ts,
  },
];

describe("stoppedAt", () => {
  it("is the minute of the «توقف» the phone confirmed", () => {
    const stopped: Consent = { ...NOT_ASKED, opted_out: true, opted_out_sim_day: 2 };

    expect(stoppedAt(stopped, confirmed("day 2 14:30"))).toEqual({ day: 2, minute: 870 });
  });

  it("is the start of the day of a stop saved on the consent screen", () => {
    // A «توقف» on day 1, on again, then off on the consent screen on day 3.
    expect(stoppedAt(STOPPED, confirmed("day 1 10:00"))).toEqual({ day: 3, minute: 0 });
  });

  it("is null while the messages are not stopped", () => {
    expect(stoppedAt(ON, confirmed("day 1 10:00"))).toBeNull();
  });
});

describe("coachEventStatus", () => {
  const held = (day: number) => ({ status: "suppressed_opt_out" as const, sim_day: day });

  it("does not say the learner stopped a message held back before they agreed", () => {
    expect(coachEventStatus(held(2), NOT_ASKED, null).label).toBe("لم تُرسل قبل موافقتك");
    expect(coachEventStatus(held(2), { ...ON, granted_sim_day: 4 }, null).label).toBe(
      "لم تُرسل قبل موافقتك",
    );
  });

  it("keeps a message held back before a stop on the same day as not agreed", () => {
    // Never agreed; the day-2 message fired at 09:00, and «توقف» came at that minute or later.
    const never: Consent = { ...NOT_ASKED, opted_out: true, opted_out_sim_day: 2 };

    expect(coachEventStatus(held(2), never, { day: 2, minute: 540 }).label).toBe(
      "لم تُرسل قبل موافقتك",
    );
    expect(coachEventStatus(held(2), never, { day: 2, minute: 600 }).label).toBe(
      "لم تُرسل قبل موافقتك",
    );
    // A stop at 08:00 came before the 09:00 message.
    expect(coachEventStatus(held(2), never, { day: 2, minute: 480 }).label).toBe("أُوقفت بطلبك");
  });

  it("says the learner stopped a message held back after they stopped the messages", () => {
    expect(coachEventStatus(held(5), STOPPED, { day: 3, minute: 0 }).label).toBe("أُوقفت بطلبك");
    // Stopped on day 3, then on again: the day-5 message was held back by the stop.
    expect(coachEventStatus(held(5), { ...ON, granted_sim_day: 0 }, null).label).toBe(
      "أُوقفت بطلبك",
    );
  });

  it("keeps the other statuses as they are", () => {
    expect(coachEventStatus({ status: "sent", sim_day: 2 }, NOT_ASKED, null).label).toBe("أُرسلت");
  });
});
