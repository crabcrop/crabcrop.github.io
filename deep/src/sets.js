// The set pieces: everything man-made or singular that the story needs, made in code, in the
// dive's handmade look (wood, rope, crochet, fabric, glass and brass: chunky and rounded).
//
//   the marina      twice: where the dive starts (z0) and where it comes up again (z7). Seen from
//                   the waterline: two wooden piers with posts and rope, string lights, crochet
//                   fenders, the buoy on its coil of rope, a dinghy between them, sailboats with
//                   planked and painted hulls, a striped lighthouse. Under water the posts are
//                   weathered grey wood. At the start, one of the sailboats rides to an anchor: its
//                   chain hangs down to an anchor stood in the sand, and Snap rides down that
//                   chain. At the end the piers stand on a shallow shelf of rippled sand, with
//                   stones and weed, that cannot be seen from the deep below it.
//   the clam        the Clam Studio at the reef's far end: a huge pearly scallop open like a room,
//                   three crochet jellyfish lamps lighting it (glow slots 1 to 3, lent by the vents
//                   while the camera is on the reef), a pearl
//   the wreck       an old wooden sailing ship lying on the ledge, planked, broken, rigged and
//                   weedy, its round carved stern, white crochet barnacles, ribs inside its
//                   breach; and its captain's cabin: plank walls, brass portholes, broken planks
//                   open onto the water, a desk with an envelope, and a lantern (glow slot 0)
//   the vents       the chimneys' glowing cracks, lava at their feet, their smoke (glow slots 1, 2)
//   the geode       a beige stone split in two, both halves fallen open on the black sand, white
//                   quartz glowing warm inside (glow slot 3): the print lies in the right half; a
//                   small brass diving helmet on the sand to its left
//
// buildSets(ctx) returns { update(t, dt, p), chainAt(s, out), clam, geode, wreck }:
//   chainAt(s, out)  s is 0 at the boat's bow roller and 1 at the anchor's ring; writes the point
//                    on the chain (out[0..2]) and its unit direction toward the anchor (out[3..5]),
//                    as the chain hangs at this frame (after update(t)).
//   clam             { position, normal }: where an object sits in the open clam, and the way the
//                    clam opens (unit vector out of its mouth).
//   wreck            { lantern, envelope, cabin, cabinFacing, desk, loose }: where the lantern
//                    hangs, the desk's top, the cabin's middle, the way out through the hole in its
//                    side, and the desk's frame ({ at: the foot of its middle, x, y, z: unit axes:
//                    across toward the port wall, up the deck, toward the bow }). loose: the
//                    cabin's loose things (the lantern, the chest, the desk's stamp, the wax on the
//                    letter) are not built here: zones/s4.js makes them (props/cabin.js), movable.
//   geode            { position, normal, size }: the spot on the bed in the geode's hollow where
//                    the picture lies, the way it faces (out of the hollow, up and toward the
//                    camera at p = 7), and the widest picture (metres) that fits there, square or
//                    wide.
import { BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh as ThreeMesh, Sphere, Vector3 } from 'three/webgpu';
import {
  abs, attribute, cameraPosition, clamp, cos, cross, dFdx, dFdy, dot, exp, float, floor, fract, fwidth, int, ivec3, length, max, min, mix, normalize, pow,
  reflect, select, sign, sin, smoothstep, step, texture, uniform, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';
import { ANCHOR, BUOY, MOORING, anchorRing, centerX, floorY, groundY } from './layout.js';
import { Mesh, TAU, blob, clamp as clampN, lerp, makeRng, noise3 } from './math.js';
import { G, SIG, detail, hash1, hash3, inWater, material, sunAt, yarn } from './shaders.js';
import { rockSurf, rockyAt } from './terrain.js';

// ---- building blocks ----------------------------------------------------------------------

const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
// Colours are written here as they look in a picture (sRGB) and used linear, as the shaders
// light them: raised to 2.2. (tint.w and tint2.w are flags and stay as they are.)
const toLinear = (c) => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2), c.length === 4 ? c[3] : 0];
const srgb = (r, g, b) => vec3(Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2));
let LO = false;              // the low detail level: fewer sides and segments everywhere
const toAttr = (a, n = 4) => new BufferAttribute(new Float32Array(a), n);
// A mesh under construction whose vertices also carry two colours (tint, tint2), set with
// paint() before each piece is added.
class TMesh extends Mesh {
  constructor() { super(true); this.t = []; this.t2 = []; this.c1 = [1, 1, 1, 0]; this.c2 = [1, 1, 1, 0]; }
  vert(px, py, pz, nx, ny, nz, u, v, a0, a1, a2, a3) {
    const c = this.c1, d = this.c2;
    this.t.push(c[0], c[1], c[2], c[3]); this.t2.push(d[0], d[1], d[2], d[3]);
    return super.vert(px, py, pz, nx, ny, nz, u, v, a0, a1, a2, a3);
  }
  paint(c1, c2 = c1) { this.c1 = toLinear(c1); this.c2 = toLinear(c2); return this; }
  build() { const g = super.build(); g.setAttribute('tint', toAttr(this.t)); g.setAttribute('tint2', toAttr(this.t2)); return g; }
}

const sphereOf = (geo, pad = 0) => { geo.computeBoundingSphere(); geo.boundingSphere.radius += pad; return geo; };
const STATS = { meshes: 0, tris: 0 };
function addMesh(ctx, geo, mat, range, opts = {}) {
  STATS.meshes++;
  STATS.tris += ((geo.index ? geo.index.count : geo.attributes.position.count) / 3) * (geo.isInstancedBufferGeometry ? geo.instanceCount : 1);
  const mesh = new ThreeMesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  if (opts.order !== undefined) mesh.renderOrder = opts.order;
  if (opts.noShadow) mesh.userData.castShadow = false;
  ctx.add(mesh, range);
  return mesh;
}

// A ball (latitude and longitude, quick to build): radius f(dx, dy, dz) in each direction,
// aux from tag(dx, dy, dz, out) if given. For the many small round things.
function ball(m, cx, cy, cz, f, res = 4, tag = null) {
  if (LO) res = Math.max(2, Math.round(res * 0.6));
  const rows = Math.max(res, 2) + 1, cols = Math.max(res, 2) * 2, base = m.count, i0 = m.i.length, o = [0, 0, 0, 0];
  for (let i = 0; i <= rows; i++) {
    const th = (i / rows) * Math.PI, st = Math.sin(th), ct = Math.cos(th);
    for (let j = 0; j <= cols; j++) {
      const ph = (j / cols) * TAU, dx = st * Math.cos(ph), dy = -ct, dz = st * Math.sin(ph);
      const r = f(dx, dy, dz);
      o[0] = o[1] = o[2] = o[3] = 0;
      if (tag) tag(dx, dy, dz, o);
      m.vert(cx + dx * r, cy + dy * r, cz + dz * r, dx, dy, dz, j / cols, i / rows, o[0], o[1], o[2], o[3]);
    }
  }
  const w = cols + 1;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const a = base + i * w + j; m.i.push(a, a + 1, a + w, a + 1, a + w + 1, a + w); }
  m.normals(base, m.count, i0, { cols, rows, base });
  return base;
}

// A triangle wound so that it faces n.
function triFacing(m, a, b, c, nx, ny, nz) {
  const p = m.p;
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
  const d = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
  if (d >= 0) m.i.push(a, b, c); else m.i.push(a, c, b);
}

// A tube along points [[x, y, z, r], ...] with a frame carried along it; radius(k, j, ang)
// scales the radius, aux(k, j, x, y, z, out) fills the vertex's aux. Smooth normals; `caps`
// rounds off both ends.
function sweep(m, pts, sides, { radius = null, aux = null, up = [1, 0, 0], closed = false, caps = false } = {}) {
  const n = pts.length, base = m.count, i0 = m.i.length, o = [0, 0, 0, 0];
  let ux = up[0], uy = up[1], uz = up[2];
  for (let k = 0; k < n; k++) {
    const a = pts[closed ? (k - 1 + n) % n : Math.max(k - 1, 0)], b = pts[closed ? (k + 1) % n : Math.min(k + 1, n - 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    let sx = ty * uz - tz * uy, sy = tz * ux - tx * uz, sz = tx * uy - ty * ux;
    let sl = Math.hypot(sx, sy, sz);
    if (sl < 1e-4) { const alt = Math.abs(tx) < 0.9 ? [1, 0, 0] : [0, 1, 0]; sx = ty * alt[2] - tz * alt[1]; sy = tz * alt[0] - tx * alt[2]; sz = tx * alt[1] - ty * alt[0]; sl = Math.hypot(sx, sy, sz); }
    sx /= sl; sy /= sl; sz /= sl;
    ux = sy * tz - sz * ty; uy = sz * tx - sx * tz; uz = sx * ty - sy * tx;
    for (let j = 0; j <= sides; j++) {
      const ang = (j / sides) * TAU, c = Math.cos(ang), s = Math.sin(ang);
      const r = pts[k][3] * (radius ? radius(k, j % sides, ang) : 1);
      const nx = sx * c + ux * s, ny = sy * c + uy * s, nz = sz * c + uz * s;
      const x = pts[k][0] + nx * r, y = pts[k][1] + ny * r, z = pts[k][2] + nz * r;
      o[0] = j / sides; o[1] = 0; o[2] = 1; o[3] = 0;
      if (aux) aux(k, j, x, y, z, o);
      m.vert(x, y, z, nx, ny, nz, j / sides, k / Math.max(n - 1, 1), o[0], o[1], o[2], o[3]);
    }
  }
  const w = sides + 1, segs = closed ? n : n - 1;
  for (let k = 0; k < segs; k++) for (let j = 0; j < sides; j++) {
    const a = base + k * w + j, b = base + ((k + 1) % n) * w + j;
    m.i.push(a, b, a + 1, a + 1, b, b + 1);
  }
  m.normals(base, m.count, i0, null);
  for (let k = 0; k < n; k++) {
    const a = (base + k * w) * 3, b = (base + k * w + sides) * 3;
    for (let e = 0; e < 3; e++) { const s = m.n[a + e] + m.n[b + e]; m.n[a + e] = s; m.n[b + e] = s; }
    const l = Math.hypot(m.n[a], m.n[a + 1], m.n[a + 2]) || 1;
    for (let e = 0; e < 3; e++) { m.n[a + e] /= l; m.n[b + e] = m.n[a + e]; }
  }
  if (caps && !closed) for (const k of [0, n - 1]) {
    const a = pts[k], b = pts[k === 0 ? 1 : n - 2];
    let tx = a[0] - b[0], ty = a[1] - b[1], tz = a[2] - b[2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const c = m.vert(a[0] + tx * a[3] * 0.5, a[1] + ty * a[3] * 0.5, a[2] + tz * a[3] * 0.5, tx, ty, tz, 0.5, k ? 1 : 0, o[0], o[1], o[2], o[3]);
    const ring = base + k * w;
    for (let j = 0; j < sides; j++) triFacing(m, ring + j, ring + j + 1, c, tx, ty, tz);
  }
  return base;
}

// A box with rounded edges: centre c, unit axes X, Y, Z, half sizes h, edge radius r, `seg`
// cells along each axis's flat part. aux(lx, ly, lz, out) fills each vertex's aux from its
// local position. Timbers, planks, crates, the desk.
function rbox(m, c, X, Y, Z, h, r, seg = [1, 1, 1], aux = null) {
  const rr = Math.min(r, Math.min(h[0], h[1], h[2]) * 0.98);
  const coords = (hh, n) => {
    const out = [-hh, -hh + rr * 0.3, -hh + rr];
    for (let i = 1; i < n; i++) out.push(-hh + rr + (2 * (hh - rr) * i) / n);
    out.push(hh - rr, hh - rr * 0.3, hh);
    return out;
  };
  const L = [coords(h[0], seg[0]), coords(h[1], seg[1]), coords(h[2], seg[2])];
  const o = [0, 0, 0, 0], q = [0, 0, 0], inner = [0, 0, 0], A = [X, Y, Z];
  for (let axis = 0; axis < 3; axis++) for (const sgn of [-1, 1]) {
    const b = (axis + 1) % 3, cc = (axis + 2) % 3, Lb = L[b], Lc = L[cc], v0 = m.count;
    for (let i = 0; i < Lb.length; i++) for (let j = 0; j < Lc.length; j++) {
      q[axis] = sgn * h[axis]; q[b] = Lb[i]; q[cc] = Lc[j];
      for (let e = 0; e < 3; e++) inner[e] = clampN(q[e], -(h[e] - rr), h[e] - rr);
      const dx = q[0] - inner[0], dy = q[1] - inner[1], dz = q[2] - inner[2], dl = Math.hypot(dx, dy, dz) || 1;
      const nx = dx / dl, ny = dy / dl, nz = dz / dl;
      const lx = inner[0] + nx * rr, ly = inner[1] + ny * rr, lz = inner[2] + nz * rr;
      o[0] = lx; o[1] = ly; o[2] = 1; o[3] = 0;
      if (aux) aux(lx, ly, lz, o);
      m.vert(c[0] + X[0] * lx + Y[0] * ly + Z[0] * lz, c[1] + X[1] * lx + Y[1] * ly + Z[1] * lz, c[2] + X[2] * lx + Y[2] * ly + Z[2] * lz,
        X[0] * nx + Y[0] * ny + Z[0] * nz, X[1] * nx + Y[1] * ny + Z[1] * nz, X[2] * nx + Y[2] * ny + Z[2] * nz, 0, 0, o[0], o[1], o[2], o[3]);
    }
    const F = A[axis], wc = Lc.length;
    for (let i = 0; i < Lb.length - 1; i++) for (let j = 0; j < wc - 1; j++) {
      const a = v0 + i * wc + j;
      triFacing(m, a, a + wc, a + 1, F[0] * sgn, F[1] * sgn, F[2] * sgn); triFacing(m, a + 1, a + wc, a + wc + 1, F[0] * sgn, F[1] * sgn, F[2] * sgn);
    }
  }
}
// A timber between two points: section w by h (h along `up`), rounded edges.
function timber(m, a, b, w, h, upv, r = 0.03, aux = null, segLen = 1.2) {
  const ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2], len = Math.hypot(ax, ay, az);
  const Z = [ax / len, ay / len, az / len];
  let X = [upv[1] * Z[2] - upv[2] * Z[1], upv[2] * Z[0] - upv[0] * Z[2], upv[0] * Z[1] - upv[1] * Z[0]];
  const xl = Math.hypot(X[0], X[1], X[2]); X = X.map((v) => v / xl);
  const Y = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
  rbox(m, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], X, Y, Z, [w / 2, h / 2, len / 2], r, [1, 1, Math.max(1, Math.round(len / segLen))],
    aux || ((lx, ly, lz, o) => { o[0] = lx + ly * 1.31; o[1] = lz; }));
}
// Along a polyline of points: the running length at each, for rope and grain.
const runLength = (pts) => { const acc = [0]; for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2])); return acc; };
// A rope through points (aux: around, along).
function rope(m, pts, sides = 6) {
  if (LO) sides = Math.max(4, sides - 2);
  const acc = runLength(pts);
  return sweep(m, pts, sides, { caps: true, aux: (k, j, x, y, z, o) => { o[0] = j / sides; o[1] = acc[k]; } });
}
// Coils of rope: `turns` loops stacked upward from c, radius R, rope radius rr.
function coil(m, c, R, rr, turns, rise = 0.85) {
  const pts = [], N = Math.round(turns * (LO ? 14 : 24));
  for (let i = 0; i <= N; i++) {
    const t = i / N, ang = t * turns * TAU, rad = R * (1 - 0.05 * Math.sin(t * turns * 2.1)) - (t > 0.8 ? (t - 0.8) * R * 0.4 : 0);
    pts.push([c[0] + Math.cos(ang) * rad, c[1] + rr + t * turns * rr * 2 * rise, c[2] + Math.sin(ang) * rad, rr]);
  }
  return rope(m, pts, 7);
}
// A rope hanging between two points, sagging.
function hangRope(m, a, b, rr, sag, n = 16) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t) - sag * 4 * t * (1 - t), lerp(a[2], b[2], t), rr]); }
  return rope(m, pts, 6);
}
// Turns of rope lashed round an upright post of half width hw, centred at height y.
function lashing(m, c, hw, y, turns = 3, rr = 0.032) {
  const pts = [], N = turns * (LO ? 9 : 14);
  for (let i = 0; i <= N; i++) {
    const t = i / N, ang = t * turns * TAU, ca = Math.cos(ang), sa = Math.sin(ang);
    const k = 1 / Math.pow(Math.pow(Math.abs(ca), 4) + Math.pow(Math.abs(sa), 4), 0.25);        // round a squarish post
    pts.push([c[0] + ca * k * (hw + rr * 0.8), y + (t - 0.5) * turns * rr * 2.05, c[1] + sa * k * (hw + rr * 0.8), rr]);
  }
  return rope(m, pts, 5);
}
// A flat round lid at height y facing `up` (+1 or -1).
function disc(m, x, y, z, r, n, up, aux = [0, 0, 1, 0]) {
  const c = m.vert(x, y, z, 0, up, 0, 0.5, 0.5, ...aux), v0 = m.count;
  for (let i = 0; i <= n; i++) { const a = (i / n) * TAU; m.vert(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 0, up, 0, 0, 0, ...aux); }
  for (let i = 0; i < n; i++) triFacing(m, c, v0 + i, v0 + i + 1, 0, up, 0);
}

// ---- surfaces -------------------------------------------------------------------------------

const vT = varyingProperty('vec4', 'v_set_t'), vT2 = varyingProperty('vec4', 'v_set_t2');
const tintIn = () => { vT.assign(attribute('tint', 'vec4')); vT2.assign(attribute('tint2', 'vec4')); };

// A surface bent by a height field h (metres, worked out per pixel): the way three.js bumps
// a surface without a tangent frame (Mikkelsen's), from how h and the position change from
// pixel to pixel.
function bump(n, w, h) {
  const dpdx = dFdx(w), dpdy = dFdy(w), dhdx = dFdx(h), dhdy = dFdy(h);
  const r1 = cross(dpdy, n), r2 = cross(n, dpdx);
  const det = dot(dpdx, r1);
  return normalize(abs(det).mul(n).sub(sign(det).mul(r1.mul(dhdx).add(r2.mul(dhdy)))).add(n.mul(1e-7)));
}
// Wood: warm, the grain in fine streaks along the timber, paint worn off in patches where
// tint2.w says it was painted (tint2.rgb). aux: x across the grain, y along it (metres), z
// baked shade (1 open), w the kind: 2 planked (a plank every 0.235 m of x, each cut every
// few metres, the cuts staggered; seams sunk a little and dark).
function woodSurf(s, f, base, paint = float(0.0), fluor = 0.3) {
  const near = float(1).sub(smoothstep(4.0, 22.0, f.dist)).toVar();
  const planked = step(1.5, f.aux.w).mul(float(1).sub(step(2.5, f.aux.w))).toVar();
  const pk = f.aux.x.div(0.235).toVar();
  const row = floor(pk).toVar();
  const ph = hash1(row.mul(0.173).add(0.31));
  const run = f.aux.y.add(ph.mul(4.9)).div(5.6).toVar();
  // each plank (and each length of it) its own tone
  base = base.mul(mix(float(1.0), hash1(row.mul(0.173).add(floor(run).mul(0.611)).add(0.47)).mul(0.22).add(0.88), planked));
  const g1 = texture(G.detailTex, vec2(f.aux.x.mul(1.6), f.aux.y.mul(0.11))).toVar();
  const g2 = texture(G.detailTex, vec2(f.aux.x.mul(4.3).add(0.37), f.aux.y.mul(0.35))).toVar();
  const streak = g1.b.mul(0.55).add(g2.b.mul(0.45)).toVar();
  // fine grain lines, wavering along the timber
  const lines = sin(f.aux.x.mul(41.0).add(g1.r.mul(9.0)).add(g2.g.mul(4.0))).mul(0.5).add(0.5);
  const fine = smoothstep(0.55, 0.95, lines).mul(near).toVar();
  const wood = base.mul(streak.sub(0.45).mul(0.6).add(0.86)).mul(g1.a.mul(0.16).add(0.92)).mul(float(1).sub(fine.mul(0.16))).toVar();
  const keep = smoothstep(0.33, 0.57, g2.b.mul(0.7).add(g1.a.mul(0.5)).sub(0.1)).mul(paint);
  // the seams, never thinner than a pixel can hold (else they would crawl)
  const fw = fwidth(pk).toVar();
  const sw = max(float(0.045), fw.mul(0.9));
  const sd = float(0.5).sub(abs(fract(pk).sub(0.5)));
  const bd = float(0.5).sub(abs(fract(run).sub(0.5))).mul(5.6 / 0.235);
  const gone = float(1).sub(smoothstep(0.25, 0.6, fw)).mul(planked).toVar();
  const seam = max(float(1).sub(smoothstep(0.0, sw, sd)), float(1).sub(smoothstep(0.0, sw, bd)).mul(0.55)).mul(gone).toVar();
  s.albedo = mix(wood, vT2.rgb.mul(g1.a.mul(0.1).add(0.95)), keep).mul(float(1).sub(seam.mul(0.62)));
  // relief: the grain and the plank edges (each plank a little proud or sunk), seams sunk
  const h = streak.mul(0.0016).add(fine.mul(0.0006)).add(ph.sub(0.5).mul(0.003).mul(planked)).sub(seam.mul(0.004));
  s.n = bump(s.n, f.w, h.mul(near)).toVar();
  s.ao = f.aux.z.mul(streak.mul(0.25).add(0.82)).mul(float(1).sub(seam.mul(0.3))).min(1.0);
  s.spec = float(0.06).add(keep.mul(0.08)).mul(near.mul(0.6).add(0.4)); s.gloss = float(18.0);
  s.fluor = float(fluor);
}
// Felt: soft and matte, a little fuzz at grazing angles, light shows through it.
function feltSurf(s, f, col) {
  const D = detail(f.w, s.n, 2.6, 0.35);
  s.albedo = col.mul(D.m.mul(0.22).add(0.86)).mul(D.h.mul(0.12).add(0.94));
  s.n = D.n;
  s.trans = float(0.55); s.fluor = float(0.5); s.spec = float(0.01); s.gloss = float(6.0);
  const vv = normalize(cameraPosition.sub(f.w));
  const graze = pow(float(1.0).sub(abs(dot(s.n, vv))), 2.5);
  s.emis = sunAt(f.w.y).mul(0.05).add(G.amb.mul(0.16)).mul(graze).mul(s.albedo);
}
// Fine sand: pale, a faint grain and ripples.
function sandSurf(s, f, col) {
  const D = detail(f.w, s.n, 3.2, 0.6), E = detail(f.w, s.n, 0.9, 0.8);
  s.albedo = col.mul(D.h.mul(0.16).add(0.9)).mul(E.m.mul(0.12).add(0.94));
  s.n = normalize(mix(D.n, E.n, 0.5));
  s.spec = float(0.03); s.gloss = float(12.0); s.fluor = float(0.15);
}
// Rope: three strands twisted, hemp-coloured. aux: x around (0..1), y along (metres).
function ropeSurf(s, f, col) {
  const ph = f.aux.x.mul(3.0).sub(f.aux.y.mul(9.0)).toVar();
  const near = float(1).sub(smoothstep(4.0, 16.0, f.dist));
  const k = mix(float(0.5), cos(ph.mul(TAU)).mul(0.5).add(0.5), near).toVar();
  const fib = texture(G.detailTex, vec2(f.aux.x.mul(2.0), f.aux.y.mul(1.7))).b;
  s.albedo = col.mul(k.mul(0.42).add(0.66)).mul(fib.mul(0.2).add(0.9));
  s.ao = k.mul(0.35).add(0.65);
  s.spec = float(0.03); s.gloss = float(10.0); s.fluor = float(0.35); s.trans = float(0.1);
  const vv = normalize(cameraPosition.sub(f.w));
  s.emis = sunAt(f.w.y).mul(0.05).add(G.amb.mul(0.1)).mul(pow(float(1.0).sub(abs(dot(s.n, vv))), 3.0)).mul(s.albedo);
}
// Brass: warm metal, a little tarnish in the hollows.
function brassSurf(s, f, tarnish = 0.25) {
  const D = detail(f.w, s.n, 3.0, 0.8);
  const t = smoothstep(0.35, 0.75, D.m.add(float(tarnish).sub(0.25))).toVar();
  s.albedo = mix(srgb(0.80, 0.60, 0.30), srgb(0.42, 0.48, 0.36), t.mul(0.55));
  s.n = D.n;
  s.spec = mix(float(1.1), float(0.25), t); s.gloss = mix(float(55.0), float(14.0), t); s.fluor = float(0.25);
  // metal mirrors its surroundings: a little of the water's light from the side it faces
  s.emis = G.amb.mul(0.12).mul(s.albedo).mul(max(s.n.y, 0.0).mul(0.6).add(0.4));
}
// Canvas: a cream sail, fine weave and seams; light shows through it. aux.xy: across, up (m).
function canvasSurf(s, f, col) {
  const near = float(1).sub(smoothstep(4.0, 20.0, f.dist));
  const wv = texture(G.detailTex, f.aux.xy.mul(9.0)).toVar();
  const seam = float(1).sub(smoothstep(0.0, 0.04, float(0.46).sub(abs(fract(f.aux.y.mul(1.6)).sub(0.5))))).mul(near);
  s.albedo = col.mul(wv.b.mul(0.12).mul(near).add(0.94)).mul(float(1).sub(seam.mul(0.12)));
  s.trans = float(0.75); s.spec = float(0.02); s.gloss = float(8.0); s.fluor = float(0.35);
  s.ao = float(1).sub(seam.mul(0.1));
}
// Knitted things in two colours (tint, tint2), stitches on the shape itself.
const yarnMat = (opts = {}) => material({
  aux: true, fade: opts.fade,
  vertex: (v) => { tintIn(); if (opts.vertex) opts.vertex(v); },
  surface: (s, f) => { yarn(s, f, { color: vT.rgb, color2: vT2.rgb, stripe: opts.stripe ?? 3, scale: opts.scale ?? 18, k: 1.2 }); if (opts.surface) opts.surface(s, f); },
});

// ---- boats --------------------------------------------------------------------------------

const WOOD = {
  post: [0.42, 0.36, 0.28], deck: [0.50, 0.40, 0.28], beam: [0.38, 0.29, 0.20], hull: [0.55, 0.42, 0.28], dark: [0.30, 0.22, 0.15],
  crate: [0.58, 0.45, 0.30], mast: [0.62, 0.48, 0.30],
};
const ROPE = [0.78, 0.68, 0.50];

