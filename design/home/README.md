# The home page

The crabcrop home page: `index.html` at the site's root, served at
`https://crabcrop.org/`. It replaced the old home page in November 2026.
Until then it was a preview at `/preview/home/`, which is gone; the old
page and the pictures only it used are in git history (`a72fe3f`).

It came out of three directions tried side by side (a white photo studio,
a crochet-pattern leaflet, and this one, the address bar); this is the one
that was picked. Where the dive tells the story of a request as a journey,
this page is the plain one: easy to read, dark and tool-like, with a
working image URL as its centrepiece.

## What is on the page

The sections, in the order the page shows them:

| Section | What it shows |
| --- | --- |
| Opening | The site's headline, "Blazing fast, on-demand images.", with the figure that backs it. Snap stands on the right end of the address bar and points down at the URL. Three groups of choices (size, look, format) rewrite the URL, and a picture answers |
| Install (`#install`) | Right under the opening: the install command, with Snap standing on it, the first three steps, and the other routes |
| Three parts (`#parts`) | The grammar: signature, operations, source |
| What it does (`#features`) | Twelve tiles, with the site's own example photos |
| Sign (`#sign`) | The four signing snippets, the SDKs, the framework loaders, the MCP server |
| Ship it (`#ship`) | Platforms, CDNs, the limits the server sets itself, and the cache note with Snap asleep |
| Speed (`#speed`) | The published benchmark, first requests only: the headline figure, the table of first requests by operation against Thumbor and imgproxy, and how it was measured. The opening's figure links down to it |
| Coming from (`#from`) | The migration guides |

The sections alternate between the page's two backgrounds (a section with
`class="band"` is the lighter one); moving a section means moving its band
with it, so no two neighbours share one.

Colour has one job on the page: wherever a URL appears, coral is the
signature, sun is the operations and sea glass is the source. Nothing else
uses those three.

## The files

