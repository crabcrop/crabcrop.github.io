# The dive, made in code

"All the Way Down", the dive at `/preview/dive/`, rebuilt so that its scenes are drawn in
real time by code instead of played back from 44 MB of generated pictures and videos. The
same eight scenes, the same story, the same cast and the same five choices, in the same
handmade crochet world: the visitor scrolls, and dives with Snap from the marina to the vents
and back up, building a crabcrop URL on the way.

Nothing in it is a picture, a model, a video or a sound file: the sea, the light, the sand,
the crochet kelp and corals, the creatures, the boats, the wreck, the submarine and the
music are made by the page when it loads. The exceptions are Snap himself, who keeps his
own 3D model, and the visitor's picture, a real photo from the site's samples with crabcrop's
own cut-out of it (`media/`). The scenes follow the current dive's pictures (see
`preview/dive/media/z0` to `z7`): the marina at sunset from the waterline, the shallows, the
kelp, the reef and its Clam Studio, the wreck and its cabin, the twilight, the vents and the
geode, and the marina again.

Published at [crabcrop.org/under-the-sea/](https://crabcrop.org/under-the-sea/), where the home
page's Snap invites visitors down (its old preview address, `/preview/dive-gpu/`, now sends them
there). The brief it is held to is [PROMPT.md](PROMPT.md).

| | The painted dive (`preview/dive/`) | This dive |
|---|---|---|
| Files | about 270 images and videos, 44 MB | one HTML file, Snap's model (214 KB) and texture (79 to 186 KB), the photo (63 KB) and its mask (8 KB) |
| A visit downloads | 9.6 MB on desktop, 5.5 to 7.2 MB on a phone | about 0.8 to 0.9 MB (the page is 438 KB compressed), and Google Analytics' script |

## Build

```
npm ci
node build.mjs --publish     # ../under-the-sea/index.html, and Snap's files beside it
node build.mjs               # the same into out/ (not tracked), to look at locally
node build.mjs --dev         # out/dev.html: with the tools below
```

The build bundles three.js and `src/` with esbuild into one inline script, strips the
comments and spare space from the shader code, writes a Content-Security-Policy that allows
that script by its hash and nothing else, and copies `media/` beside the page.

