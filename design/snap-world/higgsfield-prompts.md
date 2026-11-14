# All the Way Down: Higgsfield prompt pack

Every image and clip the dive needs, in the order to make them, with the
model, settings, references and prompt for each. What has been made, with
job IDs, is in `production-log.md`. Read `snap-character-bible.md` (for
Snap) and `art-direction.md` (for the world) first.

## 0. How to run it

### Order

1. **Lock Snap** (section 2). Nothing else starts until the master
   reference passes the drift checklist.
2. **Lock the world** (section 3): the world map, then the S0 style frame.
3. **Plates** for every zone (section 4), desktop then phone.
4. **Loops** (section 5), **transitions** (section 6), **Snap clips**
   (section 7), **sprites and icons** (section 8).

### Models and prices

Prices are Higgsfield's own cost preflight on 8 November 2026, in credits.
They can change; re-check with a cost preflight before a big batch.

| Job | Model | Settings | Credits |
| --- | --- | --- | --- |
| Plates, final | Nano Banana Pro | 21:9 or 9:16, 4K | 4 |
| Plates, drafts | Nano Banana Pro | 2K | 2 |
| World map (very tall) | Nano Banana 2.1 | 1:4, 4K | 3 |
| Cheap drafts, sheets | GPT Image 2.6 | default | 0.25 |
| Loops (start = end frame) | MiniMax H3 | 21:9, 2K, 6 s / 8 s | 12 / 16 |
| Transitions (start + end frame) | Kling 4.0 | 21:9, 1080p, 8 s | 26 |
| Transitions, premium | Seedance 2.0 | 21:9, 1080p, 8 s, no audio | 96 |
| Transitions, premium alternative | Cinema Studio Video 3.0 | 21:9, 1080p, 8 s | 104 |
| Snap clips, one-shot | Kling 3.0 | pro, 5 s, no sound, start image required | 8.75 |
| Snap clips, loops (start = end frame) | Kling 4.0 | image-to-video, 16:9, 1080p, 5 s | 16.25 |
| Snap clips, square or 16:9 alternative | Kling 3.0 Omni (frames) | pro, 8 s | 10 |
| Video background removal | | per clip | 1 |

Which models accept the Snap Element (`<<<id>>>` in the prompt): images on
GPT Image 2.6, Nano Banana Pro, Nano Banana 2, GPT Image 2, Seedream 4.5 and
5.0 lite, Cinema Studio Image 2.5; video on Seedance 2.0, Cinema Studio
Video 2 and 3.0, and Kling 3.0 (only with a start image). Kling 4.0 takes
up to seven reference IDs through `kling_element_ids`, but not in
image-to-video mode, where the start and end frames carry the look. For
every other model, pass the reference images as `image_references`
instead.

### Budget

| Phase | Assets | Estimate |
| --- | --- | --- |
| A. Lock Snap | Master reference, model sheets, prop | ~55 |
| B. Lock the world | World map, key art | ~30 |
| C. Plates | 14 desktop + 14 phone plates, foreground cutouts, sprites | ~350 |
| D. Loops | 10 loops × 2 tries | ~240 |
| E. Transitions | 4 × 3 tries on Kling 4.0, plus one premium try | ~410 |
| F. Snap clips | 9 clips × 3 tries, background removal | ~280 |
| G. Icons | One embroidered patch set | ~15 |
| Reserve | Upscales, fixes, retries | ~150 |
| **Total** | | **~1,530 credits** |

### House rules

- One project folder in Higgsfield for everything: `crabcrop · All the Way
  Down`.
- File names: `aw-<asset id>-v<nn>`, for example `aw-Z2-plate-v03`.
- Draft at 2K, finalize at 4K. Generate 2 to 4 variants per prompt, pick
  one, iterate by editing the prompt, not by rolling dice forever.
- Keep Snap out of the backgrounds. The only exceptions are the key art
  (`KA01`) and the world map variant (`W00-snap`).
- No words inside images. All copy is HTML.
- Nano Banana Pro at 4K returns at most 2 images per call. Keep about 6
  jobs in flight; larger batches get refused.
- The real Element IDs, chosen job IDs and lessons so far are in
  `production-log.md`. Replace `<<<snap>>>` and friends with
  `<<<element-id>>>` from there.

## 1. Prompt blocks

Paste these into the prompts where `{BLOCK}` appears. `SNAP_DNA`,
`SNAP_DNA_SHORT` and `SNAP_AVOID` live in `snap-character-bible.md`
section 8.

### `WORLD_DNA`

```
A handmade miniature world at toy scale, photographed for real. Every
creature and plant is handmade from yarn and fabric: crochet, knitting,
felt and embroidery, with visible stitches, bobbles and fibers. Hard props
and sets are real miniature materials: weathered wood, rope, brass, rusty
iron, glass, stone, sand. Water, light and air are real and physical:
caustics, god rays, bubbles, mist, floating particles. Macro photography at
a low camera at the height of a small toy, 50-100 mm lens look, shallow depth of field with creamy
bokeh, subtle tilt-shift miniature feel, natural light, rich but believable
color, fine film grain.
```

### `WORLD_AVOID`

```
no text, no letters, no numbers, no logos, no watermarks, no signage, no
people, no human hands, no crabs, no plastic or CGI render look, no
cartoon outlines, no flat illustration, no fisheye distortion, no lens
flare streaks, no chain or rope hanging through the center of the frame
```

