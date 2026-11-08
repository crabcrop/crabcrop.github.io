# Production log

What has been generated in Higgsfield, what was approved, and what we
learned. Asset IDs match `higgsfield-prompts.md`. Job IDs open in the
Higgsfield library; Element IDs go in prompts as `<<<element-id>>>`.

## Elements (locked)

| Element | ID | Made from | Use |
| --- | --- | --- | --- |
| `snap` | `c1ab5652-2db1-4266-ad9f-70189b3c8973` | C01, job `d65f12f3` | Every prompt with Snap |
| `snap-print` | `b807eb0c-0365-44bc-a835-407088acba7d` | C05b, job `b2ce82be` | Every prompt with the print |
| `snap-world` | `93226e24-2140-4626-b810-de84ad9f9d27` | Z0, job `10c47555` | Every zone plate, as the style reference |
| ~~`photo-print`~~ | `351ece50-cbcd-47f1-952b-fc9787030e00` | C05, job `a2360285` | Retired: pointy peaks don't match the print in existing photos. Don't use |

## Reference media (imported from crabcrop.org)

| File | Media ID |
| --- | --- |
| `crabcrop-mascot-still.webp` | `04df7220-6577-4ae1-9f9f-88a8ff678fe2` |
| `scene-camera.jpg` | `04f58639-c8bc-409a-a5c1-16866ca020cc` |
| `scene-surf.jpg` | `85f10e2b-f5ed-4c49-b834-f27de416c77d` |
| `ai-skate-before.jpg` | `a4233644-d7a8-4bab-ad8a-ba1d147f21ff` |

## Phase A: Snap

| Asset | Job | Status | Notes |
| --- | --- | --- | --- |
| C01 master reference | `d65f12f3-9c72-41bc-9cf5-75ae55f391f0` | Approved | 4096², passes the drift checklist. Alternate: `75edccac-8af7-4a46-bf94-6a5a2eea8af0` |
| C02 turnaround | `56b8cfe0-5827-4cba-97ff-edded8f226bb` | Approved | 5504 × 3072. Front, three-quarter, side, back consistent. Kept the waving claw instead of claws at sides. Alternate: `e5e3c40c-7220-47a0-bac3-13f208d0f149` |
| C03 pose sheet | `0fdd9dad-8734-4477-9f69-3ee1ab3c0bb4` | Poses 1 to 6 approved | Pose 2 (hugging the chain) is the descent pose. Poses 7 to 9 (wink, camera, sleepy) lost the eyestalks: rejected, redone as C03b |
| C03b wink, camera, sleepy | `be07b5f2-1a03-4aeb-9113-27c804eab4b4` | Approved | Eyestalks back, wink is a coral eyelid, gold smile |
| C05 photo print | `a2360285-5b4d-41ef-be9c-9491edb743a2` | Retired | Pointy peaks; every existing photo of Snap shows rounded hills |
| C05b photo print | `b2ce82be-f524-4f07-b692-c345b8ed38f7` | Approved | Two rounded teal hills, mustard sun, blanket-stitched border |

## Phase B: the world

| Asset | Job | Status | Notes |
| --- | --- | --- | --- |
| W00 world map | `e73aad2f-1519-4707-9577-fe0659f01ec8` | Approved | 2048 × 8256. All seven bands, chain down the middle. Reads as stacked diorama tiers; fine for a poster and as a style guide |
| Z0 marina, style frame | `10c47555-fe77-4156-b2cf-2eb52330742c` | Approved | 6336 × 2688. Piers frame both sides, light rays open the center lane. Alternate: `16bf03b2-d633-4ae0-b11b-efe7db05c55e` (pier on the left only, calmer lower-left for text) |
| KA01 key art | `d47191c3-4b50-4759-aef8-8e8efe95b8cf` | Approved | Snap small on the pier with his print, the chain dropping from the boat into turquoise water. Passes the checklist except the smile reads cream: retouch to gold before use. Made with the retired `photo-print` Element; the print still came out rounded |
| KA01 alternate | `67a3d5c9-0342-49b8-99fc-9dd5946f5a19` | Rejected | Snap oversized and floating, eyes lost their white rings |

## Phase C: zone plates, phone plates, cutouts

