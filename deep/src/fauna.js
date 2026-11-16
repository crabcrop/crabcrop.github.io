// The creatures, crocheted, and what drifts in the water: schools of little stitched fish in
// the marina, the shallows, the kelp and on the reef; a sea turtle gliding over the reef; the
// pink octopus at its desk in the wreck's cabin, holding the letter; glowing jellies, a
// siphonophore and an anglerfish in the twilight; tube worms and sea sheep at the vents; gulls
// over the marina; the turtle and the octopus again below the surface at the end; specks and
// bubbles everywhere.
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
// A few creatures belong to a moment of the dive: the turtle over the reef, the siphonophore
// and the anglerfish in the twilight, the octopus in the cabin, the turtle and the octopus at
// the end. While the visitor is at that moment each keeps its place in the view (it swims
// along), and before and after it stays where it was in the water; their parts move in their
// shaders: flippers beat, tentacles curl, wings flap.
//
// Everything wears the shared yarn (shaders.js), laid in each creature's own frame so the
// stitches stay on it as it turns, with rows running round a fish from nose to tail as an
// amigurumi is worked. Small things are kept from sparkling: a fish too small on screen
// dissolves into the water behind it, and a speck is never drawn narrower than about a
// pixel: below that it is drawn that wide and dimmer, so it carries the same light.
import {
  BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, InstancedInterleavedBuffer, InterleavedBufferAttribute, Mesh as ThreeMesh, Sphere, Vector3, Vector4,
} from 'three/webgpu';
import {
  abs, atan, attribute, cameraPosition, clamp, cos, cross, dot, exp, float, floor, fract, fwidth, int, length, max, min, mix, normalize,
  pow, sign, sin, smoothstep, sqrt, step, texture, uniform, uniformArray, varyingProperty, vec2, vec3, vec4, select,
} from 'three/tsl';
import { TRACK, centerX, groundY, offTrack, pathAt } from './layout.js';
import { Mesh, TAU, blob, clamp as clampN, lerp, makeRng, smooth, tube } from './math.js';
import { G, SIG, material, scatter, skyAt, sunAt, sunFoot, yarn } from './shaders.js';

// Set every frame: how many metres one pixel spans one metre from the eye, and the eye's
// right and up, for what is drawn as a card that faces it.
const U = { pix: uniform(0.002), right: uniform(new Vector3(1, 0, 0)), up: uniform(new Vector3(0, 1, 0)) };
const UP = vec3(0.0, 1.0, 0.0);
const one = (x, k) => float(1.0).sub(step(0.5, abs(x.sub(k))));      // 1 where x is k
// Colours are written as they look in the pictures (sRGB) and turned into the linear values the
// light works in (the final pass only gamma-encodes them).
const toLin = (x) => Math.pow(x, 2.2);
const lin = (r, g, b) => vec3(toLin(r), toLin(g), toLin(b));

// ---- yarn on a creature ----------------------------------------------------------------------

