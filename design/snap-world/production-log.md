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
| L-Z3-2 Reef, fish school | Z3-2 | `efc47398-c7cf-4d2f-9d1d-fae77bd00b68` | Approved | Fish hover and bob, sea whips sway |
| L-Z3-3 Reef, cuttlefish | Z3-3 | `e1bdf3dc-92a2-40d4-8de3-f942b579d356` | Approved | Cuttlefish fins ripple, sea fan sways |
| L-Z3-4 Reef, soda can | Z3-4 | `21293e50-80d7-4e24-bf75-e4777aaafcb8` | Approved | Coral and fish move, the can stays put |
| L-Z3b The Clam Studio | Z3b | `fd1820ed-b217-4aff-9ea1-458e7f56cb9b` | Approved | Lamps pulse, tentacles sway |
| L-Z4 The cabin | Z4 | `0c66fd54-c3dd-4b4c-91b6-c35c36c89b50` | Approved | Lantern flicker, dust in the light shafts; very calm |
| L-Z6 The Vents | Z6 | `4e85ea12-5781-4e80-858e-62c5da1a2acb` | Approved | Glow breathes, worms sway; the flames didn't grow |
| L-Z7 Back to the Surface | Z7 | `98c8a211-3702-4f82-9670-114e6744ad14` | Approved | Sunset sparkle, string lights, friends bobbing |
| L-Z0 phone (9:16) | Z0 phone | `6258bb2b-4817-4cdb-bc97-fabc5c785d96` | Approved | The tall hero, morning |
| L-Z7 phone (9:16) | Z7 phone | `508dee6b-b2bd-4b79-aae2-c603f6ba5c7b` | Approved | The tall finale, sunset |

No loop for the twilight zone: the lantern effect reveals the still lit
plate under the cursor, and creatures moving in a loop wouldn't line up
with it. Its life comes from code (marine snow, slow glow pulses).

Measured in Higgsfield's sandbox: each loop's last-to-first frame
difference is about the size of one normal frame step, so the seam is
invisible. Kling adds a slow push-in and return even when told to lock
the camera; it reads as gentle breathing.

## Phase F: Snap clips

Start stills are Nano Banana Pro, 16:9, 2K (2752 × 1536), made with the
`snap` Element (plus `snap-print` where the print shows) and C01 as an
image reference, on plain mid-grey `#8C959C`. One-shot clips are Kling
3.0 (pro, 16:9, no sound, the `snap` Element in the prompt): 8.75 credits
per 5 s, 10.5 per 6 s. Loops are Kling 4.0 (image-to-video, 16:9, 1080p)
with the same still as start and end frame: 16.25 credits per 5 s, 13 per
4 s. Every clip is 1928 × 1076 at 24 fps.

### Start stills (folder 08)

| Still | Pose | Job | Status | Used by |
| --- | --- | --- | --- | --- |
| S-A | Default pose: waving, holding the print | `2ab89515-1f75-44c7-b27c-637fda6b86a2` | Approved | M01, M02 |
| S-B | Neutral, claws low, wide framing with headroom for hops | `ea3ba6fe-e589-4fe1-a236-32ccd1d43810` | Approved | M03, M04, M05, M08, M09 |
| S-C | Neutral, the print lying on the floor beside him | `2bc0286e-4fe7-4fee-b882-0e8c506648b9` | Approved | M06. The pads read round rather than heart-shaped; one checklist item, accepted |
| S-D | Holding a vintage rangefinder camera at chest height | `2a685065-a212-4e85-86d0-fa0891fabf79` | Approved | M07 |
| Alternates | S-A `b12fbd6a-59ac-41a2-90b9-2e673e49ada3`; S-B `d75e1d9e-3fda-4d63-aff0-9b4f30ab921a`, `72362af6-7423-4bab-a158-c14611e4447d`, `fde82ec3-1153-49a7-8ade-08a3a2e2ddeb` | | Alternate | The first two S-B stills fill three quarters of the frame: too little room above him to hop |