All plates are 6336 × 2688 (21:9, 4K) unless noted, made with Nano Banana
Pro and the `snap-world` Element as the style reference.

| Asset | Job | Status | Notes |
| --- | --- | --- | --- |
| Z1 The Shallows | `58d5245c-1744-4fd4-a863-0a84328a0ce1` | Approved | Fish schools both sides, bottle, the spilled cargo of sources on the right, sunlit center lane |
| Z2 The Kelp Forest | `f7a2e07b-533c-4dce-834b-b2e4df46ad75` | Approved | Knitted stalks, crochet floats, glowing silk "filter curtains", net tangle. Edit of `d2fe7a71` (rejected: a crab crept in) |
| Z3-1 Reef, turtle (smart crop) | `5206e93c-4288-4402-a277-64713b34410b` | Approved | Hyperbolic crochet coral, turtle upper right, sandy path |
| Z3-2 Reef, fish school (faces) | `686778f5-a138-48ec-ba3d-0411f6d7bbce` | Approved | Rock arch, seven fish facing the camera. Replaces `0f0c6cd8` (rejected: copied panel 1) |
| Z3-3 Reef, cuttlefish (redaction) | `2f8cae14-553b-4bb7-bba2-ba28c8527f23` | Approved | Cuttlefish by a lilac sea fan, left of center |
| Z3-4 Reef, soda can (object removal) | `da2465d1-bda3-4e82-9914-96fb6a63aee5` | Approved | Unbranded can in tangerine coral |
| Z3-4 clean (the "after") | `1766e98b-fc04-44b4-9490-05f2ee5ed12d` | Approved | Same frame, can gone, coral restored |
| Z3b The Clam Studio | `b8a93f69-3d53-476b-83e2-fe36bd818baa` | Approved | Two open shells facing each other, jellyfish lamps left, pearl right, open lane between |
| Z4-EXT The Shipwreck, outside | `502fd02d-b3b3-4e37-96b8-7a9f7336ec7c` | Approved | Ship centered with the hull breach; start frame for the "into the wreck" transition |
| Z4 The Shipwreck, cabin | `7a9ac2db-70ab-4728-9b48-e2234f227d9e` | Approved | Lantern, desk, wax seal, log, locked chest. Edit of `4f166be9` (rejected: a realistic crab on the floor) |
| Z5 The Twilight Zone | `3872346f-78d1-4547-9f2d-361d83d49ae6` | Approved | Glow-yarn jellyfish, siphonophore, anglerfish, bottle, marine snow |
| Z5-LIT | `c923aaf6-3d2e-4980-9204-690ffbd86112` | Approved | Same frame lit by a lantern; revealed under the cursor |
| Z6 The Vents | `b71b1c0a-04ce-448e-bac2-1566a6da2ae9` | Approved, note | Chimneys, tube worms, yeti crabs, submersible, glowing geode. The chimney tops show small flames that read a little volcanic: tone down in grading or the loop |
| Z7 Back to the Surface | `0e47089e-c94e-4ab8-b108-70723f4f2626` | Approved | The marina relit at sunset, string lights, friends gathered under the waterline |
| Z0 phone (9:16, 3072 × 5504) | `f160bb58-325b-4671-a939-a3d03d56fc28` | Approved | Tall over-under hero, left edge clear for the chain |
| Z7 phone (9:16, 3072 × 5504) | `a1a45d6d-69a8-4bde-820c-6b89f5251386` | Approved | The phone hero at sunset with the friends |

### Phone versions of the other zones

Only the hero and the finale got native 9:16 plates. Every other zone's
phone background is a crop of its 4K master, served by crabcrop itself
with `crop-rect`, so desktop and phone always match and no extra credits
are spent. A 9:16 window is about 24 percent of a plate's width. Starting
points (left and right edge of the window, as a share of plate width):

| Plate | Window | What it shows |
| --- | --- | --- |
| Z1 | 62–86% | The cargo and the right fish school |
| Z2 | 52–76% | The silk curtains |
| Z3-1 | 68–92% | The turtle |
| Z3-2 | 55–79% | The fish school |
| Z3-3 | 22–46% | The cuttlefish |
| Z3-4 and clean | 20–44% | The can, and where it was |
| Z3b | 55–79% | The pearl shell |
| Z4-EXT | 38–62% | The hull breach |
| Z4 | 54–78% | Desk, log and chest |
| Z5 and Z5-LIT | 52–76% | Anglerfish and bottle |
| Z6 | 42–66% | Geode and submersible |