// One wooden boat: clinker planks from keel to sheer, a transom, stem, keel strip and gunwales,
// a deck lid, a mast and boom, the mainsail (and a jib if asked), forestay and shrouds. Built in
// its own frame (z forward, y up) and turned to `heading` (radians, 0 = +z) at (x, z). Wood goes
// to `w`, canvas to `c`, rope to `r`. Returns where its parts are, and the vertex ranges of each.
function boat(w, c, r, o) {
  const L = o.len, B = o.beam, depth = o.depth ?? 0.36, sheer = o.sheer ?? 0.58;
  const ch = Math.cos(o.heading), sh = Math.sin(o.heading);
  const at = (x, y, z) => [o.x + x * ch + z * sh, y, o.z - x * sh + z * ch];
  const dir = (x, y, z) => [x * ch + z * sh, y, -x * sh + z * ch];
  const bTab = [[0, 0.80], [0.18, 0.95], [0.45, 1.0], [0.7, 0.88], [0.86, 0.6], [0.95, 0.3], [1, 0.0]];
  const dTab = [[0, -0.12], [0.18, -0.85], [0.45, -1.0], [0.7, -0.9], [0.86, -0.55], [0.95, -0.1], [1, 0.2]];
  const tab = (T, t) => { for (let i = 1; i < T.length; i++) if (t <= T[i][0]) { const a = T[i - 1], b = T[i], u = (t - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * u * u * (3 - 2 * u); } return T[T.length - 1][1]; };
  const sheerAt = (t) => sheer + 0.26 * Math.pow(t, 2.2) + 0.05 * (1 - t);
  const keelAt = (t) => depth * tab(dTab, t);
  const strakes = o.strakes ?? 6, lod = o.lod || LO ? 1 : 0;
  const v0w = w.count;
  // the hull's two sides, the strakes' laps as steps
  for (const side of [-1, 1]) {
    const cols = lod ? 18 : 30, rows = strakes * (lod ? 2 : 4), base = w.count;
    for (let rr = 0; rr <= rows; rr++) for (let cc = 0; cc <= cols; cc++) {
      const t = cc / cols, v = rr / rows;
      const hb = (B / 2) * tab(bTab, t), kd = keelAt(t), ys = sheerAt(t);
      const th = v * Math.PI / 2, e1 = 0.72 + 0.45 * t * t;
      const strake = Math.min(Math.floor(v * strakes), strakes - 1), fr = v * strakes - strake;
      const lap = (1 - fr) * 0.022 * (1 - lod);
      const x = side * (hb * Math.pow(Math.sin(th), e1) + lap * Math.sin(th));
      const y = kd + (ys - kd) * (1 - Math.pow(Math.cos(th), 1.3)) - lap * Math.cos(th) * 0.6;
      const z = (t - 0.5) * L, P = at(x, y, z);
      // paint: the top strake in one colour, a band at the water in another, wood between
      const top = strake === strakes - 1, low = strake === 1 || strake === 2;
      w.paint(WOOD.hull, o.paint && top ? [...o.paint[0], 1] : o.paint && low ? [...o.paint[1], 1] : WOOD.hull);
      // aux: x the plank (one per strake, a seam between each), y along the hull
      w.vert(P[0], P[1], P[2], 0, 1, 0, t, v, v * strakes * 0.235, z, 1, 2);
    }
    const W = cols + 1, i0 = w.i.length;
    for (let rr = 0; rr < rows; rr++) for (let cc = 0; cc < cols; cc++) {
      const a = base + rr * W + cc;
      if (side < 0) w.i.push(a, a + 1, a + W, a + 1, a + W + 1, a + W); else w.i.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
    }
    w.normals(base, w.count, i0, null);
  }
  // a deck lid at the sheer, so nothing shows through from above
  {
    w.paint(WOOD.deck);
    const base = w.count, cols = 16;
    for (let cc = 0; cc <= cols; cc++) {
      const t = cc / cols, hb = (B / 2) * tab(bTab, t) * 0.97, ys = sheerAt(t) - 0.05, z = (t - 0.5) * L;
      for (const side of [-1, 1]) { const P = at(side * hb, ys, z); w.vert(P[0], P[1], P[2], 0, 1, 0, 0, 0, side * hb, z, 0.9, 0); }
    }
    for (let cc = 0; cc < cols; cc++) { const a = base + cc * 2; triFacing(w, a, a + 1, a + 2, 0, 1, 0); triFacing(w, a + 1, a + 3, a + 2, 0, 1, 0); }
  }
  // the transom
  {
    const hb = (B / 2) * tab(bTab, 0), kd = keelAt(0), ys = sheerAt(0), z = -L / 2, F = dir(0, 0, -1);
    w.paint(WOOD.hull, o.paint ? [...o.paint[0], 1] : WOOD.hull);
    const ctr = at(0, (kd + ys) / 2, z), base = w.count;
    w.vert(ctr[0], ctr[1], ctr[2], F[0], 0, F[2], 0, 0, 0, (kd + ys) / 2, 1, 0);
    for (let k = 0; k <= 16; k++) {
      const a = (k / 16) * Math.PI, v = Math.abs(Math.cos(a)), side = k < 8 ? -1 : 1, th = (1 - v) * Math.PI / 2;
      const x = side * hb * Math.pow(Math.sin(th), 0.72), y = k === 8 ? ys : kd + (ys - kd) * (1 - Math.pow(Math.cos(th), 1.3));
      const P = at(x, y, z);
      w.vert(P[0], P[1], P[2], F[0], 0, F[2], 0, 0, x, y, 1, 0);
    }
    for (let k = 0; k < 16; k++) triFacing(w, base, base + 1 + k, base + 2 + k, F[0], 0, F[2]);
  }
  // stem, keel strip and gunwales
  w.paint(WOOD.dark);
  const stem = [], keel = [];
  for (let i = 0; i <= 8; i++) { const t = 0.86 + 0.14 * (i / 8); const P = at(0, lerp(keelAt(t), sheerAt(1) + 0.05, Math.pow(i / 8, 1.4)), (t - 0.5) * L + 0.02); stem.push([P[0], P[1], P[2], 0.055]); }
  sweep(w, stem, 8, { caps: true, aux: (k, j, x, y, z, a) => { a[0] = (j / 8) * 0.3; a[1] = y; } });
  for (let i = 0; i <= 10; i++) { const t = 0.02 + 0.84 * (i / 10); const P = at(0, keelAt(t) - 0.02, (t - 0.5) * L); keel.push([P[0], P[1], P[2], 0.05]); }
  sweep(w, keel, 6, { caps: true, aux: (k, j, x, y, z, a) => { a[0] = (j / 6) * 0.3; a[1] = k * 0.3; a[2] = 0.8; } });
  w.paint(o.paint ? o.paint[0] : WOOD.dark);
  for (const side of [-1, 1]) {
    const g = [];
    for (let i = 0; i <= 14; i++) { const t = (i / 14) * 0.985; const P = at(side * (B / 2) * tab(bTab, t), sheerAt(t) + 0.02, (t - 0.5) * L); g.push([P[0], P[1], P[2], 0.045]); }
    sweep(w, g, 6, { caps: true, aux: (k, j, x, y, z, a) => { a[0] = (j / 6) * 0.3; a[1] = k * 0.3; } });
  }
  // mast and boom
  const mz = (0.5 - (o.mast ?? 0.32)) * L, mh = o.mastH ?? 5.0;
  w.paint(WOOD.mast);
  const m0 = at(0, keelAt(0.6) + 0.2, mz), m1 = at(0, sheerAt(0.6) + mh, mz);
  sweep(w, [[m0[0], m0[1], m0[2], 0.07], [m1[0], (m0[1] + m1[1]) / 2, m1[2], 0.062], [m1[0], m1[1], m1[2], 0.05]], 8, { caps: true, aux: (k, j, x, y, z, a) => { a[0] = (j / 8) * 0.4; a[1] = y; } });
  const boomY = sheerAt(0.6) + 0.55, boomEnd = -L / 2 + 0.25;
  const b0 = at(0, boomY, mz - 0.08), b1 = at(0, boomY + 0.08, boomEnd);
  sweep(w, [[b0[0], b0[1], b0[2], 0.045], [b1[0], b1[1], b1[2], 0.04]], 7, { caps: true, aux: (k, j, x, y, z, a) => { a[0] = (j / 7) * 0.3; a[1] = k * (mz - boomEnd); } });
  const nw = w.count - v0w;
  // the sails: a triangle tack - head - clew, as a grid, with a little belly
  const v0c = c.count;
  const sail = (A, Bp, Cp, belly) => {
    const base = c.count, n = lod ? 6 : 10;
    const nx = (Bp[1] - A[1]) * (Cp[2] - A[2]) - (Bp[2] - A[2]) * (Cp[1] - A[1]), ny = (Bp[2] - A[2]) * (Cp[0] - A[0]) - (Bp[0] - A[0]) * (Cp[2] - A[2]), nz = (Bp[0] - A[0]) * (Cp[1] - A[1]) - (Bp[1] - A[1]) * (Cp[0] - A[0]);
    const nl = Math.hypot(nx, ny, nz);
    const foot = Math.hypot(Cp[0] - A[0], Cp[1] - A[1], Cp[2] - A[2]), luff = Math.hypot(Bp[0] - A[0], Bp[1] - A[1], Bp[2] - A[2]);
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const u = i / n, v = j / n;
      const b = belly * Math.sin(Math.PI * Math.min(u / Math.max(1 - v, 1e-3), 1)) * (1 - v) * (1 - v * 0.3);
      c.vert(A[0] + (Cp[0] - A[0]) * u + (Bp[0] - A[0]) * v + (nx / nl) * b, A[1] + (Cp[1] - A[1]) * u + (Bp[1] - A[1]) * v + (ny / nl) * b, A[2] + (Cp[2] - A[2]) * u + (Bp[2] - A[2]) * v + (nz / nl) * b,
        nx / nl, ny / nl, nz / nl, u, v, u * foot, v * luff, 1, 0);
    }
    const idx = (i, j) => base + i * (n + 1) - (i * (i - 1)) / 2 + j, i0 = c.i.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
      c.i.push(idx(i, j), idx(i + 1, j), idx(i, j + 1));
      if (j < n - i - 1) c.i.push(idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1));
    }
    c.normals(base, c.count, i0, null);
  };
  const side = o.sailSide ?? 1;
  sail(at(0, boomY + 0.1, mz - 0.1), at(0, sheerAt(0.6) + mh - 0.15, mz - 0.08), at(side * 0.12, boomY + 0.16, boomEnd + 0.1), (o.belly ?? 0.25) * side);
  if (o.jib) sail(at(0, sheerAt(1) + 0.1, L / 2 - 0.05), at(0, sheerAt(0.6) + mh * 0.82, mz + 0.06), at(side * 0.35, sheerAt(0.7) + 0.35, mz - 0.35), 0.2 * side);
  const ncs = c.count - v0c;
  // rigging
  const v0r = r.count, top = at(0, sheerAt(0.6) + mh - 0.05, mz);
  r.paint(ROPE);
  hangRope(r, top, at(0, sheerAt(1) + 0.06, L / 2 - 0.02), 0.011, 0.02, 10);
  for (const sd of [-1, 1]) hangRope(r, top, at(sd * (B / 2) * 0.92, sheerAt(0.45) + 0.04, mz - 0.25), 0.011, 0.02, 10);
  const nr = r.count - v0r;
  return { at, sheerAt, keelAt, counts: [v0w, nw, v0c, ncs, v0r, nr] };
}

// Mark vertices of a boat so its materials can rock it about its own centre.
function markBob(m, from, count, cx, cz, seed) {
  if (!m.bob) m.bob = [];
  while (m.bob.length < m.count * 4) m.bob.push(0, 0, 0, 0);
  for (let v = from; v < from + count; v++) { m.bob[v * 4] = m.p[v * 3] - cx; m.bob[v * 4 + 1] = m.p[v * 3 + 2] - cz; m.bob[v * 4 + 2] = seed; m.bob[v * 4 + 3] = 1; }
}
function finishBob(m, geo) {
  const a = m.bob || [];
  while (a.length < m.count * 4) a.push(0, 0, 0, 0);
  geo.setAttribute('bob', toAttr(a));
  return geo;
}
// The swell rocks what is marked (but not in the shadow map, which stays put).
function bobTSL(v) {
  if (v.shadow) return;
  const b = attribute('bob', 'vec4'), t = G.time.add(b.z.mul(7.0));
  const heave = sin(t.mul(0.9)).mul(0.035).add(sin(t.mul(1.37).add(1.1)).mul(0.015));
  const pitch = sin(t.mul(0.63).add(0.4)).mul(0.012), roll = sin(t.mul(0.51).add(2.0)).mul(0.022);
  v.P.assign(v.P.add(vec3(0.0, heave.add(b.x.mul(roll)).add(b.y.mul(pitch)), 0.0).mul(b.w)));
}

// ---- the marina -----------------------------------------------------------------------------

// Laid out from where the camera stands at the waterline looking down -z, (vx, vz): local x is
// to the right, local z toward the camera (what is ahead has z < 0).
const MARINA_START = { vx: 4.59, vz: 18 };
const MARINA_END = { vx: -3.02, vz: -396 };
// A sailboat at its own mooring beyond the right pier (only at the start). The mooring buoy
// the dinghy is tied to, its chain and the anchor are in layout.js (the camera rides that chain).
const MOORED = { x: 11.0, z: -9.5, len: 6.2, beam: 2.1, heading: -3.015 };
const COL = { coral: [0.92, 0.42, 0.33], cream: [0.93, 0.86, 0.72], navy: [0.20, 0.25, 0.42], teal: [0.25, 0.58, 0.60], sun: [0.96, 0.72, 0.30] };

function buildMarina(ctx, q, vp, opts) {
  const rng = makeRng(opts.seed);
  const { vx, vz } = vp;
  const X = (x) => vx + x, Z = (z) => vz + z;
  const deep = !!opts.deep;
  const w = new TMesh(), r = new TMesh(), y = new TMesh(), b = new TMesh(), c = new TMesh();
  const deckY = 0.8, front = -6.5, back = -9.3;
  const piers = [[-17.5, -3.6], [4.1, 19]];
  const posts = [];
  // the piers: posts, fascia beams, joists, planks
  for (const [x0, x1] of piers) {
    const left = x1 < 0, n = Math.round((x1 - x0) / 2.3);
    for (let i = 0; i <= n; i++) {
      const lx = left ? x1 - 0.2 - i * 2.3 : x0 + 0.2 + i * 2.3;
      if (lx < x0 - 0.1 || lx > x1 + 0.1) continue;
      for (const [lz, topY, isFront] of [[front + 0.05, 1.68, true], [back - 0.05, 0.98, false]]) {
        const px = X(lx + rng.range(-0.05, 0.05)), pz = Z(lz + rng.range(-0.04, 0.04));
        const g = deep ? shelfY(px, pz) - 0.4 : groundY(px, pz) - 0.8;
        const hw = rng.range(0.16, 0.19), tp = topY + rng.range(-0.06, 0.08);
        w.paint(WOOD.post.map((v) => v * rng.range(0.85, 1.12)));
        rbox(w, [px, (g + tp) / 2, pz], [1, 0, 0], [0, 1, 0], [0, 0, 1], [hw, (tp - g) / 2, hw * rng.range(0.92, 1.05)], 0.06, [1, Math.max(1, Math.round((tp - g) / 3.0)), 1],
          (lx2, ly, lz2, o) => { o[0] = lx2 + lz2 * 1.37 + i * 0.71; o[1] = ly; o[2] = 1; });
        posts.push({ x: px, z: pz, hw, top: tp, front: isFront, left, foot: g });
        if (isFront) { r.paint(ROPE); lashing(r, [px, pz], hw, deckY + 0.12, 3); lashing(r, [px, pz], hw, tp - 0.25, 2); }
      }
    }
    w.paint(WOOD.beam);
    for (const lz of [front + 0.27, back - 0.27]) timber(w, [X(x0), deckY - 0.15, Z(lz)], [X(x1), deckY - 0.15, Z(lz)], 0.14, 0.3, [0, 1, 0], 0.035);
    for (let lx = x0 + 0.6; lx < x1 - 0.3; lx += 1.15) timber(w, [X(lx), deckY - 0.17, Z(back - 0.1)], [X(lx), deckY - 0.17, Z(front + 0.1)], 0.12, 0.2, [0, 1, 0], 0.03);
    // the deck: one slab, its planks drawn by the shader (aux.w = 2: seams every 0.235 m along x)
    w.paint(WOOD.deck);
    rbox(w, [X((x0 + x1) / 2), deckY - 0.03, Z((front + back) / 2)], [1, 0, 0], [0, 1, 0], [0, 0, 1], [(x1 - x0) / 2, 0.035, (front - back) / 2 + 0.32], 0.02, [Math.round((x1 - x0) / 1.5), 1, 2],
      (lx, ly, lz, o) => { o[0] = lx + (x1 - x0) / 2 + x0; o[1] = lz; o[2] = 1; o[3] = 2; });
  }
  // brass: bolts in the fascia at each front post, cleats on the deck's edge
  for (const p of posts) if (p.front) for (const dy of [-0.07, 0.07]) ball(b, p.x, deckY - 0.15 + dy, Z(front + 0.27) + 0.075, (dx, dyy, dz) => (dz > 0 ? 0.03 : 0.012), 2);
  const cleat = (x, z) => {
    timber(b, [x - 0.13, deckY + 0.08, z], [x + 0.13, deckY + 0.08, z], 0.06, 0.05, [0, 1, 0], 0.024);
    for (const sx of [-0.05, 0.05]) timber(b, [x + sx, deckY - 0.01, z], [x + sx, deckY + 0.07, z], 0.05, 0.05, [0, 0, 1], 0.02);
  };
  cleat(X(-4.6), Z(front + 0.38)); cleat(X(5.2), Z(front + 0.38)); cleat(X(-9.2), Z(front + 0.38)); cleat(X(9.8), Z(front + 0.38));
  // on the decks: coils of rope, a crate, a net with floats
  r.paint(ROPE);
  coil(r, [X(-7.0), deckY, Z(-7.7)], 0.34, 0.035, 4.2);
  coil(r, [X(10.9), deckY, Z(-7.6)], 0.4, 0.038, 4.6);
  coil(r, [X(15.4), deckY, Z(-8.1)], 0.3, 0.033, 3.4);
  w.paint(WOOD.crate);
  {
    const cx = X(-11.2), cz = Z(-7.9), cy = deckY;
    for (const sz of [-1, 1]) for (let k = 0; k < 3; k++) timber(w, [cx - 0.42, cy + 0.11 + k * 0.19, cz + sz * 0.3], [cx + 0.42, cy + 0.11 + k * 0.19, cz + sz * 0.3], 0.04, 0.16, [0, 1, 0], 0.015);
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) timber(w, [cx + sx * 0.4, cy + 0.11 + k * 0.19, cz - 0.3], [cx + sx * 0.4, cy + 0.11 + k * 0.19, cz + 0.3], 0.04, 0.16, [0, 1, 0], 0.015);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) timber(w, [cx + sx * 0.42, cy, cz + sz * 0.32], [cx + sx * 0.42, cy + 0.6, cz + sz * 0.32], 0.06, 0.06, [1, 0, 0], 0.02);
  }
  // the dinghy, bow to the camera, between the piers
  const dinghy = { x: X(2.35), z: Z(-8.9), len: 4.3, beam: 1.72, heading: 0, depth: 0.36, sheer: 0.5, mastH: 4.6, mast: 0.25, paint: [COL.cream, [0.62, 0.22, 0.16]], sailSide: -1, belly: 0.18 };
  const db = boat(w, c, r, dinghy);
  for (const [m, from, n] of [[w, db.counts[0], db.counts[1]], [c, db.counts[2], db.counts[3]], [r, db.counts[4], db.counts[5]]]) markBob(m, from, n, dinghy.x, dinghy.z, 0.3);
  {
    const v0 = r.count;
    r.paint(ROPE);
    hangRope(r, db.at(0.12, db.sheerAt(0.97) + 0.04, 2.0), [X(4.3), deckY + 0.15, Z(front + 0.05)], 0.018, 0.28, 14);
    hangRope(r, db.at(-0.2, db.sheerAt(0.05) + 0.05, -2.05), [X(-3.8), deckY + 0.12, Z(back - 0.05)], 0.018, 0.45, 14);
    markBob(r, v0, r.count - v0, dinghy.x, dinghy.z, 0.3);
  }
  // fenders: crochet buoys on short ropes, half in the water
  const fender = (x, z, hang, col, col2, sx = 0.2, sy = 0.31) => {
    const v0 = y.count;
    y.paint(col, col2);
    ball(y, x, hang, z, (dx, dy, dz) => 1 / Math.sqrt((dx / sx) ** 2 + (dy / sy) ** 2 + (dz / sx) ** 2), 9);
    return v0;
  };
  for (const [lx, col, col2] of [[-3.8, COL.coral, COL.cream], [-6.1, COL.cream, COL.coral], [-10.7, COL.coral, COL.cream], [6.6, COL.coral, COL.cream], [13.5, COL.teal, COL.cream]]) {
    const p = posts.find((pp) => pp.front && Math.abs(pp.x - X(lx)) < 0.35);
    if (!p) continue;
    const fz = p.z + 0.44;
    fender(p.x, fz, 0.18, col, col2);
    r.paint(ROPE);
    hangRope(r, [p.x, deckY + 0.12, p.z + p.hw + 0.03], [p.x, 0.5, fz], 0.016, 0.05, 6);
  }
  {
    const fx = db.at(0.95, 0.3, 1.25), v0 = fender(fx[0], fx[2], 0.28, COL.navy, COL.navy, 0.15, 0.24);
    markBob(y, v0, y.count - v0, dinghy.x, dinghy.z, 0.3);
    const v1 = r.count;
    r.paint(ROPE);
    hangRope(r, db.at(0.85, db.sheerAt(0.8) + 0.03, 1.2), [fx[0], 0.52, fx[2]], 0.014, 0.03, 6);
    markBob(r, v1, r.count - v1, dinghy.x, dinghy.z, 0.3);
  }
  // the mooring buoy the dinghy rides to, at the waterline in front of its bow: a big knitted
  // ball in coral and cream stripes, with the dinghy's line to it; its chain hangs from under it
  // (buildChain), down to the anchor. It heaves a little less than the boats (its chain holds it)
  if (opts.anchor) {
    const v0 = y.count, R = BUOY.r;
    y.paint(COL.coral, COL.cream);
    ball(y, BUOY.x, BUOY.ring + 0.03 + R * 0.9, BUOY.z, (dx, dy, dz) => 1 / Math.sqrt((dx / R) ** 2 + (dy / (R * 0.9)) ** 2 + (dz / R) ** 2), 12);
    markBob(y, v0, y.count - v0, BUOY.x, BUOY.z, 0.8);
    for (let v = v0; v < y.count; v++) y.bob[v * 4 + 3] = 0.35;
    const top = [BUOY.x, BUOY.ring + 0.03 + R * 1.8, BUOY.z];
    const v1 = r.count;
    r.paint(ROPE);
    coil(r, [top[0], top[1] - 0.04, top[2]], 0.07, 0.022, 1.2, 0.2);
    hangRope(r, db.at(0, db.sheerAt(1) + 0.03, dinghy.len / 2 + 0.02), [top[0], top[1] - 0.02, top[2]], 0.02, 0.55, 18);
    markBob(r, v1, r.count - v1, BUOY.x, BUOY.z, 0.8);
    for (let v = v1; v < r.count; v++) r.bob[v * 4 + 3] = 0.35;
  }
  // the buoy on its coil of rope, on the left pier, tilted where it rests
  {
    const cx = X(-4.75), cz = Z(-7.25);
    r.paint([0.80, 0.70, 0.52]);
    coil(r, [cx, deckY, cz], 0.36, 0.045, 4.5);
    const v0 = y.count, ang = 0.55, ca = Math.cos(ang), sa = Math.sin(ang);
    y.paint(COL.coral, COL.cream);
    ball(y, 0, 0, 0, (dx, dy, dz) => 1 / Math.sqrt((dx / 0.26) ** 2 + (dy / 0.4) ** 2 + (dz / 0.26) ** 2), 10);
    for (let v = v0; v < y.count; v++) {
      const px = y.p[v * 3], py = y.p[v * 3 + 1], pz = y.p[v * 3 + 2], nx = y.n[v * 3], ny = y.n[v * 3 + 1];
      y.p[v * 3] = cx + px * ca - py * sa; y.p[v * 3 + 1] = deckY + 0.46 + px * sa + py * ca; y.p[v * 3 + 2] = cz + pz;
      y.n[v * 3] = nx * ca - ny * sa; y.n[v * 3 + 1] = nx * sa + ny * ca;
    }
  }
  // a crochet net heaped on the right pier, with two floats
  y.paint([0.80, 0.76, 0.62], [0.62, 0.70, 0.62]);
  blob(y, X(14.2), deckY + 0.12, Z(-7.9), (dx, dy, dz) => (0.55 + 0.12 * noise3(dx * 2.5, dy * 2.5, dz * 2.5)) * (dy < 0 ? 0.25 : 0.62 + 0.25 * dy), 10);
  y.paint(COL.sun); ball(y, X(13.8), deckY + 0.55, Z(-7.7), () => 0.13, 6);
  y.paint(COL.coral); ball(y, X(14.6), deckY + 0.5, Z(-8.1), () => 0.12, 6);
  // sailboats beyond, and at the start the one that rides to the anchor
  const far = [
    { x: X(-8.8), z: Z(-17.5), len: 5.6, beam: 1.9, heading: Math.PI / 2 + 0.25, paint: [[0.92, 0.90, 0.84], [0.30, 0.45, 0.62]], mastH: 6.2, jib: true, lod: 1, seed: 0.7 },
    { x: X(14.5), z: Z(-24), len: 6.0, beam: 2.0, heading: -Math.PI / 2 + 0.35, paint: [[0.90, 0.86, 0.78], [0.66, 0.24, 0.20]], mastH: 6.8, jib: true, lod: 1, seed: 1.3 },
    { x: X(21), z: Z(-33), len: 5.2, beam: 1.8, heading: -Math.PI / 2 - 0.2, paint: [[0.92, 0.90, 0.86], [0.28, 0.50, 0.50]], mastH: 6.0, jib: true, lod: 1, seed: 2.1, sailSide: -1 },
  ];
  let moored = null;
  if (opts.anchor) {
    moored = { x: MOORED.x, z: MOORED.z, len: MOORED.len, beam: MOORED.beam, heading: MOORED.heading, paint: [[0.90, 0.88, 0.82], [0.24, 0.36, 0.55]], mastH: 7.0, jib: true, seed: 1.9, depth: 0.5, sheer: 0.62 };
    far.push(moored);
  }
  for (const f of far) {
    const fb = boat(w, c, r, f);
    for (const [m, from, n] of [[w, fb.counts[0], fb.counts[1]], [c, fb.counts[2], fb.counts[3]], [r, fb.counts[4], fb.counts[5]]]) markBob(m, from, n, f.x, f.z, f.seed);
    f.at = fb.at; f.sheerAt = fb.sheerAt;
  }
  // string lights along the front of both piers (lit at the end of the dive)
  let bulbs = null;
  if (opts.lights) {
    bulbs = [];
    for (const [x0, x1] of piers) {
      const fronts = posts.filter((p) => p.front && p.x >= X(x0) - 0.5 && p.x <= X(x1) + 0.5).sort((a, bb) => a.x - bb.x);
      for (let i = 0; i < fronts.length - 1; i++) {
        const A = [fronts[i].x, deckY + 0.42, fronts[i].z + 0.22], B = [fronts[i + 1].x, deckY + 0.42, fronts[i + 1].z + 0.22];
        r.paint([0.2, 0.18, 0.15]);
        hangRope(r, A, B, 0.006, 0.22, 10);
        for (let k = 1; k <= 4; k++) { const t = k / 5; bulbs.push(lerp(A[0], B[0], t), A[1] - 0.22 * 4 * t * (1 - t) - 0.05, lerp(A[2], B[2], t)); }
      }
    }
  }
  // the meshes: wood, rope, yarn, brass, canvas
  const range = 140, fade = [118, 136];
  addMesh(ctx, sphereOf(finishBob(w, w.build()), 1), material({
    aux: true, fade, vertex: (v) => { tintIn(); bobTSL(v); },
    surface: (s, f) => {
      woodSurf(s, f, vT.rgb, vT2.w);
      // under water the bare wood is weathered silver-grey, greener toward the foot; it is lit
      // by the light the sand throws back up (most on what faces down: the boats' bottoms) and
      // by the water's own light round it
      const wet = smoothstep(-0.05, -0.7, f.w.y).toVar();
      const grey = s.albedo.mul(0.4).add(mix(srgb(0.56, 0.51, 0.43), srgb(0.44, 0.45, 0.36), smoothstep(-1.5, -4.5, f.w.y)));
      s.albedo = mix(s.albedo, grey, wet.mul(float(1).sub(vT2.w)).mul(0.85));
      const down = max(s.n.y.negate(), 0.0).mul(smoothstep(0.04, -0.12, f.w.y));
      s.emis = s.emis.add(s.albedo.mul(sunAt(f.w.y)).mul(down.mul(0.6).add(wet.mul(0.1))));
    },
  }), range);
  addMesh(ctx, sphereOf(finishBob(r, r.build()), 1), material({ aux: true, fade, vertex: (v) => { tintIn(); bobTSL(v); }, surface: (s, f) => ropeSurf(s, f, vT.rgb) }), range);
  addMesh(ctx, sphereOf(finishBob(y, y.build()), 1), yarnMat({ fade, vertex: (v) => bobTSL(v), scale: 26, stripe: 3 }), range);
  addMesh(ctx, sphereOf(b.build(), 0.5), material({ aux: true, fade, surface: (s, f) => brassSurf(s, f) }), range);
  addMesh(ctx, sphereOf(finishBob(c, c.build()), 1), material({ aux: true, twoSided: true, fade, vertex: (v) => bobTSL(v), surface: (s, f) => canvasSurf(s, f, srgb(0.95, 0.91, 0.82)) }), range);
  if (bulbs) buildBulbs(ctx, bulbs);
  buildLighthouse(ctx, X(-34.2), Z(-94), deep);
  if (deep) buildShelf(ctx, q, posts);
  return { moored, dinghy, posts };
}

