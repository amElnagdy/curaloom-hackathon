import type { Metadata } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { loadOmarSeed } from "../../demo/seed.ts";
import { DEMO_SESSION_ID } from "../../demo/session.ts";
import { config } from "../config.ts";
import { ladderMarks } from "../server/coach/ladder.ts";
import { Shell } from "./_shell/shell.tsx";
import { TraceProvider } from "./_shell/trace-provider.tsx";
import "./globals.css";

// The fonts are subsets made by scripts/fonts.py, so the build needs no network.
// Arabic leads. Its subset keeps the Latin range, so Latin inside Arabic text uses its Latin glyphs, and
// Cyrillic falls through to Noto Sans. No size-adjusted fallback face for the Arabic font.
const arabic = localFont({
  src: "./fonts/NotoSansArabic.woff2",
  weight: "100 900",
  variable: "--font-arabic",
  adjustFontFallback: false,
});
const latin = localFont({
  src: "./fonts/NotoSans.woff2",
  weight: "100 900",
  variable: "--font-latin",
});
// Chinese is the largest file and rare on a page, so it is not preloaded. A page loads it when its
// text needs it.
const chinese = localFont({
  src: "./fonts/NotoSansSC.woff2",
  weight: "100 900",
  variable: "--font-zh",
  preload: false,
});

export const metadata: Metadata = {
  title: { default: config.appName, template: `%s | ${config.appName}` },
  description: "دورة عربية تُبنى لك من مصادر مفتوحة الترخيص بأربع لغات.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const learner = loadOmarSeed(config.demoTopic).profile;
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`${arabic.variable} ${latin.variable} ${chinese.variable}`}
    >
      <body>
        <TraceProvider sessionId={DEMO_SESSION_ID}>
          <Shell
            appName={config.appName}
            learnerName={learner.name}
            providerProfile={config.providerProfile}
            simClock={config.simClock}
            devTools={config.devTools}
            sessionId={DEMO_SESSION_ID}
            demoMarks={ladderMarks()}
          >
            {children}
          </Shell>
        </TraceProvider>
      </body>
    </html>
  );
}
