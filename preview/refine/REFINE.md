# Spacing and motion refinement: preview notes

Preview location: this preview is published at preview/refine/ instead of
the usual site-preview/refine/. The site-preview/ prefix on GitHub Pages
is stuck serving a stale deployment snapshot: the old previews under it
were deleted from the repo before this work began yet still serve, and
three separate builds (a fresh add, a probe file, and a full delete plus
re-add) all reported "built" without the new files ever being served,
while identical probe files at other new paths deployed immediately.
The live pages are unaffected. If the prefix ever unsticks, this folder
can be renamed back to site-preview/refine/ with no content changes.

Scope: polish of the existing crabcrop.org pages (index.html, docs.html). No
recomposition, no new sections, no copy, color, or typeface changes, no new
imagery. The header block, logo lockup, menu, and favicons are byte-identical
to live. All 36 signed images.crabcrop.org URLs, all data-thumbhash
attributes, the thumbhash.js tag, and the comparison sliders are untouched
and verified working.

Craft sources: the emil-design-eng skill (easing, durations, press and hover
feedback, reduced motion) and the impeccable skill's craft floor (one spacing
system, rhythm checks, progressive enhancement). Each choice below names its
source.

## Spacing

One rhythm imposed on both pages: a 4px grid, with 8px steps for section and
heading spacing. Values that were already on the scale were left alone.

Shared (both pages):

- Section headings: `.tidemark` margin-bottom 18px to 16px, gap 9px to 8px.
  h2 (16px) and h3 (8px) margins were already on scale and stay.
- Buttons: `.btn` padding 13px to 12px vertical, gap 9px to 8px.
- Hero CTAs: gap 22px to 24px, margin 30px 0 20px to 32px 0 24px.
- Install strips: cmdstrip padding 12px 14px to 12px 16px, margin-top 14px
  to 16px; dockerstrip margin-top 30px to 32px, padding 15px 18px to 16px
  20px, gap 14px to 16px. Copy buttons padding 9px 17px to 8px 16px.
- Sign section: `.code-window` padding 26px to 24px; its copy button padding
  8px 15px to 8px 16px; tabs padding 11px 20px to 12px 20px.
- AI section: `.ai-demos` gap 22px to 24px and margin-top 26px to 24px;
  `.ai-demo` card padding 18px to 20px.
- Comparison sliders: `.ba` margin-bottom 14px to 16px; `.honest` note
  margin-top 14px to 16px.
- Footer: top padding 46px to 48px; wrap gap 22px to 24px.

Homepage:

- Section padding: the base 56px stands on desktop, but two new steps repair
  a cascade accident (an 88px/72px pair of section rules lower in the sheet
  was dead at every width, so mobile inherited the full desktop 56px):
  48px at 900px and under, 40px at 640px and under.
- Hero: `.hero-b` padding 44px 0 30px to 48px 0 32px.
- Features: the inline `padding-top: 26px` override on the section is
  removed, so the features heading follows the same rhythm as every other
  section. Strip gap 18px to 20px; card body padding 16px 18px 18px to 16px
  20px 20px; operation name margin-top 10px to 12px.
- Closing CTA panel: padding 34px 32px to 32px all round.

Docs page:

- Layout: `.docs-layout` padding 34px 0 70px to 32px 0 72px. Side nav
  padding 18px 18px 12px to 20px 20px 16px; nav links 5px to 6px vertical.
- Prose rhythm, uniform across all 27 sections: `.doc-sec` padding 30px 0
  38px to 32px 0 40px (first section top 6px to 8px); h3 margin-top 26px to
  24px; paragraph margin-top 10px to 12px; list margin-top 10px to 12px;
  list item margin-bottom 6px to 8px.
- Code blocks: `.cb` padding 20px 22px to 20px 24px, margin 14px to 16px;
  copy button padding 7px 14px to 8px 16px.
- Tables: `.dtable` margin 14px to 16px; cell padding 9px to 10px vertical.
- Demos: `.demo` padding 22px to 24px, margin 18px to 16px; slider rows
  margin 9px to 8px; anatomy definition box margin-top 18px to 16px; demo
  inputs padding 9px 11px to 8px 12px.
