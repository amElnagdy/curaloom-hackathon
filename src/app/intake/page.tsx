// The interview (#16): the learner's chat with the interviewer beside what it has understood so far,
// then the quick check that sets their level. The chat itself is a client component.

import type { Metadata } from "next";
import { connection } from "next/server";
import { INTAKE_MESSAGES, INTAKE_VOICE_CLIP } from "../../../demo/script.ts";
import { DEMO_SESSION_ID } from "../../../demo/session.ts";
import { config } from "../../config.ts";
import { intakeView } from "../../server/agents/intake/intake.ts";
import { createFileStore } from "../../server/store/store.ts";
import { Page } from "../_shell/blocks.tsx";
import { Interview } from "./interview.tsx";

export const metadata: Metadata = { title: "المقابلة" };

export default async function IntakePage() {
  await connection();
  const view = intakeView(createFileStore(), DEMO_SESSION_ID);

  return (
    <Page>
      <Interview
        sessionId={DEMO_SESSION_ID}
        initial={view}
        recorded={
          config.providerProfile === "replay"
            ? { messages: INTAKE_MESSAGES, voiceClip: INTAKE_VOICE_CLIP }
            : undefined
        }
      />
    </Page>
  );
}
