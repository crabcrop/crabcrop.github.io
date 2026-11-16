// The lay of the world: the ground under it, the path the camera takes down through it,
// the eight zones, and how the water looks at each depth. Everything else is placed by
// asking this file. y is up and the surface is y = 0; the dive heads down the -z axis.
//
// The world is an open sea floor that steps down in terraces (pier, shallows, kelp, reef,
// the wreck's ledge), falls away in a drop-off, and ends on the black plain where the vents
// are: bright open water on every side, as in the pictures of the dive this rebuilds.
import { clamp, fbm2, lerp, noise2, ridge3, smooth } from './math.js';

// ---- the ground ------------------------------------------------------------------------

// The floor of the valley along its centre line: [z, y], going down. Between two entries
// it eases; the cliff is the short step from -268 to -277.
const FLOOR = [
  [60, -1.0], [30, -3.2], [8, -5.6], [-12, -7.0], [-44, -8.6], [-62, -13.0], [-84, -17.5], [-106, -19.5],
  [-124, -26.5], [-150, -31.0], [-178, -33.5], [-202, -47.0], [-226, -57.0], [-252, -60.0], [-268, -62.5],
  [-277, -199.0], [-292, -205.0], [-330, -207.5], [-400, -208.5], [-430, -205.0], [-470, -150.0],
];
// Half the width of the valley floor, and how high its walls go, along z: [z, half width, wall].
// (the third column is how high the low dunes at the sides rise)
const VALLEY = [
  [60, 16, 0.8], [10, 15, 1.0], [-30, 17, 1.2], [-60, 15, 1.4], [-110, 16, 1.4], [-150, 19, 1.0], [-200, 15, 1.2],
  [-250, 19, 1.4], [-272, 22, 1.0], [-300, 24, 1.6], [-360, 21, 1.8], [-420, 18, 1.8], [-470, 14, 1.6],
];
function table(rows, z, col) {
  if (z >= rows[0][0]) return rows[0][col];
  for (let i = 1; i < rows.length; i++) {
    if (z >= rows[i][0]) {
      const a = rows[i - 1], b = rows[i], t = (a[0] - z) / (a[0] - b[0]);
      return lerp(a[col], b[col], t * t * (3 - 2 * t));
    }
  }
  return rows[rows.length - 1][col];
}
// The centre line wanders a little from side to side.
export const centerX = (z) => 5.5 * Math.sin(z * 0.021 + 0.4) + 2.5 * Math.sin(z * 0.047 + 2.0);
export const floorY = (z) => table(FLOOR, z, 1);
export const halfWidth = (z) => table(VALLEY, z, 1);
// How rocky the ground is at z, 0 (sand) to 1 (bare rock): sand in the shallows and among
// the kelp, more rock on the reef and the ledge, all rock on the cliff and at the vents.
export const rockiness = (z) => (z > -262 ? 0.04 : 0.3);

// The height of the ground at (x, z).
export function groundY(x, z) {
  const base = floorY(z), w = halfWidth(z), wall = table(VALLEY, z, 2);
  const off = Math.abs(x - centerX(z));
  // the sides: the floor rolls into low dunes and goes on, open, into the blue
  const out = Math.max(off - w, 0);
  const rise = wall * (1 - Math.exp(-out * 0.16)) + out * 0.025;
  // a shallow bowl across the floor, so it is not a flat street
  const bowl = 0.9 * smooth(0.25 * w, w, off);
  const rock = rockiness(z);
  const rough = Math.min(1, rock + smooth(0, 6, out));
  const big = fbm2(x * 0.035 + 3.1, z * 0.035, 4) * (1.0 + 1.6 * rough);
  const mid = (ridge3(x * 0.11, z * 0.11, 1.7, 3) - 0.45) * 1.2 * rough;
  const dunes = Math.sin(z * 0.19 + x * 0.05 + 2.0 * noise2(x * 0.05, z * 0.05)) * 0.28 * (1 - rough);
  return base + rise + bowl + big + mid + dunes;
}

