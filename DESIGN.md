# Design System: SEO Agency OS — Evidence Workspace

## 1. Visual Theme & Atmosphere

**Creative north star: The Evidence Desk.** This is a professional workbench for senior SEO analysts, not a marketing dashboard. The atmosphere is calm, editorial, and exact: warm paper-like surfaces, charcoal ink, a single copper signal color, and compact data typography. Density is 6/10, variance is 5/10, and motion is 3/10. The interface should feel like a well-run newsroom or analyst desk: every number has a source, every warning has a next action, and nothing decorative competes with proof.

## 2. Color Palette & Roles

- **Paper Canvas** (`#F6F5F0`) — app background and wide breathing room.
- **Clean Surface** (`#FFFFFF`) — primary workspace surfaces and focused panels.
- **Charcoal Ink** (`#1D2420`) — headings, primary text, and navigation depth; never pure black.
- **Quiet Moss** (`#66706A`) — secondary text, helper copy, timestamps, and metadata.
- **Structural Line** (`#D9DDD5`) — restrained table rules and control boundaries.
- **Copper Signal** (`#B7552C`) — one accent for primary actions, active navigation, focus rings, and the one most important change indicator.
- **Measured Green** (`#28704D`) — semantic success only; fresh/verified source state.
- **Caution Ochre** (`#966617`) — semantic warning only; stale/partial state.
- **Failure Brick** (`#A43D35`) — semantic error only; failed/unavailable state.

Use the same neutral temperature across the product. Do not introduce blue or purple for decoration. Semantic colors must always be paired with text labels and icons; color alone never carries data meaning.

## 3. Typography Rules

- **Display and headings:** Satoshi, weight 650–700, tight tracking, controlled sizes (32px maximum for workspace headings).
- **Body and controls:** Satoshi, 15–16px, 1.5 line-height, maximum 68ch for explanatory text.
- **Numbers, dates, IDs, and source values:** IBM Plex Mono, 13–14px, tabular alignment.
- **Labels:** Satoshi, 12–13px, medium weight, sentence case; use uppercase only for compact table metadata.
- **Banned:** Inter, Roboto, Arial, generic system stacks, decorative serif type, oversized gradient headlines, and low-contrast microcopy.

## 4. Component Stylings

- **Workspace shell:** 240px persistent desktop rail, compact mobile drawer, project context always visible in the top bar.
- **Primary actions:** Copper fill, charcoal-on-copper text, 44px minimum height, sentence-case imperative labels. Active state translates up 1px; no glow.
- **Secondary actions:** White or paper surface with structural line; use for cancel, filter, and lower-priority actions.
- **Panels:** Use open groups, table rows, and tonal sections before cards. Cards exist only when a bounded interaction or comparison needs elevation. Avoid equal-size card mosaics.
- **Data tables:** Left-align labels, right-align numeric values, use IBM Plex Mono for numbers, show source/freshness status beside any value that can be stale.
- **Status markers:** Small text + icon + semantic color. “Fresh,” “Stale,” “Partial,” “Unavailable,” and “Estimated” must be explicit words.
- **Evidence drawer:** A right-side desktop drawer and full-screen mobile sheet showing source, collected time, coverage, calculation, and underlying rows/URLs.
- **Forms:** Visible label above the field, helper text below, no placeholder-only labels, 44px target height, explicit disabled/loading/error states.
- **Loaders:** Layout-matched skeletons and source-run progress rows; no generic full-page spinners.
- **Empty states:** Explain what is missing, why it matters, and the one next action (connect a source, run an audit, or choose a project). Never show a bare “No data.”
- **Error states:** Inline, calm, specific, recoverable. State what failed, when it last worked, whether existing data is safe, and the retry action.

## 5. Layout Principles

Use a 12-column desktop grid with a 1280px content maximum, 24px gutters, and 16px minimum mobile margins. The first viewport is an orientation surface, not a mosaic: project identity, “what changed,” source health, and the highest-priority next action are the only primary elements. Use a 3:2 split between evidence/work and context when both are needed.

Information order is strict: **context → change → proof → action → delivery**. Tools such as keyword research, on-page SEO, technical SEO, and humanizer live under the selected project rather than competing with the project outcome. Prefer whitespace and thin structural rules; use elevation sparingly.

## 6. Motion & Interaction

Motion is restrained and informative. Use 160–220ms ease-out transitions for navigation, drawer entry, source-state updates, and row hover. Animate only `transform` and `opacity`. Respect `prefers-reduced-motion`. Do not add perpetual loops to data surfaces; a moving loader must communicate active work and stop when the run ends. Never use motion to hide a failure or delay access to evidence.

## 7. Responsive & Accessibility Rules

- Below 768px, the rail becomes a labeled drawer; the project name and report action remain pinned in the top bar.
- Tables become stacked evidence rows with the metric label, value, status, and source in that order; no horizontal scrolling for core report actions.
- Evidence drawers become full-screen sheets with a clear close button and preserved back navigation.
- All interactive targets are at least 44px; keyboard focus uses a 2px copper outline with a 2px offset.
- Use landmarks (`nav`, `main`, `aside`), visible focus, correctly associated labels, live regions for run progress, and text equivalents for every status icon.
- Maintain WCAG AA contrast for body text and never rely on red/green alone.

## 8. Anti-Patterns (Banned)

- No purple/blue neon gradients, glow effects, decorative blobs, or glassmorphism.
- No 3-column equal feature/card grids or dashboard walls of identical rounded cards.
- No fabricated metrics, fake client names, fake percentages, or invented source freshness.
- No unexplained health score; every score must show its calculation and source coverage.
- No unlabeled AI-generated copy; AI interpretation must be visually and textually distinct from measured data and deterministic rules.
- No emojis, generic “Welcome to…” copy, “seamless,” “next-gen,” or other AI clichés.
- No giant hero on the app home; the workspace begins with the selected client/project and the work that needs attention.
- No tiny gray text, placeholder-only form labels, inaccessible color-only statuses, or hidden partial/error states.
