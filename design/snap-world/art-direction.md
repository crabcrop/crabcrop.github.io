# All the Way Down: art direction

The new crabcrop landing page is a dive. Snap starts on a sunny marina,
grabs the anchor chain, and rides it to the bottom of the sea. Each depth
is a different place, and each place shows a group of crabcrop features on
cards. At the bottom he finds what he came for, and the trip back up takes
one breath.

Working title: **All the Way Down**. Line under it: *One signed URL, from
the surface to the source and back.*

## 1. The idea

### The anchor chain is the URL

A crabcrop URL is a chain: a signature, then operations, then the source
image at the end.

```
https://img.example.com / <signature> / crop:1200x630:smart / filters:sharpen(1.2) / root:photos/print.jpg
        the boat           first link       links on the way down                  the anchor, on the seabed
```

The page draws that literally. The boat at the marina is the server. Each
link of the anchor chain carries one part of the URL on a small paper tag.
The anchor rests on the source image at the bottom. Scrolling down the
page means reading the URL from left to right.

### The descent is the request, the climb is the response

- **Going down**, Snap passes through one zone per family of operations.
  The visitor can make one choice per zone (a format, a look, a crop, a
  finish), and the chain tags fill in with their choices.
- **At the bottom**, Snap picks up the source image.
- **Going up** is fast: the image transforms in Snap's claws as he rises,
  and at the surface it is served. The finished image on screen is a real
  crabcrop render of the URL the visitor built, with the real load time
  measured in their browser.

### The story beat that makes people care

At the marina, a gust of wind lifts Snap's favorite photo print off the
dock and it sinks. He doesn't hesitate: he hugs the anchor chain and goes
after it. On the way down he keeps stopping to help: he frees a little fish
tangled in fishing line, gives a shy cuttlefish its privacy, picks a can
off the coral, lights the way for a lost fish in the dark. At the bottom he
finds his print, and back at the surface, at sunset, he shows it to all the
friends he made.

That is the brand promise told without words: crabcrop takes care of every
image, quickly.

## 2. World rules

One sentence to keep every image consistent:

> **Handmade creatures, real materials, real light.**

| Layer | Rule | Examples |
| --- | --- | --- |
| Creatures and plants | Crochet, knit, felt, embroidery, wool | Snap, fish, kelp, coral, jellyfish, tube worms |
| Hard props and sets | Real materials at toy scale | Weathered wood, rope, brass, glass, iron, sand, stone |
| Light, water, air | Real and physical | Sun, caustics, god rays, bubbles, mist, bioluminescence |

More rules:

- **Toy scale everywhere.** Snap is 15 cm tall. A boat is the size of a
  shoebox; a kelp stalk is the height of a door. The camera reads it as a
  miniature: shallow depth of field, gentle tilt-shift on wide shots.
- **Every creature could be made by hand.** Visible stitches, felt fibers,
  bobbles, yarn tails. Nothing glossy except glass, water and eyes.
- **Coral reef forms follow hyperbolic crochet**, the ruffled technique
  made famous by the Crochet Coral Reef project of Margaret and Christine
  Wertheim. Credit the technique if we ever reference it in copy.
- **No text inside generated images.** All words on the site are real HTML.
- **No people, no hands.** The world is seen at Snap's height.
- **The anchor and chain are iron with a coral-orange rust patina.** A
  quiet nod to Rust, the language crabcrop is built in.
- **The visual composition leaves a calm vertical lane in the center** for
  the chain and Snap (on phones, at the left edge).

## 3. Camera language

- Crab's-eye view. The camera sits at Snap's height and looks across, not
  down.
- Macro look: 50 to 100 mm, f/2.8 to f/5.6, creamy bokeh, a few specks of
  floating particulate in the foreground.
- Every plate has three planes: a soft foreground frame at the edges, a
  sharp midground where things happen, and a hazy deep background.
- Camera moves are slow and physical: descending, drifting, gliding
  sideways. No whip pans, no fast zooms, no cuts inside a clip.

## 4. The zones

Depths follow the real ocean (twilight zone, vents) so the depth gauge
teaches a little ocean science along the way.

| # | Zone | Depth | Mood | Light | Features |
| --- | --- | --- | --- | --- | --- |
| S0 | The Marina | 0 m | Bright morning, fresh | Low gold sun, haze, sparkles | Hero, install |
| S1 | The Shallows | −5 m | Clear and playful | Caustics on rippled sand | Signed URLs, formats, sources |
| S2 | The Kelp Forest | −15 m | Tall and calm | God rays through the canopy | 51 filters, size operations, presets and purge |
| S3 | The Coral Reef | −30 m | The most color on the page | Clear blue, warm accents | Smart crop, face detection, redaction, object removal |
| S3b | The Clam Studio | −30 m (sideways) | Clean, bright, a little glam | Jellyfish softboxes, nacre glow | Studio mode, background removal, AI upscale |
| S4 | The Shipwreck | −60 m | Mysterious, treasure | Teal shafts, one warm lantern | Signing, sealed URLs, provenance |
| S5 | The Twilight Zone | −500 m | Dark wonder | Bioluminescence, the cursor is a lantern | Metadata and alt text, OCR, explain/ |
| S6 | The Vents | −2,500 m | Warm, powerful, the engine | Orange vent glow, shimmer | One Rust binary, SDKs and loaders, MCP |
| S7 | Back to the Surface | 0 m | Golden, celebratory | Pink-gold sunset, string lights | Your image, served; install; docs |