// ---- the zones -------------------------------------------------------------------------

export const ZONES = [
  { id: 's0', name: 'The Marina', depth: 0 },
  { id: 's1', name: 'The Shallows', depth: -5 },
  { id: 's2', name: 'The Kelp Forest', depth: -15 },
  { id: 's3', name: 'The Coral Reef', depth: -30 },
  { id: 's4', name: 'The Shipwreck', depth: -60 },
  { id: 's5', name: 'The Twilight Zone', depth: -500 },
  { id: 's6', name: 'The Vents', depth: -2500 },
  { id: 's7', name: 'Back to the Surface', depth: 0 },
];

// ---- the camera's path -----------------------------------------------------------------

// Where the camera is at p, the dive's one coordinate: its whole part is the zone (0 to 7)
// and the rest is how far through that zone. Each row: p, z, x off the centre line, y
// (a number is a height above the ground when `up` is true, else an absolute depth), then
// where it looks: yaw in degrees (0 faces down the valley, positive to the right) and
// pitch (positive up).
const P = (p, z, off, y, up, yaw, pitch) => ({ p, z, off, y, up, yaw, pitch });
const STOPS = [
  // the marina from the waterline, half above and half below; then under, beneath the pier
  P(0.0, 18, 0, 0.0, false, 0, -3), P(0.28, 15, 0, 0.0, false, -2, -4), P(0.55, 9, -0.6, -1.6, false, -3, 2), P(1.0, -8, 0.6, -3.7, false, 5, 2),
  // the shallows: down the chain to the anchor, then over the sand
  P(1.3, -18, -1.2, 2.6, true, 6, -8), P(1.65, -31, 1.0, 2.1, true, -5, -5), P(2.0, -48, 0, 2.4, true, 0, -2),
  // the kelp forest
  P(2.3, -64, 2.5, 3.0, true, -8, 4), P(2.6, -82, -2.0, 3.6, true, 7, 9), P(2.85, -98, 2.0, 3.4, true, -5, 3), P(3.0, -112, 0, 3.0, true, 0, -6),
  // the reef, and the giant clam at its far end
  P(3.3, -130, -3.0, 2.8, true, 9, -7), P(3.6, -148, 3.5, 2.5, true, -9, -8), P(3.82, -164, -1.5, 2.6, true, 16, -4), P(4.0, -182, 1.0, 3.4, true, -3, -9),
  // the wreck on its ledge: over its stern, then alongside, and a look into the captain's
  // cabin through the hole in its side while the visitor makes the last choice (Snap swims
  // in ahead of the camera); out again, past the bow, to the edge
  P(4.25, -204, 4.0, 5.0, true, -10, -12), P(4.4, -228, 7.0, -53.4, false, -62, -5),
  P(4.5, -234.6, 3.15, -54.3, false, -82, -3), P(4.56, -234.9, 0.55, -54.3, false, -82, -4), P(4.63, -235.0, 0.45, -54.3, false, -84, -4),
  P(4.71, -237, 5.0, -54.2, false, -70, -3), P(4.82, -244, 8.0, 3.6, true, -34, -3), P(5.0, -264, 2.0, 4.2, true, -4, -20),
  // off the edge and down the wall, into the dark
  P(5.2, -284, 0, -66, false, 18, -24), P(5.45, -293, 1.0, -98, false, 38, -14), P(5.7, -295, 1.0, -134, false, 46, -8), P(5.9, -294, 0, -168, false, 30, -14), P(6.0, -297, 0, -193, false, 8, -16),
  // the vents, and the geode at the end
  P(6.25, -314, -2.0, 4.6, true, 8, -8), P(6.5, -338, -4.0, 4.0, true, 12, -5), P(6.75, -362, 3.0, 3.6, true, -10, -4), P(6.9, -377, 1.5, 3.4, true, -4, -8), P(7.0, -383, 0.5, 2.9, true, 3, -7),
  // straight up, and the surface again
  P(7.15, -387, 0.5, -172, false, 0, 34), P(7.35, -388, 0.5, -96, false, 0, 52), P(7.55, -388, 0.5, -30, false, 0, 44), P(7.72, -390, 0.5, -6.5, false, 0, 22),
  // at the waterline again for the last stretch: the marina at sunset above, the cast below
  P(7.85, -393, 0.5, 0.0, false, 0, 1), P(8.0, -396, 0.5, 0.0, false, 0, -3),
];
for (const s of STOPS) {
  s.x = centerX(s.z) + s.off;
  s.wy = s.up ? groundY(s.x, s.z) + s.y : s.y;
}
export const P_MAX = 8;