The S-A wave is on the viewer's left and the print on the right, as in
C01.

### Clips (folder 08)

| Clip | Model | Still | Job | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| M01 Wave (loop) | Kling 4.0, 5 s | S-A | `323c87bb-16a1-4a9d-830f-c37fd4daa4f3` | Approved | Waves twice, blinks once. Seam 0.6 |
| M02 The gust | Kling 3.0, 5 s | S-A | `cc22161a-2720-46ce-853a-4327e3fc3cda` | Approved | Start playback at 1.2 s: before that he flinches with a claw across his face. Then the print flies off to the right, claws up, and he settles facing the camera |
| M03 Hop to the chain | Kling 3.0, 5 s | S-B | `6dc60dc0-a213-4bef-9a7f-f20800a0f691` | Approved | Looks down, nods, crouches at 3.8 s and springs out of the top of the frame by 5.0 s. Start playback at about 3 s |
| M04 Scuttle (loop) | Kling 4.0, 4 s | S-B | `d2fb25ad-ee54-4ecd-9b46-753464303db0` | Approved | Steps in place; his body's center stays within 1 percent of the frame width. Seam 0.6 |
| M04 first take | Kling 4.0, 5 s | S-B | `2dbdbb4d-3a48-462a-8427-4d7984225119` | Alternate | Paces right, then left, then back: his center moves between 39 and 60 percent of the width |
| M05 The snap (loop) | Kling 4.0, 5 s | S-B | `8ed431ff-4299-4fb0-87e9-1857f1e6c1e1` | Approved | Claw up beside his head, three sparkling clicks, back down. Seam 0.5 |
| M06 Finds the print | Kling 3.0, 6 s | S-C | `04e8b82f-d566-4221-826b-d38b279d4411` | Approved | Looks at the print for 2.5 s, scoots over, picks it up and holds it to his chest; no wiggle |
| M07 The photo | Kling 3.0, 5 s | S-D | `1fdc13df-6aec-41e0-96da-7d15eb1c9a1b` | Approved | Camera up to his eyes, the flash glows from 2.7 to 3.5 s, then he peeks over it |
| M08 Hop and clap (loop) | Kling 4.0, 5 s | S-B | `99c783d7-de5a-4a7b-81a5-a738650e00bb` | Approved | Three hops with a clap above his head, lands in the start pose. Seam 0.5 |
| M09 Sleepy (loop) | Kling 4.0, 5 s | S-B | `2b26715f-024b-483a-9b92-b27da93333ea` | Approved | Eyelids droop, eyes close, a startled hop awake at 3.2 s, back to the start pose. For a calmer idle, play 0.5 to 2.8 s back and forth. Seam 0.5 |
| Failed (refunded, in 99 Rejected) | Kling 3.0 | | `e814ecd0-6554-46d4-b77d-e2e6bc7474a6`, `5e2361c6-9370-4589-9bc0-630fc8325f62`, `a12ebaf3-8733-4dd6-a6fb-252b3113b16f`, `65f7c8e1-a2b1-49d5-8506-e459e6ef9b68` | Failed | The first three are M01, M04 and M05 with the same start and end frame. The last is M07's first try; the same request worked the second time |

Seams measured as for the zone loops: 0.5 to 0.6 out of 255 between the
last and first frame, against normal frame steps of 1.8 to 6.8. Kling 4.0
added no push-in on the grey background: Snap's size stays constant. The
Kling 4.0 clips carry an audio track to strip; the Kling 3.0 clips have
none.

### Cutouts (folder 08)