### Zone palettes

Five swatches per zone. Brand tokens are marked; the rest are new.

| Zone | Swatches |
| --- | --- |
| S0 Marina | `#CFE8EE` morning haze · `#8FE3E1` sea glass (brand) · `#F3DFB4` sand (brand) · `#9C7A5B` weathered wood · `#FFB020` sun (brand) |
| S1 Shallows | `#2BB3B1` turquoise · `#8FE3E1` sea glass · `#E9D3A1` wet sand · `#FFF3C4` caustic light · `#0D7372` tide (brand) |
| S2 Kelp | `#6E7F2E` kelp olive · `#B59A3A` kelp gold · `#1F6F5C` emerald water · `#F6E7A8` sunbeam · `#0B3B3D` deep teal |
| S3 Reef | `#FF7A8A` coral pink · `#FF9A3C` tangerine · `#9B6BD6` fan violet · `#12A4A0` reef teal · `#FFD23F` yellow tang |
| S3b Clam Studio | `#F4EFE8` pearl · `#F3D3D8` nacre pink · `#D9CFF2` nacre lilac · `#E9D3A1` sand · `#FFFDF6` softbox |
| S4 Wreck | `#0F4C5C` wreck teal · `#6B4E37` aged oak · `#C9A24A` brass · `#A2471D` rust · `#FFB347` lantern |
| S5 Twilight | `#10153A` midnight · `#2A1F5C` ink violet · `#4FF0E6` biolume cyan · `#FF5FD2` biolume magenta · `#9FE8B0` plankton (brand leaf) |
| S6 Vents | `#0B1622` abyss · `#1E2630` basalt · `#FF6A2B` magma · `#FFB020` ember (brand sun) · `#0D7372` mineral teal |
| S7 Sunset | `#FF6B4A` sunset coral · `#FFB59F` shell pink (brand) · `#FFB020` gold · `#B9A3E3` dusk lilac · `#18344A` evening sea (brand abyss-2) |

Global rule: as depth increases, the world loses red first, then
yellow (like real water), until only bioluminescence and vent glow carry
warm color. Snap is the exception: he always keeps his coral, lit by
whatever light the zone has. He is the warmest thing on screen in every
zone below S1.

### Set pieces by zone

- **S0 Marina.** A weathered wooden pier with rope-wrapped pilings,
  crocheted buoys in coral and cream stripes, small wooden sailboats with
  linen sails, coiled rope, a striped lighthouse far away, felt seagulls.
  The hero frame is an over-under split: above the waterline the pier and
  boats, below it turquoise water and the chain dropping into blue.
- **S1 Shallows.** Rippled sand with dancing caustics, felt seagrass,
  crochet starfish, a half-buried glass bottle. Schools of small crochet
  fish, one species per image format. A spilled cargo of sources: a film
  reel (a video frame), folded paper pages (a PDF page), two little sand
  pails (S3 and GCS buckets), a shoebox (a local file).
- **S2 Kelp Forest.** Towering knitted kelp stalks with round crochet
  floats, felt blades, shafts of sunlight. Some blades are translucent
  dyed silk, each a different color: the "filter curtains". A fishing line
  snag with a small fish caught in it.
- **S3 Coral Reef.** Hyperbolic crochet coral in pink, orange and violet,
  brain coral, sea fans, anemones with felt tentacles. A sea turtle, a shy
  cuttlefish, a seahorse, a school of yellow fish, a soda can stuck on the
  coral.
- **S3b Clam Studio.** A giant open clam whose nacre interior is a photo
  studio backdrop. Three crochet jellyfish hang as glowing softboxes. A
  crochet sea star sits on the clam's lip like a product on a set.
- **S4 Shipwreck.** An old wooden ship on its side, hull breached,
  barnacles as crochet bobbles, portholes, a captain's cabin with a desk:
  wax seal stamp, scrolls, a ship's log, a brass compass, a locked chest,
  one oil lantern.
- **S5 Twilight Zone.** Near black. Jellyfish crocheted in glow yarn, a
  long siphonophore chain, a small round anglerfish with a lantern lure,
  marine snow, a message in a bottle drifting by.
