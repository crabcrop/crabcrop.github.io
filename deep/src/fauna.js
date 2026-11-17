// The creatures, crocheted, and what drifts in the water: schools of little stitched fish in
// the marina, the shallows, the kelp and on the reef; a sea turtle gliding over the reef; the
// pink octopus at its desk in the wreck's cabin, holding the letter; glowing jellies, a
// siphonophore, an anglerfish and a bottle with a message in the twilight; tube worms and sea
// sheep at the vents; fish overhead on the way back up; gulls over the marina; the turtle and
// the octopus again below the surface at the end; specks and bubbles everywhere.
//
// Nothing is simulated. Each creature is a closed-form function of the time and of its own
// handful of numbers, worked out in its vertex shader. A school of fish swims round a wide
// loop where the camera will look: every fish has its own place in the school, a body length
// from the next, all head the same way and wag their tails. Jellies hang where they live,
// pulsing and bobbing. Whatever moves keeps clear of Snap and his submarine (G.snapAt,
// G.subAt): it is moved aside, smoothly, as far as it must; and where it lives was chosen
// (against the cast's whole way down) so that the way aside is always the same way, and so
// that at the moments the visitor stops at, nothing crowds the cast, the page's header or
// the words.
//
// A few creatures belong to a moment of the dive: the turtle over the reef, the siphonophore,
// the anglerfish and the bottle in the twilight, the octopus in the cabin, the turtle and the
// octopus at the end. While the visitor is at that moment each keeps its place in the view (it swims
// along), and before and after it stays where it was in the water; their parts move in their
// shaders: flippers beat, tentacles curl, wings flap.
//
// Every one of them is an amigurumi built as Snap is (amigurumi.js): plush round shapes, fins,
// flippers and arms as fat stuffed ones, single crochet in his yarn with its rows worked round
// the body, big glossy bead eyes in rings of white felt, a stitched smile and pink felt cheeks;
// the gulls are felt. Small things are kept from sparkling: a fish too small on screen
// dissolves into the water behind it, and a speck is never drawn narrower than about a
// pixel: below that it is drawn that wide and dimmer, so it carries the same light.
//
// They answer the visitor's hand (G.hand): fish dart away from it, and tube worms pull their
// plumes in when it comes near (and when the submarine settles by them), and slowly put them
// out again. And they tell the page's hands-on layer where they are, every frame (spots).
import { SUB_DRIFT } from './cast.js';
import {
  BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, InstancedInterleavedBuffer, InterleavedBufferAttribute, Mesh as ThreeMesh, Sphere, Vector3, Vector4,
} from 'three/webgpu';
import {
  abs, atan, attribute, cameraPosition, clamp, cos, cross, dFdx, dFdy, dot, exp, float, floor, fract, fwidth, int, length, max, min, mix, normalize,
  pow, sign, sin, smoothstep, sqrt, step, texture, uniform, uniformArray, varyingProperty, vec2, vec3, vec4, select,
} from 'three/tsl';
import {
  STITCH, arc, ball, crochet, eyes, felt, inWorld, knit, lin, orient, pillow, plump, ringAt, rounds, sew, spot, stitches, toLin, tubes, yarnFor,
} from './amigurumi.js';
import { SLOTS as CAST_SLOTS, TRACK, centerX, groundY, mooringAt, offTrack, pathAt, rideU, rideWeight } from './layout.js';
import { Mesh, TAU, blob, clamp as clampN, lerp, makeRng, noise3, smooth, tube } from './math.js';
import { G, SIG, material, scatter, skyAt, sunAt, sunFoot, vNrm } from './shaders.js';
import { rockSurf } from './terrain.js';

// Set every frame: how many metres one pixel spans one metre from the eye, and the eye's
// right, up and forward, and the tangent of half its view's height, for what is drawn as a
// card that faces it and for what answers the hand on the screen.
// And a soft fill on the fish from the eye's side, for the way back up, where they are seen
// from below against the bright surface (as a diorama is lit for its picture).
const U = { pix: uniform(0.002), right: uniform(new Vector3(1, 0, 0)), up: uniform(new Vector3(0, 1, 0)), fwd: uniform(new Vector3(0, 0, -1)), tanV: uniform(0.55), fill: uniform(0) };
const UP = vec3(0.0, 1.0, 0.0);
const one = (x, k) => float(1.0).sub(step(0.5, abs(x.sub(k))));      // 1 where x is k
// (a pixel's width in shape units, for lines drawn on a shape)
const pixel = (q) => max(length(vec2(fwidth(q.x), fwidth(q.y))).mul(0.7), 1e-5);

// ---- keeping clear of the cast --------------------------------------------------------------

// A rounded max: max(a, b), eased over k where they are close, so a push starts gently.
const smax = (a, b, k) => { const h = max(float(k).sub(abs(a.sub(b))), 0.0).div(k); return max(a, b).add(h.mul(h).mul(k * 0.25)); };
// How far to move something whose middle is at c so that it keeps `need` from `at`: straight
// away from it.
function awayFrom(c, at, need) {
  const d = c.sub(at).toVar(), r = max(length(d), 1e-3);
  return d.mul(smax(r, need, 0.5).div(r).sub(1.0));
}
// The same for a thing that hangs (a jelly: from `top` above c down to `low` below it): it is
// moved level, as far as it must at the height where it comes nearest. (Where jellies live
// was chosen so that this never asks for much, and never from straight below or above.)
function levelFrom(c, top, low, at, need) {
  const v = clamp(at.y, c.y.sub(low), c.y.add(top)).sub(at.y);
  const dh = vec2(c.x.sub(at.x), c.z.sub(at.z)).toVar(), h = max(length(dh), 1e-3);
  const hn = sqrt(max(need.mul(need).sub(v.mul(v)), 0.0));
  const k = smax(h, hn, 0.7).div(h).sub(1.0);
  return vec3(dh.x.mul(k), 0.0, dh.y.mul(k));
}

// ---- light on a speck ------------------------------------------------------------------------

// What lights a thing too small to have a side: the sun as it comes down through the
// caustics' net, the lamp, the glows. (These run per vertex, where a texture is read at a
// level chosen here; the lamp and the glows are as shadeLit has them.)
function causticAt(w) {
  const q = sunFoot(w);
  const lod = min(max(w.y.negate(), 0.0).mul(0.16), 6.0);
  const a = texture(G.waterTex, q.div(4.3)).level(lod).r;
  const b = texture(G.waterTex, q.yx.div(9.1).add(0.37)).level(lod).r;
  return min(a.mul(b.mul(1.5).add(0.5)), 1.6);
}
function lampAt(w) {
  const toL0 = G.lampPos.sub(w);
  const dl = length(toL0);
  const cone = smoothstep(G.lampCol.w, mix(G.lampCol.w, 1.0, 0.75), dot(toL0.div(dl).negate(), G.lampDir));
  return G.lampCol.rgb.mul(cone).mul(exp(SIG.mul(dl).negate())).div(dl.mul(dl).mul(0.012).add(1.0));
}
function glowsAt(w) {
  let sum = vec3(0.0);
  for (let i = 0; i < 4; i++) {
    const gp = G.glowPos.element(i);
    const f = max(float(1.0).sub(length(gp.xyz.sub(w)).div(gp.w)), 0.0);
    sum = sum.add(G.glowCol.element(i).rgb.mul(f.mul(f)));
  }
  return sum;
}

// ---- building shapes -------------------------------------------------------------------------

// Many cards, one per copy: a square from -1 to 1 that the vertex step turns to the eye.
function cards(n, attrs, sphere) {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  for (const [name, data] of Object.entries(attrs)) g.setAttribute(name, data.isBufferAttribute || data.isInterleavedBufferAttribute ? data : new InstancedBufferAttribute(data, 4));
  g.instanceCount = n;
  g.boundingSphere = sphere;
  return g;
}
// Copies of a base shape, with per-copy numbers.
function copies(base, n, attrs, sphere) {
  const g = new InstancedBufferGeometry();
  g.setIndex(base.index);
  for (const k of ['position', 'normal', 'aux']) if (base.getAttribute(k)) g.setAttribute(k, base.getAttribute(k));
  for (const [name, data] of Object.entries(attrs)) g.setAttribute(name, data.isBufferAttribute || data.isInterleavedBufferAttribute ? data : new InstancedBufferAttribute(data, 4));
  g.instanceCount = n;
  g.boundingSphere = sphere;
  return g;
}
const solid = (geo, mat) => { const m = new ThreeMesh(geo, mat); m.matrixAutoUpdate = false; m.userData.fauna = true; return m; };
// A sphere round boxes [x0, x1, y0, y1, z0, z1].
function sphereOf(boxes) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const b of boxes) { x0 = Math.min(x0, b[0]); x1 = Math.max(x1, b[1]); y0 = Math.min(y0, b[2]); y1 = Math.max(y1, b[3]); z0 = Math.min(z0, b[4]); z1 = Math.max(z1, b[5]); }
  return new Sphere(new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 0.5);
}
// ---- where the camera looks, and where the cast is -----------------------------------------

const DEG = Math.PI / 180, _o = [0, 0, 0, 0, 0];
const camHolder = () => ({ x: 0, y: 0, z: 0, F: [0, 0, 0], R: [0, 0, 0], U: [0, 0, 0], L: [0, 0, 0] });
const _cA = camHolder(), _cB = camHolder();
// The camera at p as its path has it (without the visitor's nudge): where it is, its line of
// sight F, its right R, its up U (with its pitch) and its level forward L.
function camAt(p, c = camHolder(), turn = 0) {
  pathAt(p, _o);
  const yaw = (_o[3] + turn) * DEG, pitch = _o[4] * DEG, sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
  c.x = _o[0]; c.y = _o[1]; c.z = _o[2];
  c.F[0] = sy * cp; c.F[1] = sp; c.F[2] = -cy * cp;
  c.R[0] = cy; c.R[1] = 0; c.R[2] = sy;
  c.U[0] = -sy * sp; c.U[1] = cp; c.U[2] = cy * sp;
  c.L[0] = sy; c.L[1] = 0; c.L[2] = -cy;
  return c;
}
// A point in the view of camera c: `fwd` along its line of sight, `right` and `up` across it.
function inViewAt(out, c, fwd, right, up) {
  out[0] = c.x + c.F[0] * fwd + c.R[0] * right + c.U[0] * up;
  out[1] = c.y + c.F[1] * fwd + c.R[1] * right + c.U[1] * up;
  out[2] = c.z + c.F[2] * fwd + c.R[2] * right + c.U[2] * up;
  return out;
}
// The point `d` along the line of sight that shows at (nx, ny) on the screen (-1..1 each way).
const onScreen = (out, c, d, nx, ny, tanV, aspect) => inViewAt(out, c, d, nx * d * tanV * aspect, ny * d * tanV);
// Where a point shows on the screen of camera c: (x, y, how far along the line of sight).
function project(c, x, y, z, scr, out) {
  const dx = x - c.x, dy = y - c.y, dz = z - c.z;
  const f = dx * c.F[0] + dy * c.F[1] + dz * c.F[2], r = dx * c.R[0] + dz * c.R[2], u = dx * c.U[0] + dy * c.U[1] + dz * c.U[2];
  out[0] = r / (Math.max(f, 1e-3) * scr.tanV * scr.aspect); out[1] = u / (Math.max(f, 1e-3) * scr.tanV); out[2] = f;
  return out;
}
// The two shapes of screen the dive is laid out for: a wide one, with the words on its left
// third, and a phone's, with the words at the bottom; where the page's header ends on each.
const SCREENS = { wide: { tanV: Math.tan(29 * DEG), aspect: 16 / 9, top: 0.8, kind: 'wide' }, tall: { tanV: Math.tan(37 * DEG), aspect: 390 / 844, top: 0.72, kind: 'tall' } };
// Where the cast holds the submarine and Snap in the view (cast.js SLOT): forward, right, up;
// and, on a wide screen, how the submarine's place moves from beat to beat in the deep
// (cast.js SUB_DRIFT: [from p, to p, forward, right, up] added, eased in and out), and aside
// at the geode. (These copy cast.js: they are only used to choose, once, where creatures live
// so that they are clear of the cast at the moments the visitor stops at; what moves keeps
// clear of the cast where it really is, G.subAt and G.snapAt, in its shader.)
const SUB_SLOT = { wide: CAST_SLOTS.wide.sub, tall: CAST_SLOTS.tall.sub }, SNAP_SLOT = { wide: CAST_SLOTS.wide.snap, tall: CAST_SLOTS.tall.snap };

const SUB_FROM = 4.82, SNAP_IN = 4.93;
function subSlot(p, kind, out = [0, 0, 0]) {
  const s = SUB_SLOT[kind], geode = smooth(6.8, 6.87, p) * (1 - smooth(7.04, 7.1, p));
  out[0] = s[0]; out[1] = s[1]; out[2] = s[2];
  if (kind === 'wide') {
    for (const d of SUB_DRIFT) { const k = smooth(d[0], d[0] + 0.06, p) * (1 - smooth(d[1] - 0.06, d[1], p)); out[0] += d[2] * k; out[1] += d[3] * k; out[2] += d[4] * k; }
    out[1] += 0.75 * geode; out[2] += 0.1 * geode;
  } else { out[0] += 0.5 * geode; out[2] += 1.05 * geode; }
  return out;
}
const _slot = [0, 0, 0];
// Snap's middle at p on a screen, as the cast places him (near enough: on the anchor chain he
// is a little off it), and the submarine's, from when it has come.
function snapAt(p, kind, out) {
  const c = camAt(p, _cB), s = SNAP_SLOT[kind], k = smooth(4.49, 4.55, p) * (1 - smooth(4.63, 4.69, p));
  if (p >= SNAP_IN) subSlot(p, kind, _slot); else { _slot[0] = s[0] * (1 - 0.32 * k); _slot[1] = s[1]; _slot[2] = s[2]; }
  inViewAt(out, c, _slot[0], _slot[1], _slot[2]);
  if (p < 0.2) out[1] = lerp(0, out[1], smooth(0.075, 0.2, p));
  // (down the mooring's chain he is on it, on any screen)
  const w = rideWeight(p);
  if (w > 0) { mooringAt(rideU(p), _ride); out[0] = lerp(out[0], _ride[0], w); out[1] = lerp(out[1], _ride[1] - 0.12, w); out[2] = lerp(out[2], _ride[2], w); }
  return out;
}
const _ride = [0, 0, 0];
// (it never touches the ground, nor rises within a metre of the surface)
const subAt = (p, kind, out) => {
  subSlot(p, kind, _slot);
  inViewAt(out, camAt(p, _cB), _slot[0], _slot[1], _slot[2]);
  out[1] = Math.min(Math.max(out[1], groundY(out[0], out[2]) + 0.95), -1.0);
  return out;
};

// The moments a creature belongs to, and where it is in the view then. Each writes into o:
// c its middle, f the way it faces (level unless said), and for the siphonophore d its
// length's direction and len its length. A screen is (tanV, aspect).
const SIPHON = [5.15, 5.86], ANGLER = [5.57, 5.79], BOTTLE = [5.36, 5.8], REEF_TURTLE = [3.08, 3.42], ENDING = [7.84, 8.0];
const dirOf = (o, x, y, z) => { const l = Math.hypot(x, y, z) || 1; o[0] = x / l; o[1] = y / l; o[2] = z / l; return o; };
// The siphonophore: it rises out of the dark below to meet the visitor as they go over the
// drop-off, goes down with them through the twilight, across the top of the view, drifting
// from right to left (rising a little to the right), and stays behind when they go on down.
// It is big and far, behind the jellies (k: how much bigger than the eight metres away it was
// drawn for). Above the drop-off it is not there at all (show: 0), so the sunlit water never
// has it.
function siphonAt(p, tanV, aspect, o) {
  const pc = clampN(p, SIPHON[0], SIPHON[1]), u = (pc - SIPHON[0]) / (SIPHON[1] - SIPHON[0]), wide = aspect >= 1, c = camAt(pc, _cA);
  const d = wide ? 17 - 1.5 * u : 15.5 - 1.2 * u;
  onScreen(o.c, c, d, wide ? 0.1 - 0.2 * u : 0.0, wide ? 0.42 : 0.4, tanV, aspect);
  if (p < SIPHON[0]) o.c[1] -= Math.min(SIPHON[0] - p, 0.2) * 50;
  o.show = smooth(5.02, 5.1, p);
  dirOf(o.d, c.R[0], 0.12, c.R[2]);
  dirOf(o.f, c.L[0], 0, c.L[2]);
  o.k = d / 8.5;
  o.len = (wide ? 12 : 9) * o.k;
  return o;
}
// The anglerfish: the twilight's close-up. While the visitor is at it, it is near and large
// (with its fins more than a third of the view's height), three-quarters on, heading left, lit
// by nothing but its lure: on a wide screen low in the right two-thirds, clear of the words, in
// front of the submarine and below it (the submarine keeps back then: cast.js); on a phone,
// where the submarine fills the middle of the view, close in front of its hull on the right, its
// lure toward Snap's bubble, above the words. Before, it is in the dark below, where
// the camera sinks to it; after, it stays as the camera goes on. (On a wide screen it comes up
// into its place as the submarine draws back, and swims off down and to the left as it comes
// forward again: SUB_DRIFT's third beat.)
function anglerAt(p, tanV, aspect, o) {
  const pc = clampN(p, ANGLER[0], ANGLER[1]), u = (pc - ANGLER[0]) / (ANGLER[1] - ANGLER[0]), wide = aspect >= 1, c = camAt(pc, _cA);
  onScreen(o.c, c, wide ? 2.9 : 2.4, wide ? 0.3 - 0.08 * u : 0.44 - 0.08 * u, wide ? -0.42 : 0.08, tanV, aspect);
  if (wide) {
    const d = SUB_DRIFT[2], back = smooth(d[0], d[0] + 0.06, pc) * (1 - smooth(d[1] - 0.06, d[1], pc)), off = smooth(0.5, 0.8, u);
    o.c[0] -= c.R[0] * 2.2 * off * (1 - back); o.c[2] -= c.R[2] * 2.2 * off * (1 - back);
    o.c[1] -= 2.6 * (1 - back);
  }
  dirOf(o.f, -c.R[0] - 0.36 * c.L[0], 0, -c.R[2] - 0.36 * c.L[2]);
  o.size = wide ? 1.8 : 0.95;
  return o;
}
// The bottle with a message: small, drifting down through the twilight with the visitor,
// tumbling slowly; up and to the left of the angler, clear of the submarine and of the words.
function bottleAt(p, tanV, aspect, o) {
  const pc = clampN(p, BOTTLE[0], BOTTLE[1]), u = (pc - BOTTLE[0]) / (BOTTLE[1] - BOTTLE[0]), wide = aspect >= 1, c = camAt(pc, _cA);
  onScreen(o.c, c, wide ? 5.2 : 4.6, wide ? -0.13 + 0.04 * u : -0.5 + 0.04 * u, wide ? 0.2 - 0.06 * u : -0.5 - 0.04 * u, tanV, aspect);
  dirOf(o.f, 0.62 * c.R[0] + 0.72 * c.U[0] + 0.3 * c.L[0], 0.72 * c.U[1], 0.62 * c.R[2] + 0.72 * c.U[2] + 0.3 * c.L[2]);
  return o;
}
// The turtle over the reef: close and big in the middle of the view (the reef's first station
// frames it: the smart crop), heading left and toward the visitor, three-quarters on, so its face
// shows (and stays clear of the words), drifting on slowly; then it swims off, up and away, out
// of the view before the reef's next station (the school of seven).
function reefTurtleAt(p, tanV, aspect, o) {
  const pc = clampN(p, REEF_TURTLE[0], REEF_TURTLE[1]), u = (pc - REEF_TURTLE[0]) / (REEF_TURTLE[1] - REEF_TURTLE[0]), wide = aspect >= 1, c = camAt(pc, _cA);
  // (on a phone high in the view, between the bar and Snap, who keeps right and low meanwhile: cast.js)
  onScreen(o.c, c, wide ? 4.6 : 6.0, wide ? 0.2 - 0.12 * u : -0.04 - 0.06 * u, wide ? 0.18 : 0.46, tanV, aspect);
  dirOf(o.f, -0.75 * c.R[0] - 0.9 * c.L[0], -0.06, -0.75 * c.R[2] - 0.9 * c.L[2]);
  const off = smooth(REEF_TURTLE[1] - 0.05, REEF_TURTLE[1] + 0.08, p);
  if (off > 0) {
    const k = off * off * 10, ax = 0.5 * c.L[0] + 0.2 * c.R[0], az = 0.5 * c.L[2] + 0.2 * c.R[2];
    o.c[0] += ax * k; o.c[1] += 0.8 * k; o.c[2] += az * k;
    dirOf(o.f, lerp(o.f[0], ax, off), lerp(o.f[1], 0.55, off), lerp(o.f[2], az, off));
  }
  return o;
}
// The end: under the waterline, the turtle and the octopus, turned to the visitor, close and
// big: on a wide screen right of the submarine's pincer (and the print hung from it), the
// turtle looking back at the submarine, and the octopus further right; on a phone, where the
// words fill the view below the waterline, either side of the submarine at the surface, their
// heads just out.
function endingAt(p, tanV, aspect, turtle, octo) {
  // (on a phone the view turns a little left at the end, so the pier is in it: app.js)
  const pc = clampN(p, ENDING[0], ENDING[1]), wide = aspect >= 1, c = camAt(pc, _cA, wide ? 0 : -13 * smooth(7.84, 7.95, pc));
  // (`d` ahead, at nx across the screen, at a depth below the submarine, which stays a metre down)
  const put = (o, d, nx, y) => { inViewAt(o.c, c, 0, nx * d * tanV * aspect, 0); o.c[0] += c.L[0] * d; o.c[1] = y; o.c[2] += c.L[2] * d; };
  put(turtle, 4.8, wide ? 0.42 : -0.46, wide ? -2.0 : -0.28);
  put(octo, wide ? 5.0 : 5.6, wide ? 0.78 : 0.56, wide ? -2.3 : -0.42);
  // (turned to the visitor, so their faces show)
  const tr = wide ? -0.7 : 0.7;
  dirOf(turtle.f, tr * c.R[0] - 0.7 * c.L[0], 0, tr * c.R[2] - 0.7 * c.L[2]);
  dirOf(octo.f, 0.4 * c.R[0] - 0.9 * c.L[0], 0, 0.4 * c.R[2] - 0.9 * c.L[2]);
}

// How far a place is from the camera's way near p (within `w` of it): as offTrack, but only
// looking at that stretch of the way.
function nearTrack(p, w, x, y, z) {
  const i0 = Math.max(0, Math.floor((p - w) * 100)), i1 = Math.min(800, Math.ceil((p + w) * 100));
  let best = 1e12;
  for (let i = i0 * 3; i <= i1 * 3; i += 3) { const dx = TRACK[i] - x, dy = TRACK[i + 1] - y, dz = TRACK[i + 2] - z, d = dx * dx + dy * dy + dz * dz; if (d < best) best = d; }
  return Math.sqrt(best);
}
// The camera at p: where it is, its level forward and right, its pitch (for placing things
// where it will look).
function view(p) {
  pathAt(p, _o);
  const yaw = _o[3] * DEG;
  return { x: _o[0], y: _o[1], z: _o[2], fx: Math.sin(yaw), fz: -Math.cos(yaw), rx: Math.cos(yaw), rz: Math.sin(yaw), pitch: _o[4] };
}
// A place in front of the camera at p: `ahead` along its level forward, `side` to its right,
// `up` above it.
function inView(p, ahead, side, up) {
  const v = view(p);
  return [v.x + v.fx * ahead + v.rx * side, v.y + up, v.z + v.fz * ahead + v.rz * side];
}

// ---- fish ------------------------------------------------------------------------------------

// Each kind is grown one metre long, nose at x = 0.5, tail tip at -0.5, back up, its right
// side +z: a plump body of round rings, a tail, a fin along the back and one under the
// belly, a pair at the sides, two bead eyes. aux = (x, y, how high round the body from -1
// belly to 1 back, part: 0 body, 1 tail, 2 back and belly fins, 3 side fins, 4 eyes, 5 spikes).
//   h, w     half the height and width where it is deepest, `at` where that is (0 the nose,
//            1 the root of the tail); nose: how blunt (smaller is blunter); end: where the
//            body ends; ped: the root of the tail; tail: [half span, how deep the notch]
//   dorsal, anal: [from x, to x, height]; pect: [x, length, width]; eye: [x, y, radius]
const FISH = {
  round: { h: 0.24, w: 0.21, at: 0.36, nose: 0.4, end: -0.18, ped: 0.07, tail: [0.25, 0.3], dorsal: [0.12, -0.12, 0.13], anal: [-0.02, -0.14, 0.06], pect: [0.14, 0.17, 0.11], eye: [0.29, 0.08, 0.098], fin: 0.06 },
  tang: { h: 0.38, w: 0.13, at: 0.45, nose: 0.75, end: -0.2, ped: 0.08, tail: [0.22, 0.12], dorsal: [0.24, -0.18, 0.09], anal: [0.1, -0.18, 0.09], pect: [0.12, 0.17, 0.11], eye: [0.26, 0.115, 0.088], fin: 0.05, keel: 0.2 },
  long: { h: 0.17, w: 0.15, at: 0.34, nose: 0.5, end: -0.24, ped: 0.06, tail: [0.2, 0.45], dorsal: [0.16, -0.16, 0.08], anal: [0.0, -0.17, 0.05], pect: [0.18, 0.13, 0.08], eye: [0.35, 0.05, 0.078], fin: 0.05 },
  puffer: { h: 0.3, w: 0.29, at: 0.5, nose: 0.36, end: -0.14, ped: 0.08, tail: [0.2, 0.0], dorsal: [0.0, -0.12, 0.09], anal: null, pect: [0.1, 0.15, 0.12], eye: [0.27, 0.1, 0.098], fin: 0.06, spikes: 30 },
};
// Where a kind's eyes sit: (x, y, z out from the middle, radius), half sunk into the body.
function eyeOf(sp) {
  const p = sp.nose, q = (p * (1 - sp.at)) / sp.at, peak = Math.pow(sp.at, p) * Math.pow(1 - sp.at, q);
  const [ex, ey, er] = sp.eye, u = Math.min(Math.max((0.5 - ex) / (0.5 - sp.end), 0), 1);
  const b = (Math.pow(u, p) * Math.pow(1 - u, q)) / peak, k = u * u * u;
  const a = sp.h * b + sp.ped * k, w = sp.w * b + sp.ped * 0.7 * k, yc = 0.05 * sp.h * Math.sin(Math.PI * u);
  const sn = Math.min(Math.abs(ey - yc) / a, 0.95);
  const zs = w * Math.sqrt(1 - sn * sn) * (1 - (sp.keel ?? 0) * Math.pow(sn, 3));
  return [ex, ey, zs - er * 0.3, er];
}

