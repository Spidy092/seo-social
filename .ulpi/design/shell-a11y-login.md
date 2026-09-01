# Shell + Login — UX/UI Spec & Build Handoff

> Every screen must read as the same product if placed side by side. Binds to `.ulpi/design/DESIGN.md`. Variation within identity, never between.

## Target / Context
- **Product:** SEO Agency OS — Evidence Workspace. Private Fastify + EJS dashboard. Users: senior SEO analysts. Device: desktop-first (240px rail + 1280px grid) + mobile drawer. Browser: modern, JS required.
- **Problem:** Shell is split-brained (`style.css` indigo/purple legacy vs `evidence-desk.css` paper/copper). Login is alien (Tailwind/Outfit/purple blobs). A11y fails Web Interface Guidelines systematically.
- **Goal:** Lock one identity, make shell navigable by keyboard/screen reader, unify login, eliminate anti-patterns.

## User Flows & States (required coverage)

### F1: Enter workspace (login)
1. GET `/login` → paper canvas `#F6F5F0`, centered card 440px, no blobs, `IBM Plex Mono` eyebrow `Evidence desk / sign in`. Happy path: email + password → POST `/login` → redirect `/dashboard`.
2. States: empty (helper text below inputs, not placeholder-only), error inline calm (`DESIGN.md:41` — what failed, when safe, retry), loading spinner inline next to button (not full-screen), success flash then redirect.
3. Edge: wrong password → inline error beside field + focus first error, preserve email, shake 0. Failed provider → “Could not verify — try again, data safe”. Offline → "No connection — retry".
4. A11y: `label for=id`, `autocomplete="email"/"current-password"`, `spellCheck=false` on email, `type=email/password`, visible focus ring copper.

### F2: Navigate workspace (shell)
1. Sidebar rail visible desktop, drawer mobile. Click `<button class="nav-item">` → `navigateTo(page)` → URL `pushState /page` → update `nav-item.active` (copper-tint `#F1E4DD`), expand parent group, show `.page.active` with `edPageIn 180ms`.
2. Group header `<button class="nav-group-header" aria-expanded="true|false">` toggles `collapsed` + `max-height`. Collapse rail via `sidebarCollapseBtn` → 72px icon-only, tooltips on hover (right placement, `data-tooltip`).
3. States: collapsed rail (icons only), drawer overlay mobile (`inert` on main, `overscroll-behavior:contain`), focus not covered by sticky header.
4. Edge: deep link `/research` on load → expand correct group, set `pageTitle`, breadcrumbs.
5. Keyboard: Tab order: skip link → rail toggle → group header → nav items → header search → theme → main. `Ctrl+K` / `Cmd+K` opens palette, `Esc` closes palette/drawer.

### F3: Search via palette / header
- Header center `max-width 420px` trigger → opens `.command-palette-overlay` (backdrop blur 4px). Input `.command-palette-input-wrap` with `label` hidden but `aria-label="Search pages and keywords"`. Results keyboard: ArrowUp/Down, Enter selects, Esc closes. Mobile: palette full-width, header search hidden correctly replaced by icon button.

## Component Specs

### C1: Skip link
- **Purpose:** bypass rail. 
- **Markup:** `<a href="#main-content" class="skip-link">Skip to content</a>` as first child of `body`.
- **Style:** offscreen until `:focus-visible` → top 8px left 8px, copper bg, ink 10px mono. `z-index:80`.

### C2: Sidebar rail (240px / 72px collapsed)
- **Tokens:** `--ed-sidebar:240px`, `--ed-line:#D9DDD5`, `--ed-canvas:#F6F5F0`.
- **Header:** logo `ED` mark 28px ink bg, `Evidence Desk` 15px 800. `sidebarCollapseBtn` 34px `icon-btn` with `aria-label="Collapse sidebar"`.
- **Workspace switcher:** `ED` copper mark 25px, `All clients` 11px strong + 10px muted.
- **Group header:** semantic `<button>` full width, `justify-content:space-between`, `font: 10px/1 IBM Mono 800` `letter-spacing:0.13em` uppercase muted. `aria-expanded`, arrow rotates `-90deg` when collapsed via `transform`.
- **Nav item:** `<button class="nav-item" data-page="...">` flex gap12, `padding 9px 10px`, `border-radius:6px`, `color muted`, `font-size 12px`. `:hover` `bg #F0F2ED` ink, `.active` `bg #F1E4DD` `color #8F3D20` 700. No `::before` accent.
- **Active group auto-expand** on `navigateTo` (`app.js:432` logic).
- **Collapsed:** `width 72px`, hide text/badge via `display:none`, center icons, `nav-group-header` centered.
- **Mobile:** `< 768px` rail `transform:translateX(-100%)` offscreen, `.active` slides in via `transform`. Overlay `rgba(0,0,0,0.5)` `backdrop-filter:blur(2px)` + `overscroll-behavior:contain` + `inert` on `.main-content`.
- **A11y:** every icon `<i aria-hidden="true">`, badge has `aria-label`.

### C3: Header (sticky 70px)
- **Layout:** `height 70px` (auto on wrap), `background rgba(246,245,240,0.94)` `backdrop-filter:blur(12px)`, `border-bottom 1px #D9DDD5`, `padding 12px 32px` (22px <1024, 16px <768). Flex: left 330px / center fluid / right 250px.
- **Breadcrumbs:** `10px` muted, `font-variant-numeric: tabular-nums` on numbers, sep `chevron-right 0.7rem`. Skip if home.
- **Title:** `14px 800` ink (not 1.25rem indigo). `#pageTitle` is page H1 for SEO; shell header shows secondary copy.
- **Search trigger:** `max-width420` `min-height38` `border 1px #D9DDD5` `radius7` white `hover #C8CEC5`. Contains `<i aria-hidden>` + `span.search-hint 11px muted` + `kbd 10px IBM Mono`. On click open palette. Mobile `display:none` replaced by icon-button search (44px) in `.header-right`.
- **Theme toggle:** `34px` `radius7` white `border #D9DDD5` `color muted` `hover ink`. `aria-label` toggles `Toggle dark mode` / `Toggle light mode` + `aria-pressed`.
- **Sticky safety:** `scroll-margin-top:80px` on `#main-content` so anchored headings not covered.

