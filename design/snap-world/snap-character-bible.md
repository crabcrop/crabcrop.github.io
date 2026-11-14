# Snap: character bible

Snap is the crabcrop mascot: a handmade amigurumi crab, photographed as a
real toy in real places. This file is the canon. Every image, clip, puppet
and prompt for the new landing page must match it. When something here
conflicts with an older asset, this file wins.

## 1. Who Snap is

Snap is a small, careful craftsman who treats every picture like a
keepsake. He notices the creatures around him, helps without being asked,
and wants every image to look its best. That empathy is the heart of the
brand: crabcrop takes care of your images, quickly.

Personality pillars:

| Pillar | What it looks like on screen |
| --- | --- |
| Caring | Stops to help: frees a fish, picks up litter, gives the shy cuttlefish its privacy |
| Curious | Eyestalks lean toward anything new before his body follows |
| Crafty | Works with his claws: stamps, clicks blocks together, adjusts a crop frame |
| Quick | Moves in short, decisive bursts, then settles. His name is the brand's verb |
| Playful | Small magic tricks, proud little hops, a wink for the camera |

Snap never speaks. He communicates with his eyestalks, his claws and his
whole body.

Signature gesture, **the snap**: a quick double click of the right claw.
On the site, every feature demo starts with Snap's snap, like a magician's
finger snap. It is the bridge between the mascot and the product.

### Behavior rules for animators

- Eyes lead. The eyestalks turn toward the point of interest first; the
  body follows about 120 ms later.
- He travels sideways (a scuttle), like a real crab. He never walks
  forward like a person.
- Every landing settles with one small overshoot (the site's
  `--snap: cubic-bezier(0.2,1.4,0.3,1)` curve).
- He blinks every 3 to 6 seconds. The eyelids are coral crochet that slide
  down over the black eye.
- Happy: a small hop and a claw clap. Surprised: both eyestalks stretch up.
  Concentrating: one eyestalk tilts. Proud: chest out, claws on hips.
- Never angry, never scary, never pinching anyone. No violence, no sadness
  beyond a brief "oh no" at the start of the story.

## 2. Canon anatomy

Read this top to bottom; it is also the order prompts describe him in.

1. **Size**: a toy about 15 cm (6 in) tall including eyestalks, roughly the
   size of a coffee mug. In scenes he is always a small object in a big
   world.
2. **Body**: one round piece for head and body, a soft gumdrop or egg shape,
   about as tall as it is wide, a little fuller near the bottom, flat
   underside so he stands on his own. No neck, no shell plates, no spikes.
3. **Belly**: a large ecru-cream disc crocheted in a visible spiral, set on
   the lower half of the body, about 55 to 60 percent of the body's width.
4. **Eyestalks**: two short, thick coral stalks rising from the top of the
   head in a slight V. Each ends in a coral crochet ball that holds one big
   glossy black safety eye set in a thin white ring. The eye balls are
   about a third of the body's width. Eyes look forward or at the subject,
   never cross-eyed.
5. **Face**: on the upper front of the body, below the eyestalks:
   two round soft-pink crocheted cheek patches, and between them a small,
   thin smile embroidered in golden-yellow thread, a gentle U with tiny
   upturned ends. No nose, no teeth, no open mouth, no eyebrows.
6. **Claws**: two big rounded mitten-shaped pincers, each about half the
   body's height, with a V notch at the top. Each claw has a peach-tan
   heart-shaped pad on its inner face. Short coral arms join them to the
   body's sides. Default pose: left claw raised in a wave, right claw holding
   the photo print.
7. **Legs**: six short, stubby, rounded legs, three per side: one smaller
   pair at mid-body, two pairs underneath. No joints, no points.

### Color canon

Sampled from the reference photos and rounded to stable values. Lighting
shifts them in scenes; these are the colors under neutral daylight.

| Part | Hex | Notes |
| --- | --- | --- |
| Body yarn (mid-tone) | `#D9483B` | Warm coral red, between tomato and terracotta |
| Body yarn (lit) | `#EF6C5A` | Top light, highlights on stitches |
| Body yarn (shadow) | `#A2271D` | Underside and stitch gaps |
| Belly disc | `#EADBC8` | Ecru, slightly warm, never pure white |
| Cheek patches | `#F2A7A5` | Soft pink |
| Claw pads | `#E3A07F` | Peach tan |
| Smile thread | `#D9A441` | Golden yellow |
| Eyes | `#0D0907` + white ring | Glossy, with one soft window highlight |

