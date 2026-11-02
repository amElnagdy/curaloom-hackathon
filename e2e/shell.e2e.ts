// The shell's demo machinery over the pages (#66), in a real browser against the built app in
// replay: the demo bar and the trace tab hide no page content, the mode badge explains itself to a
// keyboard and to a touch, and the demo bar's «إعادة» asks before it empties the session.

import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { type ReplayServer, startReplay } from "./server.ts";

let replay: ReplayServer;
test.beforeAll(async () => {
  replay = await startReplay(Number(process.env.E2E_PORT ?? 3190));
});
test.afterAll(async () => {
  await replay?.stop();
});

const PAGES = ["/plan", "/lesson", "/quiz", "/coach", "/consent", "/settings", "/progress"];

// 1440×900 at 100% and at 150% zoom, and a phone. Each with no choice saved, and with the demo bar
// opened by the viewer, which a short screen or a phone shows as a chip until then.
type Screen = {
  name: string;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  open: boolean;
};
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const JUDGE = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const ZOOMED = { viewport: { width: 960, height: 600 }, deviceScaleFactor: 1.5 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 };
const SCREENS: Screen[] = [
  { name: "1440×900", ...DESKTOP, open: false },
  { name: "1280×800", ...JUDGE, open: false },
  { name: "1280×800, bar open", ...JUDGE, open: true },
  { name: "1440×900 at 150%", ...ZOOMED, open: false },
  { name: "1440×900 at 150%, bar open", ...ZOOMED, open: true },
  { name: "phone", ...PHONE, open: false },
  { name: "phone, bar open", ...PHONE, open: true },
];

async function openScreen(browser: Browser, { viewport, deviceScaleFactor, open }: Screen) {
  const context = await browser.newContext({ viewport, deviceScaleFactor, hasTouch: true });
  if (open) await context.addInitScript(() => localStorage.setItem("demo-bar", "open"));
  return context.newPage();
}

// Opens a page and waits until the demo bar has measured the room it takes.
async function visit(page: Page, path: string) {
  await page.goto(`${replay.url}${path}`);
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue("--demo-bar-h") !== "",
  );
  await page.evaluate(() => document.fonts.ready);
}

// The page's elements the demo bar or the trace tab sits on. Both are checked at each scroll of
// main, which is the page scroller. Only parts actually in main's visible box count: overflow
// below the fold shares the demo strip's screen Y but is clipped, not covered. Overlap with the
// top bar, which sits above main, is ignored.
function covered(): string[] {
  const overlays = () =>
    (
      [
        ["demo bar", document.querySelector('section[aria-label="أداة العرض"]')],
        ["demo bar chip", document.querySelector('[aria-label="أظهر أداة العرض"]')?.parentElement],
        ["trace tab", document.querySelector('button[aria-controls="trace-drawer"]')],
      ] as const
    ).flatMap(([name, el]) =>
      el?.checkVisibility() ? [{ name, rect: el.getBoundingClientRect() }] : [],
    );
  const main = document.querySelector("main");
  const parts = main
    ? [...main.querySelectorAll("a, button, input, label, h1, h2, h3, p, li, img, svg")]
    : [];
  const scroller = main ?? document.scrollingElement ?? document.documentElement;
  const end = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const stops = [];
  for (let y = 0; y < end; y += scroller.clientHeight / 3) stops.push(Math.round(y));
  stops.push(end);

  const hits = new Set<string>();
  for (const y of stops) {
    scroller.scrollTop = y;
    const topBar = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
    const view = main?.getBoundingClientRect();
    for (const { name, rect: o } of overlays()) {
      for (const el of parts) {
        if (!el.checkVisibility({ visibilityProperty: true })) continue;
        const r = el.getBoundingClientRect();
        // Overflow below or above main is clipped; it is not sitting under the overlay.
        if (view && (r.bottom <= view.top + 1 || r.top >= view.bottom - 1)) continue;
        const left = Math.max(r.left, o.left);
        const right = Math.min(r.right, o.right);
        const top = Math.max(r.top, o.top, topBar, view?.top ?? 0);
        const bottom = Math.min(r.bottom, o.bottom, innerHeight, view?.bottom ?? innerHeight);
        if (right - left <= 1 || bottom - top <= 1) continue;
        const onTop = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
        if (onTop && !el.contains(onTop) && !onTop.contains(el)) {
          const label = el.getAttribute("aria-label") ?? el.textContent ?? el.tagName;
          hits.add(`${name} on <${el.tagName.toLowerCase()}> ${label.trim().slice(0, 40)}`);
        }
      }
    }
  }
  return [...hits];
}

