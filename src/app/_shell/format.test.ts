import { describe, expect, it } from "vitest";
import { splitRuns } from "./format.ts";

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