- **S6 Vents.** Basalt chimneys with orange glow and shimmering water,
  crochet tube worms in red and white, fuzzy yeti crabs (Snap's cousins),
  a tiny toy submersible with claws (the MCP agent). The anchor lands
  beside a glowing geode that holds Snap's photo print: the source.
- **S7 Back to the Surface.** The S0 marina, relit at sunset, string
  lights along the pier, all of Snap's new friends gathered at the
  waterline.

## 5. Typography

| Role | Face | Notes |
| --- | --- | --- |
| Display | Fraunces (variable) | Already the site's headline face. Use the variable build to animate its `SOFT` axis: crisp at the surface (`SOFT 0`), rounder with depth (`SOFT 100` at the vents), as if water softens the letters. `WONK 1` on zone titles. |
| Body and UI | Figtree | Friendly, clear, neutral enough not to fight Fraunces. |
| URLs, HUD, code | JetBrains Mono | Chain tags, depth readout, code chips, install command. |

Self-host woff2 subsets, as the site does today with Fraunces 900.

Scale (desktop, clamp down on phones): zone title 96 to 144 px, section
heading 48 to 64, card title 22, body 18, small 14, HUD mono 12 uppercase
with 0.18 em tracking (the site's existing `.tidemark` style).

## 6. Interface language

- **Depth gauge (left edge).** A thin vertical gauge with tick marks and a
  live readout in mono: `−30 m · CORAL REEF`. It is also the navigation:
  each zone is a link. On phones it becomes a thin progress bar under the
  header.
- **Header.** Logo, Install, Docs, GitHub, sound toggle, and a "Skip the
  dive" link that jumps to a plain version of the page.
- **Chain tags.** Small cream paper tags tied to chain links with coral
  yarn, showing URL segments in mono. A visitor's choice fills a blank tag
  with a little stamp animation.
- **Feature cards: field cards.** Each feature is a cream linen card like a
  naturalist's field card, hung from the chain on a short yarn thread so it
  sways with the water.
  - Stitched border (a dashed SVG stroke that sews itself in on reveal).
  - The site's asymmetric shell radius (`28px 28px 28px 6px`) and hard
    offset shadow, so it still feels like crabcrop.
  - A specimen window at the top with a live demo of the feature, run on
    real crabcrop renders.
  - Title in Fraunces, two lines of body, the URL fragment as a mono chip,
    and a "Read the docs" link to the matching section.
  - Tinted per zone (border and chip color); in dark zones the border glows
    softly but the card stays cream so the text stays readable.
- **Buttons.** Keep the current coral buttons with ink border and hard
  shadow. They already feel tactile.

## 7. Motion language

| Name | Feel | Use |
| --- | --- | --- |
| Buoyancy | Slow sine drift and damped springs | Cards, tags, particles underwater |
| The snap | Quick press with one overshoot, `cubic-bezier(0.2,1.4,0.3,1)` (existing `--snap`) | Clicks, landings, choices |
| The scuttle | Brisk sideways glide, `cubic-bezier(0.3,0.9,0.2,1)` (existing `--scuttle`) | Horizontal sections, Snap travelling |
| Reveal | Strong ease-out, `cubic-bezier(0.23,1,0.32,1)` (from the refine preview) | Text and cards arriving |

- Scroll speed drives the world: a fast scroll makes the chain sway, the
  tags flutter and a stream of bubbles rise from Snap.
- Light falls off with depth: a global "water" layer adds fog and shifts
  color toward blue as the depth readout grows.
- One orchestrated moment per zone, not effects everywhere.

## 8. Sound

Off by default, one toggle in the header, remembered per visitor.

- Surface: water lapping on pilings, rigging creaks, distant gulls.
- Underwater: a muffled room tone that darkens with depth.
- Clicks: a soft claw "snap" and bubble pops.
- Zones: timber creaks in the wreck, a far whale call in the twilight, a
  low rumble at the vents, a little music-box version of the theme at
  sunset.

## 9. References and what to take from them

I could not open the reference sites from the build sandbox (its network
policy blocks them), so these notes come from search results and the
sites' public write-ups. Worth a look together before kickoff.

| Reference | What to take |
| --- | --- |
| [bruno-simon.com](https://bruno-simon.com/) | The world is the navigation. Toy physics, secrets to find, a handmade feel. The 2025 rebuild runs on Three.js with WebGPU and TSL, built in Blender. |
| [Shopify Editions, Winter '26](https://www.shopify.com/editions/winter2026) | One bold theme ("RenAIssance", with Renaissance-style imagery) carrying an immersive showcase of 150+ updates. The engineering write-up for their Spring '26 edition describes using Rive where interaction matters and video where it doesn't. We do the same. |
| [iamsunnywang.com](https://www.iamsunnywang.com/) | A résumé told as interactive scrolling illustrations of a journey from Beijing to Pittsburgh to Silicon Valley. The scroll is a trip through places. |
| [The Sea We Breathe](https://www.awwwards.com/sites/the-sea-we-breathe) | Awwwards Site of the Day: underwater storytelling with WebGL and sound design. |
| [Blue Marine Foundation](https://unseen.co/projects/blue-marine-foundation/) by Unseen Studio | Realistic underwater worlds that change with depth. |

What we do that none of them do: the journey *is* the product's API. By
the time visitors reach the surface they have built a real crabcrop URL.