| Where | What |
| --- | --- |
| `index.html` | The page: markup and styles. Written by hand, no build step |
| `home.js` | Its script: the URL builder, copy buttons, the signing tabs, and when Snap moves |
| `fonts/` | The three faces, cut down, each with its licence (beside the docs page's Fraunces) |
| `media/` | The page's own pictures and films: Snap (two films with their first frames, and the sleeper) and eight embroidered patches |
| `/scene-camera.jpg`, `/ai-*.jpg`, `/ai-skate-removebg.webp`, `/studio-*.webp` | The site's example photos, which the docs page shows too |
| `design/home/tools/make-media.py` | Makes everything in `media/` |
| `design/home/tools/sources.json` | The generated originals `make-media.py` starts from |
| `design/home/tools/subset-fonts.py` | Cuts the fonts |
| `design/home/fonts-full/` | The full font files it cuts from (Fontsource 5.3.0, Latin) |

## Changing it

Edit `index.html` and `home.js` directly, then run the two checks that
need no crabcrop checkout:

```sh
node .github/site-checks/assets.mjs    # every picture is used, every file the page names exists
node .github/site-checks/scripts.mjs   # the page's Content-Security-Policy holds
```

- **One inline script.** The page carries the site's
  Content-Security-Policy: scripts from this site, the Google Analytics
  loader, and one inline script, Google Analytics' config, by its hash.
  Another `<script>` block would be blocked until its hash is in the
  policy; the scripts check prints the hash it needs. Styles may be
  inline. The privacy note in the footer (`id="privacy"`) has to stay
  while the page loads Google Analytics, and the dive (`under-the-sea/`),
  which loads it too, links to it there.
- **Pictures.** Every published picture has to be referenced by a page,
  so one the page stops using is deleted (git history keeps it), as the
  old home page's were. The dive is held to more: every file under
  `preview/dive/`, whatever its type, has to be used by its page, its
  stylesheet or its scripts.
- **Fonts.** The fonts hold ASCII, Latin-1, the dashes, quotes, ellipsis
  and arrows. A character outside that (the script lists what the page
  has beyond it) needs `python3 design/home/tools/subset-fonts.py` run
  again. Bricolage Grotesque keeps its optical-size axis: the browser
  sets it from the font size, which is what gives the headline its
  tighter cut.
- **The headline** is sized so its long line, "on-demand images.", stays
  on one line beside Snap: about 8.7 em wide at large sizes and 9 em at
  small ones. A longer headline needs the `font-size` clamps on `h1`
  worked out again.

## Keeping it true

As `index.html`, the page is covered by the site's checks: the snippets
check runs its four signing panes against the SDKs of the latest release
(they are in the `code-pane` markup it reads), and the scripts check holds
its Content-Security-Policy, its Google Analytics tag and its privacy note.
The rest of what it says has to be kept in step by hand:

| On the page | Comes from | When it changes |
| --- | --- | --- |
| The four signing snippets | The simplest call in each SDK, all four signing the anatomy strip's example, `crop:1200x630:smart/filters:grayscale/https://example.com/photo.jpg`, with `demo-secret` (`5b9fc0ad…`). The builders take the same four arguments in the same order: base, secret, operations, source; Rust adds the expiry, `None` | When a builder changes: the snippets check fails |
| `v0.15.0` in the footer, and the two `docker pull` tags | The release, as `docs.html` names it | At each release |
| The benchmark figures | `benchmark/results/2026-11-06.md` in `dayvson/crabcrop`: crabcrop 0.9.9, Thumbor 7.8.0, imgproxy 3.31.4 | When a newer run is published there |
| Formats, filters, limits, error codes, recipes, guides | `docs.html` as of 0.15.0 | When it changes |
| The signatures in the address bar | Real ones, for all 48 states: HMAC-SHA256 with the sample secret `demo-secret` over `<operations>/root:photos/print.jpg`, in `home.js` | When a choice is added or renamed |

At a release, change the footer version and the `docker pull` tags, here
and on `docs.html`, one by one. Never replace the old version number across
a page: the notes on `docs.html` ("Since 0.11.0 ...") name the release that
made each change, and the page-wide replacements of the v0.12.0 and v0.13.0
releases moved every one of them from 0.11.0 to 0.13.0 until they were set
back.

The benchmark figures, as they are on the page:

| Figure | In the results file |
| --- | --- |
| 22.6 ms, a first request (the opening and the speed section) | Cold latency, resize 800w JPEG, crabcrop p50 |
| The table of six operations | Cold latency, p50 of each system |

Only first requests are on the page. The results file also has repeat
requests, answered from crabcrop's in-memory result cache (warm latency
and throughput), where the other two servers, as configured there, keep
no results and render again; the page leaves those out.

The table shows the rows where imgproxy answers a first request sooner
(resize, crop, WebP): they are in the published results, so they are on
the page. The run measured 0.9.9. Work on the crop and JPEG paths has
landed in the server since; until a newer run is published, those rows
are due a refresh.

A new signature, in Python:

```python
import hashlib, hmac
hmac.new(b"demo-secret", b"crop:1200x630:smart/root:photos/print.jpg", hashlib.sha256).hexdigest()
```

The picture under the address bar is drawn in the browser from a sample
photo (a CSS crop and filter), and the page says so. It is not a render
by a server.

## Snap on this page

Snap was photographed for this page in low light, on black, and two of
the three pictures are short films.

| Where | File | What he does |
| --- | --- | --- |
| On the address bar | `snap-point` | Points down at the URL. The film: he taps twice, looks up, blinks, nods, and points again. He is also the link down to his world, the dive at `/under-the-sea/`, and says so in a bubble beside his head |
| On the install command | `snap-cheer` | Both claws up. The film: he bounces and claps |
| In the cache note | `snap-asleep.webp` | Asleep. A slow CSS swell from the feet up is his breathing |

**He moves when there is a reason to.** Each film ends on the frame it
began with, so it plays once and he is at rest again. The first plays
shortly after the page opens, every few seconds while he is in view, and
whenever a choice changes the URL, and when a pointer comes to him or the
keyboard reaches his link (a tap on him there follows the link). The
second plays the first time he comes into view, when the install command
is copied, and on a tap. With reduced motion he stays still: the films
are never started, and the sleeper does not breathe.