test("the app serves a favicon", async () => {
  const res = await fetch(`${replay.url}/favicon.ico`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toMatch(/image\//);
});

test("no page content sits under the demo bar or the trace tab", async ({ browser }) => {
  for (const s of SCREENS) {
    await test.step(s.name, async () => {
      const page = await openScreen(browser, s);
      for (const path of PAGES) {
        await visit(page, path);
        expect.soft(await page.evaluate(covered), `${s.name}: ${path}`).toEqual([]);
      }
      await page.context().close();
    });
  }
});

test("the mode badge explains itself to a keyboard and to a touch", async ({ browser }) => {
  // 1440×900 at 150%: the top bar's badge, and the demo bar's chip with its own badge.
  const page = await openScreen(browser, { name: "1440×900 at 150%", ...ZOOMED, open: false });
  await visit(page, "/plan");
  const badges = page.getByRole("button", { name: "ردود مسجّلة REPLAY" });
  const tipOf = async (badge: Locator) =>
    page.locator(`[id="${await badge.getAttribute("popovertarget")}"]`);

  const top = badges.first();
  const tip = await tipOf(top);
  await top.focus();
  await page.keyboard.press("Enter");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("ردود النماذج هنا مسجّلة من تشغيل حقيقي سابق.");
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  await expect(top).toBeFocused();
  await page.keyboard.press("Space");
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");

  // A tap on the chip's badge explains it, and does not open the bar.
  const chipBadge = badges.nth(1);
  const chipTip = await tipOf(chipBadge);
  await chipBadge.tap();
  await expect(chipTip).toBeVisible();
  await expect(page.getByRole("region", { name: "أداة العرض" })).toBeHidden();
  const box = await chipTip.boundingBox();
  const fits =
    box && box.x >= 0 && box.x + box.width <= 960 && box.y >= 0 && box.y + box.height <= 600;
  expect(fits, "the explanation fits the screen").toBe(true);
  // A tap on the empty middle of the top bar.
  await page.touchscreen.tap(600, 28);
  await expect(chipTip).toBeHidden();
  await page.context().close();
});

test("the demo bar's «إعادة» asks before it empties the session", async ({ page }) => {
  await visit(page, "/plan");
  const resets: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/sim/reset")) resets.push(r.url());
  });
  const reset = page.getByRole("button", { name: "إعادة", exact: true });
  const ask = page.getByRole("group", { name: /أتريد أن تبدأ العرض من الصفر؟/ });

  await reset.click();
  await expect(ask).toBeVisible();
  await expect(ask.getByRole("button", { name: "تراجع" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(ask).toBeHidden();
  await expect(reset).toBeFocused();
  await reset.click();
  await ask.getByRole("button", { name: "تراجع" }).click();
  await expect(ask).toBeHidden();
  expect(resets).toEqual([]);

  await reset.click();
  const answer = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/sim/reset"),
  );
  const loaded = page.waitForEvent("load");
  await ask.getByRole("button", { name: "نعم، ابدأ من الصفر" }).click();
  expect((await answer).status()).toBe(200);
  await loaded;
  await expect(page.getByRole("button", { name: "إعادة", exact: true })).toBeVisible();
  await expect(page.getByRole("group", { name: /أتريد أن تبدأ العرض من الصفر؟/ })).toHaveCount(0);
});