// Each kind is grown one metre long, nose at x = 0.5, tail tip at -0.5, back up, its right
// side +z, as a toy fish is stuffed: a plump body, a fat tail, a stuffed fin along the back
// and one under the belly, a plump paddle at each side, two big bead eyes. aux = (x, y, how
// high round the body from -1 belly to 1 back, part: 0 body, 1 tail, 2 back and belly fins,
// 3 side fins, 4 eyes, 5 the puffer's soft spikes).
function fishShape(sp, lod) {
  const nr = [8, 10, 12][lod], ns = [8, 10, 12][lod], m = new Mesh(true), rng = makeRng(7);
  const p = sp.nose, q = (p * (1 - sp.at)) / sp.at, peak = Math.pow(sp.at, p) * Math.pow(1 - sp.at, q), E = sp.end;
  const prof = (u) => {
    const b = (Math.pow(u, p) * Math.pow(1 - u, q)) / peak, k = u * u * u;
    return [sp.h * b + sp.ped * k, sp.w * b + sp.ped * 0.7 * k, 0.05 * sp.h * Math.sin(Math.PI * u)];
  };
  const xAt = (u) => 0.5 - u * (0.5 - E), uAt = (x) => Math.min(Math.max((0.5 - x) / (0.5 - E), 0), 1);
  // the body: rings from the nose back (closer together at both ends), closed behind the root of the tail
  const i0 = m.i.length, base = m.count;
  m.grid(nr, ns, (s, t, o) => {
    const r = Math.round(t * ns), last = r === ns, u = last ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * r) / (ns - 1));
    const [a0, b0, yc] = prof(u), a = last ? 0 : a0, b = last ? 0 : b0, x = last ? xAt(1) - 0.03 : xAt(u);
    const ph = s * TAU - Math.PI / 2, sn = Math.sin(ph), cs = Math.cos(ph);
    o[0] = x; o[1] = yc + a * sn; o[2] = b * cs * (1 - (sp.keel ?? 0) * Math.pow(Math.abs(sn), 3)); o[3] = x; o[4] = o[1]; o[5] = sn; o[6] = 0;
  }, true);
  orient(m, i0, base, (x, y, z) => [0, y - prof(uAt(x))[2], z]);
  const th = sp.fin, yE = prof(1)[2];
  // the tail: a fat fan from the root, a soft notch in its edge, stuffed to its rim
  pillow(m, lod ? 6 : 4, lod ? 3 : 2, [0, 0, 1], 1, (s, t, o) => {
    const v = s * 2 - 1, span = lerp(sp.ped * 0.85, sp.tail[0], Math.pow(t, 0.6));
    o[0] = lerp(E + 0.05, -0.5 + sp.tail[1] * 0.12 * (1 - Math.abs(v)), t); o[1] = yE + v * span; o[2] = 0;
    o[3] = th * Math.sqrt(Math.max(1 - v * v, 0)) * (1.15 - 0.45 * Math.pow(t, 2));
  });
  // along the back and under the belly
  for (const [fin, dir] of [[sp.dorsal, 1], [sp.anal, -1]]) {
    if (!fin) continue;
    pillow(m, 5, 2, [0, 0, 1], 2, (s, t, o) => {
      const xb = lerp(fin[0], fin[1], s), [a, , yc] = prof(uAt(xb)), hgt = fin[2] * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.75)), 0.8);
      o[0] = xb - t * hgt * 0.4; o[1] = yc + dir * (a * 0.8 + t * hgt); o[2] = 0;
      o[3] = th * 0.95 * plump(s, t, 0.55);
    });
  }
  // a plump paddle at each side, behind the eye
  {
    const [px, pl, pw] = sp.pect, [a, b, yc] = prof(uAt(px));
    for (const side of [1, -1]) {
      const d = [-0.8, -0.15, side * 0.58], nn = [-d[2], 0, d[0]], ln = Math.hypot(...nn);
      pillow(m, 3, 3, [nn[0] / ln, nn[1] / ln, nn[2] / ln], 3, (s, t, o) => {
        const w = pw * Math.sqrt(Math.max(1 - Math.pow(t * 1.05 - 0.05, 2), 0)) * (1 - 0.25 * t);
        o[0] = px + d[0] * t * pl; o[1] = yc - a * 0.2 + d[1] * t * pl + (s - 0.5) * w; o[2] = side * b * 0.82 + d[2] * t * pl;
        o[3] = th * 1.1 * plump(s, t, 0.6);
      });
    }
  }
  // the puffer's spikes: soft round nubs, as a crocheted puffer has them
  for (let k = 0; k < (sp.spikes ?? 0); k++) {
    const u = rng.range(0.12, 0.85), ph = rng() * TAU, [a, b, yc] = prof(u), x = xAt(u);
    const y = yc + a * Math.sin(ph), z = b * Math.cos(ph), nx = 0.15, ny = Math.sin(ph) / a, nz = Math.cos(ph) / b, l = Math.hypot(nx, ny, nz);
    const len = 0.045 + 0.02 * rng(), dx = nx / l, dy = ny / l, dz = nz / l;
    tube(m, [[x - dx * 0.01, y - dy * 0.01, z - dz * 0.01, 0.03], [x + dx * len * 0.55, y + dy * len * 0.55, z + dz * len * 0.55, 0.022], [x + dx * len, y + dy * len, z + dz * len, 0.012]], 5, [0, 0, 5]);
  }
  // the eyes: big black beads, half sunk, one on each side
  const [ex, ey, ez, er] = eyeOf(sp);
  for (const side of [1, -1]) ball(m, ex, ey, side * ez, er, er, er, 3, 4);
  return m.build();
}

// Per fish (each four numbers):
//   fA  its school's middle (x, y, z), and how fast the school goes round its loop (radians a second)
//   fB  the loop's two radii, its turn about the vertical, how far it rises and falls
//   fC  the fish's place in the school: ahead, to the right, up (metres); its length
//   fD  its seed, tail wags a second, the school's phase on its loop, its pattern (0 plain,
//       1 a head of the second colour, 2 stripes, 3 a belly of the second colour)
//   fE, fF, fG   its body, second and fin colours (the stripes' rows in fE.w, the school's
//       radius in fF.w)
//   fH  where its eyes are on its shape (x, y, out, radius)
const fA = attribute('fA', 'vec4'), fB = attribute('fB', 'vec4'), fC = attribute('fC', 'vec4'), fD = attribute('fD', 'vec4');
const fE = attribute('fE', 'vec4'), fF = attribute('fF', 'vec4'), fG = attribute('fG', 'vec4'), fH = attribute('fH', 'vec4');
const vC1 = varyingProperty('vec4', 'v_fc1'), vC2 = varyingProperty('vec4', 'v_fc2'), vC3 = varyingProperty('vec4', 'v_fc3'), vInfo = varyingProperty('vec4', 'v_finfo');
const vFwd = varyingProperty('vec3', 'v_ffwd'), vUp = varyingProperty('vec3', 'v_fup'), vLoc = varyingProperty('vec3', 'v_floc'), vEye = varyingProperty('vec4', 'v_feye');

// Where a school's middle is at time t, and which way it heads.
function schoolAt(t) {
  const th = fA.w.mul(t).add(fD.z).toVar();
  const yaw = fB.z, cy = cos(yaw), sy = sin(yaw), ct = cos(th), st = sin(th);
  const ex = fB.x.mul(ct), ez = fB.y.mul(st), tx = fB.x.mul(st).negate(), tz = fB.y.mul(ct);
  const c = fA.xyz.add(vec3(ex.mul(cy).sub(ez.mul(sy)), fB.w.mul(sin(th.mul(2.0).add(yaw.mul(3.0)))), ex.mul(sy).add(ez.mul(cy))));
  const T = normalize(vec3(tx.mul(cy).sub(tz.mul(sy)), 0.0, tx.mul(sy).add(tz.mul(cy)))).mul(sign(fA.w));
  return { c, T };
}
// Where a fish is at time t: its place in its school, and a little wander of its own.
function fishAt(t, sc) {
  const s = fD.x, L = fC.w, N = vec3(sc.T.z.negate(), 0.0, sc.T.x);
  const wob = vec3(sin(t.mul(0.53).add(s.mul(40.0))), sin(t.mul(0.9).add(s.mul(23.0))).mul(0.7), cos(t.mul(0.47).add(s.mul(31.0)))).mul(L.mul(0.08));
  return sc.c.add(sc.T.mul(fC.x)).add(N.mul(fC.y)).add(vec3(0.0, fC.z, 0.0)).add(wob);
}

// How far the visitor's hand pushes a thing at P (world) of size L (metres) away on the screen:
// within a few of its own lengths of the hand (and never less than a tenth of the view's
// height), the nearer the more, straight away from it across the screen and a little back.
// Gives the push in the world and how strong it is (0..1).
function shy(P, L) {
  const rel = P.sub(cameraPosition), zc = max(dot(rel, U.fwd), 0.05).toVar(), k = zc.mul(U.tanV);
  const dh = vec2(dot(rel, U.right).div(k).sub(G.hand.x.mul(G.hand.w)), dot(rel, U.up).div(k).sub(G.hand.y)).toVar();
  const dd = length(dh), reach = clamp(L.div(k).mul(2.6), 0.2, 0.55);
  const push = max(reach.sub(dd), 0.0).mul(G.hand.z).mul(smoothstep(0.4, 1.0, zc)).toVar();
  const dir = dh.div(max(dd, 1e-3));
  return { by: U.right.mul(dir.x).add(U.up.mul(dir.y)).add(U.fwd.mul(0.35)).mul(push.mul(0.85).mul(k)), fear: push.div(reach) };
}

function fishMaterial() {
  return material({
    aux: true, shadow: false,
    vertex: (v) => {
      const t = G.time, s = fD.x, L = fC.w;
      const sc = schoolAt(t), sc0 = schoolAt(t.sub(0.1));
      // the school keeps clear of Snap and the submarine: all of it moves aside together
      const off = awayFrom(sc.c, G.snapAt.xyz, G.snapAt.w.add(fF.w).add(0.3)).add(awayFrom(sc.c, G.subAt.xyz, G.subAt.w.add(fF.w).add(0.4)));
      const at0 = fishAt(t, sc).add(off).toVar();
      // and each fish darts away from the visitor's hand, turning from it
      const away = shy(at0, L);
      const P0 = at0.add(away.by).toVar('fishP');
      const d = fishAt(t, sc).sub(fishAt(t.sub(0.1), sc0)).toVar();
      // it faces the way it goes, never steeper than about 30 degrees
      const hl = length(d.xz).add(1e-5);
      const go = normalize(vec3(d.x, clamp(d.y, hl.mul(-0.55), hl.mul(0.55)), d.z));
      const F = normalize(mix(go, normalize(away.by.add(go.mul(1e-3))), clamp(away.fear.mul(1.6), 0.0, 0.75))).toVar();
      const R = normalize(cross(F, UP)).toVar();
      const Up = cross(R, F).toVar();
      // it wags: the head barely, the tail most (harder as it darts)
      const lp = v.P.toVar(), ln = v.N.toVar();
      const u = clamp(float(0.45).sub(lp.x), 0.0, 1.0).toVar();
      const ph = t.mul(fD.y).mul(TAU).add(s.mul(40.0)).sub(u.mul(2.4)).toVar();
      const amp = u.mul(u).mul(0.16).add(0.008).mul(clamp(away.fear, 0.0, 1.0).add(1.0));
      const sw = sin(ph), cw = cos(ph);
      const slope = u.mul(0.32).mul(sw).sub(amp.mul(2.4).mul(cw)).negate();
      const lq = vec3(lp.x, lp.y, lp.z.add(amp.mul(sw)));
      const nq = vec3(ln.x.sub(slope.mul(ln.z)), ln.y, ln.z);
      v.P.assign(P0.add(F.mul(lq.x).add(Up.mul(lq.y)).add(R.mul(lq.z)).mul(L)));
      v.N.assign(normalize(F.mul(nq.x).add(Up.mul(nq.y)).add(R.mul(nq.z))));
      // too small on screen, or near the edge of what is drawn: it dissolves into the water behind it
      const dc = length(P0.sub(cameraPosition));
      const keep = smoothstep(2.2, 5.0, L.div(dc.mul(U.pix))).mul(float(1.0).sub(smoothstep(44.0, 60.0, dc)));
      vC1.assign(fE); vC2.assign(fF); vC3.assign(fG); vEye.assign(fH);
      vInfo.assign(vec4(L, fD.w, s, keep));
      vFwd.assign(F); vUp.assign(Up);
      // the stitches' own place: rows run round the body, stacked from nose to tail
      vLoc.assign(vec3(lp.y, lp.x, lp.z).mul(L).add(s.mul(3.1)));
    },
    surface: (s, f) => {
      const lx = f.aux.x, yn = f.aux.z, part = f.aux.w, q = f.obj;
      const pattern = vInfo.y, keep = vInfo.w;
      const body = float(1.0).sub(step(0.5, part)).toVar(), eye = one(part, 4);
      const n0 = s.n;
      // the body's colour, its second colour by pattern, the fins' colour
      const A = vC1.rgb, B = vC2.rgb;
      const second = one(pattern, 1).mul(smoothstep(0.14, 0.18, lx)).add(one(pattern, 3).mul(float(1.0).sub(smoothstep(-0.3, -0.12, yn)))).mul(body);
      const col = mix(mix(A, B, second), vC3.rgb, float(1.0).sub(body));
      const stripes = one(pattern, 2).mul(body);
      const F = normalize(vFwd), Up = normalize(vUp);
      knit(s, f, { color: col, color2: mix(col, B, stripes), stripe: max(vC1.w, 1.0), scale: STITCH, p: vLoc, frame: [Up, F, cross(F, Up)], k: 1.1 });
      // the face: the bead eyes in their felt rings; a little stitched smile toward the nose,
      // and a pink felt cheek under each eye
      const E = vEye, aa = pixel(q);
      eyes(s, q, n0, { at: [E.x, E.y, E.z, E.w], bead: eye, on: body, ring: 1.8 });
      const mx = min(E.x.add(0.13), 0.435), my = E.y.sub(0.09);
      const smile = arc(q.x.sub(mx), q.y.sub(my), float(0.042), float(0.026), float(0.009), aa).mul(body);
      const cheek = spot(q.x.sub(E.x.sub(0.055)), q.y.sub(E.y.sub(0.098)), E.w.mul(0.42), aa).mul(body).mul(float(1.0).sub(second.mul(0.6)));
      sew(s, n0, smile, cheek);
      const vv0 = normalize(cameraPosition.sub(f.w));
      s.emis = s.emis.add(s.albedo.mul(vec3(0.5, 0.75, 0.8)).mul(max(dot(s.n, vv0), 0.0).mul(0.6).add(0.4)).mul(U.fill));
      // dissolving: what would be seen through the fish is the water beyond it
      const vv = normalize(f.w.sub(cameraPosition));
      const beyond = scatter(vv, float(300.0)).sub(scatter(vv, f.dist)).mul(exp(SIG.mul(f.dist)));
      s.albedo = s.albedo.mul(keep); s.spec = s.spec.mul(keep);
      s.emis = s.emis.mul(keep).add(beyond.mul(keep.oneMinus()));
    },
  });
}

// Colours, warm and saturated as the pictures have them.
const COL = {
  yellow: [0.98, 0.78, 0.12], orange: [0.98, 0.5, 0.14], coral: [0.96, 0.44, 0.38], pink: [0.95, 0.56, 0.62],
  cream: [0.95, 0.88, 0.74], sand: [0.88, 0.76, 0.58], teal: [0.1, 0.6, 0.62], aqua: [0.36, 0.78, 0.8], blue: [0.24, 0.42, 0.82],
  mint: [0.55, 0.85, 0.66], grey: [0.55, 0.58, 0.62],
};
// The fish a school may have: [shape, pattern, body, second, fins].
const KINDS = {
  pastel: [['round', 1, 'blue', 'yellow', 'yellow'], ['round', 2, 'cream', 'blue', 'yellow'], ['round', 1, 'pink', 'yellow', 'yellow'], ['round', 3, 'aqua', 'cream', 'coral'], ['round', 2, 'grey', 'coral', 'coral'], ['long', 2, 'mint', 'cream', 'orange'], ['round', 0, 'coral', 'coral', 'yellow']],
  reefY: [['tang', 0, 'yellow', 'yellow', 'yellow']],
  reefT: [['round', 0, 'teal', 'teal', 'teal'], ['round', 3, 'teal', 'aqua', 'teal']],
  striped: [['long', 2, 'teal', 'cream', 'teal'], ['long', 2, 'cream', 'teal', 'teal']],
  puffer: [['puffer', 3, 'orange', 'sand', 'sand']],
  kelp: [['round', 1, 'orange', 'yellow', 'yellow'], ['long', 2, 'yellow', 'orange', 'orange'], ['round', 3, 'coral', 'cream', 'yellow']],
  // (seen from below on the way up: pale bellies)
  ascent: [['round', 3, 'blue', 'cream', 'yellow'], ['round', 3, 'teal', 'cream', 'coral'], ['long', 3, 'coral', 'cream', 'yellow'], ['round', 3, 'yellow', 'cream', 'orange']],
};

// The schools, each where the camera looks at p: `ahead` and `side` (metres, along its level
// forward and to its right) and `up`; how many (on high), which kinds, the loop's radii (across
// and along), its turn, how far it rises and falls, seconds a lap (negative: the other way
// round), the fish's length. (Each is then moved, if it must, until its whole loop keeps clear
// of the camera's way and of Snap's: see populate.)
function groups() {
  const S = (mesh, p, ahead, side, up, n, kinds, r, yaw, h, period, size, wag = 1.6) => ({ mesh, p, ahead, side, up, n, kinds, r, yaw, h, period, size, wag });
  const small = [0.38, 0.5], r = [2.0, 1.6];
  return [
    // the marina, round the posts and under the boats, below Snap
    S('marina', 0.12, 7.5, -2.6, -1.9, 6, 'pastel', r, 0.3, 0.12, 40, small),
    S('marina', 0.3, 7.0, 3.6, -2.1, 6, 'pastel', r, -0.4, 0.12, -38, small),
    S('marina', 0.55, 6.5, -2.6, -1.0, 6, 'pastel', r, 0.6, 0.12, 40, small),
    S('marina', 0.8, 6.5, 3.4, -0.9, 6, 'pastel', r, -0.2, 0.12, -38, small),
    // the shallows: over the sand, against the bright water
    S('shallows', 1.36, 7, -2.8, 0.6, 7, 'pastel', r, 0.2, 0.15, 42, small),
    S('shallows', 1.5, 10.5, 5.8, -0.9, 6, 'pastel', r, -0.3, 0.15, -40, small),
    S('shallows', 1.64, 7, -2.8, 0.5, 7, 'pastel', r, 0.6, 0.15, 41, small),
    S('shallows', 1.78, 7, 3.6, 1.0, 6, 'pastel', r, -0.6, 0.15, -39, small),
    S('shallows', 1.92, 7, -2.8, 0.6, 7, 'pastel', r, 0.1, 0.15, 43, small),
    // the kelp: a few at a time, between the stalks
    S('kelp', 2.38, 7, 2.8, 1.4, 5, 'kelp', [1.6, 1.3], 0.1, 0.15, 36, small, 1.4),
    S('kelp', 2.54, 7, -2.6, 1.5, 5, 'kelp', [1.6, 1.3], 0.7, 0.15, -34, small, 1.4),
    S('kelp', 2.7, 7, 2.8, 1.4, 5, 'kelp', [1.6, 1.3], -0.5, 0.15, 33, small, 1.4),
    S('kelp', 2.88, 7, -2.6, 1.2, 5, 'kelp', [1.6, 1.3], 0.3, 0.15, -35, small, 1.4),
    // the reef: yellow ones, teal ones, striped ones, a puffer
    S('reef', 3.34, 7, -2.8, 0.6, 5, 'reefY', r, 0.2, 0.15, 34, [0.42, 0.52], 1.5),
    S('reef', 3.46, 6.5, -2.8, 0.2, 4, 'reefT', r, -0.6, 0.15, -32, small, 1.7),
    S('reef', 3.6, 11, -6.0, -0.2, 5, 'reefY', r, 0.9, 0.15, 33, [0.42, 0.52], 1.5),
    S('reef', 3.7, 5.5, -2.4, 0.1, 1, 'puffer', [0.9, 0.7], 0.0, 0.12, -30, [0.55, 0.55], 1.2),
    S('reef2', 3.8, 6.5, -2.8, 0.4, 4, 'striped', r, 0.4, 0.15, 35, [0.44, 0.52], 1.5),
    S('reef2', 3.9, 7, 3.4, -0.4, 5, 'reefY', r, -0.2, 0.15, -33, [0.42, 0.52], 1.5),
    S('reef2', 4.0, 7, -2.6, 0.3, 4, 'reefT', r, 0.3, 0.15, 32, small, 1.7),
    // the way back up: overhead as the light comes back, to the left of the submarine
    S('surface', 7.4, 5.0, -2.6, 6.2, 6, 'ascent', [1.6, 1.3], 0.3, 0.12, 40, small),
    S('surface', 7.47, 6.0, 1.0, 9.5, 5, 'ascent', [1.6, 1.3], -0.4, 0.12, -38, small),
    // the end: just below the surface again, clear of the turtle, the octopus and the submarine
    S('surface', 7.95, 8.0, -3.0, -2.2, 6, 'pastel', r, 0.0, 0.1, 40, small),
    S('surface', 7.95, 8.5, 2.2, -3.6, 5, 'pastel', [1.6, 1.2], 0.5, 0.1, -38, small),
  ];
}

// A school's places: n fish on a loose lattice, about a body length apart (two lengths nose to
// nose along the way it heads, one and a half side by side, one and a third up and down), rows
// staggered, filled from the middle; [ahead, right, up] in metres, and the school's radius.
function formation(n, L, rng) {
  const cand = [];
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (let k = -1; k <= 1; k++) {
    const a = (i + (j & 1 ? 0.5 : 0)) * 2.0 * L, o = j * 1.55 * L, u = (k + (j & 1 ? 0.25 : -0.25) * (k ? 0 : 1)) * 1.35 * L;
    cand.push([a, o, u, (a / 1.35) ** 2 + o * o + (u / 0.75) ** 2 + rng() * 0.4 * L * L]);
  }
  cand.sort((p, q) => p[3] - q[3]);
  const pick = cand.slice(0, n);
  const m = [0, 0, 0];
  for (const c of pick) for (let k = 0; k < 3; k++) m[k] += c[k] / n;
  const slots = pick.map((c) => [c[0] - m[0] + rng.bell() * 0.12 * L, c[1] - m[1] + rng.bell() * 0.1 * L, c[2] - m[2] + rng.bell() * 0.08 * L]);
  let rad = 0;
  for (const s of slots) rad = Math.max(rad, Math.hypot(s[0], s[1], s[2]));
  return { slots, rad: rad + L * 0.6 };
}

// Every fish's numbers, by mesh and shape. `avoid` tells how far a place is from where Snap
// (and the submarine, the turtle and the octopus at the end) will be, near the school's p.
function populate(rng, amt, avoid) {
  const meshes = new Map(), where = [];
  for (const g of groups()) {
    const n = g.n === 1 ? 1 : Math.max(3, Math.round(g.n * Math.sqrt(amt)));
    const Lm = (g.size[0] + g.size[1]) / 2, form = formation(n, Lm, rng);
    const Rl = Math.max(g.r[0], g.r[1]);
    // the loop's points, round a middle at `at`; none of it may come near the camera's way or
    // the cast, go into the ground, or (while the visitor is at the school's moment) swim under
    // the page's header or its depth label
    const views = [];
    for (const pv of [g.p - 0.015, g.p + 0.015]) for (const scr of [SCREENS.wide, SCREENS.tall]) views.push([camAt(pv), scr]);
    const clearOf = (at) => {
      let worst = 1e9;
      for (let k = 0; k < 16; k++) {
        const th = (k / 16) * TAU, ex = g.r[0] * Math.cos(th), ez = g.r[1] * Math.sin(th), cy = Math.cos(g.yaw), sy = Math.sin(g.yaw);
        const x = at[0] + ex * cy - ez * sy, y = at[1], z = at[2] + ex * sy + ez * cy;
        worst = Math.min(worst, nearTrack(g.p, 1.2, x, y, z) - form.rad - 1.0, avoid(g.p, x, y, z) - form.rad - g.h);
        if (worst < 0) return worst;
        worst = Math.min(worst, y - form.rad - groundY(x, z) - 0.3);
        for (const [c, scr] of views) if (onUI(c, scr, x, y, z, form.rad + g.h + Lm * 0.5)) return -100;
      }
      return worst;
    };
    // if it is not clear where it was meant to be, step it aside (further out from the middle,
    // and lower) until all of its loop is clear; at each step, lower again if that is what it takes
    // to come out from under the header or the depth label
    let at = inView(g.p, g.ahead, g.side, g.up), k = 0, best = clearOf(at);
    search: for (; k < 40 && best < 0; k++) {
      const out = 1 + 0.06 * (k + 1), down = (k % 2) * 0.1 * (k + 1) * 0.5;
      for (const lower of [0, 0.7, 1.4, 2.1, 2.8]) {
        const a = inView(g.p, g.ahead + 0.08 * k, g.side * out, g.up - down - lower);
        a[1] = Math.max(a[1], groundY(a[0], a[2]) + form.rad + 0.4);
        // (if nowhere is quite clear, where it comes nearest; lower only to come out from under
        // the header or the label)
        const cl = clearOf(a);
        if (cl > best + 0.05 * Math.sign(best) || cl >= 0) { at = a; best = cl; }
        if (cl >= 0) break search;
        if (cl > -100) break;
      }
    }
    where.push({ p: g.p, at, steps: k, clear: clearOf(at), rad: form.rad });
    const w = TAU / g.period, phase = rng() * TAU;
    form.slots.forEach((slot) => {
      const [shape, pattern, body, second, fins] = rng.pick(KINDS[g.kinds]);
      const key = g.mesh + '/' + shape;
      let m = meshes.get(key);
      if (!m) meshes.set(key, (m = { shape, fish: [] }));
      const L = lerp(g.size[0], g.size[1], rng()) * (shape === 'long' ? 1.12 : 1), kk = rng.range(0.92, 1.06);
      const c = (name) => COL[name].map((x) => toLin(Math.min(x * kk, 1)));
      m.fish.push({
        A: [at[0], at[1], at[2], w], B: [g.r[0], g.r[1], g.yaw, g.h],
        C: [slot[0], slot[1], slot[2], L],
        D: [rng(), g.wag * rng.range(0.85, 1.15), phase, pattern],
        E: [...c(body), 4 + Math.floor(rng() * 3)], F: [...c(second), form.rad], G: [...c(fins), 0], H: eyeOf(FISH[shape]),
      });
    });
  }
  return { meshes, where };
}