// At the end the marina stands on a shallow shelf of cream sand a few metres down, as in our
// picture of it: rippled, a few stones and tufts of felt weed, the posts going down into it.
// The camera comes up from the vents in front of it (x -3.5 to -4.2, z -383 to -392). The
// shelf is one sheet of sand facing up, nothing under it, its front a gentle slope down to
// z -393.5: from below the sheet faces away and is not drawn, so it hides nothing of the
// bright surface overhead; only once the camera is within 9 m of the surface does the slope
// face it (the stones and the weed show from then on too). It darkens toward its edges so
// they melt into the deep.
const SHELF = { x0: -41, x1: 35, z0: -393.5, z1: -452, y: -4.7, crest: -399.5, slope: 0.45 };
function shelfY(x, z) {
  const top = SHELF.y + 0.28 * noise3(x * 0.07 + 2.3, z * 0.07, 1.3) + 0.1 * noise3(x * 0.23, z * 0.23 + 1.7, 4.1);
  // (the slope, its crest rounded over a metre)
  const u = z - SHELF.crest, r = 0.5;
  return top - SHELF.slope * (u > r ? u : u > -r ? (u + r) * (u + r) / (4 * r) : 0);
}
// Stones and weed on the shelf show only once the camera is near the surface (from below, they
// would stand on nothing; from then on the slope's crest hides where they come in).
const shelfShow = (v) => { if (!v.shadow) v.P.assign(v.P.sub(vec3(0.0, step(cameraPosition.y, -9.0).mul(1000.0), 0.0))); };
function buildShelf(ctx, q, posts) {
  const hi = q.amount >= 0.5, rng = makeRng(4242);
  const m = new Mesh(true);
  m.grid(hi ? 60 : 36, hi ? 36 : 22, (s, t, o) => {
    const x = lerp(SHELF.x0, SHELF.x1, s), z = SHELF.z0 + (SHELF.z1 - SHELF.z0) * Math.pow(t, 1.35);
    o[0] = x; o[1] = shelfY(x, z); o[2] = z;
    o[3] = Math.max(smoothN(-399.8, -393.5, z) * 0.9, smoothN(30, 38, Math.abs(x + 3.02)));
  });
  addMesh(ctx, sphereOf(m.build(), 1), material({
    aux: true, fade: [36, 64],
    // (sand as on the shallows; where it sinks away at its edges it darkens into the deep)
    surface: (s, f) => { rockSurf(s, f.w, f.w, float(0.0), float(1.0), f.dist); s.albedo = s.albedo.mul(float(1).sub(f.aux.x.mul(0.85))); },
  }), 70);
  // stones, half sunk in the sand, and tufts of felt weed by the posts
  const st = new Mesh(true), k = new TMesh();
  const spots = [[-9.5, -404.6, 0.42], [-12.8, -407.3, 0.3], [-1.9, -406.2, 0.26], [3.6, -404.1, 0.38], [6.4, -410.5, 0.5], [-15.5, -413, 0.55], [9.8, -406.8, 0.28], [-6.3, -411.4, 0.34], [13.5, -416, 0.6], [-20.5, -409, 0.45]];
  for (const [x, z, r] of spots) {
    const gy = shelfY(x, z), sq = rng.range(0.55, 0.8), v0 = st.count, i0 = st.i.length;
    blob(st, x, gy + r * sq * 0.35, z, (dx, dy, dz) => r * (1 + 0.16 * noise3(dx * 2 + x, dy * 2, dz * 2 + z)) * (dy > 0 ? sq : 0.5), hi ? 6 : 4);
    st.normals(v0, st.count, i0, null);
  }
  addMesh(ctx, sphereOf(st.build(), 0.5), material({ aux: true, fade: [36, 64], vertex: shelfShow, surface: (s, f) => rockSurf(s, f.w, f.w, float(1.0), float(0.8), f.dist) }), 70);
  const tufts = [[-8.4, -403.4], [-13.2, -405.8], [2.7, -403.2], [5.6, -405.9], [-4.7, -408.5], [11.4, -409], [-17.6, -406.6], [0.6, -412.5]];
  for (const [x, z] of tufts) {
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const A = [x + rng.bell() * 0.35, 0, z + rng.bell() * 0.35];
      A[1] = shelfY(A[0], A[2]) - 0.05;
      k.paint(rng() < 0.5 ? [0.40, 0.52, 0.28] : [0.56, 0.58, 0.30], [0.70, 0.74, 0.44]);
      feltBlade(k, rng, A, rng.range(0.7, 1.6), rng.range(0.09, 0.15), rng(), 1, 0.35, hi ? 10 : 6);
    }
  }
  addMesh(ctx, sphereOf(k.build(), 1.5), weedMat([36, 64], shelfShow), 70);
}