`--publish` also adds the site's Google Analytics tag, the same two tags as the home page
(Google's loader and its config, inline), and widens the policy for them: the loader's host,
the config by its hash, and the hosts Google lists for GA4. The site's privacy note,
[crabcrop.org/#privacy](https://crabcrop.org/#privacy), says the site uses it, and the page
links to the note from the finale and the Settings panel; the scripts site check
(`node ../.github/site-checks/scripts.mjs`) fails if the page has no such link. Builds into `out/` leave
the tag out, so working on the dive counts no visits.

## How it draws

three.js's **WebGPURenderer**, with every shader written in **TSL**, three.js's shading
language. On a browser with WebGPU (about 84% of page views worldwide in late 2026: Chrome,
Edge, Safari 26, Firefox on Windows and Apple Silicon Macs) it runs on WebGPU; elsewhere
three.js switches to its WebGL 2 backend by itself and the same TSL becomes GLSL. A browser
with neither, or a visitor who prefers reduced motion, gets the page as plain text; `src/page.js`
keeps its code examples and the finale's picture following the visitor's choices there.

- `src/shaders.js`: the water and the light, in one place. Light coming down loses red
  first, per metre of depth; along a line of sight the water takes light out again and
  scatters light into the eye, in closed form, which is why looking up is bright, far is blue
  and deep is black, with no colour ramp anywhere. Below the wreck's ledge depth counts for
  more (the drawn 205 m stand for the story's 2,500 m). `material()` builds every material
  from a vertex step and a surface step, and a depth-only twin for the shadow map.
- `src/engine.js`: the textures the page draws itself (the rock and sand relief once, the
  caustics and the surface's slope every frame), one sun shadow map drawn once, the scene
  into a half-float target whose alpha keeps each pixel's distance, light shafts marched
  through the shadow map on half the pixels, a depth-aware blur, a wide bloom veil, and the
  final grade with the visitor's chosen look (held on the whole picture in the kelp forest), the
  climb's lines (the painted dive's bands of every zone's colour and falling streaks, drawn
  behind whatever is within a few metres) and the heat wavering round the hand at the vents.
- `src/layout.js`: the valley, the camera's path through the eight zones, the water's colour
  by depth. `src/terrain.js`, `src/rocks.js` (formations carved from distance fields by
  surface nets), `src/flora.js` (kelp and sea grass built leaf by leaf in the vertex shader;
  the reef's corals as instances), `src/sea.js` (open water and the surface from below).
- `src/sets.js`: the marina at both ends (the pier, the sailboats, the lighthouse, the buoy),
  the mooring's chain Snap rides (hung from a knitted buoy beside where he starts to the
  anchor's ring: `layout.js` holds its line, which the camera rides beside him), the Clam
  Studio, the wreck and its cabin, the vents, the geode and the diving helmet. `src/fauna.js`: the crochet fish, the turtle, the octopus, the jellies,
  the siphonophore, the anglerfish, the sea sheep and the tube worms, drifting specks and
  bubbles.
- `src/snap.js`: Snap from his model, with his rig ported to TSL (limbs, eye beads, lids,
  pincer). `src/sub.js`: his brass submarine, made in code after the painted one, its glass a
  canopy that lifts, shuts and locks. `src/cast.js`: where they are at each point of the dive
  (the gust that takes his print, the ride down the chain, the wreck's cabin, the boarding, the
  homecoming on the submarine's back), his reactions and card visits, and the lamp. Both follow
  their places relative to the camera, so a fast scroll never leaves them behind.
  `src/photo.js`: the visitor's picture, a real photo from the site's samples (Snap at a skate
  park, `ai-skate-before.jpg`) and the subject's mask, which is crabcrop's own background removal
  of it (`ai-skate-removebg.webp`); it is also the print Snap carries, in a white border.
  `src/print.js`: the visitor's image, that photo put through their choices in the order the
  server works: the crop (smart: the window on the subject), the look, then the finish (the
  cut-out on the brand colour with a soft shadow for the studio, on transparency for removebg).
  `src/feltprint.js`: the little felt picture that stands in until the photo has loaded.
- `src/pace.js`: keeps the frame rate by trading resolution first, in small steps, and
  remembers where it settled. `src/app.js`: builds the world and runs the loop.
- `src/ui.js`, `src/audio.js`, `template.html`: the page around the scene (the bar that says it is
  "Your URL" and lights the part a choice changes, each choice with "Your turn" and "Your URL so
  far", one line of it on a phone, the loop back to the top); all of its sound is synthesized.
- The hands-on layer, the painted dive's interactions on the 3D scene: `src/stage.js` projects
  things of the scene onto the screen every frame and keeps the painted dive's rules for the
  visitor's hand (a cursor counts for 2.5 s after it moves, a tap for 1.4 s); its cues (a verb on
  a sun badge, tied to things by yarn, turning into a tick that says what happened for 4 s once
  the visitor has done it), rings, the dock and Snap's story notes look as they did there
  (`zones/core.css`); a note tells only what happened (who freed the fish, whether the light
  found the lost one). Each zone has a module, `src/zones/<id>.js`, with its scene pieces and
  page pieces, its words in `zones/<id>.html` and its styles in `zones/<id>.css`, which the build
  puts into the page; bigger 3D pieces are in `src/props/`. The shallows: six schools of format
  fish (the picked one gathers by Snap's claw; Auto races AVIF, JPEG XL and WebP to it), the cargo
  of sources with their rings (a tip stays open while the cursor rests on one; the Sources card's
  chips open the same ones), and the sun's glint on the sand under the hand. The kelp: three
  silk curtains that try a look on the whole forest and keep it on a click, and a little fish
  tangled in fishing line to cut free. The reef: the crop frame on the turtle (it hunts for a
  moment as its card comes up, then stays), face boxes on the school, the cuttlefish's blur, the
  can to erase (and its button puts it back); the Clam Studio, where Snap poses in front of
  the open shell while its jellyfish lamps come on one by one, a before/after to cut him out
  (`src/snapshots.js` draws him once for the cards) and the pearl rebuilt from a mosaic by
  `upscale(2)`. The wreck: the chest on the Sealed URLs card, which is Choice 5 itself (shut, the
  URL in the bar is sealed, and the chest in the cabin shuts with it), the wax seal on the desk
  (Choice 5 too), the octopus's letter that Snap seals for him as the camera looks in (a story,
  not a thing to do), the lantern that leans with the hand, and the dust; the cabin's loose things are made in `src/props/cabin.js`, so
  they move. The twilight: the submarine's lamp follows the hand (or a tap), its beam always out
  into the sea, never back at the eye, and names what it finds (tags with scores, the meta answer
  and its alt text), a lost fish follows the beam home,
  the bottle's message is read line by line. The vents: the install typed out, the SDK tabs, an
  agent's little submarine calling the MCP tools about the visitor's URL, and the print picked up
  at the geode: the submarine nudges forward for it and it rises into the pincer, while the card
  under it says it is the last part of the URL. The way up: the
  print on the pincer and its ticket.
- `src/amigurumi.js`: the crochet kit every creature is made with, as Snap is: rows of stitches
  worked round each body, felt, big bead eyes in white rings, a sewn smile.

No frame allocates in the dive's own code: buffers, vectors and matrices are made once, and
motion lives in the vertex shaders wherever it can.

## Tools

- `?bench`: descends the whole dive in 40 seconds and reports, per zone, the average, 99th
  percentile and worst frame, the GPU's own time where WebGPU can measure it, draw calls,
  triangles and heap growth. Copy the report from the box at the end.
- `H`: a line of frame statistics. `?level=low|medium|high` picks a detail level.
- `?webgl`: use the WebGL 2 backend even where WebGPU exists.
- In `dev.html` only: `?still` (no loop; `window.__deep.shot(p, time, yaw, pitch)` draws one
  frame), `?capture` (draw offscreen and read it back: how frames are checked where WebGPU
  cannot present to a screen), `?dbg` (shadows times caustics only).

The machine this was built on has no graphics card. Every frame was checked in software, on
both backends (WebGPU offscreen, WebGL 2 on screen), but its timings say nothing about real
hardware: frame times come from `?bench` on real devices.

## Credit

The scenes, the story, the cast and the look are the dive's own. Some rendering techniques (the closed-form scattering, the per-channel
extinction and its constants, the shadow-mapped shafts, the leaves built in the vertex
shader, the unthresholded bloom veil, the adaptive resolution) follow
[Abyssal Garden](https://github.com/Noniv/abyssal-garden) by Maksymilian Dendura, a
real-time underwater scene made entirely in code; none of its code or scenes are used. Its
licence, the MIT License:

> Copyright (c) 2026 Maksymilian Dendura
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this
> software and associated documentation files (the "Software"), to deal in the Software
> without restriction, including without limitation the rights to use, copy, modify, merge,
> publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
> to whom the Software is furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
> INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
> PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
> FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
> OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
> DEALINGS IN THE SOFTWARE.

three.js is © the three.js authors, under the MIT License; it is bundled into the page.