- Mobile: doc sections step down to 24px 0 32px at 640px and under.

## Motion

The pages already contained a reveal system (`.reveal-l` / `.reveal-r`
rules, stagger classes, a reduced-motion guard) with no elements using it
and no observer to trigger it; its hidden start state was unconditional,
which would have hidden content if wired naively. The refinement completes
that system safely instead of inventing a new one.

- Progressive enhancement (craft floor: content visible by default): the
  hidden start state now applies only under `html.js`, set by a one-line
  script in the head before the styles. No JS means no hidden content,
  verified with JavaScript disabled. A small IntersectionObserver script
  before `</body>` adds `.in-view` as elements arrive (threshold 0.12,
  unobserved after reveal). If IntersectionObserver is missing, everything
  is revealed at once. A requestAnimationFrame-throttled scroll sweep
  backs the observer up: an element a fast scroll has already carried
  into (or past) the viewport is revealed by the sweep, so content can
  never be jumped over and left hidden (verified by scripted fast
  scrolls on both pages: 38 of 38 and 40 of 40 elements revealed).
- Easing (emil-design-eng: strong ease-out for entrances, never linear or
  bounce): a new `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` token sits
  beside the site's own `--snap` and `--scuttle` curves. Reveals fade and
  rise 16px over opacity 0.5s / transform 0.6s on that curve. The existing
  stagger delays (60ms steps: d1, d2, d3) are kept; they sit inside the
  skill's 30 to 80ms stagger band. Reveal wiring: hero (headline, lede,
  CTAs in sequence), each section's tidemark, heading, and lede, the 17
  feature cards (cyclic stagger), the sign code window, the studio slider,
  the two AI demo cards, the closing CTA panel; on docs, the page heading,
  every section heading, every demo, the code window, and standalone
  sliders.
- Press feedback (emil-design-eng: respond on press, transform only):
  `.btn` and feature cards now sink 2px toward their hard offset shadow on
  `:active` and the shadow steps down (`--shadow-sm`), so the press reads
  as physical contact with the surface the shadow implies. Tabs and the
  three copy-button styles, which had no transitions at all, get a 150ms
  background/transform transition and a `scale(0.97)` press.
- `transition: all` removed from tabs (the skill flags it: it animates
  unintended properties); replaced with the named properties that actually
  change.
- Hover gating (emil-design-eng: hover states stick on touch): at
  `(hover: none)`, the button and card hover lifts are disabled.
- Features strip: scroll snapping relaxed from `mandatory` to `proximity`
  (mandatory fights the user's scroll position between cards) and
  `overscroll-behavior-x: contain` added so strip scrolling no longer
  chains into page scroll.
- Comparison sliders: verified already direct. The drag handler writes
  clip-path and divider position straight from the input event with no
  transition on either property (measured transition-duration 0s, values
  track the input exactly). Nothing was added that could introduce lag.
- Reduced motion: the existing global guard (durations collapse to 0.01ms)
  is kept, and the reveal selectors inside it now include the `html.js`
  scoped forms so they outrank the hidden start state; the observer script
  also reveals everything immediately when reduced motion is preferred.
  Verified: with `prefers-reduced-motion: reduce`, zero elements are
  hidden and content is fully usable.
- Performance: every animated property is transform or opacity only. No
  layout or paint properties are animated. Measured layout shift on load
  is unchanged from live (see REVIEW.md).

## Verification notes

Screenshots, tour clips, and the reviewer verdict live beside this file in
the working set and in REVIEW.md. One environment caveat: the sandbox
egress proxy refuses connections from headless Chromium to
images.crabcrop.org, so captures were made by serving the exact live and
preview bytes locally and fulfilling the signed image URLs from a
curl-downloaded cache of the real responses (all 23 unique URLs, HTTP
200). Console error counts exclude those sandbox network failures; with
image fulfillment on, both pages report zero console errors.
