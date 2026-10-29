import type { Metadata } from "next";
import { Noto_Sans, Noto_Sans_Arabic, Noto_Sans_SC } from "next/font/google";
import type { ReactNode } from "react";
import { loadOmarSeed } from "../../demo/seed.ts";
import { DEMO_SESSION_ID } from "../../demo/session.ts";
import { config } from "../config.ts";
import { PLACEHOLDER_RULES } from "../server/clock/scheduler.ts";
import { Shell } from "./_shell/shell.tsx";
import { TraceProvider } from "./_shell/trace-provider.tsx";
import "./globals.css";

// Arabic leads; Latin and Cyrillic source text use Noto Sans. No size-adjusted fallback face for the
// Arabic font, so Latin text falls through to Noto Sans instead of a system face.
const arabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-arabic",
  adjustFontFallback: false,
});
const latin = Noto_Sans({ subsets: ["latin", "cyrillic"], variable: "--font-latin" });
// Chinese is large and rare on a page: not preloaded; the browser fetches the slices it needs.
const chinese = Noto_Sans_SC({ variable: "--font-zh", preload: false });

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
            demoMarks={PLACEHOLDER_RULES.map((rule) => ({ day: rule.at.day, type: rule.type }))}
          >
            {children}
          </Shell>
        </TraceProvider>
      </body>
    </html>
  );
}