Don't describe the camera as a "crab's-eye view" in plates: the model
adds a crab to match, sometimes a realistic one. Say "a low camera at the
height of a small toy" instead. Snap is composited later.

### `PLATE_LAYOUT` (desktop, 21:9)

```
Wide 21:9 frame composed as a website background: three depth planes, with
soft out-of-focus elements framing the left and right edges, a sharp
midground and a hazy background. Keep a calm, uncluttered vertical lane
down the center third of the frame, free of tall objects and busy detail,
for an anchor chain and a small mascot that will be added later. Seabed or
horizon in the lower third. No single hero subject in the center.
```

### `PLATE_LAYOUT_PHONE` (9:16)

```
Tall 9:16 frame composed as a phone background: keep a calm vertical lane
along the left fifth of the frame for an anchor chain added later, main
interest in the right two-thirds, soft framing elements at the top and
bottom edges, seabed or horizon in the lower quarter.
```

### `PLATE_LAYOUT_PATH` (horizontal reef section)

```
Wide 21:9 frame for a sideways-scrolling panorama: a clear, flat sandy
path along the bottom fifth of the frame for a small mascot to walk on,
main subjects in the upper two-thirds, the horizon of the reef at the same
height as in the reference panel so panels line up side by side.
```

### `VIDEO_RULES`

```
Single continuous shot, no cuts, no scene changes. Slow, physical motion.
Stable exposure and color. Keep the handmade crochet, knit and felt
materials and the exact lighting of the reference frames. No new objects
appear, nothing morphs into something else, no text.
```

### `LOOP_RULES`

```
Seamless looping ambient shot. Locked-off camera, no camera movement, no
zoom. Only gentle, cyclical motion. The last frame matches the first
frame.
```

## 2. Phase A: lock Snap

Upload the reference stack first: `crabcrop-mascot-still.webp`,
`scene-camera.jpg`, `scene-surf.jpg`, `ai-skate-before.jpg`.

### C01. Master reference

Nano Banana Pro · 1:1 · 4K · references: all four repo images

```
{SNAP_DNA}
Studio product photograph of Snap standing on a pure white seamless
background, full body, front view, facing the camera, left claw raised in
a friendly wave, right claw holding a small cream felt photo print with a
stitched border and an embroidered teal mountain and yellow sun. Soft
diffused daylight from the upper left, a gentle contact shadow under his
legs, 100 mm macro lens at f/8 so the whole toy is sharp, every crochet
stitch visible, true colors. Match the reference images exactly: same
proportions, same yarn, same face.
{SNAP_AVOID}
```

Approve against the drift checklist, then **create the Element `snap`**
(category: character) from this image.

### C02. Turnaround sheet

Nano Banana Pro · 16:9 · 4K · Element `snap` + C01 as reference

```
Character turnaround model sheet of <<<snap>>>: four consistent full-body
views in a row, evenly spaced, same scale and same height: front view,
three-quarter view, side profile, back view. Neutral standing pose, both
claws relaxed at his sides, eyes looking straight ahead in every view. The
back view shows smooth coral crochet with the spiral starting ring at the
center of the back. Pure white seamless studio background, soft even
lighting, a soft contact shadow under each view. The identical toy in
every view, no props.
{SNAP_DNA}
{SNAP_AVOID}, no text labels, no arrows, no frames between views
```

### C03. Pose and expression sheet

Nano Banana Pro · 16:9 · 4K · Element `snap` + C01, C02

```
Pose and expression reference sheet of <<<snap>>>, the same crochet crab
toy shown nine times in a 3 by 3 grid on a pure white seamless background,
each pose the same size: (1) waving with the left claw while holding a
small cream felt photo print in the right claw, (2) holding on to a short
vertical piece of rusty iron chain with both claws, legs tucked up,
(3) walking sideways mid-step, eyestalks pointing forward, (4) presenting
with one claw open toward the right, (5) right claw raised and clicking
like a finger snap, (6) surprised, both eyestalks stretched up and both
claws up, (7) winking with one coral crochet eyelid closed, looking proud,
(8) holding a small vintage film camera up with both claws in front of his
face, his two eyestalks peeking over the top of the camera, (9) sleepy,
both coral eyelids half closed. In every pose his two eyestalks stay
clearly visible; the eyes are never placed directly on his body. Soft even
studio light, the identical toy in every pose.
{SNAP_DNA}
{SNAP_AVOID}, no grid lines, no numbers
```

Use 16:9. The same sheet at 1:1 4K failed three times without an error
message. Avoid the word "pole" for the chain pose.

### C04. Puppet parts (optional, for the Rive animator)

Nano Banana Pro · 16:9 · 4K · Element `snap` + C02

```
Flat-lay knolling photograph from directly above of the separate
crocheted parts of <<<snap>>>, neatly spaced on a pure white background,
none touching: the round body with its face and spiral belly, two
eyestalks each with its eye ball, two small coral crochet eyelids, two
claws with their short arms, six stubby legs. Same yarn, colors and
stitches as the reference. Even shadowless light.
{SNAP_AVOID}
```

If the parts come out unconvincing, the animator cuts them from the C02
front view instead.

### C05. The photo print (prop Element)

Nano Banana Pro · 4:3 · 2K · references: C01, `ai-skate-before.jpg`

