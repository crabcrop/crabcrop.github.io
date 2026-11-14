// What the first view's early requests (early() in main.ts, which asks for
// the world's first files as soon as the text has painted) must agree on
// with the world's own loading (world/index.ts, world/backdrop.ts,
// world/snap3d.ts): both read these numbers, so the files asked for early
// are the files the world then uses.

/** The sharpest the world draws, in device pixels per CSS pixel. */
export const MAX_DPR = 2;
/** A plate covers the view this much over a plain cover fit, and the next width up is taken only past this share of it. */
export const PLATE_OVER = 1.12;
export const PLATE_SLACK = 0.85;
/** Snap's height on the chain, in viewport heights: on a wide screen, on a phone. */
export const SNAP_TALL = { wide: 0.26, phone: 0.2 };
/**
 * Drawn taller than this (device pixels) he gets his 2048 px texture. Up to
 * here the 1024 px one shows all there is to see: it still has a texel or
 * more for every pixel over 98 percent of him. (At 470 px a quarter of him
 * would have less, and he looks a little soft beside the full texture.)
 */
export const SNAP_SHARP = 300;
/** A phone's layout: taller than wide, or narrow. */
export const PHONE = { ratio: 1.05, width: 640 };