// (the eight numbers-of-four of each fish share one buffer: WebGPU allows only eight vertex buffers to a draw)
function fishMesh(geo, fish, mat) {
  const n = fish.length, attrs = {}, boxes = [], buf = new InstancedInterleavedBuffer(new Float32Array(n * 32), 32, 1);
  ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach((key, j) => {
    for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) buf.array[i * 32 + j * 4 + c] = fish[i][key][c];
    attrs['f' + key] = new InterleavedBufferAttribute(buf, 4, j * 4);
  });
  for (const f of fish) {
    const L = f.C[3], out = Math.max(f.B[0], f.B[1]) + f.F[3] + L + 2.5, up = f.B[3] + f.F[3] + L + 1.5;
    boxes.push([f.A[0] - out, f.A[0] + out, f.A[1] - up, f.A[1] + up, f.A[2] - out, f.A[2] + out]);
  }
  return solid(copies(geo, n, attrs, sphereOf(boxes)), mat);
}

// ---- the creatures placed each frame ------------------------------------------------------

// Each has a slot here: four numbers-of-four, set every frame (where it is and how big; which
// way it heads and its own phase; which way is up and its colouring; and how it holds itself:
// for the octopus, sitting at the desk (1) or swimming (0), and where the letter is, in its
// own frame). The turtle over the reef, the turtle at the end, the octopus at the wreck, the
// octopus at the end, the anglerfish, the bottle with a message.
const SLOTS = 6;
const POSE = uniformArray(Array.from({ length: SLOTS * 4 }, () => new Vector4(0, -1000, 0, 0)), 'vec4');
const cS = attribute('cS', 'vec4');             // per copy: its slot, its seed, its colouring
const vA = varyingProperty('vec3', 'v_ca'), vB = varyingProperty('vec3', 'v_cb'), vP = varyingProperty('vec3', 'v_cp'), vK = varyingProperty('vec4', 'v_ck');
const vL = varyingProperty('vec3', 'v_cl');

// Place a point and a normal of the creature in its slot, from its own frame.
function placed(lp, ln) {
  const i = int(cS.x).mul(4);
  const A = POSE.element(i), B = POSE.element(i.add(1)), Cc = POSE.element(i.add(2)), D = POSE.element(i.add(3));
  const F = B.xyz, Up = Cc.xyz, R = cross(F, Up);
  return { P: A.xyz.add(F.mul(lp.x).add(Up.mul(lp.y)).add(R.mul(lp.z)).mul(A.w)), N: normalize(F.mul(ln.x).add(Up.mul(ln.y)).add(R.mul(ln.z))), F, Up, R, size: A.w, phase: B.w, look: Cc.w, D };
}
// Turn a direction from the creature's own frame into the world.
const toWorld = (pl, d) => pl.F.mul(d.x).add(pl.Up.mul(d.y)).add(pl.R.mul(d.z));
// Turn a point about an axis (x, y or z of the creature's frame) through `at` by angle a.
function turn(p, at, axis, a) {
  const d = p.sub(at), c = cos(a), s = sin(a);
  if (axis === 'x') return at.add(vec3(d.x, d.y.mul(c).sub(d.z.mul(s)), d.y.mul(s).add(d.z.mul(c))));
  if (axis === 'y') return at.add(vec3(d.x.mul(c).add(d.z.mul(s)), d.y, d.z.mul(c).sub(d.x.mul(s))));
  return at.add(vec3(d.x.mul(c).sub(d.y.mul(s)), d.x.mul(s).add(d.y.mul(c)), d.z));
}
const turnN = (n, axis, a) => turn(n, vec3(0.0), axis, a);
// Patches of colour, as crochet colour-work: round cells a little apart, in rows. 1 in a patch.
function patches(q, k) {
  const r = q.mul(k), row = floor(r.y);
  const cell = vec2(fract(r.x.add(row.mul(0.5))).sub(0.5), fract(r.y).sub(0.5));
  const d = length(cell), aa = fwidth(d).add(1e-4);
  return float(1.0).sub(smoothstep(float(0.36).sub(aa), aa.add(0.36), d));
}

// The turtle, as a toy turtle is made: a high round dome of a shell over a flat belly, its
// rim edged with a fat stitched cord; a big round head on a thick neck, with big bead eyes in
// felt rings set wide on the front of it, a stitched smile and pink cheeks; plump stuffed
// flippers, broad in front, small behind; a stub of a tail. About a metre long. aux.w: 0
// shell, 1 skin, 2 front flippers, 3 back flippers, 4 eyes, 5 the shell's rim.
const T_HEAD = [0.6, 0.08, 0, 0.19, 0.165, 0.16];
// (a point on the head's surface the way d points from its middle, sunk by k)
const onHead = (d, k) => {
  const [hx, hy, hz, rx, ry, rz] = T_HEAD, l = Math.hypot(...d), x = d[0] / l, y = d[1] / l, z = d[2] / l, r = k / Math.hypot(x / rx, y / ry, z / rz);
  return [hx + x * r, hy + y * r, hz + z * r];
};
const T_EYE = [...onHead([0.62, 0.32, 0.72], 0.97), 0.046], T_CHEEK = [...onHead([0.45, -0.25, 0.86], 1.0), 0.036];
function turtleShape(lod) {
  const m = new Mesh(true), res = [7, 9, 11][lod];
  blob(m, 0, 0, 0, (dx, dy, dz) => 1 / Math.hypot(dx / 0.46, dy / (dy > 0 ? 0.3 : 0.11), dz / 0.38), res, (dx, dy, dz, o) => { o[3] = 0; });
  // the rim: a fat cord round the shell's edge
  const rim = [];
  for (let i = 0, n = [24, 32, 40][lod]; i <= n; i++) { const a = (i / n) * TAU; rim.push([Math.cos(a) * 0.452, 0.004, Math.sin(a) * 0.372, 0.034]); }
  tube(m, rim, [5, 6, 6][lod], [0, 0, 5]);
  tube(m, [[0.3, -0.01, 0, 0.105], [0.4, 0.02, 0, 0.1], [0.5, 0.05, 0, 0.11]], 8, [0, 0, 1]);
  ball(m, T_HEAD[0], T_HEAD[1], T_HEAD[2], T_HEAD[3], T_HEAD[4], T_HEAD[5], Math.max(res - 1, 5), 1);
  tube(m, [[-0.4, -0.02, 0, 0.055], [-0.48, -0.03, 0, 0.042], [-0.54, -0.035, 0, 0.022]], 6, [0, 0, 1]);
  for (const side of [1, -1]) ball(m, T_EYE[0], T_EYE[1], side * T_EYE[2], T_EYE[3], T_EYE[3], T_EYE[3], lod ? 4 : 3, 4);
  // flippers: plump paddles, broad and swept back in front, small behind
  for (const side of [1, -1]) {
    pillow(m, 4, lod ? 7 : 5, [0, 1, 0], 2, (s, t, o) => {
      const w = 0.19 * (1 - Math.pow(t, 1.6) * 0.6) + 0.035;
      o[0] = 0.22 - 0.34 * Math.pow(t, 1.15) + (0.5 - s) * w; o[1] = -0.03 - 0.035 * t; o[2] = side * (0.3 + 0.42 * t);
      o[3] = 0.07 * plump(s, t, 0.6);
    });
    pillow(m, 3, 3, [0, 1, 0], 3, (s, t, o) => {
      const w = 0.12 * (1 - Math.pow(t, 1.5) * 0.5) + 0.03;
      o[0] = -0.3 - 0.12 * t + (0.5 - s) * w; o[1] = -0.04; o[2] = side * (0.2 + 0.15 * t);
      o[3] = 0.055 * plump(s, t, 0.55);
    });
  }
  return m.build();
}

// The shell's plates (their centres, seen from above: a row down the middle and four a
// side), and round the rim a ring cut into short plates: where they meet, a pale seam.
const PLATES = [[0.29, 0], [0.14, 0], [0, 0], [-0.14, 0], [-0.28, 0], [0.21, 0.16], [0.075, 0.18], [-0.075, 0.18], [-0.21, 0.16], [0.21, -0.16], [0.075, -0.18], [-0.075, -0.18], [-0.21, -0.16]];
function shellSeam(lp, aa) {
  let d1 = float(9.0), d2 = float(9.0), id = float(0.0);
  PLATES.forEach(([x, z], i) => {
    const d = length(vec2(lp.x.sub(x), lp.z.sub(z)));
    d2 = min(d2, max(d1, d));
    id = select(d.lessThan(d1), float(i), id);
    d1 = min(d1, d);
  });
  const rim = length(vec2(lp.x.div(0.45), lp.z.div(0.37))).toVar();
  const inner = float(1.0).sub(smoothstep(0.014, aa.add(0.016), d2.sub(d1))).mul(step(rim, 0.8));
  const ring = float(1.0).sub(smoothstep(0.03, fwidth(rim).add(0.036), abs(rim.sub(0.8))));
  const k = atan(lp.z.div(0.37), lp.x.div(0.45)).mul(15.0 / TAU);
  const cut = float(1.0).sub(smoothstep(0.06, fwidth(k).add(0.07), abs(fract(k).sub(0.5)).oneMinus().sub(0.5))).mul(step(0.8, rim));
  // (thin lines: seen from far, where a pixel would be wider than they are, they fade into the shell)
  return { seam: max(max(inner, ring), cut).mul(smoothstep(0.0, 0.03, lp.y)).mul(float(1.0).sub(smoothstep(0.014, 0.034, aa))), id: select(rim.greaterThan(0.8), floor(k), id) };
}

function turtleMaterial() {
  const FRONT = [0.22, -0.03, 0.3], BACK = [-0.3, -0.04, 0.2], NECK = vec3(0.32, 0.0, 0.0);
  return material({
    aux: true, shadow: false,
    vertex: (v) => {
      const t = G.time, lp = v.P.toVar(), ln = v.N.toVar(), part = v.aux.w;
      const pl0 = placed(vec3(0.0), vec3(1.0, 0.0, 0.0));
      const w = t.mul(TAU * 0.24).add(pl0.phase).toVar();
      const side = sign(lp.z).toVar();
      // the front flippers beat slowly, up and down; the back ones paddle; the head nods
      const af = side.mul(sin(w).mul(0.34).add(0.16)), ab = side.mul(sin(w.sub(1.3)).mul(0.22));
      const ah = sin(w.mul(0.5).add(0.7)).mul(0.06);
      const pf = turn(lp, vec3(FRONT[0], FRONT[1], side.mul(FRONT[2])), 'x', af), nf = turnN(ln, 'x', af);
      const pb = turn(lp, vec3(BACK[0], BACK[1], side.mul(BACK[2])), 'x', ab), nb = turnN(ln, 'x', ab);
      const head = step(0.33, lp.x).mul(one(part, 1).add(one(part, 4)));
      const ph = turn(lp, NECK, 'z', ah), nh = turnN(ln, 'z', ah);
      const front = one(part, 2).greaterThan(0.5), back = one(part, 3).greaterThan(0.5), isHead = head.greaterThan(0.5);
      const q = select(front, pf, select(back, pb, select(isHead, ph, lp)));
      const qn = select(front, nf, select(back, nb, select(isHead, nh, ln)));
      const pl = placed(q, qn);
      v.P.assign(pl.P); v.N.assign(pl.N);
      vA.assign(pl.F); vB.assign(pl.Up); vP.assign(lp.mul(pl.size));
      vK.assign(vec4(pl0.look, pl.size, 0.0, 0.0));
    },
    surface: (s, f) => {
      const part = f.aux.w, lp = f.obj, look = vK.x, size = vK.y;
      const n0 = s.n, F = normalize(vA), Up = normalize(vB), R = cross(F, Up), frame = [F, Up, R];
      const shell = one(part, 0), eye = one(part, 4), rim = one(part, 5), flip = one(part, 2).add(one(part, 3)), skinPart = one(part, 1);
      // the reef's turtle is brown with cream seams and cream skin in brown patches; the one at
      // the end, coral with teal skin; both edged in cream
      const shellCol = mix(lin(0.6, 0.36, 0.22), lin(0.9, 0.5, 0.4), look), seamCol = mix(lin(0.96, 0.89, 0.74), lin(0.98, 0.9, 0.76), look);
      const skinCol = mix(lin(0.9, 0.84, 0.72), lin(0.5, 0.74, 0.76), look), spotCol = mix(lin(0.56, 0.36, 0.24), lin(0.28, 0.52, 0.56), look);
      const bellyCol = mix(lin(0.94, 0.86, 0.68), lin(0.98, 0.88, 0.72), look);
      const under = shell.mul(float(1.0).sub(smoothstep(-0.02, 0.01, lp.y)));
      // the skin's patches: on the flippers, and on top of the head
      const topHead = skinPart.mul(smoothstep(0.5, 0.56, lp.x)).mul(smoothstep(0.13, 0.18, lp.y));
      const spots = patches(vec2(lp.x, lp.z), 11.0).mul(flip.add(topHead)).mul(float(1.0).sub(eye));
      const aa = fwidth(lp.x).add(fwidth(lp.z)).add(1e-4);
      const sh = shellSeam(lp, aa);
      // each plate a little different
      const plateK = fract(sin(sh.id.mul(12.9898)).mul(43758.5)).sub(0.5).mul(0.18).add(1.0);
      const skin = mix(skinCol, spotCol, spots.mul(0.85));
      const col = mix(mix(skin, mix(shellCol.mul(plateK), bellyCol, under), shell), seamCol, rim);
      // the stitches, worked in rounds: the shell (and its rim) round from the top of the dome,
      // the head round from its nose, the neck and the tail along themselves, each flipper from
      // its tip
      const sd = sign(lp.z), onHeadBall = skinPart.mul(step(0.45, lp.x)), body = max(shell, rim);
      const fin = one(part, 2), toTip = normalize(vec3(-0.34, -0.035, sd.mul(0.42))), toTipB = normalize(vec3(-0.12, 0.0, sd.mul(0.15)));
      const c = select(body.greaterThan(0.5), vec3(0.0, -0.02, 0.0), select(onHeadBall.greaterThan(0.5), vec3(T_HEAD[0], T_HEAD[1], 0.0),
        select(fin.greaterThan(0.5), vec3(0.05, -0.05, sd.mul(0.51)), select(flip.greaterThan(0.5), vec3(-0.36, -0.04, sd.mul(0.275)), vec3(0.0, 0.0, 0.0)))));
      const A = select(body.greaterThan(0.5), vec3(0.0, 1.0, 0.0), select(onHeadBall.greaterThan(0.5), vec3(1.0, 0.0, 0.0), select(fin.greaterThan(0.5), toTip, select(flip.greaterThan(0.5), toTipB, vec3(1.0, 0.0, 0.0)))));
      const B = normalize(cross(A, vec3(0.0, 0.0, 1.0)).add(vec3(0.0, 0.0, 1e-4)).add(select(body.greaterThan(0.5), vec3(1.0, 0.0, 0.0), vec3(0.0))));
      const rad = select(body.greaterThan(0.5), float(0.4), select(onHeadBall.greaterThan(0.5), float(0.17), select(flip.greaterThan(0.5), float(0.06), float(0.1))));
      const tubeK = select(body.add(onHeadBall).greaterThan(0.5), float(0.0), float(1.0));
      const st = rounds(lp.mul(size), c.mul(size), A, B, rad.mul(size), yarnFor(1.7), tubeK);
      const h = stitches(s, f, { color: col, st: { ...st, Ta: inWorld(frame, st.Ta), Tb: inWorld(frame, st.Tb) }, k: 1.3 });
      const seam = sh.seam.mul(shell).mul(float(1.0).sub(under));
      s.albedo = mix(s.albedo, seamCol.mul(h.h.mul(0.4).add(0.6)), seam);
      // the face: bead eyes in felt rings, a smile under them on the front of the head, cheeks
      eyes(s, lp, n0, { at: T_EYE, bead: eye, on: skinPart });
      const px = pixel(vec3(lp.z, lp.y, 0.0));
      const front = skinPart.mul(smoothstep(0.7, 0.74, lp.x));
      const smile = arc(lp.z, lp.y.sub(0.035), float(0.06), float(0.028), float(0.0075), px).mul(front);
      const cheek = spot(length(vec3(lp.x.sub(T_CHEEK[0]), lp.y.sub(T_CHEEK[1]), abs(lp.z).sub(T_CHEEK[2]))), float(0.0), float(T_CHEEK[3]), px).mul(skinPart);
      sew(s, n0, smile, cheek);
    },
  });
}

// The octopus (as the painted dive's): a big round head worked in rounds from its top, big
// bead eyes in felt rings set wide on its face, a stitched smile and pink cheeks; eight fat
// stuffed arms. Swimming (or drifting), they curl down and out and wave; at the desk the six
// behind hang curled and the front two reach over the desk's edge to rest on the letter. About
// 0.7 high before it is sized. aux.w: 0 head, 2 arms (built in the shader: aux = along, round,
// which), 4 eyes. A happy wiggle (JOY, the cabin's octopus only): its head rocks and bobs, its
// arms dance and its eyes close into smiles.
const O_HEAD = [0, 0.4, 0, 0.27, 0.29, 0.25];
const onOct = (d, k) => {
  const [hx, hy, hz, rr, up, dn] = O_HEAD, l = Math.hypot(...d), x = d[0] / l, y = d[1] / l, z = d[2] / l, r = k / Math.hypot(x / rr, y / (y > 0 ? up : dn), z / rr);
  return [hx + x * r, hy + y * r, hz + z * r];
};
const O_EYE = [...onOct([0.8, -0.02, 0.6], 0.96), 0.058], O_CHEEK = [...onOct([0.6, -0.42, 0.68], 1.0), 0.04];
const JOY = uniform(0);
function octopusShape(lod) {
  const m = new Mesh(true), res = [7, 9, 11][lod];
  const [hx, hy, hz, rr, up, dn] = O_HEAD;
  blob(m, hx, hy, hz, (dx, dy, dz) => 1 / Math.hypot(dx / rr, dy / (dy < 0 ? dn : up), dz / rr), res, (dx, dy, dz, o) => { o[3] = 0; });
  for (const side of [1, -1]) ball(m, O_EYE[0], O_EYE[1], side * O_EYE[2], O_EYE[3], O_EYE[3], O_EYE[3], lod ? 4 : 3, 4);
  tubes(m, 8, [10, 14, 18][lod], [6, 7, 8][lod], () => 2);
  return m.build();
}
// A tentacle at s: in the upright plane of its direction out from the body, bending at a
// steady rate from its starting angle psi0, so it is an arc that curls.
function curl(s, a, psi0, kap, len, base) {
  const ps = psi0.add(kap.mul(s));
  return base.add(vec3(cos(a), 0.0, sin(a)).mul(sin(ps).sub(sin(psi0)).div(kap).mul(len))).add(vec3(0.0, cos(psi0).sub(cos(ps)).div(kap).mul(len), 0.0));
}
function octopusMaterial() {
  return material({
    aux: true, shadow: false,
    vertex: (v) => {
      const t = G.time, lp = v.P.toVar(), ln = v.N.toVar(), part = v.aux.w;
      const pl0 = placed(vec3(0.0), vec3(1.0, 0.0, 0.0));
      const D = pl0.D, seat = D.x, joy = JOY.mul(one(cS.x, 2)).toVar();
      const s = v.aux.x, phi = v.aux.y.mul(TAU), k = v.aux.z;
      const a = k.add(0.5).mul(TAU / 8).toVar();
      const front = step(6.5, k).add(step(k, 0.5));
      // (a happy wiggle: every arm dances, quickly)
      const wave = sin(t.mul(1.05).add(k.mul(1.7)).add(pl0.phase)).add(sin(t.mul(8.5).add(k.mul(2.1))).mul(joy.mul(1.3))).toVar();
      const base = vec3(cos(a).mul(0.12), 0.16, sin(a).mul(0.12));
      // drifting: every arm curls down and out, waving
      const swim = (ss) => curl(ss, a, wave.mul(0.12).sub(1.0), wave.mul(0.55).add(3.3), float(0.46), base);
      // at the desk: the arms behind hang curled; the front two arch over its edge to the letter
      const hang = (ss) => curl(ss, a, wave.mul(0.06).sub(1.35), wave.mul(0.22).add(3.9), float(0.4), base);
      const sd = sign(sin(a)), tip = vec3(D.y, D.z.add(0.035), D.w.add(sd.mul(0.19)));
      const mid = vec3(mix(base.x, tip.x, 0.45), max(base.y, tip.y).add(0.07), mix(base.z, tip.z, 0.45));
      const reach = (ss) => {
        const u = float(1.0).sub(ss);
        return base.mul(u.mul(u)).add(mid.mul(u.mul(ss).mul(2.0))).add(tip.mul(ss.mul(ss))).add(vec3(0.0, sin(t.mul(0.9).add(k.mul(2.0))).mul(joy.mul(0.05).add(0.012)).mul(ss).mul(u), 0.0));
      };
      const at = (ss) => mix(swim(ss), mix(hang(ss), reach(ss), front), seat);
      const C0 = at(s).toVar(), T = normalize(at(s.add(0.02)).sub(C0)).toVar();
      const r = float(0.095).mul(float(1.0).sub(s.mul(0.45))).mul(sqrt(min(float(1.0).sub(s).mul(12.0), 1.0)));
      const rg = ringAt(C0, T, vec3(sin(a).negate(), 0.0, cos(a)), phi, r);
      // the head breathes (and, happy, rocks from side to side and bobs)
      const breathe = sin(t.mul(1.3).add(pl0.phase)).mul(0.025);
      const head = vec3(lp.x.mul(float(1.0).sub(breathe)), lp.y.sub(0.4).mul(breathe.add(1.0)).add(0.4), lp.z.mul(float(1.0).sub(breathe)));
      const isT = one(part, 2).greaterThan(0.5);
      const q0 = select(isT, rg.p, select(one(part, 0).greaterThan(0.5), head, lp)), n1 = select(isT, rg.n, ln);
      const rock = sin(t.mul(6.5)).mul(joy.mul(0.2)), hop = abs(sin(t.mul(6.5))).mul(joy.mul(0.06));
      const pl = placed(turn(q0, vec3(0.0, 0.16, 0.0), 'x', rock).add(vec3(0.0, hop, 0.0)), turnN(n1, 'x', rock));
      v.P.assign(pl.P); v.N.assign(pl.N);
      // the stitches: the head's from its own shape; an arm's along it, round it
      vA.assign(pl.F); vB.assign(pl.Up);
      vP.assign(select(isT, toWorld(pl, T), vec3(0.0)));
      vK.assign(vec4(pl0.look, pl.size, select(isT, v.aux.y, float(-1.0)), s.mul(0.46).add(k.mul(1.7))));
      vL.assign(vec3(joy, 0.0, 0.0));
    },
    surface: (s, f) => {
      const part = f.aux.w, lp = f.obj, n0 = s.n, look = vK.x, size = vK.y, joy = vL.x;
      const F = normalize(vA), Up = normalize(vB), frame = [F, Up, cross(F, Up)];
      const eye = one(part, 4), head = one(part, 0), arm = step(-0.5, vK.z);
      // (the same pink as in the cabin, where the lantern's warm light is on it; in the open
      // water at the end its yarn is a little warmer and answers the blue-green light more, so
      // it stays pink there too, not lilac)
      const col = mix(lin(0.84, 0.54, 0.66), lin(0.94, 0.5, 0.6), look);
      // the stitches: the head in rounds from its top; an arm in rounds along it
      const hs = rounds(lp.mul(size), vec3(0.0, 0.4, 0.0).mul(size), vec3(0.0, 1.0, 0.0), vec3(1.0, 0.0, 0.0), size.mul(0.27), STITCH);
      const N = floor(size.mul((2 * Math.PI * 0.08 * STITCH) / 8).add(0.5)).mul(8.0);
      const aA = vK.z.mul(N), aB = vK.w.mul(size).mul(STITCH), T = normalize(vP.add(Up.mul(1e-4)));
      const st = {
        a: select(arm.greaterThan(0.5), aA, hs.a), b: select(arm.greaterThan(0.5), aB, hs.b),
        ga: select(arm.greaterThan(0.5), vec2(dFdx(aA), dFdy(aA)), hs.ga), gb: select(arm.greaterThan(0.5), vec2(dFdx(aB), dFdy(aB)), hs.gb),
        Ta: select(arm.greaterThan(0.5), normalize(cross(s.n, T)), inWorld(frame, hs.Ta)), Tb: select(arm.greaterThan(0.5), T, inWorld(frame, hs.Tb)),
      };
      stitches(s, f, { color: col, st, k: 1.4 });
      s.fluor = mix(s.fluor, float(1.25), look);
      // the face: bead eyes in felt rings (happy: closed into smiles), a smile, pink cheeks
      // (closed: a lid of the head's own yarn comes up under an arch, so each eye is a ∩)
      const v = lp.y.sub(O_EYE[1]).div(O_EYE[3]), u = abs(lp.z).sub(O_EYE[2]).div(O_EYE[3]);
      const arch = mix(float(-2.0), float(0.7), joy).sub(u.mul(u).mul(0.9));
      const lid = float(1.0).sub(smoothstep(arch.sub(0.05), arch.add(0.05), v)).mul(eye);
      const lidEdge = float(1.0).sub(smoothstep(0.06, 0.16, abs(v.sub(arch)))).mul(eye).mul(step(0.05, joy));
      eyes(s, lp, n0, { at: O_EYE, bead: eye.mul(float(1.0).sub(lid)), on: head });
      const px = pixel(vec3(lp.z, lp.y, 0.0));
      const smile = arc(lp.z, lp.y.sub(0.288), float(0.065), float(0.032), float(0.0095), px).mul(head).mul(smoothstep(0.14, 0.18, lp.x));
      const cheek = spot(length(vec3(lp.x.sub(O_CHEEK[0]), lp.y.sub(O_CHEEK[1]), abs(lp.z).sub(O_CHEEK[2]))), float(0.0), float(O_CHEEK[3]).mul(joy.mul(0.25).add(1.0)), px).mul(head);
      sew(s, n0, max(smile, lidEdge), cheek);
    },
  });
}

