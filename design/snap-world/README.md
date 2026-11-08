# All the Way Down

Plan and art direction for the next crabcrop landing page: an
Awwwards-style, scroll- and mouse-driven dive with Snap.

Snap starts on a sunny marina, grabs the anchor chain and rides it to the
bottom of the sea. The chain is a crabcrop URL, one link per operation.
Each depth is a different place that shows a family of features on cards,
and visitors build a real signed URL by making one choice per zone. At the
bottom Snap finds the source image; the trip back up is the response, and
the finished image is served live at the surface.

| File | What's in it |
| --- | --- |
| [`snap-character-bible.md`](snap-character-bible.md) | Snap's canon: anatomy, colors, materials, poses, do and don't, the prompt blocks, and how to keep him consistent in Higgsfield |
| [`art-direction.md`](art-direction.md) | The concept, world rules, camera, the nine zones with palettes and set pieces, type, interface, motion, sound, references |
| [`experience-plan.md`](experience-plan.md) | Scene-by-scene storyboard, the URL builder, the cards, how it's built, performance, accessibility, phones, phases, risks |
| [`higgsfield-prompts.md`](higgsfield-prompts.md) | Every asset to generate, in order, with model, settings, references, prompt, prices and budget |
| [`production-log.md`](production-log.md) | What has been generated and approved, the Higgsfield Element IDs, and lessons learned |
| [`tools/snap-matte.py`](tools/snap-matte.py) | Turns a Snap clip and its Higgsfield cutout into the stacked-alpha MP4 the site plays |

Status: every asset in the prompt pack is made in Higgsfield (Phases A to
G): Snap, the world look, every zone background, the ambient loops and
transitions, Snap's nine clips with their cutouts, and the card icons;
see `production-log.md`. The live site is unchanged.

Next step: the build, phase 3 in `experience-plan.md`. The build-time
steps for the generated assets are listed under "Next" in
`production-log.md`.
