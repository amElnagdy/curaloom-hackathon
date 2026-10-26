import type { Metadata } from "next";
import type { ReactNode } from "react";
import { config } from "../config";

export const metadata: Metadata = { title: config.appName };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
