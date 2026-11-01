import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

// The route reads the store under DATA_DIR, which the config reads when it is first imported.
vi.stubEnv("DATA_DIR", mkdtempSync(join(tmpdir(), "plan-route-")));
const { GET } = await import("./route.ts");
const { contentHash, createFileStore } = await import("../../../../../server/store/store.ts");
const { loadOmarSeed } = await import("../../../../../../demo/seed.ts");

const get = (id: string) =>
  GET(new Request(`http://localhost/api/sessions/${id}/plan`), {
    params: Promise.resolve({ id }),
  });

describe("GET /api/sessions/:id/plan", () => {
  const store = createFileStore();
  const seed = loadOmarSeed("x");
  const learner = { ...seed.profile, id: "l_new", name: "سارة" };

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("answers whose plan the session follows, from the intake to the learner's plan", async () => {
    expect(await (await get("s1")).json()).toEqual({ kind: "sample" });

    store.writeDoc("s1", "profile", learner);
    expect(await (await get("s1")).json()).toEqual({ kind: "none" });

    store.writeDoc("s1", "plan", {
      for_profile: contentHash(learner),
      versions: seed.plans,
      resources: seed.resources,
      limits: { budget_minutes: 300, resource_ids: [] },
      pending: null,
    });
    expect(await (await get("s1")).json()).toEqual({ kind: "own" });
  });

  it("answers 400 for a session id that is not a name", async () => {
    expect((await get("../x")).status).toBe(400);
  });
});
