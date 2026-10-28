import { describe, expect, it } from "vitest";
import { ROUTES, routeForPath } from "./routes";

describe("route registry", () => {
  it("lists the eight app routes, learner routes first", () => {
    expect(ROUTES.map((r) => r.id)).toEqual([
      "intake",
      "plan",
      "lesson",
      "quiz",
      "progress",
      "coach",
      "consent",
      "settings",
    ]);
  });

  it("gives every route a path, an Arabic label and an icon", () => {
    for (const route of ROUTES) {
      expect(route.path).toBe(`/${route.id}`);
      expect(route.label).toMatch(/^[\u0600-\u06FF ]+$/);
      expect(route.icon).toBeDefined();
    }
  });

  it("keeps ids and paths unique", () => {
    expect(new Set(ROUTES.map((r) => r.id)).size).toBe(ROUTES.length);
    expect(new Set(ROUTES.map((r) => r.path)).size).toBe(ROUTES.length);
  });

  it("puts consent and settings in the account group", () => {
    const account = ROUTES.filter((r) => r.group === "account").map((r) => r.id);

    expect(account).toEqual(["consent", "settings"]);
  });

  it("finds the route for a path and its sub-paths, not for pages outside the nav", () => {
    expect(routeForPath("/plan")?.id).toBe("plan");
    expect(routeForPath("/lesson/L1")?.id).toBe("lesson");
    expect(routeForPath("/dev/bidi")).toBeUndefined();
    expect(routeForPath("/planner")).toBeUndefined();
  });
});