**His invitation.** In the hero the link is Snap himself, with his bubble
("Come dive with me", "under the sea, in 3D") as its visible label: beside
his head on wide screens, above it where the words come close (960 px and
narrower), the row beside him a little taller for it on phones. The
footer lists the same page as "Under the sea". The bubble may form a
stacking context (it lifts on hover); the link around the film may not.

**How he sits in the page.** A film has no transparency, so he is filmed
on black and blended with `mix-blend-mode: lighten`: the page shows
wherever the film is darker than the page. Three things keep that from
ever showing as a box:

- each film is laid over a ground two shades under the colour it sits on
  (`make-media.py` does it), so if a browser will not blend a video, what
  shows is a rectangle a shade darker than the page, not a black one;
- the film's edges are feathered with a mask, for the same case;
- nothing between him and the ground he sits on may form a stacking
  context (no `z-index`, `transform`, `opacity` or `filter` on an
  ancestor inside the section), or the blend has nothing to blend with.
  The section sets its own background for that reason.

He stands just behind the top edge of the bar: the bar is above him in
the stack, so the film never has to blend with it.

Each film is published twice, AV1 first and H.264 for what plays nothing
newer, at 12 frames a second: the generator draws each pose twice, so the
second of every pair is dropped. Its first frame is the poster, which is
also what shows if a film cannot load.

### The generations

Higgsfield project `03b58f25-49d0-4a18-bcf3-77a8b41d7dc1`, folder
"10 Home page" (`db56c395-4e82-4551-a27c-c43b2256363e`). The stills are
Nano Banana Pro, 16:9, 2K, two takes each, with the `snap` Element and
the C01 master reference (`d65f12f3`); the second and third also took the
first approved still as a reference for the light. The films are Kling
4.0, image to video, 1080p, 5 s, with the still as both the first and the
last frame.

| Asset | Job | Status | Notes |
| --- | --- | --- | --- |
| Pointing, still | `2ba4f2a0-eadb-4421-b694-206df7e4718b` | Approved | Clean black to the edges. Alternate: `5e96ff4b-4b49-4dcc-8d29-89a433df8827`, backdrop less clean and the claw curled |
| Cheering, still | `4d9c0586-f99f-4dae-a20c-2a990c091ad3` | Approved | Heart pads clear. Alternate: `3d020bc5-9576-48ee-a5e2-262c337ead03`, a faint floor reflection reaches the bottom edge |
| Asleep, still | `2db1bc5c-51ae-4208-b69e-f187144568b3` | Approved | Closed eyes as stitched arcs, so he reads as asleep when small. Alternate: `e01060f3-cf34-4ddb-845d-1c55cad5ceea`, lids as plain balls |
| Pointing, film | `a34aa638-9ad8-45e9-8346-e8c2d8fe3510` | Approved, first take | Last frame against first: 0.6 on a 0 to 255 scale. Backdrop stays black |
| Cheering, film | `e388b1cb-9e14-46ce-93ae-c4a2e4c2de9c` | Approved, first take | Same. He rises to within 20 px of the top of the frame at the peak of a bounce |

The scene lines of the prompts. Each still prompt goes on with the
`SNAP_DNA` and `SNAP_AVOID` blocks of
`design/snap-world/snap-character-bible.md`; each film prompt names him
in words, since Kling 4.0 takes no Element in image to video.

