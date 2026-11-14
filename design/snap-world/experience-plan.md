# All the Way Down: experience plan

How the page works, scene by scene, and how to build it. Read
`art-direction.md` first for the concept and the look.

> **Revised after the first full build (see "The review, and the new
> opening" in `production-log.md`).** The plan below sends Snap all the
> way down on the anchor chain. Built, that did not hold: every place is
> drawn standing on its own sea floor, and one chain through all of them
> made no sense. The rule now: **Snap rides the chain once, then walks.**
> The chain ends at its anchor on the sand under the pier (−5 m). From
> there he goes on foot, sideways along the sea floor from place to place,
> with the URL's tags on a little line of his own that a float holds up;
> he swims where a film glides into a place, and falls only where there
> is nothing below him, off the edge beyond the wreck. The little
> submarine at the vents carries him back up.
>
> **Revised again (see "The submarine, all the way down and back").** The
> submarine was the part that worked, and the line of tags he carried was
> hard to read. So now he dives in it: a brass toy submarine with a glass
> bubble, moored at the pier. He hops in when the gust takes his print,
> rides inside it to the vents and back, and gets out on the pier where he
> started; "Dive again" starts the day over. Its pincer does what his claw
> did, and the URL builds up in a bar along the bottom of the view, in the
> URL's own order. The anchor chain is scenery.
>
> **Revised a third time (see "The chain, the walk, and then the
> submarine").** Each of the two revisions was half right, and the page
> now keeps the right half of each. Snap goes down the anchor chain to the
> sand, walks from there through the shallows, the kelp, the reef, the
> studio and the wreck, and gets into the submarine where the sea floor
> ends, beyond the wreck: it takes him to the vents and all the way back
> up to the pier. He carries no tags and there is no bar. Each choice is
> confirmed on its own panel, and the URL is put together on the way up,
> a line printed under the print for each part as it is applied. Where
> this plan says he rides the chain all the way down, or carries the tags,
> read it as history.

## 1. Shape of the page

| Scene | Zone | Scroll length | Layout |
| --- | --- | --- | --- |
| S0 | The Marina | 200vh | Hero, then the story beat |
| T1 | The plunge | 100vh | Signature transition |
| S1 | The Shallows | 250vh | Vertical descent |
| S2 | The Kelp Forest | 250vh | Vertical descent |
| S3 + S3b | The Coral Reef and the Clam Studio | 400vh | Pinned, horizontal: Snap scuttles sideways |
| S4 | The Shipwreck | 250vh | Vertical descent |
| S5 | The Twilight Zone | 250vh | Vertical descent, cursor is a lantern |
| S6 | The Vents | 200vh | The bottom: the source |
| T5 | The express ascent | 100vh | Signature transition |
| S7 | Back to the Surface | 150vh | Result, CTAs, footer |

About 2,150vh in total. Three things keep it from feeling long: the depth
gauge jumps to any zone, a "Skip the dive" link goes straight to a plain
page, and every zone has one clear thing to play with.

Scrolling stays native. Lenis smooths it; GSAP ScrollTrigger pins and
scrubs. Nothing hijacks the wheel.

## 2. Scene by scene

Each scene lists: what you see, what Snap does, what the mouse does, the
cards, the visitor's choice for the URL builder, and the way out.

### S0. The Marina (0 m)

- **First frame.** The hero image arrives as a blurred ThumbHash
  placeholder and resolves to the over-under shot: pier and boats above
  the waterline, turquoise water and the chain below. Nice touch: the
  site already uses crabcrop's ThumbHash support.
- **Copy.** "Blazing fast, on-demand images." The existing lede. Two
  buttons: Install, Docs. The `curl` install command with a copy button.
- **Snap.** Pose P1 on the pier edge, waving. His eyes follow the cursor.
- **Mouse.** Ripples spread on the water under the cursor. Boats and
  pilings shift in depth (2.5D parallax from a depth map). A felt gull
  drifts toward the cursor.
- **Story beat (40 to 70 percent of the scene).** A gust lifts the photo
  print out of Snap's claw. It flutters, hits the water and sinks. Snap
  pose P6, then a determined little nod.
- **Out (70 to 100 percent).** Snap hops onto the anchor chain and hugs it
  (P2). The depth gauge slides in at `0 m`.

### T1. The plunge

The camera sinks through the waterline. The surface line slides up the
screen with refraction, a burst of bubbles, and the light turns
turquoise. Built as either a scrubbed AI clip (prompt `T01`) or a pan down
a tall over-under plate with a WebGL waterline. Prototype both; keep the
better one.

### S1. The Shallows (−5 m)

- **Title.** "One URL does the whole job."
- **The chain appears.** The first tag shows the signature
  (`3c1f6c18…`): "Proof the URL came from you." Later tags are blank,
  waiting for the visitor's choices.
- **Cards.** Signed URLs (`#signing`), All major formats (`#format`),
  More than photos (`#sources`).
- **Play.** Six schools of crochet fish, one per format. Hover a school
  and it gathers around a tag: `AVIF`, `WebP`, `JPEG XL`. When no format is
  named, the schools race and AVIF wins, then JPEG XL, then WebP: the
  `Accept` header order.
- **Sources.** The spilled cargo: hover the film reel (`frame:50%`), the
  folded pages (`page:2`), the sand pails (S3 and GCS), the shoebox (a
  local file), the mooring buoy (`root:photos/cat.jpg`).
- **Mouse.** Caustics brighten under the cursor like a sun glint. Fish
  steer around it.
- **Choice 1, the format.** Pick a school: Auto, AVIF, WebP or JPEG XL.
- **Out.** Drift down the sand slope into the kelp's shade.

### S2. The Kelp Forest (−15 m)

- **Title.** "51 filters, one chain."
- **Cards.** 51 filters (`#adjust`), Size, crop, fit and pad (`#size`),
  Presets and purge (`#presets`).
- **Play: filter curtains.** Translucent silk kelp blades in different
  colors. Drag across them and the whole scene is graded live by a WebGL
  shader that previews the look. Each blade is labelled with its filter.
- **Snap's kindness.** A small fish is caught in fishing line. Snap
  clicks his claw, snips it, and the fish spins free and follows him for
  a while.
- **Mouse.** Kelp stalks bend away from the cursor; light shafts shift.
- **Choice 2, the look.** Crisp `sharpen(1.2):saturation(1.1)`, Deep sea
  `duotone(0d202e,ffd88a)`, or Vintage `sepia`.
- **Out.** Glide out past the forest edge to the reef drop-off.

### S3. The Coral Reef (−30 m), pinned horizontal

Vertical scroll becomes sideways travel. Snap scuttles along the reef
(clip `M04`), stopping at four stations, then reaches the clam.

- **Title.** "It sees what matters."
- **Station 1, smart crop.** A sea turtle glides past. A coral crop frame
  hunts for it and snaps around it, keeping its head whole. Card: Smart
  crop, face safe (`#size`).
- **Station 2, face detection.** As the cursor passes, fish faces get
  small stitched boxes. Card: Face detection (`#ai`).
- **Station 3, redaction.** A shy cuttlefish pixelates itself when the
  cursor gets close. Line: "Privacy is a kindness." Card: Redaction
  (`#ai`).
- **Station 4, object removal.** A soda can stuck on the coral. Drag a
  rectangle over it (or tap it) and the coral fills in. Card: Object
  removal (`#ai`).
- **Mouse.** The crop frame follows the cursor and snaps magnetically to
  the nearest subject.
- **Choice 3, the crop.** Wide card `crop:1200x630:smart`, Square
  `crop:760x760:smart`, or Whole picture `fit-in:1200x630`.

### S3b. The Clam Studio (−30 m, sideways)

- **Arrival.** Three jellyfish softboxes flicker on, one after another.
- **Cards.** Studio mode (`#studio`), Background removal (`#ai`), AI
  upscale (`#ai`).
- **Demos.** A before/after slider on the clam stage (the site's existing
  comparison slider). The background dissolves into a sand checkerboard,
  the universal sign for transparency. A pixelated pearl is rebuilt into a
  perfect one: `upscale(2)`.
- **Choice 4, the finish.** None, Studio
  `studio(product,bg:brand,shadow:soft,pad:10)`, or Cut out `removebg`.
- **Out.** Snap returns to the chain. Darker teal; the shipwreck's shape
  looms below.

### S4. The Shipwreck (−60 m)

- **Title.** "Signed, sealed, provable."
- **Way in.** Through the hull breach into the captain's cabin (clip
  `T03`).
- **Cards.** Sealed URLs (`#sealed`), Provenance, checked and signed
  (`#provenance`), Private sources blocked by default
  (`#private-sources`).
- **Play.** The locked chest: drag the lid and the readable URL scrambles
  into an opaque `s1.<token>`. The ship's log: each entry is an
  ingredient in the image's Content Credentials. The wax seal: click to
  stamp.
- **Snap's kindness.** A little octopus has a letter only its friend
  should read. Snap seals it.
- **Mouse.** The lantern swings toward the cursor; dust motes drift.
- **Choice 5, sealed or readable.** Stamp the seal, or leave the URL
  readable.
- **Out.** Over the wreck's edge into the dark. The gauge spins to
  `−500 m`.

### S5. The Twilight Zone (−500 m)

- **Title.** "It reads the picture."
- **The cursor is a lantern.** A soft radial light reveals the scene; glow
  creatures brighten when lit. On phones, a slow automatic sweep of light
  plus tap to light.
- **Cards.** Metadata that describes the picture (`#meta`), Reads the text
  in the picture (`#meta`), URLs that explain themselves (`#explain`).
- **Demos.** Labels float up next to creatures as glowing CLIP tags, with
  a one-line alt text. A message in a bottle: its text lines light up in
  reading order, each in a box with a confidence score. The anglerfish's
  lure lights the chain and every tag explains its own segment, like the
  `explain/` report.
- **Snap's kindness.** A tiny lost fish follows the light; Snap leads it
  home.
- **Out.** The chain goes slack. A warm glow below.

### S6. The Vents (−2,500 m)

- **Title.** "The engine at the bottom."
- **The source.** The anchor lands beside a glowing geode: Snap's photo
  print. The last tag reads `root:photos/print.jpg`. Snap hugs his print.
- **Cards.** One binary, built in Rust (`#start`), SDKs and loaders
  (`#sdks`), An MCP server for agents (`#mcp`), with the toy submersible
  as the agent.
- **Mouse.** Heat shimmer bends the water near the cursor. Tube worms
  pull back into their tubes when the cursor comes close, as real ones do.
- **Out.** The winch starts.

### T5. The express ascent

The chain winches up fast. The gauge counts from `−2,500 m` to `0 m` and
the zone colors flash by as bands. In Snap's claws the print transforms
step by step with the visitor's choices: format, look, crop, finish. Each
tag lights up as its operation applies.

### S7. Back to the Surface (0 m)

- **Scene.** The marina at sunset, string lights on, all of Snap's new
  friends at the waterline.
- **Title.** "Your image, served."
- **The receipt.** The full URL the visitor built, with a copy button. The
  image itself, rendered live by `images.crabcrop.org`. A line with the
  real load time from the visitor's browser (Resource Timing API):
  "Served in 142 ms to you, just now."
- **Calls to action.** Install (the `curl` line), Read the docs, GitHub.
- **Finale.** Snap raises his camera (clip `M07`), a flash, and a polaroid
  of the visitor's image drops into frame.
- **Footer.** "Built on the shore, in Rust. MIT licensed. See you at low
  tide."

## 3. The URL builder

Five choices across the dive build one URL. All combinations are
precomputed and signed at build time, so the secret never reaches the
browser.

| Choice | Zone | Options |
| --- | --- | --- |
| Format | S1 | Auto (no format, `Accept` decides), `format(avif)`, `format(webp)`, `format(jxl)` |
| Look | S2 | `sharpen(1.2):saturation(1.1)`, `duotone(0d202e,ffd88a)`, `sepia` |
| Crop | S3 | `crop:1200x630:smart`, `crop:760x760:smart`, `fit-in:1200x630` |
| Finish | S3b | none, `studio(product,bg:brand,shadow:soft,pad:10)`, `removebg` |
| Seal | S4 | readable, or sealed (`s1.<token>`) |

- 4 × 3 × 3 × 3 = 108 renders, each with a readable and a sealed spelling:
  216 URLs, about 40 KB of JSON.
- Sign them in CI with `@crabcrop/url` and a secret from GitHub Actions
  secrets, the same way the site's other signed images are made.
- The source is a photo of Snap with a friend on the beach, so the crop
  and finish choices have a clear subject. Every choice is a valid
  operation from today's docs; the format choices never include JPEG, so
  `removebg` always gets a format with alpha.
- Visitors who skip a choice get the default (Auto, Crisp, Wide card,
  None, readable).

## 4. Cards

Seventeen features from today's page, plus private sources and MCP, all
reusing the existing, CI-checked copy, shortened to two lines each.

| Zone | Card | URL chip | Docs |
| --- | --- | --- | --- |
| S1 | Signed URLs, from any stack | `HMAC-SHA256 · curl · TS · Python · Rust` | `#signing` |
| S1 | All major formats, in and out | `format(avif) · format(jxl) · format(webp)` | `#format` |
| S1 | More than photos | `frame:50% · page:2 · root:photos/cat.jpg` | `#sources` |
| S2 | 51 filters, one chain | `filters:sharpen(1.2):saturation(1.1)` | `#adjust` |
| S2 | Size, crop, fit and pad | `crop:1200x630:smart · fit-in · pad` | `#size` |
| S2 | Presets and purge | `preset:og-card · POST /purge-group` | `#presets` |
| S3 | Smart crop, face safe | `crop:760x760:smart` | `#size` |
| S3 | Face detection | `crop:760x760:face · filters:blurfaces` | `#ai` |
| S3 | Redaction | `filters:blurclass(person)` | `#ai` |
| S3 | Object removal | `filters:remove_region(40,120,300,200)` | `#ai` |
| S3b | Studio mode | `filters:studio(product,bg:brand)` | `#studio` |
| S3b | Background removal | `filters:removebg:format(webp)` | `#ai` |
| S3b | AI upscale | `filters:upscale(2)` | `#ai` |
| S4 | Sealed URLs | `s1.<token>/photo.jpg` | `#sealed` |
| S4 | Provenance, checked and signed | `CRABCROP_C2PA_CERT · CRABCROP_C2PA_KEY` | `#provenance` |
| S4 | Private sources blocked by default | `private origins refused unless allowed` | `#private-sources` |
| S5 | Metadata that describes the picture | `Accept: application/json; detections=1` | `#meta` |
| S5 | Reads the text in the picture | `Accept: application/json; ocr=1` | `#meta` |
| S5 | URLs that explain themselves | `GET /explain/<signature>/...` | `#explain` |
| S6 | One binary, built in Rust | `curl … crabcrop-installer.sh \| sh` | `#start` |
| S6 | SDKs and loaders | `@crabcrop/url · crabcrop_url · crabcrop-url` | `#sdks` |
| S6 | An MCP server for agents | `@crabcrop/mcp` | `#mcp` |

Card states: hanging (sways with water and scroll speed), hover (tilts a
few degrees toward the cursor, border sews itself in, demo plays), focus
(same as hover, with a visible ring), pressed (sinks 2 px into its hard
shadow, as on today's site).

## 5. Signature interactions, summarized

1. **Snap's eyes follow the cursor**, everywhere. He blinks, gets sleepy
   after 20 seconds idle, and snaps his claw when clicked.
2. **The chain is the URL**, filling in with the visitor's choices.
3. **Filter curtains** grade the kelp forest live.
4. **The magnetic crop frame** on the reef.
5. **The lantern cursor** in the twilight zone.
6. **The express ascent**, with the image transforming in Snap's claws.
7. **The receipt**: a real render of the URL the visitor built, with its
   real load time.

### Small delights

- Click Snap five times: the magician trick (reuse
  `crabcrop-mascot-magician.webp` while the Rive version is built).
- Five hidden pearls, one per zone. Find all five and the finale polaroid
  gets a pearl frame.
- Type `explain/` anywhere: the anglerfish appears and explains the
  current URL.
- Wiggle the cursor fast near fish and they scatter.

## 6. How it's built

### Layers, back to front

| Layer | What | Tech |
| --- | --- | --- |
| World | The zone plate (still or looping video) with depth parallax, water fog and color by depth, caustics, filter preview, lantern mask, heat shimmer | One WebGL canvas (Three.js) |
| Particles | Bubbles, marine snow, plankton, fish schools, the fish-school wipe between zones | Same canvas, instanced sprites |
| Chain | Anchor chain and tags, swaying with scroll speed and the mouse | Same canvas (instanced links, Verlet rope) |
| Snap | The interactive puppet; alpha clips for cinematic beats | Rive (state machine), stacked-alpha video in WebGL |
| Interface | Titles, cards, HUD, buttons, all real HTML | DOM, CSS, GSAP |

### Stack

- Vite and TypeScript, no UI framework. Source in `experience/`, built to
  `preview/dive/` by a GitHub Actions Pages workflow, following the repo's
  preview convention. The live `index.html` and `docs.html` stay as they
  are until the dive is approved.
- GSAP with ScrollTrigger (free, plugins included, since 2025) and Lenis.
- Three.js on WebGL2. WebGPU only if a later effect needs it.
- Rive web runtime for Snap's puppet: eye tracking, blink, snap, wave,
  scuttle, hug the chain.
- Audio with the Web Audio API (or Howler), off by default.
- Build scripts: sign the URL builder's 216 URLs; generate the asset
  manifest; compute depth maps.

### Why Snap is a puppet and not only video

Video can't look at the cursor. The plan uses both:

1. **Rive puppet** for the guide on the chain: built from cut-out parts of
   the approved model sheet (body, eyestalks, eyes, eyelids, claws, legs),
   so the texture is real crochet but the eyes and claws respond live.
2. **Alpha video clips** for the cinematic beats: the print flying away,
   the hop onto the chain, finding the print, the finale photo.
3. **A 3D Snap** is an optional experiment: Higgsfield's multi-image to 3D
   can turn the turnaround sheet into a GLB. Try it once for a "spin the
   toy" moment in the hero; adopt it only if the crochet still reads.

### Asset pipeline

1. Generate in Higgsfield (see `higgsfield-prompts.md`): 4K plates, 2K or
   1080p loops and transitions, Snap clips on plain backgrounds.
2. Clean up: background removal on Snap clips, deflicker, upscale where
   needed, color-match each zone to its palette with a LUT, fix loop seams
   with a short crossfade. Higgsfield's video remover returns Snap on
   black with no alpha channel; `tools/snap-matte.py` turns it and the
   grey original into the stacked-alpha MP4 below.
3. Depth maps: Depth Anything V2 Small, run offline, saved as 8-bit WebP.
4. Encode:
   - Plates through crabcrop itself, with presets, in AVIF and WebP at
     960, 1600, 2400 and 3200 px wide. The site's imagery is served by the
     product it sells.
   - Loops: H.264 MP4 with an AV1 or VP9 alternative, muted, `playsinline`.
   - Scrubbed transitions: image sequences (about 72 to 96 frames, 1600
     px, AVIF), decoded off the main thread with `createImageBitmap`.
     Image sequences scrub smoothly in every browser; scrubbing `<video>`
     by `currentTime` stutters in some.
   - Snap clips: stacked-alpha MP4 (color on top, matte below) composited
     in WebGL. One plain H.264 file that works in every browser, instead of
     WebM-with-alpha plus a separate HEVC file for Safari.
5. Serve: stills from `images.crabcrop.org`; video and sequences from a
   CDN bucket. GitHub Pages works to start, but an Awwwards feature can
   bring traffic spikes and Pages has a soft bandwidth limit.
6. Load: the current zone and the next one; drop zones two behind.

### Performance budget

| Metric | Target |
| --- | --- |
| First load until the hero is interactive | ≤ 1.2 MB transferred (code ≤ 180 KB gzipped, hero plate ≤ 350 KB, Snap puppet ≤ 250 KB; the hero loop loads after LCP) |
| Each further zone | ≤ 2.5 MB, streamed one zone ahead |
| LCP / CLS / INP | ≤ 2.5 s on a mid-range phone on 4G / ~0 / ≤ 200 ms |
| Frame rate | 60 fps on an M1-class laptop, ≥ 45 fps on a mid-range Android phone |

Quality tiers switch on measured frame time: High (depth parallax,
caustics, full particles), Medium (no caustics, half the particles), Low
(static plates with fades). One WebGL context, device pixel ratio capped
at 2 (1.5 on phones), rendering paused when the tab is hidden.

## 7. Accessibility and fallbacks

- All content is real HTML in reading order: headings, card text, links
  to the docs. The imagery is decoration (`alt=""`) unless it carries
  meaning.
- `prefers-reduced-motion`: no scrubbing, no parallax, no pinned
  horizontal section. Each zone shows its still plate behind its cards,
  with simple fades. Everything stays usable.
- Keyboard: "Skip the dive" is the first link; the depth gauge is a
  navigation list; every card and choice is reachable and has a visible
  focus state. The builder's choices are labelled radio groups and the
  finished URL is announced politely to screen readers.
- No flashing above three times per second; bioluminescence pulses slowly.
- Sound never starts on its own.
- Text always sits on a card or a scrim; card text is ink on cream (about
  13:1).
- No JavaScript: the page reads as a long, static article with images,
  like today's `index.html`.

## 8. Phones

- 9:16 plates for every zone (made with Higgsfield's outpaint or reframe
  from the desktop plates, so both match).
- Chain at the left edge (about 14 percent from the left), Snap smaller,
  cards full width.
- The reef's horizontal section becomes a swipeable row of stations.
- No hover: tap reveals what hover reveals on desktop. The lantern sweeps
  on its own and lights where you tap.
- Fewer particles; depth gauge becomes a thin bar under the header.

## 9. Honesty about AI imagery

Today's footer says "Snapped, not generated." Once the world art is made
with Higgsfield, that line is no longer true, and a picture service
should be careful about provenance. Two changes:

1. Retire the line, or turn it around: "Handmade Snap, real light, worlds
   made with Higgsfield."
2. Sign the site's own images with C2PA Content Credentials using
   crabcrop's provenance feature, disclosing AI generation as an
   ingredient. A demo of the S4 feature on every image of the page.

## 10. Phases

| Phase | Work | Gate |
| --- | --- | --- |
| 0. Lock | Snap master reference, model sheets, the Snap Element; world map and the S0 style frame | Snap passes the drift checklist; the world style is approved |
| 1. Stills | All zone plates (desktop and phone), foreground cutouts, depth maps; Snap poses and puppet parts | Every plate matches its palette and keeps the center lane clear |
| 2. Motion | Ambient loops, signature transitions, Snap clips; Rive puppet | Loops are seamless; Snap stays on model in every frame |
| 3. Build | `preview/dive/`: scroll engine, world renderer, chain, HUD, cards, URL builder, zone by zone | Each zone meets the performance budget on a mid-range phone |
| 4. Polish | Sound, delights, accessibility and cross-browser QA, phones | Reduced-motion and no-JS paths reviewed |
| 5. Launch | Swap the live landing page; Awwwards submission (title, description, credits, screenshots, a capture video) | |

## 11. Risks

| Risk | Plan |
| --- | --- |
| Snap drifts off model between generations | One master reference, the Element, the drift checklist, and Snap kept out of backgrounds |
| Scrubbed sequences are heavy | Image sequences at 1600 px, one zone ahead, quality tiers |
| Traffic spike after launch | Media on a CDN; stills cached by crabcrop |
| The dive feels long | Depth gauge navigation, "Skip the dive", short zones |
| Pinned sections fight touch scrolling | Horizontal reef becomes a swipe row on phones |
| AI text artifacts | No words in generated images; all copy is HTML |
| Usage rights | Confirm Higgsfield's commercial terms for the plan in use; fonts are OFL; music CC0 or licensed |
