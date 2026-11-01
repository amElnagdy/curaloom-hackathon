import { describe, expect, it } from "vitest";
import { loadModels } from "../../server/providers/models";
import type { TraceEvent } from "../../server/trace/trace";
import {
  KIND_AR,
  NO_FILTER,
  roleName,
  shownText,
  TRACE_KINDS,
  traceAgents,
  traceRows,
} from "./trace-view";

let next = 0;
const event = (agent: string, kind: TraceEvent["kind"], more: Partial<TraceEvent> = {}) =>
  ({
    id: `evt_${String(++next).padStart(4, "0")}`,
    session_id: "s_1",
    ts: "2026-11-01T10:00:00.000Z",
    sim_ts: "day 0 09:00",
    agent,
    kind,
    summary_ar: `${agent} ${kind}`,
    summary_en: `${agent} ${kind}`,
    ...more,
  }) satisfies TraceEvent;

// A failed scout build run twice, as a reload of the plan page runs it again (#58), around a
// model call of the intake's.
function session() {
  const failedBuild = () => [
    event("scout", "decision", {
      summary_ar: "بدأت خطوة البحث",
      summary_en: "Starting step scout:a",
    }),
    event("scout", "error", {
      summary_ar: "فشل طلب النموذج",
      summary_en: "Model call failed (attempt 1): No recorded response for request 7ac9",
      model: "muse-spark-1.3",
      cost_usd: 0,
    }),
  ];
  return [
    event("intake", "model_call", { model: "muse-spark-1.3", cost_usd: 0.002 }),
    ...failedBuild(),
    event("intake", "model_call", { model: "muse-spark-1.3", cost_usd: 0.003 }),
    ...failedBuild(),
  ];
}

describe("traceRows", () => {
  it("lists every event, oldest first, with no filter", () => {
    const events = session();

    expect(traceRows(events, NO_FILTER).map((r) => r.event)).toEqual(events);
  });

  it("narrows the list to one agent, one kind, or both", () => {
    const events = session();
    const agentKinds = (filter: Partial<typeof NO_FILTER>) =>
      traceRows(events, { ...NO_FILTER, ...filter }).map((r) => [r.event.agent, r.event.kind]);

    expect(agentKinds({ agent: "intake" })).toEqual([
      ["intake", "model_call"],
      ["intake", "model_call"],
    ]);
    expect(agentKinds({ kind: "error" })).toEqual([
      ["scout", "error"],
      ["scout", "error"],
    ]);
    expect(agentKinds({ agent: "intake", kind: "error" })).toEqual([]);
  });

  it("folds a run of repeats at one moment into its last event, with a count", () => {
    const failed = () =>
      event("scout", "error", { summary_ar: "فشل طلب النموذج", summary_en: "Model call failed" });
    const events = [failed(), failed(), failed(), event("intake", "decision")];

    expect(traceRows(events, { ...NO_FILTER, foldRepeats: true })).toEqual([
      { event: events[2], repeats: 3 },
      { event: events[3], repeats: 1 },
    ]);
  });

  it("keeps a repeat that other events separate, and calls that cost differently", () => {
    const events = session();

    expect(traceRows(events, { ...NO_FILTER, foldRepeats: true })).toEqual(
      events.map((event) => ({ event, repeats: 1 })),
    );
  });

  // #78: the coach's message on day 2 and again on day 5 are two pieces of work.
  it("keeps the same event on two simulated days as two rows", () => {
    const sent = (sim_ts: string) =>
      event("notifier", "decision", {
        sim_ts,
        summary_ar: "أُرسلت إليك رسالة المدرب",
        summary_en: "Sent the coach's message to l_omar",
      });
    const events = [sent("day 2 12:00"), sent("day 5 12:00")];

    expect(traceRows(events, { ...NO_FILTER, foldRepeats: true })).toHaveLength(2);
  });

  it("folds repeats that follow each other in the narrowed list", () => {
    const events = session();

    expect(traceRows(events, { ...NO_FILTER, kind: "error", foldRepeats: true })).toEqual([
      { event: events[5], repeats: 2 },
    ]);
  });
});

describe("shownText", () => {
  const events = session();
  const shown = (filter: Partial<typeof NO_FILTER>) => {
    const narrowed = { ...NO_FILTER, ...filter };
    return shownText(traceRows(events, narrowed), events.length, narrowed);
  };

  it("says nothing while the list shows every event", () => {
    expect(shown({})).toBe("");
  });

  it("counts the events a filter leaves of the session's", () => {
    expect(shown({ agent: "intake" })).toBe("يعرض ٢ من ٦ أحداث");
  });

  it("counts rows and the events they hold under the fold", () => {
    expect(shown({ foldRepeats: true })).toBe("٦ أسطر تضم ٦ أحداث");
    expect(shown({ kind: "error", foldRepeats: true })).toBe("سطر واحد يضم حدثين من ٦");
  });

  it("says nothing when no event matches, as the empty state does", () => {
    expect(shown({ agent: "intake", kind: "error" })).toBe("");
    expect(shown({ agent: "intake", kind: "error", foldRepeats: true })).toBe("");
  });
});

describe("traceAgents", () => {
  it("names each agent once, in the order it first acts", () => {
    expect(traceAgents(session())).toEqual(["intake", "scout"]);
  });
});

// Arabic letters and their marks, such as the shadda in «المحكّم», and spaces.
const ARABIC_ONLY = /^[\p{Script=Arabic}\p{Mn} ]+$/u;

describe("the drawer's Arabic names", () => {
  it("names every event kind in Arabic", () => {
    for (const kind of TRACE_KINDS) expect(KIND_AR[kind], kind).toMatch(ARABIC_ONLY);
  });

  it("names every model role in config/models.yaml in Arabic", () => {
    for (const role of Object.keys(loadModels().roles)) {
      expect(roleName(role), role).toMatch(ARABIC_ONLY);
    }
  });
});