// yarn() reads its stitches along the three axes of `p` and weighs them by the normal. On
// a creature that turns, both must be in the creature's own frame: knit() hands yarn() the
// normal in that frame (A, B, C: where the frame's axes point in the world, for p's x, y,
// z; rows are stacked along B), turns the stitched normal back, and adds the wool's halo
// with it (as yarn() does).
function knit(s, f, o) {
  const [A, B, C] = o.frame, n = s.n;
  s.n = vec3(dot(n, A), dot(n, B), dot(n, C));
  const r = yarn(s, f, { ...o, fuzz: 0 });
  const m = s.n;
  s.n = normalize(A.mul(m.x).add(B.mul(m.y)).add(C.mul(m.z))).toVar();
  const graze = pow(float(1.0).sub(abs(dot(s.n, normalize(cameraPosition.sub(f.w))))), 3.0);
  s.emis = s.emis.add(sunAt(f.w.y).mul(0.06).add(G.amb.mul(0.14)).mul(graze).mul(s.albedo).mul(o.fuzz ?? 1.0));
  return r;
}
// A glass bead (the eyes): black, glossy, smooth.
function bead(s, nSmooth, k) {
  s.albedo = mix(s.albedo, vec3(0.012, 0.012, 0.016), k);
  s.n = normalize(mix(s.n, nSmooth, k));
  s.spec = mix(s.spec, float(1.2), k); s.gloss = mix(s.gloss, float(80.0), k);
  s.trans = mix(s.trans, float(0.0), k); s.fluor = mix(s.fluor, float(0.0), k);
}
// A glint on a bead eye (either side): a small bright spot where it catches the light from
// above and in front. `q` the point in the shape's own frame, the eye at (ex, ey, +-ez) of
// radius er; k: 1 on the eye.
function glint(s, q, ex, ey, ez, er, k) {
  const sd = sign(q.z), n = normalize(q.sub(vec3(ex, ey, sd.mul(ez))));
  const g = smoothstep(0.88, 0.95, dot(n, normalize(vec3(0.62, 0.62, sd.mul(0.48))))).mul(k).mul(float(1.0).sub(smoothstep(0.0, er * 0.4, abs(length(q.sub(vec3(ex, ey, sd.mul(ez)))).sub(er)))));
  s.albedo = mix(s.albedo, vec3(0.92), g);
  s.emis = s.emis.add(vec3(0.55).mul(g));
}
// A ring of pale felt round a bead eye, so it reads from afar: `q` the point in the shape's
// own frame, the eye at (ex, ey, +-ez) of radius er.
function eyeRing(q, ex, ey, ez, er) {
  const d = length(vec3(q.x.sub(ex), q.y.sub(ey), abs(q.z).sub(ez)));
  return float(1.0).sub(smoothstep(er.mul(1.28), er.mul(1.7), d));
}

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
// Make the triangles added since i0 face the way out(x, y, z) says is out (and their normals).
function orient(m, i0, base, out) {
  const p = m.p;
  let sum = 0;
  for (let k = i0; k < m.i.length; k += 3) {
    const a = m.i[k] * 3, b = m.i[k + 1] * 3, c = m.i[k + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const o = out((p[a] + p[b] + p[c]) / 3, (p[a + 1] + p[b + 1] + p[c + 1]) / 3, (p[a + 2] + p[b + 2] + p[c + 2]) / 3);
    sum += (uy * vz - uz * vy) * o[0] + (uz * vx - ux * vz) * o[1] + (ux * vy - uy * vx) * o[2];
  }
  if (sum >= 0) return;
  for (let k = i0; k < m.i.length; k += 3) { const t = m.i[k + 1]; m.i[k + 1] = m.i[k + 2]; m.i[k + 2] = t; }
  for (let v = base * 3; v < m.count * 3; v++) m.n[v] = -m.n[v];
}
// A crocheted fin: flat but puffed, thickest in the middle and meeting itself at the edge.
// f(s, t, o) gives the point on its middle (o[0..2]) and how thick it is there (o[3]); it
// puffs along `dir`. aux = (x, y, z of that point, part).
function pillow(m, cols, rows, dir, part, f) {
  const o = [0, 0, 0, 0];
  for (const sg of [1, -1]) {
    const i0 = m.i.length, base = m.count;
    m.grid(cols, rows, (s, t, out) => {
      f(s, t, o);
      out[0] = o[0] + dir[0] * o[3] * sg; out[1] = o[1] + dir[1] * o[3] * sg; out[2] = o[2] + dir[2] * o[3] * sg;
      out[3] = o[0]; out[4] = o[1]; out[5] = o[2]; out[6] = part;
    });
    orient(m, i0, base, () => [dir[0] * sg, dir[1] * sg, dir[2] * sg]);
  }
}
// A bead, a ball, an egg: a blob with aux (centre, part).
function ball(m, x, y, z, rx, ry, rz, res, part) {
  blob(m, x, y, z, (dx, dy, dz) => 1 / Math.hypot(dx / rx, dy / ry, dz / rz), res, (dx, dy, dz, o) => { o[0] = x; o[1] = y; o[2] = z; o[3] = part; });
}
// The rings of tubes the vertex shader builds round a centreline: n tubes of `rings` rings,
// `sides` round. aux = (along 0..1, round 0..1, which tube, tag(tube)).
function tubes(m, n, rings, sides, tag) {
  for (let k = 0; k < n; k++) {
    const base = m.count, g = tag(k);
    for (let r = 0; r <= rings; r++) for (let j = 0; j <= sides; j++) m.vert(0, 0, 0, 0, 1, 0, 0, 0, r / rings, j / sides, k, g);
    for (let r = 0; r < rings; r++) for (let j = 0; j < sides; j++) {
      const a = base + r * (sides + 1) + j;
      m.quad(a, a + 1, a + sides + 2, a + sides + 1);
    }
  }
}
// A ring of a tube: the centre C, the tangent T, a side S0 (made square to T), the angle
// round and the radius. Gives the point, its normal and the ring's two axes.
function ringAt(C, T, S0, phi, r) {
  const S = normalize(S0.sub(T.mul(dot(S0, T)))).toVar();
  const B = cross(T, S).toVar();
  const n = S.mul(cos(phi)).add(B.mul(sin(phi))).toVar();
  return { p: C.add(n.mul(r)), n, S, B };
}

// ---- where the camera looks, and where the cast is -----------------------------------------

const DEG = Math.PI / 180, _o = [0, 0, 0, 0, 0];
const camHolder = () => ({ x: 0, y: 0, z: 0, F: [0, 0, 0], R: [0, 0, 0], U: [0, 0, 0], L: [0, 0, 0] });
const _cA = camHolder(), _cB = camHolder();
// The camera at p as its path has it (without the visitor's nudge): where it is, its line of
// sight F, its right R, its up U (with its pitch) and its level forward L.
function camAt(p, c = camHolder()) {
  pathAt(p, _o);
  const yaw = _o[3] * DEG, pitch = _o[4] * DEG, sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
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
// Where the cast holds the submarine and Snap in the view (cast.js SLOT): forward, right, up.
const SUB_SLOT = { wide: [4.3, 1.3, -0.35], tall: [4.7, 0.0, 0.7] }, SNAP_SLOT = { wide: [2.8, 1.05, -0.28], tall: [3.3, 0.0, 0.55] };
const SUB_FROM = 4.92, SNAP_IN = 5.06;
// Snap's middle at p on a screen, as the cast places him (near enough: on the anchor chain he
// is a little off it), and the submarine's, from when it has come.
function snapAt(p, kind, out) {
  const c = camAt(p, _cB), s = SNAP_SLOT[kind], k = smooth(4.49, 4.55, p) * (1 - smooth(4.63, 4.69, p));
  inViewAt(out, c, p >= SNAP_IN ? SUB_SLOT[kind][0] : s[0] * (1 - 0.32 * k), p >= SNAP_IN ? SUB_SLOT[kind][1] : s[1], p >= SNAP_IN ? SUB_SLOT[kind][2] : s[2]);
  if (p < 0.2) out[1] = lerp(0, out[1], smooth(0.075, 0.2, p));
  return out;
}
// (it never touches the ground, nor rises within a metre of the surface)
const subAt = (p, kind, out) => {
  inViewAt(out, camAt(p, _cB), ...SUB_SLOT[kind]);
  out[1] = Math.min(Math.max(out[1], groundY(out[0], out[2]) + 0.95), -1.0);
  return out;
};

// The moments a creature belongs to, and where it is in the view then. Each writes into o:
// c its middle, f the way it faces (level unless said), and for the siphonophore d its
// length's direction and len its length. A screen is (tanV, aspect).
const SIPHON = [5.22, 5.86], ANGLER = [5.46, 5.84], REEF_TURTLE = [3.2, 3.68], ENDING = [7.84, 8.0];
const dirOf = (o, x, y, z) => { const l = Math.hypot(x, y, z) || 1; o[0] = x / l; o[1] = y / l; o[2] = z / l; return o; };
// The siphonophore: it comes down from above the view to meet the visitor at the drop-off,
// goes down with them through the twilight, across the top of the view, drifting from right
// to left (rising a little to the right), and stays behind when they go on down. It is big and far,
// behind the jellies (k: how much bigger than the eight metres away it was drawn for).
function siphonAt(p, tanV, aspect, o) {
  const pc = clampN(p, SIPHON[0], SIPHON[1]), u = (pc - SIPHON[0]) / (SIPHON[1] - SIPHON[0]), wide = aspect >= 1, c = camAt(pc, _cA);
  const d = wide ? 17 - 1.5 * u : 15.5 - 1.2 * u;
  onScreen(o.c, c, d, wide ? 0.16 - 0.2 * u : 0.0, wide ? 0.52 : 0.47, tanV, aspect);
  if (p < SIPHON[0]) o.c[1] += Math.min(SIPHON[0] - p, 0.4) * 90;
  dirOf(o.d, c.R[0], 0.2, c.R[2]);
  dirOf(o.f, c.L[0], 0, c.L[2]);
  o.k = d / 8.5;
  o.len = (wide ? 12 : 9) * o.k;
  return o;
}
// The anglerfish: in the right of the view, below the siphonophore and clear of the
// submarine, in profile, heading left; it drifts slowly toward the middle.
function anglerAt(p, tanV, aspect, o) {
  const pc = clampN(p, ANGLER[0], ANGLER[1]), u = (pc - ANGLER[0]) / (ANGLER[1] - ANGLER[0]), wide = aspect >= 1, c = camAt(pc, _cA);
  onScreen(o.c, c, 5.6, wide ? 0.6 - 0.08 * u : 0.32 - 0.12 * u, wide ? 0.26 : -0.42, tanV, aspect);
  dirOf(o.f, -c.R[0] - 0.22 * c.L[0], 0, -c.R[2] - 0.22 * c.L[2]);
  return o;
}
// The turtle over the reef: high in the right of the view, heading left and a little toward
// the visitor, drifting toward the middle as the camera goes on.
function reefTurtleAt(p, tanV, aspect, o) {
  const pc = clampN(p, REEF_TURTLE[0], REEF_TURTLE[1]), u = (pc - REEF_TURTLE[0]) / (REEF_TURTLE[1] - REEF_TURTLE[0]), wide = aspect >= 1, c = camAt(pc, _cA);
  onScreen(o.c, c, wide ? 6.6 : 8.6, wide ? 0.62 - 0.16 * u : 0.16 - 0.16 * u, wide ? 0.4 : 0.55, tanV, aspect);
  dirOf(o.f, -c.R[0] - 0.42 * c.L[0], -0.06, -c.R[2] - 0.42 * c.L[2]);
  return o;
}
// The end: under the waterline, the turtle and the octopus swim to the right across the
// view, side on, a little toward the visitor; the octopus lower and further right.
function endingAt(p, tanV, aspect, turtle, octo) {
  const c = camAt(clampN(p, ENDING[0], ENDING[1]), _cA), wide = aspect >= 1;
  // (`d` ahead, at nx across the screen, at a depth below the submarine, which stays a metre down)
  const put = (o, d, nx, y) => { inViewAt(o.c, c, 0, nx * d * tanV * aspect, 0); o.c[0] += c.L[0] * d; o.c[1] = y; o.c[2] += c.L[2] * d; };
  put(turtle, wide ? 5.6 : 6.2, wide ? -0.24 : -0.42, wide ? -2.35 : -3.3);
  put(octo, wide ? 6.2 : 6.8, wide ? 0.62 : 0.45, wide ? -2.8 : -3.8);
  dirOf(turtle.f, c.R[0] + 0.3 * c.L[0], 0, c.R[2] + 0.3 * c.L[2]);
  dirOf(octo.f, c.R[0] + 0.45 * c.L[0], 0, c.R[2] + 0.45 * c.L[2]);
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
  round: { h: 0.24, w: 0.2, at: 0.36, nose: 0.4, end: -0.18, ped: 0.06, tail: [0.25, 0.3], dorsal: [0.12, -0.12, 0.13], anal: [-0.02, -0.14, 0.06], pect: [0.14, 0.17, 0.1], eye: [0.3, 0.075, 0.085], fin: 0.035 },
  tang: { h: 0.38, w: 0.12, at: 0.45, nose: 0.75, end: -0.2, ped: 0.07, tail: [0.22, 0.12], dorsal: [0.24, -0.18, 0.09], anal: [0.1, -0.18, 0.09], pect: [0.12, 0.17, 0.1], eye: [0.27, 0.11, 0.075], fin: 0.03, keel: 0.2 },
  long: { h: 0.17, w: 0.14, at: 0.34, nose: 0.5, end: -0.24, ped: 0.05, tail: [0.2, 0.45], dorsal: [0.16, -0.16, 0.08], anal: [0.0, -0.17, 0.05], pect: [0.18, 0.13, 0.07], eye: [0.36, 0.045, 0.07], fin: 0.03 },
  puffer: { h: 0.3, w: 0.29, at: 0.5, nose: 0.36, end: -0.14, ped: 0.07, tail: [0.2, 0.0], dorsal: [0.0, -0.12, 0.09], anal: null, pect: [0.1, 0.15, 0.11], eye: [0.27, 0.1, 0.085], fin: 0.035, spikes: 36 },
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
  // the tail: a fan from the root, a notch in its edge
  pillow(m, lod ? 6 : 4, lod ? 3 : 2, [0, 0, 1], 1, (s, t, o) => {
    const v = s * 2 - 1, span = lerp(sp.ped * 0.85, sp.tail[0], Math.pow(t, 0.6));
    o[0] = lerp(E + 0.05, -0.5 + sp.tail[1] * 0.12 * (1 - Math.abs(v)), t); o[1] = yE + v * span; o[2] = 0;
    o[3] = th * Math.sqrt(Math.max(1 - v * v, 0)) * (1 - Math.pow(t, 3) * 0.85);
  });
  // along the back and under the belly
  for (const [fin, dir] of [[sp.dorsal, 1], [sp.anal, -1]]) {
    if (!fin) continue;
    pillow(m, 5, 2, [0, 0, 1], 2, (s, t, o) => {
      const xb = lerp(fin[0], fin[1], s), [a, , yc] = prof(uAt(xb)), hgt = fin[2] * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.75)), 0.8);
      o[0] = xb - t * hgt * 0.4; o[1] = yc + dir * (a * 0.82 + t * hgt); o[2] = 0;
      o[3] = th * 0.85 * Math.sqrt(Math.max(4 * s * (1 - s), 0)) * (1 - Math.pow(t, 3) * 0.85);
    });
  }
  // a little paddle at each side, behind the eye
  {
    const [px, pl, pw] = sp.pect, [a, b, yc] = prof(uAt(px));
    for (const side of [1, -1]) {
      const d = [-0.8, -0.15, side * 0.58], nn = [-d[2], 0, d[0]], ln = Math.hypot(...nn);
      pillow(m, 3, 3, [nn[0] / ln, nn[1] / ln, nn[2] / ln], 3, (s, t, o) => {
        const w = pw * Math.sqrt(Math.max(1 - Math.pow(t * 1.05 - 0.05, 2), 0)) * (1 - 0.3 * t);
        o[0] = px + d[0] * t * pl; o[1] = yc - a * 0.2 + d[1] * t * pl + (s - 0.5) * w; o[2] = side * b * 0.85 + d[2] * t * pl;
        o[3] = th * 0.8 * Math.sqrt(Math.max(4 * s * (1 - s), 0)) * (1 - t * t * 0.8);
      });
    }
  }
  // spikes (the puffer)
  for (let k = 0; k < (sp.spikes ?? 0); k++) {
    const u = rng.range(0.12, 0.85), ph = rng() * TAU, [a, b, yc] = prof(u), x = xAt(u);
    const y = yc + a * Math.sin(ph), z = b * Math.cos(ph), nx = 0.15, ny = Math.sin(ph) / a, nz = Math.cos(ph) / b, l = Math.hypot(nx, ny, nz);
    const len = 0.06 + 0.03 * rng(), dx = nx / l, dy = ny / l, dz = nz / l;
    tube(m, [[x - dx * 0.01, y - dy * 0.01, z - dz * 0.01, 0.022], [x + dx * len, y + dy * len, z + dz * len, 0.004]], 4, [0, 0, 5]);
  }
  // the eyes: big black beads, half sunk, one on each side
  const [ex, ey, ez, er] = eyeOf(sp);
  for (const side of [1, -1]) ball(m, ex, ey, side * ez, er, er, er, lod ? 4 : 3, 4);
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