// The anglerfish (z5lit): a round fish of lilac-blue crochet, its rows worked round and round
// from the nose; a big bead eye in a felt ring; a wide friendly grin, a pale rolled lip with a
// little underbite and one soft fang at each corner (as the painted one has); purple ruffled
// fins, stuffed (a rosette at each side, a crest along the back, a round tail, a small one
// under the belly); and on a stalk from its forehead a big teal lure, glowing: the only light
// on it. Half a metre round before it is sized; x forward, y up, its right side +z. aux.w: 0
// body, 1 fins, 2 lip, 3 stalk, 4 eyes, 5 teeth, 6 the lure.
// The body's radius in a direction (x, y, z of unit length).
const aBody = (x, y, z) => 1 / Math.hypot(x / (x > 0 ? 0.27 : 0.25), y / (y > 0 ? 0.25 : 0.24), z / 0.23);
const LURE = [0.55, 0.12, 0], A_EYE = (() => { const l = Math.hypot(0.6, 0.38, 0.7), x = 0.6 / l, y = 0.38 / l, z = 0.7 / l, r = aBody(x, y, z) * 0.95; return [x * r, y * r, z * r, 0.052]; })();
// The grin: where the lip runs round the front of the face, as a direction from the middle at
// angle a round it (0 the nose, +-A_GRIN the corners); the corners turn up.
const A_GRIN = 1.2;
const grinDir = (a) => { const u = a / A_GRIN, y = -0.3 + 0.13 * u * u, l = Math.hypot(Math.cos(a), y, Math.sin(a)); return [Math.cos(a) / l, y / l, Math.sin(a) / l]; };
// A ruffled fin: a puffed disc (or part of one) whose edge waves in and out of its plane.
// c its middle, U and V its plane, N out of it; a0..a1 the part of the circle, r(a) the
// radius that way, `waves` how many ruffles round it, `amp` how deep.
function ruffle(m, c, U, V, N, a0, a1, r, waves, amp, th, part, cols, rows) {
  pillow(m, cols, rows, N, part, (s, t, o) => {
    const a = lerp(a0, a1, s), rr = r(a) * t, ca = Math.cos(a), sa = Math.sin(a);
    const wv = amp * t * t * Math.sin(a * waves);
    for (let k = 0; k < 3; k++) o[k] = c[k] + (U[k] * ca + V[k] * sa) * rr + N[k] * wv;
    o[3] = th * (1 - t * t * 0.8);
  });
}
function anglerShape(lod) {
  const m = new Mesh(true), res = [7, 9, 11][lod], rf = lod ? 1 : 0;
  blob(m, 0, 0, 0, aBody, res, (dx, dy, dz, o) => { o[0] = dx; o[1] = dy; o[2] = dz; o[3] = 0; });
  for (const side of [1, -1]) {
    const [ex, ey, ez, er] = A_EYE;
    ball(m, ex, ey, side * ez, er, er, er, 3 + rf, 4);
    // the rosette at the side, behind the corner of the grin: a round ruffled fin standing out
    // from the body, facing out and back
    const d = [-0.1, -0.2, side], l = Math.hypot(...d), rb = aBody(d[0] / l, d[1] / l, d[2] / l) + 0.055;
    const c = [d[0] / l * rb, d[1] / l * rb, d[2] / l * rb], N = [-0.5, 0, side * 0.87], nl = Math.hypot(...N);
    ruffle(m, c, [0.87 / nl, 0, 0.5 * side / nl], [0, 1, 0], [N[0] / nl, 0, N[2] / nl], 0, TAU, (a) => 0.1 + 0.01 * Math.sin(a * 2 + 1), 9, 0.016, 0.032, 1, 18 + 4 * rf, 4);
  }
  // the crest along the back, behind the stalk: three ruffled scallops
  pillow(m, 10 + 6 * rf, 3, [0, 0, 1], 1, (s, t, o) => {
    const x = lerp(0.04, -0.22, s), y0 = 0.25 * Math.sqrt(Math.max(1 - (x / 0.25) ** 2, 0)) * 0.94;
    const h = (0.06 + 0.035 * Math.abs(Math.sin(s * Math.PI * 3))) * Math.sin(Math.PI * Math.min(s * 1.15 + 0.06, 1)) ** 0.6;
    o[0] = x - t * h * 0.35; o[1] = y0 + t * h; o[2] = 0.012 * t * t * Math.sin(s * 19);
    o[3] = 0.028 * (1 - t * t * 0.7);
  });
  // the tail: a round fan, its edge in scallops
  ruffle(m, [-0.235, 0.0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], -1.25, 1.25, (a) => 0.17 + 0.012 * Math.cos(a * 7), 7, 0.02, 0.034, 1, 12 + 4 * rf, 3);
  // a small fin under the belly
  ruffle(m, [0.02, -0.225, 0], [-0.6, -0.8, 0], [0.8, -0.6, 0], [0, 0, 1], -0.9, 0.9, () => 0.07, 5, 0.008, 0.024, 1, 6, 2);
  // the lip: a rolled cord round the front of the face, and a little tooth at each corner
  {
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const a = lerp(-A_GRIN, A_GRIN, i / 16), [x, y, z] = grinDir(a), r = aBody(x, y, z) * 1.01;
      pts.push([x * r, y * r, z * r, 0.026 * (1 - 0.35 * Math.abs(a / A_GRIN) ** 3)]);
    }
    tube(m, pts, 5, [0, 0, 2]);
    for (const side of [1, -1]) {
      const [x, y, z] = grinDir(side * A_GRIN * 0.86), r = aBody(x, y, z) * 1.02;
      tube(m, [[x * r, y * r + 0.004, z * r, 0.013], [x * r + 0.003, y * r + 0.022, z * r * 1.02, 0.008]], 5, [0, 0, 5]);
    }
  }
  // the stalk: from the forehead up, over and down to the lure, thinning
  {
    const pts = [], B = [[0.07, 0.232], [0.12, 0.52], [0.52, 0.52], [LURE[0], LURE[1] + 0.076]];
    for (let i = 0; i <= 14; i++) {
      const u = i / 14, a = (1 - u) ** 3, b = 3 * u * (1 - u) ** 2, c = 3 * u * u * (1 - u), d = u ** 3;
      pts.push([a * B[0][0] + b * B[1][0] + c * B[2][0] + d * B[3][0], a * B[0][1] + b * B[1][1] + c * B[2][1] + d * B[3][1], 0, 0.021 - 0.01 * u]);
    }
    tube(m, pts, 5, [0, 0, 3]);
  }
  // the lure: a bulb a little longer than wide
  ball(m, LURE[0], LURE[1], LURE[2], 0.06, 0.072, 0.06, 4 + rf, 6);
  return m.build();
}
// (the lure sways on its stalk: the same turn in both materials)
const lureSway = (t, phase) => sin(t.mul(0.9).add(phase)).mul(0.12);
const STALK = vec3(0.07, 0.232, 0.0);
const LURE_COL = lin(0.55, 1.0, 0.92);
// (and nothing glowing is drawn beyond about 44 m: it fades out before it is switched off)
const far = (d, a, b) => float(1.0).sub(smoothstep(a, b, d));
function anglerMaterial() {
  return material({
    aux: true, shadow: false,
    vertex: (v) => {
      const t = G.time, lp = v.P.toVar(), ln = v.N.toVar(), part = v.aux.w;
      const pl0 = placed(vec3(0.0), vec3(1.0, 0.0, 0.0));
      const w = t.mul(TAU * 0.5).add(pl0.phase);
      const fin = one(part, 1);
      // the tail wags; the rosettes fan slowly; the crest ripples; the lure sways on its stalk
      const at = sin(w).mul(0.28).mul(float(1.0).sub(smoothstep(-0.25, -0.2, lp.x))).mul(fin);
      const q0 = turn(lp, vec3(-0.22, 0.0, 0.0), 'y', at), n0 = turnN(ln, 'y', at);
      const ros = fin.mul(step(0.15, abs(lp.z))).mul(step(lp.y, 0.1));
      const af = sin(w.mul(1.4).add(1.0)).mul(0.35).mul(ros).mul(sign(lp.z));
      const q1 = turn(q0, vec3(-0.1, 0.0, lp.z.mul(0.85)), 'y', af), n1 = turnN(n0, 'y', af);
      const sway = lureSway(t, pl0.phase), al = sway.mul(one(part, 3).add(one(part, 6)));
      const pl = placed(turn(q1, STALK, 'z', al), turnN(n1, 'z', al));
      v.P.assign(pl.P); v.N.assign(pl.N);
      vA.assign(pl.F); vB.assign(pl.Up); vP.assign(lp.mul(pl.size));
      vL.assign(placed(turn(vec3(LURE[0], LURE[1], LURE[2]), STALK, 'z', sway), vec3(1.0, 0.0, 0.0)).P);
      vK.assign(vec4(pl.size, 0.0, 0.0, 0.0));
    },
    surface: (s, f) => {
      const part = f.aux.w, lp = f.obj, n0 = s.n, F = normalize(vA), Up = normalize(vB), R = cross(F, Up);
      const body = one(part, 0), fins = one(part, 1), lip = one(part, 2), stalk = one(part, 3), eye = one(part, 4), teeth = one(part, 5), lure = one(part, 6);
      // the fins a warm purple, deepening toward their edges; the lip and the teeth pale
      const edge = smoothstep(0.1, 0.3, length(lp.sub(vec3(0.0, 0.0, 0.0))));
      // (the rosettes at its sides magenta, worked round and round from the middle)
      const ros = fins.mul(step(0.15, abs(lp.z))).mul(step(lp.y, 0.1));
      const finCol = mix(mix(lin(0.64, 0.44, 0.8), lin(0.72, 0.34, 0.72), edge), lin(0.82, 0.38, 0.72), ros);
      const col = mix(mix(mix(lin(0.64, 0.62, 0.8), finCol, fins), lin(0.66, 0.6, 0.84), stalk), lin(0.86, 0.85, 0.88), max(lip, teeth));
      // (the body in rounds from its nose; the rosettes in rounds from their middles; the rest
      // along themselves)
      const size = vK.x, frame = [F, Up, R], rosC = vec3(-0.026, -0.052, sign(lp.z).mul(0.259));
      const st = rounds(lp.mul(size), select(ros.greaterThan(0.5), rosC, vec3(0.0)).mul(size), select(ros.greaterThan(0.5), normalize(vec3(-0.5, 0.0, sign(lp.z).mul(0.87))), vec3(1.0, 0.0, 0.0)),
        vec3(0.0, 1.0, 0.0), select(ros.greaterThan(0.5), float(0.1), float(0.26)).mul(size), yarnFor(0.83));
      stitches(s, f, { color: col, st: { ...st, Ta: inWorld(frame, st.Ta), Tb: inWorld(frame, st.Tb) }, k: 1.3, fuzz: 1.4 });
      // the mouth: a dark gap just above the lip, widest at the nose, closing at the corners
      const dn = normalize(lp), ang = atan(dn.z, dn.x), u = ang.div(A_GRIN);
      const y0 = u.mul(u).mul(0.13).sub(0.3), yl = y0.div(sqrt(y0.mul(y0).add(1.0)));
      const open = max(float(0.15).mul(float(1.0).sub(u.mul(u))), 0.0);
      const aa = fwidth(dn.y).add(1e-4);
      const gap = smoothstep(yl.sub(aa), yl.add(aa.mul(2.0)), dn.y).mul(float(1.0).sub(smoothstep(yl.add(open).sub(aa), yl.add(open).add(aa), dn.y)))
        .mul(step(abs(u), 1.0)).mul(step(0.0, dn.x)).mul(body);
      s.albedo = mix(s.albedo, lin(0.12, 0.05, 0.16), gap);
      eyes(s, lp, n0, { at: A_EYE, bead: eye, on: body, ring: 1.7 });
      // the lure's light on it: on what faces the lure, falling off with distance; a little
      // round its edge; and a dim light of its own colour from the eye's side, so its round
      // shape reads against the dark water (as the pictures have it)
      const toL = vL.sub(f.w), dl = length(toL), ld = toL.div(dl);
      const facing = max(dot(s.n, ld).add(0.25), 0.0).div(1.25);
      const vv = normalize(cameraPosition.sub(f.w)), rim = pow(float(1.0).sub(abs(dot(s.n, vv))), 2.5);
      const lit = facing.mul(facing).mul(float(2.2).div(dl.div(size).mul(dl.div(size)).mul(5.0).add(1.0)));
      const fill = max(dot(s.n, normalize(vv.add(Up.mul(0.6)))), 0.0).mul(0.2).add(0.07).add(fins.mul(0.08));
      const fade = far(f.dist, 34.0, 48.0);
      s.emis = s.emis.add(s.albedo.mul(LURE_COL.mul(lit).add(vec3(0.75, 0.8, 1.0).mul(fill))).add(LURE_COL.mul(rim.mul(facing).mul(0.05))).mul(float(1.0).sub(lure)).mul(fade));
      s.albedo = mix(s.albedo, lin(0.5, 0.95, 0.88), lure);
      s.emis = s.emis.add(LURE_COL.mul(lure).mul(s.albedo.g.mul(0.5).add(0.75)).mul(fade));
    },
  });
}
// The light round the lure: a soft card where the lure is.
function lureGlowMaterial() {
  return material({
    additive: true,
    vertex: (v) => {
      const t = G.time, c0 = v.P.xy.toVar();
      const pl0 = placed(vec3(0.0), vec3(1.0, 0.0, 0.0));
      const at = placed(turn(vec3(LURE[0], LURE[1], LURE[2]), STALK, 'z', lureSway(t, pl0.phase)), vec3(1.0, 0.0, 0.0));
      const d = length(at.P.sub(cameraPosition));
      v.P.assign(at.P.add(U.right.mul(c0.x).add(U.up.mul(c0.y)).mul(at.size.mul(0.42))));
      v.aux.assign(vec4(c0, 0.0, 0.0));
      vK.assign(vec4(exp(SIG.mul(d).negate()).mul(smoothstep(0.4, 1.2, d)).mul(far(d, 34.0, 48.0)), 0.0));
    },
    raw: (f) => {
      const r2 = dot(f.aux.xy, f.aux.xy);
      const m = exp(r2.mul(-6.0)).mul(0.8).add(exp(r2.mul(-26.0)).mul(0.9)).mul(float(1.0).sub(smoothstep(0.55, 1.0, r2)));
      return { color: lin(0.35, 1.0, 0.9).mul(m).mul(0.55).mul(vK.rgb), alpha: float(1.0) };
    },
  });
}

// ---- the bottle with a message ------------------------------------------------------------

// A small glass bottle, corked, with a rolled letter inside tied with a string (z5lit): the
// glass is its own see-through shape, the rest one solid. Real size (about 37 cm long), the
// neck toward +x. aux.w: 1 cork, 2 paper, 3 string.
const BOTTLE_PROFILE = [[-0.165, 0], [-0.165, 0.044], [-0.16, 0.054], [0.085, 0.056], [0.11, 0.048], [0.128, 0.032], [0.136, 0.025], [0.17, 0.025], [0.173, 0.03], [0.184, 0.03], [0.187, 0.025]];
function bottleShape(lod) {
  const glass = new Mesh(true), inside = new Mesh(true), n = [10, 14, 18][lod], P = BOTTLE_PROFILE;
  const i0 = glass.i.length, b0 = glass.count;
  glass.grid(n, P.length - 1, (s, t, o) => {
    const [x, r] = P[Math.round(t * (P.length - 1))], a = s * TAU;
    o[0] = x; o[1] = Math.cos(a) * r; o[2] = Math.sin(a) * r;
  }, true);
  orient(glass, i0, b0, (x, y, z) => [x < -0.16 ? -1 : 0, y, z]);
  // the cork, the rolled letter lying against the glass, and its string
  tube(inside, [[0.162, 0, 0, 0.0225], [0.19, 0, 0, 0.023], [0.208, 0, 0, 0.0215]], [6, 8, 10][lod], [0, 0, 1]);
  for (let k = 0; k < inside.a.length; k += 4) inside.a[k + 3] = 1;
  const p0 = inside.count;
  tube(inside, [[-0.14, -0.014, 0.004, 0.034], [-0.03, -0.012, 0.0, 0.035], [0.075, -0.01, -0.004, 0.033]], [8, 10, 12][lod], [0, 0, 2]);
  for (let v = p0; v < inside.count; v++) inside.a[v * 4 + 3] = 2;
  const s0 = inside.count, ring = [];
  for (let i = 0; i <= 12; i++) { const a = (i / 12) * TAU; ring.push([-0.035, -0.012 + Math.cos(a) * 0.0365, Math.sin(a) * 0.0365, 0.0035]); }
  tube(inside, ring, 4, [0, 0, 3]);
  for (let v = s0; v < inside.count; v++) inside.a[v * 4 + 3] = 3;
  return { glass: glass.build(), inside: inside.build() };
}
// Placed in its slot; vK.x how much of it the water leaves from here.
function bottleVertex(v) {
  const lp = v.P.toVar(), pl = placed(lp, v.N);
  v.P.assign(pl.P); v.N.assign(pl.N);
  vA.assign(pl.F); vB.assign(pl.Up); vP.assign(lp.mul(3.0));
  const d = length(pl.P.sub(cameraPosition));
  vK.assign(vec4(far(d, 26.0, 40.0), 0.0, 0.0, 0.0));
}
function bottleInsideMaterial() {
  return material({
    aux: true, shadow: false,
    vertex: bottleVertex,
    surface: (s, f) => {
      const part = f.aux.w, F = normalize(vA), Up = normalize(vB);
      const cork = one(part, 1), string = one(part, 3);
      const col = mix(mix(lin(0.93, 0.87, 0.74), lin(0.7, 0.52, 0.34), cork), lin(0.78, 0.56, 0.3), string);
      knit(s, f, { color: col, scale: 30, p: vP, frame: [Up, F, cross(F, Up)], k: 0.5, fuzz: 0.4 });
      s.fluor = float(0.2);
      // (the twilight's own dim light on it: the jellies' and the lure's, from the eye's side)
      const vv = normalize(cameraPosition.sub(f.w));
      s.emis = s.emis.add(s.albedo.mul(max(dot(s.n, vv), 0.0).mul(0.16).add(0.07)).mul(vec3(0.9, 0.95, 1.0)).mul(vK.x));
    },
  });
}
function bottleGlassMaterial() {
  return material({
    transparent: true, twoSided: true, shadow: false,
    vertex: bottleVertex,
    raw: (f) => {
      // glass: clear where it is seen straight through, catching the light at its edges, and a
      // long bright streak down its side and a glint where its curve faces a light above
      const vv = normalize(cameraPosition.sub(f.w)), n = f.n, rim = pow(float(1.0).sub(abs(dot(n, vv))), 2.0);
      const L = normalize(U.up.mul(0.8).add(vv.mul(0.5)).sub(U.right.mul(0.35)));
      const hl = pow(max(dot(normalize(vv.add(L)), n), 0.0), 60.0);
      const k = vK.x;
      return { color: vec3(0.55, 0.85, 0.9).mul(rim.mul(0.35).add(0.02)).add(vec3(1.0).mul(hl.mul(1.6))).mul(k), alpha: min(rim.mul(0.55).add(0.06).add(hl), 1.0).mul(k) };
    },
  });
}

// ---- gulls ------------------------------------------------------------------------------------

// A gull of felt, plump as a toy is: a white body and a big round head, soft grey wings with
// dark tips, a fat yellow beak, bead eyes in felt rings, a small fan of a tail. About a metre
// from wing tip to wing tip, x forward. aux.w: 0 body, 1 wings, 2 beak, 3 tail, 4 eyes.
const GL_HEAD = [0.15, 0.045, 0, 0.066, 0.06, 0.058];
const GL_EYE = (() => { const [hx, hy, , rx, ry, rz] = GL_HEAD, l = Math.hypot(0.55, 0.38, 0.74), x = 0.55 / l, y = 0.38 / l, z = 0.74 / l, r = 0.95 / Math.hypot(x / rx, y / ry, z / rz); return [hx + x * r, hy + y * r, z * r, 0.016]; })();
function gullShape(lod) {
  const m = new Mesh(true), res = [4, 5, 6][lod];
  ball(m, 0, 0, 0, 0.17, 0.075, 0.08, res, 0);
  ball(m, GL_HEAD[0], GL_HEAD[1], GL_HEAD[2], GL_HEAD[3], GL_HEAD[4], GL_HEAD[5], res, 0);
  tube(m, [[0.2, 0.036, 0, 0.022], [0.235, 0.031, 0, 0.016], [0.258, 0.026, 0, 0.009]], 6, [0, 0, 2]);
  for (const side of [1, -1]) ball(m, GL_EYE[0], GL_EYE[1], side * GL_EYE[2], GL_EYE[3], GL_EYE[3], GL_EYE[3], 2, 4);
  for (const side of [1, -1]) {
    pillow(m, 3, lod ? 6 : 4, [0, 1, 0], 1, (s, t, o) => {
      const chord = 0.14 * (1 - 0.5 * Math.pow(t, 1.2)) + 0.02;
      o[0] = 0.04 - 0.07 * t - (s - 0.25) * chord; o[1] = 0.02 + 0.025 * Math.sin(Math.PI * t); o[2] = side * (0.06 + 0.46 * t);
      o[3] = 0.018 * (1 - 0.45 * t) * plump(s, t, 0.7);
    });
  }
  pillow(m, 3, 2, [0, 1, 0], 3, (s, t, o) => {
    const v = s * 2 - 1;
    o[0] = -0.14 - 0.09 * t; o[1] = 0.005; o[2] = v * (0.035 + 0.045 * t);
    o[3] = 0.013 * Math.sqrt(Math.max(1 - v * v, 0));
  });
  return m.build();
}
// Per gull: gA the middle of the circle it rides (x, y, z) and its radius; gB how fast it goes
// round (radians a second), where it starts, its size, its seed.
const gA = attribute('gA', 'vec4'), gB = attribute('gB', 'vec4');
function gullMaterial() {
  return material({
    aux: true, shadow: false,
    vertex: (v) => {
      const t = G.time, lp = v.P.toVar(), ln = v.N.toVar(), part = v.aux.w, seed = gB.w, size = gB.z;
      const th = gB.x.mul(t).add(gB.y).toVar(), ct = cos(th), st = sin(th);
      const c = gA.xyz.add(vec3(ct.mul(gA.w), sin(th.mul(0.7).add(seed.mul(5.0))).mul(0.4), st.mul(gA.w)));
      const T = normalize(vec3(st.negate(), 0.0, ct)).mul(sign(gB.x)).toVar();
      // banked into the turn, toward the middle of its circle
      const Up0 = normalize(UP.add(vec3(ct.negate(), 0.0, st.negate()).mul(0.3)));
      const R = normalize(cross(T, Up0)).toVar(), Up = cross(R, T).toVar();
      // the wings: a few slow beats, then a long glide on them held a little up
      const burst = smoothstep(0.1, 0.7, sin(t.mul(0.42).add(seed.mul(11.0))));
      const flap = sin(t.mul(TAU * 1.25).add(seed.mul(7.0))).mul(0.5).mul(burst).add(0.08);
      const sd = sign(lp.z), wing = one(part, 1);
      const a = flap.mul(sd).negate().mul(wing);
      const q0 = turn(lp, vec3(0.0, 0.02, sd.mul(0.05)), 'x', a), n0 = turnN(ln, 'x', a);
      const q = q0.add(vec3(0.0, flap.mul(smoothstep(0.25, 0.5, abs(lp.z))).mul(0.06).mul(wing), 0.0));
      v.P.assign(c.add(T.mul(q.x).add(Up.mul(q.y)).add(R.mul(q.z)).mul(size)));
      v.N.assign(normalize(T.mul(n0.x).add(Up.mul(n0.y)).add(R.mul(n0.z))));
      vA.assign(T); vB.assign(Up); vP.assign(lp.mul(size).add(seed.mul(3.0)));
    },
    surface: (s, f) => {
      const part = f.aux.w, n0 = s.n, lp = f.obj;
      const wing = one(part, 1), beak = one(part, 2), tail = one(part, 3), eye = one(part, 4);
      const tips = smoothstep(0.4, 0.45, abs(lp.z)).mul(wing);
      const col = mix(mix(mix(lin(0.96, 0.95, 0.92), lin(0.62, 0.65, 0.7), max(wing, tail.mul(0.7))), lin(0.16, 0.16, 0.18), tips), lin(0.98, 0.72, 0.18), beak);
      felt(s, f, { color: col, p: vP, scale: 9 });
      eyes(s, lp, n0, { at: GL_EYE, bead: eye, on: one(part, 0), ring: 1.7 });
    },
  });
}