// A felt blade or streamer: a ribbon from A, `len` long and `wid` wide, growing up (up = 1) or
// hanging (up = -1), curling and twisting a little, wavy along its edges. aux: x how far along
// (metres), y which edge (-1, 1), z a seed, w 1 (it sways). Paint k first.
function feltBlade(k, rng, A, len, wid, seed, up = -1, curl = 0.6, n = 10) {
  const v0 = k.count, twist = rng.range(-1.2, 1.2), lean = [rng.bell() * 0.4 + 0.25, rng.bell() * 0.3];
  for (let i = 0; i <= n; i++) {
    const t = i / n, s2 = t * len, ang = twist * t;
    const cx = A[0] + lean[0] * s2 * t * curl + Math.sin(t * 5 + seed * 6) * 0.08 * s2, cy = A[1] + up * s2 * (1 - 0.25 * t * curl), cz = A[2] + lean[1] * s2 * t + Math.cos(t * 4 + seed * 5) * 0.08 * s2;
    // (widest a third of the way, to a rounded point; the edges a little wavy)
    const wd = wid * (0.45 + 0.75 * Math.sin(Math.PI * Math.min(t * 1.25 + 0.08, 1))) * (1 + 0.18 * Math.sin(t * 17 + seed * 4)) * (1 - 0.85 * t * t * t);
    for (const sx of [-1, 1]) k.vert(cx + sx * wd * 0.5 * Math.cos(ang), cy, cz + sx * wd * 0.5 * Math.sin(ang), 0, 0, 1, 0, 0, s2, sx, seed, 1);
  }
  const i0 = k.i.length;
  for (let i = 0; i < n; i++) { const a = v0 + i * 2; k.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  k.normals(v0, k.count, i0, null);
}
// Felt weed, swaying with the current, more toward its free end; a darker rib down its middle.
const weedMat = (fade, more = null) => material({
  aux: true, twoSided: true, fade,
  vertex: (v) => {
    tintIn();
    if (more) more(v);
    const ph = G.time.mul(0.7).add(v.aux.z.mul(20.0)).sub(v.aux.x.mul(0.9)).toVar(), kk = v.aux.x.mul(v.aux.x).mul(0.05).mul(v.aux.w);
    v.P.assign(v.P.add(vec3(sin(ph).add(sin(ph.mul(2.1)).mul(0.3)), cos(ph.mul(0.7)).mul(0.15), cos(ph.mul(0.8)).mul(0.8)).mul(kk)));
  },
  surface: (s, f) => {
    feltSurf(s, f, mix(vT.rgb, vT2.rgb, smoothstep(0.5, 3.0, f.aux.x)).mul(float(1).sub(exp(f.aux.y.mul(f.aux.y).mul(-40.0)).mul(0.25))));
  },
});

// Little warm bulbs on a string: a lit bead each, and a soft halo.
function buildBulbs(ctx, list) {
  const m = new Mesh(true);
  for (let i = 0; i < list.length; i += 3) ball(m, list[i], list[i + 1], list[i + 2], () => 0.045, 3);
  addMesh(ctx, sphereOf(m.build(), 0.5), material({ aux: true, shadow: false, surface: (s) => { s.albedo = srgb(0.95, 0.9, 0.8); s.emis = vec3(3.2, 2.2, 1.0); } }), 140);
  addMesh(ctx, halos(list, 0.32), material({
    additive: true, shadow: false,
    vertex: (v) => haloVertex(v, 0.32),
    raw: (f) => {
      const d = length(vHalo);
      return { color: vec3(1.0, 0.72, 0.38).mul(exp(d.mul(d).mul(-9.0)).mul(1.4)).mul(exp(SIG.mul(f.dist).negate())), alpha: float(1.0) };
    },
  }), 140, { noShadow: true });
}
// Camera-facing cards, one per point (for halos and glows).
const vHalo = varyingProperty('vec2', 'v_set_halo');
function halos(list, size) {
  const n = list.length / 3, geo = new InstancedBufferGeometry();
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('position', toAttr([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setAttribute('normal', toAttr([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  geo.setAttribute('at', new InstancedBufferAttribute(new Float32Array(list), 3));
  geo.instanceCount = n;
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < list.length; i += 3) { x0 = Math.min(x0, list[i]); x1 = Math.max(x1, list[i]); y0 = Math.min(y0, list[i + 1]); y1 = Math.max(y1, list[i + 1]); z0 = Math.min(z0, list[i + 2]); z1 = Math.max(z1, list[i + 2]); }
  geo.boundingSphere = new Sphere(V((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + size * 2);
  return geo;
}
function haloVertex(v, size) {
  const at = attribute('at', 'vec3');
  const toCam = normalize(cameraPosition.sub(at)).toVar();
  const right = normalize(cross(vec3(0, 1, 0), toCam)).toVar(), upv = cross(toCam, right);
  vHalo.assign(v.P.xy);
  v.P.assign(at.add(right.mul(v.P.x.mul(size))).add(upv.mul(v.P.y.mul(size))).add(toCam.mul(0.05)));
}

// The lighthouse on its island: a striped tower, a gallery with its rail, the lantern lit, a red
// cap; the island a heap of rock with a little green on top.
function buildLighthouse(ctx, x, z, deep) {
  const m = new Mesh(true), base = 1.6, h = 18, k = 0.95;
  // aux: x kind (0 tower, 1 gallery and rail, 2 cap, 3 lantern), y height above the foot, z round (0..1)
  const prof = [[2.45 * k, 0], [2.3 * k, 3], [2.05 * k, 7.5], [1.85 * k, 12.5], [1.68 * k, h]];
  const tower = [];
  for (let i = 0; i <= 24; i++) {
    const yy = h * (i / 24);
    let rr = 2.45 * k;
    for (let k = 1; k < prof.length; k++) if (yy <= prof[k][1]) { const a = prof[k - 1], bb = prof[k], u = (yy - a[1]) / (bb[1] - a[1]); rr = lerp(a[0], bb[0], u); break; }
    tower.push([x, base + yy, z, rr]);
  }
  sweep(m, tower, 28, { aux: (k, j, px, py, pz, o) => { o[0] = 0; o[1] = py - base; o[2] = j / 28; } });
  const gy = base + h, kind = (kk) => (k, j, px, py, pz, o) => { o[0] = kk; o[1] = py - base; o[2] = j / 20; };
  const G2 = 1.62 * k, R2 = 1.45 * k;
  sweep(m, [[x, gy - 0.2, z, G2 * 0.9], [x, gy - 0.16, z, G2], [x, gy + 0.06, z, G2]], 28, { aux: kind(1) });
  disc(m, x, gy + 0.06, z, G2, 28, 1, [1, 20, 0, 0]);
  disc(m, x, gy - 0.2, z, G2 * 0.9, 28, -1, [1, 20, 0, 0]);
  for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; sweep(m, [[x + Math.cos(a) * R2 * 1.05, gy + 0.06, z + Math.sin(a) * R2 * 1.05, 0.04], [x + Math.cos(a) * R2 * 1.05, gy + 0.7, z + Math.sin(a) * R2 * 1.05, 0.04]], 5, { aux: kind(1) }); }
  const rail = [];
  for (let i = 0; i < 32; i++) { const a = (i / 32) * TAU; rail.push([x + Math.cos(a) * R2 * 1.05, gy + 0.7, z + Math.sin(a) * R2 * 1.05, 0.05]); }
  sweep(m, rail, 5, { closed: true, up: [0, 1, 0], aux: kind(1) });
  sweep(m, [[x, gy + 0.06, z, 0.9 * k * 1.3], [x, gy + 1.6, z, 0.9 * k * 1.3]], 20, { aux: kind(3) });
  sweep(m, [[x, gy + 1.56, z, 1.1 * k * 1.3], [x, gy + 1.7, z, 1.12 * k * 1.3], [x, gy + 2.45, z, 0.34], [x, gy + 2.66, z, 0.07]], 20, { aux: kind(2) });
  disc(m, x, gy + 1.56, z, 1.1 * k * 1.3, 20, -1, [2, 22, 0, 0]);
  ball(m, x, gy + 2.76, z, () => 0.2, 4, (dx, dy, dz, o) => { o[0] = 2; o[1] = 24; });
  // the door and the windows face the marina: the angle round the tower that looks at it
  const face = Math.atan2(34.2, 94) / TAU;    // (sweep's angle 0 faces -z; the marina lies at +x, +z)
  addMesh(ctx, sphereOf(m.build(), 1), material({
    aux: true, fade: [175, 200],
    surface: (s, f) => {
      const k = f.aux.x, hh = f.aux.y, round = fract(f.aux.z.sub(0.5 - face).add(1.0));
      const band = step(0.5, fract(hh.div(3.2)));
      const paint = mix(srgb(0.96, 0.94, 0.89), srgb(0.84, 0.30, 0.25), band);
      const facing = float(1).sub(smoothstep(0.02, 0.03, abs(round.sub(0.5))));
      const win = facing.mul(float(1).sub(smoothstep(0.1, 0.13, abs(fract(hh.div(4.6)).sub(0.5))))).mul(step(3.0, hh)).mul(step(hh, 16.5));
      const door = float(1).sub(smoothstep(0.03, 0.04, abs(round.sub(0.5)))).mul(step(hh, 1.9));
      const kT = float(1).sub(step(0.5, k)), kR = step(0.5, k).mul(float(1).sub(step(1.5, k))), kC = step(1.5, k).mul(float(1).sub(step(2.5, k))), kG = step(2.5, k);
      const col = mix(paint, srgb(0.2, 0.17, 0.17), max(win, door).mul(kT)).toVar();
      col.assign(mix(col, srgb(0.24, 0.25, 0.27), kR));
      col.assign(mix(col, srgb(0.72, 0.24, 0.21), kC));
      col.assign(mix(col, srgb(1.0, 0.96, 0.82), kG));
      s.albedo = col;
      s.spec = mix(float(0.06), float(0.6), kG); s.gloss = float(30.0); s.fluor = float(0.3);
      s.emis = vec3(2.6, 1.9, 0.9).mul(kG);
    },
  }), 200);
  // the island
  const isl = new Mesh(true), cy = -2.2;
  blob(isl, x, cy, z, (dx, dy, dz) => (dy > 0 ? 7.0 : 7.6) * (1 + 0.18 * noise3(dx * 2.2 + 4, dy * 2.2, dz * 2.2) + 0.08 * noise3(dx * 6, dy * 6, dz * 6 + 2)), 24);
  // (the rock ends just under the water, open underneath: at the end so that seen from the deep,
  // where the camera comes up, it is not a dark blot against the bright surface; at the start so
  // that from the shallows it is not a far grey slab in the water; from the waterline the water
  // hides the rest)
  for (let v = 0; v < isl.count; v++) { const yy = isl.p[v * 3 + 1] - cy; isl.p[v * 3 + 1] = cy + (yy > 0 ? yy * 0.62 : yy * 0.28); }
  isl.normals(0, isl.count, 0, null);
  {
    const keep = [];
    for (let k = 0; k < isl.i.length; k += 3) { const a = isl.i[k], b = isl.i[k + 1], c = isl.i[k + 2]; if (Math.max(isl.p[a * 3 + 1], isl.p[b * 3 + 1], isl.p[c * 3 + 1]) > -0.6) keep.push(a, b, c); }
    isl.i = keep;
  }
  addMesh(ctx, sphereOf(isl.build(), 1), material({
    aux: true, fade: [175, 200],
    surface: (s, f) => {
      rockSurf(s, f.w, f.w, clamp(smoothstep(0.6, 1.4, f.w.y).sub(smoothstep(0.55, 0.85, f.n.y).mul(0.5)).add(0.3), 0.0, 1.0), float(1.0), f.dist);
      s.albedo = mix(s.albedo, srgb(0.52, 0.64, 0.36), smoothstep(0.3, 2.6, f.w.y).mul(smoothstep(0.7, 0.9, f.n.y)).mul(0.85));
      // just under the water the rock is dark with weed; further down it is the sea floor's own
      // sandy rock, lit from above, so from the shallows it reads as a solid rounded hill
      s.albedo = mix(s.albedo, srgb(0.1, 0.16, 0.15), smoothstep(-0.2, -1.5, f.w.y).mul(float(1).sub(smoothstep(-2.5, -5.0, f.w.y))));
    },
  }), 200);
}

// ---- the chain --------------------------------------------------------------------------------

// The rest shape: hung from the ring under the buoy to the anchor's ring (layout.js has it: the
// camera rides beside it). Sampled at even lengths for chainAt.
function chainShape() {
  return { all: MOORING.pts, acc: MOORING.acc, total: MOORING.total, hang: MOORING.total, plane: MOORING.plane };
}

// The sway, the same in JavaScript and in the shader: h is how far down the hanging part
// (0 at the bow, 1 where it meets the sand); returns side, along, up offsets in metres.
const swayJS = (h, t, out) => {
  const e = Math.sin(Math.PI * clampN(h, 0, 1));
  out[0] = e * 0.24 * (0.7 * Math.sin(t * 0.55 - h * 2.2 + 0.5) + 0.3 * Math.sin(t * 0.93 - h * 4.1 + 2.0));
  out[1] = e * 0.12 * Math.sin(t * 0.37 + 1.0); out[2] = e * 0.07 * Math.sin(t * 0.37 + 1.6);
  return out;
};
const swayTSL = (h, t) => {
  const e = sin(clamp(h, 0.0, 1.0).mul(Math.PI)).toVar();
  const lat = e.mul(0.24).mul(sin(t.mul(0.55).sub(h.mul(2.2)).add(0.5)).mul(0.7).add(sin(t.mul(0.93).sub(h.mul(4.1)).add(2.0)).mul(0.3)));
  return vec3(lat, e.mul(0.12).mul(sin(t.mul(0.37).add(1.0))), e.mul(0.07).mul(sin(t.mul(0.37).add(1.6))));
};

// Chunky rusty iron, orange where it has flaked, as in our picture of the anchor.
function rustSurf(s, f) {
  const near = float(1).sub(smoothstep(3.0, 16.0, f.dist)).toVar();
  const D = detail(f.w, s.n, 1.6, 2.0), E = detail(f.w, s.n, 4.4, 1.6);
  const flake = smoothstep(0.42, 0.6, D.m.add(E.h.mul(0.35)).sub(0.1)).toVar();
  const col = mix(srgb(0.80, 0.45, 0.24), srgb(0.55, 0.28, 0.14), flake).toVar();
  col.assign(mix(col, srgb(0.90, 0.58, 0.32), smoothstep(0.62, 0.78, E.m).mul(0.5)));
  s.albedo = col.mul(E.h.mul(0.25).mul(near).add(0.9));
  s.n = normalize(s.n.add(D.n.sub(s.n).mul(0.7)).add(E.n.sub(s.n).mul(near.mul(0.6)))).toVar();
  s.ao = D.h.mul(0.4).add(0.68).min(1.0);
  s.spec = float(0.08); s.gloss = float(18.0); s.fluor = float(0.55);
}

function buildChain(ctx, q) {
  const C = chainShape();
  const d = 0.034, r = d / 2, a = 0.85 * d, cR = 1.25 * d, pitch = 3.2 * d;
  // one link: a stadium-shaped ring in its own plane (x across, y along the chain)
  const m = new Mesh(true), line = [], arcN = q.amount >= 0.5 ? 6 : 4;
  for (let i = 0; i <= arcN; i++) { const th = Math.PI * (i / arcN); line.push([Math.cos(th) * cR, a + Math.sin(th) * cR, 0, r]); }
  for (let i = 0; i <= arcN; i++) { const th = Math.PI + Math.PI * (i / arcN); line.push([Math.cos(th) * cR, -a + Math.sin(th) * cR, 0, r]); }
  sweep(m, line, q.amount >= 0.5 ? 7 : 5, { closed: true, up: [0, 0, 1], aux: (k, j, x, y, z, o) => { o[0] = line[k][0]; o[1] = line[k][1]; o[2] = line[k][2]; o[3] = j; } });
  const link = m.build();
  const count = Math.floor(C.total / pitch);
  const ca = new Float32Array(count * 4), cb = new Float32Array(count * 4), cc = new Float32Array(count * 4);
  let seg = 0;
  const at = (sig, out) => {
    while (seg < C.acc.length - 2 && C.acc[seg + 1] < sig) seg++;
    while (seg > 0 && C.acc[seg] > sig) seg--;
    const A = C.all[seg], B = C.all[seg + 1], u = (sig - C.acc[seg]) / Math.max(C.acc[seg + 1] - C.acc[seg], 1e-6);
    out[0] = lerp(A[0], B[0], u); out[1] = lerp(A[1], B[1], u); out[2] = lerp(A[2], B[2], u);
    const l = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]) || 1;
    out[3] = (B[0] - A[0]) / l; out[4] = (B[1] - A[1]) / l; out[5] = (B[2] - A[2]) / l;
    return out;
  };
  const o = [0, 0, 0, 0, 0, 0];
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < count; i++) {
    const sig = (i + 0.5) * pitch;
    at(sig, o);
    let sx = -o[5], sz = o[3];
    const sl = Math.hypot(sx, sz) || 1; sx /= sl; sz /= sl;
    ca.set([o[0], o[1], o[2], sig / C.total], i * 4); cb.set([o[3], o[4], o[5], i & 1], i * 4); cc.set([sx, 0, sz, Math.min(sig / C.hang, 1)], i * 4);
    x0 = Math.min(x0, o[0]); x1 = Math.max(x1, o[0]); y0 = Math.min(y0, o[1]); y1 = Math.max(y1, o[1]); z0 = Math.min(z0, o[2]); z1 = Math.max(z1, o[2]);
  }
  const geo = new InstancedBufferGeometry();
  geo.setIndex(link.index);
  for (const k of ['position', 'normal', 'aux']) geo.setAttribute(k, link.getAttribute(k));
  geo.setAttribute('ca', new InstancedBufferAttribute(ca, 4));
  geo.setAttribute('cb', new InstancedBufferAttribute(cb, 4));
  geo.setAttribute('cc', new InstancedBufferAttribute(cc, 4));
  geo.instanceCount = count;
  geo.boundingSphere = new Sphere(V((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 1);
  const [px, pz] = C.plane;
  const SIDE = vec3(-pz, 0, px), ALONG = vec3(px, 0, pz), UP = vec3(0, 1, 0);
  const A0 = attribute('ca', 'vec4'), B0 = attribute('cb', 'vec4'), C0 = attribute('cc', 'vec4');
  addMesh(ctx, geo, material({
    aux: true, shadow: false, fade: [100, 118],
    vertex: (v) => {
      const h = C0.w, t = G.time;
      const sw = swayTSL(h, t), sw2 = swayTSL(min(h.add(0.01), 1.0), t);
      const off = SIDE.mul(sw.x).add(ALONG.mul(sw.y)).add(UP.mul(sw.z)).toVar();
      const off2 = SIDE.mul(sw2.x).add(ALONG.mul(sw2.y)).add(UP.mul(sw2.z));
      const Tn = normalize(B0.xyz.add(off2.sub(off).div(0.01 * C.hang))).toVar();
      const e0 = normalize(C0.xyz.sub(Tn.mul(dot(C0.xyz, Tn)))).toVar();
      const Xv = mix(e0, cross(Tn, e0), B0.w).toVar();
      const Zv = cross(Xv, Tn).toVar();
      const centre = A0.xyz.add(off).toVar();
      // far away the iron thickens a little, so it never thins below a pixel and shimmers
      const fat = max(float(1.0), length(centre.sub(cameraPosition)).mul(0.0006 / r));
      const lp = v.aux.xyz.add(v.N.mul(r).mul(fat));
      v.P.assign(centre.add(Xv.mul(lp.x)).add(Tn.mul(lp.y)).add(Zv.mul(lp.z)));
      v.N.assign(normalize(Xv.mul(v.N.x).add(Tn.mul(v.N.y)).add(Zv.mul(v.N.z))));
      v.aux.assign(vec4(A0.w, h, B0.w, 0.0));
    },
    surface: (s, f) => rustSurf(s, f),
  }), 118, { noShadow: true });
  const sw = [0, 0, 0], sw2 = [0, 0, 0], tmp = [0, 0, 0, 0, 0, 0];
  let now = 0;
  const chainAt = (s, out) => {
    const sig = clampN(s, 0, 1) * C.total;
    at(sig, tmp);
    const h = Math.min(sig / C.hang, 1);
    swayJS(h, now, sw); swayJS(Math.min(h + 0.01, 1), now, sw2);
    const ox = -pz * sw[0] + px * sw[1], oy = sw[2], oz = px * sw[0] + pz * sw[1];
    const dx = -pz * sw2[0] + px * sw2[1] - ox, dy = sw2[2] - oy, dz = px * sw2[0] + pz * sw2[1] - oz;
    out[0] = tmp[0] + ox; out[1] = tmp[1] + oy; out[2] = tmp[2] + oz;
    const tx = tmp[3] + dx / (0.01 * C.hang), ty = tmp[4] + dy / (0.01 * C.hang), tz = tmp[5] + dz / (0.01 * C.hang);
    const l = Math.hypot(tx, ty, tz) || 1;
    out[3] = tx / l; out[4] = ty / l; out[5] = tz / l;
    return out;
  };
  return { chainAt, setTime: (t) => { now = t; }, total: C.total };
}

// The anchor: a fisherman's anchor stood up in a heap of sand, crown and the arms' roots
// buried, the shank leaning toward the chain, the stock across it near the ring. Chunky and
// orange with rust. Returns the point on its ring where the chain is shackled.
function buildAnchor(ctx, foot, toward, facing) {
  const m = new Mesh(true);
  const shank = 1.6, ringY = shank + 0.15, stockY = shank - 0.18, SC = 1.3;
  const S = (pts, sides) => sweep(m, pts, sides, { caps: true, aux: (k, j, x, y, z, o) => { o[0] = x; o[1] = y; } });
  S([[0, -0.03, 0, 0.11], [0, 0.4, 0, 0.096], [0, 1.0, 0, 0.084], [0, shank + 0.02, 0, 0.075]], 10);
  for (const sx of [-1, 1]) {
    const th1 = 1.12, R = 0.66, pts = [];
    for (let i = 0; i <= 7; i++) { const th = (i / 7) * th1; pts.push([sx * Math.sin(th) * R, R - Math.cos(th) * R, 0, 0.09 - i * 0.005]); }
    S(pts, 10);
    // the palm: an arrowhead flattened across the arms' plane, pointing up and out
    const tx = sx * Math.sin(th1) * R, ty = R - Math.cos(th1) * R, dx = sx * Math.cos(th1), dy = Math.sin(th1);
    const v0 = m.count, i0 = m.i.length;
    blob(m, 0, 0, 0, (ux, uy, uz) => 1 / Math.sqrt((ux / 0.2) ** 2 + (uy / 0.05) ** 2 + (uz / 0.14) ** 2), 5);
    for (let v = v0; v < m.count; v++) {
      const lx = m.p[v * 3], ly = m.p[v * 3 + 1], lz = m.p[v * 3 + 2];
      const sharp = lx > 0 ? 1 - 0.6 * (lx / 0.2) : 1, XX = lx + 0.05;
      m.p[v * 3] = tx + dx * XX - dy * ly; m.p[v * 3 + 1] = ty + dy * XX + dx * ly; m.p[v * 3 + 2] = lz * sharp;
      m.a[v * 4] = m.p[v * 3]; m.a[v * 4 + 1] = m.p[v * 3 + 1];
    }
    m.normals(v0, m.count, i0, null);
  }
  S([[0, stockY, -0.86, 0.06], [0, stockY, -0.3, 0.075], [0, stockY, 0.3, 0.075], [0, stockY, 0.86, 0.06]], 10);
  for (const z of [-0.9, 0.9]) ball(m, 0, stockY, z, () => 0.1, 4, (x, yy, zz, o) => { o[0] = x; o[1] = yy + 3; });
  const ringPts = [];
  for (let i = 0; i < 16; i++) { const th = (i / 16) * TAU; ringPts.push([0, ringY + Math.sin(th) * 0.15, Math.cos(th) * 0.15, 0.035]); }
  sweep(m, ringPts, 7, { closed: true, up: [1, 0, 0], aux: (k, j, x, yy, z, o) => { o[0] = z; o[1] = yy; } });
  const geo = m.build();
  // stand it: the arms across the way the camera comes, the shank leaning toward the chain
  const Xw = [-facing[1], 0, facing[0]], lean = 0.28;
  const Yw = [Math.sin(lean) * toward[0], Math.cos(lean), Math.sin(lean) * toward[1]];
  const dxy = Xw[0] * Yw[0] + Xw[2] * Yw[2];
  const Xs = [Xw[0] - Yw[0] * dxy, -Yw[1] * dxy, Xw[2] - Yw[2] * dxy], xl = Math.hypot(Xs[0], Xs[1], Xs[2]);
  Xs[0] /= xl; Xs[1] /= xl; Xs[2] /= xl;
  const Zs = [Xs[1] * Yw[2] - Xs[2] * Yw[1], Xs[2] * Yw[0] - Xs[0] * Yw[2], Xs[0] * Yw[1] - Xs[1] * Yw[0]];
  const gy = groundY(foot[0], foot[1]), O = [foot[0], gy - 0.14, foot[1]];
  const toW = (x, y, z) => [O[0] + (Xs[0] * x + Yw[0] * y + Zs[0] * z) * SC, O[1] + (Xs[1] * x + Yw[1] * y + Zs[1] * z) * SC, O[2] + (Xs[2] * x + Yw[2] * y + Zs[2] * z) * SC];
  const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal');
  for (let v = 0; v < pos.count; v++) {
    const P = toW(pos.getX(v), pos.getY(v), pos.getZ(v));
    pos.setXYZ(v, P[0], P[1], P[2]);
    const nx = nor.getX(v), ny = nor.getY(v), nz = nor.getZ(v);
    nor.setXYZ(v, Xs[0] * nx + Yw[0] * ny + Zs[0] * nz, Xs[1] * nx + Yw[1] * ny + Zs[1] * nz, Xs[2] * nx + Yw[2] * ny + Zs[2] * nz);
  }
  addMesh(ctx, sphereOf(geo, 0.2), material({ aux: true, fade: [80, 98], surface: (s, f) => rustSurf(s, f) }), 98);
  // the heap of sand round its foot
  const sm = new Mesh(true), sy = gy - 0.45;
  blob(sm, foot[0], sy, foot[1], (dx, dy, dz) => (dy < 0 ? 0.5 : 1.0) * (1.0 + 0.1 * noise3(dx * 3, dy * 3, dz * 3)), 10);
  for (let v = 0; v < sm.count; v++) { const yy = sm.p[v * 3 + 1] - sy; sm.p[v * 3 + 1] = sy + yy * (yy > 0 ? 0.78 : 0.4); }
  sm.normals(0, sm.count, 0, null);
  addMesh(ctx, sphereOf(sm.build(), 0.2), material({ aux: true, fade: [80, 98], surface: (s, f) => rockSurf(s, f.w, f.w, float(0.0), float(1.0), f.dist) }), 98);
  return toW(0, ringY + 0.11, 0);
}

// ---- the Clam Studio ----------------------------------------------------------------------------

// The Clam Studio at the reef's far end, as in our pictures of it: a huge pearly scallop open
// like a room, its lower valve a deep dish on the sand and the upper one standing over it
// as wall and ceiling; three crochet jellyfish hang in it as lamps (warm cream, teal, lilac),
// glowing through their stitches and lighting the shell round them (glow slots 1 to 3, lent
// by the vents while the camera is on the reef), their tentacles swaying; a pearl on a
// little mound of sand; a crochet starfish in front. It stands just to the right of Snap's
// way, so he passes small beside it (p 3.75 to 3.85).
const CLAM = { x: 4.7, z: -170.4, face: [-0.42, 0.91], R: 2.3 };
function buildClam(ctx, q) {
  const rng = makeRng(3131);
  const fl = Math.hypot(CLAM.face[0], CLAM.face[1]), ez = [CLAM.face[0] / fl, 0, CLAM.face[1] / fl], ex = [ez[2], 0, -ez[0]];
  const hiQ = q.amount >= 0.5;
  // the shells: lower valve on the sand, cup up; upper valve hinged at the back, swung up to
  // stand behind it, leaning back a little. aux: x across the fan (0..1), y out from the hinge
  // (0..1), z which face (1 the pearly inside), w which valve (0 lower, 1 upper)
  const sh = new Mesh(true);
  const NU = hiQ ? 72 : 44, NV = hiQ ? 16 : 10, RIBS = 17, SPAN = 1.02 * Math.PI;
  const shell = (cx, cz, R, open) => {
    const gy = groundY(cx, cz);
    const hinge = [cx - ez[0] * R * 0.78, gy + 0.16, cz - ez[2] * R * 0.78];
    // a point of a valve in its own frame: u across (-1..1), v out (0..1); x right, y up out of the
    // cup, z out from the hinge
    const local = (u, v) => {
      // the scalloped edge, the ribs fanning from the hinge, a shallow dish
      const th = u * SPAN / 2, ribs = Math.pow(Math.abs(Math.sin((u * 0.5 + 0.5) * RIBS * Math.PI)), 0.7);
      const rr = R * v * (1 + 0.04 * ribs * v);
      const cup = 0.27 * R * (Math.pow(2 * v - 1, 2) * 0.75 + 0.7 * u * u * v) + 0.045 * R * ribs * Math.min(v * 3, 1);
      return [Math.sin(th) * rr, cup, Math.cos(th) * rr];
    };
    const place = (P, upper) => {
      // lower: lies with its cup up, z toward the camera; upper: the same shape turned up about
      // the hinge to stand, its inside toward the camera
      let [x, y, z] = P;
      if (upper) { const c = Math.cos(open), s = Math.sin(open), y2 = -y * c + z * s, z2 = y * s + z * c; y = y2; z = z2; }
      return [hinge[0] + ex[0] * x + ez[0] * z, hinge[1] + y, hinge[2] + ex[2] * x + ez[2] * z];
    };
    for (const upper of [0, 1]) {
      for (const face of [1, -1]) {
        const base = sh.count, i0 = sh.i.length;
        for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
          const u = i / NU * 2 - 1, v = Math.max(j / NV, 0.004), L0 = local(u, v);
          // the outside a hand's breadth below the inside
          const P = place([L0[0], L0[1] - (face < 0 ? 0.035 + 0.02 * v : 0), L0[2]], upper);
          sh.vert(P[0], P[1], P[2], 0, 1, 0, 0, 0, i / NU, v, face > 0 ? 1 : 0, upper);
        }
        const W = NU + 1;
        for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
          const a = base + j * W + i;
          if ((face > 0) !== !!upper) sh.i.push(a, a + W, a + 1, a + 1, a + W, a + W + 1); else sh.i.push(a, a + 1, a + W, a + 1, a + W + 1, a + W);
        }
        sh.normals(base, sh.count, i0, null);
      }
      // the lip: a rounded rim along the scalloped edge
      const rim = [];
      for (let i = 0; i <= NU; i++) { const u = i / NU * 2 - 1, L0 = local(u, 1), P = place([L0[0], L0[1] - 0.03, L0[2]], upper); rim.push([P[0], P[1], P[2], 0.05]); }
      sweep(sh, rim, 6, { aux: (k, j, x, y, z, o) => { o[0] = k / NU; o[1] = 1; o[2] = 0.5; o[3] = upper; } });
      // the ears either side of the hinge
      for (const sx of [-1, 1]) {
        const P = place([sx * R * 0.2, 0.04, R * 0.1], upper);
        ball(sh, P[0], P[1], P[2], (dx, dy, dz) => R * 0.13 * (Math.abs(dy) > 0.5 ? 0.35 : 1), 4, (dx, dy, dz, o) => { o[0] = 0.5; o[1] = 0.05; o[2] = 0; o[3] = upper; });
      }
    }
    return { hinge, gy, toW: (x, y, z) => place([x, y, z], 0), up: (x, y, z) => place([x, y, z], 1) };
  };
  const S = CLAM.R;
  const left = shell(CLAM.x, CLAM.z, S, 1.64), right = left;      // (one clam: the lamps and the pearl in it)
  addMesh(ctx, sphereOf(sh.build(), 0.5), material({
    aux: true, twoSided: true, fade: [82, 98],
    surface: (s, f) => {
      // pearly pink inside, a little iridescent, its ribs catching the light; the outside a
      // warmer, duller pink with fine growth lines
      const inside = f.aux.z, v = f.aux.y;
      const vv = normalize(cameraPosition.sub(f.w)), ndv = abs(dot(s.n, vv)), fres = pow(float(1).sub(ndv), 2.0);
      const rib = cos(f.aux.x.mul(RIBS * TAU)).mul(0.5).add(0.5);
      const lines = sin(v.mul(70.0)).mul(0.5).add(0.5);
      const pearl = mix(srgb(0.90, 0.64, 0.74), srgb(0.97, 0.82, 0.86), v.mul(0.55).add(rib.mul(0.3))).toVar();
      const outer = mix(srgb(0.82, 0.52, 0.60), srgb(0.92, 0.70, 0.74), lines.mul(0.3).add(v.mul(0.4)));
      s.albedo = mix(outer, pearl, inside).mul(rib.mul(0.1).add(0.9));
      // (the room inside is half closed: less of the water's light reaches in toward the hinge)
      s.ao = mix(float(1.0), smoothstep(0.0, 0.85, v).mul(0.5).add(0.5), inside);
      const D = detail(f.w, s.n, 2.0, 0.25);
      s.n = D.n;
      s.spec = mix(float(0.15), float(0.35), inside); s.gloss = mix(float(18.0), float(40.0), inside); s.fluor = float(0.8); s.trans = float(0.25);
      // the sheen: pink face-on, lilac and gold toward the edges of what the eye sees
      const irid = mix(mix(vec3(1.0, 0.72, 0.86), vec3(0.72, 0.70, 1.0), smoothstep(0.15, 0.55, fres)), vec3(1.0, 0.88, 0.62), smoothstep(0.55, 0.95, fres));
      s.emis = irid.mul(fres.mul(0.35).add(0.06)).mul(G.amb.mul(0.3).add(0.05)).mul(inside.mul(0.8).add(0.2))
        .add(pearl.mul(vec3(0.1, 0.05, 0.08)).mul(inside.mul(0.75).add(0.25)));
    },
  }), 98);

  // the jellyfish lamps in the shell: crochet bells, glowing through their stitches, hung on
  // yarn from its upper rim; long wavy tentacles and two curly arms below each
  const jy = new TMesh(), lamps = [], lampCols = [], glows = [];
  // how lit each lamp is (0 off, 1 on): the studio (zones/s3.js) puts them out and lights them
  // one after another as Snap arrives, through clam.lampLevel(i, k)
  const LAMP = uniform(new Vector3(1, 1, 1));
  const lampOf = (k) => select(k.lessThan(0.5), LAMP.x, select(k.lessThan(1.5), LAMP.y, LAMP.z));
  const JEL = [[-0.5, 0.62, 0.16, [1.0, 0.88, 0.66], [2.2, 1.5, 0.75]], [-0.14, 0.78, 0.14, [0.50, 0.93, 0.86], [0.5, 1.8, 1.55]], [0.22, 0.66, 0.15, [0.80, 0.64, 1.0], [1.4, 0.95, 2.2]]];
  JEL.forEach(([x0, h0, r0, col, light], k) => {
    const x = x0 * S, hgt = h0 * S, r = r0 * S;
    const c = left.toW(x, hgt, S * 0.55);
    jy.paint(col, col.map((v) => v * 0.9));
    // the bell: a dome with a scalloped skirt; aux.w 1 = the bell, lit from inside
    ball(jy, c[0], c[1], c[2], (dx, dy, dz) => r * (dy < -0.15 ? 0.25 + 0.75 * (1 + dy) : 1) * (dy > 0 ? 0.92 + 0.08 * dy : 1 + 0.07 * Math.sin(Math.atan2(dz, dx) * 9) * (dy < 0 ? 1 : 0)), 8, (dx, dy, dz, o) => { o[0] = dy; o[1] = 0; o[2] = k; o[3] = 1; });
    // tentacles: long wavy strands of yarn, and two arms curling round and round
    jy.paint(col.map((v) => v * 0.92), col.map((v) => v * 0.8));
    const nT = hiQ ? 8 : 5;
    for (let t = 0; t < nT + 2; t++) {
      const arm = t >= nT, a = (t / nT) * TAU + k * 0.7 + (arm ? 0.6 : 0), rr = r * (arm ? 0.25 : 0.7), len = (arm ? 0.45 : 0.6 + 0.4 * rng()) * S / 1.6, pts = [];
      const n = arm ? 24 : 14;
      for (let i = 0; i <= n; i++) {
        const s2 = i / n, wav = arm ? (0.04 + 0.03 * s2) * S / 1.6 : (0.02 + 0.03 * s2) * S / 1.6, fq = arm ? 15 : 7;
        pts.push([c[0] + Math.cos(a) * rr * (1 - 0.3 * s2) + Math.cos(s2 * fq + a * 3) * wav, c[1] - r * 0.12 - len * s2, c[2] + Math.sin(a) * rr * (1 - 0.3 * s2) + Math.sin(s2 * fq + a * 3) * wav, (arm ? 0.03 : 0.013) * (1 - 0.45 * s2)]);
      }
      sweep(jy, pts, arm ? 5 : 4, { caps: true, aux: (kk, j, x2, y2, z2, o) => { o[0] = -1; o[1] = kk / n * len; o[2] = k; o[3] = 0; } });
    }
    // the yarn it hangs from, up to the shell's rim
    const top = left.up(x * 0.8, 0.12, S * 0.97);
    jy.paint([0.9, 0.86, 0.78]);
    sweep(jy, [[c[0], c[1] + r * 0.9, c[2], 0.008], [lerp(c[0], top[0], 0.5), lerp(c[1] + r, top[1], 0.5) - 0.05, lerp(c[2], top[2], 0.5), 0.008], [top[0], top[1], top[2], 0.008]], 3, { aux: (kk, j, x2, y2, z2, o) => { o[0] = 0; o[1] = 0; o[2] = k; o[3] = 0; } });
    lamps.push(c[0], c[1] - r * 0.1, c[2]);
    lampCols.push(...toLinear(col).slice(0, 3));
    glows.push([c[0], c[1] - r * 0.35, c[2], 2.9], [...light, 0]);
  });
  // the pearl on its mound of sand in the right shell, and the starfish in front of the left
  const pearlAt = right.toW(S * 0.42, 0.42, S * 0.5);
  jy.paint([0.96, 0.92, 0.84], [0.90, 0.84, 0.74]);
  {
    const v0 = jy.count, i0 = jy.i.length, c = right.toW(S * 0.42, 0.18, S * 0.5);
    blob(jy, 0, 0, 0, (dx, dy, dz) => (dy < 0 ? 0.1 : 1) * (1 + 0.08 * noise3(dx * 3, dy * 3, dz * 3)), 7);
    for (let v = v0; v < jy.count; v++) {
      jy.p[v * 3] = c[0] + jy.p[v * 3] * 0.8; jy.p[v * 3 + 1] = c[1] + jy.p[v * 3 + 1] * 0.26; jy.p[v * 3 + 2] = c[2] + jy.p[v * 3 + 2] * 0.8;
      jy.a[v * 4] = -2; jy.a[v * 4 + 3] = 0;
    }
    jy.normals(v0, jy.count, i0, null);
  }
  const star = left.toW(-S * 0.3, 0.06, S * 1.22);
  {
    jy.paint([0.98, 0.62, 0.42], [0.98, 0.74, 0.58]);
    const gy = groundY(star[0], star[2]), v0 = jy.count, i0 = jy.i.length;
    blob(jy, 0, 0, 0, (dx, dy, dz) => { const a = Math.atan2(dz, dx); const arm = Math.pow(Math.abs(Math.cos(a * 2.5)), 3); return (0.13 + 0.26 * arm) * (dy > 0 ? 0.5 : 0.2) / Math.max(0.35, Math.hypot(dx, dz)) * Math.hypot(dx, dz) + 0.05; }, 9);
    for (let v = v0; v < jy.count; v++) { jy.p[v * 3] += star[0]; jy.p[v * 3 + 1] += gy + 0.05; jy.p[v * 3 + 2] += star[2]; jy.a[v * 4] = -3; jy.a[v * 4 + 3] = 0; }
    jy.normals(v0, jy.count, i0, null);
  }
  addMesh(ctx, sphereOf(jy.build(), 1), material({
    aux: true, fade: [82, 98],
    vertex: (v) => {
      tintIn();
      // the tentacles sway, more toward their ends; the bells bob a little
      const ph = G.time.mul(0.9).add(v.aux.z.mul(2.3)).toVar();
      const tent = step(v.aux.x, -0.5).mul(step(-1.5, v.aux.x));
      const k = v.aux.y.mul(v.aux.y).mul(0.12).mul(tent);
      v.P.assign(v.P.add(vec3(sin(ph.add(v.aux.y.mul(3.0))).mul(k), sin(ph.mul(0.7)).mul(0.03).mul(v.aux.w.add(tent)), cos(ph.mul(0.8).add(v.aux.y.mul(2.0))).mul(k))));
    },
    surface: (s, f) => {
      const Y = yarn(s, f, { color: vT.rgb, color2: vT2.rgb, stripe: 2, scale: 30, k: 1.2 });
      // the bells glow from inside: through the gaps between the stitches, and most through the
      // skirt; the tentacles a little
      const bell = f.aux.w, tent = step(f.aux.x, -0.5).mul(step(-1.5, f.aux.x));
      const through = float(1).sub(Y.h).mul(1.3).add(0.75).mul(float(1.0).sub(f.aux.x.mul(0.35)));
      s.emis = s.emis.add(vT.rgb.mul(bell.mul(through).mul(1.5).add(tent.mul(0.3))).mul(lampOf(f.aux.z)));
    },
  }), 98);
  // (the pearl is the studio's own, drawn by props/reef.js at `position` below, so that its
  // upscale can rebuild it from a mosaic: zones/s3.js)
  // the lamps' light: a haze of each one's own colour round its bell
  {
    const geo = halos(lamps, 1.3);
    geo.setAttribute('hc', new InstancedBufferAttribute(new Float32Array(lampCols), 3));
    geo.setAttribute('hk', new InstancedBufferAttribute(new Float32Array([0, 1, 2]), 1));
    const vHC = varyingProperty('vec3', 'v_set_hc');
    addMesh(ctx, geo, material({
      additive: true, shadow: false, fade: [70, 90],
      vertex: (v) => { vHC.assign(attribute('hc', 'vec3').mul(lampOf(attribute('hk', 'float')))); haloVertex(v, 1.3); },
      raw: (f) => { const d = length(vHalo); return { color: vHC.mul(exp(d.mul(d).mul(-4.0)).mul(0.85)).mul(exp(SIG.mul(f.dist).negate())), alpha: float(1.0) }; },
    }), 90, { noShadow: true });
  }
  const normal = V(ez[0] * 0.75, 0.66, ez[2] * 0.75).normalize();
  const level = [1, 1, 1];
  return {
    position: V(pearlAt[0], pearlAt[1] + 0.26, pearlAt[2]), normal, glows, level,
    // lamp i at k (0..1): its bell's glow, its haze and the light it throws (buildSets lends it)
    lampLevel(i, k) { if (level[i] === k) return; level[i] = k; LAMP.value.setComponent(i, k); },
  };
}

// ---- the wreck --------------------------------------------------------------------------------

// An old wooden sailing ship lying on the ledge, listing a little toward the camera's way: a
// long hull planked from the keel to the rail, wales along its sides, a breach amidships with
// its planks broken off, a stern castle with a gallery of small windows lit from inside,
// broken masts with their shrouds and ratlines, felt weed hanging from the yards and rails,
// crochet barnacles. In the stern castle, the captain's cabin, which the camera enters through
// a hole in the ship's side: plank walls, brass portholes and broken planks open onto the
// water, beams overhead, drifted sand with felt weed, a desk with an envelope, and over it a
// lantern (glow slot 0), the room's light.
// The ship's own frame: x to port (the camera's side is -x), y up from the keel, z to the bow.
const SHIP = { x: 3.6, z: -243.0, heading: Math.PI - 0.11, heel: 0.055, sink: 0.95, L: 22, B: 6.4, D: 4.2, castle: 2.5 };
const hashN = (a, b = 0) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
// One crochet barnacle: a little cone of yarn with a dark mouth, standing on a surface at P
// facing n, base radius rr. (aux.w 1: the mouth's dark rows.)
function barnacle(m, P, n, rr, seed) {
  const u = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let a = [u[1] * n[2] - u[2] * n[1], u[2] * n[0] - u[0] * n[2], u[0] * n[1] - u[1] * n[0]];
  const al = Math.hypot(a[0], a[1], a[2]); a = a.map((v) => v / al);
  const bv = [n[1] * a[2] - n[2] * a[1], n[2] * a[0] - n[0] * a[2], n[0] * a[1] - n[1] * a[0]];
  const h = rr * (1.0 + 0.6 * hashN(seed, 3));
  // profile: [radius, height, dark]
  const prof = [[rr, -0.02, 0], [rr * 1.02, h * 0.35, 0], [rr * 0.78, h * 0.85, 0], [rr * 0.55, h, 0], [rr * 0.4, h * 0.92, 1], [rr * 0.12, h * 0.55, 1]];
  const sides = LO ? 6 : 8, base = m.count, i0 = m.i.length;
  for (let k = 0; k < prof.length; k++) for (let j = 0; j <= sides; j++) {
    const ang = (j / sides) * TAU, c = Math.cos(ang), s = Math.sin(ang), [rad, hh, dark] = prof[k];
    const wob = 1 + 0.08 * Math.sin(ang * 3 + seed);
    m.vert(P[0] + (a[0] * c + bv[0] * s) * rad * wob + n[0] * hh, P[1] + (a[1] * c + bv[1] * s) * rad * wob + n[1] * hh, P[2] + (a[2] * c + bv[2] * s) * rad * wob + n[2] * hh,
      n[0], n[1], n[2], 0, 0, 0, 0, 1, dark);
  }
  const w2 = sides + 1;
  for (let k = 0; k < prof.length - 1; k++) for (let j = 0; j < sides; j++) { const p0 = base + k * w2 + j; m.i.push(p0, p0 + 1, p0 + w2, p0 + 1, p0 + w2 + 1, p0 + w2); }
  m.normals(base, m.count, i0, null);
}
function buildWreck(ctx, q) {
  const { L, B, D } = SHIP;
  const hi = q.amount >= 0.5;
  const rng = makeRng(2468);
  const gy = groundY(SHIP.x, SHIP.z);
  const F = [Math.sin(SHIP.heading), 0, Math.cos(SHIP.heading)], P = [F[2], 0, -F[0]];
  const ch = Math.cos(SHIP.heel), sh = Math.sin(SHIP.heel);
  const C = [SHIP.x, gy - SHIP.sink, SHIP.z];
  const W = (x, y, z) => { const x1 = x * ch - y * sh, y1 = x * sh + y * ch; return [C[0] + P[0] * x1 + F[0] * z, C[1] + y1, C[2] + P[2] * x1 + F[2] * z]; };
  const Wd = (x, y, z) => { const x1 = x * ch - y * sh, y1 = x * sh + y * ch; return [P[0] * x1 + F[0] * z, y1, P[2] * x1 + F[2] * z]; };
  // wood, yarn (barnacles and the things on the desk), brass, rope, glass, felt
  const w = new TMesh(), y = new TMesh(), b = new TMesh(), r = new TMesh(), gl = new TMesh(), k = new TMesh();
  const DARK = [0.50, 0.42, 0.34], DECK = [0.54, 0.45, 0.34], INNER = [0.46, 0.33, 0.22], RAW = [0.78, 0.64, 0.48];
  // (tint2.w marks wood that faces into the ship: in the cabin it is lit by the lantern)
  const paintIn = (c) => w.paint(c, [...c, 1]);
  // the hull's lines: t from the stern (0) to the bow (1)
  const tab = (T, t) => { t = clampN(t, 0, 1); for (let i = 1; i < T.length; i++) if (t <= T[i][0]) { const a = T[i - 1], bb = T[i], u = (t - a[0]) / (bb[0] - a[0]); return a[1] + (bb[1] - a[1]) * u * u * (3 - 2 * u); } return T[T.length - 1][1]; };
  const bT = [[0, 0.80], [0.12, 0.9], [0.4, 1.0], [0.65, 0.97], [0.82, 0.82], [0.93, 0.5], [1, 0.05]];
  const kT = [[0, 0.35], [0.06, 0.0], [0.86, 0.0], [0.94, 0.9], [1, D * 0.75]];
  const castleT = 0.27, fcT = 0.86;
  const deckAt = (t) => D + 0.45 * Math.pow(2 * t - 1, 2);
  const castleY = deckAt(0.1) + SHIP.castle, fcY = deckAt(0.93) + 1.3;
  const topAt = (t) => deckAt(t) + 0.9 + SHIP.castle * (1 - smoothN(castleT - 0.015, castleT + 0.015, t)) + 1.3 * smoothN(fcT - 0.015, fcT + 0.015, t);
  const hbAt = (t) => (B / 2) * tab(bT, t), keelAt = (t) => tab(kT, t);
  const sect = (t, v, inset = 0) => {
    // v from the keel (0) up the side to the top of the bulwark (1)
    const yk = keelAt(t), yt = topAt(t), yy = yk + (yt - yk) * v;
    const vv = clampN((yy - yk) / Math.max(deckAt(t) - yk, 0.3), 0, 1.4);
    const th = Math.min(vv, 1) * Math.PI / 2;
    let x = hbAt(t) * Math.pow(Math.sin(th), 0.5 + 0.85 * (1 - smoothN(0.0, 0.24, t)));
    if (vv > 1) x = hbAt(t) * (1 - 0.07 * (vv - 1));                     // tumblehome above the deck
    return [Math.max(x - inset, 0.02), yy];
  };
  // the transom: round across, raked aft toward the top; the sides and decks end on it
  const yk0 = keelAt(0), yt0 = topAt(0);
  const tz = (yy, xx) => -L / 2 - 0.55 * Math.pow(clampN((yy - yk0) / (yt0 - yk0), 0, 1), 1.5) - 0.42 * (1 - Math.pow(clampN(xx / Math.max(hbAt(0), 0.1), -1, 1), 2));
  const cab = { t: 0.135, floor: deckAt(0.135) + 0.02 };
  const cz = (cab.t - 0.5) * L;
  const tOf = (z) => z / L + 0.5;

  // ---- the hull: both sides, the outer skin and the inner lining, a plank to each row of the
  // grid. Holes are cut plank by plank, each plank breaking off at its own place.
  const NT = hi ? 64 : 40, NV = hi ? 24 : 16;
  const holes = [
    // the cabin's, where the camera goes in (it crosses the side at about y 6.1, z -7.6)
    { side: -1, t: 0.135, y: cab.floor + 1.42, ht: 0.088, hy: 1.08 },
    // a breach amidships, low on the side
    { side: -1, t: 0.56, y: 2.1, ht: 0.07, hy: 1.3 },
    // the cabin's back wall: planks broken away onto the water, by the stern and low by the bow
    { side: 1, t: tOf(-10.5), y: cab.floor + 1.3, ht: 0.016, hy: 0.9 },
    { side: 1, t: tOf(-5.45), y: cab.floor + 0.75, ht: 0.0127, hy: 0.52 },
  ];
  const mask = [new Uint8Array(NV * NT), new Uint8Array(NV * NT)];
  holes.forEach((h, hk) => {
    const m = mask[h.side > 0 ? 1 : 0];
    for (let i = 0; i < NV; i++) {
      const v = (i + 0.5) / NV, grow = 0.72 + 0.56 * hashN(i, hk + 1), shift = (hashN(i + 31, hk + 1) - 0.5) * 0.45 * h.ht;
      for (let j = 0; j < NT; j++) {
        const tc = (j + 0.5) / NT, uy = (sect(tc, v)[1] - h.y) / h.hy;
        if (Math.abs(uy) >= 1) continue;
        if (Math.abs(tc - h.t - shift) < h.ht * Math.sqrt(1 - uy * uy) * grow) m[i * NT + j] = 1;
      }
    }
  });
  const hullAt = (side, layer, i, j) => {
    const t = j / NT, [x, yy] = sect(t, i / NV, layer ? 0.14 : 0);
    return W(side * x, yy, j <= 0 ? tz(yy, x) + (layer ? 0.05 : 0) : (t - 0.5) * L);
  };
  for (const side of [-1, 1]) for (const layer of [0, 1]) {
    const base = w.count, m = mask[side > 0 ? 1 : 0];
    if (layer) paintIn(INNER); else w.paint(DARK);
    for (let i = 0; i <= NV; i++) for (let j = 0; j <= NT; j++) {
      const t = j / NT, [, yy] = sect(t, i / NV), Pp = hullAt(side, layer, i, j);
      // aux: x the plank (a row each), y along the hull; z: inside, below the deck, the hold is dark
      w.vert(Pp[0], Pp[1], Pp[2], 0, 1, 0, 0, 0, i * 0.235, (t - 0.5) * L, layer && yy < deckAt(t) - 0.15 ? 0.3 : 1, 2);
    }
    const Wn = NT + 1, i0 = w.i.length;
    for (let i = 0; i < NV; i++) for (let j = 0; j < NT; j++) {
      if (m[i * NT + j]) continue;
      const a = base + i * Wn + j;
      const out = (side > 0) === (layer === 0);
      if (out) w.i.push(a, a + 1, a + Wn, a + 1, a + Wn + 1, a + Wn); else w.i.push(a, a + Wn, a + 1, a + 1, a + Wn, a + Wn + 1);
    }
    w.normals(base, w.count, i0, null);
  }
  // round each hole: along its top and bottom the planks' long edges (fresh wood between the
  // skin and the lining); where a plank is broken across, a ragged end of splinters of its own
  // lengths, some bent out or in, its broken grain pale
  for (const side of [-1, 1]) {
    const m = mask[side > 0 ? 1 : 0];
    const cut = (i, j) => i >= 0 && i < NV && j >= 0 && j < NT && m[i * NT + j];
    const out = Wd(side, 0, 0);
    for (let i = 0; i < NV; i++) for (let j = 0; j < NT; j++) {
      if (m[i * NT + j]) continue;
      for (const [di, dj] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        if (!cut(i + di, j + dj)) continue;
        if (dj === 0) {
          const e = di === 1 ? [[i + 1, j], [i + 1, j + 1]] : [[i, j], [i, j + 1]];
          const A = hullAt(side, 0, ...e[0]), Bq = hullAt(side, 0, ...e[1]), Ai = hullAt(side, 1, ...e[0]), Bi = hullAt(side, 1, ...e[1]);
          const c0 = hullAt(side, 0, i + 0.5, j + 0.5), c1 = hullAt(side, 0, i + 0.5 + di, j + 0.5);
          const n = [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]];
          w.paint(RAW);
          const v0 = w.count;
          for (const Q of [A, Bq, Bi, Ai]) w.vert(Q[0], Q[1], Q[2], n[0], n[1], n[2], 0, 0, Q[1] * 2.0 + side, (j / NT - 0.5) * L, 0.85, 0);
          triFacing(w, v0, v0 + 1, v0 + 2, n[0], n[1], n[2]); triFacing(w, v0, v0 + 2, v0 + 3, n[0], n[1], n[2]);
          continue;
        }
        // the broken end: five points across the plank, each splinter its own length
        const jj = dj === 1 ? j + 1 : j, hs = (a) => hashN(i * 7.13 + jj * 3.71 + a * 1.37, side * 2.3 + 5.1);
        const reach = 0.25 + 0.95 * hs(1), bend = hs(2) < 0.3 ? (hs(3) - 0.5) * 0.9 : 0;
        const vs = [0, 0.18 + 0.1 * hs(4), 0.45 + 0.1 * hs(5), 0.7 + 0.1 * hs(6), 1];
        const ext = [0.08 * hs(7), reach * (0.55 + 0.45 * hs(8)), reach * (0.1 + 0.3 * hs(9)), reach * (0.4 + 0.6 * hs(10)), 0.1 * hs(11)];
        const at = (layer, k, e) => {
          const Q = hullAt(side, layer, i + vs[k], jj + dj * e);
          const b = bend * e * (L / NT);
          return [Q[0] + out[0] * b, Q[1] + out[1] * b, Q[2] + out[2] * b];
        };
        for (const layer of [0, 1]) {
          if (layer) paintIn(INNER); else w.paint(DARK);
          const v0 = w.count, nrm = layer ? out.map((c) => -c) : out;
          for (let kq = 0; kq < 5; kq++) for (const e of [0, ext[kq]]) {
            const Q = at(layer, kq, e);
            w.vert(Q[0], Q[1], Q[2], nrm[0], nrm[1], nrm[2], 0, 0, i * 0.235 + vs[kq] * 0.235, ((jj + dj * e) / NT - 0.5) * L, 1, 2);
          }
          for (let kq = 0; kq < 4; kq++) { const a = v0 + kq * 2; triFacing(w, a, a + 2, a + 1, nrm[0], nrm[1], nrm[2]); triFacing(w, a + 1, a + 2, a + 3, nrm[0], nrm[1], nrm[2]); }
        }
        // the splinters' broken grain, between the skin and the lining, round the jagged end
        w.paint(RAW);
        for (let kq = 0; kq < 4; kq++) {
          const A = at(0, kq, ext[kq]), Bq = at(0, kq + 1, ext[kq + 1]), Ai = at(1, kq, ext[kq]), Bi = at(1, kq + 1, ext[kq + 1]);
          const mid = at(0, kq, ext[kq] + 0.3), n = [(mid[0] - A[0]), (mid[1] - A[1]), (mid[2] - A[2])];
          const v0 = w.count;
          for (const Q of [A, Bq, Bi, Ai]) w.vert(Q[0], Q[1], Q[2], n[0], n[1], n[2], 0, 0, Q[1] * 2.0 + side, (jj / NT - 0.5) * L, 0.85, 0);
          triFacing(w, v0, v0 + 1, v0 + 2, n[0], n[1], n[2]); triFacing(w, v0, v0 + 2, v0 + 3, n[0], n[1], n[2]);
        }
      }
    }
  }
  // the ship's ribs where its side is breached amidships: bent timbers inside the planking,
  // crossing the hole (two broken off), and the far side's showing through it, dark
  {
    const h = holes[1];
    paintIn([0.30, 0.21, 0.14]);
    for (let kr = -3; kr <= 3; kr++) {
      const t = h.t + kr * (0.6 / L), broken = kr === -1 || kr === 2;
      for (const sd of [h.side, -h.side]) {
        const pts = [], top = (deckAt(t) - keelAt(t)) / (topAt(t) - keelAt(t));
        const v1 = broken && sd === h.side ? (h.y - 0.25 - keelAt(t)) / (topAt(t) - keelAt(t)) : top * 0.98;
        for (let kv = 0; kv <= 10; kv++) {
          const v = lerp(0.04, v1, kv / 10), [x, yy] = sect(t, v, 0.22);
          pts.push([...W(sd * x, yy, (t - 0.5) * L), 0.085]);
        }
        sweep(w, pts, 5, { caps: true, aux: (kk, j, x, y2, z, o) => { o[0] = j / 5 * 0.3; o[1] = kk * 0.3; o[2] = 0.45; o[3] = 1; } });
      }
    }
  }
  // the wales: thick timbers along the sides, following the sheer
  w.paint([0.34, 0.26, 0.19]);
  for (const side of [-1, 1]) for (const v of [0.52, 0.64]) {
    let run = [];
    const flush = () => { if (run.length > 1) sweep(w, run, 6, { caps: true, aux: (kk, j, x, yy, z, o) => { o[0] = j / 6 * 0.3; o[1] = kk * 0.6; o[2] = 1; o[3] = 1; } }); run = []; };
    for (let j = 1; j <= NT - 2; j++) {
      const i = v * NV, ii = Math.floor(i);
      if (mask[side > 0 ? 1 : 0][Math.min(ii, NV - 1) * NT + Math.min(j, NT - 1)] || mask[side > 0 ? 1 : 0][Math.min(ii, NV - 1) * NT + Math.max(j - 1, 0)]) { flush(); continue; }
      const t = j / NT, [x, yy] = sect(t, v), Q = W(side * (x + 0.06), yy, (t - 0.5) * L);
      run.push([Q[0], Q[1], Q[2], 0.09]);
    }
    flush();
  }

  // ---- the transom: planked, round across and raked, its top arched; a gallery of four small
  // windows between carved rails and pilasters (two lit warm from the cabin, two dark), a
  // carved shell on the crest of the taffrail and a scroll at each of its corners
  const arch = (xx, hx) => 0.42 * Math.max(0, 1 - (xx / Math.max(hx, 0.1)) ** 2);
  {
    const base = w.count, cols = 16, rows = 16;
    const rowAt = (v, j, inset) => {
      const [hx, yy0] = sect(0, v, inset), xx = hx * (j / cols * 2 - 1);
      return [xx, yy0 + arch(xx, hx) * smoothN(0.82, 1.0, v), hx];
    };
    w.paint(DARK);
    for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) {
      const [xx, yy] = rowAt(i / rows, j, 0), Pp = W(xx, yy, tz(yy, xx));
      w.vert(Pp[0], Pp[1], Pp[2], 0, 1, 0, 0, 0, yy, xx + 5.0, 1, 2);
    }
    const i0 = w.i.length, Nb = Wd(0, 0, -1);
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const a = base + i * (cols + 1) + j; triFacing(w, a, a + 1, a + cols + 1, Nb[0], Nb[1], Nb[2]); triFacing(w, a + 1, a + cols + 2, a + cols + 1, Nb[0], Nb[1], Nb[2]); }
    w.normals(base, w.count, i0, null);
    // its face toward the cabin, a hand's breadth inside
    {
      const b2 = w.count, Nf = Wd(0, 0, 1);
      paintIn(INNER);
      for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) {
        const [xx, yy] = rowAt(i / rows, j, 0.14), Pp = W(xx, yy, tz(yy, xx) + 0.05);
        w.vert(Pp[0], Pp[1], Pp[2], 0, 1, 0, 0, 0, yy, xx + 5.0, 1, 2);
      }
      const i1 = w.i.length;
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const a = b2 + i * (cols + 1) + j; triFacing(w, a, a + 1, a + cols + 1, Nf[0], Nf[1], Nf[2]); triFacing(w, a + 1, a + cols + 2, a + cols + 1, Nf[0], Nf[1], Nf[2]); }
      w.normals(b2, w.count, i1, null);
    }
    // the carved rails under and over the gallery, following the transom's curve; the
    // taffrail along its arched top
    const wy = cab.floor + 1.55, CARVE = [0.58, 0.44, 0.24];
    const rail = (yAt, rad, col) => {
      w.paint(col);
      const pts = [];
      for (let j = 0; j <= 16; j++) {
        const yy0 = yAt(0), hx = sect(0, clampN((yy0 - yk0) / (yt0 - yk0), 0, 1))[0] + 0.03, xx = (j / 16 * 2 - 1) * hx, yy = yAt(xx / hx);
        pts.push([...W(xx, yy, tz(yy, xx) - 0.06), rad]);
      }
      sweep(w, pts, 6, { caps: true, aux: (kk, j, x, y2, z, o) => { o[0] = j / 6; o[1] = kk * 0.4; o[2] = 1; o[3] = 1; } });
    };
    rail(() => wy - 0.36, 0.07, CARVE); rail(() => wy - 0.47, 0.05, [0.25, 0.18, 0.12]);
    rail(() => wy + 0.36, 0.07, CARVE);
    rail((u) => yt0 + 0.42 * Math.max(0, 1 - u * u) - 0.04, 0.1, [0.25, 0.18, 0.12]);
    // the windows: small, four across, square-topped with a rounded head; lit warm, or dark
    const outline = (cx, cy, wd, ht, n) => {
      const pts = [], rr = wd / 2, straight = ht - rr * 0.6;
      pts.push([cx - rr, cy - ht / 2]); pts.push([cx + rr, cy - ht / 2]);
      for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI; pts.push([cx + Math.cos(a) * rr, cy - ht / 2 + straight + Math.sin(a) * rr * 0.6]); }
      return pts;
    };
    const WX = [-1.42, -0.48, 0.48, 1.42];
    WX.forEach((wx, wi) => {
      const lit = wi === 1 || wi === 3;
      const ol = outline(wx, wy, 0.34, 0.46, 6);
      const g0 = gl.count;
      gl.paint([1, 1, 1, lit ? 1 : 0.5]);
      const Q0 = W(wx, wy - 0.03, tz(wy, wx) - 0.025);
      gl.vert(Q0[0], Q0[1], Q0[2], Nb[0], Nb[1], Nb[2], 0, 0, 0, 0, 0, 0);
      for (const [px, py] of ol) { const Q = W(px, py, tz(py, px) - 0.025); gl.vert(Q[0], Q[1], Q[2], Nb[0], Nb[1], Nb[2], 0, 0, (px - wx) / 0.17, (py - wy) / 0.23, 0, 0); }
      for (let i = 0; i < ol.length; i++) triFacing(gl, g0, g0 + 1 + i, g0 + 1 + ((i + 1) % ol.length), Nb[0], Nb[1], Nb[2]);
      // the frame round it, carved; a mullion and a bar
      w.paint([0.22, 0.16, 0.11]);
      sweep(w, ol.map(([px, py]) => [...W(px, py, tz(py, px) - 0.05), 0.04]), 5, { closed: true, aux: (kk, j, x, y2, z, o) => { o[0] = j / 5; o[1] = kk * 0.2; o[2] = 1; o[3] = 1; } });
      const ztop = wy + 0.21;
      sweep(w, [[...W(wx, wy - 0.23, tz(wy, wx) - 0.04), 0.014], [...W(wx, ztop, tz(ztop, wx) - 0.04), 0.014]], 4, { aux: (kk, j, x, y2, z, o) => { o[0] = j / 4; o[1] = y2; o[2] = 1; o[3] = 1; } });
      sweep(w, [[...W(wx - 0.17, wy + 0.02, tz(wy, wx - 0.17) - 0.04), 0.014], [...W(wx + 0.17, wy + 0.02, tz(wy, wx + 0.17) - 0.04), 0.014]], 4, { aux: (kk, j, x, y2, z, o) => { o[0] = j / 4; o[1] = kk; o[2] = 1; o[3] = 1; } });
    });
    // pilasters between the windows, half-round, carved, with a knob at each end
    w.paint(CARVE);
    for (const px of [-1.9, -0.95, 0, 0.95, 1.9]) {
      const y0 = wy - 0.33, y1 = wy + 0.33;
      sweep(w, [[...W(px, y0, tz(y0, px) - 0.07), 0.045], [...W(px, (y0 + y1) / 2, tz(wy, px) - 0.09), 0.055], [...W(px, y1, tz(y1, px) - 0.07), 0.045]], 6, { caps: true, aux: (kk, j, x, y2, z, o) => { o[0] = j / 6; o[1] = y2 * 2; o[2] = 1; o[3] = 1; } });
    }
    // the carved shell on the taffrail's crest: ribs fanning up from a boss
    {
      const c = [0, yt0 + 0.3], R0 = 0.5;
      for (let kf = 0; kf <= 8; kf++) {
        const a = Math.PI * (0.08 + 0.84 * kf / 8), pts = [];
        for (let s2 = 0; s2 <= 4; s2++) {
          const r2 = 0.08 + (R0 - 0.08) * s2 / 4, xx = c[0] + Math.cos(a) * r2, yy = c[1] + Math.sin(a) * r2 * 0.85;
          pts.push([...W(xx, yy, tz(yy, xx) - 0.12 - 0.05 * Math.sin(Math.PI * s2 / 4)), 0.03 + 0.025 * s2 / 4]);
        }
        sweep(w, pts, 5, { caps: true, aux: (kk, j, x, y2, z, o) => { o[0] = j / 5; o[1] = kk * 0.3; o[2] = 1; o[3] = 1; } });
      }
      const boss = W(0, c[1], tz(c[1], 0) - 0.14);
      ball(w, boss[0], boss[1], boss[2], () => 0.09, 4, (dx, dy, dz, o) => { o[0] = dx; o[1] = dy; o[2] = 1; o[3] = 1; });
    }
    // a scroll at each upper corner, rolled toward the middle
    for (const sx of [-1, 1]) {
      const hx = sect(0, 0.97)[0], cx = sx * (hx - 0.3), cy = yt0 - 0.35, pts = [];
      for (let kq = 0; kq <= 22; kq++) {
        const u = kq / 22, a = -Math.PI / 2 + sx * u * 1.6 * TAU, r2 = 0.3 * (1 - 0.8 * u);
        const xx = cx - sx * Math.cos(a) * r2 * sx, yy = cy + Math.sin(a) * r2;
        pts.push([...W(xx, yy, tz(yy, xx) - 0.09), 0.055 * (1 - 0.5 * u)]);
      }
      sweep(w, pts, 5, { caps: true, aux: (kk, j, x, y2, z, o) => { o[0] = j / 5; o[1] = kk * 0.1; o[2] = 1; o[3] = 1; } });
    }
  }

  // ---- decks: the main deck runs the length (it is the cabin's floor under the castle), the
  // castle deck over the cabin, the forecastle's; their stern ends meet the transom
  const deck = (t0, t1, yAt, inset, col, faceUp = 1, stern = false, inner = (t) => false) => {
    const base = w.count, n = 28, N = Wd(0, faceUp, 0);
    for (let jj = 0; jj <= n; jj++) {
      const t = t0 + (t1 - t0) * (jj / n), yy = yAt(t);
      if (inner(t)) paintIn(col); else w.paint(col);
      const hx = sect(t, clampN((yy - keelAt(t)) / Math.max(topAt(t) - keelAt(t), 0.1), 0, 1))[0] - inset;
      for (const sd of [-1, 1]) {
        const xx = sd * Math.max(hx, 0.05), zz = jj === 0 && stern ? tz(yy, xx) + 0.03 : (t - 0.5) * L, Pp = W(xx, yy, zz);
        w.vert(Pp[0], Pp[1], Pp[2], N[0], N[1], N[2], 0, 0, xx, zz, 1, 2);
      }
    }
    for (let jj = 0; jj < n; jj++) { const a = base + jj * 2; triFacing(w, a, a + 1, a + 2, N[0], N[1], N[2]); triFacing(w, a + 1, a + 3, a + 2, N[0], N[1], N[2]); }
  };
  deck(0, 0.985, deckAt, 0.12, DECK, 1, true, (t) => t < castleT);
  deck(0, castleT, () => castleY, 0.12, DECK, 1, true);
  deck(0, castleT, () => castleY - 0.12, 0.12, INNER, -1, true, () => true);
  deck(fcT, 0.975, () => fcY, 0.15, DECK);
  // the castle's front wall, following the hull, with a doorway into the cabin
  {
    const t = castleT, z = (t - 0.5) * L, y0 = deckAt(t) - 0.02, y1 = castleY + 0.02, N = Wd(0, 0, 1);
    const yk = keelAt(t - 0.02), yt = topAt(t - 0.02);
    const xm = (yy) => sect(t - 0.02, clampN((yy - yk) / (yt - yk), 0, 1), 0.07)[0];
    const cols = 12, rows = 6;
    for (const face of [0, 1]) {
      const base = w.count, dz = face ? -0.05 : 0.0;
      if (face) paintIn(INNER); else w.paint(DECK);
      for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) {
        const yy = lerp(y0, y1, i / rows), xx = (j / cols * 2 - 1) * xm(yy), Q = W(xx, yy, z + dz);
        w.vert(Q[0], Q[1], Q[2], N[0], N[1], N[2], 0, 0, xx + 3.0, yy, 1, 2);
      }
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
        const yc = lerp(y0, y1, (i + 0.5) / rows), xc = ((j + 0.5) / cols * 2 - 1) * xm(yc);
        if (Math.abs(xc) < 0.5 && yc < y0 + 1.95) continue;
        const a = base + i * (cols + 1) + j;
        triFacing(w, a, a + 1, a + cols + 1, N[0], N[1], N[2]); triFacing(w, a + 1, a + cols + 2, a + cols + 1, N[0], N[1], N[2]);
      }
    }
    paintIn([0.30, 0.21, 0.14]);
    for (const sx of [-0.52, 0.52]) timber(w, W(sx, y0, z), W(sx, y0 + 2.05, z), 0.14, 0.18, Wd(0, 0, 1), 0.03);
    timber(w, W(-0.62, y0 + 2.02, z), W(0.62, y0 + 2.02, z), 0.16, 0.18, Wd(0, 0, 1), 0.03);
  }
  // keel, stem, sternpost and the rudder hung on it
  w.paint(DARK);
  { const pts = []; for (let j = 0; j <= 12; j++) { const t = 0.02 + 0.84 * (j / 12); const Q = W(0, keelAt(t) - 0.12, (t - 0.5) * L); pts.push([Q[0], Q[1], Q[2], 0.2]); } sweep(w, pts, 6, { caps: true, aux: (kk, j, x, yy, z, o) => { o[0] = j / 6; o[1] = kk; o[2] = 1; o[3] = 1; } }); }
  { const pts = []; for (let j = 0; j <= 10; j++) { const t = 0.86 + 0.14 * (j / 10); const yy = lerp(keelAt(t), fcY + 0.5, Math.pow(j / 10, 1.5)); const Q = W(0, yy, (t - 0.5) * L + 0.1); pts.push([Q[0], Q[1], Q[2], 0.16]); } sweep(w, pts, 6, { caps: true, aux: (kk, j, x, yy, z, o) => { o[0] = j / 6; o[1] = kk; o[2] = 1; o[3] = 1; } }); }
  timber(w, W(0, yk0 - 0.05, tz(yk0, 0) - 0.05), W(0, deckAt(0) + 0.5, tz(deckAt(0), 0) - 0.12), 0.2, 0.22, Wd(0, 0, 1), 0.05);
  {
    const ra = 0.32, cr = Math.cos(ra), sr = Math.sin(ra), ya = yk0 + 0.3, yb = deckAt(0) - 0.2;
    timber(w, W(-sr * 0.42, ya, tz(ya, 0) - 0.15 - cr * 0.42), W(-sr * 0.42, yb, tz(yb, 0) - 0.15 - cr * 0.42), 0.15, 0.85, Wd(-sr, 0, -cr), 0.05);
  }
  // beams across under the castle deck, posts at the cabin's walls, rails round the castle
  paintIn([0.36, 0.25, 0.16]);
  for (const t of [0.04, 0.1, 0.16, 0.22]) { const hx = sect(t, 0.9)[0] - 0.12; timber(w, W(-hx, castleY - 0.22, (t - 0.5) * L), W(hx, castleY - 0.22, (t - 0.5) * L), 0.16, 0.2, Wd(0, 1, 0), 0.04); }
  const posts = [];
  for (const [t, sides] of [[tOf(-10.0), [1]], [tOf(-5.83), [1]], [0.02, [-1, 1]], [castleT - 0.005, [-1, 1]]]) {
    for (const sd of sides) {
      const yA = deckAt(t), hx = sect(t, (yA + 1.3 - keelAt(t)) / (topAt(t) - keelAt(t)))[0] - 0.24;
      const zz = t <= 0.03 ? tz(yA + 1.2, hx) + 0.14 : (t - 0.5) * L;
      timber(w, W(sd * hx, yA - 0.02, zz), W(sd * (hx - 0.06), castleY - 0.15, zz), 0.2, 0.2, Wd(1, 0, 0), 0.04);
      posts.push(W(sd * hx, yA + 1.7, zz));
    }
  }
  w.paint(DARK);
  {
    const rail = (pts) => { sweep(w, pts.map((p) => [...p, 0.06]), 6, { caps: true, aux: (kk, j, x, yy, z, o) => { o[0] = j / 6; o[1] = kk * 0.5; o[2] = 1; o[3] = 1; } }); };
    for (const sd of [-1, 1]) {
      const top = [];
      for (let j = 0; j <= 8; j++) { const t = 0.01 + (castleT - 0.02) * (j / 8), hx = sect(t, 1)[0] - 0.06; top.push(W(sd * hx, castleY + 0.95, (t - 0.5) * L)); }
      rail(top);
      for (let j = 0; j <= 8; j++) { const t = 0.01 + (castleT - 0.02) * (j / 8), hx = sect(t, 1)[0] - 0.06; sweep(w, [[...W(sd * hx, castleY, (t - 0.5) * L), 0.045], [...W(sd * hx, castleY + 0.95, (t - 0.5) * L), 0.045]], 5, { aux: (kk, j2, x, yy, z, o) => { o[0] = j2 / 5; o[1] = yy; o[2] = 1; o[3] = 1; } }); }
      // the waist's rail, broken in places
      const waist = [];
      for (let j = 0; j <= 14; j++) {
        const t = castleT + 0.03 + (fcT - castleT - 0.06) * (j / 14), hx = sect(t, 1)[0] - 0.05;
        if (sd < 0 && t > 0.47 && t < 0.6) { if (waist.length > 1) rail(waist); waist.length = 0; continue; }
        waist.push(W(sd * hx, topAt(t) + 0.04, (t - 0.5) * L));
      }
      if (waist.length > 1) rail(waist);
    }
  }
  // masts, broken; yards askew; tops; the bowsprit
  const mast = (t, h, r0, broken, foot) => {
    w.paint([0.50, 0.40, 0.30]);
    const base = W(0, foot, (t - 0.5) * L), top = W(0.18 * rng.bell(), deckAt(t) + h, (t - 0.5) * L + 0.3 * rng.bell());
    const pts = [[...base, r0], [...W(0, (foot + deckAt(t) + h) * 0.5, (t - 0.5) * L), r0 * 0.9], [...top, r0 * 0.78]];
    sweep(w, pts, 9, { caps: !broken, aux: (kk, j, x, yy, z, o) => { o[0] = j / 9 * 0.5; o[1] = yy; o[2] = 1; o[3] = 1; } });
    if (broken) {
      // the break: a jagged crown of splinters
      w.paint(RAW);
      for (let s = 0; s < 7; s++) {
        const a = (s / 7) * TAU + rng() * 0.4, rr2 = r0 * 0.74, hgt = r0 * (0.6 + 1.6 * rng());
        const p0 = [top[0] + Math.cos(a) * rr2, top[1], top[2] + Math.sin(a) * rr2], p1 = [top[0] + Math.cos(a + 0.9) * rr2, top[1], top[2] + Math.sin(a + 0.9) * rr2];
        const tip = [top[0] + Math.cos(a + 0.45) * rr2 * 0.6, top[1] + hgt, top[2] + Math.sin(a + 0.45) * rr2 * 0.6];
        const v0 = w.count; for (const Q of [p0, p1, tip]) w.vert(Q[0], Q[1], Q[2], Math.cos(a + 0.45), 0.2, Math.sin(a + 0.45), 0, 0, Q[1] * 3, s, 1, 0);
        triFacing(w, v0, v0 + 1, v0 + 2, Math.cos(a + 0.45), 0.2, Math.sin(a + 0.45));
      }
      disc(w, top[0], top[1], top[2], r0 * 0.75, 9, 1, [0, 0, 1, 0]);
    }
    return top;
  };
  const fore = mast(0.74, 10.5, 0.2, false, deckAt(0.74) - 1.5), main = mast(0.5, 7.2, 0.23, true, deckAt(0.5) - 1.5), mizz = mast(0.09, castleY - deckAt(0.09) + 3.2, 0.16, true, castleY);
  // the fore top: a round platform
  { const tp = [fore[0], fore[1] - 2.6, fore[2]]; sweep(w, [[tp[0], tp[1] - 0.06, tp[2], 0.75], [tp[0], tp[1] + 0.06, tp[2], 0.8]], 14, { caps: true, aux: (kk, j, x, yy, z, o) => { o[0] = x; o[1] = z; o[2] = 1; o[3] = 1; } }); }
  const yard = (at, len, tiltA, tiltB) => { const a = [at[0] + P[0] * len * Math.cos(tiltA), at[1] + len * Math.sin(tiltB), at[2] + P[2] * len * Math.cos(tiltA)], bb = [at[0] - P[0] * len * Math.cos(tiltA), at[1] - len * Math.sin(tiltB), at[2] - P[2] * len * Math.cos(tiltA)]; sweep(w, [[...a, 0.08], [...at, 0.11], [...bb, 0.08]], 7, { caps: true, aux: (kk, j, x, yy, z, o) => { o[0] = j / 7; o[1] = kk; o[2] = 1; o[3] = 1; } }); return [a, bb]; };
  const y1 = yard([fore[0], fore[1] - 1.4, fore[2]], 3.6, 0.2, 0.16);
  const y0 = yard([fore[0], fore[1] - 3.6, fore[2]], 4.2, 0.1, -0.05);
  const y2 = yard([main[0], main[1] - 1.0, main[2]], 2.8, 0.35, -0.42);
  { const s0 = W(0, fcY + 0.3, L / 2 - 0.6), s1 = W(0, fcY + 2.1, L / 2 + 4.8); sweep(w, [[...s0, 0.18], [...s1, 0.1]], 8, { caps: true, aux: (kk, j, x, yy, z, o) => { o[0] = j / 8; o[1] = kk * 5; o[2] = 1; o[3] = 1; } }); }
  // rigging: stays, slack and broken; shrouds from the rails to the masts, with ratlines
  r.paint([0.60, 0.54, 0.42]);
  hangRope(r, W(0, fcY + 2.0, L / 2 + 4.5), [fore[0], fore[1] - 0.2, fore[2]], 0.022, 0.6, 16);
  hangRope(r, y1[0], W(-hbAt(0.7) * 0.95, topAt(0.7), 0.7 * L - L / 2), 0.02, 0.4, 14);
  hangRope(r, y1[1], W(hbAt(0.7) * 0.95, topAt(0.7), 0.7 * L - L / 2), 0.02, 0.4, 14);
  hangRope(r, y2[0], [y2[0][0] + 0.3, y2[0][1] - 2.8, y2[0][2] + 0.2], 0.02, 0.05, 8);
  hangRope(r, [mizz[0], mizz[1] - 0.3, mizz[2]], W(hbAt(0.15) * 0.9, castleY + 0.95, -0.35 * L), 0.02, 0.5, 12);
  const shrouds = (t, top, n, slack) => {
    for (const sd of [-1, 1]) {
      const feet = [], heads = [];
      for (let s = 0; s < n; s++) {
        const ts = t - 0.035 + 0.03 * s, hx = sect(ts, 1)[0] + 0.12;
        const foot = W(sd * hx, topAt(ts) - 0.2, (ts - 0.5) * L), head = [top[0] + Wd(sd, 0, 0)[0] * 0.15, top[1], top[2] + Wd(sd, 0, 0)[2] * 0.15];
        feet.push(foot); heads.push(head);
        hangRope(r, foot, head, 0.022, slack ? 0.25 + 0.3 * s : 0.04, 12);
      }
      // ratlines between the shrouds, every 0.42 m up
      const lenS = Math.hypot(heads[0][0] - feet[0][0], heads[0][1] - feet[0][1], heads[0][2] - feet[0][2]), nr = Math.floor(lenS * 0.82 / 0.42);
      for (let k2 = 1; k2 <= nr; k2++) {
        const u = k2 / (nr + 2);
        if (slack && rng() < 0.3) continue;
        const pts = feet.map((f2, s) => [lerp(f2[0], heads[s][0], u), lerp(f2[1], heads[s][1], u) - (slack ? (0.25 + 0.3 * s) * 4 * u * (1 - u) : 0), lerp(f2[2], heads[s][2], u)]);
        hangRope(r, pts[0], pts[pts.length - 1], 0.014, 0.03, 4);
      }
    }
  };
  shrouds(0.74, [fore[0], fore[1] - 2.7, fore[2]], 3, false);
  shrouds(0.5, [main[0], main[1] - 0.6, main[2]], 3, true);

  // ---- barnacles: raised crochet cones in close clusters, white, on the hull low down by the
  // sand, along the wales, round the breach, on the stern; on the masts' stumps and the
  // cabin's posts
  y.paint([0.95, 0.93, 0.87], [0.86, 0.84, 0.78]);
  const brng = makeRng(2469);
  const cluster = (Pp, n, sz, nrm) => {
    for (let kk = 0; kk < n; kk++) {
      const o2 = [brng.bell() * sz * 3.0, brng.bell() * sz * 3.0, brng.bell() * sz * 3.0];
      const d = o2[0] * nrm[0] + o2[1] * nrm[1] + o2[2] * nrm[2];
      barnacle(y, [Pp[0] + o2[0] - nrm[0] * d, Pp[1] + o2[1] - nrm[1] * d, Pp[2] + o2[2] - nrm[2] * d], nrm, sz * brng.range(0.55, 1.3), brng() * 9);
    }
  };
  const onHull = (side, t, v, n, sz) => {
    const i = Math.floor(v * NV), j = Math.floor(t * NT);
    if (i < 0 || i >= NV || j < 0 || j >= NT || mask[side > 0 ? 1 : 0][i * NT + j]) return;
    const [x, yy] = sect(t, v), Pp = W(side * (x + 0.01), yy, (t - 0.5) * L);
    cluster(Pp, n, sz, Wd(side, 0.3, 0).map((vv) => vv / Math.hypot(1, 0.3)));
  };
  for (let kk = 0; kk < (hi ? 26 : 16); kk++) {
    const side = brng() < 0.75 ? -1 : 1, t = brng.range(0.08, 0.92), band = brng();
    // (low by the sand, along the wales, or anywhere between)
    const v = band < 0.45 ? brng.range(0.18, 0.3) : band < 0.75 ? brng.range(0.5, 0.66) : brng.range(0.3, 0.5);
    onHull(side, t, v, 6 + Math.floor(brng() * 8), 0.105);
  }
  // round the breach
  { const h = holes[1]; for (const [dt, dv] of [[-1.25, 0.3], [1.2, -0.2], [-0.5, -1.1], [0.6, 1.15], [1.35, 0.8]]) { const v = (h.y + dv * h.hy - keelAt(h.t)) / (topAt(h.t) - keelAt(h.t)); onHull(h.side, h.t + dt * h.ht, v, 7, 0.1); } }
  // on the stern, by its corners and under the gallery
  for (const [xx, yy] of [[-1.9, cab.floor + 0.45], [1.75, cab.floor + 0.6], [0.2, cab.floor + 0.9]]) {
    const Pp = W(xx, yy, tz(yy, xx) - 0.02);
    cluster(Pp, 8, 0.1, Wd(0, 0.2, -1).map((vv) => vv / Math.hypot(1, 0.2)));
  }
  for (const Pp of [main, mizz]) cluster([Pp[0], Pp[1] - 0.5, Pp[2]], 6, 0.07, [P[0], 0.2, P[2]].map((vv) => vv / Math.hypot(1, 0.2)));
  for (const Pp of posts) cluster(Pp, 3, 0.055, [-P[0], 0, -P[2]]);

  // ---- felt weed: long soft ribbons hanging from the yards, the shrouds and the rails, the
  // current lifting them a little; in the cabin, blades growing from the drifted sand
  const ribbons = [];
  const ribbon = (A, len, wid, seed, up = -1, curl = 0.6) => {
    const v0 = k.count, n = hi ? 12 : 8, twist = rng.range(-1.2, 1.2), lean = [rng.bell() * 0.4 + 0.25, rng.bell() * 0.3];
    k.paint(rng() < 0.5 ? [0.44, 0.53, 0.36] : [0.54, 0.60, 0.40], [0.68, 0.72, 0.52]);
    for (let i = 0; i <= n; i++) {
      const t = i / n, s = t * len, ang = twist * t;
      const cx = A[0] + lean[0] * s * t * curl + Math.sin(t * 5 + seed * 6) * 0.08 * s, cyy = A[1] + up * s * (1 - 0.25 * t * curl), czz = A[2] + lean[1] * s * t + Math.cos(t * 4 + seed * 5) * 0.08 * s;
      const wd = wid * (0.55 + 0.6 * Math.sin(Math.PI * Math.min(t * 1.2 + 0.1, 1))) * (1 + 0.15 * Math.sin(t * 13 + seed * 4));
      for (const sx of [-1, 1]) k.vert(cx + sx * wd * 0.5 * Math.cos(ang), cyy, czz + sx * wd * 0.5 * Math.sin(ang), 0, 0, 1, 0, 0, s, sx, seed, 1);
    }
    for (let i = 0; i < n; i++) { const a = v0 + i * 2; k.i.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    k.normals(v0, k.count, k.i.length - n * 6, null);
    ribbons.push(v0, k.count);
  };
  for (const Pp of [y1[0], y1[1], y0[0], y0[1], [fore[0], fore[1] - 2.5, fore[2]], y2[0], [main[0], main[1] - 0.8, main[2]], [mizz[0], mizz[1] - 0.4, mizz[2]]]) {
    // (the mizzen's weed is short: below it is the cabin's ceiling)
    const long = Pp[1] > mizz[1] - 1 && Math.abs(Pp[0] - mizz[0]) < 0.01 ? 1.9 : 3.8;
    for (let kk = 0; kk < 3; kk++) ribbon([Pp[0] + rng.bell() * 0.35, Pp[1] - rng() * 0.3, Pp[2] + rng.bell() * 0.35], rng.range(1.2, long), rng.range(0.16, 0.3), rng());
  }
  for (let kk = 0; kk < 8; kk++) { const t = rng.range(0.3, 0.84), sd = rng() < 0.6 ? -1 : 1; ribbon(W(sd * (sect(t, 1)[0] + 0.05), topAt(t), (t - 0.5) * L), rng.range(1.0, 2.4), rng.range(0.14, 0.24), rng(), -1, 0.3); }
  // streamers down the hull from its wales, on the camera's side, and from the stern's rails
  {
    const srng = makeRng(2470);
    for (let kk = 0; kk < (hi ? 12 : 7); kk++) {
      const t = srng.range(0.06, 0.9), v = srng() < 0.5 ? 0.64 : 0.52, i = Math.floor(v * NV), j = Math.floor(t * NT);
      if (mask[0][i * NT + j]) continue;
      const [x, yy] = sect(t, v);
      ribbon(W(-(x + 0.12), yy - 0.05, (t - 0.5) * L), srng.range(1.2, 2.6), srng.range(0.13, 0.22), srng(), -1, 0.25);
    }
    for (const xx of [-1.6, -0.2, 1.3]) { const yy = cab.floor + 1.2; ribbon(W(xx, yy, tz(yy, xx) - 0.12), srng.range(1.0, 1.8), srng.range(0.12, 0.2), srng(), -1, 0.2); }
  }

  // ---- the cabin's furnishings
  // the desk: top, legs, drawers with brass knobs; against the port wall, facing the hole
  const desk = { x: 1.25, z: cz + 0.2, y: cab.floor };
  const dX = Wd(1, 0, 0), dY = Wd(0, 1, 0), dZ = Wd(0, 0, 1);
  paintIn([0.40, 0.25, 0.15]);
  rbox(w, W(desk.x, desk.y + 0.82, desk.z), dX, dY, dZ, [0.42, 0.04, 0.85], 0.03, [1, 1, 2], (lx, ly, lz, o) => { o[0] = lx * 3; o[1] = lz; o[2] = 1; o[3] = 1; });
  for (const sx of [-0.36, 0.36]) for (const sz of [-0.76, 0.76]) rbox(w, W(desk.x + sx, desk.y + 0.39, desk.z + sz), dX, dY, dZ, [0.04, 0.39, 0.04], 0.02, [1, 2, 1], (lx, ly, lz, o) => { o[0] = lx * 4 + lz; o[1] = ly; o[2] = 1; o[3] = 1; });
  rbox(w, W(desk.x + 0.02, desk.y + 0.66, desk.z), dX, dY, dZ, [0.36, 0.12, 0.74], 0.02, [1, 1, 2], (lx, ly, lz, o) => { o[0] = ly * 3; o[1] = lz; o[2] = 0.9; o[3] = 1; });
  for (const sz of [-0.48, 0, 0.48]) {
    paintIn([0.34, 0.22, 0.13]);
    rbox(w, W(desk.x - 0.37, desk.y + 0.66, desk.z + sz), dX, dY, dZ, [0.02, 0.1, 0.2], 0.015, [1, 1, 1], (lx, ly, lz, o) => { o[0] = ly * 3; o[1] = lz; o[2] = 1; o[3] = 1; });
    const kn = W(desk.x - 0.4, desk.y + 0.66, desk.z + sz);
    ball(b, kn[0], kn[1], kn[2], () => 0.025, 2);
  }
  // on the desk: the envelope (its wax, the stamp, the chest and the lantern are the cabin's
  // loose things: zones/s4.js), a scroll, an inkwell
  {
    const top = desk.y + 0.865;
    y.paint([0.94, 0.90, 0.80], [0.94, 0.90, 0.80, 0]);
    const e = W(desk.x - 0.05, top + 0.012, desk.z - 0.25);
    rbox(y, e, dX, dY, Wd(0, 0, 1), [0.17, 0.012, 0.26], 0.008, [1, 1, 1]);
    y.paint([0.92, 0.86, 0.72], [0.92, 0.86, 0.72, 0]);
    const sc0 = W(desk.x + 0.12, top + 0.05, desk.z + 0.2), sc1 = W(desk.x + 0.12, top + 0.05, desk.z + 0.62);
    sweep(y, [[...sc0, 0.05], [...sc1, 0.05]], 10, { caps: true });
    const st = W(desk.x - 0.15, top, desk.z + 0.32);
    gl.paint([1, 1, 1, 0]);
    sweep(gl, [[st[0] + 0.02, st[1], st[2] + 0.5, 0.045], [st[0] + 0.02, st[1] + 0.09, st[2] + 0.5, 0.04]], 10, { caps: true, aux: (kk, j, x, yy, z, o) => { o[0] = 0; o[1] = 0; o[2] = 0; o[3] = 3; } });
  }
  // portholes in the back (port) wall: thick brass rings, bolts, glass that shows the water
  for (const zz of [-9.3, -6.5]) {
    const t = tOf(zz), yy = cab.floor + 1.5, [x] = sect(t, (yy - keelAt(t)) / (topAt(t) - keelAt(t)));
    const n = Wd(1, 0, 0), u = Wd(0, 1, 0), v2 = Wd(0, 0, 1);
    b.paint([0.8, 1, 1, 0]);
    for (const [xx, sgn] of [[x + 0.025, 1], [x - 0.175, -1]]) {
      const c = W(xx, yy, zz), ring = [], lip = [];
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * TAU, ca = Math.cos(a), sa = Math.sin(a);
        ring.push([c[0] + (u[0] * ca + v2[0] * sa) * 0.27, c[1] + (u[1] * ca + v2[1] * sa) * 0.27, c[2] + (u[2] * ca + v2[2] * sa) * 0.27, 0.065]);
        lip.push([c[0] + (u[0] * ca + v2[0] * sa) * 0.21 - n[0] * sgn * 0.04, c[1] + (u[1] * ca + v2[1] * sa) * 0.21, c[2] + (u[2] * ca + v2[2] * sa) * 0.21 - n[2] * sgn * 0.04, 0.03]);
      }
      sweep(b, ring, 7, { closed: true, up: n });
      sweep(b, lip, 5, { closed: true, up: n });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + 0.2, ca = Math.cos(a), sa = Math.sin(a);
        ball(b, c[0] + (u[0] * ca + v2[0] * sa) * 0.27 - n[0] * sgn * 0.06, c[1] + (u[1] * ca + v2[1] * sa) * 0.27 - n[1] * sgn * 0.06, c[2] + (u[2] * ca + v2[2] * sa) * 0.27 - n[2] * sgn * 0.06, () => 0.022, 2);
      }
      const nn = n.map((vv) => vv * sgn), cc = W(xx - sgn * 0.01, yy, zz), g0 = gl.count;
      gl.paint([1, 1, 1, 0]);
      gl.vert(cc[0], cc[1], cc[2], nn[0], nn[1], nn[2], 0, 0, 0, 0, 0, 1);
      for (let i = 0; i <= 18; i++) { const a = (i / 18) * TAU; gl.vert(cc[0] + (u[0] * Math.cos(a) + v2[0] * Math.sin(a)) * 0.22, cc[1] + (u[1] * Math.cos(a) + v2[1] * Math.sin(a)) * 0.22, cc[2] + (u[2] * Math.cos(a) + v2[2] * Math.sin(a)) * 0.22, nn[0], nn[1], nn[2], 0, 0, Math.sin(a) * sgn, Math.cos(a), 0, 1); }
      for (let i = 0; i < 18; i++) triFacing(gl, g0, g0 + 1 + i, g0 + 2 + i, nn[0], nn[1], nn[2]);
    }
    b.paint([1, 1, 1, 0]);
  }
  // where the lantern hangs (on a short rope from the deck overhead, to the left of the desk's
  // middle as the camera sees it): its light is glow slot 0; the lantern itself is the cabin's
  // (zones/s4.js), so that it can swing
  const lanL = [desk.x + 0.2, castleY - 0.72, desk.z - 0.62], lan = W(...lanL);
  // drifted sand in the cabin's corners, under the broken planks: low drifts banked against
  // the wall, thinning out over the floor, combed into ripples; a few blades of felt kelp
  // growing in them by the wall. [x, z, half length across, half length along, height, which
  // way the wall is (+1 port, -1 starboard), kelp]
  const heaps = [[2.15, -10.2, 0.7, 0.75, 0.32, 1, 1], [-2.15, -10.25, 0.62, 0.68, 0.26, -1, 1], [2.25, -5.5, 0.55, 0.5, 0.2, 1, 0], [0.3, -10.5, 0.75, 0.42, 0.18, 0, 0]];
  {
    const sm = new Mesh(true), drng = makeRng(2471);
    for (const [xx, zz, rr, rz, hh, wall, kelp] of heaps) {
      const v0 = sm.count, i0 = sm.i.length, rings = 7, segs = 22;
      const ht = (r, a) => {
        const u = Math.cos(a) * r, lip = Math.pow(Math.max(0, 1 - r * r), 1.6);
        return hh * lip * (1 + 0.55 * wall * u) * (1 + 0.15 * noise3(Math.cos(a) * r * 3 + xx, Math.sin(a) * r * 3 + zz, 1.7));
      };
      const c0 = W(xx, cab.floor - 0.02 + ht(0, 0), zz);
      sm.vert(c0[0], c0[1], c0[2], 0, 1, 0, 0, 0, 0, 0, 0, 0);
      for (let kr = 1; kr <= rings; kr++) for (let j = 0; j < segs; j++) {
        const r = kr / rings, a = (j / segs) * TAU, wob = 1 + 0.18 * noise3(Math.cos(a) * 2 + xx, Math.sin(a) * 2 + zz, 4.2);
        // (banked against the wall, never through it)
        const lz = zz + Math.sin(a) * rz * r * wob, wallX = sect(tOf(lz), (cab.floor + 0.1 - keelAt(tOf(lz))) / (topAt(tOf(lz)) - keelAt(tOf(lz))), 0.24)[0];
        const lx = clampN(xx + Math.cos(a) * rr * r * wob, -wallX, wallX);
        const Q2 = W(lx, cab.floor - 0.02 + ht(r, a) - (kr === rings ? 0.02 : 0), lz);
        sm.vert(Q2[0], Q2[1], Q2[2], 0, 1, 0, 0, 0, r, 0, 0, 0);
      }
      const up = Wd(0, 1, 0);
      for (let j = 0; j < segs; j++) triFacing(sm, v0, v0 + 1 + j, v0 + 1 + ((j + 1) % segs), up[0], up[1], up[2]);
      for (let kr = 1; kr < rings; kr++) for (let j = 0; j < segs; j++) {
        const a = v0 + 1 + (kr - 1) * segs + j, b = v0 + 1 + (kr - 1) * segs + ((j + 1) % segs);
        triFacing(sm, a, a + segs, b, up[0], up[1], up[2]); triFacing(sm, b, a + segs, b + segs, up[0], up[1], up[2]);
      }
      sm.normals(v0, sm.count, i0, null);
      // kelp by the wall, leaning against it, clear of the chest and the desk
      if (kelp) for (let kk = 0; kk < 4; kk++) {
        const A = W(xx + wall * rr * drng.range(0.15, 0.45), cab.floor + hh * 0.5, zz + drng.bell() * rz * 0.6);
        k.paint(drng() < 0.5 ? [0.36, 0.46, 0.24] : [0.44, 0.50, 0.26], [0.62, 0.66, 0.38]);
        feltBlade(k, drng, A, drng.range(0.55, 1.05), drng.range(0.08, 0.12), drng(), 1, 0.15, hi ? 9 : 6);
      }
    }
    // (indoors: little of the water's light reaches it; the lantern's does)
    addMesh(ctx, sphereOf(sm.build(), 0.5), material({
      aux: true, fade: [100, 118],
      surface: (s, f) => {
        sandSurf(s, f, srgb(0.74, 0.68, 0.58));
        // ripples combed across the drift, softening toward its thin edge
        const ph = f.w.x.mul(11.0).add(f.w.z.mul(6.0)).add(texture(G.detailTex, f.w.xz.mul(0.6)).r.mul(7.0)).toVar();
        const rip = float(1).sub(smoothstep(0.75, 1.0, f.aux.x)).mul(0.55);
        s.n = normalize(s.n.add(vec3(0.18, 0.0, 0.1).mul(cos(ph)).mul(rip)));
        s.albedo = s.albedo.mul(sin(ph).mul(0.08).mul(rip).add(0.97));
        s.ao = float(0.45); s.caustic = float(0.15);
      },
    }), 118);
  }

  // ---- the meshes
  const fade = [100, 118], range = 118;
  addMesh(ctx, sphereOf(w.build(), 1), material({
    aux: true, twoSided: true, fade,
    vertex: () => tintIn(),
    surface: (s, f) => {
      woodSurf(s, f, vT.rgb, float(0.0), 0.7);
      // what grows on old wood: a little green on the faces that look up
      const Dg = texture(G.detailTex, f.w.xz.mul(0.9)).a;
      s.albedo = mix(s.albedo, srgb(0.42, 0.48, 0.32), smoothstep(0.6, 0.9, s.n.y).mul(smoothstep(0.5, 0.7, Dg)).mul(0.35));
      // inside the cabin the water's light hardly reaches: it is the lantern's, and a little
      // of the sea's blue where the planks are broken; the hold below the deck is dark
      const lc = f.w.sub(vec3(...C)).toVar();
      const lx = dot(lc, vec3(P[0] * ch, sh, P[2] * ch)), ly = dot(lc, vec3(-P[0] * sh, ch, -P[2] * sh)), lz = dot(lc, vec3(...F));
      const inside = smoothstep(-0.2, 0.2, ly.sub(cab.floor - 0.12)).mul(float(1).sub(smoothstep(-0.25, 0.05, ly.sub(castleY))))
        .mul(float(1).sub(smoothstep(-0.2, 0.2, lz.sub((castleT - 0.5) * L)))).mul(vT2.w).toVar();
      const dk = lz.mul(2 / L).toVar();
      const below = float(1).sub(smoothstep(-0.25, 0.1, ly.sub(dk.mul(dk).mul(0.45).add(D)))).mul(smoothstep(0.2, 0.6, s.n.y.negate())).mul(float(1).sub(smoothstep(-0.3, 0.0, abs(lx).sub(B * 0.44))));
      s.ao = s.ao.mul(float(1).sub(inside.mul(0.6))).mul(float(1).sub(below.mul(0.7)));
      s.caustic = float(1).sub(inside.mul(0.85));
      const gapA = W(2.4, cab.floor + 1.3, -10.5), gapB = W(2.4, cab.floor + 0.75, -5.45);
      const dA = length(f.w.sub(vec3(...gapA))), dB = length(f.w.sub(vec3(...gapB)));
      s.emis = s.emis.add(s.albedo.mul(vec3(0.16, 0.42, 0.5)).mul(exp(dA.mul(dA).mul(-0.9)).add(exp(dB.mul(dB).mul(-1.4)).mul(0.7))).mul(inside));
    },
  }), range);
  addMesh(ctx, sphereOf(r.build(), 1), material({ aux: true, fade, vertex: () => tintIn(), surface: (s, f) => ropeSurf(s, f, vT.rgb) }), range);
  // (the lantern's brass, tint.w 1, is kept bright; the rest has gone green in places)
  addMesh(ctx, sphereOf(b.build(), 0.5), material({
    aux: true, fade, vertex: () => tintIn(),
    surface: (s, f) => {
      brassSurf(s, f, float(0.5).sub(vT.w.mul(0.4)));
      s.albedo = s.albedo.mul(vT.x);
      s.emis = s.emis.add(s.albedo.mul(vec3(0.9, 0.4, 0.08)).mul(vT.w.mul(0.3)));
    },
  }), range);
  // yarn: barnacles (their mouths dark), the envelope, the seal, the scroll
  addMesh(ctx, sphereOf(y.build(), 0.5), yarnMat({
    fade, scale: 46,
    surface: (s, f) => { s.albedo = mix(s.albedo, s.albedo.mul(vec3(0.22, 0.2, 0.18)), f.aux.w); s.ao = s.ao.mul(mix(float(1), float(0.5), f.aux.w)); s.emis = s.emis.add(s.albedo.mul(0.05).mul(float(1).sub(f.aux.w))); },
  }), range);
  // felt: swaying with the current, more toward its free end
  addMesh(ctx, sphereOf(k.build(), 2), material({
    aux: true, twoSided: true, fade,
    vertex: (v) => {
      tintIn();
      const ph = G.time.mul(0.7).add(v.aux.z.mul(20.0)).sub(v.aux.x.mul(0.9)).toVar(), kk = v.aux.x.mul(v.aux.x).mul(0.05).mul(v.aux.w);
      v.P.assign(v.P.add(vec3(sin(ph).add(sin(ph.mul(2.1)).mul(0.3)), cos(ph.mul(0.7)).mul(0.15), cos(ph.mul(0.8)).mul(0.8)).mul(kk)));
    },
    surface: (s, f) => feltSurf(s, f, mix(vT.rgb, vT2.rgb, smoothstep(0.5, 3.0, f.aux.x))),
  }), range);
  // glass: the stern windows (lit from inside, warm; or dark), the portholes and the windows
  // from inside (the water's light in them), the lantern's chimney (the flame)
  addMesh(ctx, sphereOf(gl.build(), 0.5), material({
    aux: true, fade, vertex: () => tintIn(), shadow: false,
    surface: (s, f) => {
      const kind = f.aux.w, win = float(1).sub(step(0.5, kind)), port = step(0.5, kind).mul(float(1).sub(step(1.5, kind)));
      const flame = step(1.5, kind).mul(float(1).sub(step(2.5, kind))), dark = step(2.5, kind);
      const lit = vT.w;
      const rr = length(f.aux.xy);
      s.albedo = srgb(0.2, 0.26, 0.28); s.spec = float(1.2); s.gloss = float(80.0);
      // a stern window: amber where lit, a faint blue-black where broken
      const warm = mix(vec3(0.02, 0.03, 0.04), vec3(1.05, 0.55, 0.18).mul(float(1.15).sub(rr.mul(0.4))), smoothstep(0.7, 0.95, lit));
      // a porthole: the sea seen through it, brighter toward the top, a pale glint
      const sea = mix(vec3(0.10, 0.42, 0.50), vec3(0.32, 0.80, 0.86), f.aux.y.mul(0.5).add(0.5)).mul(float(1.1).sub(rr.mul(0.35)))
        .add(vec3(0.5, 0.75, 0.75).mul(smoothstep(0.12, 0.0, length(f.aux.xy.sub(vec2(-0.35, 0.45)))).mul(0.6)));
      // the flame: gold in the middle of the chimney, orange at its ends
      const fl = mix(vec3(1.55, 0.6, 0.1), vec3(0.95, 0.28, 0.04), smoothstep(0.08, 0.5, abs(f.aux.y.sub(0.45))));
      s.emis = warm.mul(win).add(sea.mul(port)).add(fl.mul(flame)).add(vec3(0.02, 0.03, 0.03).mul(dark));
    },
  }), range);
  // the lantern's light: on everything round it (slot 0; the cabin swings it, and its haze)
  G.glowPos.array[0].set(lan[0], lan[1], lan[2], 6.5);
  G.glowCol.array[0].set(1.6, 0.8, 0.3, 0);
  const deskTop = W(desk.x - 0.05, desk.y + 0.88, desk.z - 0.25);
  return {
    lantern: V(...lan), envelope: V(...deskTop), cabin: V(...W(0, cab.floor + 1.2, cz)), cabinFacing: V(...Wd(-1, 0, 0)),
    desk: { at: V(...W(desk.x, desk.y, desk.z)), x: V(...dX), y: V(...dY), z: V(...dZ) }, loose: true,
  };
}
const smoothN = (a, b, x) => { const t = clampN((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---- the vents --------------------------------------------------------------------------------

// The chimneys stand as rock already (rocks.js); here they get their fire: a few bold glowing
// cracks toward the mouth, soft-edged and never thinner than a pixel can hold (so they do not
// crawl as the camera moves), the lip of the mouth hot all round, lava among the rocks at the
// foot, a small red glow over each mouth, and grey smoke. The two biggest clusters light the
// ground round their feet (glow slots 1 and 2), close in, so the water does not fog.
// [z, off, height, radius, seed] as in rocks.js
const CHIMNEYS = [[-331, 6.5, 9, 1.5, 53], [-334, 9, 6, 1.2, 54], [-346, -7.5, 12, 1.8, 55], [-349, -10, 7, 1.3, 56], [-359, 8, 8.5, 1.5, 58], [-372, -6.5, 11, 1.7, 59], [-375, -9.5, 6.5, 1.2, 60]];
function chimneyAxis([z, off, height, radius, seed]) {
  const rng = makeRng(seed), x = centerX(z) + off, g = groundY(x, z);
  for (let i = 0; i < 7; i++) { rng(); rng(); rng(); }
  const lean = rng.range(-0.6, 0.6);
  return { x, z, g, height, radius, lean, mouth: [x + lean, g + height + radius * 0.3, z - lean * 0.5] };
}
// Cracks: the edges between cells of a 2D cellular pattern (F2 - F1), in TSL.
function cellEdge(p) {
  const ip = floor(p).toVar(), fp = fract(p).toVar();
  const f1 = float(8).toVar(), f2 = float(8).toVar();
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const c = ip.add(vec2(i, j));
    const h1 = hash3(ivec3(int(c.x), int(c.y), int(7))), h2 = hash3(ivec3(int(c.x), int(c.y), int(13)));
    const d = length(vec2(i, j).add(vec2(h1, h2).mul(0.8).add(0.1)).sub(fp));
    f2.assign(min(f2, max(f1, d)));
    f1.assign(min(f1, d));
  }
  return f2.sub(f1);
}
function buildVents(ctx, q) {
  const axes = CHIMNEYS.map(chimneyAxis);
  // the chimneys' own surfaces, copied from their rock meshes, a hair proud of them
  const pos = [], nrm = [], aux = [];
  const meshes = [];
  ctx.scene.traverse((o) => { if (o.isMesh && o.geometry.attributes.aux && o.geometry.boundingSphere && !o.geometry.isInstancedBufferGeometry) meshes.push(o); });
  axes.forEach((A, ci) => {
    const mesh = meshes.find((o) => { const c = o.geometry.boundingSphere.center; return Math.hypot(c.x - A.x, c.z - A.z) < 2.0 && o.geometry.boundingSphere.radius < 25; });
    if (!mesh) return;
    const g = mesh.geometry, P = g.attributes.position.array, N = g.attributes.normal.array, I = g.index.array;
    const keep = new Uint8Array(P.length / 3), rel = new Float32Array(P.length / 3);
    for (let v = 0; v < keep.length; v++) {
      const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
      const t = (y - A.g) / A.height;
      const ax = A.x + A.lean * clampN(t, 0, 1), az = A.z - A.lean * 0.5 * clampN(t, 0, 1);
      const env = A.radius * (1.15 + (0.34 - 1.15) * clampN(t, 0, 1)) + 1.0;
      rel[v] = t;
      keep[v] = y > A.g - 0.6 && Math.hypot(x - ax, z - az) < env ? 1 : 0;
    }
    // (how high each point is over the ground: what is buried is left out, and the glow fades
    // to nothing where the rock goes into the sand, so no hard line is drawn along it)
    const over = new Float32Array(P.length / 3);
    for (let v = 0; v < over.length; v++) over[v] = P[v * 3 + 1] - groundY(P[v * 3], P[v * 3 + 2]);
    for (let k = 0; k < I.length; k += 3) {
      const a = I[k], b = I[k + 1], c = I[k + 2];
      if (!(keep[a] && keep[b] && keep[c]) || Math.max(over[a], over[b], over[c]) < 0.06) continue;
      for (const v of [a, b, c]) {
        pos.push(P[v * 3] + N[v * 3] * 0.03, P[v * 3 + 1] + N[v * 3 + 1] * 0.03, P[v * 3 + 2] + N[v * 3 + 2] * 0.03);
        nrm.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
        aux.push(rel[v], ci, A.height, over[v]);
      }
    }
  });
  if (pos.length) {
    const geo = new (Mesh)(true).build();
    geo.setAttribute('position', toAttr(pos, 3)); geo.setAttribute('normal', toAttr(nrm, 3)); geo.setAttribute('aux', toAttr(aux, 4));
    geo.deleteAttribute('uv'); geo.setIndex(null);
    sphereOf(geo, 1);
    addMesh(ctx, geo, material({
      aux: true, additive: true, shadow: false,
      raw: (f) => {
        const t = f.aux.x;
        // three planes of cracks (side on, side on, from above), blended sharply by which way
        // the rock faces, so a face never shows a plane edge-on (that drew combs of thin
        // stripes); wobbled by the relief texture; big cells, so only a few long cracks cross
        // each chimney
        const wob = texture(G.detailTex, f.w.xz.mul(0.06).add(f.w.y.mul(0.035))).toVar();
        const pa = vec2(f.w.x, f.w.y.mul(0.55)).mul(0.62).add(wob.rg.sub(0.5).mul(0.9)), pb = vec2(f.w.z, f.w.y.mul(0.55)).mul(0.62).add(wob.gr.sub(0.5).mul(0.9));
        const pc = vec2(f.w.x, f.w.z).mul(0.62).add(wob.rg.sub(0.5).mul(0.9));
        const ea = cellEdge(pa), eb = cellEdge(pb), ec = cellEdge(pc);
        const nn = pow(abs(f.n), vec3(4.0)).toVar();
        const e = ea.mul(nn.z).add(eb.mul(nn.x)).add(ec.mul(nn.y)).div(nn.x.add(nn.y).add(nn.z).add(1e-4)).toVar();
        // the pixel's size in the pattern (from the distance and how slanting the face is, not
        // from screen derivatives, which come in two-pixel steps and dot a thin line); a crack
        // is widened to at least three of them, and dimmed by as much, so a far or slanting
        // crack is a faint soft band, not a row of sparks; seen edge-on, the rock's own outline
        // has no cracks drawn on it at all
        const ndv = abs(dot(f.n, normalize(cameraPosition.sub(f.w)))).toVar();
        const fw = f.dist.mul(0.0011).div(max(ndv, 0.2)).toVar();
        const heat = smoothstep(0.42, 0.97, t).toVar();
        const w0 = heat.mul(0.06).add(0.025), wp = max(w0, fw.mul(3.0)).toVar();
        const er = e.div(wp).toVar();
        const core = exp(er.mul(er).mul(-2.2)).mul(w0.div(wp));
        const halo = exp(e.div(wp.mul(3.0).add(0.05)).negate()).mul(0.25);
        const crack = core.add(halo.mul(0.5)).mul(heat).toVar();
        // the lip of the mouth hot all round; lava glowing among the rocks at the foot
        const lip = smoothstep(0.92, 1.0, t);
        const up = t.mul(f.aux.z).toVar();
        const lava = exp(e.div(max(float(0.11), fw.mul(3.0))).mul(-1.6)).mul(smoothstep(0.3, 0.6, wob.b));
        const foot = float(1).sub(smoothstep(0.15, 1.0, up)).mul(lava).toVar();
        const flick = sin(G.time.mul(1.7).add(f.w.y.mul(1.3)).add(f.aux.y.mul(2.1))).mul(0.1).add(0.9);
        const k = max(max(crack, lip.mul(0.55)), foot.mul(0.75)).mul(flick).mul(smoothstep(0.04, 0.4, f.aux.w)).mul(smoothstep(0.12, 0.4, ndv)).toVar();
        const col = mix(vec3(0.75, 0.10, 0.02), vec3(1.0, 0.42, 0.07), smoothstep(0.25, 0.9, k));
        return { color: col.mul(k).mul(2.0).mul(exp(SIG.mul(f.dist).negate())), alpha: float(1.0) };
      },
    }), 130, { noShadow: true });
  }
  // a small red glow over each mouth
  const mouths = [];
  for (const A of axes) mouths.push(A.mouth[0], A.mouth[1] + 0.2, A.mouth[2]);
  addMesh(ctx, halos(mouths, 1.7), material({
    additive: true, shadow: false,
    vertex: (v) => haloVertex(v, 1.7),
    raw: (f) => { const d = length(vHalo); return { color: vec3(0.9, 0.24, 0.05).mul(exp(d.mul(d).mul(-6.5)).mul(0.32)).mul(exp(SIG.mul(f.dist).negate())), alpha: float(1.0) }; },
  }), 130, { noShadow: true });
  // smoke: soft puffs rising from each mouth, lit orange from below, greying as they climb
  const per = Math.round(28 * Math.max(q.amount, 0.5)), list = [];
  const rng = makeRng(4040);
  axes.forEach((A, ci) => { for (let k = 0; k < per; k++) list.push(A.mouth[0], A.mouth[1], A.mouth[2], (k + rng()) / per, rng(), rng.range(0.7, 1.3), ci, A.height); });
  const n = list.length / 8, geo = new InstancedBufferGeometry();
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('position', toAttr([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  geo.setAttribute('normal', toAttr([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  const sa = new Float32Array(n * 4), sb = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) { sa[i * 4 + k] = list[i * 8 + k]; sb[i * 4 + k] = list[i * 8 + 4 + k]; }
  geo.setAttribute('sa', new InstancedBufferAttribute(sa, 4)); geo.setAttribute('sb', new InstancedBufferAttribute(sb, 4));
  geo.instanceCount = n;
  geo.boundingSphere = new Sphere(V(-3, -195, -353), 40);
  const SA = attribute('sa', 'vec4'), SB = attribute('sb', 'vec4');
  const vS = varyingProperty('vec4', 'v_set_smoke');
  addMesh(ctx, geo, material({
    transparent: true, shadow: false,
    vertex: (v) => {
      const age = fract(G.time.mul(0.045).mul(SB.y.mul(0.4).add(0.8)).add(SA.w)).toVar();
      const rise = age.mul(age.mul(-0.35).add(1.0)).mul(14.0);
      const sw = SB.x.mul(TAU);
      const drift = vec3(sin(age.mul(5.0).add(sw)).mul(age).mul(0.9).add(age.mul(age).mul(2.2)), rise, cos(age.mul(4.0).add(sw)).mul(age).mul(0.8));
      const at = SA.xyz.add(drift).toVar();
      const size = mix(float(0.35), float(2.8), pow(age, 0.7)).mul(SB.y.mul(0.3).add(0.85));
      const toCam = normalize(cameraPosition.sub(at)).toVar();
      const right = normalize(cross(vec3(0, 1, 0), toCam)).toVar(), upv = cross(toCam, right);
      const spin = sw.add(age.mul(1.5));
      const cs = cos(spin), sn = sin(spin);
      const qx = v.P.x.mul(cs).sub(v.P.y.mul(sn)), qy = v.P.x.mul(sn).add(v.P.y.mul(cs));
      vS.assign(vec4(qx, qy, age, SB.x));
      v.P.assign(at.add(right.mul(v.P.x.mul(size))).add(upv.mul(v.P.y.mul(size))));
    },
    raw: (f) => {
      const uvp = vS.xy, age = vS.z;
      const r2 = dot(uvp, uvp);
      const tex = texture(G.detailTex, uvp.mul(0.22).add(vS.w)).b;
      const puff = exp(r2.mul(-2.6)).mul(tex.mul(0.9).add(0.35)).toVar();
      const a = puff.mul(smoothstep(0.0, 0.1, age)).mul(float(1).sub(smoothstep(0.45, 1.0, age))).mul(0.5).mul(float(1).sub(smoothstep(70.0, 115.0, f.dist)));
      // grey smoke, warmed a little by the mouth only as it leaves it
      const lit = float(1).sub(smoothstep(0.0, 0.14, age));
      const col = mix(vec3(0.15, 0.13, 0.12).mul(tex.mul(0.4).add(0.8)), vec3(0.55, 0.18, 0.05), lit.mul(0.5));
      return { color: col, alpha: min(a.mul(0.8), 0.42) };
    },
  }), 130, { noShadow: true });
  // the lava's light at the feet of the two biggest clusters, on the ground round them
  const glow = (slot, list2) => {
    let x = 0, y = 0, z = 0;
    for (const i of list2) { x += axes[i].x; y += axes[i].g; z += axes[i].z; }
    x /= list2.length; y /= list2.length; z /= list2.length;
    G.glowPos.array[slot].set(x + 1.6, y + 0.9, z + 1.2, 7.5);
    G.glowCol.array[slot].set(1.3, 0.36, 0.07, 0);
  };
  glow(1, [2, 3]);
  glow(2, [5, 6]);
  return axes;
}

// ---- the geode and the diving helmet --------------------------------------------------------

// The geode at the end of the vents, as in our pictures of it: a chunky beige stone split in
// two, both halves fallen open on the black sand toward the camera at p = 7: a thick rough
// rind, a pale band of agate, and deep hollows lined with white quartz points that glow warm
// from inside (glow slot 3), the light pooling on the sand round it. The left half lies
// tipped back a little, its hollow toward the camera; the right one has rolled further back,
// and the picture lies on the bed of small crystals in its hollow. A small brass diving helmet
// lies on the sand to the left; to the right the sand is left clear (the submarine parks there).
const GEODE = { x: -4.13, z: -388.9, r: 1.0 };
// The halves: where each lies, how far its cut face is tipped up (degrees above level), how far
// it is turned toward +x (degrees), which side of the stone it was (so the two are mirror
// images), and how deep the bed in its hollow is (0: none).
const HALVES = [
  { x: -5.04, z: -389.15, tilt: 36, turn: 30, side: 1, bed: 0 },
  { x: -3.22, z: -388.78, tilt: 58, turn: -26, side: -1, bed: 0.42 },
];
const HELMET = { x: -6.38, z: -387.9, yaw: 0.3, roll: 0.1, s: 1.15 };
// The stone's shape, the same for both halves: an egg a little flattened, lumpy; the hollow
// inside it follows the outside, so the rind is thick all round.
const egg = (x, y, z) => 1 / Math.sqrt(x * x + (y / 0.88) ** 2 + (z / 0.95) ** 2);
const stoneLump = (x, y, z) => 1 + 0.11 * noise3(x * 1.6 + 3.1, y * 1.6 + 7.7, z * 1.6 + 1.3) + 0.055 * noise3(x * 3.7 + 9.2, y * 3.7, z * 3.7 + 4.4) + 0.022 * noise3(x * 9 + 1.7, y * 9 + 5.1, z * 9);
const hollowLump = (x, y, z) => 0.83 + 0.05 * Math.max(-z, 0) + 0.04 * noise3(x * 2.8 + 5.5, y * 2.8, z * 2.8 + 8.8) + 0.025 * noise3(x * 7 + 2.2, y * 7 + 3.3, z * 7);
// A rotation (columns x, y, z) that turns local +z toward f, keeping y roughly up.
function frameTo(f) {
  const fl = Math.hypot(f[0], f[1], f[2]), Z = [f[0] / fl, f[1] / fl, f[2] / fl];
  let X = [Z[2], 0, -Z[0]];
  const xl = Math.hypot(X[0], X[1], X[2]) || 1; X = X.map((v) => v / xl);
  const Y = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
  return [...X, ...Y, ...Z];
}
// One half: its outside (aux.x 0), the cut face (1) and the hollow (2), built round its centre
// c in a frame Rot whose +z is the cut face's normal (the shell lies at z < 0). aux.y: on the
// cut face, 0 at the hollow's edge to 1 at the outside; in the hollow, 0 at its rim to 1 at its
// deepest. Crystals go into cr.list (12 numbers each).
function geodeHalf(m, cr, c, Rot, R, side, bed, hi, rng, n) {
  const NA = hi ? 15 : 9, NB = hi ? 54 : 32;
  const toW = (x, y, z) => [c[0] + Rot[0] * x + Rot[3] * y + Rot[6] * z, c[1] + Rot[1] * x + Rot[4] * y + Rot[7] * z, c[2] + Rot[2] * x + Rot[5] * y + Rot[8] * z];
  const rot = (x, y, z) => [Rot[0] * x + Rot[3] * y + Rot[6] * z, Rot[1] * x + Rot[4] * y + Rot[7] * z, Rot[2] * x + Rot[5] * y + Rot[8] * z];
  // (the stone's own direction for a direction of this half: the second half is the stone
  // turned round, so their cut faces match)
  const outR = (d) => R * egg(d[0], d[1], d[2]) * stoneLump(side * d[0], d[1], side * d[2]);
  const inR = (d) => {
    const r0 = R * egg(d[0], d[1], d[2]) * hollowLump(side * d[0], d[1], side * d[2]);
    return bed > 0 && d[2] < -1e-3 ? Math.min(r0, bed / -d[2]) : r0;
  };
  // (from the pole, al = 0, to the cut face's rim, al = pi / 2; rows closer toward the rim)
  const dirAt = (al, be, out) => { out[0] = Math.sin(al) * Math.cos(be); out[1] = Math.sin(al) * Math.sin(be); out[2] = -Math.cos(al); return out; };
  const d = [0, 0, 0];
  for (const kind of [0, 2]) {
    const base = m.count, i0 = m.i.length;
    for (let i = 0; i <= NA; i++) for (let j = 0; j <= NB; j++) {
      const al = Math.pow(i / NA, 0.85) * Math.PI / 2, be = (j / NB) * TAU;
      dirAt(al, be, d);
      const rr = kind ? inR(d) : outR(d), P = toW(d[0] * rr, d[1] * rr, d[2] * rr);
      // (the hollow's depth: 1 at its deepest, 0 at the rim)
      m.vert(P[0], P[1], P[2], 0, 1, 0, 0, 0, kind, kind ? Math.min(1, -d[2] * rr / (R * 0.7)) : 0, n, 0);
    }
    const W = NB + 1;
    for (let i = 0; i < NA; i++) for (let j = 0; j < NB; j++) {
      const a = base + i * W + j;
      if (kind === 0) m.i.push(a, a + 1, a + W, a + 1, a + W + 1, a + W); else m.i.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
    }
    m.normals(base, m.count, i0, { cols: NB, rows: NA, base });
  }
  // the cut face: rings from the hollow's rim out to the rind's, a little uneven, the outer
  // edge rounded off
  {
    const base = m.count, N = rot(0, 0, 1), FR = [0, 0.08, 0.2, 0.32, 0.62, 0.9, 1];
    for (let j = 0; j <= NB; j++) {
      const be = (j / NB) * TAU;
      dirAt(Math.PI / 2, be, d);
      const ro = outR(d), ri = inR(d);
      for (const t of FR) {
        const rr = lerp(ri, ro, t), bump = 0.012 * noise3(d[0] * 6 + side * 3, d[1] * 6, t * 3) - (t > 0.95 ? 0.02 : 0);
        const P = toW(d[0] * rr, d[1] * rr, bump);
        m.vert(P[0], P[1], P[2], N[0], N[1], N[2], 0, 0, 1, t, n, 0);
      }
    }
    const K = FR.length;
    for (let j = 0; j < NB; j++) for (let t = 0; t < K - 1; t++) { const a = base + j * K + t; triFacing(m, a, a + K, a + 1, N[0], N[1], N[2]); triFacing(m, a + 1, a + K, a + K + 1, N[0], N[1], N[2]); }
  }
  // crystals: points on the hollow's wall growing toward its middle, bigger deeper in, small
  // and close along the rim; on the bed, small and close, pointing out of the stone
  for (let k = 0; k < cr.n; k++) {
    const al = Math.acos(1 - rng() * 0.985), be = rng() * TAU;
    dirAt(Math.min(al, Math.PI / 2 * 0.985), be, d);
    const r0 = inR(d), deep = Math.min(1, -d[2] * r0 / (R * 0.7)), onBed = bed > 0 && -d[2] * r0 > bed - 0.03;
    const P = toW(d[0] * r0 * 0.985, d[1] * r0 * 0.985, d[2] * r0 * 0.985);
    const big = Math.pow(rng(), 1.4);
    const len = onBed ? R * rng.range(0.025, 0.06) : R * (0.06 + 0.32 * big * (0.35 + 0.65 * deep)), wid = len * rng.range(onBed ? 0.4 : 0.22, onBed ? 0.6 : 0.36);
    const jx = rng.range(-0.5, 0.5), jy = rng.range(-0.5, 0.5), jz = rng.range(-0.3, 0.3);
    const n0 = onBed ? [jx * 0.7, jy * 0.7, 1] : [-d[0] + jx, -d[1] + jy, -d[2] * 0.6 + 0.35 + jz], nl = Math.hypot(n0[0], n0[1], n0[2]);
    let ln = len;
    if (bed > 0) {
      // keep the picture's place clear: no point stands in front of where it lies
      const tipAt = (l) => [d[0] * r0 * 0.985 + (n0[0] / nl) * l, d[1] * r0 * 0.985 + (n0[1] / nl) * l, d[2] * r0 * 0.985 + (n0[2] / nl) * l];
      const over = (q) => Math.abs(q[0]) < 0.43 && Math.abs(q[1]) < 0.32 && q[2] > -(bed + 0.02);
      while (ln > 0.015 && over(tipAt(ln))) ln *= 0.7;
      if (over(tipAt(ln))) continue;
    }
    const Dw = rot(n0[0] / nl, n0[1] / nl, n0[2] / nl);
    cr.list.push(P[0], P[1], P[2], ln, Dw[0], Dw[1], Dw[2], wid * Math.max(ln / len, 0.6), rng() * TAU, deep, rng(), rng() < 0.15 ? 1 : 0);
  }
  return { toW, rot };
}
// The sand the geode lies on: a round of black sand over the ground, pushed up a little round
// each half, sinking into the ground at its edge; tan grains in it near the stone.
function geodeBed(ctx, halves) {
  const m = new Mesh(true), RB = 3.7, rings = LO ? 10 : 18, segs = LO ? 36 : 64;
  const height = (x, z) => {
    let h = 0.035;
    for (const H of halves) {
      const dd = Math.hypot(x - H.x, z - H.z) / H.R;
      h += 0.075 * Math.exp(-(((dd - 0.82) / 0.22) ** 2));
    }
    const r = Math.hypot(x - GEODE.x, z - GEODE.z) / RB;
    return groundY(x, z) + h + 0.012 * noise3(x * 3.1, z * 3.1, 2.2) - 0.16 * smoothN(0.82, 1.0, r);
  };
  const c0 = m.vert(GEODE.x, height(GEODE.x, GEODE.z), GEODE.z, 0, 1, 0, 0, 0, 0, rockyAt(GEODE.x, GEODE.z), 0.8, 0);
  for (let k = 1; k <= rings; k++) for (let j = 0; j < segs; j++) {
    const r = RB * Math.pow(k / rings, 1.25), a = (j / segs) * TAU, x = GEODE.x + Math.cos(a) * r, z = GEODE.z + Math.sin(a) * r;
    const y = height(x, z);
    m.vert(x, y, z, 0, 1, 0, 0, 0, r, rockyAt(x, z), clampN(0.62 + (y - floorY(z)) * 0.06, 0.4, 1), 0);
  }
  for (let j = 0; j < segs; j++) triFacing(m, c0, 1 + j, 1 + ((j + 1) % segs), 0, 1, 0);
  for (let k = 1; k < rings; k++) for (let j = 0; j < segs; j++) {
    const a = 1 + (k - 1) * segs + j, b = 1 + (k - 1) * segs + ((j + 1) % segs), cc = a + segs, dd = b + segs;
    triFacing(m, a, cc, b, 0, 1, 0); triFacing(m, b, cc, dd, 0, 1, 0);
  }
  m.normals(0, m.count, 0, null);
  addMesh(ctx, sphereOf(m.build(), 0.3), material({
    aux: true, fade: [80, 98], shadow: false,
    surface: (s, f) => {
      // the ground's own black sand (it melts into it at the edge), and near the stone tan
      // grains in it, and a little grey dust
      rockSurf(s, f.w, f.w, f.aux.y, f.aux.z, f.dist);
      const k = float(1).sub(smoothstep(0.8, 3.0, f.aux.x)).toVar();
      const dust = smoothstep(0.5, 0.75, texture(G.detailTex, f.w.xz.mul(0.55).add(0.2)).a).mul(float(1).sub(smoothstep(1.0, 2.2, f.aux.x))).toVar();
      s.albedo = mix(s.albedo.mul(k.mul(1.3).add(1.0)), srgb(0.36, 0.31, 0.25), dust.mul(0.6));
    },
  }), 98);
}
function buildGeode(ctx, q) {
  const rng = makeRng(808), hi = q.amount >= 0.5;
  const m = new Mesh(true), cr = { n: Math.round(190 * Math.max(q.amount, 0.5)), list: [] };
  const R = GEODE.r, cores = [], halves = [];
  let print = null;
  HALVES.forEach((H, hk) => {
    const tl = H.tilt * Math.PI / 180, tn = H.turn * Math.PI / 180;
    const N = [Math.sin(tn) * Math.cos(tl), Math.sin(tl), Math.cos(tn) * Math.cos(tl)];
    // it rests on its back, sunk a little into the sand
    const c = [H.x, groundY(H.x, H.z) + R * 0.8, H.z];
    const Rot = frameTo(N);
    const g = geodeHalf(m, cr, c, Rot, R, H.side, H.bed, hi, rng, hk);
    // the light inside: the middle of the hollow
    cores.push(g.toW(0, 0, -R * 0.3));
    halves.push({ x: H.x, z: H.z, R });
    if (H.bed > 0) print = { at: g.toW(0, -0.02, -H.bed + 0.025), N };
  });
  addMesh(ctx, sphereOf(m.build(), 0.5), material({
    aux: true, fade: [80, 98], shadow: false,
    surface: (s, f) => {
      const kind = f.aux.x, fr = f.aux.y;
      const rind = float(1).sub(step(0.5, kind)), cut = step(0.5, kind).mul(float(1).sub(step(1.5, kind))), hollow = step(1.5, kind);
      const D = detail(f.w, s.n, 2.4, 3.2), E = detail(f.w, s.n, 7.5, 2.2);
      // the rind: beige-grey and rough, darker brown in its pits, paler on its knobs
      const rc = mix(srgb(0.60, 0.54, 0.46), srgb(0.78, 0.72, 0.63), smoothstep(0.3, 0.75, D.m)).mul(E.h.mul(0.4).add(0.78)).toVar();
      rc.assign(mix(rc, srgb(0.42, 0.34, 0.27), smoothstep(0.6, 0.8, E.m).mul(0.55)));
      // the cut face: the rind's section (paler, finer), a thin dark line, the agate band in
      // pale grey rings, white where it meets the crystals
      const sect = mix(srgb(0.62, 0.57, 0.50), srgb(0.78, 0.73, 0.65), D.m).mul(E.h.mul(0.3).add(0.82)).toVar();
      sect.assign(mix(sect, srgb(0.45, 0.40, 0.34), smoothstep(0.62, 0.78, E.m).mul(0.6)).mul(float(1).sub(smoothstep(0.8, 1.0, fr).mul(0.3))));
      const rings = sin(fr.mul(70.0).add(D.h.mul(5.0))).mul(0.5).add(0.5);
      const agate = mix(srgb(0.92, 0.92, 0.93), srgb(0.66, 0.67, 0.71), rings.mul(smoothstep(0.03, 0.12, fr)).mul(0.75));
      const cc = mix(agate, sect, smoothstep(0.33, 0.39, fr)).toVar();
      cc.assign(mix(cc, srgb(0.40, 0.36, 0.32), exp(fr.sub(0.36).mul(fr.sub(0.36)).mul(-2500.0)).mul(0.6)));
      // the hollow's wall: a crust of tiny white crystals
      const hc = srgb(0.52, 0.51, 0.54).mul(E.h.mul(0.6).add(0.45)).mul(D.h.mul(0.3).add(0.75));
      s.albedo = rc.mul(rind).add(cc.mul(cut)).add(hc.mul(hollow));
      s.n = normalize(mix(s.n, normalize(D.n.add(E.n).sub(s.n)), rind.mul(0.9).add(hollow.mul(0.75)).add(cut.mul(0.25)))).toVar();
      s.ao = mix(D.h.mul(0.5).add(0.55), E.h.mul(0.3).add(0.7), cut).mul(mix(float(1.0), E.h.mul(0.5).add(0.5).mul(smoothstep(0.0, 0.45, fr).mul(0.5).add(0.5)), hollow));
      s.spec = mix(float(0.04), float(0.6), hollow.add(cut.mul(float(1).sub(smoothstep(0.2, 0.3, fr))).mul(0.5)));
      s.gloss = mix(float(12.0), float(60.0), hollow);
      s.fluor = float(0.08); s.trans = hollow.mul(0.3);
      // light from inside: the hollow glows warm, most deep in; the agate band lets a little
      // through; the outside is lit a little by the sand the light falls on
      const warm = vec3(1.0, 0.64, 0.32);
      // (and a soft key light from the upper left, as in the pictures' studio, so the rock's
      // roughness and its round back show in the dark)
      const key = max(dot(s.n, vec3(-0.45, 0.75, 0.48)), 0.0).mul(0.75).add(0.08);
      s.emis = warm.mul(fr.mul(fr).mul(fr).mul(0.85).add(0.02)).mul(E.h.mul(0.7).add(0.45)).mul(hollow)
        .add(warm.mul(0.07).mul(float(1).sub(smoothstep(0.0, 0.3, fr))).mul(cut))
        .add(s.albedo.mul(vec3(0.13, 0.115, 0.1)).mul(key).mul(rind.add(cut.mul(0.3))));
    },
  }), 98);
  // the crystals: six-sided points, each a prism and a pyramid, rounded round their sides
  const cm = new Mesh(true);
  for (let k = 0; k < 6; k++) {
    const a0 = (k / 6) * TAU, a1 = ((k + 1) / 6) * TAU;
    const p0 = [Math.cos(a0), Math.sin(a0)], p1 = [Math.cos(a1), Math.sin(a1)];
    const nx = Math.cos((a0 + a1) / 2), ny = Math.sin((a0 + a1) / 2);
    // the side: (x, y) round, z along (0 foot, 0.7 shoulder)
    const v0 = cm.count;
    cm.vert(p0[0], p0[1], -0.15, p0[0], p0[1], 0, 0, 0, 0, 0, 1, 0); cm.vert(p1[0], p1[1], -0.15, p1[0], p1[1], 0, 0, 0, 1, 0, 1, 0);
    cm.vert(p1[0], p1[1], 0.62, p1[0], p1[1], 0, 0, 0, 1, 0.62, 1, 0); cm.vert(p0[0], p0[1], 0.62, p0[0], p0[1], 0, 0, 0, 0, 0.62, 1, 0);
    triFacing(cm, v0, v0 + 1, v0 + 2, nx, ny, 0); triFacing(cm, v0, v0 + 2, v0 + 3, nx, ny, 0);
    // the point's facet
    const fnx = nx * 0.68, fny = ny * 0.68, fnz = 0.73;
    const v1 = cm.count;
    cm.vert(p0[0], p0[1], 0.62, fnx, fny, fnz, 0, 0, 0, 0.62, 2, 0); cm.vert(p1[0], p1[1], 0.62, fnx, fny, fnz, 0, 0, 1, 0.62, 2, 0); cm.vert(0, 0, 1, fnx, fny, fnz, 0, 0, 0.5, 1, 2, 0);
    triFacing(cm, v1, v1 + 1, v1 + 2, fnx, fny, fnz);
  }
  const base = cm.build();
  const list = cr.list, n = list.length / 12;
  const ia = new Float32Array(n * 4), ib = new Float32Array(n * 4), ic = new Float32Array(n * 4);
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 4; k++) { ia[i * 4 + k] = list[i * 12 + k]; ib[i * 4 + k] = list[i * 12 + 4 + k]; ic[i * 4 + k] = list[i * 12 + 8 + k]; }
    x0 = Math.min(x0, ia[i * 4]); x1 = Math.max(x1, ia[i * 4]); y0 = Math.min(y0, ia[i * 4 + 1]); y1 = Math.max(y1, ia[i * 4 + 1]); z0 = Math.min(z0, ia[i * 4 + 2]); z1 = Math.max(z1, ia[i * 4 + 2]);
  }
  const geo = new InstancedBufferGeometry();
  geo.setIndex(base.index);
  for (const k of ['position', 'normal', 'aux']) geo.setAttribute(k, base.getAttribute(k));
  geo.setAttribute('ga', new InstancedBufferAttribute(ia, 4)); geo.setAttribute('gb', new InstancedBufferAttribute(ib, 4)); geo.setAttribute('gc', new InstancedBufferAttribute(ic, 4));
  geo.instanceCount = n;
  geo.boundingSphere = new Sphere(V((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 0.6);
  const GA = attribute('ga', 'vec4'), GB = attribute('gb', 'vec4'), GC = attribute('gc', 'vec4');
  const vC = varyingProperty('vec4', 'v_set_cry');
  addMesh(ctx, geo, material({
    aux: true, fade: [80, 98], shadow: false,
    vertex: (v) => {
      const Dd = GB.xyz, len = GA.w, wid = GB.w, spin = GC.x;
      const T0 = normalize(cross(Dd, select3(abs(Dd.y).lessThan(0.9)))).toVar();
      const T1 = cross(Dd, T0).toVar();
      const ca = cos(spin), sa = sin(spin);
      const U = T0.mul(ca).add(T1.mul(sa)).toVar(), Wv = T1.mul(ca).sub(T0.mul(sa)).toVar();
      v.P.assign(GA.xyz.add(U.mul(v.P.x.mul(wid))).add(Wv.mul(v.P.y.mul(wid))).add(Dd.mul(v.P.z.mul(len))));
      v.N.assign(normalize(U.mul(v.N.x).add(Wv.mul(v.N.y)).add(Dd.mul(v.N.z.mul(wid.div(len))))));
      vC.assign(vec4(GC.y, GC.z, GC.w, 0.0));
    },
    surface: (s, f) => {
      // clear and white quartz (a few a little violet), lit from inside the hollow: warm,
      // brightest deep in and toward each point; a glassy glint at the edges of what is seen
      const along = f.aux.y, deep = vC.x, tone = vC.y;
      const vv = normalize(cameraPosition.sub(f.w)), fres = pow(float(1).sub(abs(dot(s.n, vv))), 2.5);
      const white = mix(srgb(0.93, 0.92, 0.92), srgb(0.86, 0.82, 0.93), vC.z);
      s.albedo = white.mul(tone.mul(0.25).add(0.65)).mul(along.mul(0.55).add(0.45));
      s.spec = float(1.1); s.gloss = float(80.0); s.trans = float(0.7); s.fluor = float(0.05);
      const warm = vec3(1.0, 0.64, 0.32);
      const gl = vec3(G.glowPos.element(3).xyz).sub(f.w).normalize();
      const glint = pow(max(dot(s.n, normalize(gl.add(vv))), 0.0), 40.0);
      const key = max(dot(s.n, vec3(-0.45, 0.75, 0.48)), 0.0);
      s.emis = warm.mul(deep.mul(deep).mul(deep).mul(1.2).add(0.03)).mul(along.mul(along).mul(0.8).add(0.2)).mul(tone.mul(0.6).add(0.5))
        .add(vec3(1.0, 0.9, 0.75).mul(glint.mul(0.6))).add(vec3(0.85, 0.85, 0.95).mul(fres.mul(0.12))).add(s.albedo.mul(key.mul(0.16)));
    },
  }), 98);
  // the light inside each hollow: warm haze at its middle; on everything round it (slot 3),
  // from just in front of where the two halves meet
  const glowAt = [(cores[0][0] + cores[1][0]) / 2, (cores[0][1] + cores[1][1]) / 2 + 0.25, (cores[0][2] + cores[1][2]) / 2 + 0.75];
  G.glowPos.array[3].set(glowAt[0], glowAt[1], glowAt[2], 4.2);
  G.glowCol.array[3].set(1.85, 1.45, 1.0, 0);
  addMesh(ctx, halos([...cores[0], ...cores[1]], 0.85), material({
    additive: true, shadow: false, fade: [70, 90],
    vertex: (v) => haloVertex(v, 0.85),
    raw: (f) => { const d = length(vHalo); return { color: vec3(1.0, 0.66, 0.36).mul(exp(d.mul(d).mul(-5.0)).mul(0.22)).mul(exp(SIG.mul(f.dist).negate())), alpha: float(1.0) }; },
  }), 90, { noShadow: true });
  geodeBed(ctx, halves);
  // where the picture goes: on the bed in the right half's hollow, facing out of it
  return { position: V(...print.at), normal: V(...print.N), size: 0.75 };
}
const select3 = (cond) => vec3(0.0, 1.0, 0.0).mul(cond.select(1.0, 0.0)).add(vec3(1.0, 0.0, 0.0).mul(cond.select(0.0, 1.0)));

// A small brass diving helmet lying on the black sand left of the geode, polished, its round
// front port turned to the camera: the breastplate and its bolts, the neck ring, the dome with
// three ports (glass in thick brass rims), a valve at the back. The brass mirrors the geode's
// light.
function buildHelmet(ctx) {
  const m = new Mesh(true), H = HELMET, gy = groundY(H.x, H.z), S = H.s;
  const cy = Math.cos(H.yaw), sy = Math.sin(H.yaw), cr = Math.cos(H.roll), sr = Math.sin(H.roll);
  // local: y up, z out of the front port; rolled onto its side a little, turned, set down
  const dirW = (px, py, pz) => { const x1 = px * cr - py * sr, y1 = px * sr + py * cr; return [x1 * cy + pz * sy, y1, -x1 * sy + pz * cy]; };
  const toW = (px, py, pz) => { const D = dirW(px * S, py * S, pz * S); return [H.x + D[0], gy - 0.05 + D[1], H.z + D[2]]; };
  const place = (from) => {
    for (let v = from; v < m.count; v++) {
      const P = toW(m.p[v * 3], m.p[v * 3 + 1], m.p[v * 3 + 2]), N = dirW(m.n[v * 3], m.n[v * 3 + 1], m.n[v * 3 + 2]);
      m.p[v * 3] = P[0]; m.p[v * 3 + 1] = P[1]; m.p[v * 3 + 2] = P[2]; m.n[v * 3] = N[0]; m.n[v * 3 + 1] = N[1]; m.n[v * 3 + 2] = N[2];
    }
  };
  const K = (kind) => (k, j, px, py, pz, o) => { o[0] = kind; };
  // the breastplate: a low bell, wider across the shoulders, its rim rolled
  sweep(m, [[0, 0.0, 0, 0.245], [0, 0.025, 0, 0.255], [0, 0.06, 0, 0.24], [0, 0.11, 0, 0.205], [0, 0.15, 0, 0.175], [0, 0.175, 0, 0.16]], 28, { up: [1, 0, 0], aux: K(0) });
  sweep(m, (() => { const r = []; for (let i = 0; i < 28; i++) { const a = (i / 28) * TAU; r.push([Math.cos(a) * 0.245, 0.01, Math.sin(a) * 0.245, 0.016]); } return r; })(), 6, { closed: true, up: [0, 1, 0], aux: K(2) });
  disc(m, 0, 0.015, 0, 0.245, 28, -1, [2, 0, 0, 0]);
  for (let v = 0; v < m.count; v++) { m.p[v * 3] *= 1.18; m.p[v * 3 + 2] *= 0.9; const nx = m.n[v * 3] / 1.18, nz = m.n[v * 3 + 2] / 0.9, l = Math.hypot(nx, m.n[v * 3 + 1], nz); m.n[v * 3] = nx / l; m.n[v * 3 + 1] /= l; m.n[v * 3 + 2] = nz / l; }
  // the neck ring and the dome
  sweep(m, (() => { const r = []; for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU; r.push([Math.cos(a) * 0.162, 0.185, Math.sin(a) * 0.162, 0.024]); } return r; })(), 6, { closed: true, up: [0, 1, 0], aux: K(2) });
  ball(m, 0, 0.345, 0, (dx, dy, dz) => (dy < -0.6 ? 0.16 : 0.172), 9, (dx, dy, dz, o) => { o[0] = 0; });
  // the ports: a thick brass rim and a glass in each, front and sides; a little one on top
  for (const [dx, dy, dz, rr] of [[0, 0.05, 1, 0.075], [1, 0.05, 0.1, 0.05], [-1, 0.05, 0.1, 0.05], [0, 0.9, 0.45, 0.035]]) {
    const l = Math.hypot(dx, dy, dz), d = [dx / l, dy / l, dz / l], c = [d[0] * 0.172, 0.345 + d[1] * 0.172, d[2] * 0.172];
    const u = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let a = [u[1] * d[2] - u[2] * d[1], u[2] * d[0] - u[0] * d[2], u[0] * d[1] - u[1] * d[0]]; const al = Math.hypot(...a); a = a.map((vv) => vv / al);
    const bv = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]];
    const ring = [];
    for (let i = 0; i < 18; i++) { const t = (i / 18) * TAU; ring.push([c[0] + (a[0] * Math.cos(t) + bv[0] * Math.sin(t)) * rr + d[0] * 0.02, c[1] + (a[1] * Math.cos(t) + bv[1] * Math.sin(t)) * rr + d[1] * 0.02, c[2] + (a[2] * Math.cos(t) + bv[2] * Math.sin(t)) * rr + d[2] * 0.02, rr * 0.28]); }
    sweep(m, ring, 7, { closed: true, up: d, aux: K(2) });
    // the glass: a low dome in the rim
    const g0 = m.count, gc = [c[0] + d[0] * 0.03, c[1] + d[1] * 0.03, c[2] + d[2] * 0.03];
    m.vert(gc[0], gc[1], gc[2], d[0], d[1], d[2], 0, 0, 1, 0, 0, 0);
    for (let i = 0; i <= 18; i++) {
      const t = (i / 18) * TAU, ox = a[0] * Math.cos(t) + bv[0] * Math.sin(t), oy = a[1] * Math.cos(t) + bv[1] * Math.sin(t), oz = a[2] * Math.cos(t) + bv[2] * Math.sin(t);
      m.vert(c[0] + ox * rr + d[0] * 0.012, c[1] + oy * rr + d[1] * 0.012, c[2] + oz * rr + d[2] * 0.012, d[0] + ox * 0.5, d[1] + oy * 0.5, d[2] + oz * 0.5, 0, 0, 1, 1, 0, 0);
    }
    for (let i = 0; i < 18; i++) triFacing(m, g0, g0 + 1 + i, g0 + 2 + i, d[0], d[1], d[2]);
  }
  // bolts round the breastplate, studs on the neck ring, the valve at the back
  for (let i = 0; i < 10; i++) { const t = (i / 10) * TAU + 0.3; ball(m, Math.cos(t) * 0.27, 0.045, Math.sin(t) * 0.215, () => 0.02, 2, (dx, dy, dz, o) => { o[0] = 2; }); }
  for (let i = 0; i < 6; i++) { const t = (i / 6) * TAU; ball(m, Math.cos(t) * 0.185, 0.2, Math.sin(t) * 0.185, () => 0.016, 2, (dx, dy, dz, o) => { o[0] = 2; }); }
  sweep(m, [[0, 0.39, -0.155, 0.03], [0, 0.41, -0.255, 0.03], [0, 0.41, -0.295, 0.042]], 8, { caps: true, aux: K(2) });
  place(0);
  // where the geode's light comes from, as the helmet sees it
  const gl = [G.glowPos.array[3].x, G.glowPos.array[3].y, G.glowPos.array[3].z];
  addMesh(ctx, sphereOf(m.build(), 0.3), material({
    aux: true, fade: [80, 98], shadow: false,
    surface: (s, f) => {
      const glass = step(0.5, f.aux.x).mul(float(1).sub(step(1.5, f.aux.x))), dark = step(1.5, f.aux.x);
      const D = detail(f.w, s.n, 9.0, 0.3);
      // polished brass, a little patina in places; the rims and bolts a shade darker
      const pat = smoothstep(0.6, 0.85, D.m).mul(0.35);
      const brass = mix(srgb(0.86, 0.66, 0.36), srgb(0.40, 0.46, 0.36), pat).mul(float(1).sub(dark.mul(0.25)));
      s.albedo = mix(brass, srgb(0.05, 0.07, 0.08), glass);
      s.n = normalize(mix(D.n, s.n, glass)).toVar();
      s.spec = mix(float(1.4), float(2.0), glass); s.gloss = mix(float(70.0), float(140.0), glass); s.fluor = float(0.05);
      // it mirrors what is round it: the warm glow of the geode, the lit sand below, the dark water above
      const vv = normalize(cameraPosition.sub(f.w)).toVar(), r = reflect(vv.negate(), s.n).toVar();
      const toG = normalize(vec3(...gl).sub(f.w)).toVar();
      const rg = max(dot(r, toG), 0.0).toVar();
      const env = vec3(0.02, 0.02, 0.03).add(vec3(1.0, 0.68, 0.36).mul(pow(rg, 5.0).mul(1.4).add(pow(rg, 60.0).mul(4.0))))
        .add(vec3(0.16, 0.11, 0.06).mul(smoothstep(0.05, -0.5, r.y)));
      const fres = pow(float(1).sub(max(dot(s.n, vv), 0.0)), 5.0);
      s.emis = mix(brass.mul(env).mul(float(0.75).add(fres.mul(0.25))), vec3(1.0, 0.8, 0.55).mul(pow(rg, 90.0).mul(2.5)).add(vec3(0.03, 0.05, 0.06).mul(fres.mul(2.0).add(0.2))), glass);
    },
  }), 98);
}

// ---- all of it ----------------------------------------------------------------------------------

export function buildSets(ctx) {
  const t0 = performance.now();
  const { q } = ctx;
  LO = q.amount < 0.5;
  const lap = [];
  let tl0 = t0;
  const mark = (name) => { const t = performance.now(); lap.push(name + ' ' + Math.round(t - tl0) + ' ms/' + STATS.meshes + ' meshes/' + Math.round(STATS.tris / 1000) + 'k tris'); tl0 = t; STATS.meshes = 0; STATS.tris = 0; };
  const start = buildMarina(ctx, q, MARINA_START, { seed: 5150, anchor: true, lights: true });
  mark('marina');
  buildMarina(ctx, q, MARINA_END, { seed: 7272, lights: true, deep: true });
  mark('marina2');
  // the chain: from the ring under the mooring buoy down to the anchor in the sand
  const tw = [BUOY.x - ANCHOR.x, BUOY.z - ANCHOR.z], tl = Math.hypot(tw[0], tw[1]);
  // (the arms turned 40 degrees from square to the way the camera comes, so arms and stock both show)
  const fa = Math.atan2(-0.9, 0.435) + 0.7;
  const ring = buildAnchor(ctx, [ANCHOR.x, ANCHOR.z], [tw[0] / tl, tw[1] / tl], [Math.cos(fa), Math.sin(fa)]);
  // (the chain was hung, in layout.js, to where this ring is: check they agree)
  if (typeof DEV !== 'undefined' && DEV) { const r2 = anchorRing(); if (Math.hypot(ring[0] - r2[0], ring[1] - r2[1], ring[2] - r2[2]) > 0.01) console.warn('sets: the anchor ring moved: ' + ring + ' vs ' + r2); }
  const chain = buildChain(ctx, q);
  mark('chain');
  const clam = buildClam(ctx, q);
  const clamGlows = clam.glows;
  delete clam.glows;
  mark('clam');
  const wreck = buildWreck(ctx, q);
  mark('wreck');
  buildVents(ctx, q);
  mark('vents');
  const geode = buildGeode(ctx, q);
  buildHelmet(ctx);
  mark('geode');
  if (typeof DEV !== 'undefined' && DEV) console.log('sets ' + Math.round(performance.now() - t0) + ' ms (' + lap.join(', ') + ')');
  // the glow slots 1 to 3 are the vents' and the geode's; while the camera is on the reef (where
  // nothing of theirs can be seen) they are lent to the clam's three lamps
  const deepGlows = [1, 2, 3].map((i) => [G.glowPos.array[i].toArray(), G.glowCol.array[i].toArray()]);
  let lent = -1;
  const lit = [-1, -1, -1];
  const lend = (reef) => {
    lent = reef;
    for (let i = 0; i < 3; i++) {
      G.glowPos.array[i + 1].fromArray(reef ? clamGlows[i * 2] : deepGlows[i][0]);
      G.glowCol.array[i + 1].fromArray(reef ? clamGlows[i * 2 + 1] : deepGlows[i][1]);
      lit[i] = -1;
    }
  };
  return {
    update(t, dt, p) {
      chain.setTime(t);
      const reef = p < 4.15 ? 1 : 0;
      if (reef !== lent) lend(reef);
      // (on the reef, the light each lamp throws is as bright as the lamp: clam.lampLevel)
      if (reef) for (let i = 0; i < 3; i++) if (lit[i] !== clam.level[i]) { lit[i] = clam.level[i]; G.glowCol.array[i + 1].fromArray(clamGlows[i * 2 + 1]).multiplyScalar(lit[i]); }
    },
    chainAt: chain.chainAt,
    clam, geode, wreck,
  };
}