// Catmull-Rom through the stops, with their p as the knots. out: [x, y, z, yaw, pitch].
let seg = 0;
export function pathAt(p, out) {
  p = clamp(p, 0, P_MAX);
  if (p < STOPS[seg].p) seg = 0;
  while (seg < STOPS.length - 2 && p > STOPS[seg + 1].p) seg++;
  const a = STOPS[seg], b = STOPS[seg + 1], a0 = STOPS[Math.max(seg - 1, 0)], b1 = STOPS[Math.min(seg + 2, STOPS.length - 1)];
  const h = b.p - a.p, t = (p - a.p) / h, t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  const da = b.p - a0.p || 1, db = b1.p - a.p || 1;
  const f = (ka, kb, k0, k1) => h00 * ka + h10 * h * ((kb - k0) / da) + h01 * kb + h11 * h * ((k1 - ka) / db);
  out[0] = f(a.x, b.x, a0.x, b1.x);
  // height without overshoot (monotone between the stops: where the dive rises or falls
  // sharply next to a level stretch, the plain curve would dip or bulge past the stops)
  const s0 = (a.wy - a0.wy) / (a.p - a0.p || 1), s1 = (b.wy - a.wy) / h, s2 = (b1.wy - b.wy) / (b1.p - b.p || 1);
  const lim = (m, l, r) => (l * r <= 0 ? 0 : Math.sign(m) * Math.min(Math.abs(m), 3 * Math.min(Math.abs(l), Math.abs(r))));
  const m0 = lim((b.wy - a0.wy) / da, seg === 0 ? s1 : s0, s1), m1 = lim((b1.wy - a.wy) / db, s1, seg >= STOPS.length - 2 ? s1 : s2);
  out[1] = h00 * a.wy + h10 * h * m0 + h01 * b.wy + h11 * h * m1;
  out[2] = f(a.z, b.z, a0.z, b1.z);
  // (at the start and the end the camera sits on the waterline: the curve would lift it a
  // little, and from above the water the view's lower half is lost)
  if ((p < 0.3 || p > 7.84) && out[1] > 0) out[1] = 0;
  out[3] = f(a.yaw, b.yaw, a0.yaw, b1.yaw);
  out[4] = f(a.pitch, b.pitch, a0.pitch, b1.pitch);
  return out;
}

