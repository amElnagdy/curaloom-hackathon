// What a failed build tells the page (#58): only a build the server says is stuck loses its retry.

import { describe, expect, it } from "vitest";
import { BuildStuck, type Planner } from "../../server/agents/architect/architect.ts";
import { planResponse } from "../../server/agents/architect/http.ts";
import { StepFailed } from "../../server/orchestrator/orchestrator.ts";
import { failureOf } from "./use-build.ts";

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

describe("a failed build", () => {
  it("is stuck when the plan's build stopped on a missing recording", async () => {
    expect(await failureOf(await building(new BuildStuck("No recorded response")))).toBe("stuck");
  });

  it("may pass on a retry when it failed otherwise, or never reached the server", async () => {
    expect(await failureOf(await building(new StepFailed("timed out")))).toBe("failed");
    expect(await failureOf(null)).toBe("failed");
  });
});
