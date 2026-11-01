import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModeBadge } from "./mode-badge.tsx";
import { MODE } from "./ui.tsx";

const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`, "i"))?.[1];
const text = (html: string) => html.replace(/<[^>]+>/g, " ");

describe("the mode badge", () => {
  it.each(["replay", "record", "live"] as const)(
    "opens its explanation from a button, with no hover (%s)",
    (profile) => {
      const html = renderToStaticMarkup(<ModeBadge profile={profile} />);
      const [button = "", buttonTag = ""] = html.match(/(<button[^>]*>).*?<\/button>/s) ?? [];
      const target = attr(buttonTag, "popovertarget");
      const [, tipTag = "", tip = ""] =
        html.match(new RegExp(`(<div[^>]*\\sid="${target}"[^>]*>)(.*?)</div>`, "s")) ?? [];

      expect(text(button)).toContain(MODE[profile].label);
      expect(buttonTag).not.toContain("title=");
      expect(attr(buttonTag, "aria-describedby")).toBe(target);
      expect(attr(tipTag, "popover")).toBe("auto");
      for (const sentence of MODE[profile].about) expect(text(tip)).toContain(sentence);
      expect(text(tip)).toContain("المتعلم شخصية تجريبية.");
    },
  );
});
