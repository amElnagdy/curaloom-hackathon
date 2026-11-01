import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Rail } from "./rail.tsx";
import { TraceProvider } from "./trace-provider.tsx";

vi.mock("next/navigation", () => ({ usePathname: () => "/plan" }));

describe("the rail's logo", () => {
  it("names the app as config gives it, with no note beside the name (#64)", () => {
    const html = renderToStaticMarkup(
      <TraceProvider sessionId="demo">
        <Rail appName="Some App" learnerName="عمر" />
      </TraceProvider>,
    );
    const logo = html.match(/<a [^>]*href="\/"[^>]*>(.*?)<\/a>/s)?.[1] ?? "";

    expect(logo.replace(/<[^>]+>/g, "")).toBe("Some App");
  });
});