```
Close-up product photograph of a small handmade photo print, 6 by 8 cm: a
cream felt card with a stitched cream border; inside it, two soft rounded
teal hills embroidered in satin stitch, overlapping like gentle mounds
along the bottom, and a small round mustard-yellow embroidered sun with a
few short rays at the upper right. Exactly the print the crab toy holds in
the reference images, shown alone with no crab, on a pure white
background, soft daylight, macro lens, every thread visible.
no pointy peaks, no jagged mountains, no text, no logo
```

Without "rounded" the model draws pointy peaks, which don't match the print
in every existing photo of Snap.

Create the Element `photo-print` (category: prop).

## 3. Phase B: lock the world

### W00. The world map (the "whole world" prompt)

Nano Banana 2.1 · 1:4 · 4K. Fallback: Nano Banana Pro · 9:16 · 4K.

This is the one prompt that shows the entire world at once. It becomes the
style reference for every zone and doubles as a poster.

```
A tall cutaway cross-section of one continuous handmade miniature ocean,
like a diorama seen through the side of a glass aquarium tank, showing the
whole journey from the surface to the deep-sea floor. A rusty iron anchor
chain with a coral-orange patina hangs from a small wooden boat at the top
and runs straight down the middle of the picture to the bottom. From top
to bottom, in bands that blend into each other:
1. A tiny marina at golden morning: a weathered wooden pier on
rope-wrapped pilings, small wooden sailboats with cream linen sails,
crocheted buoys in coral and cream stripes, felt seagulls, a striped
lighthouse far away, the crisp waterline cutting across.
2. Sunlit shallows: rippled golden sand with dancing caustics, felt
seagrass, crochet starfish, schools of small crochet fish, a spilled cargo
of tiny props: a film reel, folded paper pages, two little sand pails, a
shoebox.
3. A kelp forest: towering knitted kelp stalks with round crochet floats,
a few translucent silk blades in amber, rose and teal, shafts of sunlight.
4. A coral reef: ruffled hyperbolic-crochet coral in pink, tangerine and
violet, brain coral, sea fans, a crochet sea turtle, a shy cuttlefish, and
to one side a giant open clam whose pearly inside glows like a photo
studio under three glowing crochet jellyfish.
5. A shipwreck: an old wooden ship on its side with a breached hull,
barnacles of crochet bobbles, one warm lantern in the captain's cabin.
6. The twilight zone: deep indigo darkness, jellyfish crocheted from
glowing yarn, a long glowing siphonophore, a small round crochet
anglerfish with a lantern lure, a message in a bottle, falling marine snow.
7. The deep-sea floor: black basalt hydrothermal vents glowing orange with
shimmering water, crochet tube worms in red and white, fuzzy crochet yeti
crabs, a tiny brass toy submersible; the anchor rests beside a glowing
cracked-open geode.
The color changes with depth like real water: warm gold at the top, then
turquoise, emerald, vivid reef colors, teal, indigo, and near black with
orange glow at the bottom.
{WORLD_DNA}
Sharp detail throughout as if focus-stacked, museum diorama lighting.
no text, no letters, no numbers, no logos, no people, no human hands, no
plastic or CGI render look, no cartoon outlines
```

**W00-snap**: the same prompt plus `<<<snap>>> rides the chain in the
shallows band, hugging it with both claws.` Use for the poster and social
images.

### S0-STYLE. The style frame

Generate plate `Z0` (section 4) first, iterate until the world look is
right, then **create the Element `snap-world`** (category: environment)
from it. Every later plate uses `snap-world` plus its band of W00 as
references.

### KA01. Key art (the one plate with Snap in it)

Nano Banana Pro · 21:9 · 4K · Elements `snap`, `photo-print`, `snap-world`

```
<<<snap>>> stands on the end of the wooden pier at the tiny handmade
marina at golden morning, holding <<<photo-print>>> in his right claw and
waving with his left, while the over-under camera shows both the pier
above the waterline and the clear turquoise water below, where a rusty
iron anchor chain with a coral-orange patina drops into the blue. Same
place and light as the environment reference.
{SNAP_DNA}
{WORLD_DNA}
{SNAP_AVOID}
```

Crop to 1200 × 630 for `og:image`.

## 4. Phase C: zone plates

Each zone gets a desktop plate (21:9) and a phone plate (9:16). Build the
prompt as:

```
<zone prompt below>
{PLATE_LAYOUT} or {PLATE_LAYOUT_PHONE}
{WORLD_DNA}
{WORLD_AVOID}
```

