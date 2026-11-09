# All the Way Down: the dive

The scroll-driven crabcrop landing page from `design/snap-world/`. This
folder is the source; it builds into `../preview/dive/`, next to the media
it uses. The live `index.html` and `docs.html` are untouched.

It covers the marina (S0), the plunge (T1), the shallows (S1), the kelp
forest (S2), the glide to the reef (T2), the reef (S3) and the Clam Studio
(S3b), ending on a card that says the wreck is next. The plan for the rest
is in `design/snap-world/experience-plan.md`.

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
npm run media      # encode plates, loops, both transitions, Snap's clips, sprites
```

`npm run media` needs ffmpeg and Python 3 with numpy, scipy and Pillow
(built with AVIF). It uses `design/snap-world/tools/snap-matte.py` to turn
Snap's clips into stacked-alpha video.

## How it fits together

| Layer | What | Where |
| --- | --- | --- |
| World | Plates, their loops and the transition frames, cover-fit, with ripples under the cursor at the marina, a sun glint in the shallows and light shafts in the kelp | `src/world/backdrop.ts` |
| Chain | A Verlet rope drawn as rusty iron links; Snap holds it at two points | `src/world/chain.ts` |
| Snap | Alpha clips on the pier (wave, gust, hop), the print that blows into the sea, a sprite riding the chain, and the sideways walk on the reef with the chain in his claw | `src/world/snap.ts` |
| Fish | Six schools, one per format; they gather at the format tag | `src/world/fish.ts` |
| Bubbles | The plunge, the drop to the reef, and a stream from Snap on fast scrolls | `src/world/bubbles.ts` |
| Kelp | Knitted stalks in the foreground that sway and bend away from the cursor | `src/world/kelp.ts` |
| Reef | The pinned reef: the camera travels sideways across five plates, stopping at four stations and the Clam Studio; coral passes in front of each join; the cuttlefish and the pearl go to mosaic, the can's box fills with the clean plate, the softboxes switch on | `src/world/reef.ts`, `src/world/spots.ts` |
| The fish in the line | Snap snips a fish free from fishing line; it follows him | `src/world/netfish.ts` |
| Looks | One grade shared by every shader: Crisp, Deep sea or Vintage, previewed on the whole kelp forest | `src/world/look.ts` |
| Interface | Real HTML: header, depth gauge, cards, tags, four choices, the cargo, the silk curtains | `index.html`, `src/ui.ts`, `src/styles.css` |
| Reef interface | Station cards that slide in with each stop, the magnetic crop frame, face boxes, dragging a box over the can, the before and after slider | `src/reef-ui.ts` |

One WebGL canvas (Three.js) sits behind the HTML. Scrolling stays native,
smoothed by Lenis. With reduced motion, or without WebGL or JavaScript, the
page is a static article: each zone shows its still plate behind its text,
and the look choice grades the kelp's still plate with a CSS filter. The
reef becomes one block per station, each over its own plate.

The reef is pinned for 800vh: seven viewport heights of sideways travel,
then the studio scrolls on normally. Plates far from the camera are freed
and load again if the visitor scrolls back.

The code is about 175 KB gzipped (18 KB for the page; Three.js loads in its
own chunk after the text), fonts 123 KB, and the hero plate 100 to 145 KB.
Snap's wave clip and the marina loop follow; each later zone and transition
loads as the visitor gets near it. All the media together are about 27 MB,
a third of it the two transitions (72 frames each).

## Not built yet

- The shipwreck and everything below it (S4 onwards).
- Snap's eyes following the cursor: needs the puppet (Rive, or cut-out parts).
- Snap's claw moving for the snip: the sparkle stands in for it.
- The real signed URLs: the builder needs the signing secret in CI.
- Depth maps for parallax, and sound.