// ---- jellies and the siphonophore ------------------------------------------------------------

// Per jelly: jA where it lives (x, y, z) and its bell's radius; jB its seed, pulses a second,
// how far it bobs, how long its tentacles are (in bell radii); jC, jD its two yarns (the
// bell's stripes) and, in .w, how brightly it glows and which glow (0 teal, 1 pink).
const jA = attribute('jA', 'vec4'), jB = attribute('jB', 'vec4'), jC = attribute('jC', 'vec4'), jD = attribute('jD', 'vec4');
const vJ0 = varyingProperty('vec4', 'v_j0'), vJ1 = varyingProperty('vec4', 'v_j1'), vJ2 = varyingProperty('vec4', 'v_j2');
const TEAL = lin(0.25, 1.0, 0.88), PINK = lin(1.0, 0.36, 0.78);
const glowOf = (k) => mix(TEAL, PINK, k);
// How long a jelly hangs below its bell's middle, and how far its tentacles may sway, in radii;
// how far it keeps from the submarine (beyond the submarine's own keep-clear radius: about half
// the submarine's length) and from Snap. (jellySpots places them a little nearer than that, so
// as the submarine sinks among them they drift aside from it, gently.)
const J_DRIFT = 0.25, J_SUB = 1.25, J_SNAP = 0.6;
const jLow = (R, Lt) => R * (0.75 + Lt);

// How squeezed the bell is at time t: 0 at rest, 1 squeezed; a soft stroke, a slow refill.
const pulse = (t) => {
  const k = fract(t.mul(jB.y).add(jB.x.mul(7.0)));
  return smoothstep(0.0, 0.3, k).mul(float(1.0).sub(smoothstep(0.32, 0.95, k)));
};
// Where the jelly is: it bobs where it lives, lifting a little with each stroke, and drifts;
// and it keeps clear of the submarine and of Snap, moved aside level.
function jellyAt(t) {
  const s = jB.x, R = jA.w;
  const cyc = t.mul(jB.y).add(s.mul(7.0));
  const c0 = jA.xyz.add(vec3(sin(t.mul(0.031).add(s.mul(6.0))).mul(J_DRIFT), sin(t.mul(0.11).add(s.mul(17.0))).mul(jB.z).add(sin(cyc.mul(TAU).sub(1.0)).mul(0.03)), cos(t.mul(0.027).add(s.mul(9.0))).mul(J_DRIFT))).toVar();
  const low = R.mul(jB.w.add(0.75)), top = R.mul(0.15);
  const c1 = c0.add(levelFrom(c0, top, low, G.subAt.xyz, G.subAt.w.add(J_SUB).add(R.mul(1.05)).add(0.25))).toVar();
  return { c: c1.add(levelFrom(c1, top, low, G.snapAt.xyz, G.snapAt.w.add(J_SNAP).add(R))), fade: float(1.0) };
}
// What the water leaves of a jelly's light, from here.
const jellyKeep = (c, fade) => { const d = length(c.sub(cameraPosition)); return exp(SIG.mul(d).negate()).mul(fade).mul(smoothstep(0.5, 1.6, d)).mul(far(d, 32.0, 44.0)); };

// The bell: a crocheted dome in two colours of stripes, worked in rounds from its top, and a
// rolled rim; on its front a face, as an amigurumi jelly has (bead eyes in felt rings, a smile,
// pink cheeks), turned to where the visitor passes. The light is inside it: its lower rows glow
// through the yarn, brighter as it squeezes, a ring of glowing beads shows through just above
// the rim, and seen from below the inside of the dome is lit. aux = (from the top 0 to the rim 1
// and past it round the rolled edge, round 0..1; for the eyes: their middle, and 4). The bell is
// a unit wide; its face looks along +x.
const J_EYE = [0.857, -0.354, 0.322, 0.12], J_CHEEK = [0.759, -0.497, 0.539, 0.075];
function bellShape(lod) {
  const m = new Mesh(true), nb = [6, 8, 10][lod], na = [14, 18, 24][lod];
  const prof = [];
  for (let i = 0; i <= nb; i++) { const ph = (1.55 * i) / nb; prof.push([Math.sin(ph), 0.78 * (Math.cos(ph) - 1), i / nb]); }
  prof.push([1.07, -0.8, 1.05], [1.06, -0.9, 1.1], [0.96, -0.9, 1.15]);
  const i0 = m.i.length, base = m.count;
  m.grid(na, prof.length - 1, (s, t, o) => {
    const [r, y, tb] = prof[Math.round(t * (prof.length - 1))], a = s * TAU;
    o[0] = Math.cos(a) * r; o[1] = y; o[2] = Math.sin(a) * r; o[3] = tb; o[4] = s;
  }, true);
  orient(m, i0, base, (x, y, z) => [x, y + 0.2, z]);
  for (const side of [1, -1]) ball(m, J_EYE[0], J_EYE[1], side * J_EYE[2], J_EYE[3], J_EYE[3], J_EYE[3], 2, 4);
  return m.build();
}
// (each jelly's which glow (0 teal, 1 pink) and which way its face looks, in jD.w: the glow, and
// the turn about the vertical as a fraction of a whole one)
const glowKind = () => floor(jD.w), faceTurn = () => fract(jD.w).mul(TAU);
function bellMaterial() {
  return material({
    aux: true, twoSided: true, shadow: false, fade: [30, 44],
    vertex: (v) => {
      const t = G.time, R = jA.w, J = jellyAt(t), con = pulse(t);
      const lp = v.P.toVar(), ln = v.N.toVar(), tb = v.aux.x;
      const sq = float(1.0).sub(con.mul(0.16).mul(pow(min(tb, 1.0), 1.3))), st = con.mul(0.08).add(1.0);
      const tilt = vec2(sin(t.mul(0.37).add(jB.x.mul(17.0))), cos(t.mul(0.31).add(jB.x.mul(11.0)))).mul(0.1);
      // (turned so that its face looks where the visitor passes)
      const yw = faceTurn(), cy = cos(yw), sy = sin(yw);
      const lr = vec3(lp.x.mul(cy).sub(lp.z.mul(sy)), lp.y, lp.x.mul(sy).add(lp.z.mul(cy))), nr = vec3(ln.x.mul(cy).sub(ln.z.mul(sy)), ln.y, ln.x.mul(sy).add(ln.z.mul(cy)));
      const q = vec3(lr.x.mul(sq).sub(lr.y.mul(tilt.x)), lr.y.mul(st), lr.z.mul(sq).sub(lr.y.mul(tilt.y)));
      v.P.assign(J.c.add(q.mul(R)));
      v.N.assign(normalize(vec3(nr.x.div(sq), nr.y.div(st), nr.z.div(sq))));
      vJ0.assign(vec4(jellyKeep(J.c, J.fade), con));
      vJ1.assign(jC); vJ2.assign(vec4(jD.xyz, glowKind()));
      // (its middle; the stitches' rounds: round it, and down from its top)
      vP.assign(J.c);
      vK.assign(vec4(v.aux.y.mul(floor(R.mul((2 * Math.PI * STITCH) / 8).add(0.5)).mul(8.0)), tb.mul(R.mul(1.25 * STITCH)), 0.0, 0.0));
    },
    surface: (s, f) => {
      const tb = f.aux.x, glow = glowOf(vJ2.w), keep = vJ0.rgb, con = vJ0.w, n0 = s.n, lp = f.obj;
      const eye = one(f.aux.w, 4);
      // (which side is seen: the outside of the dome, or its inside, from below)
      const vv = normalize(cameraPosition.sub(f.w)), inside = step(dot(normalize(vNrm), vv), 0.0).mul(float(1.0).sub(eye));
      const Ta = normalize(cross(UP, f.w.sub(vP)).add(vec3(1e-4, 0.0, 0.0)));
      const st = { a: vK.x, b: vK.y, ga: vec2(dFdx(vK.x), dFdy(vK.x)), gb: vec2(dFdx(vK.y), dFdy(vK.y)), Ta, Tb: normalize(cross(Ta, s.n)) };
      stitches(s, f, { color: vJ1.rgb, color2: vJ2.rgb, stripe: 5, st, k: 1.3 });
      // the face, on the outside: bead eyes in felt rings, a smile, pink cheeks
      const out = float(1.0).sub(inside), px = pixel(vec3(lp.z, lp.y, 0.0));
      const ring = eyes(s, lp, n0, { at: J_EYE, bead: eye, on: out, ring: 1.65 });
      const smile = arc(lp.z, lp.y.add(0.6), float(0.15), float(0.06), float(0.022), px).mul(out).mul(smoothstep(0.6, 0.75, lp.x)).mul(float(1.0).sub(eye));
      const cheek = spot(length(vec3(lp.x.sub(J_CHEEK[0]), lp.y.sub(J_CHEEK[1]), abs(lp.z).sub(J_CHEEK[2]))), float(0.0), float(J_CHEEK[3]), px).mul(out).mul(float(1.0).sub(eye));
      sew(s, n0, smile, cheek);
      const face = max(max(ring, smile), cheek.mul(0.6));
      const rim = smoothstep(0.97, 1.03, tb).mul(float(1.0).sub(eye));
      // a ring of glowing beads under the yarn, a little above the rim
      const cell = vec2(fract(f.aux.y.mul(18.0)).sub(0.5), tb.sub(0.84).mul(6.0));
      const beads = float(1.0).sub(smoothstep(0.18, 0.34, length(cell))).mul(out).mul(float(1.0).sub(eye));
      const through = smoothstep(0.35, 1.0, tb).mul(0.45).add(0.06).add(con.mul(0.3));
      const lightIn = through.mul(out).add(inside.mul(float(1.1).add(con.mul(0.4)))).add(rim.mul(0.6)).mul(float(1.0).sub(face.mul(0.8)));
      const k = vJ1.w.mul(keep.mul(0.65).add(0.35)).mul(float(1.0).sub(eye));
      s.emis = s.emis.add(s.albedo.mul(glow.mul(0.7).add(0.35)).mul(lightIn).add(glow.mul(beads).mul(1.1)).mul(k));
    },
  });
}
// Its tentacles: many thin strands of yarn, each its own colour (teal, lilac, pink), hanging
// from under the rim; and from the middle a few pink oral arms in tight corkscrew curls. Each
// point follows the bell as it was a moment before, so the pulse runs down them. They are lit
// by the bell's light, most near it. aux = (along, round, where round the bell 0..1, kind: 0 a
// strand, 1 an arm, plus half its length 0.3..0.5).
const J_STRANDS = [8, 11, 14], J_ARMS = [3, 3, 4];
function tentacleShape(lod) {
  const m = new Mesh(true), rng = makeRng(31), ns = [9, 12, 15][lod], nside = [3, 4, 4][lod], na = [24, 30, 36][lod];
  const n = J_STRANDS[lod], nArm = J_ARMS[lod];
  tubes(m, n, ns, nside, () => rng.range(0.6, 1.0) * 0.5);
  const first = m.count;
  tubes(m, nArm, na, 5, () => 1 + rng.range(0.75, 1.0) * 0.5);
  for (let v = 0; v < m.count; v++) m.a[v * 4 + 2] = v < first ? (m.a[v * 4 + 2] + 0.5) / n : (m.a[v * 4 + 2] + 0.3) / nArm;
  return m.build();
}
// (a strand's own numbers from where round the bell it hangs: how far out under the rim, its colour)
const hashJ = (x, k) => fract(sin(x.mul(k)).mul(43758.5453));
function tentacleMaterial() {
  return material({
    aux: true, shadow: false, fade: [30, 44],
    vertex: (v) => {
      const t = G.time, R = jA.w, J = jellyAt(t);
      const s = v.aux.x, phi = v.aux.y.mul(TAU), w = v.aux.z, ang = w.mul(TAU).add(hashJ(w.add(jB.x), 91.7).mul(0.5)), arm = step(1.0, v.aux.w), lf = fract(v.aux.w).mul(2.0);
      const conL = pulse(t.sub(s.mul(0.9)));
      const len = R.mul(jB.w).mul(lf).mul(mix(float(1.0), float(0.62), arm)).toVar();
      const out = vec3(cos(ang), 0.0, sin(ang)), tang = vec3(sin(ang).negate(), 0.0, cos(ang));
      const rOut = mix(hashJ(w.add(jB.x), 37.3).mul(0.32).add(0.55), float(0.2), arm);
      const at = (ss) => {
        // each strand sways on its own, more toward its end, and drifts a little out from under the bell
        const ph = t.mul(0.55).add(ss.mul(3.4)).add(ang.mul(2.0)).add(jB.x.mul(9.0)).add(w.mul(17.0));
        const sway = vec3(sin(ph), 0.0, cos(ph.mul(0.83).add(1.3))).mul(ss.mul(ss).mul(len).mul(0.2)).add(out.mul(ss.mul(len).mul(0.12)))
          .add(vec3(sin(ss.mul(9.0).add(ang.mul(3.0)).add(t.mul(0.8))), 0.0, cos(ss.mul(8.0).add(ang.mul(2.0)).add(t.mul(0.7)))).mul(R.mul(0.07).mul(ss)));
        // a strand hangs from under the rim, drawn in a little as the bell squeezes
        const cord = out.mul(R.mul(rOut.mul(float(1.0).sub(conL.mul(0.12)))).mul(float(1.0).sub(ss.mul(0.2))));
        // an arm winds tightly round a line that hangs from near the middle
        const th = ss.mul(len).div(R.mul(0.075)).add(t.mul(0.7)).add(w.mul(9.0));
        const coil = out.mul(R.mul(0.2)).add(vec3(cos(th), 0.0, sin(th)).mul(R.mul(0.075)));
        return J.c.add(mix(cord, coil, arm)).add(vec3(0.0, R.mul(-0.68).sub(ss.mul(len).mul(float(1.0).sub(conL.mul(0.08)))), 0.0)).add(sway);
      };
      const C0 = at(s).toVar(), T = normalize(at(s.add(0.01)).sub(C0)).toVar();
      const r = R.mul(mix(float(0.034), float(0.06), arm)).mul(float(1.0).sub(s.mul(0.3))).mul(sqrt(min(float(1.0).sub(s).mul(30.0), 1.0)));
      const rg = ringAt(C0, T, tang, phi, r);
      v.P.assign(rg.p); v.N.assign(rg.n);
      vJ0.assign(vec4(jellyKeep(J.c, J.fade), s));
      vJ1.assign(jC); vJ2.assign(vec4(jD.xyz, glowKind()));
      vA.assign(rg.S); vB.assign(T);
      vP.assign(vec3(cos(phi).mul(0.02), s.mul(len), sin(phi).mul(-0.02)).add(w.mul(7.0)));
    },
    surface: (s, f) => {
      const A = normalize(vA), B = normalize(vB), along = vJ0.w, arm = step(1.0, f.aux.w);
      const glow = glowOf(vJ2.w);
      // the strands' yarns: teal, lilac, pink, a pale periwinkle; the arms pink
      const pick = hashJ(f.aux.z.add(vJ2.w.mul(0.37)), 57.1);
      const strand = mix(mix(lin(0.36, 0.84, 0.84), lin(0.7, 0.62, 0.92), step(0.3, pick)), mix(lin(0.93, 0.44, 0.74), lin(0.6, 0.7, 0.95), step(0.82, pick)), step(0.55, pick));
      const col = mix(strand, lin(0.9, 0.36, 0.64), arm);
      knit(s, f, { color: col, scale: STITCH, p: vP, frame: [A, B, cross(A, B)], k: 1.2 });
      // the bell's light on the yarn, strongest near it; a little of the yarn's own glow; the
      // teal ones glow most
      const near = exp(along.mul(-2.6)), teal = float(1.0).sub(step(0.3, pick)).mul(float(1.0).sub(arm));
      const lit = glow.mul(near.mul(1.3)).add(0.3).add(teal.mul(0.35)).mul(vJ1.w).mul(vJ0.rgb.mul(0.65).add(0.35));
      s.emis = s.emis.add(s.albedo.mul(lit));
    },
  });
}
// The haze of light round each jelly, from inside its bell.
function haloMaterial() {
  return material({
    additive: true,
    vertex: (v) => {
      const J = jellyAt(G.time), c0 = v.P.xy.toVar();
      v.P.assign(J.c.sub(vec3(0.0, jA.w.mul(0.55), 0.0)).add(U.right.mul(c0.x).add(U.up.mul(c0.y)).mul(jA.w.mul(2.6))));
      v.aux.assign(vec4(c0, 0.0, 0.0));
      vJ0.assign(vec4(jellyKeep(J.c, J.fade), 0.0));
      vJ2.assign(vec4(jD.xyz, glowKind())); vJ1.assign(jC);
    },
    raw: (f) => {
      const r2 = dot(f.aux.xy, f.aux.xy);
      const m = exp(r2.mul(-4.0)).mul(float(1.0).sub(smoothstep(0.5, 1.0, r2)));
      return { color: glowOf(vJ2.w).mul(m).mul(0.06).mul(vJ1.w).mul(vJ0.rgb), alpha: float(1.0) };
    },
  });
}

// The siphonophore (z5lit; the twilight's tags call it a glowing worm): a glowing teal core,
// beaded as if strung, and all along it loops of fat crocheted cord, uneven in size and lean, sticking out above it in teal and periwinkle and
// below it in pink and magenta, a lilac one here and there; at each end its free cords curl.
// The core lights the loops from inside: they glow where they meet it. Built in the shader,
// along a line that sways and arches: aux = (along 0..1, round 0..1, which, kind: 1 the core,
// 0 a loop, 2 a curl). Where it is comes in every frame (SI).
const SI = { c: uniform(new Vector3(0, -1000, 0)), d: uniform(new Vector3(1, 0, 0)), n: uniform(new Vector3(0, 0, 1)), len: uniform(14), k: uniform(1), show: uniform(1) };
const S_LOOPS = [44, 60, 76], S_CURLS = 8;
function siphonoShape(lod) {
  const m = new Mesh(true);
  tubes(m, 1, [70, 100, 130][lod], 6, () => 1);
  tubes(m, S_LOOPS[lod], [10, 13, 16][lod], 4, () => 0);
  tubes(m, S_CURLS, [16, 20, 24][lod], 4, () => 2);
  return m.build();
}
function siphonoMaterial(lod) {
  const nL = S_LOOPS[lod], rc = SI.k.mul(0.052), rCore = SI.k.mul(0.1);
  const h1 = (x) => fract(sin(x.mul(12.9898).add(4.1)).mul(43758.5453)), h2 = (x) => fract(sin(x.mul(78.233).add(1.7)).mul(24634.6345));
  return material({
    aux: true, shadow: false, fade: [40, 54],
    vertex: (v) => {
      const t = G.time, s = v.aux.x, phi = v.aux.y.mul(TAU), k = v.aux.z, kind = v.aux.w;
      const len = SI.len, D = SI.d, N2 = SI.n, N1 = normalize(cross(N2, D)).toVar();
      const spine = (ss) => SI.c.add(D.mul(ss.sub(0.5).mul(len))).add(N1.mul(sin(ss.mul(TAU * 1.1).sub(t.mul(0.21))).mul(SI.k.mul(0.3))))
        .add(N2.mul(sin(ss.mul(TAU * 0.7).add(t.mul(0.17)).add(1.3)).mul(SI.k.mul(0.6)))).add(vec3(0.0, sin(ss.mul(Math.PI)).mul(SI.k.mul(0.5)), 0.0));
      const isCore = one(kind, 1), isCurl = one(kind, 2);
      // a loop: where along the core it hangs, which way it leans out round it (above or below,
      // a little toward or away from the eye), how long and how wide
      const sk = select(isCurl.greaterThan(0.5), step(S_CURLS / 2 - 0.5, k), k.add(0.5).add(h1(k).sub(0.5).mul(0.7)).div(nL).mul(0.94).add(0.03)).toVar();
      const S = spine(sk).toVar(), T = normalize(spine(sk.add(0.003)).sub(S)).toVar();
      const side = select(h2(k.add(5.3)).lessThan(0.52), float(1.0), float(-1.0));
      const lean = side.mul(Math.PI / 2).sub(Math.PI / 2).add(h2(k).sub(0.5).mul(1.9)).add(sin(t.mul(0.5).add(k.mul(1.7))).mul(0.12));
      const n1 = normalize(cross(T, N2)).toVar(), n2 = cross(T, n1).toVar();
      const O = n1.mul(cos(lean)).add(n2.mul(sin(lean))).toVar();
      const L = SI.k.mul(h1(k.add(3.1)).mul(0.26).add(0.3)), W = L.mul(h2(k.add(7.7)).mul(0.2).add(0.34));
      // (a loop starts and ends at the core: narrow at its foot, round at its end)
      const loopAt = (u) => {
        const a = u.mul(TAU), up = float(1.0).sub(cos(a)).mul(0.5);
        return S.add(T.mul(sin(a).mul(W).mul(up.mul(0.75).add(0.25)))).add(O.mul(up.mul(L))).add(cross(T, O).mul(sin(a.mul(2.0)).mul(W).mul(0.18)));
      };
      // a curl: off an end of the core, curling round and in, as a loose cord does
      const end = select(sk.greaterThan(0.5), float(1.0), float(-1.0)), Te = T.mul(end);
      const curlAt = (u) => {
        const b = u.mul(Math.PI * 2.6), rr = L.mul(0.55).mul(float(1.0).sub(u.mul(0.62)));
        return S.add(Te.mul(sin(b).mul(rr).add(u.mul(L).mul(0.35)))).add(O.mul(float(1.0).sub(cos(b)).mul(rr)));
      };
      const P0 = select(isCurl.greaterThan(0.5), curlAt(s), loopAt(s)).toVar();
      const Tl = normalize(select(isCurl.greaterThan(0.5), curlAt(s.add(0.01)), loopAt(s.add(0.01))).sub(P0)).toVar();
      // the core: beaded
      const C0 = spine(s).toVar(), Tc = normalize(spine(s.add(0.002)).sub(C0)).toVar();
      const bead = sin(s.mul(TAU * 70.0)).mul(0.2).add(1.0);
      const coreR = rCore.mul(bead).mul(smoothstep(0.0, 0.02, s).mul(float(1.0).sub(smoothstep(0.98, 1.0, s))).mul(0.7).add(0.3));
      const ring = ringAt(select(isCore.greaterThan(0.5), C0, P0), select(isCore.greaterThan(0.5), Tc, Tl), select(isCore.greaterThan(0.5), N2, cross(T, O)), phi, select(isCore.greaterThan(0.5), coreR, rc.mul(float(1.0).sub(isCurl.mul(s).mul(0.4)))));
      v.P.assign(ring.p); v.N.assign(ring.n);
      vA.assign(ring.S); vB.assign(select(isCore.greaterThan(0.5), Tc, Tl));
      vP.assign(vec3(cos(phi).mul(0.03), s.mul(select(isCore.greaterThan(0.5), len, L.mul(2.2))), sin(phi).mul(-0.03)).div(SI.k).add(k.mul(3.7)));
      const dc = length(C0.sub(cameraPosition));
      vJ0.assign(vec4(exp(SIG.mul(dc).mul(0.6).negate()).mul(far(dc, 38.0, 52.0)), select(isCore.greaterThan(0.5), s, sk)));
      // (for a loop: how near the core this point is, 1 at its foot, and which way it leans)
      vJ1.assign(vec4(kind, select(isCurl.greaterThan(0.5), float(1.0).sub(s), float(1.0).sub(float(1.0).sub(cos(s.mul(TAU))).mul(0.5))), side, h1(k.add(11.3))));
      vJ2.assign(vec4(normalize(S.sub(P0).add(O.mul(0.001))), 0.0));
    },
    surface: (s, f) => {
      const A = normalize(vA), B = normalize(vB), along = vJ0.w, core = one(vJ1.x, 1), foot = vJ1.y, up = step(0.0, vJ1.z), pick = vJ1.w;
      // above: teal and periwinkle; below: pink and magenta; a lilac one now and then; the
      // two ends a little more pink
      const above = mix(lin(0.36, 0.72, 0.82), lin(0.5, 0.6, 0.86), step(0.5, pick));
      const below = mix(lin(0.93, 0.4, 0.66), lin(0.82, 0.3, 0.6), step(0.5, pick));
      const pinkEnds = float(1.0).sub(smoothstep(0.05, 0.3, along)).mul(0.5).add(smoothstep(0.75, 0.97, along).mul(0.3));
      const loopCol = mix(mix(above, below, max(float(1.0).sub(up), step(fract(pick.mul(7.13)), pinkEnds))), lin(0.72, 0.62, 0.9), step(0.86, pick));
      const coreCol = lin(0.55, 1.0, 0.92);
      knit(s, f, { color: mix(loopCol, coreCol, core), scale: STITCH, p: vP, frame: [A, B, cross(A, B)], k: 1.2 });
      // light: the core glows; a loop is lit by it at its foot, faces toward the core most,
      // and has a little of its own colour's light all along, so it reads in the dark
      const inward = max(dot(s.n, normalize(vJ2.xyz)), 0.0);
      const ends = smoothstep(0.0, 0.03, along).mul(float(1.0).sub(smoothstep(0.97, 1.0, along)));
      const loopLit = TEAL.mul(pow(foot, 3.0).mul(1.4).add(inward.mul(foot).mul(0.5))).add(0.32);
      const beads = sin(along.mul(TAU * 70.0)).mul(0.5).add(0.5);
      const glow = s.albedo.mul(loopLit).mul(float(1.0).sub(core)).add(coreCol.mul(core).mul(s.albedo.g.mul(1.1).add(0.45).add(beads.mul(0.5))));
      // (above the drop-off it is not there: it melts into the water behind it)
      const vv = normalize(f.w.sub(cameraPosition));
      const beyond = scatter(vv, float(300.0)).sub(scatter(vv, f.dist)).mul(exp(SIG.mul(f.dist)));
      s.albedo = s.albedo.mul(SI.show); s.spec = s.spec.mul(SI.show);
      s.emis = s.emis.mul(SI.show).add(glow.mul(mix(ends, float(1.0), float(1.0).sub(core))).mul(vJ0.rgb.mul(0.4).add(0.6)).mul(SI.show)).add(beyond.mul(SI.show.oneMinus()));
    },
  });
}