References for every plate: `snap-world` Element, the matching band of
W00, and for phone plates the approved desktop plate ("same place, same
light, reframed for a tall screen").

### Z0. The Marina (also the style frame)

```
Split-level over-under photograph at a tiny handmade marina on a golden
morning, the camera half above and half below the waterline at a crab's
eye level. Above the water: the end of a weathered wooden pier on
rope-wrapped pilings, small wooden sailboats with cream linen sails,
crocheted buoys in coral and cream stripes bobbing on gentle ripples,
coiled rope, a striped lighthouse soft in the far distance, two felt
seagulls in the hazy sky, low warm sun from the left sparkling on the
water. A small wooden boat is moored at the top center with its bow toward
the camera. Below the water: clear turquoise water with sun rays, a few
small crochet fish, rippled sand far below. The waterline is a crisp
curved meniscus with a few droplets. Palette: morning haze #CFE8EE, sea
glass #8FE3E1, sand #F3DFB4, weathered wood #9C7A5B, sun #FFB020.
```

### Z1. The Shallows

```
Underwater five meters down in a handmade miniature sea, seen from a low camera
just above rippled golden sand. Bright dancing caustic light on the sand,
clear turquoise water fading to sea-glass blue in the distance, sun shafts
from the surface. Felt seagrass at the left and right edges in soft focus,
crochet starfish and round stones in the midground, a half-buried glass
bottle catching the light, small schools of crochet fish in different
colors and stitch patterns. On the right side, a little spilled cargo on
the sand: a film reel, folded paper pages, two small sand pails, a
cardboard shoebox, a mooring buoy on a rope. Palette: turquoise #2BB3B1,
sea glass #8FE3E1, wet sand #E9D3A1, caustic light #FFF3C4, tide #0D7372.
```

### Z2. The Kelp Forest

```
Inside a towering handmade kelp forest fifteen meters underwater,
seen from a low camera looking up and across. Tall knitted kelp stalks in olive
and gold rise from rocky ground to a sunlit canopy, with round crocheted
float bulbs and long felt blades; a few blades are translucent dyed silk in
amber, rose, teal and violet, glowing where the light passes through them.
Shafts of sunlight slant down through the canopy, particles drift, emerald
water fades to deep teal. A small tangle of fishing line on a kelp stalk at
the right edge. Palette: kelp olive #6E7F2E, kelp gold #B59A3A, emerald
#1F6F5C, sunbeam #F6E7A8, deep teal #0B3B3D.
```

### Z3-1 to Z3-4. The Coral Reef panorama

Four panels for the sideways section. Make Z3-1 first, then each next
panel with the previous one as a reference and the line "Continue the same
reef to the right, same horizon height, same light." Use
`{PLATE_LAYOUT_PATH}` instead of `{PLATE_LAYOUT}`.

```
A vivid handmade coral reef thirty meters underwater, seen from a low camera
along the reef floor. Ruffled hyperbolic-crochet coral in coral pink,
tangerine and violet, round crochet brain coral, lacy knitted sea fans,
anemones with felt tentacles, tiny crochet fish darting, clear blue water
with warm light from above. Palette: coral pink #FF7A8A, tangerine
#FF9A3C, fan violet #9B6BD6, reef teal #12A4A0, yellow tang #FFD23F.
```

Add one subject per panel:

- **Z3-1**: `A crochet sea turtle glides through the open water in the
  upper right.` (smart crop)
- **Z3-2**: `A school of round crochet fish faces the camera at mid
  height, each with clear button eyes.` (face detection)
- **Z3-3**: `A shy crochet cuttlefish hovers beside a sea fan, its skin a
  mottled pattern of tiny square stitches.` (redaction)
- **Z3-4**: `A crumpled aluminium soda can is stuck in the coral at mid
  height, the only man-made thing in sight.` (object removal; also make
  `Z3-4-clean`, the same panel with the can gone, as the "after")

### Z3b. The Clam Studio

```
Inside a giant open clam shell on the coral reef, used as a tiny photo
studio: the pearly nacre interior curves up behind like a seamless studio
backdrop with pearl, pink and lilac sheen; three crochet jellyfish hang
above, glowing softly like studio softbox lamps; a small crochet sea star
sits on the clam's lip like a product on set; a single perfect pearl rests
on a little sand pedestal; reef coral soft and out of focus around the
clam's rim. Soft, even, flattering light. Palette: pearl #F4EFE8, nacre
pink #F3D3D8, nacre lilac #D9CFF2, sand #E9D3A1, softbox #FFFDF6.
```

### Z4-EXT. The Shipwreck, outside

```
The silhouette of an old wooden sailing ship lying on its side on the sea
floor sixty meters down, seen from a distance through blue-teal water, a
dark breach in its hull, masts broken, barnacles of crochet bobbles, felt
seaweed streaming from the rails, faint light shafts from far above.
Palette: wreck teal #0F4C5C, deep green #123B3A, aged oak #6B4E37.
```

### Z4. The Shipwreck, the captain's cabin

```
Inside the captain's cabin of an old wooden shipwreck lying on its side
sixty meters underwater, seen from a low camera on the floor. Tilted oak planks
and beams covered with barnacles made of tiny crochet bobbles and felt
seaweed, round brass portholes letting in cold teal light shafts, a small
wooden desk with a brass wax seal stamp, rolled paper scrolls, an open
leather ship's log, a brass compass and a small locked wooden chest with
brass corners. One oil lantern hangs from a beam and glows warm amber, the
only warm light. Dust motes and tiny bubbles float in the beams. Palette:
wreck teal #0F4C5C, aged oak #6B4E37, brass #C9A24A, rust #A2471D, lantern
#FFB347.
```

### Z5 and Z5-LIT. The Twilight Zone

Two plates of the same scene. The site shows `Z5` and reveals `Z5-LIT`
through a soft circle around the cursor (the lantern).

`Z5`:

```
The twilight zone five hundred meters down in a handmade miniature ocean,
near total darkness of midnight indigo. Jellyfish crocheted from glowing
yarn drift with trailing tentacles, a long chain-like siphonophore glows
in cyan and magenta, a small round crochet anglerfish with a glowing
lantern lure hovers to one side, a glass bottle with a rolled paper message
drifts slowly, specks of marine snow fall through the dark. The only light
is the creatures' own glow: cyan #4FF0E6, magenta #FF5FD2, plankton green
#9FE8B0, against midnight #10153A and ink violet #2A1F5C. Very low key,
deep blacks, soft glows.
```

`Z5-LIT` (Z5 as the only reference):

```
The exact same scene, same composition, same camera, now lit by a soft
warm lantern from just behind the camera, revealing the crochet stitches
and yarn textures of every creature, the paper inside the bottle, and the
deep indigo water around them. Nothing moves or changes position.
```

### Z6. The Vents

```
The deep-sea floor two and a half kilometers down in a handmade miniature
ocean: black basalt hydrothermal vent chimneys glowing orange from inside,
with shimmering heat haze rising, crochet tube worms in red and white
clustered at their bases, fuzzy cream crochet yeti crabs on the rocks,
mineral crusts, a tiny brass-and-glass toy submersible with little claws
parked at the right. On the floor at the center, a glowing geode cracked
open, its crystals lit from within. Palette: abyss #0B1622, basalt
#1E2630, magma #FF6A2B, ember #FFB020, mineral teal #0D7372.
```

### Z7. Back to the Surface

Edit of the approved `Z0` (Z0 as the main reference):

```
The same marina, same composition and camera as the reference, now at
sunset: a low pink-gold sun on the horizon, long warm shadows, string
lights glowing along the pier, the water reflecting coral and lilac sky.
Below the waterline, a crochet sea turtle, a cuttlefish, a little octopus
and a few small fish gather, looking up. Palette: sunset coral #FF6B4A,
shell pink #FFB59F, gold #FFB020, dusk lilac #B9A3E3, evening sea #18344A.
```

### The octopus with its letter (S4, Snap's kindness)

Nano Banana Pro · 1:1 · 2K, the approved Z7 plate as the reference, then
Higgsfield background removal.

```
The little lilac crochet octopus from the reference image (bottom right,
under the water), now alone and seen from the front, photographed on a
plain mid-grey seamless background, isolated, sharp edges, soft even
light, no shadow on the background. Same character: a round bobbly head
crocheted in soft lilac-mauve yarn, two small shiny black bead eyes, a
tiny stitched smile, eight short curly tentacles with visible stitches. It
holds a small closed cream paper envelope against its chest with two
tentacles, the envelope's front flap facing the camera, plain and
unsealed. Whole octopus in frame with space around it.
A handmade miniature world at toy scale, photographed for real. Every
creature is handmade from yarn and fabric: crochet, knitting, felt and
embroidery, with visible stitches, bobbles and fibers. Macro photography,
50-100 mm lens look, natural light, rich but believable color, fine film
grain.
no writing on the envelope, no text, no numbers, no logos, no watermarks,
no people, no human hands, no crabs, no plastic or CGI render look, no
cartoon outlines, no flat illustration
```

### Foreground cutouts (parallax)

Nano Banana Pro · 1:1 or 9:16 · 2K, then Higgsfield background removal.

```
A single <element> photographed on a plain mid-grey seamless background,
isolated, sharp edges, soft even light, no shadow on the background.
{WORLD_DNA}
```

`<element>` per zone: a coiled rope and a crochet buoy (Z0); a felt
seagrass clump (Z1); one tall knitted kelp stalk with floats (Z2); two
hyperbolic crochet coral clusters (Z3); a hanging crochet jellyfish (Z3b);
a barnacled beam end (Z4); a crochet glow jellyfish (Z5); a tube worm
cluster (Z6).

For the new opening, two more props in the same way (no background
removal needed: the build cuts them out of the grey):

```
A single small crocheted marker buoy float in coral and cream stripes,
matching the yarn and colours of the buoy in the reference, a plump
teardrop shape seen from the side, floating upright, with a small brass
ring sewn to its bottom, nothing else in the frame, no rope coil.
Photographed on a plain mid-grey seamless background, isolated, centred,
sharp edges, soft even light, no shadow on the background. {WORLD_DNA}
```

Reference: the Z0 rope-coil-and-buoy source.

```
A single small toy ship's anchor made of real rusty iron with a
coral-orange rust patina, classic fisherman's anchor with two curved
flukes, a straight shank, a crossbar stock and a ring at the top, with
three links of rusty iron chain rising from the ring toward the top of the
frame. It rests half upright, leaning to the left, one fluke dug in as if
into sand, seen from the side at eye level. Photographed on a plain
mid-grey seamless background, isolated, centred, sharp edges, soft even
light, no shadow on the background. {WORLD_DNA}
```

For the way up, the submarine, 3:2, with the vents' plate as the reference
(so it is the model painted there), cut out of the grey in the build:

```
The small brass toy submersible from the lower right of the reference
image, alone and whole, exactly the same model and seen from the same
three-quarter angle as in the reference: a clear glass cylinder body held
by wide brass bands, a round glass dome at the front in a brass ring, a
short brass conning tower with a flat cap on top and a little periscope
pipe behind it, a small brass lamp on a stalk at the front, two short
steel grabber arms with pincers under the nose, a brass tank slung under
the hull, and a brass tail with fins and a propeller. It hovers level,
nose toward the lower left, the whole submersible in frame with space
around it. The glass is clean, clear and empty, with nothing inside, so
the plain background shows through it. Photographed on a plain mid-grey
seamless background, isolated, centred, sharp from nose to tail, soft even
light, no shadow on the background. {WORLD_DNA}
```

For the deep half of the dive, the submarine Snap rides in, 3:2, with the submarine
above as the reference (the same brass, glass and steel), cut out of the
grey in the build. It tends to come out nose to the left whatever the
prompt says; the build mirrors it.

```
A small handmade toy submarine made of real brass and glass, photographed
exactly from the side, level, nose pointing to the right. The front half
of the submarine is one large, perfectly clear glass sphere: a bubble
cockpit as tall as the whole vehicle, held by a wide brass ring where it
joins the hull. The glass sphere is completely empty and clean, with
nothing inside it, no seat, no controls, no figure, so the plain
background shows through the glass; only soft window highlights and a
faint rim show that it is glass. Behind the bubble a short riveted brass
hull with a small round brass hatch tower on top, a small brass headlamp
on a short stalk above the bubble, two short steel grabber arms with
pincers under the bubble pointing forward to the right, a brass ballast
tank slung under the hull, and at the back a brass tail with fins and a
small three-blade propeller. The same warm brass with patina and small
scratches, the same clear glass and the same steel arms as the toy
submersible in the reference image. The whole submarine in frame with
space around it. Photographed on a plain mid-grey seamless background,
isolated, centred, sharp from nose to tail, soft even light, no shadow on
the background. A handmade miniature at toy scale, photographed for real:
real brass, real glass with soft highlights, steel arms. Macro
photography, 100 mm lens look, natural light, rich but believable color,
fine film grain. No rocks, no sea floor, no bubbles, no water, no
creatures, no crabs, no people, no hands, no text, no letters, no numbers,
no logos, no watermarks, no plastic or CGI render look, no cartoon
outlines, no flat illustration.
```

## 5. Phase D: ambient loops

MiniMax H3 · 21:9 · 2K · 8 s · start image = end image = the zone plate.
Fallback: Kling 4.0, 21:9, 1080p.

```
{LOOP_RULES}
<motion below>
{VIDEO_RULES}
```

| ID | Motion |
| --- | --- |
| L-Z0 | Water ripples and sparkles, the sails flutter gently, buoys bob, two gulls glide slowly, the light rays under the water shimmer. |
| L-Z1 | Caustics dance across the sand, seagrass sways, the fish hover and turn in place, a few sand grains drift. |
| L-Z2 | Kelp stalks sway slowly in the current, light shafts shift, particles drift, the silk blades glow and ripple. |
| L-Z3-n | Sea fans sway, anemone tentacles wave, tiny fish dart out and return, the turtle paddles in place. |
| L-Z3b | The jellyfish lamps pulse gently, the nacre sheen shifts, tiny bubbles rise from the sand. |
| L-Z4 | The lantern sways a little and its flame flickers softly, dust motes drift, seaweed sways, light shafts waver. |
| L-Z5 | Jellyfish pulse and drift, glow travels slowly along the siphonophore, marine snow falls, the lure pulses slowly. No flashing. |
| L-Z6 | Heat haze shimmers above the vents, the orange glow breathes slowly, tube worms sway, particles rise. |
| L-Z7 | The sunset water sparkles, the string lights twinkle softly, the creatures bob at the waterline. |

Post: trim to a clean cycle and crossfade the last half second into the
first. For sway-only motion (kelp, fans), a forward-then-reverse loop also
works.

## 6. Phase E: signature transitions

Kling 4.0 · `image-to-video` · 21:9 · 1080p · 8 s · start image and end
image as listed. Premium try for T01 only: Seedance 2.0 1080p.

```
<move below>
{VIDEO_RULES}
```

| ID | Start → end | Move |
| --- | --- | --- |
| T01 The plunge | Z0 → Z1 | The camera slowly sinks from the over-under view at the marina down through the waterline: the surface line slides up and out of frame, a soft burst of bubbles, the light turns turquoise, and the camera keeps descending through clear water until it settles just above the rippled sand of the shallows. One continuous vertical descent. |
| T02 Into the reef | Z2 → Z3-1 | The camera glides forward out of the edge of the kelp forest and tilts down over a drop-off, revealing the colorful crochet coral reef below, then settles at reef-floor level. |
| T03 Into the wreck | Z4-EXT → Z4 | The camera drifts toward the sunken ship and passes slowly through the dark breach in the hull into the dim captain's cabin, where a single lantern glows. |
| T04 The drop | Z4-EXT → Z5 | The camera sinks past the edge of the wreck into open water, the light fading from teal to deep indigo as it descends, until only glowing jellyfish remain in the dark. |

T05, the express ascent, is built in code (color bands, bubbles, the
gauge counting up), not generated. Try `Z6 → Z7` on Kling 4.0 only if the
code version feels thin.

## 7. Phase F: Snap clips

Background: plain mid-grey seamless (`#8C959C`) for clean background
removal and no colored spill on the coral yarn. Snap is graded to each
zone's light in code.

**Start stills first.** Nano Banana Pro · 16:9 · 2K · `<<<snap>>>` (plus
`<<<snap-print>>>` where the print shows) · C01 as an image reference. One
still per starting pose; clips that start from the same still can cut into
each other on that frame.

| Still | Pose | Clips |
| --- | --- | --- |
| S-A | Default pose: waving, holding the print | M01, M02 |
| S-B | Neutral, claws low, wide framing | M03, M04, M05, M08, M09 |
| S-C | Neutral, the print lying on the floor beside him | M06 |
| S-D | Holding a small vintage rangefinder camera at chest height | M07 |
| S-R | Hugging the chain: pose 2 of C03 on the grey, the chain carried on to the frame edges. Made with `tools/ride-start.py`, not generated | M10, M11, M12 |
| S-R-free | S-R with the chain edited out, his claw still curled as if round it (Nano Banana Pro edit, below). The input for the 3D Snap | Tripo model |

```
<<<snap>>> <pose>.
Plain mid-grey seamless studio background: a flat, even #8C959C grey on
both floor and wall with no horizon line, no texture, no props. Soft,
even, neutral daylight from the upper left, no colored light, a soft
contact shadow under his feet. Locked-off camera at his eye level. He
stands in the center of the frame. Both eyestalks clearly visible; the
eyes never sit on the body.
{SNAP_DNA}
{SNAP_AVOID}
```

S-R-free is an edit of S-R (Nano Banana Pro, 16:9, 2K, S-R as the image reference):

```
Edit the reference image: remove the rusty iron chain completely, from the
top edge of the picture to the bottom edge, including every link inside his
claw and in front of his legs. Snap keeps exactly the same pose: the claw on
the left of the picture stays curled closed in the same place, as if
gripping a thin vertical rod, but it holds nothing; his legs stay exactly
where they are, and any yarn the chain was hiding is filled in naturally
with the same coral crochet stitches. Keep everything else exactly as it is:
the same plain mid-grey background, the same camera, the same soft lighting,
and Snap's size, position, colours, eyes with white rings, pink cheeks, gold
smile and cream spiral belly unchanged. No chain, no rope, no rod, no pole,
no new objects, no text.
```

Asked for "45 percent of the frame height", the model fills about three
quarters of it. S-B has to leave room to hop, so its prompt starts with
"Wide shot with a lot of empty space." and gives the proportions: his
full body about half the frame height, a quarter of the frame empty
above him.

**Clips.** Two models, because neither does everything:

- One-shot clips (M02, M03, M06, M07): Kling 3.0 · pro · 5 s (M06: 6 s)
  · sound off · 16:9 · start image = the still · `<<<snap>>>` in the
  prompt.
- Loops (M01, M04, M05, M08, M09): Kling 4.0 · image-to-video · 1080p ·
  5 s (M04: 4 s) · 16:9 · start and end image = the same still. Kling 3.0
  fails when the start and end frame are the same image, and Kling 4.0
  refuses Elements in image-to-video mode, so the loop prompt names Snap
  in words and the still carries his look.

```
<<<snap>>> on a plain mid-grey seamless background. <action below>
Locked-off camera, no camera movement, no zoom, his full body always in frame.
{SNAP_DNA_SHORT}
{SNAP_VIDEO_RULES}
```

For loops, open with "Snap, the crocheted crab toy, on a plain mid-grey
seamless background." (the ride loops M10 to M12: "..., hangs on a rusty
iron chain against a plain mid-grey seamless background.", with "the
rusty chain" added to what the rules keep) and replace the camera line with "The camera is
fixed on a tripod and never moves or zooms; only Snap moves. Seamless
loop: the last frame matches the first frame." For M03, the camera line
ends "the camera does not follow him".

`SNAP_VIDEO_RULES` is `VIDEO_RULES` for a character: weighty toy motion
instead of slow motion, and his anatomy held in every frame. For M05 and
M07, "No new objects appear" becomes "Apart from the sparkle (the flash),
nothing new appears".

```
Single continuous shot, no cuts, no scene changes. Physical, weighty
motion like a real crocheted toy brought to life. Stable exposure and
color. Keep the handmade crochet yarn, the plain grey background and the
exact lighting of the start frame. Both eyestalks stay visible, six legs
and two claws at all times. No new objects appear, nothing morphs into
something else, no text.
```

| ID | Still | Action | Used in |
| --- | --- | --- | --- |
| M01 | S-A | He stands holding the photo print in one claw and waves his raised claw gently side to side twice, blinks once (his coral eyelids slide down over the eyes and back up), then settles back into exactly the start pose. | S0 hero (loop) |
| M02 | S-A | A sudden gust of wind pulls the photo print out of his claw and it flutters away and out of the frame to the right; his eyestalks stretch straight up and both claws fly up in surprise, then he holds still, staring after it. | S0 story beat |
| M03 | S-B | He looks down, gives one small determined nod, crouches low on his six legs, then springs up and hops straight up and out of the top of the frame, leaving only the empty grey background. | S0 to the chain |
| M04 | S-B | A walk cycle on the spot: his six stubby legs step in a quick, even sideways rhythm, as if he were scuttling to the right on a treadmill, and his round body bobs gently up and down with each step. His body stays exactly in the center of the frame and never travels left or right; only his legs, the small bob and a little sway of his eyestalks move. | S3 reef (loop) |
| M05 | S-B | He raises one claw beside his head and clicks it shut twice, quickly, like a magician's finger snap; a tiny bright sparkle pops at the claw tip on each click. Then he lowers the claw and settles back into exactly the start pose. | Before each demo (loop) |
| M06 | S-C | He notices the photo print lying on the floor beside him: his eyestalks turn toward it and stretch up in delight, he scoots sideways over to it, picks it up with both claws, hugs it to his chest and does a happy little wiggle. | S6 the source |
| M07 | S-D | He lifts the small film camera up in front of his eyes with both claws, holds it still for a moment and takes a picture: a soft white flash blinks from the camera. Then he lowers the camera a little and peeks over the top of it, pleased. | S7 finale |
| M08 | S-B | He hops in place and claps his claws together above his head twice, happy, then lands softly with a small bounce and settles back into exactly the start pose. | Celebrations (loop) |
| M09 | S-B | He gets sleepy: his coral eyelids slowly droop halfway over his eyes, his body sways gently and his eyestalks sag a little as he dozes; then he blinks awake with a tiny start, his eyestalks perk up, and he settles back into exactly the start pose with his eyes open. | Idle (loop) |
| M10 | S-R | He is riding the chain down into the sea: the claw on the left of the picture stays wrapped around the same chain links the whole time and never lets go, and the legs pressed against the chain keep their grip. His dangling legs at the bottom paddle in a slow, happy rhythm, as if he were swimming, his round body bobs very slightly with each kick, and his eyestalks bounce and sway softly. Halfway through he blinks once: his coral eyelids slide down over his eyes and back up. The chain is pulled taut from above and below: it stays perfectly straight and vertical in exactly the same place and never swings. | Riding the chain (loop) |
| M11 | S-R | Happy to be riding it. The claw on the left of the picture stays wrapped around the same chain links the whole time and never lets go. His dangling legs kick in a quick, cheerful, uneven rhythm, he gives a happy little wiggle on the chain, his eyestalks bounce, and his free claw gives one small wave toward the camera, then rests back against his body. Then he settles back into exactly the start pose. The chain is pulled taut (as M10). | Riding, now and then (loop) |
| M12 | S-R | The claw on the left of the picture stays wrapped around the same chain links the whole time and never lets go. His dangling legs paddle gently while his eyestalks lean down to peek at the depths below him, then swing up to look up the chain above him, then come back to look at the camera, and he blinks once. Then he settles back into exactly the start pose. The chain is pulled taut (as M10). | Riding, now and then (loop) |

Post: Higgsfield background removal (video, 1 credit a clip). It returns
Snap on black in an ordinary MP4 with no alpha channel, and drops his
black eyes along with the background. `tools/snap-matte.py` combines that
copy with the grey original into the stacked-alpha MP4 the site plays.

## 8. Phase G: sprites and icons

### F01. Format fish (S1)

Nano Banana Pro · 16:9 · 4K, then cut out each fish.

```
A sheet of eight small handmade fish in side view, evenly spaced on a
plain mid-grey background, each a different species and stitch pattern,
none touching: a sleek silver-blue crochet mackerel, a round orange crochet
puffer, a classic yellow crochet tang, a striped teal and cream crochet
wrasse, a clear glass fish with a visible yarn skeleton, a cluster of
three tiny crochet fry, a fish embroidered as an outline only on a scrap
of linen, a little hermit crab in a crochet shell.
{WORLD_DNA}
{WORLD_AVOID}
```

Playful mapping for the hover labels: mackerel = AVIF, puffer = WebP,
tang = JPEG, wrasse = JPEG XL, glass fish = PNG (transparency), tiny fry =
GIF (animation), outline fish = SVG (decoded and rasterized), hermit crab
= HEIC (decode only: it moves in but never moves out).

### I01. Card icons (optional)

GPT Image 2.6 for drafts, Nano Banana Pro for finals · 1:1 · 4K

```
A 3 by 3 grid of round embroidered felt patches on a plain white
background, flat lay shot straight down from above, each patch about the
same size, evenly spaced with clear white gaps so no patch touches
another. Stitched in coral red, teal, cream and mustard thread, one simple
icon per patch: a chain link, a fish, a film reel, three drops of dye,
crop corner brackets, a magnifying glass, a wax seal, a lantern, a gear.
Satin-stitch fill, a stitched border on every patch, visible thread
texture, soft daylight from above, soft shadows under the patches.
no text, no letters, no numbers, no logos, no watermarks, no signage, no
people, no human hands, no crabs, no plastic or CGI render look, no
cartoon outlines, no flat illustration
```

The avoid line is `WORLD_AVOID` without its plate-only clauses: "no chain
... through the center of the frame" would fight the chain-link icon.

Two runs of the same prompt came back in two styles: bold machine-made
patches and fine hand-stitched ones. Test them at 48 px before choosing;
the bold set read, the fine stitches faded. If neither reads, draw the
icons as SVG in the style of the site's existing claw icon instead.

## 9. Acceptance checklist

For every asset, before it goes into the site:

- [ ] Snap (if present) passes the drift checklist in the bible
- [ ] The zone palette reads at a glance; no stray off-palette color
- [ ] Handmade materials are visible; nothing looks like plastic CGI
- [ ] No text, letters or logos anywhere
- [ ] Desktop plates: the center lane is calm; phone plates: the left
      lane is calm
- [ ] Loops: no visible jump at the seam
- [ ] Transitions: no morphing objects, start and end frames match the
      plates
- [ ] Saved with its `aw-<id>-v<nn>` name in the project folder

## 10. Running it from Claude with the Higgsfield connector

For the record, the calls this pack maps to:

1. `media_upload` → PUT the file → `media_confirm` for each reference.
2. `generate_image` with `medias: [{ role: "image_references", value: <id> }]`
   and the prompt; `jobs_wait`; review.
3. `show_reference_elements` with `action: "create"` for `snap`,
   `photo-print` and `snap-world`; then `<<<element_id>>>` in prompts.
4. `generate_image_batch` / `generate_video_batch` for a zone's
   variants, with a cost preflight (`get_cost: true`) before each batch.
5. `remove_background` (media type video) for Snap clips and cutouts;
   `outpaint_image` or `reframe` if a phone plate needs more room. The
   video remover returns Snap on black without alpha; build the matte with
   `tools/snap-matte.py`. It takes no folder, so attach its results with
   `attach_project_asset`.
