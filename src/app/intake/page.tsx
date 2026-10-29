// The interview (#15 slot; the intake chat is #16): the finished interview summary from Omar's
// seeded profile and consent — goal, weekly hours, background, level, source languages and his
// message limits — with the diagnostic scores and the way on to the plan.

import {
  ArrowRight,
  Calendar,
  Check,
  CircleDashed,
  Languages,
  MessageCircle,
  Minus,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import type { LearnerProfile } from "../../../contracts/index.ts";
import { loadOmarSeed } from "../../../demo/seed.ts";
import { config } from "../../config.ts";
import { LiveStatusPill } from "../_shell/activity-feed.tsx";
import {
  Columns,
  EmptyState,
  MarkItem,
  MarkList,
  MetaItem,
  Page,
  PageHead,
  Panel,
  Stack,
} from "../_shell/blocks.tsx";
import { courseStatus, simDay } from "../_shell/course.ts";
import { arabicNumber, clockTime, countOf, HOURS, ordinal, QUESTIONS } from "../_shell/format.ts";
import {
  BidiText,
  buttonClass,
  DirIcon,
  LANG_NAMES,
  LangBadge,
  StatusPill,
} from "../_shell/ui.tsx";
import styles from "./intake.module.css";

export const metadata: Metadata = { title: "المقابلة" };

const LEVEL: Record<LearnerProfile["diagnostic"]["level"], string> = {
  beginner: "مبتدئ",
  intermediate: "متوسط",
  advanced: "متقدم",
};
const DIALECT: Record<LearnerProfile["dialect"], string> = {
  msa: "الفصحى",
  gulf: "الخليجية",
  egyptian: "المصرية",
  levantine: "الشامية",
  maghrebi: "المغاربية",
  other: "لهجتك",
};
// Background tags the intake agent records, in Arabic; a tag not listed shows as written.
const BACKGROUND: Record<string, string> = {
  accounting: "المحاسبة",
  excel: "Excel",
  finance: "المالية",
  sql: "SQL",
  python: "Python",
};

function scoreMark(score: number) {
  if (score >= 1) return { mark: <Check />, tone: "ready" as const, label: "درجة كاملة" };
  if (score > 0) {
    return {
      mark: <Minus />,
      tone: "neutral" as const,
      label: score === 0.5 ? "نصف درجة" : "درجة جزئية",
    };
  }
  return { mark: <CircleDashed />, tone: "neutral" as const, label: "لم تعرفه بعد" };
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.fact}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function IntakePage() {
  const seed = loadOmarSeed(config.demoTopic);
  const { profile, consent } = seed;
  const { diagnostic } = profile;
  const total = diagnostic.scores.reduce((sum, s) => sum + s.score, 0);
  const quiet = consent.quiet_hours;
  const dialect = DIALECT[profile.dialect];
  const course = courseStatus(seed);
  const background = profile.background.map((tag) => BACKGROUND[tag] ?? tag).join("، ");

  return (
    <Page>
      <PageHead
        title="ملخص المقابلة"
        pill={<StatusPill status="ready">مكتملة</StatusPill>}
        meta={
          <>
            <MetaItem icon={MessageCircle}>مع المحاور</MetaItem>
            <MetaItem icon={Calendar}>{simDay(consent.granted_sim_day ?? 0)}</MetaItem>
            <MetaItem icon={Languages}>
              {profile.dialect === "msa" ? "بالفصحى" : `باللهجة ${dialect}، والردود بالفصحى`}
            </MetaItem>
          </>
        }
        lede={
          <>
            على هذا الملخص بنى الوكلاء خطتك. إن تغيّر شيء في أسبوعك، عدّل حدودك من{" "}
            <Link href="/consent">صفحة الموافقة</Link>.
          </>
        }
      />

      <Columns>
        <Stack>
          <Panel id="facts-title" title="ما فهمناه منك">
            <dl className={styles.facts}>
              <Fact label="الهدف">
                <BidiText text={profile.goal} />
              </Fact>
              <Fact label="وقتك في الأسبوع">{countOf(profile.hours_per_week, HOURS)}</Fact>
              <Fact label="خلفيتك">
                <BidiText text={background} />
              </Fact>
              <Fact label="مستواك الآن">{LEVEL[diagnostic.level]}</Fact>
              <Fact label="لغات المصادر">
                <span className={styles.langs}>
                  {profile.source_langs_ok.map((lang) => (
                    <LangBadge key={lang} lang={lang} />
                  ))}
                  {profile.source_langs_ok.map((lang) => LANG_NAMES[lang]).join(" و")}، ويصلك ما
                  فيها بالعربية
                </span>
              </Fact>
              <Fact label="الرسائل">
                {quiet
                  ? `لا رسائل من ${clockTime(quiet.start)} حتى ${clockTime(quiet.end)}`
                  : "في أي وقت"}
              </Fact>
            </dl>
          </Panel>

          <Panel
            id="chat-title"
            title="المحادثة"
            sub={`يفهم المحاور اللهجة ${dialect}، ويجيب بالفصحى.`}
          >
            <EmptyState
              inline
              icon={MessageCircle}
              text="نص هذه المحادثة ليس في البيانات التجريبية. في المقابلة الحقيقية تظهر هنا أسئلة المحاور وإجاباتك."
            />
          </Panel>
        </Stack>

        <Stack>
          <Panel
            id="diagnostic-title"
            title="الاختبار التشخيصي"
            sub={`${countOf(diagnostic.scores.length, QUESTIONS)} قبل الخطة، لتعرف من أين تبدأ`}
          >
            <MarkList>
              {diagnostic.scores.map((s, i) => {
                const { mark, tone, label } = scoreMark(s.score);
                return (
                  <MarkItem
                    key={s.question_id}
                    mark={mark}
                    tone={tone}
                    title={`السؤال ${ordinal(i)}`}
                    value={label}
                  />
                );
              })}
            </MarkList>
            <p className={styles.total}>
              النتيجة {arabicNumber(total)} من {arabicNumber(diagnostic.scores.length)}، والمستوى{" "}
              {LEVEL[diagnostic.level]}. لذلك تبدأ الخطة من الأساسيات.
            </p>
          </Panel>

          <Panel
            id="next-title"
            title="خطوتك التالية"
            aside={<LiveStatusPill status={course.status} label={course.label} />}
          >
            <p className={styles.next}>يبني الوكلاء دورتك من هذا الملخص. ابدأ من خطتك.</p>
            <Link href="/plan" className={buttonClass("primary", "lg", { className: styles.cta })}>
              اذهب إلى خطتك
              <DirIcon icon={ArrowRight} />
            </Link>
          </Panel>
        </Stack>
      </Columns>
    </Page>
  );
}
