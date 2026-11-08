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

## Credits

Phase A and B together: **47 credits** (estimate was about 85). Balance
after: 3,563.

## Next

Phase C: zone plates Z1 to Z7 with `snap-world` as the style reference,
desktop first, then phone.

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