### C4: Command palette (z 5000)
- **Shell:** `overlay` flex `padding-top:15vh` `backdrop-filter:blur(4px)`, `.command-palette` 580px `radius16` white `shadow 0 25px 60px`. Dark: `#1E293B` border `#334155`.
- **Input wrap:** `padding16 20` `border-bottom` + `<i aria-hidden>` + `<input type="search" aria-label>` + `kbd ESC`.
- **Results:** `max-height360` `overflow auto` `overscroll:contain`. Empty `::after` hint. Item `padding10 12` `radius8` `hover #F1F5F9`, `.active` copper tint `rgba(183,85,44,0.08)`.
- **Footer:** kbd hints `↑↓ Enter Esc`.

### C5: Login card (unified)
- **Canvas:** `min-height100vh` `bg var(--ed-canvas)` paper, no blobs/gradients. Center stack 440px.
- **Card:** `bg white` `border 1px #D9DDD5` `radius10` (not 2.5rem) `shadow none`. `backdrop-filter none`.
- **Kicker:** `Evidence desk / sign in` `10px IBM Mono 700 copper 0.08em uppercase`.
- **Title:** `28px 800 -0.04em` ink `Welcome back` (or `Create account`), subtitle `14px 1.65 muted`.
- **Fields:** label `11px Mono 800 uppercase 0.05em` `display block mb7` `for/id`. Input `min-height44` `padding12 16` `border 1px #D9DDD5` `radius6` white `focus border copper + ring 3px rgba(183,85,44,0.12)`. `autocomplete email/new-password` `spellCheck false` `type correct` `placeholder="name@example.com…"`. Helper below input `10px muted`.
- **Button:** copper primary `min-height44` `font 11px 800` `gap8` `transform translateY(-1px)` hover darken `8F3D20`. Disabled until submit, spinner inline `mb` dots neutral → copper.
- **Footer:** `Privacy & Terms` `11px muted` inline, never isolated blobs.

## Accessibility — binding
- Icon-only buttons need `aria-label` (WCAG 4.1.2). Decorative `<i>` `aria-hidden="true"`.
- Form controls: `<label for>` or `aria-label` (never placeholder-only). Visible focus `outline 3px rgba(183,85,44,0.3) offset2`.
- Interactive: `<button>` for actions, `<a>` for navigation. No `<div onClick>` / `<li data-page>` without `role="button" tabindex + onKeyDown`.
- Async updates: `#recentKeywordsTable tbody`, `#recentAlertsList` have `aria-live="polite"` during load.
- Semantic: `<nav class="sidebar" aria-label="Primary">`, `<main id="main-content">`, `<aside>` drawer labelled.
- Avoid `user-scalable=no`, `onPaste preventDefault`, `outline:none` without replacement, `transition: all`.

## Responsive
- Desktop ≥1024: rail 240 + content max1320 centered 38px gutters.
- Tablet 768-1024: rail 240, content 24px gutters, signal grid 2-col, header compact.
- Mobile <768: rail drawer offscreen, hamburger `menuToggle` visible, header search hidden behind search icon button, breadcrumbs single line truncate, signal grid 2→1 at 375, forms single column.

## States coverage matrix
- Login: empty / typing / invalid inline / submitting (disabled + spinner) / success redirect / error provider failed.
- Shell: rail expanded / collapsed / drawer open / overlay inert / palette open / focus-within group / no-JS fallback (links still have `href="/page"` progressive).
- Palette: empty query hint / filtered list / no results / keyboard nav active index.

## Pre-Flight gate (must tick before handoff)
- [x] Identity lock: ONE copper accent, paper/ink, Satoshi+Jakarta→Satoshi+Mono, radius 6/10, motion 180ms, voice calm editorial.
- [x] Anti-slop: no purple/blue glow, no 3 equal hero cards, no blobs/glass, no emoji, no Acme fake data, no em-dash crutch.
- [x] State coverage: loading (skeleton, not spinner), empty (what/why/next), error (what/when/safe/retry).
- [x] A11y: labels, focus, keyboard, aria, semantic HTML, tabular nums, skip link.
- [x] Layout craft: 1280/1320 max, 24/16 gutters, 68ch measure, tabular numbers, balance/pretty headings.
- [x] Cognitive load: ≤7 groups, default collapsed except Overview, command palette first.

## Build handoff
- **Target agent:** `general` (Fastify + EJS + vanilla JS, not Next/Svelte) with `web-design-guidelines` linter.
- **Design system:** bespoke Evidence Desk — theme CSS variables; do NOT redesign component APIs or re-implement FA; use existing `evidence-desk.css` as truth, prune `style.css` indigo.
- **Acceptance:**
  - Shell navigable fully by keyboard + screen reader, focus never covered by sticky header.
  - Login visually indistinguishable from dashboard (same paper/copper/mono/radius).
  - No `transition: all`, no `outline:none` without replacement, no icon without `aria-hidden`+label, no input without label+autocomplete.
  - Lighthouse Accessibility ≥95 on `/login` and `/dashboard` at 1280 and 375 widths.
  - `grep -r "transition: all" public/` = 0, `grep -r "#4f46e5" public/` = 0 (except comments).
  - `Implement exactly this spec. Theme with locked tokens; do NOT redesign components.`