Fine-tune on real phones during the build.

### Cutouts and sprites (background removed, RGBA)

| Element | Source job | Cutout job |
| --- | --- | --- |
| Rope coil and crochet buoy (Z0) | `9ddbaa86-4db5-4a0b-afa5-bd0cad6afc68` | `906c1ebc-5cb2-44fe-b99f-709eb8360cea` |
| Felt seagrass (Z1) | `9c06daf8-0550-4b36-bfb0-860c57e3996c` | `0e205aa6-843c-43b3-b0cc-0d61b71e85cb` |
| Knitted kelp stalk (Z2) | `df68fb0e-f683-45f1-bd58-981b97708a5b` | `66c2562f-4334-4614-9a37-7f1c9219c878` |
| Coral cluster and sea fan (Z3) | `b9b456a8-1bd1-4a35-8e3d-d7d0a71d03f8` | `a7015f21-ff82-4244-8946-dd0d06587ef3` |
| Jellyfish lamp (Z3b) | `68ff4137-5821-4c07-ac7c-6a2d0174508e` | `7ed0bdd2-016d-4da7-9770-0f12258ea85b` |
| Barnacled beam (Z4) | `abcf0529-c54e-4a58-91f1-2250388c24c4` | `e8a64676-8595-4eb0-a671-ae30dee62b84` |
| Glow jellyfish (Z5) | `64c6bacb-238f-462a-b15a-163bc385efe1` | none: kept on black for additive blending |
| Tube worms (Z6) | `346fe6bc-8434-49a0-a8a2-7df3989124f6` | `10692a69-c7e7-4430-b8f9-ce3fbdf5f2f0` |
| F01 format fish (sheet of 8) | `9499d710-a798-4e9a-a275-0d96e0002f5b` | Not yet: Higgsfield's remover failed three times on this sheet. Cut the fish with crabcrop's own `removebg` in the site build |

## Phase D and E: loops and transitions

All clips are Kling 4.0 (`image-to-video`), 21:9, 1080p (2212 × 936),
24 fps, 8 s, H.264 with an audio track to strip in the build. 26 credits
each.

### Transitions (folder 07)

| Clip | Frames | Job | Status | Notes |
| --- | --- | --- | --- | --- |
| T01 The plunge | Z0 → Z1 | `0b81c961-2167-4f16-ac70-7d15c3b2cf7b` | Approved | Sinks through the waterline, settles on the shallows set. No need for the premium Seedance try |
| T02 Into the reef | Z2 → Z3-1 | `0ec958e5-0f1a-4385-8b7b-03e50735a7c3` | Approved | Glides out of the kelp, over the rocks, onto the reef and the turtle |
| T03 Into the wreck | Z4-EXT → Z4 | `2d3ff41b-5d8d-4f7c-973c-cdf1c8986b9b` | Approved | Pushes through the hull breach into the lantern-lit cabin |
| T04 The drop | Z4-EXT → Z5 | `53ed72ea-519d-4159-81f2-681a95cf3607` | Approved | Glides past the wreck to a trench in the seabed and dives into the dark, where the glowing creatures appear |
| T04 first try | Z4-EXT → Z5 | `9e3eaf7d-57f7-438d-8161-e225ba8e281a` | Rejected | Mid-way the camera passes through the sea floor like a diorama tier |

### Loops (folder 06)

Start frame and end frame are the same plate, so the clip returns to
where it began.

