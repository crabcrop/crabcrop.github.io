# All the Way Down: the dive

The scroll-driven crabcrop landing page from `design/snap-world/`. This
folder is the source; it builds into `../preview/dive/`, next to the media
it uses. The live `index.html` and `docs.html` are untouched.

It covers the marina (S0), the plunge (T1), the shallows (S1), the kelp
forest (S2), the glide to the reef (T2), the reef (S3), the Clam Studio
(S3b), the way down to the shipwreck (S4), in through its hull (T3), the
captain's cabin (S4b) and the drop into the dark (T4), ending on a card at
the twilight zone that says it is next. The plan for the rest is in
`design/snap-world/experience-plan.md`.

## Commands

```sh
npm install
npm run dev        # http://localhost:5173, media served from ../preview/dive/media
npm run build      # type-check, then write ../preview/dive/index.html and assets/
npm run preview    # serve the build
```

The encoded media are committed, so a build needs no network. To make them
again from the approved Higgsfield outputs:

```sh
npm run fetch      # download the sources in scripts/sources.json to .cache/
npm run media      # encode plates, loops, the four transitions, Snap's clips, sprites
```

`npm run media` needs ffmpeg and Python 3 with numpy, scipy and Pillow
(built with AVIF), plus npx and trimesh for the 3D Snap. `npm run fetch` gets
the Tripo model through the `tripo` CLI, which needs the Tripo API key. It uses `design/snap-world/tools/snap-matte.py` to turn
Snap's clips into stacked-alpha video; the `ride` step imports its two
functions to cut the chain hanging free out of his riding loops.

## How it fits together

| Layer | What | Where |
| --- | --- | --- |
| World | Plates, their loops and the transition frames, cover-fit, with ripples under the cursor at the marina, a sun glint in the shallows, light shafts in the kelp, and the cabin's lantern swinging toward the cursor (drawn from the still plate and turned about its hook, since the loop sways it on its own) | `src/world/backdrop.ts` |
| Chain | A Verlet rope drawn as rusty iron links. The 3D Snap holds it at one point, in his raised claw: the links run on through the claw, where the depth buffer hides them, and hang in front of his legs. While he rides, the rope above him is weightless, so it runs straight into his claw. The sprite and film, his fallbacks, hold it at the two ends of the chain painted into them | `src/world/chain.ts` |
| Snap | The 3D model throughout: on the pier waving his raised claw with the print in the other, startled when the gust takes it (his eyes follow it down), crouching and hopping into a tumbling leap that splashes into the water; visits to the cards, where he stands on the top edge and snaps his pincer; and the sideways walk on the reef with the chain in his raised claw. Tap or click him anywhere for a reaction (a spin, a wave, a snap, a wiggle or a hop, by where he is). If the model cannot load, the alpha clips M01 to M05 play these parts | `src/world/snap.ts`, `src/world/splash.ts` |
| Snap on the chain | In 3D: a Tripo model of his chain pose with the chain edited out, seen as in the painting, with his own soft light and the zone's grade, and below the water's surface the water's colour with a line of foam. Alive in its vertex shader: legs that paddle (or walk, or stand still), faster when you scroll fast; eye stalks that sway and lag behind the swing; either claw that waves; a pincer that snaps shut; eyes that turn toward the cursor or whatever he watches; coral lids for blinks and a happy squint. A swing driven by scroll speed, real spins round the chain (a fast flick, now and then when idle, or a tap), and a tumble through the leap and the visits to the cards. If the model cannot load, the painted chain pose comes alive in its shaders and he rides on film (a calm loop, with a wave or a peek into the depths slipped in) | `src/world/rider.ts`, `src/world/snap3d.ts`, `src/world/sparkle.ts` |
| Fish | Six schools, one per format; they gather at the format tag | `src/world/fish.ts` |
| Bubbles | The plunge, the drop to the reef, and a stream from Snap on fast scrolls | `src/world/bubbles.ts` |
| Kelp | Knitted stalks in the foreground that sway and bend away from the cursor | `src/world/kelp.ts` |
| Reef | The pinned reef: the camera travels sideways across five plates, stopping at four stations and the Clam Studio; coral passes in front of each join; the cuttlefish and the pearl go to mosaic, the can's box fills with the clean plate, the softboxes switch on | `src/world/reef.ts`, `src/world/spots.ts` |
| The fish in the line | Snap snips a fish free from fishing line; it follows him | `src/world/netfish.ts` |
| The wreck | A barnacled beam drifting up past the camera on the way down; in the cabin, dust that rises, glints in the lantern's light and swirls from the cursor; and the octopus who climbs over the captain's chest with a letter, brings it to Snap, gets its wax seal when he snaps his claw, and swims off | `src/world/debris.ts`, `src/world/motes.ts`, `src/world/octopus.ts` |
| Looks | One grade shared by every shader: Crisp, Deep sea or Vintage, previewed on the whole kelp forest | `src/world/look.ts` |
| Interface | Real HTML: header, depth gauge, cards, tags, five choices, the cargo, the silk curtains. Sealed, the signature tag on the chain becomes the token and the other tags blur into it | `index.html`, `src/ui.ts`, `src/styles.css` |
| Reef interface | Station cards that slide in with each stop, the magnetic crop frame, face boxes, dragging a box over the can, the before and after slider | `src/reef-ui.ts` |
| Wreck interface | The chest in the Sealed URLs card (shut the lid and your recipe scrambles into an `s1.` token as long as a real one would be), the ship's log of your picture's Content Credentials written from your choices, the loader's ledger of refused private addresses, the wax seal on the desk for Choice 5, the octopus's button | `src/wreck-ui.ts` |

One WebGL canvas (Three.js) sits behind the HTML. Scrolling stays native,
smoothed by Lenis. With reduced motion, or without WebGL or JavaScript, the
page is a static article: each zone shows its still plate behind its text,
and the look choice grades the kelp's still plate with a CSS filter. The
reef becomes one block per station, each over its own plate.

Add `?slowmo=20` to the URL to play Snap and the world twenty times slower
while tuning an animation (videos keep their own pace).

The reef is pinned for 800vh: seven viewport heights of sideways travel,
then the studio scrolls on normally. Plates far from the camera are freed
and load again if the visitor scrolls back.

The code is about 182 KB gzipped (21 KB for the page; Three.js loads in its
own chunk after the text), fonts 123 KB, and the hero plate 100 to 145 KB.
The 3D Snap follows (0.7 MB of shape as base64 text and a 0.2 MB texture)
with the print he holds, then the marina loop. Snap's eight films (6 MB)
load only if the 3D Snap cannot. Each later zone and transition loads as
the visitor gets near it. All the media together are about 41 MB, a third
of it the four transitions (72 frames each). Each transition's frames come
in four packs per device, frame i in pack i % 4, so the first pack to
arrive already scrubs the whole move and the others fill in between (and a
transition is 8 requests, not 144).

The sealed token in the chest, on the chain and in the URL so far is a
stand-in: random-looking base64url of the right length (a 12-byte nonce,
the recipe and a 16-byte tag), the same for the same recipe. A real one
needs the secret, like the real signatures.

## Not built yet

- The twilight zone and everything below it (S5 onwards).
- Snap's claw moving for the snip in the kelp: the sparkle stands in for it.
- The real signed URLs: the builder needs the signing secret in CI.
- Depth maps for parallax, and sound.