Brand colors on the site stay as they are (`--coral: #D63118` and friends).
Snap's yarn is a softer, lighter coral than the brand coral because it is a
real material under real light.

### Material and texture

- Chunky, matte cotton yarn worked in tight single crochet, in spiral
  rounds. The V-shaped stitches must be visible at every distance where
  Snap is larger than about 120 px on screen.
- Firmly stuffed, slightly lumpy in a handmade way, subtle stitch seams.
- A little fiber fuzz and a few stray hairs catch the light at the edges.
- No shine except the safety eyes.

## 3. Props and wardrobe

**Signature prop: the photo print.** A small cream felt card with a
stitched border, showing two soft rounded teal hills (not pointy peaks)
and a small yellow sun at the upper right. It is the universal "image"
icon made by hand, and it is the hero object of the landing page story.
Snap holds it in his right claw.

Other recurring props, one at a time, each tied to a feature:

| Prop | Used for |
| --- | --- |
| Vintage film camera | Snapping photos, the finale |
| Magnifying glass + blueprint | Metadata and explain |
| Wooden rubber stamp + wax seal | Signing and sealed URLs |
| Crochet puzzle blocks (teal, coral, mustard, cream) | URL anatomy |
| Crochet control panel with sliders | Filters and the playground |
| Black top hat with purple band + star wand | Easter egg magic trick |
| Cream crochet apron or sash | Studio and stamping scenes |

Props follow the world's material rule (see `art-direction.md`): soft props
are crocheted or felt, hard props are real miniature wood, brass or glass.

## 4. Approved poses and expressions

| ID | Pose | Where it appears |
| --- | --- | --- |
| P1 | Front, left claw waving, right claw holding the print | Hero, social cards |
| P2 | Hugging the anchor chain with both claws, legs tucked | The whole descent |
| P3 | Scuttling sideways, eyestalks forward | Horizontal sections |
| P4 | Presenting: one claw open toward a card | Feature reveals |
| P5 | The snap: right claw raised mid-click | Before each demo |
| P6 | Surprised: eyestalks stretched up, claws up | Discoveries |
| P7 | Wink (one coral eyelid closed), proud chest | Sealed URLs, finale |
| P8 | Holding the camera to his eyes | Finale photo |
| P9 | Sleepy blink, eyelids half down | Idle after 20 s |

## 5. Photographing Snap

- Camera at Snap's eye level (a crab's-eye view), 50 to 100 mm macro look,
  shallow depth of field, background in soft bokeh.
- Real light only: sun, overcast sky, underwater caustics, lanterns,
  bioluminescence. Let the light rake across the stitches.
- He casts a soft contact shadow and sits in the scene: wet yarn at the
  tide line, sand grains on his feet, bubbles clinging underwater.
- Leave space around him. He reads best small and centered in a big frame,
  or large and cropped tight with the world blurred behind him.

## 6. Do and don't

Do:

- Keep every canon feature on every shot: six legs, two claws with heart
  pads, two eyestalks with white-ringed black eyes, cheeks, gold smile,
  spiral belly.
- Keep the yarn matte and the stitches visible.
- Keep him the size of a toy, in a world built at toy scale.

Don't:

- Realistic crab anatomy: shell plates, spikes, segments, antennae, joints,
  hairy legs, a real crab's mouth.
- A 3D-render or plastic look, glossy skin, cartoon outlines, flat vector.
- Extra or missing eyes, legs or claws. Human hands or fingers.
- Teeth, a tongue, an open mouth, eyebrows, a nose.
- Clothing beyond the props listed above, and never two props at once.
- Color changes: no orange, pink or red-brown Snap. No color-graded skin
  in tinted scenes; correct him back toward the canon in post if needed.
- Text, logos or watermarks on or near him.

## 7. Reference images in this repo

Use these as the reference stack for every generation, in this priority:

