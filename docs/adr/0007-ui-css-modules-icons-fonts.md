# ADR-007: Plain CSS with tokens and CSS Modules, lucide-react icons, Noto fonts via next/font

**Status:** Accepted (2026-10-28)

## Context

The UI shell (#15) must look native in Arabic RTL in a 1080p demo video. The approved design (layout C on branch `prototype/15-shell`, brief in `.impeccable/surfaces/src-app-layout-tsx.md`) is already written as CSS custom properties: white, ink `#111827`, one blue accent `#2563EB`, cool grey fills, and status colours that only carry meaning. Pages mix Arabic with Latin, Cyrillic and Chinese source excerpts, so the fonts must cover all four scripts. UI kits and utility frameworks bring their own look and often assume left-to-right layout. One developer has a week.

## Decision

- **Styling:** `src/app/globals.css` holds the design tokens as custom properties and the base styles (`::selection`, caret, `:focus-visible`, scrollbars). Each component has its own CSS Module. Layout uses logical properties (`inline-start`, `inline-end`), so RTL is the default rather than an override. No Tailwind and no component library.
- **Icons:** `lucide-react`, pinned to an exact version. Directional icons (chevrons, arrows, the drawer handle) are mirrored for RTL. Other icons are not.
- **Fonts:** Noto Sans Arabic for the UI, Noto Sans for Latin and Cyrillic, and Noto Sans SC for Chinese ship as WOFF2 subsets in `src/app/fonts/`, and `next/font/local` serves them. `scripts/fonts.py` makes the subsets from the Google Fonts repository. Noto Sans SC keeps the Chinese characters in `demo/fixtures/` and the 3755 characters of GB 2312 level 1. It is not preloaded, so a page loads it only when its text needs it. All three are OFL. (Amended 2026-11-01 for #43. The first version used `next/font/google`, which downloads the fonts during the build, so a build without network failed.)

## Consequences

- Changing a colour or spacing step is one edit in `globals.css`. A component's styles sit next to it.
- Every RTL rule is written by hand. No framework supplies them, and none fights them.
- Neither the build nor the browser contacts Google, so the demo runs offline in `replay` mode (ADR-002). Text outside the subsets falls back to a system font. A recording with new Chinese text needs `scripts/fonts.py` run again. (Amended 2026-11-01 for #43.)
- One new runtime dependency (`lucide-react`). Each icon is imported by name, so only the icons in use are bundled.
