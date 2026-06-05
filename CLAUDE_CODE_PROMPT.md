# Claude Code prompt — Port the "Sage Observatory" redesign into the Pawtropolis web app

Copy everything in the box below and paste it into Claude Code, run from the repo root
(the folder that contains `web/`). Keep `design_handoff/Pawtropolis — Sage Observatory (standalone).html`
in the repo so Claude Code can open it as the visual source of truth.

---

You are reskinning the Pawtropolis moderation dashboard (SvelteKit, in `web/`). I have a finished
visual prototype to port. **Open `design_handoff/Pawtropolis — Sage Observatory (standalone).html`
in a browser — that file is the source of truth for look, motion, and copy.** It is a design
reference built in React/HTML; do NOT copy its code. Recreate the design using the app's existing
Svelte + CSS-variable patterns.

## Goal
Replace ALL current dashboard themes with one unified theme called **Sage Observatory**: a calm,
deep-space, sage-green look that is warm and tactile (paper grain, square corners, hairline borders,
hand-plotted "tick" dividers, warm humanist type, a quiet drifting starfield). Keep a **Legacy
toggle** that reverts the entire app to today's "Cozy Holdfast" look for compatibility. Add a
**Night/Day** (dark/light) toggle for the new theme.

## What exists today (read these first)
- `web/src/app.css` — current "Cozy Holdfast" tokens (oklch, adapts hue to Discord accent).
- `web/src/lib/stores/style.ts` — `StyleName` union + style switching (holdfast / soft-neu / frost / ranger).
- `web/src/lib/stores/theme*` — `applyPalette`, `resetToDiscordTheme` (adaptive accent — KEEP this).
- `web/src/lib/components/layout/ThemeControls.svelte` and `Nav.svelte` — sidebar + style switcher.
- `web/src/routes/dashboard/+layout.svelte`, `+page.svelte` (home), `reviews/+layout.svelte`,
  `reviews/+page.svelte`, and `web/src/lib/components/review/*` (queue + detail).
- `$lib/motion` exposes `prefersReducedMotion`.

## Plan
1. **Collapse the 4 styles into 2 themes.** Replace the `StyleName` union and the style switcher with
   a single mode model: `'observatory-dark' | 'observatory-light' | 'legacy'`. Persist the choice
   with the same cookie/localStorage mechanism `style.ts` already uses. Default = `observatory-dark`.
   `legacy` must reproduce today's exact look (port the current `app.css` values verbatim into a
   `[data-theme="legacy"]` block). Keep the Discord adaptive-accent behaviour wired to the new
   sage-hue token so it still personalizes.

2. **Token system.** Set `data-theme` on `<html>`. Define three scopes — see the token tables below.
   Everything in the app must read these vars (no hardcoded colors). Keep the tier-badge component.

3. **Theme-swap must be instant.** Do NOT transition `background-color`/`color` on swap. Only animate
   `transform`, `border-color`, and `opacity`. (Color cross-fades look janky and can stick.)

4. **Starfield.** Add a single full-viewport `<canvas>` behind the app (`position:fixed; inset:0;
   z-index:0; pointer-events:none`). Port the behaviour from the reference: ~120 stars in 3 parallax
   layers, slow downward-left drift, gentle twilight twinkle, eased cursor parallax, ~14% sage-tinted
   stars. Legacy = sparser (~70) and cooler. **When `prefersReducedMotion` is true, render one static
   frame and run no rAF loop.** Palette per theme (star / accent RGB):
   dark `[232,240,230]`/`[150,200,165]`, light `[120,110,90]`/`[90,130,100]`, legacy `[180,190,220]`/`[150,170,230]`.

5. **Reskin the surfaces** to match the reference pixel-for-pixel using the tokens: sidebar (brand,
   identity, grouped nav with count badges, Night/Day buttons, footer), **home** (time-of-day greeting,
   next-action hero with left sage rule, secondary actions, metric grid, server status, activity feed),
   and **reviews** (tabs + filter chips, queue list with risk-aura rings + status dots, detail panel
   with Q&A, meta grid, claim/approve/reject/modmail actions). Match the warm, human COPY in the
   reference (e.g. "A calm shift so far — three folks are waiting at the gate").

6. **Metric counters** animate 0 → value on mount with an ease-out cubic (~850ms); **always set the
   final value even if rAF never fires**, and skip the animation under `prefersReducedMotion`.

7. **Tilt/glare cards** (metric + status): subtle pointer tilt (max ~5°) + a sage radial glare that
   follows the cursor; disabled under `prefersReducedMotion`.