| Priority | File | Why |
| --- | --- | --- |
| 1 | `crabcrop-mascot-still.webp` | Cleanest front view on white: the master reference |
| 2 | `scene-camera.jpg` | Real-world light and scale, full body, all six legs visible |
| 3 | `scene-surf.jpg` | Both claws raised, water, motion energy |
| 4 | `ai-skate-before.jpg` | Daylight detail of stitches, print and claw pads |
| - | `crabcrop-mascot.webp` | Blink cycle (coral eyelids) |
| - | `snap-ai.webp`, `snap-anatomy.webp`, `snap-sign.webp`, `snap-features.webp`, `snap-toy.webp`, `crabcrop-mascot-magician.webp` | Props and acting |
| - | `snap-playground.webp` | Props and acting. No longer published (dayvson/crabcrop#474): `git show 747c316:snap-playground.webp` |

Known drift in older assets; don't copy these details:

- `snap-sealed.webp`: one eye drawn as an embroidered closed eye with
  lashes, and a wider smile. The canon wink is a coral eyelid.
- `scene-bbq.jpg` and others: a stray stitched line on the forehead that
  reads as an eyebrow.
- Claw pads that drift from heart to oval. Canon is heart-shaped.

## 8. Prompt blocks

Paste these unchanged. Keep the order: image models weight earlier words
more.

### `SNAP_DNA` (image prompts)

```
Snap, a handmade amigurumi crab toy about 15 cm tall, crocheted from chunky
matte cotton yarn in tight single-crochet spiral rounds with visible V
stitches: a round gumdrop-shaped coral-red body (#D9483B), a large ecru-cream
spiral crocheted disc on the lower belly, two short thick coral eyestalks on
top of the head each ending in a coral crochet ball holding a big glossy
black safety eye set in a thin white ring, two round soft-pink crocheted
cheek patches, a small thin smile embroidered in golden-yellow thread, two
big rounded mitten-shaped claws with a V notch and peach-tan heart-shaped
inner pads, six short stubby rounded legs. Slightly fuzzy fiber with a few
stray hairs, firmly stuffed, photographed as a real physical toy.
```

### `SNAP_DNA_SHORT` (video prompts, used together with the reference image)

```
Snap, the coral-red crocheted amigurumi crab from the reference image:
round body, cream spiral belly, two eyestalks with big glossy black eyes,
pink cheeks, gold stitched smile, two mitten claws with peach heart pads,
six stubby legs. Keep him exactly as in the reference, same yarn, same
proportions.
```

### `SNAP_AVOID`

```
no eyes on the body, no missing eyestalks, no realistic crab shell, no
spikes, no segmented or jointed legs, no antennae, no teeth, no open
mouth, no eyebrows, no extra eyes, no extra legs or claws, no human hands
or fingers, no plastic or glossy 3D-render look, no cartoon outlines, no
color change, no clothing unless specified, no text, no logo, no
watermark
```

In multi-pose sheets and close-ups, also say that both eyestalks stay
clearly visible in every pose. Without that line the model sometimes sets
the eyes straight onto the body.

## 9. Keeping Snap consistent in Higgsfield

Higgsfield's "Soul" identity training is for people, so Snap uses
**Elements**: a saved reference that any supported model pulls in when the
prompt contains `<<<element_id>>>`.

1. **Make one master reference.** Regenerate the front view at 4K on a white
   seamless background from the repo stills (prompt `C01` in
   `higgsfield-prompts.md`). Approve it against section 2 line by line.
2. **Make the model sheet.** A four-view turnaround and an expression and
   pose sheet (prompts `C02` and `C03`). These become references for side
   and back angles.
3. **Save the Element.** Create a `snap` Element (category character) from
   the approved master reference. Save the photo print as a prop Element.
4. **Use the full stack on every call.** `<<<snap>>>` in the prompt, plus
   `SNAP_DNA` text, plus the master reference as an image reference where
   the model accepts one. For Kling 3.0 the Element only works with a start
   image, so always pass one.
5. **Keep Snap out of the backgrounds.** World plates are empty stages.
   Snap is generated separately and composited on top. This keeps one
   approved Snap for the whole site, keeps the backgrounds reusable, and
   lets him react to the mouse.
6. **Gate every asset.** Before an image or clip is accepted, check it
   against the drift checklist below. Reject, don't fix in post, if more
   than one item fails.

### Drift checklist

- [ ] Six legs, two claws, two eyestalks, nothing extra
- [ ] Both eyestalks present in every pose; eyes never sit on the body
- [ ] Heart-shaped peach pads on both claws
- [ ] White ring around both black eyes
- [ ] Pink cheeks and a gold (not cream) smile, no other facial features
- [ ] The print shows rounded hills, not pointy peaks
- [ ] Spiral cream belly, low on the body
- [ ] Coral within the canon range under the scene's light
- [ ] Visible crochet stitches, matte yarn
- [ ] Toy scale relative to the set
- [ ] In video: no morphing between frames, legs don't multiply, eyes
      don't swap sides
