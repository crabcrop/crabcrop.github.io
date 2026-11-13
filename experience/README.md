# All the Way Down: the dive

The scroll-driven crabcrop landing page from `design/snap-world/`. This
folder is the source; it builds into `../preview/dive/`, next to the media
it uses. The live `index.html` and `docs.html` are untouched.

It covers the marina (S0), the plunge (T1), the shallows (S1), the kelp
forest (S2), the glide to the reef (T2), the reef (S3), the Clam Studio
(S3b), the walk on to the shipwreck (S4), in through its hull (T3), the
captain's cabin (S4b), out again and the drop into the dark (T4), the
twilight zone (S5), the vents (S6), the express ascent (T5) and back at the
surface (S7), where the visitor's image is served: the whole dive. The plan
is in `design/snap-world/experience-plan.md`.

Snap rides the anchor chain once, from the boat down to its anchor on the
sand at the foot of the pier. From there he walks: sideways along the sea
floor from place to place, the URL's tags on a little line of his own that
a float holds up. Marina to shallows to kelp, and reef to Clam Studio to
wreck, are walks: two plates side by side, the camera travelling from one
to the next, something close passing the lens where they meet. Where a
film goes into a place (kelp to reef, in and out through the wreck's hull)
he pushes off and swims with the camera, and lands on his feet inside.
Only beyond the wreck, where there is nothing below him, does he fall:
through the twilight zone to the vents. The little submarine he meets
there carries him back up.

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
npm run media      # encode plates, loops, the three filmed transitions, Snap's clips, sprites
```

`npm run media` needs ffmpeg and Python 3 with numpy, scipy and Pillow
(built with AVIF), plus npx and trimesh for the 3D Snap. `npm run fetch` gets
the Tripo model through the `tripo` CLI, which needs the Tripo API key. It uses `design/snap-world/tools/snap-matte.py` to turn
Snap's clips into stacked-alpha video; the `ride` step imports its two
functions to cut the chain hanging free out of his riding loops.

## How it fits together

| Layer | What | Where |
| --- | --- | --- |
| World | Plates, their loops and the transition frames, cover-fit. The plunge is the marina's plate itself, pushed in on and down to the sand under the pier (its underwater half again as a sharper crop, laid exactly over it), so nothing can morph. On the two walks of the opening (to the shallows, into the kelp) two plates sit side by side and the camera travels from one to the next. Ripples under the cursor at the marina, a sun glint in the shallows, light shafts in the kelp, the cabin's lantern swinging toward the cursor (drawn from the still plate and turned about its hook, since the loop sways it on its own), and the visitor's own lantern in the twilight zone: the lit plate shows in a soft circle round it and the glowing creatures shine brighter there | `src/world/backdrop.ts` |
| Chains | A Verlet rope drawn as rusty iron links, twice. The anchor chain is fixed in the world, from the boat's stern to the ring of the anchor on the sand: Snap slides down it, the links running through his raised claw (the depth buffer hides them inside it). His line is a lighter chain he takes from the anchor and carries for the rest of the dive, a float on top holding it up, its foot in his raised claw wherever he goes (while he is off on a card it waits where he stood); the URL's tags hang along it. At sunset the anchor chain is back, boat to anchor, once the camera has pulled out to the whole marina | `src/world/chain.ts`, `src/world/index.ts` |
| Props | Cutouts set into the world, graded and hazed like things seen through water: the anchor in its mound of sand, the float, a pier post that passes close to the camera on the walk to the shallows, where the two plates meet, and the brass submarine (its glass a thin film, so what is behind shows through) | `src/world/props.ts` |
| Snap | The 3D model throughout: on the pier waving his raised claw with the print in the other, startled when the gust takes it (his eyes follow it down), crouching and hopping into a tumbling leap that splashes into the water; then down the anchor chain to the sand, and from there on his feet: standing in the shallows and the kelp, walking sideways between places and along the reef with his line in his raised claw, and leaping to the cards from wherever he stands (on a card's top edge he snaps his pincer). Tap or click him anywhere for a reaction (a spin, a wave, a snap, a wiggle or a hop, by where he is). If the model cannot load, the alpha clips M01 to M05 play these parts | `src/world/snap.ts`, `src/world/splash.ts` |
| Snap on the chain | In 3D: a Tripo model of his chain pose with the chain edited out, seen as in the painting, with his own soft light and the zone's grade, and below the water's surface the water's colour with a line of foam. Alive in its vertex shader: legs that paddle (or walk, or stand still), faster when you scroll fast; eye stalks that sway and lag behind the swing; either claw that waves; a pincer that snaps shut; eyes that turn toward the cursor or whatever he watches; coral lids for blinks and a happy squint. A swing driven by scroll speed, real spins round the chain (a fast flick, now and then when idle, or a tap), and a tumble through the leap and the visits to the cards. If the model cannot load, the painted chain pose comes alive in its shaders and he rides on film (a calm loop, with a wave or a peek into the depths slipped in) | `src/world/rider.ts`, `src/world/snap3d.ts`, `src/world/sparkle.ts` |
| Fish | Six schools, one per format; they gather at the format tag | `src/world/fish.ts` |
| Bubbles | The plunge, the glide to the reef, a puff of sand where Snap lands, and a stream from him on fast scrolls | `src/world/bubbles.ts` |
| Kelp | Knitted stalks in the foreground that sway and bend away from the cursor, and a clump of them at the forest's edge that passes close to the camera on the walk in | `src/world/kelp.ts` |
| Reef | The pinned reef: the camera travels sideways across five plates, stopping at four stations and the Clam Studio; coral passes in front of each join; the cuttlefish and the pearl go to mosaic, the can's box fills with the clean plate, the softboxes switch on. Past the studio the panorama has a sixth panel, the wreck seen from outside: the camera travels on to it as Snap walks, a last coral (dimmed as it goes) passing where the reef ends, the water murky there (a haze in the plate's shader, thickest at the join) | `src/world/reef.ts`, `src/world/spots.ts` |
| The fish in the line | Snap snips a fish free from fishing line; it follows him | `src/world/netfish.ts` |
| The wreck | A barnacled beam lying in the foreground on the way there. Snap stands on the sand beside the hole in the hull, swims in through it with the film and lands on the cabin's floor, by the desk; on the way out the same film plays backwards (out through the hole) and runs straight into the drop, whose first frame is that same view of the wreck. In the cabin, dust that rises, glints in the lantern's light and swirls from the cursor; and the octopus who climbs over the captain's chest with a letter, brings it to Snap, gets its wax seal when he snaps his claw, and swims off | `src/world/debris.ts`, `src/world/motes.ts`, `src/world/octopus.ts` |
| The twilight | The lantern the visitor carries (the cursor; on phones a slow sweep and wherever they tap), a tiny lost fish that follows its light and then goes home with Snap, the anglerfish's lure running down Snap's line while the explain card is up, a glowing jellyfish drifting past, and at the end a warm glow below. Snap sinks through it all with his float: there is nothing under him here | `src/world/twilight.ts` |
| The vents | Snap's print glowing in the geode until he lands in front of it and holds it up; tube worms in the foreground that pull their plumes in when the cursor comes close; heat shimmer round the cursor (in the plate's shader) | `src/world/vents.ts` |
| The way up | The little submarine from the vents offers a lift. Snap pushes off with his print, the express ascent begins (bands of each zone's colour with speed streaks, the depth counting down), and the submarine comes up under him: he rides it standing on its tower. At the top a look up at the surface from below and the pull back to the marina at sunset: the submarine surfaces with him, its tower just under the water, his line and its tags let go as the receipt comes up with the whole URL on it. He leaps off onto the pier, where he takes a picture of the receipt; the submarine sinks away, and the anchor chain is back at the boat | `src/world/backdrop.ts`, `src/world/snap.ts`, `src/world/index.ts` |
| Looks | One grade shared by every shader: Crisp, Deep sea or Vintage, previewed on the whole kelp forest | `src/world/look.ts` |
| Interface | Real HTML: header, depth gauge, cards, tags (they hang along Snap's line, from its float down to a little above his claw, clear of his eyes), five choices, the cargo, the silk curtains. Sealed, the signature tag becomes the token and the other tags blur into it | `index.html`, `src/ui.ts`, `src/styles.css` |
| Reef interface | Station cards that slide in with each stop, the magnetic crop frame, face boxes, dragging a box over the can, the before and after slider | `src/reef-ui.ts` |
| Wreck interface | The chest in the Sealed URLs card (shut the lid and your recipe scrambles into an `s1.` token as long as a real one would be), the ship's log of your picture's Content Credentials written from your choices, the loader's ledger of refused private addresses, the wax seal on the desk for Choice 5, the octopus's button | `src/wreck-ui.ts` |
| Twilight interface | CLIP tags that light up next to the creatures the light finds, the meta answer and alt text they add up to, the message in the bottle read line by line with boxes and scores, the explain report for the visitor's own URL (refused if it is sealed), and the chain's tags explaining their segments as the lure passes | `src/twilight-ui.ts` |
| Vents interface | The install and start typed out, the visitor's own URL built in TypeScript, Python and Rust, the little submersible's tool calls to the MCP server with its speech bubble over the plate (at the end it offers Snap a lift), and the source's tag, `root:photos/print.jpg`, the last on his line once Snap has his print (the others move up to make room) | `src/vents-ui.ts` |
| Surface interface | On the way up, the print beside Snap takes on the visitor's choices one at a time (format, look, crop, finish, seal), each one named under it and lit on its tag on his line; at the surface the receipt (the URL, a copy button, the picture as it would be served), a flash, and the polaroid Snap took dropping in | `src/surface-ui.ts` |

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

The code is about 201 KB gzipped (27 KB for the page; Three.js loads in its
own chunk after the text), fonts 123 KB, and the hero plate 100 to 145 KB.
The 3D Snap follows (0.7 MB of shape as base64 text and a 0.2 MB texture)
with the print he holds, then the marina loop. Snap's eight films (6 MB)
load only if the 3D Snap cannot. Each later zone and transition loads as
the visitor gets near it. All the media together are about 45 MB, 10 MB of
it the three filmed transitions (72 frames each; the plunge is no longer a
film but a push in on the marina's plate). Each transition's frames come
in four packs per device, frame i in pack i % 4, so the first pack to
arrive already scrubs the whole move and the others fill in between (and a
transition is 8 requests, not 144).

The sealed token in the chest, on Snap's line and in the URL so far is a
stand-in: random-looking base64url of the right length (a 12-byte nonce,
the recipe and a 16-byte tag), the same for the same recipe. A real one
needs the secret, like the real signatures.

## Not built yet

- The still page (reduced motion, no WebGL) still shows Snap hugging a
  piece of chain in each zone: it is as first built.
- Trimming: the page is about 46 screens long.
- Snap's claw moving for the snip in the kelp: the sparkle stands in for it.
- The real signed URLs: the builder needs the signing secret in CI.
- Depth maps for parallax, and sound.