// ---- the vents ------------------------------------------------------------------------------

// The vents are dark but for the lava: what lives there gets a soft light from the eye's
// side too, as a diorama is lit for its picture, so it reads against the black.
function ventFill(s, f, k = 1, col = vec3(0.17, 0.12, 0.1)) {
  const deep = smoothstep(150.0, 185.0, f.w.y.negate()), v = normalize(cameraPosition.sub(f.w));
  s.emis = s.emis.add(s.albedo.mul(col.mul(k)).mul(max(dot(s.n, v), 0.0).mul(0.65).add(0.35)).mul(deep));
}
// Tube worms (z6, and the painted dive's worms): fat stuffed tubes of crochet, white below,
// striped red and white up their top part, closed in a round red dome; from the dome a crown
// of fat red plumes, which pull in fast when the visitor's hand comes near their clump (or the
// submarine settles by it) and come out again slowly. In clumps, leaning out a little from
// each other. Built in the shader from rings: aux = (along, round, which plume, 0 the tube or
// 1 a plume). Per worm: wA its foot (x, y, z) and height; wB its lean (x, z), its seed, and
// how much of it is striped; wC its clump. The taller the worm, the fatter.
const wA = attribute('wA', 'vec4'), wB = attribute('wB', 'vec4'), wC = attribute('wC', 'vec4');
const PLUMES = [3, 4, 4], W_CLUMPS = 32;
// how far in each clump's plumes are (0 out, 1 in), four clumps to a vec4; set every frame
const WIN = uniformArray(Array.from({ length: W_CLUMPS / 4 }, () => new Vector4(0, 0, 0, 0)), 'vec4');
function wormShape(lod) {
  const m = new Mesh(true);
  tubes(m, 1, [8, 9, 10][lod], [6, 7, 7][lod], () => 0);
  tubes(m, PLUMES[lod], [3, 4, 4][lod], [4, 4, 4][lod], () => 1);
  return m.build();
}
function wormMaterial(lod) {
  const nP = PLUMES[lod];
  return material({
    aux: true, shadow: false,
    vertex: (v) => {
      const t = G.time, s = v.aux.x, phi = v.aux.y.mul(TAU), j = v.aux.z, plume = v.aux.w;
      const seed = wB.z, rw = wA.w.mul(0.062).add(0.05);
      // its clump's plumes: in (1) or out (0)
      const ci = wC.x, w4 = WIN.element(int(floor(ci.div(4.0)))), cc = ci.sub(floor(ci.div(4.0)).mul(4.0));
      const duck = select(cc.lessThan(0.5), w4.x, select(cc.lessThan(1.5), w4.y, select(cc.lessThan(2.5), w4.z, w4.w))).toVar();
      const H = wA.w.mul(float(1.0).sub(duck.mul(0.05)));
      // (a tall one leans away from the submarine where it passes low over them)
      const lean = awayFrom(wA.xyz.add(vec3(0.0, H, 0.0)), G.subAt.xyz, G.subAt.w.add(0.35)).div(H);
      const sway = vec2(sin(t.mul(0.5).add(seed.mul(20.0))), cos(t.mul(0.43).add(seed.mul(13.0)))).mul(0.04).add(wB.xy).add(lean.xz);
      const stem = (ss) => wA.xyz.add(vec3(sway.x.mul(ss).mul(ss).mul(H), ss.mul(H), sway.y.mul(ss).mul(ss).mul(H)));
      // the tube, a little wider toward its top, closed in a round dome (the last rings of it)
      const hs = min(s.div(0.6), 1.0).toVar(), dome = max(s.sub(0.6), 0.0).div(0.4).mul(Math.PI / 2);
      const C1 = stem(hs).toVar(), T1 = normalize(stem(hs.add(0.02)).sub(stem(hs.sub(0.0)))).toVar();
      const rT = rw.mul(hs.mul(0.12).add(0.94));
      const tube = ringAt(C1.add(T1.mul(rT.mul(0.9).mul(sin(dome)))), T1, vec3(1.0, 0.0, 0.0), phi, rT.mul(cos(dome)));
      // a plume: from inside the dome's top, up and curling out, fat, round at its tip; it
      // shrinks back in as the worm ducks
      const out = float(1.0).sub(duck), top = stem(float(1.0)).toVar(), Tt = normalize(top.sub(stem(float(0.97)))).toVar();
      const S0 = normalize(vec3(1.0, 0.0, 0.0).sub(Tt.mul(Tt.x))).toVar(), B0 = cross(Tt, S0);
      const aj = j.div(nP).mul(TAU).add(seed.mul(5.0)), O = S0.mul(cos(aj)).add(B0.mul(sin(aj))).toVar();
      const Lp = H.mul(0.2).add(rw.mul(0.9)).mul(out).add(0.002), base = top.add(Tt.mul(rw.mul(mix(float(-0.6), float(0.5), out)))).add(O.mul(rw.mul(0.42)));
      const wave = sin(t.mul(1.3).add(j.mul(2.0)).add(seed.mul(9.0))).mul(0.1);
      const at = (u) => base.add(Tt.mul(Lp.mul(u).mul(0.8))).add(O.mul(Lp.mul(u.mul(u)).mul(wave.add(0.7))));
      // (its last rings close it in a round cap, as a stuffed finger ends)
      const r0 = rw.mul(0.42).mul(out.mul(0.5).add(0.5)), u0 = min(s, 0.68), ca = max(s.sub(0.68), 0.0).div(0.32).mul(Math.PI / 2);
      const P0w = at(u0).toVar(), Tp = normalize(at(u0.add(0.02)).sub(P0w).add(Tt.mul(1e-4))).toVar();
      const rEnd = r0.mul(0.8);
      const P1 = P0w.add(Tp.mul(rEnd.mul(sin(ca))));
      const rp = select(s.greaterThan(0.68), rEnd.mul(cos(ca)), r0.mul(float(1.0).sub(u0.mul(0.3))));
      const fin = ringAt(P1, Tp, O, phi, rp);
      const isP = plume.greaterThan(0.5);
      v.P.assign(select(isP, fin.p, tube.p)); v.N.assign(select(isP, fin.n, tube.n));
      vB.assign(select(isP, Tp, T1));
      // (stitch coordinates: round, and along in rows; how far up the tube)
      const N = floor(rw.mul((2 * Math.PI * STITCH) / 8).add(0.5)).mul(8.0);
      vK.assign(vec4(v.aux.y.mul(select(isP, N.mul(0.5), N)), select(isP, s.mul(Lp), hs.mul(H).add(dome.mul(rT.mul(0.9)))).mul(STITCH), select(isP, float(2.0), s.div(0.6)), wB.w));
    },
    surface: (s, f) => {
      const T = normalize(vB), red = lin(0.9, 0.3, 0.26), white = lin(0.96, 0.94, 0.9);
      // white below; striped red and white up its top part; the dome and the plumes red
      const up = vK.z, stripe = step(0.5, fract(vK.y.div(14.0)));
      const col = mix(white, mix(mix(white, red, stripe), red, step(1.0, up)), step(float(1.0).sub(vK.w), up));
      const st = { a: vK.x, b: vK.y, ga: vec2(dFdx(vK.x), dFdy(vK.x)), gb: vec2(dFdx(vK.y), dFdy(vK.y)), Ta: normalize(cross(s.n, T)), Tb: T };
      stitches(s, f, { color: col, st, k: 1.4 });
      ventFill(s, f, 1.6);
    },
  });
}

// Sea sheep (z6): little fluffy cream creatures of crochet, a round body with a face of two
// big bead eyes in felt rings, a stitched smile and pink cheeks, two soft round ears on top,
// and stubby legs all round, splayed over the rock they sit on. aux.w: 0 wool, 4 eyes. Per
// sheep: hA where it sits and its size; hB which way it faces, its seed.
const hA = attribute('hA', 'vec4'), hB = attribute('hB', 'vec4');
const SH_BODY = [0, 0.11, 0, 0.135, 0.115, 0.13];
const onSheep = (d, k) => { const [bx, by, bz, rx, ry, rz] = SH_BODY, l = Math.hypot(...d), x = d[0] / l, y = d[1] / l, z = d[2] / l, r = k / Math.hypot(x / rx, y / ry, z / rz); return [bx + x * r, by + y * r, bz + z * r]; };
const SH_EYE = [...onSheep([0.78, 0.3, 0.55], 0.97), 0.032], SH_CHEEK = [...onSheep([0.555, -0.202, 0.807], 1.0), 0.024];
function sheepShape(lod) {
  const m = new Mesh(true), rng = makeRng(5), res = [6, 7, 9][lod];
  ball(m, SH_BODY[0], SH_BODY[1], SH_BODY[2], SH_BODY[3], SH_BODY[4], SH_BODY[5], res, 0);
  // the legs: round the back and the sides (not under the face), splayed out and down
  const legs = [55, 95, 135, 175, 215, 255, 300];
  for (const deg of legs) {
    const a = (deg + rng.range(-10, 10)) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), l = rng.range(0.13, 0.17), r = rng.range(0.042, 0.052);
    tube(m, [[c * 0.05, 0.1, s * 0.05, r * 1.05], [c * (0.06 + l * 0.55), 0.075, s * (0.06 + l * 0.55), r], [c * (0.06 + l), 0.035, s * (0.06 + l), r * 0.95]], [5, 6, 7][lod], [0, 0, 0]);
  }
  // the ears: soft nubs on top, leaning out; the eyes
  for (const side of [1, -1]) {
    ball(m, -0.005, 0.225, side * 0.055, 0.032, 0.05, 0.03, Math.max(res - 3, 3), 0);
    ball(m, SH_EYE[0], SH_EYE[1], side * SH_EYE[2], SH_EYE[3], SH_EYE[3], SH_EYE[3], 3, 4);
  }
  return m.build();
}
function sheepMaterial() {
  return material({
    aux: true, shadow: false,
    vertex: (v) => {
      const t = G.time, lp = v.P.toVar(), ln = v.N.toVar(), seed = hB.z;
      // it breathes, and now and then looks about
      const b = sin(t.mul(1.1).add(seed.mul(20.0))).mul(0.025);
      const look = sin(t.mul(0.23).add(seed.mul(7.0))).mul(0.25).mul(smoothstep(0.06, 0.12, lp.y).mul(smoothstep(-0.02, 0.06, lp.x)));
      const q = turn(vec3(lp.x, lp.y.mul(b.add(1.0)), lp.z.mul(b.mul(0.5).add(1.0))), vec3(0.0, 0.1, 0.0), 'y', look);
      const F = vec3(cos(hB.x), 0.0, sin(hB.x)), R = vec3(sin(hB.x).negate(), 0.0, cos(hB.x));
      v.P.assign(hA.xyz.add(F.mul(q.x).add(UP.mul(q.y)).add(R.mul(q.z)).mul(hA.w)));
      v.N.assign(normalize(F.mul(ln.x).add(UP.mul(ln.y)).add(R.mul(ln.z))));
      vA.assign(F); vP.assign(lp.mul(hA.w).add(seed.mul(3.0)));
    },
    surface: (s, f) => {
      const n0 = s.n, F = normalize(vA), lp = f.obj, eye = one(f.aux.w, 4);
      knit(s, f, { color: lin(0.96, 0.9, 0.76), scale: STITCH, p: vP, frame: [F, UP, cross(F, UP)], k: 1.7, fuzz: 2.6 });
      ventFill(s, f, 3.0, vec3(0.16, 0.14, 0.13));
      // the face: bead eyes in felt rings, a smile, cheeks
      eyes(s, lp, n0, { at: SH_EYE, bead: eye, on: float(1.0), ring: 1.7 });
      const px = pixel(vec3(lp.z, lp.y, 0.0)), front = smoothstep(0.1, 0.12, lp.x).mul(float(1.0).sub(eye));
      const smile = arc(lp.z, lp.y.sub(0.09), float(0.034), float(0.016), float(0.0055), px).mul(front);
      const cheek = spot(length(vec3(lp.x.sub(SH_CHEEK[0]), lp.y.sub(SH_CHEEK[1]), abs(lp.z).sub(SH_CHEEK[2]))), float(0.0), float(SH_CHEEK[3]), px).mul(float(1.0).sub(eye));
      sew(s, n0, smile, cheek);
    },
  });
}
// The rock the big sea sheep sits on: a lump of the vents' black rock (as the ground's own
// rock is shaded, terrain.js), crusted teal near its foot.
function rockShape(lod) {
  const m = new Mesh(false);
  blob(m, 0, 0, 0, (x, y, z) => (1 + 0.22 * noise3(x * 1.7 + 3.1, y * 1.7, z * 1.7) + 0.1 * noise3(x * 4.1, y * 4.1 + 2, z * 4.1)) * (y < 0 ? 0.8 : 1), [6, 8, 10][lod]);
  return m.build();
}
function sheepRockMaterial() {
  return material({
    shadow: false, fade: [60, 78],
    surface: (s, f) => { rockSurf(s, f.w.mul(2.5), f.w, float(1.0), float(1.0), f.dist); ventFill(s, f, 2.2); },
  });
}

// ---- what drifts ----------------------------------------------------------------------------

// Specks of the sea: soft round flecks in a box that moves with the eye (each wraps round
// it), drifting and sinking slowly. In the light they are pale motes, bright against the
// light, and they thin out as the light goes; lower down are the twilight's own: gold, and
// some teal, glowing a little and blinking slowly. sA: where in the box (0..1), and its seed.
const sA = attribute('sA', 'vec4'), vSnow = varyingProperty('vec4', 'v_snow');
function speckMaterial(B, deep) {
  return material({
    additive: true,
    vertex: (v) => {
      const t = G.time, s = sA.w, c0 = v.P.xy.toVar();
      const flow = vec3(t.mul(0.04), t.mul(deep ? 0.006 : -0.025), t.mul(0.03)).add(vec3(sin(t.mul(0.31).add(s.mul(61.0))), sin(t.mul(0.23).add(s.mul(47.0))).mul(0.5), cos(t.mul(0.27).add(s.mul(73.0)))).mul(0.25));
      const rel = fract(sA.xyz.mul(B).add(flow).sub(cameraPosition).div(B).add(0.5)).sub(0.5).mul(B).toVar();
      const w = cameraPosition.add(rel).toVar();
      const d = length(rel).toVar();
      const r = deep ? s.mul(s).mul(0.014).add(0.006) : s.mul(s).mul(s).mul(0.016).add(0.005);
      const rr = max(r, d.mul(U.pix).mul(1.2)).toVar();
      const dim = r.div(rr).mul(r.div(rr));
      const fade = smoothstep(0.35, 1.4, d).mul(float(1.0).sub(smoothstep(B * 0.36, B * 0.47, d))).mul(smoothstep(0.1, 0.6, w.y.negate()));
      let col;
      if (deep) {
        const blink = pow(sin(t.mul(s.mul(0.7).add(0.3)).add(s.mul(91.0))).mul(0.5).add(0.5), 4.0).mul(0.9).add(0.3);
        const hue = mix(lin(1.0, 0.72, 0.36), lin(0.3, 0.92, 0.8), step(0.7, fract(s.mul(7.3))));
        col = hue.mul(blink).mul(smoothstep(60.0, 100.0, w.y.negate())).mul(1.2).add(lampAt(w).mul(hue).mul(0.3));
      } else {
        const toward = pow(max(dot(rel.div(d), G.sunDir), 0.0), 4.0).mul(2.5).add(0.3);
        col = sunAt(w.y).mul(causticAt(w).mul(2.2).add(0.12)).mul(toward).add(skyAt(w, UP).mul(0.45)).add(lampAt(w)).add(glowsAt(w)).mul(lin(0.86, 0.86, 0.8)).mul(0.6)
          .mul(float(1.0).sub(smoothstep(50.0, 85.0, w.y.negate())));
      }
      vSnow.assign(vec4(col.mul(exp(SIG.mul(d).negate())).mul(dim.mul(fade)), 0.0));
      v.P.assign(w.add(U.right.mul(c0.x).add(U.up.mul(c0.y)).mul(rr.mul(2.0))));
      v.aux.assign(vec4(c0, 0.0, 0.0));
    },
    raw: (f) => {
      const q = f.aux.xy.mul(2.0), r2 = dot(q, q);
      return { color: vSnow.rgb.mul(exp(r2.negate()).mul(float(1.0).sub(smoothstep(2.6, 4.0, r2)))), alpha: float(1.0) };
    },
  });
}

// Bubbles: streams that rise from a source, each bubble wobbling, growing a little and
// drifting with the current; a bright rim and a highlight, the light round it, or the
// lamp's and the vents' glow. bA: the source (x, y, z) and the bubble's seed; bB: how high
// the stream rises, how fast, the bubble's radius, the stream's own phase.
const bA = attribute('bA', 'vec4'), bB = attribute('bB', 'vec4'), vBub = varyingProperty('vec4', 'v_bub');
function bubbleMaterial() {
  return material({
    additive: true,
    vertex: (v) => {
      const t = G.time, s = bA.w, H = bB.x, c0 = v.P.xy.toVar();
      const life = fract(t.mul(bB.y).div(H).add(s)).toVar();
      const h = life.mul(H);
      const wob = vec3(sin(t.mul(2.7).add(s.mul(53.0)).add(h.mul(1.3))), 0.0, cos(t.mul(2.3).add(s.mul(37.0)).add(h.mul(1.1)))).mul(0.03)
        .add(vec3(sin(h.mul(0.21).add(bB.w)), 0.0, cos(h.mul(0.17).add(bB.w.mul(1.7)))).mul(h.mul(0.06)));
      const w = bA.xyz.add(vec3(0.0, h, 0.0)).add(wob).toVar();
      const r = bB.z.mul(life.mul(0.5).add(0.75));
      const d = length(w.sub(cameraPosition)).toVar();
      const rr = max(r, d.mul(U.pix).mul(1.1)).toVar();
      const dim = r.div(rr).mul(r.div(rr));
      const fade = smoothstep(0.0, 0.04, life).mul(float(1.0).sub(smoothstep(0.8, 1.0, life))).mul(float(1.0).sub(smoothstep(-0.6, -0.1, w.y))).mul(smoothstep(0.3, 1.0, d));
      const light = skyAt(w, UP).mul(1.1).add(sunAt(w.y).mul(causticAt(w).mul(1.6).add(0.2))).add(lampAt(w).mul(1.5)).add(glowsAt(w).mul(1.2));
      vBub.assign(vec4(light.mul(exp(SIG.mul(d).negate())).mul(dim.mul(fade)), smoothstep(2.5, 7.0, rr.div(d.mul(U.pix)))));
      v.P.assign(w.add(U.right.mul(c0.x).add(U.up.mul(c0.y)).mul(rr.mul(1.3))));
      v.aux.assign(vec4(c0.mul(1.3), 0.0, 0.0));
    },
    raw: (f) => {
      const q = f.aux.xy, r = length(q);
      const aa = fwidth(r).add(1e-3);
      const disc = float(1.0).sub(smoothstep(float(1.0).sub(aa), aa.add(1.0), r));
      const rim = pow(smoothstep(0.45, 1.0, r), 3.0).mul(disc);
      const hl = float(1.0).sub(smoothstep(0.0, 0.3, length(q.sub(vec2(-0.35, 0.42)))));
      const shape = rim.mul(0.9).add(hl.mul(1.2)).add(disc.mul(0.05));
      const soft = exp(r.mul(r).mul(-2.2)).mul(0.5);
      return { color: vBub.rgb.mul(mix(soft, shape, vBub.w)), alpha: float(1.0) };
    },
  });
}

// ---- where things are -------------------------------------------------------------------------

// The vents' chimneys, as src/rocks.js stands them (z, distance off the centre line,
// height, radius, seed): tube worms and sea sheep live at their feet, bubbles rise from them.
const CHIMNEYS = [[-331, 6.5, 9, 1.5, 53], [-334, 9, 6, 1.2, 54], [-346, -7.5, 12, 1.8, 55], [-349, -10, 7, 1.3, 56], [-359, 8, 8.5, 1.5, 58], [-372, -6.5, 11, 1.7, 59], [-375, -9.5, 6.5, 1.2, 60]];
function chimneys() {
  return CHIMNEYS.map(([z, off, height, radius, seed]) => {
    // (the same draws, in the same order, as rocks.js makes them: seven knobs, then the lean)
    const rng = makeRng(seed);
    for (let i = 0; i < 7; i++) { rng.range(0.1, 0.95); rng(); rng.range(0.45, 0.75); }
    const lean = rng.range(-0.6, 0.6), x = centerX(z) + off, g = groundY(x, z);
    return { x, z, g, height, radius, top: [x + lean, g + height, z - lean * 0.5] };
  });
}
// The geode, as sets.js places it (GEODE there): the submarine settles beside it for the print.
const GEODE = { x: -4.13, z: -388.9 };
// Where the camera is nearest to a place at the vents: its p.
const ventP = (z) => Math.min(Math.max(6.25 + ((-314 - z) / 69) * 0.75, 6.25), 7.0);

// A box's corners on the screen of camera c: [x0, x1, y0, y1, nearest and furthest along the
// line of sight].
function rectOf(c, scr, x0, x1, y0, y1, z0, z1, out = [0, 0, 0, 0, 0, 0]) {
  const q = [0, 0, 0];
  out[0] = out[2] = 1e9; out[1] = out[3] = -1e9; out[4] = 1e9; out[5] = -1e9;
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) {
    project(c, x, y, z, scr, q);
    out[0] = Math.min(out[0], q[0]); out[1] = Math.max(out[1], q[0]); out[2] = Math.min(out[2], q[1]); out[3] = Math.max(out[3], q[1]); out[4] = Math.min(out[4], q[2]); out[5] = Math.max(out[5], q[2]);
  }
  return out;
}
// The submarine's outline on the screen of camera c, where it is at s: it lies across the view,
// its nose to the left and a little toward the visitor (cast.js); about 2.3 m long, 1 m wide and
// 1.15 m high with its skids.
function subRect(c, scr, s, out = [0, 0, 0, 0, 0, 0]) {
  const q = [0, 0, 0], A = dirOf([0, 0, 0], -0.85 * c.R[0] - 0.5 * c.F[0], 0, -0.85 * c.R[2] - 0.5 * c.F[2]);
  out[0] = out[2] = 1e9; out[1] = out[3] = -1e9; out[4] = 1e9; out[5] = -1e9;
  for (const a of [-1.2, 1.2]) for (const b of [-0.55, 0.55]) for (const h of [-0.62, 0.58]) {
    project(c, s[0] + A[0] * a - A[2] * b, s[1] + h, s[2] + A[2] * a + A[0] * b, scr, q);
    out[0] = Math.min(out[0], q[0]); out[1] = Math.max(out[1], q[0]); out[2] = Math.min(out[2], q[1]); out[3] = Math.max(out[3], q[1]); out[4] = Math.min(out[4], q[2]); out[5] = Math.max(out[5], q[2]);
  }
  return out;
}
// A jelly's outline on the screen of camera c: it hangs from `top` down to `low` at (x, z), r
// round. (Its points down its line, each with its radius: tighter than a box round it, which
// seen from below or above would stretch far beyond it.)
// (Only what is in front of the camera counts; out[6]: how many of its points are not.)
function jellyRect(c, scr, x, z, r, top, low, out) {
  const q = [0, 0, 0];
  out[0] = out[2] = 1e9; out[1] = out[3] = -1e9; out[4] = 1e9; out[5] = -1e9; out[6] = 0;
  for (let i = 0; i <= 4; i++) {
    project(c, x, lerp(top, low, i / 4), z, scr, q);
    if (q[2] < r + 0.3) { out[6]++; continue; }
    const ry = r / (q[2] * scr.tanV), rx = ry / scr.aspect;
    out[0] = Math.min(out[0], q[0] - rx); out[1] = Math.max(out[1], q[0] + rx); out[2] = Math.min(out[2], q[1] - ry); out[3] = Math.max(out[3], q[1] + ry); out[4] = Math.min(out[4], q[2] - r); out[5] = Math.max(out[5], q[2] + r);
  }
  return out;
}
const overlaps = (a, b, m) => a[0] < b[1] + m && a[1] > b[0] - m && a[2] < b[3] + m && a[3] > b[2] - m;
// Whether a ball (x, y, z, radius r) would show under the page's header or its depth label (top
// right on a wide screen; under the header on a phone), seen by camera c on screen scr.
const _ui = [0, 0, 0];
function onUI(c, scr, x, y, z, r) {
  project(c, x, y, z, scr, _ui);
  if (_ui[2] < 0.3) return false;
  const ry = r / (_ui[2] * scr.tanV), rx = ry / scr.aspect, X = _ui[0], Y = _ui[1];
  if (X + rx < -1 || X - rx > 1 || Y + ry < -1 || Y - ry > 1) return false;
  if (Y + ry > scr.top - 0.03) return true;
  return scr.kind === 'wide' && X + rx > 0.74 && Y + ry > 0.38 && Y - ry < 0.62;
}

