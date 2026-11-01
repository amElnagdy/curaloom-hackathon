import { describe, expect, it } from "vitest";
import { clockTime, splitRuns } from "./format.ts";

describe("clockTime", () => {
  it("keeps the time and its «ص» or «م» on one line", () => {
    expect(clockTime("22:00")).toBe("١٠:٠٠ م");
    expect(clockTime("08:30")).toBe("٨:٣٠ ص");
    expect(clockTime("12:00")).toBe("١٢:٠٠ ظهرًا");
  });
});

const foreign = (text: string) =>
  splitRuns(text)
    .filter((r) => r.foreign)
    .map((r) => r.text);

describe("splitRuns", () => {
  it("leaves the parentheses around a foreign term to the Arabic text", () => {
    expect(foreign("في الجدول المحوري (PivotTable)؟")).toEqual(["PivotTable"]);
  });

  it("keeps parentheses the foreign run opens itself", () => {
    expect(foreign("استعمل الدالة SUM(A1:A9) هنا")).toEqual(["SUM(A1:A9)"]);
  });
});
