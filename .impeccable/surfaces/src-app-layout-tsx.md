---
version: 1
slug: "src-app-layout-tsx"
primary_target: "src/app/layout.tsx"
related_targets: ["src/app/page.tsx"]
---

# App shell (#15)

Mode: Operate. Omar on a laptop in an evening study session; judges see it in a 3-minute 1080p video.
Hero moment: Omar's course assembling live while six named agents work. The trace is a drawer that toggles in at key beats.
Proof: language badges, SPDX licences, Arabic lesson text, model and cost per step. Sample data is labelled as sample. Layout C (course outline + activity feed) chosen.
Anti-goals: generic dashboard filler (stat tiles, charts for their own sake), wireframe look, busy screens, novelty styling.
Open: product name (config.appName), demo topic (config.demoTopic).

## Direction contract

THESIS: The category standard for learning apps at full craft (Duolingo's clear next step, Notion's calm reading, Coursera's course structure). It refuses novelty worlds and dashboard filler; the distinction is precision and believable live agent work.
OWN-WORLD: White surface, ink #111827, one blue accent #2563EB, cool grey #F3F4F6 fills, Noto Sans Arabic. Right sidebar nav with line icons, top bar, rounded 12–16px containers with one elevation each, status pills (ready green, building blue, waiting grey, attention amber).
STORY: Omar sees his course being built for him from licensed sources in four languages, understands who is doing what, and starts his first 45-minute session when it is ready.
FIRST VIEWPORT: Layout C (course outline), chosen by Ahmed on 2026-10-28 from three prototypes on branch prototype/15-shell. Slim icon rail on the right that expands to labels (8 routes). Top bar: breadcrumb, sample-data badge, sim clock. Main: a document-style course page (title, properties row: goal, hours, source languages, status) with the course outline as calm disclosure rows (modules, then lessons, sessions and sources with language badges and SPDX licences), not cards. Pinned column at inline-end: «ما يحدث الآن», a plain-Arabic activity feed for Omar driven by live trace events, ending in the primary action. Technical trace drawer from a tab on the left edge with a live count; it overlays the feed column.
FORM: canon (the standing exit), chosen over the dealt hand; seed:52b02d4b592ba511
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
