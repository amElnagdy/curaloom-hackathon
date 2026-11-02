// What a failed build tells the page (#58): only a build the server says is stuck loses its retry.

import { describe, expect, it, vi } from "vitest";
import { BuildStuck, type Planner } from "../../server/agents/architect/architect.ts";
import { planResponse } from "../../server/agents/architect/http.ts";
import { StepFailed } from "../../server/orchestrator/orchestrator.ts";
import { failureOf, retryWaitMs, whileBusy } from "./use-build.ts";

const building = (error: Error) => {
  const planner: Planner = {
    build: async () => {
      throw error;
    },
    edit: () => {
      throw error;
    },
    accept: () => {
      throw error;
    },
    reject: () => {
      throw error;
    },
    reset: () => {},
  };
  const request = new Request("http://localhost/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  return planResponse(request, "s_1", "build", planner);
};

describe("retryWaitMs", () => {
  it("waits on 202, and on a 409 only when Retry-After says so", () => {
    const header = (status: number, retryAfter?: string) =>
      new Response(null, {
        status,
        headers: retryAfter ? { "retry-after": retryAfter } : undefined,
      });

    expect(retryWaitMs(header(202, "3"))).toBe(3000);
    expect(retryWaitMs(header(202))).toBe(3000);
    expect(retryWaitMs(header(409, "3"))).toBe(3000);
    expect(retryWaitMs(header(409))).toBeNull();
    expect(retryWaitMs(header(200))).toBeNull();
    expect(retryWaitMs(null)).toBeNull();
  });
});

describe("whileBusy", () => {
  it("retries a 202 until a response that is not busy, and does not return the 202", async () => {
    const statuses = [202, 202, 200];
    const pause = vi.fn(async () => {});
    const res = await whileBusy(async () => {
      const status = statuses.shift() ?? 500;
      return new Response(null, {
        status,
        headers: status === 202 ? { "retry-after": "3" } : undefined,
      });
    }, pause);

    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(statuses).toEqual([]);
    expect(pause.mock.calls).toEqual([[3000], [3000]]);
  });
});

describe("a failed build", () => {
  it("is stuck when the plan's build stopped on a missing recording", async () => {
    expect(await failureOf(await building(new BuildStuck("No recorded response")))).toBe("stuck");
  });

  it("may pass on a retry when it failed otherwise, or never reached the server", async () => {
    expect(await failureOf(await building(new StepFailed("timed out")))).toBe("failed");
    expect(await failureOf(null)).toBe("failed");
  });
});
