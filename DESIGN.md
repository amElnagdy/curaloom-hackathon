---
name: CuraLoom (working name)
description: A calm, Arabic-first course page that shows an AI-built course taking shape from licensed sources.
colors:
  surface: "#ffffff"
  canvas: "#f9fafb"
  fill: "#f3f4f6"
  fill-strong: "#e9ecf1"
  line: "#e5e7eb"
  line-strong: "#d1d5db"
  ink: "#111827"
  ink-2: "#4b5563"
  ink-3: "#5f6877"
  accent: "#2563eb"
  accent-hover: "#1d4ed8"
  accent-press: "#1e40af"
  accent-50: "#eff6ff"
  accent-100: "#dbeafe"
  ready: "#059669"
  ready-ink: "#047857"
  ready-50: "#ecfdf5"
  attn: "#d97706"
  attn-ink: "#b45309"
  attn-50: "#fffbeb"
  fail: "#dc2626"
  fail-ink: "#b91c1c"
  fail-50: "#fef2f2"
typography:
  display:
    fontFamily: "Noto Sans Arabic, Noto Sans, Noto Sans SC, system-ui, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 700
    lineHeight: 1.35
  headline:
    fontFamily: "Noto Sans Arabic, Noto Sans, Noto Sans SC, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.35
  title:
    fontFamily: "Noto Sans Arabic, Noto Sans, Noto Sans SC, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.35
  body:
    fontFamily: "Noto Sans Arabic, Noto Sans, Noto Sans SC, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.65
  reading:
    fontFamily: "Noto Sans Arabic, Noto Sans, Noto Sans SC, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.95
  label:
    fontFamily: "Noto Sans Arabic, Noto Sans, Noto Sans SC, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1
rounded:
  xs: "6px"
  sm: "8px"
  ctl: "10px"
  md: "12px"
  lg: "16px"
  pill: "999px"
spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-6: "24px"
  s-8: "32px"
  s-12: "48px"
  s-16: "64px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.ctl}"
    padding: "0 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-primary-lg:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "0 24px"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.ctl}"
    padding: "0 16px"
    height: "40px"
  button-disabled:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink-3}"
  pill-ready:
    backgroundColor: "{colors.ready-50}"
    textColor: "{colors.ready-ink}"
    rounded: "{rounded.pill}"
    height: "24px"
  pill-building:
    backgroundColor: "{colors.accent-50}"
    textColor: "{colors.accent-hover}"
    rounded: "{rounded.pill}"
    height: "24px"
  pill-waiting:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.pill}"
    height: "24px"
  pill-attention:
    backgroundColor: "{colors.attn-50}"
    textColor: "{colors.attn-ink}"
    rounded: "{rounded.pill}"
    height: "24px"
  pill-failed:
    backgroundColor: "{colors.fail-50}"
    textColor: "{colors.fail-ink}"
    rounded: "{rounded.pill}"
    height: "24px"
  language-badge:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.xs}"
---

# Design System: CuraLoom (working name)

## Overview

**Creative North Star: "The Calm Course Page"**

The product is the category standard for learning apps, built at the polish of Duolingo, Notion and Coursera or Khan Academy, and written Arabic-first. Ahmed chose that register on purpose over three distinctive worlds. The distinction is precision, not novelty: a white page, ink type, one blue, and a course that visibly assembles from licensed sources while the learner watches.

The density is calm and document-like. The plan is a page you read, with disclosure rows rather than a grid of cards, and a narrow pinned column («ما يحدث الآن») that narrates the agents' work in plain Arabic. The technical layer (models, costs, latency) lives in a drawer behind a tab on the inline end, the left edge in Arabic, opposite the rail. It covers exactly the activity column when open, so one layer replaces the other.

Rejected on record: generic dashboard filler (stat tiles, charts for their own sake), wireframe-grey placeholders, busy screens and novelty styling.

**Key Characteristics:**
- White surface, ink text, one blue accent; status colours appear only where they mean a state.
- Arabic leads; foreign text is always isolated and set in its own script's face.
- Learner numbers in Arabic-Indic digits, technical numbers in Western tabular digits.
- One container elevation, either a border or a soft shadow, never both.
- Calm exponential ease-out motion, none under reduced motion.

## Colors

A restrained palette: neutrals plus one blue, with a small set of status colours that carry state and nothing else.

### Primary
- **Study Blue** (accent): the only brand colour. It marks primary actions, the active route, links, the building state and focus rings. Hover and press deepen it (accent-hover, accent-press); accent-50 and accent-100 tint selection and building pills.