8. **Legacy toggle**: a floating bottom-right control (square switch in new themes, pill in legacy)
   that flips the whole app between Sage Observatory and Legacy Holdfast. Night/Day lives in the
   sidebar footer.

9. **Settings/appearance.** Wherever the old style switcher lived, expose: theme (Observatory / Legacy),
   Night/Day, and — if you want parity with the prototype's tweak panel — heading font
   (Figtree / Quicksand / Hanken Grotesk / Fredoka), sage hue, sage intensity, starfield density &
   drift speed, persisted alongside the theme choice.

## Token reference (oklch; `--sage-h` default 152, `--sage-c` default 0.075)

OBSERVATORY DARK
```
--void: oklch(15.5% 0.012 H);  --void-deep: oklch(12% 0.014 H);
--surface: oklch(20.5% 0.013 H); --surface-2: oklch(24.5% 0.015 H); --surface-3: oklch(28.5% 0.016 H);
--ink: oklch(93% 0.014 110); --ink-2: oklch(75% 0.016 140); --ink-3: oklch(60% 0.014 150); --ink-faint: oklch(48% 0.012 150);
--line: oklch(33% 0.014 H); --line-soft: oklch(27% 0.012 H); --line-strong: oklch(46% 0.02 H);
--sage: oklch(78% C H); --sage-bright: oklch(85% C+0.02 H); --sage-deep: oklch(58% C+0.01 H);
--sage-soft: oklch(30% C*0.55 H); --sage-fill: oklch(24% C*0.4 H); --on-sage: oklch(17% 0.02 H);
--good: oklch(74% 0.09 150); --warn: oklch(78% 0.1 78); --danger: oklch(70% 0.11 32); --info: oklch(74% 0.07 220);
radius 2px · grain on · font Figtree
```

OBSERVATORY LIGHT (warm parchment)
```
--void: oklch(93.5% 0.012 95); --void-deep: oklch(90% 0.015 90);
--surface: oklch(97.5% 0.009 95); --surface-2: oklch(99% 0.006 95); --surface-3: oklch(95% 0.01 95);
--ink: oklch(28% 0.022 150); --ink-2: oklch(42% 0.02 150); --ink-3: oklch(54% 0.018 150); --ink-faint: oklch(64% 0.014 150);
--line: oklch(82% 0.016 110); --line-soft: oklch(87% 0.012 110); --line-strong: oklch(72% 0.02 120);
--sage: oklch(48% C+0.02 H); --sage-soft: oklch(88% C*0.5 H); --sage-fill: oklch(92% C*0.4 H); --on-sage: oklch(97% 0.01 H);
--good: oklch(50% 0.11 150); --warn: oklch(56% 0.12 70); --danger: oklch(54% 0.16 30); --info: oklch(50% 0.09 230);
radius 2px · grain on (dark tint) · font Figtree
```

LEGACY (port today's app.css verbatim — these are approximations; prefer the real current values)
```
hue 250; --void: oklch(10% 0.003 250); --surface: oklch(18% 0.005 250); --surface-2: oklch(23% 0.007 250);
--ink: oklch(92% 0.004 250); --ink-2: oklch(72% 0.008 250); --ink-3: oklch(54% 0.006 250);
--line: oklch(25% 0.004 250); --sage(accent): oklch(72% 0.18 250);
--good: oklch(65% 0.15 145); --warn: oklch(70% 0.15 85); --danger: oklch(60% 0.15 25); --info: oklch(65% 0.12 250);
font Inter · radius 12px · pill toggles · NO paper grain · sparser cool starfield
```

## Type & detail
- Fonts: Figtree (head+body) for Observatory; Inter for Legacy; Space Mono for labels/eyebrows/counts.
- Paper grain: an inline fractalNoise SVG data-URI overlay at low opacity, `mix-blend-mode: overlay`,
  on `.surface`-class elements (off in Legacy). Copy the exact filter from the reference's `.paper` rule.
- "Tick rule" section dividers: small rotated-square node + dashed hairline (circle + solid in Legacy).
- Square corners (radius 2px) everywhere in Observatory; 12px + pills in Legacy.
- No gradients, no glow/bloom, no clichéd blue/purple accents in the new theme.

## Acceptance criteria
- One default theme; the old 4-style switcher is gone; nothing reads hardcoded colors.
- Night/Day and the floating Legacy toggle both work and persist across reload.
- Legacy is visually indistinguishable from today's dashboard.
- Reduced-motion: no starfield rAF, no counter animation, no tilt — content fully visible.
- Home + Reviews match the reference in layout, tokens, motion, and copy.
- No console errors; type-checks pass; existing data/loaders untouched.

Work surface-by-surface. After each, show me a screenshot/diff before moving on.