| Loop | Plate | Job | Status | Notes |
| --- | --- | --- | --- | --- |
| L-Z0 The Marina | Z0 | `2f80f45b-91fc-4e3e-8769-468dcff1e09a` | Approved | Ripples, sails, gulls; seam as smooth as a normal frame step |
| L-Z1 The Shallows | Z1 | `60873dab-81ec-4b0b-b268-b985e506be6a` | Approved | Seam difference 1.7 of 255 between last and first frame; steady motion |
| L-Z1 alternate | Z1 | `f770d645-e55e-4edb-baff-860cedcab645` | Alternate | MiniMax H3, start frame only, 2944 × 1248. Doesn't return to its first frame: needs a crossfade to loop |
| L-Z2 The Kelp Forest | Z2 | `fe4c79d5-e406-408b-be50-3e61b2a9f416` | Approved | Kelp sway, light shafts; noticeable slow push-in and return |
| L-Z3-1 Reef, turtle | Z3-1 | `11af9eb6-f1ed-476f-b537-1bca09ecf58e` | Approved | Turtle paddles, fish dart; noticeable slow push-in and return |
| L-Z3b The Clam Studio | Z3b | `fd1820ed-b217-4aff-9ea1-458e7f56cb9b` | Approved | Lamps pulse, tentacles sway; the calmest loop |

No loop for the twilight zone: the lantern effect reveals the still lit
plate under the cursor, and creatures moving in a loop wouldn't line up
with it. Its life comes from code (marine snow, slow glow pulses).

Measured in Higgsfield's sandbox: each loop's last-to-first frame
difference is about the size of one normal frame step, so the seam is
invisible. Kling adds a slow push-in and return even when told to lock
the camera; it reads as gentle breathing.

## Higgsfield project

Everything approved lives in the project **crabcrop · All the Way Down**
(`03b58f25-49d0-4a18-bcf3-77a8b41d7dc1`, private workspace
`7073b137-2c9e-49e6-935e-16b6ed8dbe08`).

| Folder | ID | Contents |
| --- | --- | --- |
| 01 Snap | `d1df73ab-53c8-4e38-a5db-2414227dd544` | Master reference, turnaround, pose sheets, print |
| 02 World | `7e24e84e-5792-41e4-b50e-f06ebabd0c90` | World map, marina style frame and alternate, key art |
| 03 Zone plates | `15a35d9b-1714-4923-8467-6c506b7c7eb5` | Every approved desktop plate |
| 04 Phone plates | `d051214c-2bcc-4406-97ce-c16d8fc411e3` | Native 9:16 hero and finale |
| 05 Cutouts and sprites | `1c6b9ce1-22f1-4f2f-88cc-fcefa117c05a` | Cutout sources, cutouts, fish sheet |
| 99 Rejected | `2c5eef11-ab80-4def-a266-d1cbf1d0b640` | Kept for the record |

Pass the folder ID as `folder_id` on new generations so they land in the
right place.

## Credits so far

| Phase | Credits |
| --- | --- |
| A and B: Snap and the world look | 47 |
| C: plates, phone plates, cutouts, sprites | 103 |
| **Total** | **150** (balance 3,460) |

## Next

Phase D (ambient loops) and E (signature transitions). Then F (Snap
clips) and G (icons).

## What we learned

- Nano Banana Pro at 4K returns at most 2 images per call, even when
  asked for 4.
- Submitting 10 jobs at once: every other one was refused with "Out of
  credits" while the balance was fine. About 6 jobs in flight at a time
  works.
- A 1:1 4K pose sheet with the `snap` Element failed three times with no
  error reason. The same prompt at 16:9 4K worked.
- In multi-pose sheets the model can drop the eyestalks on close-up
  poses. Say in the prompt that the stalks stay visible in every pose and
  the eyes never sit on the body.
- The job list labels Nano Banana Pro jobs as `nano_banana_2`; outputs are
  full 4K and billed at the Pro price.
- This build sandbox can't download from Higgsfield's CDN; review images
  in Higgsfield's own sandbox instead.
- "Crab's-eye view" in a plate prompt makes the model add a crab, twice
  a realistic one. Say "a low camera at the height of a small toy" and add
  "no crabs".
- A panel generated with the previous panel as its reference copies that
  panel's layout. For panorama stations, write each composition in text
  with only the style Element as a reference, and hide the joins with
  foreground coral passing in front.
- Small fixes and relights work well as edits: pass the plate as the
  reference and say exactly what to remove or change and that everything
  else stays. Used for the two crabs, the clean reef, the lantern-lit
  twilight and the sunset.
- Background removal works on single objects at 2K; it failed three times
  on a 16:9 4K sheet of eight fish.
- Background removals count toward the jobs in flight; a removal started
  next to five generations was refused.
