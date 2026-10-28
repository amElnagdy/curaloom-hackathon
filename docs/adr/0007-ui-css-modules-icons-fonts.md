# ADR-007: Plain CSS with tokens and CSS Modules, lucide-react icons, Noto fonts via next/font

**Status:** Accepted (2026-10-28)

## Context

The UI shell (#15) must look native in Arabic RTL in a 1080p demo video. The approved design (layout C on branch `prototype/15-shell`, brief in `.impeccable/surfaces/src-app-layout-tsx.md`) is already written as CSS custom properties: white, ink `#111827`, one blue accent `#2563EB`, cool grey fills, and status colours that only carry meaning. Pages mix Arabic with Latin, Cyrillic and Chinese source excerpts, so the fonts must cover all four scripts. UI kits and utility frameworks bring their own look and often assume left-to-right layout. One developer has a week.

## Decision

- **Styling:** `src/app/globals.css` holds the design tokens as custom properties and the base styles (`::selection`, caret, `:focus-visible`, scrollbars). Each component has its own CSS Module. Layout uses logical properties (`inline-start`, `inline-end`), so RTL is the default rather than an override. No Tailwind and no component library.
- **Icons:** `lucide-react`, pinned to an exact version. Directional icons (chevrons, arrows, the drawer handle) are mirrored for RTL. Other icons are not.
- **Fonts:** `next/font/google` self-hosts Noto Sans Arabic for the UI, Noto Sans for Latin and Cyrillic, and Noto Sans SC for Chinese. Noto Sans SC is not preloaded, so pages without Chinese do not download it. All three are OFL.

## Consequences

- Changing a colour or spacing step is one edit in `globals.css`. A component's styles sit next to it.
- Every RTL rule is written by hand. No framework supplies them, and none fights them.
- The build downloads the font files once. The browser never contacts Google, so the demo runs offline in `replay` mode (ADR-002).
- One new runtime dependency (`lucide-react`). Each icon is imported by name, so only the icons in use are bundled.