### Neutral
- **Page White** (surface): every page and container ground.
- **Quiet Canvas** (canvas) and **Cool Fill** (fill, fill-strong): grouped areas, disabled buttons, the waiting pill and language badges.
- **Hairline** (line) and **Firm Hairline** (line-strong): container borders, dividers, and secondary button outlines.
- **Ink** (ink): headings and body text. **Ink 2** (ink-2) is used for secondary text. **Ink 3** (ink-3) is the lightest text colour, chosen to stay at least 4.5:1 on white and on fill. Lighter greys are for decorative strokes only.

### Status
- **Ready Green** (ready, ready-ink, ready-50): ready lessons, verified licences, finished steps.
- **Attention Amber** (attn, attn-ink, attn-50): retry and attention states, such as a quiz below the 80% gate or a step being retried.
- **Failed Red** (fail, fail-ink, fail-50): rejected sources and failed steps.
- **Building** reuses Study Blue; **waiting** reuses the neutrals.

### Named Rules
**The One Blue Rule.** Blue is the only hue that is not a state. A second accent never enters the palette.

**The Status Means State Rule.** Green, amber and red appear only on an element whose state they name. Never use them as decoration.

## Typography

**Display, Body and UI Font:** Noto Sans Arabic, with Noto Sans for Latin and Cyrillic and Noto Sans SC for Chinese (loaded on demand). All are served through next/font.

**Character:** a single humanist sans family across three scripts, so a Russian title or a Chinese term sits inside an Arabic sentence without a change of voice.

### Hierarchy
- **Display** (700, 2.5rem, 1.35): the one page title, such as the course title on /plan.
- **Headline** (700, 1.5rem, 1.35): section heads such as «مخطط الدورة».
- **Title** (700, 1.125rem, 1.35): module rows, panel heads and empty-state heads.
- **Body** (400, 0.9375rem, 1.65): interface text and feed lines.
- **Reading** (400, 1.125rem, 1.95): lesson explanations next to a source excerpt. Keep the measure near 65–75ch.
- **Label** (600, 0.75rem): pills, badges and meta. Never letter-spaced or uppercased; Arabic never gets tracking.

### Named Rules
**The Script Face Rule.** Foreign text carries its `lang` and is isolated with `<bdi>` or `dir="auto"`. `:lang(en|ru|fr)` switches to the Latin face and `:lang(zh)` to the CJK face.

**The Two Digit Systems Rule.** Learner-facing numbers use Arabic-Indic digits (٤٥ دقيقة), and so does every Arabic line of the trace: its summaries, counts and simulated times. Trace values (cost, latency, ids, model names) and the English technical line under each event use Western digits with tabular numerals.

**The No Dot Separator Rule.** Never put a middle dot «·» beside Arabic-Indic digits, because it reads as ٠. Separate meta with the hairline separator component.

## Layout

The shell is a fixed frame:
- a slim icon rail on the right (4rem; expands to 15rem with labels, and remembers the choice);
- a top bar (3.5rem) with breadcrumb, sample-data badge and sim-clock pill;
- the page in between.

The plan page is a document column beside the pinned activity column (27rem; 23.5rem at 1280px and below). Pages keep their inline end (the left edge in Arabic) clear of the trace tab (2.5rem plus the page gutter).

Spacing runs on a 4px grid. Groups are tight (8–12px), sections are generous (32–64px), and there is more space above a heading than below it.

The primary target is 1920×1080 (the demo video), and it must hold at 1440×900. Above 1800px the root size steps up to 106.25%. At 760px and below:
- the gutter drops to 16px;
- the trace tab shrinks to icon and badge;
- dense rows stack.

### Named Rules
**The One Layer Rule.** The trace drawer is exactly as wide as the activity column and overlays it. It never pushes or squeezes the page.

## Elevation & Depth

The pages are flat, and depth is mostly tonal: page white on canvas, separated by hairlines. Floating layers (the drawer, menus, tooltips) take the float shadow.

### Shadow Vocabulary
- **Resting** (`box-shadow: 0 1px 2px rgb(17 24 39 / 0.05), 0 4px 12px -2px rgb(17 24 39 / 0.06)`): the rare container that lifts instead of taking a border.
- **Float** (`box-shadow: 0 4px 10px -2px rgb(17 24 39 / 0.08), 0 18px 40px -12px rgb(17 24 39 / 0.22)`): the trace drawer and other overlays.

### Named Rules
**The One Elevation Rule.** A container takes a 1px hairline border or a shadow, never both.

## Shapes

Gently rounded throughout. Radii by use:
- containers: 12–16px (md, lg);
- controls: 10px (ctl);
- small chips and badges: 6–8px (xs, sm);
- status pills: fully rounded.

There are no nested cards, and no coloured side stripes on cards or callouts. Callouts use a tinted fill instead.

## Components

