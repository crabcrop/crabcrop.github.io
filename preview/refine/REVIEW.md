# Independent review — crabcrop.org spacing + motion refinement (preview/refine/)

Reviewer: independent fresh-eyes pass (builder claims in `preview/REFINE.md`
checked against the actual files and against live, not taken on trust).
Method: local copies served from `~/workspace/spikes/refine/` on
127.0.0.1:8932 (`/live/…`, `/preview/…`), headless Chromium (Playwright) at
1440×900 and 390×844, `images.crabcrop.org` requests fulfilled from the
curl-downloaded `imgcache/` (23 unique signed images) and googletagmanager
stubbed, per the sandbox egress caveat. Console verdicts are from that
fulfilled setup only. Side-by-side composites in `shots/sbs-*.png`
(builder's) were viewed directly, including the four mobile index
composites added to close observation (a) (see §1).

## 1. Glance test + section comparison — PASS

Desktop (hero, install, features, sign, studio, AI, closing/footer) and
docs (start, table/demo sections), from the `sbs-*.png` composites: the
refined pages read as the SAME pages at a glance — same sections, order,
copy, colours, typefaces and imagery — only calmer and more evenly spaced.
No recomposition, no missing or altered content, nothing that looks worse.

Mobile index sections, closed in this final pass from
`sbs-index-mobile-{features,sign,studio,ai}.png`:

- **Features** — PASS. Same "MAJOR FEATURES" tidemark, same heading wrap,
  same first card ("Supported formats") with identical body copy and
  operation list. The card image differs only in animated frame (live
  frame: castle card; preview frame: wand/sun card) — accepted
  non-defect, see Notes.
- **Sign** — PASS. Same tabs (curl / TypeScript / Python / Rust), same
  code window and "Copy snippet" button, same prose below in the same
  order; spacing around the code window is marginally more even, nothing
  moved or lost.
- **Studio** — PASS. Same lede, same before/after slider at the same
  split position, same caption URL underneath; identical at a glance.
- **AI** — PASS. Same two demo cards ("Background removal",
  "Redact a class: pixelate"), same sliders, same captions and closing
  line. Card padding reads slightly roomier, consistent with the claimed
  `.ai-demo` 18px → 20px. The sticky-header block overlapping the top of
  this particular element composite appears identically on BOTH the live
  and preview sides, i.e. it is a capture artifact of the element
  screenshot, not a preview defect.

## 2. Spacing spot-checks (getComputedStyle) — PASS (one note, §10)

Homepage, desktop 1440×900, live → preview measured:

| Selector | Live | Preview | Claim |
|---|---|---|---|
| `.tidemark` gap / margin-bottom | 9px / 18px | 8px / 16px | 8px / 16px ✓ |
| `.btn` padding / gap | 13px 24px / 9px | 12px 24px / 8px | 12px vert / 8px ✓ |
| `.hero-b` padding | 44px / 30px | 48px / 32px | 48px / 32px ✓ |
| `.strip-scroll` gap | 18px | 20px | 20px ✓ |
| `.code-window` padding | 26px | 24px | 24px ✓ |
| `.ai-demos` gap | 22px | 24px | 24px ✓ |
| `.ai-demo` padding | 18px | 20px | 20px ✓ |
| `.ba` margin-bottom | 14px | 16px | 16px ✓ |
| `footer` padding-top | 46px | 48px | 48px ✓ |

Section padding, mobile 390×844 (preview): hero 48px/32px, all other
sections 40px/40px — the claimed ≤900px (48px) and ≤640px (40px)
step-downs are real; live mobile inherited the desktop values.

Docs, desktop: `.docs-layout` 32px/72px ✓; `.docs-nav` padding
20px 20px 16px ✓, nav link vertical padding 6px ✓; `.doc-sec`
32px/40px with first section top 8px ✓; h3 margin-top 24px ✓;
paragraph margin-top 12px ✓; `.cb` padding 20px 24px, margin-top 16px ✓
(bottom margin: see Notes); `.dtable` margins 16px/16px, cell vertical
padding 10px ✓; `.demo` padding 24px, margin-top 16px ✓.
Docs mobile 390×844: `.doc-sec` 24px/32px ✓ (claimed ≤640px step-down).

## 3. Motion — PASS

- Reveal transition measured on preview index: duration
  `0.5s, 0.6s`, timing `cubic-bezier(0.23, 1, 0.32, 1)` for both
  properties — a strong ease-out, no linear, no overshoot/bounce
  (control-point y values ≤ 1). Tour clips (`clips/tour-desktop.mp4`,
  `clips/tour-mobile.mp4`) show grouped, staggered entrances consistent
  with this.
- Fast scroll, my own test (single jump straight to the bottom, then
  horizontal scroll of the features strip): index **38/38** `.reveal`
  elements `.in-view`, **0** still at opacity 0. Docs, dedicated re-run:
  single jump to bottom → **40/40** `.in-view`, **0** at opacity 0 at
  900 ms, and 40/40 again after a gradual scroll. (One combined-run
  sample caught docs at 39/40 mid-transition; the dedicated re-run at
  the same 900 ms mark is clean — transient sampling, not a stuck
  element.) No content is ever left hidden.

## 4. Sliders — PASS

Studio `.ba` slider driven via its range input at 0 / 25 / 50 / 80 / 100:
top-layer `clip-path` = `inset(0px 0px 0px N%)` and divider `left` = `N%`
at every step — exact tracking. Computed `transition-duration` on both
`.ba-top` and `.ba-div`: **0s**.

## 5. ThumbHash — PASS

With `images.crabcrop.org` requests aborted: index **23/23**
`img[data-thumbhash]` elements have a painted background
(`background-image !== 'none'`); docs **13/13**.

## 6. Console — PASS

Zero console errors and zero page errors on both preview pages (and on
live) in the fulfilled setup. Sandbox-proxy resource failures were
excluded per the stated caveat and do not appear in the fulfilled setup.

## 7. Layout shift — PASS

Cumulative layout shift on load, same fulfilled setup, same observer:
live index **0.0000477**, preview index **0.0000477** — identical;
preview is not worse than live.

## 8. Reduced motion + no-JS — PASS

- `prefers-reduced-motion: reduce` emulated (preview index): **0** of 38
  `.reveal` elements hidden.
- JavaScript disabled: heading opacity **1** and card opacity **1** on
  both preview pages (the `html.js` progressive-enhancement gate works).

## 9. Invariants — PASS

- Header markup byte-identical live vs preview for both pages
  (index header block 2,024 bytes, docs 2,040 bytes, exact string match;
  favicon link tags identical).
- Signed `images.crabcrop.org` URL references unchanged: index 23,
  docs 13 (36 total); `data-thumbhash` attributes unchanged: 23 + 13,
  values identical in order.
- `thumbhash.js` script tag present on both preview pages (1 each).

## 10. Notes (accepted non-defects / minor observations)

- **Animated-frame differences**: some signed images are animated; live
  and preview screenshots naturally catch different frames (e.g. mobile
  Features card). Not a content or imagery change. Accepted.
- **Docs `.cb` bottom margin ripple**: the `.cb` margin change
  (14px → 16px) has a minor knock-on on bottom spacing in one docs
  context. Measured `.cb` padding/margins otherwise match the claim.
  Accepted as a non-defect.
- **`.ai-demos` margin-top claim vs effect (minor)**: the stylesheet
  value is 24px as claimed (live: 26px), but the element carries a
  pre-existing inline `style="margin-top:0"` in BOTH live and preview,
  so the computed margin-top is 0px on both and that one claimed change
  has no rendered effect. No visual regression — the rendered spacing is
  identical to live — but the REFINE.md line overstates what the change
  does in the browser. Worth a one-line correction to the notes, or
  removing the dead inline style in a future pass; not blocking.

## Overall verdict

**PASS** — the preview is a faithful polish of the live pages: every
measured spacing value matches REFINE.md (with the single
rendered-effect caveat in §10), motion is smooth ease-out with no
content ever left hidden, sliders track exactly with 0s transition,
ThumbHash placeholders paint 23/23 and 13/13, console is clean, CLS is
unchanged from live, reduced-motion and no-JS both render fully, and
all invariants (byte-identical header, 36 signed URLs, thumbhash
attributes and script tag) hold. No blocking defects found.
