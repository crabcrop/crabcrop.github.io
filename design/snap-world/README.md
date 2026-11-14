# All the Way Down

Plan and art direction for the next crabcrop landing page: an
Awwwards-style, scroll- and mouse-driven dive with Snap.

Snap starts on a sunny marina, goes down the anchor chain and walks the
sea floor from place to place; where it ends, beyond the shipwreck, a
little submarine takes him to the bottom of the sea. Each depth is a
different place that shows a family of features on cards, and visitors
build a crabcrop URL on the way, one choice per zone. At the bottom Snap
finds the source image; the trip back up is the response, where the URL is
put together line by line as each part is applied to the picture, and the
finished image is served at the surface, where he gets out on the pier he
started from. (The plan first had him ride the anchor chain all the way
down, with the chain as the URL; the three revision notes at the top of
`experience-plan.md` say how that changed.)

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

The whole dive is built: the source is in `experience/`, built to
`preview/dive/`, a preview beside the live site. See
`experience/README.md` for how it fits together and what is still open.