### Buttons
- **Shape:** softly rounded controls (10px; 12px for the large size).
- **Primary:** Study Blue with white text, 40px high (48px large), weight 600. Hover deepens to accent-hover, and press nudges 1px down.
- **Secondary:** white with a firm hairline outline; hover fills with Cool Fill.
- **Disabled:** Cool Fill with Ink 3 text, never a faded blue. A short note says what unlocks it («يُفتح حين يجهز الدرس الأول»).

### Status Pills
- **Style:** 24px, fully rounded, a tinted ground with matching ink, and a small leading dot.
- **States:** ready, building (the dot breathes), waiting (a filled muted dot; a hollow ring reads as ٥), attention, failed.

### Language Badge and Licence Tag
- **Language badge:** a small Cool Fill chip with the code (EN, RU, ZH, FR), 6px radius.
- **Licence tag:** the SPDX id. It shows a check when the licence is verified in code; a rejected one is struck through in Failed Red with the reason beside it.

### Outline Rows (signature)
The course outline is a list of disclosure rows, not cards. Each module head has a title, meta and a status pill, and expands to grouped rows: lessons, sessions, then sources. A row's link clips its own ellipsis, so its focus ring stays visible.

### Activity Feed «ما يحدث الآن» (signature)
- A pinned column with a live sentence on top and a timeline of plain-Arabic lines below.
- No model ids or costs; those belong to the trace.
- Only whole items show; anything cut off above the first visible item is masked.
- Only events that arrive after the first load animate in.
- It ends in the page's primary action.

### Trace Drawer
- **Placement (#60).** The tab and the drawer sit on the inline end, the left edge in Arabic, opposite the rail. The drawer covers the activity column it replaces (the One Layer Rule), and never the rail or the start of the page, where an Arabic reader begins. Beside the rail it would cover the navigation or push the page. The CSS uses logical properties, so the layer moves to the right under `dir="ltr"`.
- The tab shows an icon, «سجل الوكلاء» upright on two short lines (rotated Arabic is hard to read) and a badge with the number of events in the session.
- Open, the drawer sits over a scrim and the page behind it is inert. Esc, the close button, the tab or a click on the scrim closes it, and focus returns to what opened it.
- Filters narrow the list by agent and by kind. «دمج المتكرر» folds identical events that follow each other at the same simulated moment into one row with a count, so the same line on another day, or after other events, keeps its own row. «أحداث الجلسة» always counts the whole session. A status line says how many of those events the list shows, or under the fold how many rows hold how many events («١٧٦ سطرًا تضم ١٧٩ حدثًا»). It hides when nothing matches and the empty state shows.
- Each event row shows the agent, the kind and the simulated time in Arabic, then the Arabic summary. Under them sits the technical line in English, left to right and wrapping anywhere: the ids, then the English summary. Last come the model, the role, latency, cost and running total, with values in tabular Western digits.
- Agents, kinds and model roles have Arabic names, and an Arabic summary names a step by its work, never by an id.
- **The Arabic Line Rule (#59).** An Arabic line holds no Latin words except model ids, tool or library names, and URLs or hosts. It names the language and the count instead of quoting («صاغ عبارتي بحث بالفرنسية»), and calls an image «الرسم». Search queries, image file names, SPDX licence ids and glossary labels such as «BUZZ CUT» stay in `summary_en`, on the English line just below. A glossary correction gives the two Arabic readings: «صحّح جدول المصطلحات المعتمدة ترجمة النموذج لنصوص الرسم من «قصة قصيرة» إلى «قَصّة شعر قصيرة»». `src/server/trace/arabic-line.ts` holds the rule, and the tests of the modules that trace check their lines against it.
- In development, a «تشغيل تجريبي» button starts the dummy run.

### Navigation Rail
- Icon-only at rest, with tooltips; the active route is tinted Study Blue and carries `aria-current`.
- The account group (consent, settings) sits apart.
- Directional icons mirror for RTL; non-directional ones do not.

## Do's and Don'ts

### Do:
- **Do** take every colour, radius, space and motion value from the tokens in `src/app/globals.css`.
- **Do** isolate every foreign-language string with `<bdi>` or `dir="auto"` and give it its `lang`.
- **Do** show provenance on every source: language badge, title, SPDX licence and its verified state.
- **Do** use the exponential ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`) from an already-visible default, and switch motion off under `prefers-reduced-motion`.
- **Do** give disabled actions a one-line reason for what unlocks them.

### Don't:
- **Don't** add stat tiles, charts or progress rings as decoration. This is the generic dashboard Ahmed rejected.
- **Don't** put a label or eyebrow above a heading, or use gradient text, glass, coloured side stripes or emoji.
- **Don't** use a middle dot «·» beside Arabic-Indic digits.
- **Don't** give a container both a border and a shadow, or nest cards.
- **Don't** put model names, costs or latency in learner-facing text outside the trace drawer.
