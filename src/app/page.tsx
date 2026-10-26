import { config } from "../config";

// Placeholder until the RTL shell lands (#15).
export default function Home() {
  return (
    <main>
      <h1>{config.appName}</h1>
      <p>مساعدك لبناء دورة عربية من مصادر مفتوحة.</p>
    </main>
  );
}
