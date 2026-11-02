import { afterEach, describe, expect, it, vi } from "vitest";
import { postPlanEdit } from "./road.tsx";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));

afterEach(() => {
  vi.unstubAllGlobals();
});

const edit = { op: "move", session_id: "sess", day: 2 } as const;

describe("postPlanEdit", () => {
  it("retries a 202 until the edit is taken, and does not treat 202 as saved", async () => {
    const statuses: number[] = [];
    const pause = vi.fn(async () => {});
    const fetch = vi.fn(async () => {
      const status = statuses.length < 2 ? 202 : 200;
      statuses.push(status);
      return new Response("{}", {
        status,
        headers: status === 202 ? { "retry-after": "3" } : undefined,
      });
    });
    vi.stubGlobal("fetch", fetch);

    const res = await postPlanEdit("s 1", edit, pause);

    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(statuses).toEqual([202, 202, 200]);
    expect(pause.mock.calls).toEqual([[3000], [3000]]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/sessions/s%201/plan/edit",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("does not retry a 409 without Retry-After, so a real conflict is not saved", async () => {
    const pause = vi.fn(async () => {});
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ error: "conflict" }), { status: 409 }),
    );
    vi.stubGlobal("fetch", fetch);

    const res = await postPlanEdit("s1", { op: "shorten", session_id: "sess", minutes: 20 }, pause);

    expect(res.status).toBe(409);
    expect(res.ok).toBe(false);
    expect(pause).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