// Where the jellies live: down the drop-off, in the view at each height as the camera goes down,
// and some where it comes back up. Each must keep, wherever it bobs and drifts, a submarine's
// length and more from the submarine at every point of its way, on either shape of screen (so
// the push aside in its shader has little to do and always from the side); keep clear of the
// siphonophore and the anglerfish while they go down with the visitor; at the moments the
// visitor stops at, cover neither the submarine, the anglerfish nor the bottle, and be whole in
// the view, below the page's header, or out of it; and never be seen from above the drop-off,
// where the water is still sunlit. [x, y, z, radius, tentacles' length in radii]
function jellySpots(rng, n, nUp) {
  const scrs = [SCREENS.wide, SCREENS.tall], q = [0, 0, 0];
  // (kept in buckets of four metres of height, so each jelly looks only at those near its own)
  const subs = new Map(), bucket = (map, q) => { const k = Math.floor(q[1] / 4); if (!map.has(k)) map.set(k, []); map.get(k).push(q); };
  const near = (map, lo, hi, f) => { for (let k = Math.floor(lo / 4); k <= Math.floor(hi / 4); k++) { const b = map.get(k); if (b) for (const q of b) if (f(q)) return true; } return false; };
  for (let p = SUB_FROM; p <= 8.0; p += 0.0025) {
    if (p > 6.18 && p < 6.98) continue;
    for (const k of ['wide', 'tall']) bucket(subs, subAt(p, k, [0, 0, 0]));
  }
  const beats = [];
  // (the moments: on a wide screen, and on a phone's)
  for (const [p, scr] of [[5.15, SCREENS.wide], [5.3, SCREENS.wide], [5.5, SCREENS.wide], [5.66, SCREENS.wide], [7.4, SCREENS.wide], [5.5, SCREENS.tall], [5.7, SCREENS.tall], [7.4, SCREENS.tall]]) {
    const c = camAt(p), keep = [subRect(c, scr, subAt(p, scr.kind, [0, 0, 0]))];
    let ang = null;
    if (p >= ANGLER[0] - 0.04 && p <= ANGLER[1] + 0.06) {
      const o = anglerAt(p, scr.tanV, scr.aspect, { c: [0, 0, 0], f: [0, 0, 0] }), r = o.size * 0.42;
      keep.push(ang = rectOf(c, scr, o.c[0] - r * 1.4, o.c[0] + r * 1.4, o.c[1] - r * 0.8, o.c[1] + r * 1.0, o.c[2] - r * 1.4, o.c[2] + r * 1.4));
    }
    if (p >= BOTTLE[0] - 0.04 && p <= BOTTLE[1] + 0.04) {
      const o = bottleAt(p, scr.tanV, scr.aspect, { c: [0, 0, 0], f: [0, 0, 0] });
      keep.push(rectOf(c, scr, o.c[0] - 0.3, o.c[0] + 0.3, o.c[1] - 0.3, o.c[1] + 0.3, o.c[2] - 0.3, o.c[2] + 0.3));
    }
    beats.push({ c, scr, keep, ang, up: c.F[1] > 0.5 });
  }
  // (from above the drop-off, where the water is still sunlit, none may be seen)
  const before = [];
  for (let p = 4.7; p <= 5.025; p += 0.015) for (const scr of scrs) before.push({ c: camAt(p), scr });
  const along = new Map();
  for (let p = SIPHON[0] - 0.24; p <= SIPHON[1] + 0.03; p += 0.01) for (const scr of scrs) {
    const o = siphonAt(p, scr.tanV, scr.aspect, { c: [0, 0, 0], d: [0, 0, 0], f: [0, 0, 0], len: 0, k: 1 });
    for (let i = 0; i <= 16; i++) { const u = i / 16 - 0.5; bucket(along, [o.c[0] + o.d[0] * u * o.len, o.c[1] + o.d[1] * u * o.len + Math.cos(u * Math.PI) * 0.5 * o.k, o.c[2] + o.d[2] * u * o.len, 1.1 * o.k + 0.3]); }
    if (p >= ANGLER[0] - 0.02 && p <= ANGLER[1] + 0.03) { const a = anglerAt(p, scr.tanV, scr.aspect, { c: [0, 0, 0], f: [0, 0, 0] }); bucket(along, [a.c[0], a.c[1], a.c[2], 0.6 * a.size + 0.5]); }
  }
  const list = [], rect = [0, 0, 0, 0, 0, 0, 0];
  const ok = (x, y, z, R, Lt) => {
    const low = y - jLow(R, Lt) - 0.6, top = y + 0.15 * R + 0.6, sd = J_DRIFT + 0.15;
    if (low < groundY(x, z) + 1.5) return false;
    for (const j of list) if (Math.hypot(j[0] - x, j[1] - y, j[2] - z) < 3.2) return false;
    const need = 1.3 + 1.05 * R + 0.6;
    if (near(subs, low - need, top + need, (s) => { const v = Math.min(Math.max(s[1], low), top) - s[1]; return (x - s[0]) ** 2 + (z - s[2]) ** 2 + v * v < need * need; })) return false;
    if (near(along, low - 4, top + 4, (a) => { const v = Math.min(Math.max(a[1], low), top) - a[1], r = a[3] + R + sd; return (x - a[0]) ** 2 + (z - a[2]) ** 2 + v * v < r * r; })) return false;
    for (const b of beats) {
      jellyRect(b.c, b.scr, x, z, R + sd, top, low, rect);
      if (rect[6] === 5 || rect[4] > 44 || rect[0] > 1.0 || rect[1] < -1.0 || rect[2] > 1.0 || rect[3] < -1.0) continue;
      // (one that comes past the camera, partly beside or behind it, in view: too near)
      if (rect[6] > 0) return false;
      // (nor under the depth label or the rail of dots at the right of a wide screen)
      if (b.scr.kind === 'wide' && rect[1] > 0.74 && rect[3] > 0.36 && rect[2] < 0.64) return false;
      if (b.scr.kind === 'wide' && rect[1] > 0.92 && rect[2] < 0.58 && rect[3] > -0.58) return false;
      for (const k of b.keep) if (overlaps(rect, k, 0.04) && (rect[4] < k[5] + 1.5 || rect[4] < (k === b.ang ? 15 : 25))) return false;
      // (whole in the view and below the header: only the ends of its strands may go past the
      // bottom of the view, and one too far or small to notice may be cut)
      const h = rect[3] - rect[2];
      // (looking up at one from below, its strands hang toward the eye: their ends may go past)
      if ((rect[4] < 32 && rect[3] > b.scr.top - 0.03) || (rect[4] < 26 && h > 0.12 && (rect[0] < -1.0 || rect[1] > 1.0 || rect[3] - 0.3 * h < -1.0 || (!b.up && rect[2] < -1.0 - 0.15 * h)))) return false;
    }
    for (const b of before) {
      jellyRect(b.c, b.scr, x, z, R + sd, top, low, rect);
      if (rect[6] < 5 && rect[4] < 42 && rect[0] < 1.05 && rect[1] > -1.05 && rect[2] < 1.05 && rect[3] > -1.05) return false;
    }
    return offTrack(x, z, y) > 2.2 + R && offTrack(x, z, (y + low) / 2) > 1.6 + R;
  };
  // (spread by the camera's height as it passes, more where the visitor stops on the way down)
  const pAtY = (y, from, to) => {
    let best = from, bd = 1e9;
    for (let p = from; p <= to; p += 0.005) { pathAt(p, _o); const d = Math.abs(_o[1] - y); if (d < bd) { bd = d; best = p; } }
    return best;
  };
  // first, at each moment, a few placed for it: on a wide screen one between the words and the
  // submarine and one beyond it (and among the jellies, more), on a phone's one below it; then
  // the rest, spread by the camera's height as it passes, in the view there
  const tryAt = (pc, scr, nx, ny, d, zMax) => {
    const R = rng.range(0.55, 0.75), Lt = rng.range(3.6, 5.0);
    onScreen(q, camAt(pc, _cA), d, nx, ny, scr.tanV, scr.aspect);
    if (q[2] > zMax || !ok(q[0], q[1], q[2], R, Lt)) return false;
    list.push([q[0], q[1], q[2], R, Lt]);
    return true;
  };
  const some = (k, pc, scr, x0, x1, y0, y1, d0, d1, zMax) => { for (let i = 0; i < k; i++) for (let t = 0; t < 80 && !tryAt(pc, scr, rng.range(x0, x1), rng.range(y0, y1), rng.range(d0, d1), zMax); t++); };
  // (wide: at the cliff, below the siphonophore; dropping, either side of the submarine; among
  // them, left of it and right of it, one behind the words; at the angler, beyond it on the
  // right and far up on the left; on the way up, one near on the left and one far on the right.
  // A phone: below the submarine)
  some(1, 5.15, SCREENS.wide, -0.62, -0.3, -0.6, -0.1, 13, 20, -279);
  some(1, 5.3, SCREENS.wide, -0.32, -0.1, -0.55, 0.0, 10, 14, -279);
  some(1, 5.3, SCREENS.wide, 0.62, 0.86, -0.75, -0.35, 8, 11, -279);
  some(1, 5.5, SCREENS.wide, -0.62, -0.36, -0.6, 0.1, 7, 10, -279);
  some(1, 5.5, SCREENS.wide, 0.68, 0.88, -0.65, 0.05, 7, 10, -279);
  some(1, 5.5, SCREENS.wide, -0.32, -0.12, -0.65, -0.2, 12, 16, -279);
  some(1, 5.66, SCREENS.wide, 0.62, 0.88, -0.7, -0.15, 9, 13, -279);
  some(1, 5.66, SCREENS.wide, -0.62, -0.38, -0.3, 0.2, 10, 14, -279);
  some(1, 7.4, SCREENS.wide, -0.62, -0.36, -0.2, 0.4, 7, 11, 1e9);
  some(1, 7.4, SCREENS.wide, -0.3, -0.08, 0.3, 0.6, 12, 18, 1e9);
  some(1, 5.7, SCREENS.tall, -0.55, 0.45, -0.85, -0.45, 9, 13, -279);
  some(1, 7.4, SCREENS.tall, -0.5, 0.3, -0.7, -0.2, 7, 11, 1e9);
  const designed = list.length;
  const make = (count, from, to, ys, sides, ups, zMax) => {
    for (let tries = 0, k = 0; k < count && tries < count * 500; tries++) {
      const band = ys[Math.min(Math.floor(((k + rng()) / count) * ys.length), ys.length - 1)];
      const pc = pAtY(rng.range(band[0], band[1]), from, to), c = camAt(pc, _cA);
      // (on a wide screen: in its left third, behind the words; or either side of the submarine)
      const left = rng() < sides, mid = rng() < 0.5, nx = left ? rng.range(-0.92, -0.5) : mid ? rng.range(-0.34, 0.0) : rng.range(0.48, 0.8), ny = rng.range(ups[0], ups[1]);
      const d = left ? rng.range(4.2, 6.5) : rng.range(7, 13), R = left ? rng.range(0.38, 0.55) : rng.range(0.5, 0.72), Lt = rng.range(3.4, 5.0);
      onScreen(q, c, d, nx, ny, SCREENS.wide.tanV, SCREENS.wide.aspect);
      if (q[2] > zMax || !ok(q[0], q[1], q[2], R, Lt)) continue;
      list.push([q[0], q[1], q[2], R, Lt]);
      k++;
    }
  };
  make(Math.max(n - designed, 4), 5.16, 6.04, [[-70, -90], [-90, -110], [-110, -130], [-125, -145], [-145, -170], [-170, -192]], 0.3, [-0.8, 0.5], -279);
  make(nUp, 7.1, 7.7, [[-160, -120], [-120, -90], [-90, -60], [-60, -35]], 0.3, [-0.7, 0.6], 1e9);
  return list;
}

// Snap's way, and at the end the submarine, the turtle and the octopus, for the schools of fish
// to keep clear of: how far a place is from any of them near p. (Both shapes of screen.)
function castTrack() {
  const pts = [];
  for (let p = 0; p <= 8.0; p += 0.005) {
    if (p > 4.45 && p < 7.1) continue;
    if (p < 7.75) { for (const k of ['wide', 'tall']) { const s = subAt(p, k, [0, 0, 0]); pts.push([p, s[0], s[1], s[2], 1.4]); } continue; }
    for (const k of ['wide', 'tall']) { const s = snapAt(p, k, [0, 0, 0]); pts.push([p, s[0], s[1], s[2], 0.45]); }
    if (p >= 7.75) {
      for (const scr of [SCREENS.wide, SCREENS.tall]) {
        const s = subAt(p, scr.kind, [0, 0, 0]), tu = { c: [0, 0, 0], f: [0, 0, 0] }, oc = { c: [0, 0, 0], f: [0, 0, 0] };
        endingAt(p, scr.tanV, scr.aspect, tu, oc);
        pts.push([p, s[0], s[1], s[2], 1.3], [p, tu.c[0], tu.c[1], tu.c[2], 1.0], [p, oc.c[0], oc.c[1], oc.c[2], 0.9]);
      }
    }
  }
  // (they are in order of p: look only at those within 0.6 of it)
  return (p, x, y, z) => {
    let lo = 0, hi = pts.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m][0] < p - 0.6) lo = m + 1; else hi = m; }
    let best = 1e9;
    for (let i = lo; i < pts.length && pts[i][0] <= p + 0.6; i++) { const s = pts[i]; best = Math.min(best, Math.hypot(s[1] - x, s[2] - y, s[3] - z) - s[4] - 0.7); }
    return best;
  };
}

// The vents' foreground: where the camera passes, every few metres a big clump of tube worms
// close by, at the bottom of the view and beside the submarine (beyond it, or between it and
// the words), and by two of them, a little further, a sea sheep.
function ventForeground(rng, chim) {
  const out = [], q = [0, 0, 0];
  [6.24, 6.31, 6.38, 6.45, 6.52, 6.59, 6.66, 6.73, 6.8].forEach((pv, i) => {
    for (let k = 0; k < 40; k++) {
      const c = camAt(pv, _cA), d = rng.range(7.0, 9.0), nx = i % 3 === 2 ? rng.range(-0.26, -0.06) : rng.range(0.6, 0.86);
      inViewAt(q, c, 0, nx * d * SCREENS.wide.tanV * SCREENS.wide.aspect, 0);
      const x = q[0] + c.L[0] * d, z = q[2] + c.L[2] * d;
      if (chim.some((ch) => Math.hypot(ch.x - x, ch.z - z) < ch.radius + 1.7) || offTrack(x, z) < 2.5) continue;
      out.push({ x, z, sheep: i === 1 || i === 4 || i === 7, toward: Math.atan2(c.z - z, c.x - x), back: [c.L[0], c.L[2]] });
      break;
    }
  });
  return out;
}

// ---- the part ----------------------------------------------------------------------------------