// The path, sampled once, for keeping the camera's way clear when things are planted.
export const TRACK = new Float32Array(801 * 3);
{
  const o = [0, 0, 0, 0, 0];
  for (let i = 0; i <= 800; i++) { pathAt(i / 100, o); TRACK[i * 3] = o[0]; TRACK[i * 3 + 1] = o[1]; TRACK[i * 3 + 2] = o[2]; }
}
// How far a place is from the path: level if y is left out, else in space.
export function offTrack(x, z, y) {
  let best = 1e12;
  for (let i = 0; i < TRACK.length; i += 3) {
    const dx = TRACK[i] - x, dz = TRACK[i + 2] - z, dy = y === undefined ? 0 : TRACK[i + 1] - y;
    const d = dx * dx + dz * dz + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// Where the set pieces stand (sets.js), kept clear of plants: [x, z, radius]. The clam, the
// wreck (two circles along its length), the geode's halves and the helmet, the anchor.
export const CLEARINGS = [[4.7, -170.4, 3.6], [3.9, -236.5, 5.0], [4.7, -248.5, 5.0], [-4.13, -388.9, 2.5], [-6.38, -387.9, 0.8], [-0.6, -389.3, 1.7], [4.35, -24.5, 1.6]];
export const cleared = (x, z) => CLEARINGS.some(([cx, cz, r]) => (x - cx) * (x - cx) + (z - cz) * (z - cz) < r * r);

// ---- the water -------------------------------------------------------------------------

// Below the wreck's ledge the dive is far deeper than it is drawn (the vents are 2,500 m
// down in the story and 205 m down in the world). For light, a metre down there counts
// for more: this is how deep a drawn depth counts as, and how fast that grows. The bend
// between the two rates is rounded, so the light has no seam at the ledge.
export const KNEE = 60, DEEPER = 3.2;
const ROUND = 12;
export const optDepth = (d) => { const e = d - KNEE; return d + DEEPER * 0.5 * (Math.sqrt(e * e + ROUND * ROUND) + e); };
export const optSlope = (d) => { const e = d - KNEE; return 1 + DEEPER * 0.5 * (1 + e / Math.sqrt(e * e + ROUND * ROUND)); };

// Art direction by depth: [depth, the colour the water scatters (r, g, b), the colour of
// the light from above (r, g, b), exposure, how strong the sun's shafts are]. The physics
// (what depth and distance take out) is in shaders.js; this only tints it: greener among
// the kelp, bluer on the reef, and the eye opening up as the light goes.
const WATER = [
  [0, 0.11, 0.62, 0.78, 0.26, 0.66, 0.76, 0.42, 1.25],
  [8, 0.11, 0.62, 0.78, 0.26, 0.66, 0.76, 0.44, 1.25],
  [16, 0.08, 0.48, 0.50, 0.22, 0.58, 0.56, 0.48, 1.3],
  [32, 0.12, 0.60, 0.90, 0.24, 0.62, 0.80, 0.60, 1.15],
  [46, 0.08, 0.40, 0.56, 0.18, 0.48, 0.62, 0.60, 0.9],
  [58, 0.06, 0.30, 0.40, 0.14, 0.38, 0.52, 0.62, 0.7],
  [90, 0.12, 0.20, 0.50, 0.16, 0.30, 0.70, 0.95, 0.0],
  [130, 0.12, 0.13, 0.38, 0.16, 0.22, 0.62, 1.08, 0.0],
  [206, 0.10, 0.09, 0.28, 0.14, 0.18, 0.55, 1.08, 0.0],
];
// out: [scatter r, g, b, light r, g, b, exposure, shafts]
export function waterAt(depth, out) {
  const d = clamp(depth, 0, WATER[WATER.length - 1][0]);
  let i = 1;
  while (i < WATER.length - 1 && d > WATER[i][0]) i++;
  const a = WATER[i - 1], b = WATER[i], t = smooth(a[0], b[0], d);
  for (let k = 0; k < 8; k++) out[k] = lerp(a[k + 1], b[k + 1], t);
  return out;
}

// The box the sun's shadows are kept for: the sunlit part of the dive. [x0, x1, y0, y1, z0, z1]
export const SHADOW_BOX = [-64, 64, -72, 3, -284, 62];

// The story's depth in metres at p, for the gauge: the zones' own depths, eased between.
export function storyDepth(p) {
  const i = clamp(Math.floor(p), 0, 7), t = p - i;
  const a = ZONES[i].depth, b = ZONES[Math.min(i + 1, 7)].depth;
  return lerp(a, b, t * t * (3 - 2 * t));
}

// The sun, as the direction light travels toward (so the sun is at -SUN), once bent by
// the surface. High, and a little behind the camera's right shoulder: tops are lit, faces
// toward the camera get some, and the shafts come down nearly straight, leaning into view.
export const SUN = [-0.22, -0.92, -0.32];
{
  const l = Math.hypot(SUN[0], SUN[1], SUN[2]);
  SUN[0] /= l; SUN[1] /= l; SUN[2] /= l;
}
