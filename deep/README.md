# The dive, made in code

"All the Way Down", the dive at `/preview/dive/`, rebuilt so that its scenes are drawn in
real time by code instead of played back from 44 MB of generated pictures and videos. The
same eight scenes, the same story, the same cast and the same five choices, in the same
handmade crochet world: the visitor scrolls, and dives with Snap from the marina to the vents
and back up, building a crabcrop URL on the way.

Nothing in it is a picture, a model, a video or a sound file: the sea, the light, the sand,
the crochet kelp and corals, the creatures, the boats, the wreck, the submarine and the
music are made by the page when it loads. The one exception is Snap himself, who keeps his
own 3D model (`media/`). The scenes follow the current dive's pictures (see
`preview/dive/media/z0` to `z7`): the marina at sunset from the waterline, the shallows, the
kelp, the reef and its Clam Studio, the wreck and its cabin, the twilight, the vents and the
geode, and the marina again.

Published at `/preview/deep/` (not linked from the site, `noindex`). The brief it is held to
is [PROMPT.md](PROMPT.md).

| | The painted dive (`preview/dive/`) | This dive |
|---|---|---|
| Files | about 270 images and videos, 44 MB | one HTML file, and Snap's model (214 KB) and texture (79 to 186 KB) |
| A visit downloads | 9.6 MB on desktop, 5.5 to 7.2 MB on a phone | about 0.5 to 0.65 MB |

## Build

```
npm ci
node build.mjs --publish     # ../preview/deep/index.html, and Snap's files beside it
node build.mjs               # the same into out/ (not tracked), to look at locally
node build.mjs --dev         # out/dev.html: with the tools below
```

The build bundles three.js and `src/` with esbuild into one inline script, strips the
comments and spare space from the shader code, writes a Content-Security-Policy that allows
that script by its hash and nothing else, and copies `media/` beside the page.

## How it draws

three.js's **WebGPURenderer**, with every shader written in **TSL**, three.js's shading
language. On a browser with WebGPU (about 84% of page views worldwide in late 2026: Chrome,
Edge, Safari 26, Firefox on Windows and Apple Silicon Macs) it runs on WebGPU; elsewhere
three.js switches to its WebGL 2 backend by itself and the same TSL becomes GLSL. A browser
with neither, or a visitor who prefers reduced motion, gets the page as plain text.

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
  final grade with the visitor's chosen look.
- `src/layout.js`: the valley, the camera's path through the eight zones, the water's colour
  by depth. `src/terrain.js`, `src/rocks.js` (formations carved from distance fields by
  surface nets), `src/flora.js` (kelp and sea grass built leaf by leaf in the vertex shader;
  the reef's corals as instances), `src/sea.js` (open water and the surface from below).
- `src/sets.js`: the marina at both ends (the pier, the sailboats, the lighthouse, the buoy),
  the anchor chain Snap rides, the Clam Studio, the wreck and its cabin, the vents, the geode
  and the diving helmet. `src/fauna.js`: the crochet fish, the turtle, the octopus, the jellies,
  the siphonophore, the anglerfish, the sea sheep and the tube worms, drifting specks and
  bubbles.
- `src/snap.js`: Snap from his model, with his rig ported to TSL (limbs, eye beads, lids,
  pincer). `src/sub.js`: his submarine, made in code. `src/cast.js`: where they are at each
  point of the dive, and the lamp. `src/print.js`: the visitor's image, a picture of Snap the
  page takes itself with the chosen crop, finish and look.
- `src/pace.js`: keeps the frame rate by trading resolution first, in small steps, and
  remembers where it settled. `src/app.js`: builds the world and runs the loop.
- `src/ui.js`, `src/audio.js`, `template.html`: the page around the scene; all of its sound is
  synthesized.

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