function fishMaterial() {
  return material({
    aux: true, shadow: false,
    vertex: (v) => {
      const t = G.time, s = fD.x, L = fC.w;
      const sc = schoolAt(t), sc0 = schoolAt(t.sub(0.1));
      // the school keeps clear of Snap and the submarine: all of it moves aside together
      const off = awayFrom(sc.c, G.snapAt.xyz, G.snapAt.w.add(fF.w).add(0.3)).add(awayFrom(sc.c, G.subAt.xyz, G.subAt.w.add(fF.w).add(0.4)));
      const P0 = fishAt(t, sc).add(off).toVar('fishP');
      const d = fishAt(t, sc).sub(fishAt(t.sub(0.1), sc0)).toVar();
      // it faces the way it goes, never steeper than about 30 degrees
      const hl = length(d.xz).add(1e-5);
      const F = normalize(vec3(d.x, clamp(d.y, hl.mul(-0.55), hl.mul(0.55)), d.z)).toVar();
      const R = normalize(cross(F, UP)).toVar();
      const Up = cross(R, F).toVar();
      // it wags: the head barely, the tail most
      const lp = v.P.toVar(), ln = v.N.toVar();
      const u = clamp(float(0.45).sub(lp.x), 0.0, 1.0).toVar();
      const ph = t.mul(fD.y).mul(TAU).add(s.mul(40.0)).sub(u.mul(2.4)).toVar();
      const amp = u.mul(u).mul(0.16).add(0.008);
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
      const lx = f.aux.x, yn = f.aux.z, part = f.aux.w;
      const pattern = vInfo.y, keep = vInfo.w;
      const body = float(1.0).sub(step(0.5, part)).toVar(), eye = one(part, 4);
      const n0 = s.n;
      // the body's colour, its second colour by pattern, the fins' colour
      const A = vC1.rgb, B = vC2.rgb;
      const second = one(pattern, 1).mul(smoothstep(0.14, 0.18, lx)).add(one(pattern, 3).mul(float(1.0).sub(smoothstep(-0.3, -0.12, yn)))).mul(body);
      const col = mix(mix(A, B, second), vC3.rgb, float(1.0).sub(body));
      const stripes = one(pattern, 2).mul(body);
      const F = normalize(vFwd), Up = normalize(vUp);
      const st = knit(s, f, { color: col, color2: mix(col, B, stripes), stripe: max(vC1.w, 1.0), scale: 40, p: vLoc, frame: [Up, F, cross(F, Up)], k: 1.0 });
      // a ring of pale felt round each eye, and the bead in it
      const ring = eyeRing(f.obj, vEye.x, vEye.y, vEye.z, vEye.w).mul(body);
      s.albedo = mix(s.albedo, lin(0.97, 0.95, 0.9).mul(st.h.mul(0.25).add(0.75)), ring);
      bead(s, n0, eye);
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
    S('shallows', 1.5, 7, 3.6, 0.9, 6, 'pastel', r, -0.3, 0.15, -40, small),
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
    S('reef', 3.6, 7, 3.4, -0.6, 5, 'reefY', r, 0.9, 0.15, 33, [0.42, 0.52], 1.5),
    S('reef', 3.7, 5.5, -2.4, 0.1, 1, 'puffer', [0.9, 0.7], 0.0, 0.12, -30, [0.55, 0.55], 1.2),
    S('reef2', 3.8, 6.5, -2.8, 0.4, 4, 'striped', r, 0.4, 0.15, 35, [0.44, 0.52], 1.5),
    S('reef2', 3.9, 7, 3.4, -0.4, 5, 'reefY', r, -0.2, 0.15, -33, [0.42, 0.52], 1.5),
    S('reef2', 4.0, 7, -2.6, 0.3, 4, 'reefT', r, 0.3, 0.15, 32, small, 1.7),
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
    // the loop's points, round a middle at `at`
    const clearOf = (at) => {
      let worst = 1e9;
      for (let k = 0; k < 16; k++) {
        const th = (k / 16) * TAU, ex = g.r[0] * Math.cos(th), ez = g.r[1] * Math.sin(th), cy = Math.cos(g.yaw), sy = Math.sin(g.yaw);
        const x = at[0] + ex * cy - ez * sy, y = at[1], z = at[2] + ex * sy + ez * cy;
        worst = Math.min(worst, nearTrack(g.p, 1.2, x, y, z) - form.rad - 1.0, avoid(g.p, x, y, z) - form.rad - g.h);
        if (worst < 0) return worst;
        worst = Math.min(worst, y - form.rad - groundY(x, z) - 0.3);
      }
      return worst;
    };
    // step it aside (further out from the middle, and lower) until all of its loop is clear
    let at = inView(g.p, g.ahead, g.side, g.up), k = 0;
    for (; k < 40 && clearOf(at) < 0; k++) {
      const out = 1 + 0.06 * (k + 1), down = (k % 2) * 0.1 * (k + 1) * 0.5;
      at = inView(g.p, g.ahead + 0.08 * k, g.side * out, g.up - down);
      const gy = groundY(at[0], at[2]) + form.rad + 0.4;
      if (at[1] < gy) at[1] = gy;
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
        E: [...c(body), 2 + Math.floor(rng() * 2)], F: [...c(second), form.rad], G: [...c(fins), 0], H: eyeOf(FISH[shape]),
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
// octopus at the end, the anglerfish.
const SLOTS = 5;
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

// The turtle: a high domed shell over a flat belly, a big round head on a thick neck, long
// broad front flippers and short back ones, a stub of a tail. About a metre long. aux.w: 0
// shell, 1 skin, 2 front flippers, 3 back flippers, 4 eyes.
const T_EYE = [0.665, 0.115, 0.098, 0.034];
function turtleShape(lod) {
  const m = new Mesh(true), res = [7, 9, 11][lod];
  blob(m, 0, 0, 0, (dx, dy, dz) => 1 / Math.hypot(dx / 0.45, dy / (dy > 0 ? 0.28 : 0.1), dz / 0.37), res, (dx, dy, dz, o) => { o[3] = 0; });
  tube(m, [[0.3, -0.01, 0, 0.1], [0.4, 0.015, 0, 0.096], [0.48, 0.04, 0, 0.1]], 8, [0, 0, 1]);
  ball(m, 0.585, 0.065, 0, 0.17, 0.145, 0.14, Math.max(res - 2, 4), 1);
  tube(m, [[-0.4, -0.02, 0, 0.05], [-0.5, -0.035, 0, 0.028], [-0.56, -0.04, 0, 0.008]], 6, [0, 0, 1]);
  for (const side of [1, -1]) ball(m, T_EYE[0], T_EYE[1], side * T_EYE[2], T_EYE[3], T_EYE[3], T_EYE[3], 3, 4);
  // flippers: long, broad and swept back in front, small behind
  for (const side of [1, -1]) {
    pillow(m, 4, lod ? 7 : 5, [0, 1, 0], 2, (s, t, o) => {
      const w = 0.2 * (1 - Math.pow(t, 1.5)) + 0.03;
      o[0] = 0.24 - 0.48 * Math.pow(t, 1.2) + (0.5 - s) * w; o[1] = -0.02 - 0.04 * t; o[2] = side * (0.27 + 0.5 * t);
      o[3] = 0.036 * (1 - t * t * 0.7) * Math.sqrt(Math.max(4 * s * (1 - s), 0));
    });
    pillow(m, 3, 3, [0, 1, 0], 3, (s, t, o) => {
      const w = 0.12 * (1 - Math.pow(t, 1.5)) + 0.02;
      o[0] = -0.31 - 0.15 * t + (0.5 - s) * w; o[1] = -0.04; o[2] = side * (0.19 + 0.18 * t);
      o[3] = 0.028 * (1 - t * t * 0.7) * Math.sqrt(Math.max(4 * s * (1 - s), 0));
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
  const FRONT = [0.24, -0.02, 0.27], BACK = [-0.31, -0.04, 0.19], NECK = vec3(0.3, 0.0, 0.0);
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
      const head = step(0.31, lp.x).mul(one(part, 1).add(one(part, 4)));
      const ph = turn(lp, NECK, 'z', ah), nh = turnN(ln, 'z', ah);
      const front = one(part, 2).greaterThan(0.5), back = one(part, 3).greaterThan(0.5), isHead = head.greaterThan(0.5);
      const q = select(front, pf, select(back, pb, select(isHead, ph, lp)));
      const qn = select(front, nf, select(back, nb, select(isHead, nh, ln)));
      const pl = placed(q, qn);
      v.P.assign(pl.P); v.N.assign(pl.N);
      vA.assign(pl.F); vB.assign(pl.Up); vP.assign(lp.mul(pl.size));
      vK.assign(vec4(pl0.look, 0.0, 0.0, 0.0));
    },
    surface: (s, f) => {
      const part = f.aux.w, lp = f.obj, look = vK.x;
      const n0 = s.n, F = normalize(vA), Up = normalize(vB), R = cross(F, Up);
      const shell = one(part, 0), eye = one(part, 4), flip = one(part, 2).add(one(part, 3));
      // the reef's turtle is brown with cream seams and cream skin in brown patches; the one at
      // the end, coral with teal skin
      const shellCol = mix(lin(0.6, 0.36, 0.22), lin(0.88, 0.48, 0.38), look), seamCol = mix(lin(0.96, 0.89, 0.74), lin(0.98, 0.9, 0.76), look);
      const skinCol = mix(lin(0.9, 0.84, 0.72), lin(0.56, 0.72, 0.74), look), spotCol = mix(lin(0.56, 0.36, 0.24), lin(0.3, 0.5, 0.54), look);
      const bellyCol = mix(lin(0.94, 0.86, 0.68), lin(0.98, 0.88, 0.72), look);
      const under = shell.mul(float(1.0).sub(smoothstep(-0.02, 0.01, lp.y)));
      // the skin's patches: on the flippers, and on top of the head
      const onHead = one(part, 1).mul(smoothstep(0.42, 0.5, lp.x)).mul(smoothstep(0.08, 0.14, lp.y));
      const spots = patches(vec2(lp.x, lp.z), 11.0).mul(flip.add(onHead)).mul(float(1.0).sub(eye));
      const aa = fwidth(lp.x).add(fwidth(lp.z)).add(1e-4);
      const sh = shellSeam(lp, aa);
      // each plate a little different
      const plateK = fract(sin(sh.id.mul(12.9898)).mul(43758.5)).sub(0.5).mul(0.18).add(1.0);
      const skin = mix(skinCol, spotCol, spots.mul(0.85));
      const st = knit(s, f, { color: mix(skin, mix(shellCol.mul(plateK), bellyCol, under), shell), scale: 26, p: vP, frame: [F, Up, R], k: 1.3 });
      const seam = sh.seam.mul(shell).mul(float(1.0).sub(under));
      s.albedo = mix(s.albedo, seamCol.mul(st.h.mul(0.4).add(0.6)), seam);
      const ring = eyeRing(lp, T_EYE[0], T_EYE[1], T_EYE[2], float(T_EYE[3])).mul(one(part, 1));
      s.albedo = mix(s.albedo, lin(0.96, 0.93, 0.86), ring);
      bead(s, n0, eye);
      glint(s, lp, T_EYE[0], T_EYE[1], T_EYE[2], T_EYE[3], eye);
    },
  });
}

// The octopus: a round head, big bead eyes, a stitched smile; eight chunky tentacles. Swimming
// (or drifting), they curl down and out and wave; at the desk the six behind hang curled and the
// front two reach over the desk's edge to rest on the letter. About 0.7 high before it is
// sized. aux.w: 0 head, 2 tentacles (built in the shader: aux = along, round, which), 4 eyes.
function octopusShape(lod) {
  const m = new Mesh(true), res = [7, 9, 11][lod];
  blob(m, 0, 0.4, 0, (dx, dy, dz) => 1 / Math.hypot(dx / 0.26, dy / (dy < 0 ? 0.25 : 0.28), dz / 0.26), res, (dx, dy, dz, o) => { o[3] = 0; });
  for (const side of [1, -1]) ball(m, 0.232, 0.395, side * 0.105, 0.046, 0.046, 0.046, 3, 4);
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
      const D = pl0.D, seat = D.x;
      const s = v.aux.x, phi = v.aux.y.mul(TAU), k = v.aux.z;
      const a = k.add(0.5).mul(TAU / 8).toVar();
      const front = step(6.5, k).add(step(k, 0.5));
      const wave = sin(t.mul(1.05).add(k.mul(1.7)).add(pl0.phase)).toVar();
      const base = vec3(cos(a).mul(0.12), 0.16, sin(a).mul(0.12));
      // drifting: every arm curls down and out, waving
      const swim = (ss) => curl(ss, a, wave.mul(0.12).sub(1.0), wave.mul(0.55).add(3.3), float(0.46), base);
      // at the desk: the arms behind hang curled; the front two arch over its edge to the letter
      const hang = (ss) => curl(ss, a, wave.mul(0.04).sub(1.35), wave.mul(0.15).add(3.9), float(0.4), base);
      const sd = sign(sin(a)), tip = vec3(D.y, D.z.add(0.035), D.w.add(sd.mul(0.19)));
      const mid = vec3(mix(base.x, tip.x, 0.45), max(base.y, tip.y).add(0.07), mix(base.z, tip.z, 0.45));
      const reach = (ss) => {
        const u = float(1.0).sub(ss);
        return base.mul(u.mul(u)).add(mid.mul(u.mul(ss).mul(2.0))).add(tip.mul(ss.mul(ss))).add(vec3(0.0, sin(t.mul(0.9).add(k.mul(2.0))).mul(0.012).mul(ss).mul(u), 0.0));
      };
      const at = (ss) => mix(swim(ss), mix(hang(ss), reach(ss), front), seat);
      const C0 = at(s).toVar(), T = normalize(at(s.add(0.02)).sub(C0)).toVar();
      const r = float(0.084).mul(float(1.0).sub(s.mul(0.45))).mul(sqrt(min(float(1.0).sub(s).mul(12.0), 1.0)));
      const rg = ringAt(C0, T, vec3(sin(a).negate(), 0.0, cos(a)), phi, r);
      // the head breathes
      const breathe = sin(t.mul(1.3).add(pl0.phase)).mul(0.025);
      const head = vec3(lp.x.mul(float(1.0).sub(breathe)), lp.y.sub(0.4).mul(breathe.add(1.0)).add(0.4), lp.z.mul(float(1.0).sub(breathe)));
      const isT = one(part, 2).greaterThan(0.5);
      const pl = placed(select(isT, rg.p, select(one(part, 0).greaterThan(0.5), head, lp)), select(isT, rg.n, ln));
      v.P.assign(pl.P); v.N.assign(pl.N);
      // the stitches: on the head in the octopus's frame; on a tentacle, along it as if it were straight
      vA.assign(select(isT, toWorld(pl, rg.S), pl.F));
      vB.assign(select(isT, toWorld(pl, T), pl.Up));
      vP.assign(select(isT, vec3(cos(phi).mul(0.06), s.mul(0.46), sin(phi).mul(-0.06)).add(k.mul(1.3)), lp).mul(pl.size));
    },
    surface: (s, f) => {
      const part = f.aux.w, lp = f.obj, n0 = s.n;
      const A = normalize(vA), B = normalize(vB);
      const eye = one(part, 4);
      knit(s, f, { color: lin(0.84, 0.54, 0.66), scale: 30, p: vP, frame: [A, B, cross(A, B)], k: 1.4 });
      // the smile: a short dark arc of stitches under the eyes
      const aa = fwidth(lp.y).add(fwidth(lp.z)).add(1e-4);
      const smile = float(1.0).sub(smoothstep(0.009, aa.add(0.009), abs(lp.y.sub(lp.z.mul(lp.z).mul(3.2).add(0.315))))).mul(step(abs(lp.z), 0.058)).mul(step(0.15, lp.x)).mul(one(part, 0));
      s.albedo = mix(s.albedo, vec3(0.06, 0.03, 0.04), smile);
      bead(s, n0, eye);
      glint(s, lp, 0.232, 0.395, 0.105, 0.046, eye);
    },
  });
}

// The anglerfish: a round dark body, a wide mouth of white teeth, bead eyes, dark violet fins
// and tail, and the lure on its stalk, glowing: it is what lights the fish, from in front and
// round its edge. aux.w: 0 body, 1 fins, 3 stalk, 4 eyes, 6 the lure.
const LURE = [0.5, 0.26, 0];
function anglerShape(lod) {
  const m = new Mesh(true), res = [6, 8, 10][lod];
  blob(m, 0, 0, 0, (dx, dy, dz) => 1 / Math.hypot(dx / (dx > 0 ? 0.3 : 0.26), dy / (dy > 0 ? 0.25 : 0.23), dz / 0.22), res, (dx, dy, dz, o) => { o[3] = 0; });
  for (const side of [1, -1]) {
    ball(m, 0.17, 0.115, side * 0.16, 0.05, 0.05, 0.05, 3, 4);
    pillow(m, 4, 3, [0, 0.3, side], 1, (s, t, o) => {
      const w = 0.17 * Math.sqrt(Math.max(1 - Math.pow(t - 0.1, 2), 0));
      o[0] = -0.04 - 0.14 * t; o[1] = -0.04 + (s - 0.5) * w + 0.03 * t; o[2] = side * (0.17 + 0.1 * t);
      o[3] = 0.018 * Math.sqrt(Math.max(4 * s * (1 - s), 0)) * (1 - t * t * 0.8);
    });
  }
  // the tail: a fan behind
  pillow(m, 5, 3, [0, 0, 1], 1, (s, t, o) => {
    const v = s * 2 - 1;
    o[0] = -0.22 - 0.2 * t; o[1] = v * (0.05 + 0.15 * Math.pow(t, 0.7)); o[2] = 0;
    o[3] = 0.022 * Math.sqrt(Math.max(1 - v * v, 0)) * (1 - t * t * 0.8);
  });
  // a low ragged fin along the back, behind the stalk
  pillow(m, 4, 2, [0, 0, 1], 1, (s, t, o) => {
    o[0] = lerp(-0.02, -0.2, s) - t * 0.03; o[1] = 0.2 - 0.06 * s + t * 0.07 * Math.sin(Math.PI * s); o[2] = 0;
    o[3] = 0.014 * Math.sqrt(Math.max(4 * s * (1 - s), 0)) * (1 - t * t);
  });
  {
    // the stalk: a smooth arc from the forehead, up, over and down to the lure
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10, a = 0.15 + u * 2.55;
      pts.push([0.31 - Math.cos(a) * 0.19, 0.24 + Math.sin(a) * 0.18 - u * 0.02, 0, 0.018 - 0.008 * u]);
    }
    pts[10][0] = LURE[0]; pts[10][1] = LURE[1] + 0.045;
    tube(m, pts, 5, [0, 0, 3]);
  }
  ball(m, LURE[0], LURE[1], LURE[2], 0.048, 0.048, 0.048, 3, 6);
  return m.build();
}
// (the lure sways on its stalk: the same turn in both materials)
const lureSway = (t, phase) => sin(t.mul(0.9).add(phase)).mul(0.14);
const STALK = vec3(0.13, 0.24, 0.0);
const LURE_COL = lin(0.55, 1.0, 0.92);
// (and nothing glowing is drawn beyond about 44 m: it fades out before it is switched off)
const far = (d, a, b) => float(1.0).sub(smoothstep(a, b, d));
function anglerMaterial() {
  return material({
    aux: true, shadow: false,
    vertex: (v) => {
      const t = G.time, lp = v.P.toVar(), ln = v.N.toVar(), part = v.aux.w;
      const pl0 = placed(vec3(0.0), vec3(1.0, 0.0, 0.0));
      const w = t.mul(TAU * 0.6).add(pl0.phase);
      // the tail wags, the fins flutter, the lure sways on its stalk
      const at = sin(w).mul(0.3).mul(float(1.0).sub(smoothstep(-0.3, -0.2, lp.x)).mul(one(part, 1)));
      const q0 = turn(lp, vec3(-0.22, 0.0, 0.0), 'y', at), n0 = turnN(ln, 'y', at);
      const af = sin(w.mul(1.3)).mul(0.3).mul(one(part, 1).mul(step(0.12, abs(lp.z)))).mul(sign(lp.z));
      const q1 = turn(q0, vec3(0.0, 0.0, lp.z.mul(0.9)), 'x', af), n1 = turnN(n0, 'x', af);
      const sway = lureSway(t, pl0.phase), al = sway.mul(one(part, 3).add(one(part, 6)));
      const pl = placed(turn(q1, STALK, 'z', al), turnN(n1, 'z', al));
      v.P.assign(pl.P); v.N.assign(pl.N);
      vA.assign(pl.F); vB.assign(pl.Up); vP.assign(lp.mul(pl.size));
      vL.assign(placed(turn(vec3(LURE[0], LURE[1], LURE[2]), STALK, 'z', sway), vec3(1.0, 0.0, 0.0)).P);
    },
    surface: (s, f) => {
      const part = f.aux.w, lp = f.obj, n0 = s.n, F = normalize(vA), Up = normalize(vB);
      const fins = one(part, 1), stalk = one(part, 3), eye = one(part, 4), lure = one(part, 6);
      knit(s, f, { color: mix(mix(lin(0.26, 0.3, 0.42), lin(0.56, 0.3, 0.66), fins), lin(0.3, 0.27, 0.38), stalk), scale: 30, p: vP, frame: [F, Up, cross(F, Up)], k: 1.3 });
      // the mouth: a wide dark grin from the front back along each side, with a row of white teeth
      const aa = fwidth(lp.y).add(fwidth(lp.x)).add(1e-4);
      const front = smoothstep(0.02, 0.1, lp.x).mul(one(part, 0));
      const lipY = lp.x.sub(0.3).mul(lp.x.sub(0.3)).mul(-1.2).add(lp.z.mul(lp.z).mul(0.6)).sub(0.045);
      const gap = float(1.0).sub(smoothstep(0.022, aa.add(0.026), abs(lp.y.sub(lipY)))).mul(front);
      const tooth = abs(fract(lp.x.mul(22.0).add(lp.z.mul(14.0))).sub(0.5)).mul(2.0);
      const teeth = float(1.0).sub(smoothstep(0.0, aa.mul(2.0).add(0.004), lp.y.sub(lipY).add(0.016).sub(tooth.mul(0.024)))).mul(front);
      s.albedo = mix(mix(s.albedo, vec3(0.003, 0.001, 0.004), gap), lin(0.95, 0.94, 0.9), teeth.mul(gap));
      bead(s, n0, eye);
      glint(s, lp, 0.17, 0.115, 0.16, 0.05, eye);
      // the lure's light on it: on what faces it, and in a rim round its edge
      const toL = vL.sub(f.w), dl = length(toL), ld = toL.div(dl);
      const facing = max(dot(s.n, ld).add(0.1), 0.0).div(1.1);
      const vv = normalize(cameraPosition.sub(f.w)), rim = pow(float(1.0).sub(abs(dot(s.n, vv))), 2.5);
      const lit = facing.mul(facing).mul(float(1.4).div(dl.mul(dl).mul(14.0).add(1.0))).add(0.02);
      const fade = far(f.dist, 34.0, 48.0);
      // (the lit side as the lure's light on its dark wool; the rim a glow of its own, so the
      // outline reads against the dark water and the rock)
      s.emis = s.emis.add(s.albedo.mul(2.6).add(0.01).mul(lit).add(rim.mul(pow(facing, 0.8)).mul(0.16)).mul(LURE_COL).mul(float(1.0).sub(lure)).mul(fade));
      s.albedo = mix(s.albedo, lin(0.7, 1.0, 0.95), lure);
      s.emis = s.emis.add(LURE_COL.mul(lure).mul(5.0).mul(fade));
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
      v.P.assign(at.P.add(U.right.mul(c0.x).add(U.up.mul(c0.y)).mul(at.size.mul(0.4))));
      v.aux.assign(vec4(c0, 0.0, 0.0));
      vK.assign(vec4(exp(SIG.mul(d).negate()).mul(smoothstep(0.4, 1.2, d)).mul(far(d, 34.0, 48.0)), 0.0));
    },
    raw: (f) => {
      const r2 = dot(f.aux.xy, f.aux.xy);
      const m = exp(r2.mul(-5.0)).mul(float(1.0).sub(smoothstep(0.55, 1.0, r2)));
      return { color: lin(0.35, 1.0, 0.9).mul(m).mul(0.85).mul(vK.rgb), alpha: float(1.0) };
    },
  });
}

// ---- gulls ------------------------------------------------------------------------------------

// A gull of felt: a white body and head, grey wings with dark tips, a yellow beak, bead eyes,
// a small fan of a tail. About a metre from wing tip to wing tip, x forward. aux.w: 0 body,
// 1 wings, 2 beak, 3 tail, 4 eyes.
function gullShape(lod) {
  const m = new Mesh(true), res = [4, 5, 6][lod];
  ball(m, 0, 0, 0, 0.17, 0.062, 0.068, res, 0);
  ball(m, 0.15, 0.04, 0, 0.056, 0.05, 0.048, res, 0);
  tube(m, [[0.195, 0.034, 0, 0.015], [0.24, 0.026, 0, 0.005]], 5, [0, 0, 2]);
  for (const side of [1, -1]) ball(m, 0.18, 0.055, side * 0.033, 0.01, 0.01, 0.01, 2, 4);
  for (const side of [1, -1]) {
    pillow(m, 3, lod ? 6 : 4, [0, 1, 0], 1, (s, t, o) => {
      const chord = 0.14 * (1 - 0.55 * Math.pow(t, 1.2));
      o[0] = 0.04 - 0.07 * t - (s - 0.25) * chord; o[1] = 0.02 + 0.025 * Math.sin(Math.PI * t); o[2] = side * (0.05 + 0.47 * t);
      o[3] = 0.011 * (1 - 0.6 * t) * Math.sqrt(Math.max(4 * s * (1 - s), 0));
    });
  }
  pillow(m, 3, 2, [0, 1, 0], 3, (s, t, o) => {
    const v = s * 2 - 1;
    o[0] = -0.14 - 0.09 * t; o[1] = 0.005; o[2] = v * (0.03 + 0.045 * t);
    o[3] = 0.008 * Math.sqrt(Math.max(1 - v * v, 0));
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
      const F = normalize(vA), Up = normalize(vB);
      knit(s, f, { color: col, scale: 70, p: vP, frame: [F, Up, cross(F, Up)], k: 0.9, fuzz: 1.5 });
      bead(s, n0, eye);
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
// how far it keeps from the submarine (beyond the submarine's own keep-clear radius: about the
// submarine's length) and from Snap. (jellySpots places them by the same numbers.)
const J_DRIFT = 0.25, J_SUB = 1.9, J_SNAP = 0.6;
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

// The bell: a crocheted dome in two colours of stripes, a rolled rim of glowing yarn; it
// squeezes from the rim and the light inside it brightens as it does. aux = (from the top
// 0 to the rim 1 and past it round the rolled edge, round 0..1).
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
  return m.build();
}
function bellMaterial() {
  return material({
    aux: true, twoSided: true, shadow: false,
    vertex: (v) => {
      const t = G.time, R = jA.w, J = jellyAt(t), con = pulse(t);
      const lp = v.P.toVar(), ln = v.N.toVar(), tb = v.aux.x;
      const sq = float(1.0).sub(con.mul(0.16).mul(pow(min(tb, 1.0), 1.3))), st = con.mul(0.08).add(1.0);
      const tilt = vec2(sin(t.mul(0.37).add(jB.x.mul(17.0))), cos(t.mul(0.31).add(jB.x.mul(11.0)))).mul(0.1);
      const q = vec3(lp.x.mul(sq).sub(lp.y.mul(tilt.x)), lp.y.mul(st), lp.z.mul(sq).sub(lp.y.mul(tilt.y)));
      v.P.assign(J.c.add(q.mul(R)));
      v.N.assign(normalize(vec3(ln.x.div(sq), ln.y.div(st), ln.z.div(sq))));
      vJ0.assign(vec4(jellyKeep(J.c, J.fade), con));
      vJ1.assign(jC); vJ2.assign(jD);
      vP.assign(lp.mul(R).add(jB.x.mul(5.0)));
    },
    surface: (s, f) => {
      const tb = f.aux.x, glow = glowOf(vJ2.w), keep = vJ0.rgb, con = vJ0.w;
      knit(s, f, { color: vJ1.rgb, color2: vJ2.rgb, stripe: 2, scale: 34, p: vP, frame: [vec3(1.0, 0.0, 0.0), UP, vec3(0.0, 0.0, 1.0)], k: 1.3 });
      // the rim is glowing yarn; the dome glows faintly from inside, more as it squeezes
      const rim = smoothstep(0.97, 1.03, tb);
      const inside = float(0.18).add(con.mul(0.25)).mul(float(1.0).sub(rim));
      s.emis = s.emis.add(glow.mul(rim.mul(2.2).add(inside.mul(s.albedo.g.add(0.3)))).mul(vJ1.w).mul(keep.mul(0.5).add(0.5)));
    },
  });
}
// Its tentacles: cords of glowing yarn hanging from under the rim, and three arms in tight
// corkscrew curls from the middle, each point following the bell as it was a moment before,
// so the pulse runs down them. (aux.z: where round the bell; aux.w: 0 a cord, 1 a curl, plus
// half its length.)
function tentacleShape(lod) {
  const m = new Mesh(true), ns = [10, 14, 18][lod], nside = [4, 5, 6][lod], rng = makeRng(31), nc = [5, 6, 7][lod];
  tubes(m, nc, ns, nside, () => rng.range(0.6, 1.0) * 0.5);
  const first = m.count;
  tubes(m, 3, ns * 2, nside, () => 1 + rng.range(0.7, 1.0) * 0.5);
  for (let v = 0; v < m.count; v++) m.a[v * 4 + 2] = v < first ? (m.a[v * 4 + 2] + 0.5) / nc : (m.a[v * 4 + 2] + 0.3) / 3;
  return m.build();
}
function tentacleMaterial() {
  return material({
    aux: true, shadow: false,
    vertex: (v) => {
      const t = G.time, R = jA.w, J = jellyAt(t);
      const s = v.aux.x, phi = v.aux.y.mul(TAU), ang = v.aux.z.mul(TAU), curly = step(1.0, v.aux.w), lf = fract(v.aux.w).mul(2.0);
      const conL = pulse(t.sub(s.mul(0.9)));
      const len = R.mul(jB.w).mul(lf).mul(mix(float(1.0), float(0.6), curly)).toVar();
      const out = vec3(cos(ang), 0.0, sin(ang)), tang = vec3(sin(ang).negate(), 0.0, cos(ang));
      const at = (ss) => {
        const sway = vec3(sin(t.mul(0.6).add(ss.mul(3.2)).add(ang.mul(2.0)).add(jB.x.mul(9.0))), 0.0, cos(t.mul(0.5).add(ss.mul(2.7)).add(ang.mul(1.7)).add(jB.x.mul(5.0)))).mul(ss.mul(ss).mul(len).mul(0.2));
        // a cord hangs from under the rim, drawn in a little as the bell squeezes
        const cord = out.mul(R.mul(float(0.8).sub(conL.mul(0.12))).mul(float(1.0).sub(ss.mul(0.25))));
        // a curl winds round a line that hangs from near the middle
        const th = ss.mul(len).div(R.mul(0.11)).add(t.mul(0.6));
        const coil = out.mul(R.mul(0.22)).add(vec3(cos(th), 0.0, sin(th)).mul(R.mul(0.09)));
        return J.c.add(mix(cord, coil, curly)).add(vec3(0.0, R.mul(-0.7).sub(ss.mul(len).mul(float(1.0).sub(conL.mul(0.08)))), 0.0)).add(sway);
      };
      const C0 = at(s).toVar(), T = normalize(at(s.add(0.01)).sub(C0)).toVar();
      const r = R.mul(mix(float(0.075), float(0.06), curly)).mul(float(1.0).sub(s.mul(0.35))).mul(sqrt(min(float(1.0).sub(s).mul(25.0), 1.0)));
      const rg = ringAt(C0, T, tang, phi, r);
      v.P.assign(rg.p); v.N.assign(rg.n);
      vJ0.assign(vec4(jellyKeep(J.c, J.fade), s));
      vJ1.assign(jC); vJ2.assign(jD);
      vA.assign(rg.S); vB.assign(T);
      vP.assign(vec3(cos(phi).mul(0.03), s.mul(len), sin(phi).mul(-0.03)).add(v.aux.z.mul(7.0)));
    },
    surface: (s, f) => {
      const A = normalize(vA), B = normalize(vB);
      // each strand in one of the two glows; the glowing yarn is bright all along
      const glow = glowOf(step(0.5, fract(f.aux.z.mul(3.7).add(vJ2.w))));
      knit(s, f, { color: mix(glow, vJ2.rgb, 0.35), scale: 40, p: vP, frame: [A, B, cross(A, B)], k: 1.1 });
      s.emis = s.emis.add(glow.mul(float(1.5).sub(vJ0.w.mul(0.6))).mul(vJ1.w).mul(vJ0.rgb.mul(0.5).add(0.5)));
    },
  });
}
// The haze of light round each jelly.
function haloMaterial() {
  return material({
    additive: true,
    vertex: (v) => {
      const J = jellyAt(G.time), c0 = v.P.xy.toVar();
      v.P.assign(J.c.sub(vec3(0.0, jA.w.mul(0.9), 0.0)).add(U.right.mul(c0.x).add(U.up.mul(c0.y)).mul(jA.w.mul(3.2))));
      v.aux.assign(vec4(c0, 0.0, 0.0));
      vJ0.assign(vec4(jellyKeep(J.c, J.fade), 0.0));
      vJ2.assign(jD); vJ1.assign(jC);
    },
    raw: (f) => {
      const r2 = dot(f.aux.xy, f.aux.xy);
      const m = exp(r2.mul(-3.0)).mul(float(1.0).sub(smoothstep(0.5, 1.0, r2)));
      return { color: glowOf(vJ2.w).mul(m).mul(0.07).mul(vJ1.w).mul(vJ0.rgb), alpha: float(1.0) };
    },
  });
}

// The siphonophore: a long glowing teal cord, and round it a cord of pink and teal loops
// coiled like a spring, along a line that sways and arches. Built in the shader: aux = (along
// 0..1, round 0..1, -, 1 the middle cord or 0 the loops). Where it is comes in every frame (SI).
const SI = { c: uniform(new Vector3(0, -1000, 0)), d: uniform(new Vector3(1, 0, 0)), n: uniform(new Vector3(0, 0, 1)), len: uniform(14), k: uniform(1) };
function siphonoMaterial() {
  const turns = 84, rh = SI.k.mul(0.2), rc = SI.k.mul(0.052), rCore = SI.k.mul(0.06);
  return material({
    aux: true, shadow: false,
    vertex: (v) => {
      const t = G.time, s = v.aux.x, phi = v.aux.y.mul(TAU), core = v.aux.w;
      const len = SI.len, D = SI.d, N2 = SI.n, N1 = normalize(cross(N2, D));
      const spine = (ss) => SI.c.add(D.mul(ss.sub(0.5).mul(len))).add(N1.mul(sin(ss.mul(TAU * 1.1).sub(t.mul(0.21))).mul(SI.k.mul(0.32))))
        .add(N2.mul(sin(ss.mul(TAU * 0.7).add(t.mul(0.17)).add(1.3)).mul(SI.k.mul(0.6)))).add(vec3(0.0, sin(ss.mul(Math.PI)).mul(SI.k.mul(0.55)), 0.0));
      const S0 = spine(s).toVar(), Ts = normalize(spine(s.add(0.002)).sub(S0)).toVar();
      // (the loops a little uneven, and flatter seen side on, as crochet loops are)
      const coil = (ss, S, T) => {
        const n1 = normalize(cross(T, N2)), n2 = cross(T, n1);
        const th = ss.mul(TAU * turns).add(t.mul(0.5)), big = sin(ss.mul(TAU * 9.0)).mul(0.18).add(sin(ss.mul(TAU * 23.0)).mul(0.1)).add(1.0);
        return S.add(n1.mul(cos(th)).add(n2.mul(sin(th).mul(0.8))).mul(rh.mul(big)));
      };
      const H0 = coil(s, S0, Ts).toVar();
      const s1 = s.add(0.0006), S1 = spine(s1);
      const T = normalize(select(core.greaterThan(0.5), Ts, normalize(coil(s1, S1, normalize(spine(s1.add(0.002)).sub(S1))).sub(H0)))).toVar();
      const rg = ringAt(select(core.greaterThan(0.5), S0, H0), T, Ts, phi, select(core.greaterThan(0.5), rCore, rc));
      v.P.assign(rg.p); v.N.assign(rg.n);
      vA.assign(rg.S); vB.assign(T);
      vP.assign(vec3(cos(phi).mul(rc), s.mul(select(core.greaterThan(0.5), float(1.0), float(turns * 0.7)).mul(len)), sin(phi).mul(rc.negate())).div(SI.k));
      const dc = length(S0.sub(cameraPosition));
      vJ0.assign(vec4(exp(SIG.mul(dc).mul(0.6).negate()).mul(far(dc, 38.0, 52.0)), s));
      vJ1.assign(vec4(core, 0.0, 0.0, 0.0));
      vJ2.assign(vec4(normalize(S0.sub(H0)), 0.0));
    },
    surface: (s, f) => {
      const A = normalize(vA), B = normalize(vB), along = vJ0.w, core = vJ1.x;
      // pink loops, teal where the glowing middle cord lights their inner side, and in a few
      // stretches teal loops
      const stretch = smoothstep(0.6, 0.85, sin(along.mul(TAU * 6.0)).mul(0.5).add(0.5));
      const loops = mix(lin(0.98, 0.42, 0.74), lin(0.3, 0.95, 0.86), stretch);
      knit(s, f, { color: mix(loops, lin(0.45, 1.0, 0.92), core), scale: 46, p: vP, frame: [A, B, cross(A, B)], k: 1.1 });
      const inward = max(dot(s.n, normalize(vJ2.xyz)), 0.0).mul(float(1.0).sub(core));
      const ends = smoothstep(0.0, 0.04, along).mul(float(1.0).sub(smoothstep(0.96, 1.0, along)));
      const glow = loops.mul(0.75).add(TEAL.mul(inward.mul(1.6))).mul(float(1.0).sub(core)).add(lin(0.4, 1.0, 0.9).mul(core).mul(3.0));
      s.emis = s.emis.add(glow.mul(ends).mul(vJ0.rgb.mul(0.4).add(0.6)));
    },
  });
}

// ---- the vents ------------------------------------------------------------------------------

// The vents are dark but for the lava: what lives there gets a soft light from the eye's
// side too, as a diorama is lit for its picture, so it reads against the black.
function ventFill(s, f) {
  const deep = smoothstep(150.0, 185.0, f.w.y.negate()), v = normalize(cameraPosition.sub(f.w));
  s.emis = s.emis.add(s.albedo.mul(vec3(0.17, 0.12, 0.1)).mul(max(dot(s.n, v), 0.0).mul(0.65).add(0.35)).mul(deep));
}
// Tube worms: crocheted tubes in red and white rows, in clumps; most with a red plume of
// short fat tentacles on top, a few just an open red rim. Built in the shader from rings:
// aux = (along, round, which: the tube or the plume's tentacles, 0 the tube or 1 a tentacle).
// Per worm: wA its foot (x, y, z) and height; wB its lean (x, z), its seed, plume (1) or not.
// The taller the worm, the fatter.
const wA = attribute('wA', 'vec4'), wB = attribute('wB', 'vec4');
function wormShape(lod) {
  const m = new Mesh(true);
  tubes(m, 1, [7, 9, 10][lod], [6, 7, 8][lod], () => 0);
  tubes(m, 7, [3, 4, 4][lod], [4, 4, 4][lod], () => 1);
  return m.build();
}
function wormMaterial() {
  return material({
    aux: true, twoSided: true, shadow: false,
    vertex: (v) => {
      const t = G.time, s = v.aux.x, phi = v.aux.y.mul(TAU), k = v.aux.z, plumeK = v.aux.w;
      const H = wA.w, seed = wB.z, rw = H.mul(0.034).add(0.056), kr = rw.div(0.085);
      // (a tall one leans away from the submarine where it passes low over them)
      const lean = awayFrom(wA.xyz.add(vec3(0.0, H, 0.0)), G.subAt.xyz, G.subAt.w.add(0.35)).div(H);
      const sway = vec2(sin(t.mul(0.5).add(seed.mul(20.0))), cos(t.mul(0.43).add(seed.mul(13.0)))).mul(0.06).add(wB.xy).add(lean.xz);
      const stem = (ss) => wA.xyz.add(vec3(sway.x.mul(ss).mul(ss).mul(H), ss.mul(H), sway.y.mul(ss).mul(ss).mul(H)));
      // the tube, flaring a little at its mouth
      const C0 = stem(s).toVar(), T0 = normalize(stem(s.add(0.02)).sub(C0)).toVar();
      const rgT = ringAt(C0, T0, vec3(1.0, 0.0, 0.0), phi, rw.mul(smoothstep(0.85, 1.0, s).mul(0.25).add(1.0)));
      // a plume tentacle: out from the rim, up, and over, waving
      const top = stem(float(1.0)), Tt = normalize(top.sub(stem(float(0.95))));
      const a = k.mul(TAU / 7).add(seed.mul(6.0)), o0 = vec3(cos(a), 0.0, sin(a));
      const out = normalize(o0.sub(Tt.mul(dot(o0, Tt))));
      const wave = sin(t.mul(1.4).add(k.mul(1.9)).add(seed.mul(9.0))).mul(0.25);
      const pl = (ss) => top.add(out.mul(ss.mul(0.15).add(0.05).add(ss.mul(ss).mul(wave).mul(0.1)).mul(kr))).add(Tt.mul(ss.mul(0.12).sub(ss.mul(ss).mul(0.06)).add(0.015).mul(kr)));
      const C1 = pl(s).toVar(), T1 = normalize(pl(s.add(0.05)).sub(C1)).toVar();
      const rgP = ringAt(C1, T1, cross(out, Tt), phi, float(0.032).mul(kr).mul(float(1.0).sub(s.mul(0.4))).mul(sqrt(min(float(1.0).sub(s).mul(10.0), 1.0))));
      const tent = step(0.5, plumeK).greaterThan(0.5), isP = step(0.5, plumeK).mul(step(0.5, wB.w)).greaterThan(0.5);
      v.P.assign(select(isP, rgP.p, select(tent, top, rgT.p)));
      v.N.assign(select(isP, rgP.n, rgT.n));
      vA.assign(select(isP, rgP.S, rgT.S)); vB.assign(select(isP, T1, T0));
      vP.assign(vec3(cos(phi).mul(rw.mul(0.9)), s.mul(select(isP, float(0.2).mul(kr), H)), sin(phi).mul(rw.mul(-0.9))).add(seed.mul(4.0)));
      vK.assign(vec4(plumeK, s, 0.0, 0.0));
    },
    surface: (s, f) => {
      const A = normalize(vA), B = normalize(vB), red = lin(0.84, 0.16, 0.13), white = lin(0.95, 0.92, 0.87);
      const solidRed = max(step(0.5, vK.x), smoothstep(0.88, 0.92, vK.y));
      knit(s, f, { color: mix(white, red, solidRed), color2: red, stripe: 3, scale: 32, p: vP, frame: [A, B, cross(A, B)], k: 1.3 });
      ventFill(s, f);
    },
  });
}

// Sea sheep: little fluffy white slugs, all bobbles, two bead eyes and two soft ears.
// aux.w: 0 wool, 4 eyes. Per sheep: hA where it sits and its size; hB which way it faces, its seed.
const hA = attribute('hA', 'vec4'), hB = attribute('hB', 'vec4');
function sheepShape(lod) {
  const m = new Mesh(true), rng = makeRng(5), res = [5, 6, 7][lod];
  ball(m, 0, 0.08, 0, 0.17, 0.09, 0.105, res, 0);
  for (let i = 0, n = [16, 24, 32][lod]; i < n; i++) {
    const a = rng() * TAU, up = rng.range(0.1, 1), x = rng.range(-0.15, 0.13);
    const y = 0.08 + 0.085 * up, z = Math.cos(a) * 0.1 * Math.sqrt(1 - up * up * 0.6) * (1 - Math.abs(x) * 1.5);
    const r = rng.range(0.03, 0.05);
    ball(m, x, y + Math.abs(Math.sin(a)) * 0.02, z, r, r * 0.9, r, 2, 0);
  }
  for (const side of [1, -1]) {
    ball(m, 0.15, 0.12, side * 0.045, 0.019, 0.019, 0.019, 2, 4);
    tube(m, [[0.11, 0.15, side * 0.035, 0.016], [0.1, 0.21, side * 0.05, 0.014], [0.07, 0.25, side * 0.06, 0.01]], 5, [0, 0, 0]);
  }
  return m.build();
}
function sheepMaterial() {
  return material({
    aux: true, shadow: false,
    vertex: (v) => {
      const t = G.time, lp = v.P.toVar(), ln = v.N.toVar(), seed = hB.z;
      // it breathes, and now and then looks about
      const b = sin(t.mul(1.1).add(seed.mul(20.0))).mul(0.03);
      const look = sin(t.mul(0.23).add(seed.mul(7.0))).mul(0.3).mul(smoothstep(0.0, 0.12, lp.x));
      const q = turn(vec3(lp.x, lp.y.mul(b.add(1.0)), lp.z.mul(b.mul(0.5).add(1.0))), vec3(0.05, 0.1, 0.0), 'y', look);
      const F = vec3(cos(hB.x), 0.0, sin(hB.x)), R = vec3(sin(hB.x).negate(), 0.0, cos(hB.x));
      v.P.assign(hA.xyz.add(F.mul(q.x).add(UP.mul(q.y)).add(R.mul(q.z)).mul(hA.w)));
      v.N.assign(normalize(F.mul(ln.x).add(UP.mul(ln.y)).add(R.mul(ln.z))));
      vA.assign(F); vP.assign(lp.mul(hA.w).add(seed.mul(3.0)));
    },
    surface: (s, f) => {
      const n0 = s.n, F = normalize(vA);
      knit(s, f, { color: lin(0.97, 0.92, 0.82), scale: 46, p: vP, frame: [F, UP, cross(F, UP)], k: 1.6, fuzz: 2.4 });
      ventFill(s, f);
      bead(s, n0, one(f.aux.w, 4));
    },
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
// Where the camera is nearest to a place at the vents: its p.
const ventP = (z) => Math.min(Math.max(6.25 + ((-314 - z) / 69) * 0.75, 6.25), 7.0);

// A box's corners on the screen of camera c: [x0, x1, y0, y1, nearest along the line of sight].
function rectOf(c, scr, x0, x1, y0, y1, z0, z1, out = [0, 0, 0, 0, 0]) {
  const q = [0, 0, 0];
  out[0] = out[2] = 1e9; out[1] = out[3] = -1e9; out[4] = 1e9;
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) {
    project(c, x, y, z, scr, q);
    out[0] = Math.min(out[0], q[0]); out[1] = Math.max(out[1], q[0]); out[2] = Math.min(out[2], q[1]); out[3] = Math.max(out[3], q[1]); out[4] = Math.min(out[4], q[2]);
  }
  return out;
}
const overlaps = (a, b, m) => a[0] < b[1] + m && a[1] > b[0] - m && a[2] < b[3] + m && a[3] > b[2] - m;

// Where the jellies live: down the drop-off, in the view at each height as the camera goes down,
// and some where it comes back up. Each must keep, wherever it bobs and drifts, a submarine's
// length and more from the submarine at every point of its way, on either shape of screen (so
// the push aside in its shader has little to do and always from the side); keep clear of the
// siphonophore and the anglerfish while they go down with the visitor; and at the moments the
// visitor stops at, neither cover the submarine nor be cut by the page's header. [x, y, z,
// radius, tentacles' length in radii]
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
  for (const [p, scr] of [[5.3, SCREENS.wide], [5.5, SCREENS.wide], [5.66, SCREENS.wide], [7.4, SCREENS.wide], [5.5, SCREENS.tall], [5.7, SCREENS.tall], [7.4, SCREENS.tall]]) {
    const c = camAt(p), s = subAt(p, scr.kind, [0, 0, 0]);
    // (the submarine lies across the view: about 2.3 m long, 1.1 m high with its skids, 1 m wide)
    const ax = Math.abs(c.R[0]) * 1.15 + Math.abs(c.L[0]) * 0.55, az = Math.abs(c.R[2]) * 1.15 + Math.abs(c.L[2]) * 0.55;
    const sub = rectOf(c, scr, s[0] - ax, s[0] + ax, s[1] - 0.6, s[1] + 0.55, s[2] - az, s[2] + az);
    let ang = null;
    if (p >= ANGLER[0] - 0.04 && p <= ANGLER[1] + 0.06) {
      const o = anglerAt(p, scr.tanV, scr.aspect, { c: [0, 0, 0], f: [0, 0, 0] });
      ang = rectOf(c, scr, o.c[0] - 0.75, o.c[0] + 0.75, o.c[1] - 0.6, o.c[1] + 0.7, o.c[2] - 0.75, o.c[2] + 0.75);
    }
    beats.push({ c, scr, sub, ang });
  }
  const along = new Map();
  for (let p = SIPHON[0] - 0.24; p <= SIPHON[1] + 0.03; p += 0.01) for (const scr of scrs) {
    const o = siphonAt(p, scr.tanV, scr.aspect, { c: [0, 0, 0], d: [0, 0, 0], f: [0, 0, 0], len: 0, k: 1 });
    for (let i = 0; i <= 16; i++) { const u = i / 16 - 0.5; bucket(along, [o.c[0] + o.d[0] * u * o.len, o.c[1] + o.d[1] * u * o.len + Math.cos(u * Math.PI) * 0.55 * o.k, o.c[2] + o.d[2] * u * o.len, 1.0 * o.k + 0.3]); }
    if (p >= ANGLER[0] - 0.02 && p <= ANGLER[1] + 0.03) { const a = anglerAt(p, scr.tanV, scr.aspect, { c: [0, 0, 0], f: [0, 0, 0] }); bucket(along, [a.c[0], a.c[1], a.c[2], 1.6]); }
  }
  const list = [], rect = [0, 0, 0, 0, 0];
  const ok = (x, y, z, R, Lt) => {
    const low = y - jLow(R, Lt) - 0.6, top = y + 0.15 * R + 0.6, sd = J_DRIFT + 0.15;
    if (low < groundY(x, z) + 1.5) return false;
    for (const j of list) if (Math.hypot(j[0] - x, j[1] - y, j[2] - z) < 3.2) return false;
    const need = 1.3 + J_SUB + 1.05 * R + 0.25 + 0.35;
    if (near(subs, low - need, top + need, (s) => { const v = Math.min(Math.max(s[1], low), top) - s[1]; return (x - s[0]) ** 2 + (z - s[2]) ** 2 + v * v < need * need; })) return false;
    if (near(along, low - 4, top + 4, (a) => { const v = Math.min(Math.max(a[1], low), top) - a[1], r = a[3] + R + sd; return (x - a[0]) ** 2 + (z - a[2]) ** 2 + v * v < r * r; })) return false;
    for (const b of beats) {
      rectOf(b.c, b.scr, x - R - sd, x + R + sd, low, top, z - R - sd, z + R + sd, rect);
      if (rect[4] < 0.5 || rect[0] > 1.05 || rect[1] < -1.05 || rect[2] > 1.05 || rect[3] < -1.05) continue;
      if (overlaps(rect, b.sub, 0.04) || (b.ang && overlaps(rect, b.ang, 0.04))) return false;
      // (cut by the header: only what is big enough to notice)
      if (rect[3] > b.scr.top - 0.03 && rect[2] < 1.05 && rect[3] - rect[2] > 0.16) return false;
    }
    return offTrack(x, z, y) > 2.2 + R && offTrack(x, z, (y + low) / 2) > 1.6 + R;
  };
  // (spread by the camera's height as it passes, more where the visitor stops on the way down)
  const pAtY = (y, from, to) => {
    let best = from, bd = 1e9;
    for (let p = from; p <= to; p += 0.005) { pathAt(p, _o); const d = Math.abs(_o[1] - y); if (d < bd) { bd = d; best = p; } }
    return best;
  };
  // first, at each moment, a few placed for it: on a wide screen one between the words and
  // the submarine and one beyond it, on a phone's one below it; then the rest, spread by the
  // camera's height as it passes, in the view there
  const tryAt = (pc, scr, nx, ny, d, zMax) => {
    const R = rng.range(0.55, 0.75), Lt = rng.range(3.6, 5.0);
    onScreen(q, camAt(pc, _cA), d, nx, ny, scr.tanV, scr.aspect);
    if (q[2] > zMax || !ok(q[0], q[1], q[2], R, Lt)) return false;
    list.push([q[0], q[1], q[2], R, Lt]);
    return true;
  };
  for (const [pc, zMax] of [[5.3, -279], [5.5, -279], [5.66, -279], [7.4, 1e9]]) {
    for (let k = 0; k < 80 && !tryAt(pc, SCREENS.wide, rng.range(-0.3, -0.1), rng.range(-0.6, 0.3), rng.range(8.5, 12), zMax); k++);
    for (let k = 0; k < 80 && !tryAt(pc, SCREENS.wide, rng.range(0.62, 0.98), rng.range(-0.8, -0.15), rng.range(7, 11), zMax); k++);
  }
  for (const [pc, zMax] of [[5.5, -279], [5.7, -279], [7.4, 1e9]]) {
    for (let k = 0; k < 80 && !tryAt(pc, SCREENS.tall, rng.range(-0.7, -0.1), rng.range(-0.6, -0.25), rng.range(8, 11.5), zMax); k++);
  }
  const designed = list.length;
  const make = (count, from, to, ys, sides, ups, zMax) => {
    for (let tries = 0, k = 0; k < count && tries < count * 200; tries++) {
      const band = ys[Math.min(Math.floor(((k + rng()) / count) * ys.length), ys.length - 1)];
      const pc = pAtY(rng.range(band[0], band[1]), from, to), c = camAt(pc, _cA);
      // (on a wide screen: in its left third, behind the words; or either side of the submarine)
      const left = rng() < sides, mid = rng() < 0.5, nx = left ? rng.range(-1.05, -0.6) : mid ? rng.range(-0.34, 0.0) : rng.range(0.6, 1.1), ny = rng.range(ups[0], ups[1]);
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
    if (p > 4.45 && p < 7.75) continue;
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
  const reefC = mid(REEF_TURTLE[0], REEF_TURTLE[1], 6), endC = inView(7.95, 5, 0, -1.5), angC = mid(ANGLER[0], ANGLER[1], 5), cabC = wreck ? wreck.cabin.toArray() : inView(4.6, 3, 0, 0);
  add(solid(copies(turtleGeo, 1, slot(0, 0, 0.3), new Sphere(new Vector3(...reefC), 30)), turtleMat), 100);
  add(solid(copies(turtleGeo, 1, slot(1, 1, 0.7), new Sphere(new Vector3(...endC), 12)), turtleMat), 80);
  add(solid(copies(octGeo, 1, slot(2, 0, 0.1), new Sphere(new Vector3(...cabC), 16)), octMat), 80);
  add(solid(copies(octGeo, 1, slot(3, 0, 0.6), new Sphere(new Vector3(...endC), 12)), octMat), 80);
  add(solid(copies(anglerShape(lod), 1, slot(4, 0, 0.5), new Sphere(new Vector3(...angC), 34)), anglerMaterial()), 52);
  add(solid(cards(1, slot(4, 0, 0.5), new Sphere(new Vector3(...angC), 34)), lureGlowMaterial()), 52);

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
  const BELLS = [[[0.3, 0.82, 0.8], [0.62, 0.36, 0.78], 0], [[0.95, 0.5, 0.62], [0.56, 0.3, 0.7], 1], [[0.55, 0.84, 0.82], [0.93, 0.9, 0.86], 0], [[0.64, 0.4, 0.82], [0.95, 0.55, 0.75], 1]];
  const bellGeo = bellShape(lod), tentGeo = tentacleShape(lod), bellMat = bellMaterial(), tentMat = tentacleMaterial(), haloMat = haloMaterial();
  // (in three groups, the upper and lower drop-off and the way back up, so each is switched off when it is far)
  const nj = spots.length;
  for (const part of [spots.filter((j) => j[2] > -360 && j[1] > -128), spots.filter((j) => j[2] > -360 && j[1] <= -128), spots.filter((j) => j[2] <= -360)]) {
    const n = part.length;
    if (!n) continue;
    const ja = new Float32Array(n * 4), jb = new Float32Array(n * 4), jc = new Float32Array(n * 4), jd = new Float32Array(n * 4), boxes = [];
    part.forEach(([x, y, z, R0, Lt], i) => {
      const [c1, c2, glow] = rng.pick(BELLS);
      ja.set([x, y, z, R0], i * 4);
      jb.set([rng(), rng.range(0.32, 0.55), rng.range(0.35, 0.55), Lt], i * 4);
      jc.set([...c1.map(toLin), rng.range(0.85, 1.2)], i * 4);
      jd.set([...c2.map(toLin), glow], i * 4);
      boxes.push([x - 4, x + 4, y - jLow(R0, Lt) - 4, y + 4, z - 4, z + 4]);
    });
    const sph = sphereOf(boxes), attrs = { jA: new InstancedBufferAttribute(ja, 4), jB: new InstancedBufferAttribute(jb, 4), jC: new InstancedBufferAttribute(jc, 4), jD: new InstancedBufferAttribute(jd, 4) };
    add(solid(copies(bellGeo, n, attrs, sph), bellMat), 46);
    add(solid(copies(tentGeo, n, attrs, sph), tentMat), 46);
    add(solid(cards(n, attrs, sph), haloMat), 46);
  }

  // the siphonophore: a middle cord and its coil of loops, along a line set every frame
  {
    const sm = new Mesh(true);
    tubes(sm, 1, [70, 110, 150][lod], 6, () => 1);
    tubes(sm, 1, [700, 1100, 1500][lod], [4, 5, 5][lod], () => 0);
    const geo = sm.build(), c0 = inView((SIPHON[0] + SIPHON[1]) / 2, 9, 0, 0);
    geo.boundingSphere = new Sphere(new Vector3(...c0), 60);
    add(solid(geo, siphonoMaterial()), 56);
  }

  // the vents: clumps of tube worms at the chimneys' feet, on the side the camera passes; sea sheep on the rock
  const chim = chimneys(), worms = [], sheep = [];
  for (const c of chim) {
    pathAt(ventP(c.z), _o);
    const toward = Math.atan2(_o[2] - c.z, _o[0] - c.x);
    for (let clump = 0; clump < 2; clump++) {
      const a = toward + (clump ? 1.1 : -0.7) + rng.range(-0.3, 0.3), dist = c.radius * 1.25 + rng.range(0.5, 1.2);
      const cx = c.x + Math.cos(a) * dist, cz = c.z + Math.sin(a) * dist;
      if (offTrack(cx, cz) < 2.2) continue;
      for (let i = 0, nw = Math.max(3, Math.round(rng.range(5, 8) * Math.sqrt(amt))); i < nw; i++) {
        const x = cx + rng.bell() * 0.45, z = cz + rng.bell() * 0.45;
        worms.push([x, groundY(x, z) - 0.06, z, rng.range(0.45, 1.0), rng.bell() * 0.12, rng.bell() * 0.12, rng(), rng() < 0.72 ? 1 : 0]);
      }
    }
  }
  // and where the camera passes, big clumps close by, low in the right of the view, and sea sheep by two of them
  for (const f of ventForeground(rng, chim)) {
    for (let i = 0, nw = Math.max(6, Math.round(rng.range(10, 13) * Math.sqrt(amt))); i < nw; i++) {
      const r = Math.sqrt(rng()) * 0.75, a = rng() * TAU, x = f.x + Math.cos(a) * r, z = f.z + Math.sin(a) * r * 0.8;
      worms.push([x, groundY(x, z) - 0.08, z, rng.range(1.5, 2.5) * (1 - 0.35 * r), (x - f.x) * 0.1 + rng.bell() * 0.05, (z - f.z) * 0.1 + rng.bell() * 0.05, rng(), rng() < 0.7 ? 1 : 0]);
    }
    if (f.sheep) {
      // (beside the clump, toward the middle of the view and a little further away)
      const x = f.x - f.back[0] * 0.8 + Math.cos(f.toward + Math.PI / 2) * 1.5, z = f.z - f.back[1] * 0.8 + Math.sin(f.toward + Math.PI / 2) * 1.5;
      sheep.push([x, groundY(x, z) + 0.02, z, rng.range(2.8, 3.2), f.toward + rng.range(-0.4, 0.4), 0, rng(), 0]);
    }
  }
  for (const k of [0, 2, 5]) {
    const c = chim[k];
    pathAt(ventP(c.z), _o);
    const toward = Math.atan2(_o[2] - c.z, _o[0] - c.x) + (k % 2 ? 0.5 : -0.5), dist = c.radius * 1.3 + 0.7;
    const x = c.x + Math.cos(toward) * dist, z = c.z + Math.sin(toward) * dist;
    sheep.push([x, groundY(x, z) + 0.03, z, rng.range(1.5, 1.8), Math.atan2(_o[2] - z, _o[0] - x) + rng.range(-0.6, 0.6), 0, rng(), 0]);
  }
  const ventBox = sphereOf([...chim.map((c) => [c.x - 6, c.x + 6, c.g - 1, c.g + 4, c.z - 6, c.z + 6]), ...worms.map((w) => [w[0] - 1, w[0] + 1, w[1] - 1, w[1] + 2.5, w[2] - 1, w[2] + 1]), ...sheep.map((h) => [h[0] - 1, h[0] + 1, h[1] - 1, h[1] + 1, h[2] - 1, h[2] + 1])]);
  const wa = new Float32Array(worms.length * 4), wb = new Float32Array(worms.length * 4);
  worms.forEach((w, i) => { wa.set(w.slice(0, 4), i * 4); wb.set(w.slice(4, 8), i * 4); });
  add(solid(copies(wormShape(lod), worms.length, { wA: wa, wB: wb }, ventBox), wormMaterial()), 80);
  const ha = new Float32Array(sheep.length * 4), hb = new Float32Array(sheep.length * 4);
  sheep.forEach((h, i) => { ha.set(h.slice(0, 4), i * 4); hb.set([h[4], 0, h[6], 0], i * 4); });
  add(solid(copies(sheepShape(lod), sheep.length, { hA: ha, hB: hb }, ventBox), sheepMaterial()), 70);

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
  const hold = { c: [0, 0, 0], f: [0, 0, 0], d: [0, 0, 0], len: 0, k: 1 }, hold2 = { c: [0, 0, 0], f: [0, 0, 0] };
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
  // it, its front arms on the letter, a little away from under the lantern toward the stern
  // (Snap is on the bow's side); from p 4.655 it rises over the desk, goes out through the
  // hole in the hull on the stern side of the camera's way, and away up and toward the stern.
  let path = null;
  const LETTER = new Vector3(), OUT = new Vector3(), STERN = new Vector3(), OCT_SIZE = 1.12;
  if (wreck) {
    OUT.copy(wreck.cabinFacing).setY(0).normalize();
    STERN.set(-OUT.z, 0, OUT.x);                            // (the bow is (out.z, 0, -out.x))
    LETTER.copy(wreck.envelope);
    const seat = wreck.envelope.clone().addScaledVector(OUT, -0.76).addScaledVector(STERN, 0.32);
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

  return {
    update(t, dt, p) {
      const e = camera.matrixWorld.elements;
      U.right.value.set(e[0], e[1], e[2]);
      U.up.value.set(e[4], e[5], e[6]);
      U.pix.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(engine.height, 1);
      dust.visible = camera.position.y < -45;
      snow.visible = camera.position.y < 0.5 && camera.position.y > -95;
      // gulls only while the eye is out of the water
      if (camera.position.y < -0.6) for (let i = 0; i < gulls.length; i++) gulls[i].visible = false;
      const tanV = Math.tan((camera.fov * Math.PI) / 360), aspect = camera.aspect;
      // the turtle over the reef
      reefTurtleAt(p, tanV, aspect, hold);
      keyed(0, hold, t, 1.7, 0.3, 0, 0.1, 0.25, -0.45);
      // the anglerfish
      anglerAt(p, tanV, aspect, hold);
      keyed(4, hold, t, 1.4, 0.5, 0, 0.08, 0.2, 0);
      // the siphonophore
      siphonAt(p, tanV, aspect, hold);
      SI.c.value.set(hold.c[0], hold.c[1], hold.c[2]); SI.d.value.set(hold.d[0], hold.d[1], hold.d[2]); SI.n.value.set(hold.f[0], hold.f[1], hold.f[2]); SI.len.value = hold.len; SI.k.value = hold.k;
      // the end: the turtle, and the octopus swimming, leaning into it
      endingAt(p, tanV, aspect, hold, hold2);
      keyed(1, hold, t, 1.0, 0.7, 1, 0.08, 0.3, 0);
      keyed(3, hold2, t, 0.85, 0.6, 0, 0.1, 0.25, 0);
      // (the octopus leans forward as it swims: its head ahead, its arms trailing)
      {
        const a = POSE.array, f = a[3 * 4 + 1], u = a[3 * 4 + 2];
        F.set(f.x, f.y, f.z); Upv.set(u.x, u.y, u.z);
        W.copy(Upv).multiplyScalar(Math.cos(0.5)).addScaledVector(F, Math.sin(0.5));
        F.multiplyScalar(Math.cos(0.5)).addScaledVector(Upv, -Math.sin(0.5));
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
  FISH, COL, KINDS, fishShape, fishMaterial, fishMesh, eyeOf, turtleShape, turtleMaterial, octopusShape, octopusMaterial, anglerShape, anglerMaterial, lureGlowMaterial,
  gullShape, gullMaterial, copies, cards, solid, POSE, SI, toLin, jellySpots, castTrack, populate, camAt, subAt, snapAt, siphonAt, anglerAt, reefTurtleAt, endingAt, SCREENS, rectOf,
};