Higgsfield's video background remover, 1 credit a clip. It returns an
ordinary H.264 MP4 of Snap on black, with no alpha channel, and it drops
his black eyes along with the background. `tools/snap-matte.py` combines
each cutout with its grey original into a stacked-alpha MP4 for the site
(color on top, matte below, 960 px wide, about 0.6 to 1.1 MB): it fills the
eyes back in, repairs edges the remover cut into, and keeps the floor
shadow out. Tested on all nine clips over the zone colors. It keeps the
print, the camera and the flash glow; M05's sparkle is lost, so draw it in
code at the clicks (about 1.5, 2.0, 2.5 and 3.0 s).

| Clip | Cutout job |
| --- | --- |
| M01 | `387afd06-05ef-4c82-aad0-0f952c0dfd61` |
| M02 | `cb45eeda-dc2c-4465-ae85-bb446927382b` |
| M03 | `5a40470c-774a-4f91-adc7-c673e9bb5fce` |
| M04 | `3aaed242-b7cf-479a-be7d-74a7f4afa741` |
| M05 | `618f5ee2-5316-456e-9eb8-4813fcf79294` |
| M06 | `1f6d1482-7323-4797-b792-eadf5c8862e4` |
| M07 | `eb2f3d4b-3c31-43d0-916d-e1a26d0bed02` |
| M08 | `43c539d5-a8c7-4040-802a-5bbcb6ed7a4a` |
| M09 | `8c9f2883-28d9-4ad7-8366-99aed290a4c4` |

## Phase G: card icons (folder 09)

Nano Banana Pro, 1:1, 4K (4096 × 4096), no Element. The prompt is I01
with `WORLD_AVOID` minus its plate-only clauses (the chain clause would
fight the chain-link icon), asked as a flat lay with clear gaps between
patches.

| Asset | Job | Status | Notes |
| --- | --- | --- | --- |
| I01b card icons | `dffa4364-5804-4420-865b-1f8fabe2224f` | Approved | Bold machine-embroidered patches with satin borders; every icon reads at 48 px |
| I01a | `66f09d53-bd50-4b29-80e9-0e19f8e18359` | Alternate | Hand-stitched running-stitch patches: prettier up close, but the thin stitches fade at 48 px. Use at 96 px and up |

Each I01b patch cut from the sheet by crabcrop itself: the `crop-rect`
segment below (corners in pixels of the 4096 sheet), then
`filters:removebg:format(webp)`.

| Icon | `crop-rect` | Cards |
| --- | --- | --- |
| Chain link | `crop-rect:220x252:1368x1428` | Signed URLs |
| Fish | `crop-rect:1484x252:2632x1428` | Formats |
| Film reel | `crop-rect:2740x252:3900x1428` | More than photos (video frames, PDF pages) |
| Three drops | `crop-rect:220x1520:1368x2720` | Filters |
| Crop brackets | `crop-rect:1484x1520:2632x2716` | Size and crop, smart crop |
| Magnifying glass | `crop-rect:2740x1520:3904x2720` | Faces, explain |
| Wax seal | `crop-rect:220x2772:1368x3996` | Sealed URLs, provenance |
| Lantern | `crop-rect:1484x2760:2632x3996` | Metadata and OCR |
| Gear | `crop-rect:2740x2760:3904x3996` | The binary, SDKs, MCP |

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
| 06 Loops | `46dfb83e-dcb6-4825-9a72-7640ff4a2f13` | Ambient loops, desktop and phone |
| 07 Transitions | `f1602e59-ea3e-4b28-b048-449f596d34a4` | The four camera moves between zones |
| 08 Snap clips | `e0c57cb5-0fee-400f-b9ee-81346f46851e` | Snap's start stills and clips, on grey and cut out |
| 09 Icons | `06d37f39-279f-4705-9301-ffc111e6e7e6` | Card icon patches |
| 99 Rejected | `2c5eef11-ab80-4def-a266-d1cbf1d0b640` | Kept for the record |

Pass the folder ID as `folder_id` on new generations so they land in the
right place. Background removal takes no folder: attach its results with
`attach_project_asset`.

## Credits so far

