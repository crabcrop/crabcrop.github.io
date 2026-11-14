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

Snap goes down the anchor chain, from the boat to its anchor on the sand
at the foot of the pier, and from there he walks: sideways along the sea
floor from place to place, through the shallows, the kelp forest, the reef
and the Clam Studio to the shipwreck. Marina to shallows to kelp, and reef
to Clam Studio to wreck, are walks: two plates side by side, the camera
travelling from one to the next, something close passing the lens where
they meet. Where a film goes into a place (kelp to reef, in and out through
the wreck's hull) he pushes off and swims with the camera, and lands on his
feet inside. Past the wreck the sea floor ends, and a little submarine is
waiting there: on the way out of the cabin he leaps into its glass bubble,
and from there he is where the submarine is, down the drop, through the
twilight zone to the vents, where its pincer lifts his print out of the
geode, and all the way back up to the pier, where he gets out and it slips
back under. "Dive again" starts the day over.

The visitor's five choices are confirmed where they are made: each panel
says what it put in the URL. The URL itself is put together on the way up:
as each part is applied to the print in the submarine's pincer, its line
prints on a ticket under the picture, and at the surface the whole URL is
on the receipt.

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
Snap's clips into stacked-alpha video.

Two pictures are taken from the page itself, for the page without motion,
where it cannot show Snap on the pier with his print: Snap on his feet (the
kelp forest, the cabin) and Snap in the submarine (below the wreck). To
make them again (it needs Playwright with its Chromium):

```sh
node scripts/snap-still.mjs               # the dev server's world, only Snap (and the submarine) drawn, to .cache/snap-walk.png and .cache/snap-sub.png
python3 scripts/encode-media.py still     # crop and encode them
```

## How it fits together

| Layer | What | Where |
| --- | --- | --- |
| World | Plates, their loops and the transition frames, cover-fit. The plunge is the marina's plate itself, pushed in on and down to the sand under the pier (its underwater half again as a sharper crop, laid exactly over it), so nothing can morph. On the two walks of the opening (to the shallows, into the kelp) two plates sit side by side and the camera travels from one to the next. Ripples under the cursor at the marina, a sun glint in the shallows, light shafts in the kelp, the cabin's lantern swinging toward the cursor (drawn from the still plate and turned about its hook, since the loop sways it on its own), and the visitor's own lantern in the twilight zone: the lit plate shows in a soft circle round it and the glowing creatures shine brighter there | `src/world/backdrop.ts` |
| The anchor chain | A Verlet rope drawn as rusty iron links, from the boat's stern to the ring of the anchor on the sand at the foot of the pier. Snap slides down it, the links running through his raised claw (the depth buffer hides them inside it); once he is off it, it hangs behind him as scenery, and it is back at sunset once the camera has pulled out to the whole marina. It sways with the scroll and the cursor | `src/world/chain.ts`, `src/world/index.ts` |
| Props | Cutouts set into the world, graded and hazed like things seen through water, with a waterline to float at: the anchor in its mound of sand, a pier post that passes close to the camera on the walk to the shallows, where the two plates meet, and the submarine. A soft pool of light for its lamp | `src/world/props.ts` |
| The submarine | One cutout (brass and steel solid, its glass bubble a thin film) pinned by the bubble's middle to a spot on screen for each place, the spots blended by the scroll. It waits over the wreck, a little hazed by the water there, and comes into view with it. On the way out of the cabin Snap leaps in (quicker when the drop is near, so he is in his seat before it starts, however fast the scroll); from then on he is drawn between the backdrop and the cutout, so the glass and its brass ring are in front of him. It noses down on the drop and up on the climb, dips when he drops in, and nudges forward when its pincer lifts the print out of the geode. Its lamp glows where the water is dark, its propeller leaves a wash of bubbles when it is under way, and it never shows above the water while the camera crosses the surface: at the pier it stops under the waterline (below it, it takes on the sea's colour, with a line of foam). Once Snap is home it waits a moment and slips back under | `src/world/index.ts` |
| Snap | The 3D model throughout: on the pier waving his raised claw with the print in the other, startled when the gust takes it (his eyes follow it down), crouching and hopping into a tumbling leap that splashes into the water; then down the anchor chain to the sand, and from there on his feet: standing in the shallows and the kelp, walking sideways between places and along the reef, and leaping to the cards from wherever he stands (on a card's top edge he snaps his pincer). By the wreck he leaps into the submarine's bubble and is on his feet in it for the rest of the dive, leaning with it, looking about; at the end a leap back out onto the pier, where he holds up his print. Tap or click him anywhere for a reaction (a spin, a wave, a snap, a wiggle or a hop, by where he is); left alone in his seat for a while he does one by himself. If the model cannot load, the alpha clips M01 to M03 play the pier and the painted sprite does the rest: on the chain, afloat where he would walk, and in the bubble | `src/world/snap.ts`, `src/world/splash.ts` |
| Snap's body | In 3D: a Tripo model of his chain pose with the chain edited out, seen as in the painting, with his own soft light and the zone's grade, and below the water's surface the water's colour with a line of foam (less of it inside the bubble, so he stays red). Alive in its vertex shader: legs that paddle (or walk, or stand still), faster when you scroll fast; eye stalks that sway and lag behind the swing; either claw that waves; a pincer that snaps shut; eyes that turn toward the cursor or whatever he watches; coral lids for blinks and a happy squint. A swing driven by scroll speed, real spins round the chain (a fast flick, now and then when idle, or a tap), and a tumble through his leaps | `src/world/rider.ts`, `src/world/snap3d.ts`, `src/world/sparkle.ts` |
| Fish | Six schools, one per format; the one picked gathers by Snap's raised claw | `src/world/fish.ts` |
| Bubbles | The plunge and the films, a puff of sand where Snap lands, a stream from him on fast scrolls and fast walks, the propeller's wash, a few from the hatch on fast scrolls, and the rings and drops where he goes in | `src/world/bubbles.ts`, `src/world/splash.ts` |
| Kelp | Knitted stalks in the foreground that sway and bend away from the cursor, and a clump of them at the forest's edge that passes close to the camera on the walk in | `src/world/kelp.ts` |
| Reef | The pinned reef: the camera travels sideways across five plates, stopping at four stations and the Clam Studio; coral passes in front of each join; the cuttlefish and the pearl go to mosaic, the can's box fills with the clean plate, the softboxes switch on. Past the studio the panorama has a sixth panel, the wreck seen from outside: the camera travels on to it as Snap walks, a last coral (dimmed as it goes) passing where the reef ends, the water murky there (a haze in the plate's shader, thickest at the join) | `src/world/reef.ts`, `src/world/spots.ts` |
| The fish in the line | Snap snips a fish free from fishing line; it follows him | `src/world/netfish.ts` |
| The wreck | A barnacled beam lying in the foreground on the way there. Snap stands on the sand beside the hole in the hull, swims in through it with the film and lands on the cabin's floor, by the desk. On the way out the same film plays backwards (out through the hole) to the wreck seen from outside; that view holds while he leaps into the submarine, and then the drop begins, whose first frame is that same view. In the cabin, dust that rises, glints in the lantern's light and swirls from the cursor; and the octopus who climbs over the captain's chest with a letter, brings it to Snap, gets its wax seal when he snaps his claw, and swims off (the submarine, the story says, is the octopus's: it returns the favor) | `src/world/debris.ts`, `src/world/motes.ts`, `src/world/octopus.ts` |
| The twilight | The lantern the visitor carries (the cursor; on phones a slow sweep and wherever they tap), a tiny lost fish that follows its light and then swims along by the submarine's lamp, a glowing jellyfish drifting past, and at the end a warm glow below | `src/world/twilight.ts` |
| The vents | Snap's print glowing in the geode until the submarine settles over it and its pincer lifts it out; tube worms in the foreground that pull their plumes in when the cursor comes close; heat shimmer round the cursor (in the plate's shader) | `src/world/vents.ts` |
| The way up | The submarine lifts off with the print in its pincer and the express ascent begins (bands of each zone's colour with speed streaks, the depth counting down). At the top a look up at the surface from below and the pull back to the marina at sunset: the submarine comes up at the pier and stays in the water under the waterline as it comes down the screen; Snap leaps out onto the pier with his print and takes a picture of the receipt; the submarine slips back under, and the anchor chain is back at the boat. "Dive again" fades to the next morning and puts the page back at the top, the visitor's URL kept | `src/world/backdrop.ts`, `src/world/snap.ts`, `src/world/index.ts`, `src/main.ts` |
| Looks | One grade shared by every shader: Crisp, Deep sea or Vintage, previewed on the whole kelp forest | `src/world/look.ts` |
| Interface | Real HTML: header, depth gauge, cards, the cargo, the silk curtains, and five choices. Each choice's panel says, in a line at its foot, what the choice put in the URL (or that it adds nothing: no format named, no finish) | `index.html`, `src/ui.ts`, `src/styles.css` |
| Reef interface | Station cards that slide in with each stop, the magnetic crop frame, face boxes, dragging a box over the can, the before and after slider | `src/reef-ui.ts` |
| Wreck interface | The chest in the Sealed URLs card (shut the lid and your recipe scrambles into an `s1.` token as long as a real one would be), the ship's log of your picture's Content Credentials written from your choices, the loader's ledger of refused private addresses, the wax seal on the desk for Choice 5, the octopus's button | `src/wreck-ui.ts` |
| Twilight interface | CLIP tags that light up next to the creatures the light finds, the meta answer and alt text they add up to, the message in the bottle read line by line with boxes and scores, and the explain report for the visitor's own URL (refused if it is sealed) | `src/twilight-ui.ts` |
| Vents interface | The install and start typed out, the visitor's own URL built in TypeScript, Python and Rust, the tool calls to the MCP server of the other little submarine (the one painted into the plate: an agent) with its speech bubble, and the story of the print, which names the URL's last part: the source, `root:photos/print.jpg` | `src/vents-ui.ts` |
| Surface interface | On the way up, the print hanging from the pincer takes on the visitor's choices one at a time, in the order the server works through a URL (crop, look, finish, format, seal), and the URL prints on a ticket under it: a line for each part as it is applied, top to bottom as the URL reads, the newest lit. A choice that adds nothing gets a grey line; sealed, the lines fold into the token. At the surface the receipt (the whole URL, a copy button, the picture as it would be served), a flash, the polaroid Snap took dropping in, and the way back to the top | `src/surface-ui.ts` |

One WebGL canvas (Three.js) sits behind the HTML. Scrolling stays native,
smoothed by Lenis. With reduced motion, or without WebGL or JavaScript, the
page is a static article: each zone shows its still plate behind its text,
with Snap on the pier at both ends, on the chain in the shallows, on his
feet in the kelp and the cabin, and in the submarine below the wreck; the
look choice grades the kelp's still plate with a CSS filter. The reef
becomes one block per station, each over its own plate. The choice panels
say what each choice put in the URL there too (without JavaScript, where
the choices change nothing, they say nothing).

Add `?slowmo=20` to the URL to play Snap and the world twenty times slower
while tuning an animation (videos keep their own pace).

The reef is pinned for 800vh: seven viewport heights of sideways travel,
then the studio scrolls on normally. Plates far from the camera are freed
and load again if the visitor scrolls back.

The scripts and styles are about 209 KB gzipped (25 KB for the page's own
script; Three.js and the world load in their own chunk after the text),
fonts 123 KB, and the hero plate 100 to 145 KB. The 3D Snap follows (0.7 MB
of shape as base64 text and a 0.2 MB texture) with the print he holds, then
the marina loop. Snap's three films (1.7 MB) load only if the 3D Snap
cannot. Each later zone and transition loads as the visitor gets near it,
and the submarine (54 KB) once they reach the Clam Studio. All the media
together are about 41 MB, 10 MB of it the three filmed transitions (72
frames each; the plunge is no longer a film but a push in on the marina's
plate). Each transition's frames come
in four packs per device, frame i in pack i % 4, so the first pack to
arrive already scrubs the whole move and the others fill in between (and a
transition is 8 requests, not 144).

The sealed token in the chest, on the ticket and on the receipt is a
stand-in: random-looking base64url of the right length (a 12-byte nonce,
the recipe and a 16-byte tag), the same for the same recipe. A real one
needs the secret, like the real signatures.

## Not built yet

- Trimming: the page is about 47 screens long.
- The submarine's pincer is part of its cutout: it nudges forward to lift
  the print, but its jaws do not move.
- The real signed URLs: the builder needs the signing secret in CI.
- Depth maps for parallax, and sound.
