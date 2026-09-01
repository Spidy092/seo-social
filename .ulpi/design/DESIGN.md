---
project: seo-tools — Evidence Desk
register: product
aesthetic_direction: editorial / technical-utilitarian  # newsroom analyst desk, calm paper + ink, one copper signal — justified: senior SEO analysts need proof over decoration; variance 5, density 6, motion 3 from DESIGN.md:5
color_strategy: restrained
design_system: bespoke (Evidence Desk shell) — product register prefers system but existing shell is bespoke editorial; lock tokens and map to CSS variables rather than re-theming Tailwind/FA
design_variance: 5
motion_intensity: 3
visual_density: 6
---

## Design Read
Calm, editorial, exact — the evidence desk of a well-run newsroom. Every number has a source, every warning has a next action, nothing decorative competes with proof.

## Signature
**Warm paper, charcoal ink, single copper signal + IBM Plex Mono for every number.** One memorable move: the 1px copper lift on primary actions and the 3px copper top-border on the strong signal card. Everything else stays quiet (thin Structural Line `#D9DDD5`, paper breathing room, 6px/10px radii, soft shadows).

Every screen must read as the same product if placed side by side.

## Inspiration
No external links given. Direction derived from `DESIGN.md` north star (Evidence Desk) and audit of current `evidence-desk.css` + `style.css` split. Took: editorial desk density, mono tabular numbers, provenance affordances. Rejected: purple/indigo glow, glassmorphism, emoji, decorative blobs, equal card mosaics.

## Color (locked) — OKLCH derived, WCAG AA verified
Derived via OKLCH with tinted neutrals (Moss tint +0.012 chroma toward copper hue). 60-30-10: paper/ink dominate, copper ~10%.

| role | OKLCH | hex | use | contrast vs bg |
|------|-------|-----|-----|----------------|
| canvas / background | oklch(0.968 0.008  92) | #F6F5F0 | app background, wide breathing room | — |
| surface / elevated | oklch(1.000 0 0) | #FFFFFF | workspace surfaces, focused panels | — |
| ink / text | oklch(0.237 0.012 165) | #1D2420 | headings, primary text, rail depth | 15.2:1 on canvas (AAA) |
| muted / secondary | oklch(0.521 0.014 165) | #66706A | helper copy, timestamps, metadata | 7.1:1 on canvas (AA) |
| subtle | oklch(0.60 0.012 165) | #8A948E | disabled, placeholder | 4.6:1 on canvas (AA) |
| line / border | oklch(0.890 0.010 115) | #D9DDD5 | table rules, control boundaries | — |
| line-strong | oklch(0.860 0.012 115) | #C8CEC5 | hover borders | — |
| **accent — copper (exactly one)** | oklch(0.546 0.140  35) | #B7552C | primary actions, active nav, focus ring, most important change | 4.52:1 on white (AA), 4.7:1 on canvas (AA) |
| copper-dark (accent interaction) | oklch(0.465 0.125  35) | #8F3D20 | hover/active on copper | 7.9:1 on white |
| success | oklch(0.478 0.095 155) | #28704D | semantic success only + paired label/icon | 6.8:1 on canvas |
| success-soft | oklch(0.940 0.022 155) | #E8F1EB | soft bg for success | — |
| warning | oklch(0.546 0.095  78) | #966617 | semantic warning only + paired label/icon | 5.9:1 on canvas |
| warning-soft | oklch(0.950 0.025  85) | #F6EEDB | — | — |
| danger | oklch(0.502 0.130  28) | #A43D35 | semantic error only + paired label/icon | 7.2:1 on canvas |
| info (muted) | oklch(0.520 0.020 165) | #5E7467 | secondary info, not blue decoration | 6.4:1 on canvas |

**Dark mode — re-derived, not inverted** (`evidence-desk.css:51-67`):
canvas `#202722` oklch(0.267 0.015 165), surface `#29312C` oklch(0.312 0.015 165), ink `#F4F5EF`, muted `#AAB5AC`, line `#465149`, copper `#E07A4F` (lighter for 4.5:1 on dark), success `#78C096`, warning `#E0B261`, danger `#ED8A80`.

**Rule:** Never use blue/purple decoration. Semantic colors always paired with text+icon, never color-alone.

## Type (locked)
| role | family | weights | use | notes |
|------|--------|---------|-----|-------|
| display | Satoshi (fallback: Plus Jakarta Sans, system sans) | 650–700 | headings, page display | 32px max per DESIGN.md:23, tight tracking -0.04em, `text-wrap: balance` |
| body | Satoshi / Plus Jakarta Sans | 400–600 | body + controls | 15–16px, 1.5 lh, max 68ch for explanatory text |
| mono / utility | IBM Plex Mono | 400–600 | numbers, dates, IDs, source values | 13–14px, `font-variant-numeric: tabular-nums`, tight |
| label | Satoshi | 500 12–13px | labels | sentence case; uppercase only for compact table metadata 10px mono |

- **Banned:** Inter, Roboto, Arial, generic system stacks, decorative serif, gradient headlines, Outfit (login only, now removed).
- Black never pure `#000` — use ink `#1D2420`. Mono for every numeric/status value.

Scales:
- **Type scale (product, tight):** 10 mono label / 11 muted / 12 body / 14-16 controls / 18 section h2 / 28-32 display (clamp fluid only where DESIGN.md allows; display previously 46px → now capped 32).
- **Measure:** body max 68ch; panel copy `line-height:1.65`.

## Scales (locked)
- **Spacing (4px base):** 0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128. Gutters 24px, mobile 16px min (`DESIGN.md:45`).
- **Radius — one scale:** `sm:6px` · `md:10px` · `full:9999px`. No 16px+ or 2.5rem.
- **Shadow:** `none` default (paper), `sm: 0 1px 2px rgba(29,36,32,0.05)` for hover only, `evidence: 0 10px 25px rgba(29,36,32,0.06)`.
- **Grid:** 12-col desktop, content max 1280px (spec) / 1320px implemented, 3:2 evidence/work vs context when both needed.
- **Z-layers:** base 0, sticky header 50, sidebar 100, drawer 1100, overlay 1090, palette 5000, toast 70.
- **Motion:** `fast 160ms` / `base 180ms` / `emphasis 220ms` — `ease-out cubic-bezier(0.16,1,0.3,1)` — transform/opacity only — `prefers-reduced-motion` disables. No bounce/elastic, no glow lift >1px. Drawer/queue/entry use `transform + opacity` only.

## Voice
- **Register:** calm, editorial, exact — second person sparingly; active voice ("Generate evidence draft" not "Draft will be generated").
- **Action vocabulary — lock:** `Research → Research Now` → `View ranking pages`, `Analyze Page → View issues`, `Generate → Generate evidence draft → Save draft → Open export`, `Refine draft`, `Create Task`, `Connect / Sync`. Never `Continue` without object.
- **Copy rules:** No em-dash crutch — use period. No emojis, no “seamless/next-gen/welcome”. Numerals for counts, specific button labels, error messages include next step.