- **Pointing, still.** "`<<<snap>>>` stands on a dark stage, seen from
  the front and turned a little toward the left of the picture. He leans
  forward slightly and looks down toward the lower left corner of the
  frame, and the claw on the left of the picture reaches down and
  forward, pointing at something on the ground just in front of him to
  the left, its peach heart pad showing. His other claw rests at his
  side. Wide shot with a lot of empty space: his full body is about 55
  percent of the frame height and stands a little to the right of the
  center, with empty black space to the lower left where he points.
  Low-key studio product photograph on a black velvet backdrop. The
  background is solid pure black (#000000) from edge to edge: no visible
  floor, no horizon line, no reflection, no ground shadow, no haze, no
  smoke, no dust, no light beams, no gradient, no vignette glow. One
  large soft warm key light from the upper left shows the crochet texture
  of his coral yarn in rich, true color; a thin, gentle cool teal rim
  light traces his right edge; the shadows are deep but his whole
  silhouette stays readable against the black. Locked-off camera at his
  eye level. Both eyestalks clearly visible; the eyes never sit on the
  body."
- **Cheering, still.** The same backdrop and camera lines, with "stands
  facing the camera and cheers: both claws raised high above his head in
  celebration, the peach heart pads facing the camera, both eyestalks
  stretched up, looking straight at the camera, joyful", 62 percent of
  the frame height, centered, a "neutral-white key light" with "no orange
  cast", and "no confetti" added to the avoid list.
- **Asleep, still.** The same again, with "is fast asleep: he sits low
  and relaxed, facing the camera, both claws folded against his cream
  belly. Both coral crochet eyelids are fully closed over his eyes, so
  the black eyes are hidden and only the closed coral lids show on the
  two eyestalks; the eyestalks lean gently outward; his small gold smile
  still shows", 50 percent of the frame height, the eyes left out of the
  description of him, and "no pillow, no blanket, no letters Z" added.
- **Pointing, film.** "Snap, the crocheted crab toy, stands against a
  solid pure black background. He looks down to the lower left and taps
  the air twice with the claw he is pointing with, a small clear tapping
  gesture toward the lower left, as if tapping on something just below
  him. Then he lifts his eyes to the camera, blinks once (his coral
  eyelids slide down over the eyes and back up), gives one small nod, and
  looks back down to the lower left, returning to exactly the starting
  pose. The camera is fixed on a tripod and never moves or zooms; only
  Snap moves. Seamless loop: the last frame matches the first frame."
  Then a short description of him, and: "Single continuous shot, no cuts,
  no scene changes. Physical, weighty motion like a real crocheted toy
  brought to life. Stable exposure and color. Keep the handmade crochet
  yarn, the pure black background and the exact low-key lighting of the
  start frame: the background stays completely black, with no floor, no
  haze, no smoke, no dust, no light rays and no reflections appearing.
  Both eyestalks stay visible, six legs and two claws at all times. No
  new objects appear, nothing morphs into something else, no text."
- **Cheering, film.** The same frame of lines, with "stands against a
  solid pure black background with both claws raised. He cheers: he
  bounces on the spot two times, and on each bounce he waves both raised
  claws happily, opening and closing them like clapping; then he blinks
  once and settles back into exactly the starting pose with both claws
  raised", and "His full body with the raised claws always stays in
  frame."

What this round taught:

- **Black works as a backdrop.** Asked for in that many words, Nano
  Banana Pro gives a true black to the edges in most takes, and Kling
  keeps it black through a film. That is what makes the blend possible
  with no cutout step.
- **Low light pulls the wool toward orange.** The first still came out
  10 degrees of hue off his studio coral with a warm key light, and 5 to
  9 off even when a neutral light was asked for. `make-media.py` measures
  the wool and turns it back, so the three pictures and the two films
  land on the same coral.
- **The same still at both ends loops.** With the start frame as the end
  frame, both films came back on their first take with a seam smaller
  than the step between two ordinary frames.
- **Kling draws on twos.** Every pose is held for two frames of the 24,
  so a film is 12 a second already. Dropping the second of each pair
  halves the film and suits a crocheted toy: it reads as stop motion.
- **A blink is a pair of plain wool balls.** Kling closes his eyes by
  covering them. For a few frames in motion it reads as a blink; it is
  why the sleeper is a still, not a film.

## Still open

- The benchmark figures are from 0.9.9; see above.
- It has been checked in Chromium at phone, tablet and desktop sizes. It
  has not been seen in Safari or on a real phone, which is where the
  blend of a film into the page matters most.
- The picture under the address bar could be real renders from
  `images.crabcrop.org` instead of a crop drawn in the browser.