export function buildFauna(ctx) {
  const { add, scene, engine, q, camera, wreck = null } = ctx;
  const t0 = performance.now();
  const amt = q.amount, lod = amt >= 1 ? 2 : amt >= 0.5 ? 1 : 0;
  const rng = makeRng(20261116);
  const counts = {};
  // (Snap's single crochet, drawn once, before any creature's material is made)
  crochet(engine);

  // fish
  const fishMat = fishMaterial(), geos = {};
  let fishN = 0;
  const schools = populate(rng, amt, castTrack());
  for (const [name, { shape, fish }] of schools.meshes) {
    geos[shape] ??= fishShape(FISH[shape], lod);
    add(fishMesh(geos[shape], fish, fishMat), 64);
    counts[name] = fish.length;
    fishN += fish.length;
  }

  // the creatures placed each frame: each one copy, in its slot, with a sphere round where it can be
  const slot = (n, look, seed) => ({ cS: new Float32Array([n, seed, look, 0]) });
  const turtleGeo = turtleShape(lod), turtleMat = turtleMaterial(), octGeo = octopusShape(lod), octMat = octopusMaterial();
  const mid = (p0, p1, ahead) => inView((p0 + p1) / 2, ahead, 0, 0);
  const reefC = mid(REEF_TURTLE[0], REEF_TURTLE[1], 6), endC = inView(7.95, 5, 0, -1.5), angC = mid(ANGLER[0], ANGLER[1], 5), botC = mid(BOTTLE[0], BOTTLE[1], 5), cabC = wreck ? wreck.cabin.toArray() : inView(4.6, 3, 0, 0);
  add(solid(copies(turtleGeo, 1, slot(0, 0, 0.3), new Sphere(new Vector3(...reefC), 30)), turtleMat), 100);
  add(solid(copies(turtleGeo, 1, slot(1, 1, 0.7), new Sphere(new Vector3(...endC), 12)), turtleMat), 80);
  add(solid(copies(octGeo, 1, slot(2, 0, 0.1), new Sphere(new Vector3(...cabC), 16)), octMat), 80);
  add(solid(copies(octGeo, 1, slot(3, 0, 0.6), new Sphere(new Vector3(...endC), 12)), octMat), 80);
  add(solid(copies(anglerShape(lod), 1, slot(4, 0, 0.5), new Sphere(new Vector3(...angC), 34)), anglerMaterial()), 52);
  add(solid(cards(1, slot(4, 0, 0.5), new Sphere(new Vector3(...angC), 34)), lureGlowMaterial()), 52);
  const bottle = bottleShape(lod);
  add(solid(copies(bottle.inside, 1, slot(5, 0, 0.8), new Sphere(new Vector3(...botC), 34)), bottleInsideMaterial()), 44);
  add(solid(copies(bottle.glass, 1, slot(5, 0, 0.8), new Sphere(new Vector3(...botC), 34)), bottleGlassMaterial()), 44);

  // gulls: a few over each marina, riding wide circles high over the boats
  const gullGeo = gullShape(lod), gullMat = gullMaterial(), gulls = [];
  for (const [p0, list] of [[0.0, [[1.5, 17, 4.8, 3.5], [7, 22, 5.6, 4.5], [-2, 25, 4.4, 3.5], [10, 15, 3.6, 3]]], [8.0, [[1, 16, 4.6, 3.5], [6.5, 21, 5.4, 4.5], [-2.5, 24, 4.2, 3.5]]]]) {
    const c = camAt(p0), a = new Float32Array(list.length * 4), b = new Float32Array(list.length * 4), boxes = [];
    list.forEach(([side, ahead, h, r], i) => {
      const x = c.x + c.L[0] * ahead + c.R[0] * side, z = c.z + c.L[2] * ahead + c.R[2] * side;
      a.set([x, h, z, r], i * 4);
      b.set([rng.sign() * rng.range(0.13, 0.19), rng() * TAU, rng.range(1.5, 1.8), rng()], i * 4);
      boxes.push([x - r - 1, x + r + 1, h - 1.5, h + 1.5, z - r - 1, z + r + 1]);
    });
    const m = add(solid(copies(gullGeo, list.length, { gA: a, gB: b }, sphereOf(boxes)), gullMat), 90);
    gulls.push(m);
  }

  // jellies
  const spots = jellySpots(rng, Math.max(10, Math.round(22 * Math.sqrt(amt))), Math.max(3, Math.round(6 * Math.sqrt(amt))));
  // (the bells: teal and violet stripes; pink and plum; mint and cream; lilac and pink; a dusty
  // mauve and a coral pink, both lit teal inside, as in the picture of the twilight)
  const BELLS = [[[0.3, 0.8, 0.78], [0.6, 0.38, 0.76], 0], [[0.92, 0.5, 0.62], [0.58, 0.32, 0.66], 1], [[0.55, 0.84, 0.82], [0.9, 0.88, 0.84], 0], [[0.66, 0.46, 0.8], [0.93, 0.56, 0.74], 1],
    [[0.66, 0.56, 0.68], [0.6, 0.5, 0.64], 0], [[0.88, 0.46, 0.54], [0.84, 0.42, 0.52], 0]];
  const bellGeo = bellShape(lod), tentGeo = tentacleShape(lod), bellMat = bellMaterial(), tentMat = tentacleMaterial(), haloMat = haloMaterial();
  // (each one's face turned to the nearest point of the camera's way: a fraction of a turn)
  const faceToward = (x, y, z) => {
    let best = 1e12, bx = 1, bz = 0;
    for (let i = 0; i < TRACK.length; i += 3) { const dx = TRACK[i] - x, dy = TRACK[i + 1] - y, dz = TRACK[i + 2] - z, d = dx * dx + dy * dy + dz * dz; if (d < best) { best = d; bx = dx; bz = dz; } }
    return Math.min(((Math.atan2(bz, bx) / TAU) % 1 + 1) % 1, 0.999);
  };
  const jellies = [];
  // (in three groups, the upper and lower drop-off and the way back up, so each is switched off when it is far)
  const nj = spots.length, jGroups = [];
  for (const part of [spots.filter((j) => j[2] > -360 && j[1] > -128), spots.filter((j) => j[2] > -360 && j[1] <= -128), spots.filter((j) => j[2] <= -360)]) {
    const n = part.length;
    if (!n) continue;
    const ja = new Float32Array(n * 4), jb = new Float32Array(n * 4), jc = new Float32Array(n * 4), jd = new Float32Array(n * 4), boxes = [];
    part.forEach(([x, y, z, R0, Lt], i) => {
      const [c1, c2, glow] = rng.pick(BELLS);
      const seed = rng(), rate = rng.range(0.32, 0.55), bob = rng.range(0.35, 0.55);
      ja.set([x, y, z, R0], i * 4);
      jb.set([seed, rate, bob, Lt], i * 4);
      jc.set([...c1.map(toLin), rng.range(0.85, 1.2)], i * 4);
      jd.set([...c2.map(toLin), glow + faceToward(x, y, z)], i * 4);
      jellies.push({ x, y, z, R: R0, Lt, seed, rate, bob });
      boxes.push([x - 4, x + 4, y - jLow(R0, Lt) - 4, y + 4, z - 4, z + 4]);
    });
    const sph = sphereOf(boxes), attrs = { jA: new InstancedBufferAttribute(ja, 4), jB: new InstancedBufferAttribute(jb, 4), jC: new InstancedBufferAttribute(jc, 4), jD: new InstancedBufferAttribute(jd, 4) };
    jGroups.push({
      meshes: [add(solid(copies(bellGeo, n, attrs, sph), bellMat), 46), add(solid(copies(tentGeo, n, attrs, sph), tentMat), 46), add(solid(cards(n, attrs, sph), haloMat), 46)],
      hang: part.map(([x, y, z, R0, Lt]) => [x, y + R0 * 0.2 + J_DRIFT + 0.6, z, y - jLow(R0, Lt) - 0.6]),
    });
  }

  // The three jellies the twilight's tags name, on either shape of screen: one for each stretch
  // of the way down through the twilight (its start, its middle, its end), the biggest in the
  // view there (clear of the words, below the header); failing that, the biggest anywhere in it.
  const named = {};
  for (const scr of [SCREENS.wide, SCREENS.tall]) {
    const q = [0, 0, 0], seen = jellies.map(() => []);
    for (let pp = 5.06; pp <= 5.9; pp += 0.01) {
      const c = camAt(pp, _cA);
      jellies.forEach((j, k) => {
        project(c, j.x, j.y - j.R * 0.6, j.z, scr, q);
        if (q[2] < 3 || q[2] > 24 || q[0] < (scr.kind === 'wide' ? -0.12 : -0.85) || q[0] > 0.88 || q[1] < (scr.kind === 'wide' ? -0.8 : -0.18) || q[1] > scr.top - 0.1) return;
        seen[k].push([pp, j.R / q[2]]);
      });
    }
    const best = (k, p0, p1) => seen[k].reduce((m, [pp, v]) => (pp >= p0 && pp < p1 && v > m ? v : m), 0);
    const pick = [];
    for (const [p0, p1] of [[5.06, 5.4], [5.4, 5.65], [5.65, 5.9]]) {
      let bk = -1, bv = 0;
      jellies.forEach((j, k) => { const v = best(k, p0, p1); if (v > bv && !pick.includes(k)) { bv = v; bk = k; } });
      if (bk < 0) jellies.forEach((j, k) => { const v = best(k, 5.06, 5.9); if (v > bv && !pick.includes(k)) { bv = v; bk = k; } });
      if (bk < 0) bk = pick.length % Math.max(jellies.length, 1);
      pick.push(bk);
    }
    named[scr.kind] = pick.map((k) => jellies[k]);
    if (DEV) console.log('fauna: the tags\' jellies (' + scr.kind + ') seen at p ' + pick.map((k) => seen[k] && seen[k].length ? seen[k][0][0].toFixed(2) + '-' + seen[k][seen[k].length - 1][0].toFixed(2) : 'never').join(', '));
  }

  // the siphonophore: its core, its loops and its curls, along a line set every frame
  {
    const geo = siphonoShape(lod), c0 = inView((SIPHON[0] + SIPHON[1]) / 2, 9, 0, 0);
    geo.boundingSphere = new Sphere(new Vector3(...c0), 60);
    add(solid(geo, siphonoMaterial(lod)), 56);
  }

  // the vents: clumps of tube worms at the chimneys' feet, on the side the camera passes; sea sheep on the rock
  const chim = chimneys(), worms = [], sheep = [], clumps = [];
  const addClump = (x, z, h, reach = 0) => { clumps.push({ x, z, g: groundY(x, z), h, reach, on: 0 }); return clumps.length - 1; };
  for (const c of chim) {
    pathAt(ventP(c.z), _o);
    const toward = Math.atan2(_o[2] - c.z, _o[0] - c.x);
    for (let clump = 0; clump < 2; clump++) {
      const a = toward + (clump ? 1.1 : -0.7) + rng.range(-0.3, 0.3), dist = c.radius * 1.25 + rng.range(0.5, 1.2);
      const cx = c.x + Math.cos(a) * dist, cz = c.z + Math.sin(a) * dist;
      if (offTrack(cx, cz) < 2.2 || clumps.length >= W_CLUMPS) continue;
      const ci = addClump(cx, cz, 0.75);
      for (let i = 0, nw = Math.max(3, Math.round(rng.range(4, 7) * Math.sqrt(amt))); i < nw; i++) {
        const x = cx + rng.bell() * 0.45, z = cz + rng.bell() * 0.45;
        worms.push([x, groundY(x, z) - 0.06, z, rng.range(0.45, 1.0), rng.bell() * 0.12, rng.bell() * 0.12, rng(), rng.range(0.4, 0.56), ci]);
      }
    }
  }
  // and where the camera passes, big clumps close by, low in the right of the view, and sea sheep by two of them
  for (const f of ventForeground(rng, chim)) {
    const ci = clumps.length < W_CLUMPS ? addClump(f.x, f.z, 1.9) : 0;
    for (let i = 0, nw = Math.max(5, Math.round(rng.range(8, 11) * Math.sqrt(amt))); i < nw; i++) {
      const r = Math.sqrt(rng()) * 0.75, a = rng() * TAU, x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r * 0.8;
      worms.push([x, groundY(x, z) - 0.08, z, rng.range(1.5, 2.5) * (1 - 0.35 * r), (x - f.x) * 0.12 + rng.bell() * 0.05, (z - f.z) * 0.12 + rng.bell() * 0.05, rng(), rng.range(0.4, 0.56), ci]);
    }
    if (f.sheep) {
      // (beside the clump, toward the middle of the view and a little further away)
      const x = f.x - f.back[0] * 0.8 + Math.cos(f.toward + Math.PI / 2) * 1.5, z = f.z - f.back[1] * 0.8 + Math.sin(f.toward + Math.PI / 2) * 1.5;
      sheep.push([x, groundY(x, z) + 0.02, z, rng.range(2.2, 2.6), f.toward + rng.range(-0.4, 0.4), 0, rng(), 0]);
    }
  }
  // and by the geode, where the submarine settles to take the print: a clump in the left
  // foreground, and one just right of where the submarine settles (it ducks as the submarine
  // does; both duck at the pickup). (Their own random numbers: the rest stays as it was.)
  {
    const c = camAt(6.9, _cA), rg = makeRng(4242);
    for (const [r, f, n, h0, h1, reach] of [[-2.6, -4.0, 9, 0.8, 1.4, 0], [5.4, 0.4, 7, 0.7, 1.2, 1.3]]) {
      const cx = GEODE.x + c.R[0] * r + c.L[0] * f, cz = GEODE.z + c.R[2] * r + c.L[2] * f;
      if (offTrack(cx, cz) < 2.2 || clumps.length >= W_CLUMPS) continue;
      const ci = addClump(cx, cz, (h0 + h1) / 2, reach);
      for (let i = 0, nw = Math.max(4, Math.round(n * Math.sqrt(amt))); i < nw; i++) {
        const rr = Math.sqrt(rg()) * 0.5, a = rg() * TAU, x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
        worms.push([x, groundY(x, z) - 0.06, z, rg.range(h0, h1) * (1 - 0.3 * rr), (x - cx) * 0.15 + rg.bell() * 0.05, (z - cz) * 0.15 + rg.bell() * 0.05, rg(), rg.range(0.4, 0.56), ci]);
      }
    }
  }
  // and one large, close by, on a rock in the foreground as the camera comes to the vents: low in
  // the view, right of its middle, under the submarine, looking at the visitor
  let rockMesh = null;
  const sheepRock = (() => {
    const c = camAt(6.33), q = [0, 0, 0];
    for (let k = 0; k < 30; k++) {
      const d = 4.9 + 0.1 * k, nx = 0.34 + 0.01 * (k % 5);
      inViewAt(q, c, 0, nx * d * SCREENS.wide.tanV * SCREENS.wide.aspect, 0);
      const x = q[0] + c.L[0] * d, z = q[2] + c.L[2] * d;
      if (chim.some((ch) => Math.hypot(ch.x - x, ch.z - z) < ch.radius + 1.6) || offTrack(x, z) < 2.4) continue;
      const g = groundY(x, z), toward = Math.atan2(c.z - z, c.x - x);
      sheep.push([x + Math.cos(toward) * 0.1, g + 0.44, z + Math.sin(toward) * 0.1, 3.3, toward - 0.25, 0, rng(), 0]);
      return [x, g, z, toward];
    }
    return null;
  })();
  if (sheepRock) {
    const m = solid(rockShape(lod), sheepRockMaterial()), [x, g, z, a] = sheepRock;
    m.position.set(x, g + 0.1, z); m.scale.set(0.78, 0.48, 0.66); m.rotation.set(0, -a, 0);
    m.updateMatrix();
    add(m, 70);
    rockMesh = m;
  }
  for (const k of [0, 2, 5]) {
    const c = chim[k];
    pathAt(ventP(c.z), _o);
    const toward = Math.atan2(_o[2] - c.z, _o[0] - c.x) + (k % 2 ? 0.5 : -0.5), dist = c.radius * 1.3 + 0.7;
    const x = c.x + Math.cos(toward) * dist, z = c.z + Math.sin(toward) * dist;
    sheep.push([x, groundY(x, z) + 0.03, z, rng.range(1.5, 1.8), Math.atan2(_o[2] - z, _o[0] - x) + rng.range(-0.6, 0.6), 0, rng(), 0]);
  }
  const ventBox = sphereOf([...chim.map((c) => [c.x - 6, c.x + 6, c.g - 1, c.g + 4, c.z - 6, c.z + 6]), ...worms.map((w) => [w[0] - 1, w[0] + 1, w[1] - 1, w[1] + 2.5, w[2] - 1, w[2] + 1]), ...sheep.map((h) => [h[0] - 1, h[0] + 1, h[1] - 1, h[1] + 1, h[2] - 1, h[2] + 1])]);
  const wa = new Float32Array(worms.length * 4), wb = new Float32Array(worms.length * 4), wc = new Float32Array(worms.length * 4);
  worms.forEach((w, i) => { wa.set(w.slice(0, 4), i * 4); wb.set(w.slice(4, 8), i * 4); wc[i * 4] = w[8]; });
  const ventMeshes = [add(solid(copies(wormShape(lod), worms.length, { wA: wa, wB: wb, wC: wc }, ventBox), wormMaterial(lod)), 80)];
  const ha = new Float32Array(sheep.length * 4), hb = new Float32Array(sheep.length * 4);
  sheep.forEach((h, i) => { ha.set(h.slice(0, 4), i * 4); hb.set([h[4], 0, h[6], 0], i * 4); });
  ventMeshes.push(add(solid(copies(sheepShape(lod), sheep.length, { hA: ha, hB: hb }, ventBox), sheepMaterial()), 70));

  // specks, round the eye wherever it is: pale in the light, gold and teal in the dark
  const everywhere = new Sphere(new Vector3(0, 0, 0), 1e6);
  const speck = (n, B, deep) => {
    const a = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) a[i] = rng();
    const m = solid(cards(n, { sA: a }, everywhere), speckMaterial(B, deep));
    m.frustumCulled = false;
    scene.add(m);
    return m;
  };
  const nSnow = Math.round(7000 * amt), nDust = Math.round(1700 * amt);
  const snow = speck(nSnow, 40, false), dust = speck(nDust, 30, true);

  // bubbles: from the sand in the shallows, among the kelp and the reef, and from the vents
  const bubbleMat = bubbleMaterial();
  const streams = (list, perStream, out) => {
    for (const [x, y, z, H, sp, r0] of list) {
      const n = Math.max(3, Math.round(perStream * amt)), ph = rng() * TAU;
      for (let i = 0; i < n; i++) out.push([x, y, z, (i + rng.range(0, 0.7)) / n, H, sp * rng.range(0.85, 1.15), r0 * rng.range(0.6, 1.3), ph]);
    }
  };
  const bubbleMesh = (b, range) => {
    const n = b.length, ba = new Float32Array(n * 4), bb = new Float32Array(n * 4), boxes = [];
    b.forEach((e, i) => { ba.set(e.slice(0, 4), i * 4); bb.set(e.slice(4, 8), i * 4); boxes.push([e[0] - 3, e[0] + 3, e[1], e[1] + e[4] + 1, e[2] - 3, e[2] + 3]); });
    add(solid(cards(n, { bA: ba, bB: bb }, sphereOf(boxes)), bubbleMat), range);
    return n;
  };
  const vents = [], lit = [[], [], []];
  for (const c of chim) {
    for (let k = 0; k < 2; k++) {
      const a = rng() * TAU, rr = c.radius * 0.42;
      vents.push([c.top[0] + Math.cos(a) * rr, c.top[1] - rng.range(0.3, 1.2), c.top[2] + Math.sin(a) * rr, rng.range(14, 22), rng.range(0.3, 0.42), rng.range(0.008, 0.014)]);
    }
  }
  // in the sunlit stretch, from the floor where the camera will see them rise
  for (const [zone, p0, p1, nSrc] of [[0, 1.3, 2.05, 6], [1, 2.3, 3.0, 5], [2, 3.3, 4.0, 6]]) {
    for (let k = 0, tries = 0; k < nSrc && tries < 200; tries++) {
      const at = inView(lerp(p0, p1, (k + rng()) / nSrc), rng.range(5, 11), rng.sign() * rng.range(1.8, 5), 0);
      const g = groundY(at[0], at[2]);
      if (offTrack(at[0], at[2]) < 2) continue;
      lit[zone].push([at[0], g + 0.02, at[2], -g - 0.1, rng.range(0.24, 0.34), rng.range(0.006, 0.012)]);
      k++;
    }
  }
  const ventB = [], litB = [[], [], []];
  streams(vents, 14, ventB);
  lit.forEach((l, i) => streams(l, 10, litB[i]));
  counts.bubbles = bubbleMesh(ventB, 90) + litB.reduce((n, b) => n + bubbleMesh(b, 70), 0);

  if (DEV) console.log(`fauna: ${fishN} fish ${JSON.stringify(counts)}, ${nj} jellies, ${worms.length} worms, ${sheep.length} sheep, ${nSnow + nDust} specks, ${Math.round(performance.now() - t0)} ms`);

  // ---- each frame: the creatures in their slots
  const F = new Vector3(), Upv = new Vector3(), R = new Vector3(), Y = new Vector3(0, 1, 0), P = new Vector3(), Q = new Vector3(), W = new Vector3();
  const octopus = new Vector3();          // where the octopus with the letter is (for Snap to look at)
  const hold = { c: [0, 0, 0], f: [0, 0, 0], d: [0, 0, 0], len: 0, k: 1, size: 1, show: 1 }, hold2 = { c: [0, 0, 0], f: [0, 0, 0] };
  const setSlot = (n, pos, fwd, up, size, phase, look, d0 = 0, d1 = 0, d2 = 0, d3 = 0) => {
    const a = POSE.array;
    a[n * 4].set(pos.x, pos.y, pos.z, size);
    a[n * 4 + 1].set(fwd.x, fwd.y, fwd.z, phase);
    a[n * 4 + 2].set(up.x, up.y, up.z, look);
    a[n * 4 + 3].set(d0, d1, d2, d3);
  };
  // its up and right: level, banked by `roll`
  const frame = (fwd, roll) => {
    R.crossVectors(fwd, Y).normalize();
    Upv.crossVectors(R, fwd).normalize().multiplyScalar(Math.cos(roll)).addScaledVector(R, Math.sin(roll));
  };
  // a creature held at its moment: where the anchor says, bobbing and swaying a little about it
  const keyed = (n, o, t, size, phase, look, bob, sway, roll) => {
    F.set(o.f[0], o.f[1], o.f[2]);
    const yawWob = Math.sin(t * 0.21 + phase * 7) * 0.12;
    F.applyAxisAngle(Y, yawWob).normalize();
    P.set(o.c[0], o.c[1], o.c[2]).addScaledVector(F, Math.sin(t * 0.3 + phase * 5) * sway);
    P.y += Math.sin(t * 0.55 + phase * 3) * bob;
    frame(F, roll + Math.sin(t * 0.4 + phase) * 0.05);
    setSlot(n, P, F, Upv, size, phase, look);
  };

  // In the wreck's cabin (when the set gives it): behind the desk, facing the visitor across
  // it, its front arms on the letter, nearly behind it (a little toward the stern; Snap is on
  // the bow's side), where the cabin's view shows it best; from p 4.655 it rises over the
  // desk, goes out through the hole in the hull on the stern side of the camera's way, and away
  // up and toward the stern.
  let path = null;
  const LETTER = new Vector3(), OUT = new Vector3(), STERN = new Vector3(), OCT_SIZE = 1.3;
  if (wreck) {
    OUT.copy(wreck.cabinFacing).setY(0).normalize();
    STERN.set(-OUT.z, 0, OUT.x);                            // (the bow is (out.z, 0, -out.x))
    LETTER.copy(wreck.envelope);
    const seat = wreck.envelope.clone().addScaledVector(OUT, -0.76).addScaledVector(STERN, 0.1);
    seat.y = wreck.envelope.y - 0.16 * OCT_SIZE + 0.02;
    const k1 = seat.clone().addScaledVector(OUT, 1.0).add(new Vector3(0, 0.42, 0));
    const k2 = wreck.cabin.clone().addScaledVector(OUT, 2.95).addScaledVector(STERN, 0.3).add(new Vector3(0, -0.25, 0));
    const k3 = k2.clone().addScaledVector(OUT, 1.9).addScaledVector(STERN, 1.1).add(new Vector3(0, 1.3, 0));
    const k4 = k3.clone().addScaledVector(OUT, 1.5).addScaledVector(STERN, 5.5).add(new Vector3(0, 4.5, 0));
    path = { keys: [[4.655, seat], [4.682, k1], [4.708, k2], [4.745, k3], [4.87, k4]] };
    if (DEV) console.log('fauna: cabin octopus at ' + seat.toArray().map((v) => v.toFixed(2)) + ', lantern ' + wreck.lantern.toArray().map((v) => v.toFixed(2)) + ', letter ' + LETTER.toArray().map((v) => v.toFixed(2)));
  }
  // (Catmull-Rom through the keys, with their p as the knots)
  const along = (keys, p, out) => {
    if (p <= keys[0][0]) return out.copy(keys[0][1]);
    const n = keys.length - 1;
    if (p >= keys[n][0]) return out.copy(keys[n][1]);
    let i = 0;
    while (p > keys[i + 1][0]) i++;
    const a = keys[i], b = keys[i + 1], a0 = keys[Math.max(i - 1, 0)], b1 = keys[Math.min(i + 2, n)];
    const h = b[0] - a[0], t = (p - a[0]) / h, t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const da = b[0] - a0[0] || 1, db = b1[0] - a[0] || 1;
    const A = a[1], B = b[1], A0 = a0[1], B1 = b1[1];
    out.x = h00 * A.x + h10 * h * ((B.x - A0.x) / da) + h01 * B.x + h11 * h * ((B1.x - A.x) / db);
    out.y = h00 * A.y + h10 * h * ((B.y - A0.y) / da) + h01 * B.y + h11 * h * ((B1.y - A.y) / db);
    out.z = h00 * A.z + h10 * h * ((B.z - A0.z) / da) + h01 * B.z + h11 * h * ((B1.z - A.z) / db);
    return out;
  };

  // Where the creatures other parts of the page point at are, kept every frame: the reef's crop
  // frame snaps onto the turtle; the twilight's tags are pinned to what the lamp finds there
  // (name, score, where, how far round it in metres, and whether it is there to be found now).
  const tag = (name, score) => ({ name, score, at: new Vector3(0, -1000, 0), r: 1, on: false });
  const marks = {
    turtle: { at: new Vector3(), r: 0.85, on: false },
    twilight: [tag('jellyfish', 0.97), tag('jellyfish', 0.95), tag('glowing worm', 0.84), tag('message in a bottle', 0.96), tag('anglerfish', 0.93), tag('jellyfish', 0.96)],
  };
  const tagJelly = [marks.twilight[0], marks.twilight[1], marks.twilight[5]];
  // where a named jelly is now, as its shader has it (jellyAt: bobbing, drifting, moved aside
  // level from the submarine and from Snap)
  const smaxN = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };
  const level = (c, top, low, at, need) => {
    const v = Math.min(Math.max(at.y, c.y - low), c.y + top) - at.y, dx = c.x - at.x, dz = c.z - at.z, h = Math.max(Math.hypot(dx, dz), 1e-3);
    const k = smaxN(h, Math.sqrt(Math.max(need * need - v * v, 0)), 0.7) / h - 1;
    c.x += dx * k; c.z += dz * k;
  };
  const JC = new Vector3();
  const jellyNow = (j, t, out) => {
    const s0 = j.seed, cyc = t * j.rate + s0 * 7;
    JC.set(j.x + Math.sin(t * 0.031 + s0 * 6) * J_DRIFT, j.y + Math.sin(t * 0.11 + s0 * 17) * j.bob + Math.sin(cyc * TAU - 1) * 0.03, j.z + Math.cos(t * 0.027 + s0 * 9) * J_DRIFT);
    const low = j.R * (j.Lt + 0.75), top = j.R * 0.15, sub = G.subAt.value, snap = G.snapAt.value;
    level(JC, top, low, sub, sub.w + J_SUB + j.R * 1.05 + 0.25);
    level(JC, top, low, snap, snap.w + J_SNAP + j.R);
    return out.set(JC.x, JC.y - j.R * 0.45, JC.z);
  };
  // the worms' clumps: in fast when the hand comes near (within about half the clump's height of
  // its plumes, on the screen) or the submarine settles by it, or when startled; out slowly
  const V1 = new Vector3(), V2 = new Vector3();
  let duckAt = -1e9, joyAt = -1e9, lastT = 0;
  const worms4 = (t, dt) => {
    const h = G.hand.value, sub = G.subAt.value, startle = t - duckAt < 1.4;
    for (let i = 0; i < clumps.length; i++) {
      const c = clumps[i];
      V1.set(c.x, c.g + c.h * 0.85, c.z).project(camera);
      V2.set(c.x, c.g, c.z).project(camera);
      const near = h.z > 0.3 && V1.z < 1 && Math.hypot((V1.x - h.x) * h.w, V1.y - h.y) < Math.max(0.55 * Math.abs(V1.y - V2.y), 0.1);
      const settled = Math.hypot(sub.x - c.x, sub.y - c.g - c.h, sub.z - c.z) < 2.2 + c.h * 0.5 + c.reach;
      const want = near || settled || startle ? 1 : 0;
      c.on += (want - c.on) * Math.min(1, dt * (want > c.on ? 9 : 0.9));
      WIN.array[i >> 2].setComponent(i & 3, c.on);
    }
  };
  return {
    spots: marks,
    // the octopus in the cabin wiggles for joy (2.4 s): when the visitor seals its letter
    octopusWiggle() { joyAt = lastT; },
    // every tube worm pulls its plumes in at once (1.4 s), as at the print's pickup
    wormsDuck() { duckAt = lastT; },
    update(t, dt, p) {
      lastT = t;
      const e = camera.matrixWorld.elements;
      U.right.value.set(e[0], e[1], e[2]);
      U.up.value.set(e[4], e[5], e[6]);
      U.fwd.value.set(-e[8], -e[9], -e[10]);
      U.tanV.value = Math.tan((camera.fov * Math.PI) / 360);
      U.pix.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(engine.height, 1);
      dust.visible = camera.position.y < -45;
      snow.visible = camera.position.y < 0.5 && camera.position.y > -95;
      // gulls only while the eye is out of the water
      if (camera.position.y < -0.6) for (let i = 0; i < gulls.length; i++) gulls[i].visible = false;
      // (what the world's culling switched on by its group's whole sphere but cannot be seen from
      // here: a group of jellies all past the distance where the water has taken them, the vents'
      // worms and sea sheep while the eye is still far above the vents)
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      for (let g = 0; g < jGroups.length; g++) {
        const G0 = jGroups[g];
        if (!G0.meshes[0].visible) continue;
        let near = 1e9;
        for (let i = 0; i < G0.hang.length; i++) {
          const h = G0.hang[i], dy = cy > h[1] ? cy - h[1] : cy < h[3] ? h[3] - cy : 0, d = (h[0] - cx) * (h[0] - cx) + dy * dy + (h[2] - cz) * (h[2] - cz);
          if (d < near) near = d;
        }
        if (near > 46 * 46) for (let k = 0; k < 3; k++) G0.meshes[k].visible = false;
      }
      if (cy > -150) { for (let k = 0; k < ventMeshes.length; k++) ventMeshes[k].visible = false; if (rockMesh) rockMesh.visible = false; }
      const tanV = Math.tan((camera.fov * Math.PI) / 360), aspect = camera.aspect;
      // the turtle over the reef
      reefTurtleAt(p, tanV, aspect, hold);
      keyed(0, hold, t, 1.7, 0.3, 0, 0.1, 0.25, -0.2);
      { const a = POSE.array[0]; marks.turtle.at.set(a.x, a.y, a.z); marks.turtle.on = p > REEF_TURTLE[0] - 0.05 && p < REEF_TURTLE[1] + 0.05; }
      // the anglerfish, and the bottle with a message (tilted, turning slowly as it sinks)
      anglerAt(p, tanV, aspect, hold);
      keyed(4, hold, t, hold.size, 0.5, 0, 0.05, 0.1, 0);
      const tw = marks.twilight, deep = p > 4.9 && p < 6.1;
      { const a = POSE.array[16]; tw[4].at.set(a.x, a.y, a.z); tw[4].r = 0.5 * hold.size; tw[4].on = p > ANGLER[0] - 0.05 && p < ANGLER[1] + 0.05; }
      bottleAt(p, tanV, aspect, hold);
      keyed(5, hold, t, 1.6, 0.8, 0, 0.06, 0.08, 0.5 * t);
      { const a = POSE.array[20]; tw[3].at.set(a.x, a.y, a.z); tw[3].r = 0.32; tw[3].on = p > BOTTLE[0] - 0.05 && p < BOTTLE[1] + 0.05; }
      // the siphonophore (the glowing worm of the tags: its middle, up on its arch)
      siphonAt(p, tanV, aspect, hold);
      SI.c.value.set(hold.c[0], hold.c[1], hold.c[2]); SI.d.value.set(hold.d[0], hold.d[1], hold.d[2]); SI.n.value.set(hold.f[0], hold.f[1], hold.f[2]); SI.len.value = hold.len; SI.k.value = hold.k;
      SI.show.value = hold.show;
      tw[2].at.set(hold.c[0], hold.c[1] + 0.5 * hold.k, hold.c[2]); tw[2].r = 1.1 * hold.k; tw[2].on = hold.show > 0.5 && p < SIPHON[1] + 0.06;
      // the jellies the tags name: where they are now (on the shape of screen the visitor has)
      if (deep) { const js = named[aspect >= 1 ? 'wide' : 'tall']; for (let i = 0; i < 3; i++) { const j = js[i]; if (!j) continue; jellyNow(j, t, tagJelly[i].at); tagJelly[i].r = j.R * 1.4; tagJelly[i].on = true; } }
      else for (let i = 0; i < 3; i++) tagJelly[i].on = false;
      // the worms at the vents
      if (camera.position.y < -150 && clumps.length) worms4(t, dt);
      // the cabin's octopus, happy: a wiggle of 2.4 s
      { const k = t - joyAt; JOY.value = k >= 0 && k < 2.4 ? smooth(0, 0.25, k) * (1 - smooth(1.9, 2.4, k)) : 0; }
      // (a fill on the fish on the way back up, where they are seen against the surface)
      U.fill.value = 0.35 * smooth(7.2, 7.3, p) * (1 - smooth(7.62, 7.78, p));
      // the end: the turtle, and the octopus swimming, leaning into it
      endingAt(p, tanV, aspect, hold, hold2);
      keyed(1, hold, t, 1.15, 0.7, 1, 0.08, 0.3, 0);
      keyed(3, hold2, t, 1.05, 0.6, 1, 0.1, 0.25, 0);
      // (the octopus leans forward a little as it swims: its head ahead, its arms trailing)
      {
        const a = POSE.array, f = a[3 * 4 + 1], u = a[3 * 4 + 2];
        F.set(f.x, f.y, f.z); Upv.set(u.x, u.y, u.z);
        W.copy(Upv).multiplyScalar(Math.cos(0.25)).addScaledVector(F, Math.sin(0.25));
        F.multiplyScalar(Math.cos(0.25)).addScaledVector(Upv, -Math.sin(0.25));
        f.set(F.x, F.y, F.z, f.w); u.set(W.x, W.y, W.z, u.w);
      }
      // the octopus with the letter: at the desk, then away (see path); without a cabin, to
      // the left of the view from p 4.45 to 5, a few metres ahead
      const size = OCT_SIZE;
      let seat = 1;
      if (path) {
        along(path.keys, p, P);
        seat = 1 - smooth(4.655, 4.685, p);
        // it faces the visitor at the desk, then the way it goes
        along(path.keys, Math.min(p + 0.004, 4.87), Q); along(path.keys, Math.max(p - 0.004, 4.655), W);
        Q.sub(W);
        if (Q.lengthSq() < 1e-6 || seat > 0.999) F.copy(OUT); else F.copy(Q).normalize().lerp(OUT, seat).normalize();
        F.y = Math.max(-0.4, Math.min(0.4, F.y));
        F.normalize();
      } else {
        const pv = Math.min(Math.max(p, 4.45), 5.0), away = smooth(4.85, 5.0, pv);
        const c = camAt(pv, _cB);
        P.set(c.x + c.L[0] * (3.8 + 1.5 * away) - c.R[0] * (1.2 + 3.6 * away), c.y - 0.8 + away, c.z + c.L[2] * (3.8 + 1.5 * away) - c.R[2] * (1.2 + 3.6 * away));
        F.set(camera.position.x - P.x, 0, camera.position.z - P.z).normalize();
        seat = 0;
      }
      P.y += 0.03 * Math.sin(t * 0.8) * seat + 0.08 * Math.sin(t * 0.8) * (1 - seat);
      frame(F, 0.04 * Math.sin(t * 0.6) * (1 - seat));
      // the letter in its own frame (for its front arms to reach)
      W.copy(LETTER).sub(P);
      R.crossVectors(F, Upv);
      setSlot(2, P, F, Upv, size, 0.1, 0, seat, W.dot(F) / size, W.dot(Upv) / size, W.dot(R) / size);
      octopus.copy(P).addScaledVector(Upv, 0.45);
    },
    octopus,
  };
}

// (for dev pages: the pieces, to look at one creature at a time, and the placements to check)
export const faunaParts = {
  bellShape, tentacleShape, bellMaterial, tentacleMaterial, haloMaterial, JOY, WIN,
  FISH, COL, KINDS, fishShape, fishMaterial, fishMesh, eyeOf, turtleShape, turtleMaterial, octopusShape, octopusMaterial, anglerShape, anglerMaterial, lureGlowMaterial,
  gullShape, gullMaterial, copies, cards, solid, POSE, SI, toLin, jellySpots, castTrack, populate, camAt, subAt, snapAt, siphonAt, anglerAt, reefTurtleAt, endingAt, SCREENS, rectOf,
  bottleShape, bottleInsideMaterial, bottleGlassMaterial, bottleAt, sheepShape, sheepMaterial, wormShape, wormMaterial, project, onUI,
};