| Phase | Credits |
| --- | --- |
| A and B: Snap and the world look | 47 |
| C: plates, phone plates, cutouts, sprites | 103 |
| D and E: 13 loops, 5 transition takes, 1 test | 484 |
| F and G: 8 start stills, 10 clip takes, 9 cutouts, 2 icon sheets | 164 |
| **Total** | **798** |

Failed jobs were refunded.

## Build

The page is built in `experience/` and previewed from `preview/dive/`.

- **Slice 1: the marina, the plunge and the shallows.** Plates Z0 and Z1
  with their loops, T01 as 96 scrubbed frames, Snap's clips M01 to M03 as
  stacked-alpha video, the pose-2 sprite on the chain, the fish schools,
  the cargo hotspots and the format choice.
- **Slice 2: the kelp forest and the glide to the reef.** Plate Z2 and its
  loop, the kelp cutout, T02 as 96 scrubbed frames and Z3-1 behind the end
  card. New in the code: one look grade shared by every shader (Crisp,
  Deep sea, Vintage), silk curtains that preview a look on the whole
  forest, foreground kelp that bends away from the cursor, light shafts,
  and the fish Snap snips free.

- **Slice 3: the reef and the Clam Studio.** The four Z3 stations, Z3-4
  clean and Z3b as one sideways panorama, with the coral and sea fan cutout
  passing in front of each join, and M04 for Snap's walk (his left claw
  tracked through the cycle so the chain hangs from it). The stations: a
  crop frame that snaps around the turtle, face boxes on the seven fish, the
  cuttlefish going to mosaic, and a box dragged over the can filling in from
  Z3-4 clean. In the studio the softboxes flicker on, the pearl is rebuilt
  from a mosaic, and Snap shows the finish choices. No zone loops on the
  reef: the effects are pinned to the stills, and Kling's push-in would
  move the subjects out from under them. T01 and T02 were cut to 72 frames
  to keep the preview under its file limit.

Still open from the generation phase:

- Earlier leftovers: retouch KA01's smile to gold, and cut the F01 fish
  with crabcrop's `removebg`.

## Next

The shipwreck (S4): T03 into the wreck, the cabin, sealed URLs and
provenance, and Choice 5, the seal. Its plates, loop and transition are
made.

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
- MiniMax H3 failed with the same image as start and end frame (no error
  given). With a start frame only it works, but the clip doesn't return to
  its first frame. Kling 4.0 handles start = end and loops cleanly, at 26
  credits per 8 s.
- Kling 4.0 adds a slow push-in and return to loops even when told to
  lock the camera, and every clip carries an audio track.
- A transition can take the shortest path through the scenery: the first
  "drop" went down through the sea floor. Describe a physical route (over
  a cliff edge, into a trench) and say "never through the sea floor".
- Video takes 6 to 10 minutes per clip; 6 in flight works for video too.
- Check loops by measuring, not by eye: sample the clip at 6 fps, take
  the mean absolute pixel difference between neighboring frames, then
  between the last frame and the first. A seam about the size of one
  normal step is invisible.
- Kling 3.0 fails, with no reason given, when the start and end frame are
  the same image. Kling 4.0 loops fine but refuses Elements in
  image-to-video mode ("Image-to-video requires images only"), so for
  loops the start frame carries the character. Failed jobs are refunded,
  and an identical second try can succeed (M07 did).
- Asked for a share of the frame ("45 percent of the frame height"), Nano
  Banana Pro fills about three quarters of it. "Wide shot with a lot of
  empty space" plus explicit proportions gives real headroom.
- Asked to scuttle "in place", Kling paced right and left across the
  frame. "A walk cycle on the spot" with "his body stays exactly in the
  center and never travels left or right", at 4 s, held him within 1
  percent of center.
- Higgsfield's video background remover returns an ordinary MP4 on black,
  not video with alpha, and drops dark parts inside the subject (Snap's
  eyes). Rebuild the matte from the grey original with
  `tools/snap-matte.py`.
