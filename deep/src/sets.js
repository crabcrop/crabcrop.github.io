// The set pieces: everything man-made or singular that the story needs, made in code, in the
// dive's handmade look (wood, rope, crochet, fabric, glass and brass: chunky and rounded).
//
//   the marina      twice: where the dive starts (z0) and where it comes up again (z7). Seen from
//                   the waterline: two wooden piers with posts and rope, crochet fenders, the buoy
//                   on its coil of rope, a dinghy between them, sailboats, a striped lighthouse.
//                   At the start, one of the sailboats rides to an anchor: its chain hangs down to
//                   an anchor stood in the sand, and Snap rides down that chain.
//   the giant clam  the Clam Studio at the reef's far end: a ruffled crochet clam
//   the wreck       an old wooden sailing ship sitting on the ledge, and its cabin: portholes, a
//                   desk with a lantern (glow slot 0) and an envelope
//   the vents       the chimneys' glowing cracks and mouths and their smoke (glow slots 1, 2), a
//                   brass diving helmet
//   the geode       split open, glowing (glow slot 3): where the print lies
//
// buildSets(ctx) returns { update(t, dt, p), chainAt(s, out), clam, geode }:
//   chainAt(s, out)  s is 0 at the boat's bow roller and 1 at the anchor's ring; writes the point
//                    on the chain (out[0..2]) and its unit direction toward the anchor (out[3..5]),
//                    as the chain hangs at this frame (after update(t)).
//   clam             { position, normal }: where an object sits in the open clam, and the way the
//                    clam opens (unit vector out of its mouth).
//   geode            { position, normal, size }: the spot in the geode's hollow where the picture
//                    goes, the way it faces (toward the camera at p = 7), and the widest picture
//                    (metres) that fits there, square or wide.
import { BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh as ThreeMesh, Sphere, Vector3 } from 'three/webgpu';
import {
  abs, attribute, cameraPosition, clamp, cos, cross, dot, exp, float, floor, fract, fwidth, int, ivec3, length, max, min, mix, normalize, pow,
  select, sin, smoothstep, step, texture, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';
import { centerX, groundY } from './layout.js';
import { Mesh, TAU, blob, clamp as clampN, lerp, makeRng, noise3 } from './math.js';
import { G, SIG, detail, hash3, material, sunAt, yarn } from './shaders.js';
import { rockSurf } from './terrain.js';

// ---- building blocks ----------------------------------------------------------------------

const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const toAttr = (a, n = 4) => new BufferAttribute(new Float32Array(a), n);
// A mesh under construction whose vertices also carry two colours (tint, tint2), set with
// paint() before each piece is added.
class TMesh extends Mesh {
  constructor() { super(true); this.t = []; this.t2 = []; this.c1 = [1, 1, 1, 0]; this.c2 = [1, 1, 1, 0]; }
  vert(...a) { this.t.push(...this.c1); this.t2.push(...this.c2); return super.vert(...a); }
  paint(c1, c2 = c1) { this.c1 = c1.length === 4 ? c1 : [...c1, 0]; this.c2 = c2.length === 4 ? c2 : [...c2, 0]; return this; }
  build() { const g = super.build(); g.setAttribute('tint', toAttr(this.t)); g.setAttribute('tint2', toAttr(this.t2)); return g; }
}

const sphereOf = (geo, pad = 0) => { geo.computeBoundingSphere(); geo.boundingSphere.radius += pad; return geo; };
function addMesh(ctx, geo, mat, range, opts = {}) {
  const mesh = new ThreeMesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  if (opts.order !== undefined) mesh.renderOrder = opts.order;
  if (opts.noShadow) mesh.userData.castShadow = false;
  ctx.add(mesh, range);
  return mesh;
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
  const acc = runLength(pts);
  return sweep(m, pts, sides, { caps: true, aux: (k, j, x, y, z, o) => { o[0] = j / sides; o[1] = acc[k]; } });
}
// Coils of rope: `turns` loops stacked upward from c, radius R, rope radius rr.
function coil(m, c, R, rr, turns, rise = 0.85) {
  const pts = [], N = Math.round(turns * 24);
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
  const pts = [], N = turns * 20;
  for (let i = 0; i <= N; i++) {
    const t = i / N, ang = t * turns * TAU, ca = Math.cos(ang), sa = Math.sin(ang);
    const k = 1 / Math.pow(Math.pow(Math.abs(ca), 4) + Math.pow(Math.abs(sa), 4), 0.25);        // round a squarish post
    pts.push([c[0] + ca * k * (hw + rr * 0.8), y + (t - 0.5) * turns * rr * 2.05, c[1] + sa * k * (hw + rr * 0.8), rr]);
  }
  return rope(m, pts, 6);
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

// Wood: smooth and warm, soft grain streaks along the timber, paint worn off in patches where
// tint2.w says it was painted (tint2.rgb). aux: x across the grain, y along it (metres), z
// baked shade (1 open).
function woodSurf(s, f, base, paint = float(0.0)) {
  const near = float(1).sub(smoothstep(6.0, 28.0, f.dist)).toVar();
  const g1 = texture(G.detailTex, vec2(f.aux.x.mul(1.6), f.aux.y.mul(0.11))).toVar();
  const g2 = texture(G.detailTex, vec2(f.aux.x.mul(4.3).add(0.37), f.aux.y.mul(0.35))).toVar();
  const streak = g1.b.mul(0.55).add(g2.b.mul(0.45)).toVar();
  const wood = base.mul(streak.sub(0.45).mul(0.55).add(0.86)).mul(g1.a.mul(0.18).add(0.91)).toVar();
  const keep = smoothstep(0.33, 0.57, g2.b.mul(0.7).add(g1.a.mul(0.5)).sub(0.1)).mul(paint);
  s.albedo = mix(wood, vT2.rgb.mul(g1.a.mul(0.1).add(0.95)), keep);
  const D = detail(f.w, s.n, 1.1, 1.2);
  s.n = normalize(mix(s.n, D.n, near.mul(0.6))).toVar();
  s.ao = f.aux.z.mul(streak.mul(0.25).add(0.82)).min(1.0);
  s.spec = float(0.07).add(keep.mul(0.08)).mul(near.mul(0.6).add(0.4)); s.gloss = float(16.0);
  s.fluor = float(0.3);
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
  const t = smoothstep(0.35, 0.75, D.m.add(tarnish - 0.25)).toVar();
  s.albedo = mix(vec3(0.86, 0.62, 0.26), vec3(0.32, 0.42, 0.30), t.mul(0.55));
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
  const strakes = o.strakes ?? 6, lod = o.lod ? 1 : 0;
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
      w.vert(P[0], P[1], P[2], 0, 1, 0, t, v, v * B * 1.3 + strake * 0.37, z, 1, 0);
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
// The sailboat that rides to the anchor, and the anchor (only at the start).
const MOORED = { x: 6.55, z: -7.2, len: 6.2, beam: 2.1 };
const ANCHOR = { x: 4.35, z: -24.5 };
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
        const g = deep ? -26 : groundY(px, pz) - 0.8;
        const hw = rng.range(0.16, 0.19), tp = topY + rng.range(-0.06, 0.08);
        w.paint(WOOD.post.map((v) => v * rng.range(0.85, 1.12)));
        rbox(w, [px, (g + tp) / 2, pz], [1, 0, 0], [0, 1, 0], [0, 0, 1], [hw, (tp - g) / 2, hw * rng.range(0.92, 1.05)], 0.06, [1, Math.round((tp - g) / 1.2), 1],
          (lx2, ly, lz2, o) => { o[0] = lx2 + lz2 * 1.37 + i * 0.71; o[1] = ly; o[2] = 1; });
        posts.push({ x: px, z: pz, hw, top: tp, front: isFront, left });
        if (isFront) { r.paint(ROPE); lashing(r, [px, pz], hw, deckY + 0.12, 3); lashing(r, [px, pz], hw, tp - 0.25, 2); }
      }
    }
    w.paint(WOOD.beam);
    for (const lz of [front + 0.27, back - 0.27]) timber(w, [X(x0), deckY - 0.15, Z(lz)], [X(x1), deckY - 0.15, Z(lz)], 0.14, 0.3, [0, 1, 0], 0.035);
    for (let lx = x0 + 0.6; lx < x1 - 0.3; lx += 1.15) timber(w, [X(lx), deckY - 0.17, Z(back - 0.1)], [X(lx), deckY - 0.17, Z(front + 0.1)], 0.12, 0.2, [0, 1, 0], 0.03);
    for (let lx = x0 + 0.12, k = 0; lx < x1 - 0.1; lx += 0.235, k++) {
      w.paint(WOOD.deck.map((v) => v * rng.range(0.86, 1.1)));
      const zj = rng.range(-0.04, 0.04), kk = k;
      timber(w, [X(lx), deckY - 0.03, Z(back - 0.32 + zj)], [X(lx), deckY - 0.03, Z(front + 0.32 + zj)], 0.215, 0.065, [0, 1, 0], 0.02, (a, bb, cc, o) => { o[0] = a + kk * 0.53; o[1] = cc; o[2] = 1; }, 3.0);
    }
  }
  // brass: bolts in the fascia at each front post, cleats on the deck's edge
  for (const p of posts) if (p.front) for (const dy of [-0.07, 0.07]) blob(b, p.x, deckY - 0.15 + dy, Z(front + 0.27) + 0.075, (dx, dyy, dz) => (dz > 0 ? 0.03 : 0.012), 2);
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
    blob(y, x, hang, z, (dx, dy, dz) => 1 / Math.sqrt((dx / sx) ** 2 + (dy / sy) ** 2 + (dz / sx) ** 2), 9);
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
  // the buoy on its coil of rope, on the left pier, tilted where it rests
  {
    const cx = X(-4.75), cz = Z(-7.25);
    r.paint([0.80, 0.70, 0.52]);
    coil(r, [cx, deckY, cz], 0.36, 0.045, 4.5);
    const v0 = y.count, ang = 0.55, ca = Math.cos(ang), sa = Math.sin(ang);
    y.paint(COL.coral, COL.cream);
    blob(y, 0, 0, 0, (dx, dy, dz) => 1 / Math.sqrt((dx / 0.26) ** 2 + (dy / 0.4) ** 2 + (dz / 0.26) ** 2), 10);
    for (let v = v0; v < y.count; v++) {
      const px = y.p[v * 3], py = y.p[v * 3 + 1], pz = y.p[v * 3 + 2], nx = y.n[v * 3], ny = y.n[v * 3 + 1];
      y.p[v * 3] = cx + px * ca - py * sa; y.p[v * 3 + 1] = deckY + 0.46 + px * sa + py * ca; y.p[v * 3 + 2] = cz + pz;
      y.n[v * 3] = nx * ca - ny * sa; y.n[v * 3 + 1] = nx * sa + ny * ca;
    }
  }
  // a crochet net heaped on the right pier, with two floats
  y.paint([0.80, 0.76, 0.62], [0.62, 0.70, 0.62]);
  blob(y, X(14.2), deckY + 0.12, Z(-7.9), (dx, dy, dz) => (0.55 + 0.12 * noise3(dx * 2.5, dy * 2.5, dz * 2.5)) * (dy < 0 ? 0.25 : 0.62 + 0.25 * dy), 10);
  y.paint(COL.sun); blob(y, X(13.8), deckY + 0.55, Z(-7.7), () => 0.13, 6);
  y.paint(COL.coral); blob(y, X(14.6), deckY + 0.5, Z(-8.1), () => 0.12, 6);
  // sailboats beyond, and at the start the one that rides to the anchor
  const far = [
    { x: X(-8.8), z: Z(-17.5), len: 5.6, beam: 1.9, heading: Math.PI / 2 + 0.25, paint: [[0.92, 0.90, 0.84], [0.30, 0.45, 0.62]], mastH: 6.2, jib: true, lod: 1, seed: 0.7 },
    { x: X(14.5), z: Z(-24), len: 6.0, beam: 2.0, heading: -Math.PI / 2 + 0.35, paint: [[0.90, 0.86, 0.78], [0.66, 0.24, 0.20]], mastH: 6.8, jib: true, lod: 1, seed: 1.3 },
    { x: X(21), z: Z(-33), len: 5.2, beam: 1.8, heading: -Math.PI / 2 - 0.2, paint: [[0.92, 0.90, 0.86], [0.28, 0.50, 0.50]], mastH: 6.0, jib: true, lod: 1, seed: 2.1, sailSide: -1 },
  ];
  let moored = null;
  if (opts.anchor) {
    moored = { x: MOORED.x, z: MOORED.z, len: MOORED.len, beam: MOORED.beam, heading: Math.atan2(ANCHOR.x - MOORED.x, ANCHOR.z - MOORED.z), paint: [[0.90, 0.88, 0.82], [0.24, 0.36, 0.55]], mastH: 7.0, jib: true, seed: 1.9, depth: 0.5, sheer: 0.62 };
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
  addMesh(ctx, sphereOf(finishBob(w, w.build()), 1), material({ aux: true, fade, vertex: (v) => { tintIn(); bobTSL(v); }, surface: (s, f) => woodSurf(s, f, vT.rgb, vT2.w) }), range);
  addMesh(ctx, sphereOf(finishBob(r, r.build()), 1), material({ aux: true, fade, vertex: (v) => { tintIn(); bobTSL(v); }, surface: (s, f) => ropeSurf(s, f, vT.rgb) }), range);
  addMesh(ctx, sphereOf(finishBob(y, y.build()), 1), yarnMat({ fade, vertex: (v) => bobTSL(v), scale: 26, stripe: 3 }), range);
  addMesh(ctx, sphereOf(b.build(), 0.5), material({ aux: true, fade, surface: (s, f) => brassSurf(s, f) }), range);
  addMesh(ctx, sphereOf(finishBob(c, c.build()), 1), material({ aux: true, twoSided: true, fade, vertex: (v) => bobTSL(v), surface: (s, f) => canvasSurf(s, f, vec3(0.93, 0.87, 0.74)) }), range);
  if (bulbs) buildBulbs(ctx, bulbs);
  buildLighthouse(ctx, X(-34.2), Z(-94), deep);
  return { moored, dinghy, posts };
}

// Little warm bulbs on a string: a lit bead each, and a soft halo.
function buildBulbs(ctx, list) {
  const m = new Mesh(true);
  for (let i = 0; i < list.length; i += 3) blob(m, list[i], list[i + 1], list[i + 2], () => 0.045, 3);
  addMesh(ctx, sphereOf(m.build(), 0.5), material({ aux: true, shadow: false, surface: (s) => { s.albedo = vec3(0.9, 0.8, 0.6); s.emis = vec3(3.2, 2.2, 1.0); } }), 140);
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
  blob(m, x, gy + 2.76, z, () => 0.2, 4, (dx, dy, dz, o) => { o[0] = 2; o[1] = 24; });
  // the door and the windows face the marina: the angle round the tower that looks at it
  const face = Math.atan2(34.2, 94) / TAU;    // (sweep's angle 0 faces -z; the marina lies at +x, +z)
  addMesh(ctx, sphereOf(m.build(), 1), material({
    aux: true, fade: [175, 200],
    surface: (s, f) => {
      const k = f.aux.x, hh = f.aux.y, round = fract(f.aux.z.sub(0.5 - face).add(1.0));
      const band = step(0.5, fract(hh.div(3.2)));
      const paint = mix(vec3(0.94, 0.91, 0.85), vec3(0.82, 0.25, 0.21), band);
      const facing = float(1).sub(smoothstep(0.02, 0.03, abs(round.sub(0.5))));
      const win = facing.mul(float(1).sub(smoothstep(0.1, 0.13, abs(fract(hh.div(4.6)).sub(0.5))))).mul(step(3.0, hh)).mul(step(hh, 16.5));
      const door = float(1).sub(smoothstep(0.03, 0.04, abs(round.sub(0.5)))).mul(step(hh, 1.9));
      const kT = float(1).sub(step(0.5, k)), kR = step(0.5, k).mul(float(1).sub(step(1.5, k))), kC = step(1.5, k).mul(float(1).sub(step(2.5, k))), kG = step(2.5, k);
      const col = mix(paint, vec3(0.13, 0.11, 0.11), max(win, door).mul(kT)).toVar();
      col.assign(mix(col, vec3(0.17, 0.18, 0.19), kR));
      col.assign(mix(col, vec3(0.64, 0.17, 0.15), kC));
      col.assign(mix(col, vec3(1.0, 0.92, 0.65), kG));
      s.albedo = col;
      s.spec = mix(float(0.06), float(0.6), kG); s.gloss = float(30.0); s.fluor = float(0.3);
      s.emis = vec3(2.6, 1.9, 0.9).mul(kG);
    },
  }), 200);
  // the island
  const isl = new Mesh(true), cy = deep ? -9 : -5;
  blob(isl, x, cy, z, (dx, dy, dz) => (dy > 0 ? 7.0 : 7.6) * (1 + 0.18 * noise3(dx * 2.2 + 4, dy * 2.2, dz * 2.2) + 0.08 * noise3(dx * 6, dy * 6, dz * 6 + 2)), 16);
  for (let v = 0; v < isl.count; v++) { const yy = isl.p[v * 3 + 1] - cy; isl.p[v * 3 + 1] = cy + (yy > 0 ? yy * (deep ? 1.25 : 0.9) : yy * 1.3); }
  isl.normals(0, isl.count, 0, null);
  addMesh(ctx, sphereOf(isl.build(), 1), material({
    aux: true, fade: [175, 200],
    surface: (s, f) => {
      rockSurf(s, f.w, f.w, clamp(smoothstep(0.6, 1.4, f.w.y).sub(smoothstep(0.55, 0.85, f.n.y).mul(0.5)).add(0.3), 0.0, 1.0), float(1.0), f.dist);
      s.albedo = mix(s.albedo, vec3(0.40, 0.52, 0.24), smoothstep(0.3, 2.6, f.w.y).mul(smoothstep(0.7, 0.9, f.n.y)).mul(0.85));
    },
  }), 200);
}

// ---- the chain --------------------------------------------------------------------------------

// The rest shape: a catenary from the bow roller down to where it meets the sand, then up to the
// anchor's ring. Sampled at even lengths for chainAt.
function chainShape(bow, ring, foot) {
  const ax = foot[0] - bow[0], az = foot[1] - bow[2], al = Math.hypot(ax, az), ux = ax / al, uz = az / al;
  const T = [foot[0] - ux * 1.6, 0, foot[1] - uz * 1.6];
  T[1] = groundY(T[0], T[2]) + 0.05;
  const L = Math.hypot(bow[0] - T[0], bow[2] - T[2]), H = bow[1] - T[1];
  let lo = 0.3, hi = 300;
  for (let i = 0; i < 60; i++) { const a = (lo + hi) / 2; if (a * (Math.cosh(L / a) - 1) > H) lo = a; else hi = a; }
  const a = (lo + hi) / 2, Sh = a * Math.sinh(L / a);
  const px = (bow[0] - T[0]) / L, pz = (bow[2] - T[2]) / L;
  const N = 300, pts = [];
  for (let i = 0; i <= N; i++) {
    const u = a * Math.asinh((Sh * (1 - i / N)) / a);
    const x = T[0] + px * u, z = T[2] + pz * u;
    pts.push([x, Math.max(T[1] + a * (Math.cosh(u / a) - 1), groundY(x, z) + 0.05), z]);
  }
  const M = 60, mid = [T[0] + ux * 0.6, T[1] + 0.04, T[2] + uz * 0.6];
  for (let i = 1; i <= M; i++) {
    const t = i / M, a0 = (1 - t) * (1 - t), a1 = 2 * t * (1 - t), a2 = t * t;
    pts.push([a0 * T[0] + a1 * mid[0] + a2 * ring[0], a0 * T[1] + a1 * mid[1] + a2 * ring[1], a0 * T[2] + a1 * mid[2] + a2 * ring[2]]);
  }
  const acc = runLength(pts);
  return { all: pts, acc, total: acc[acc.length - 1], hang: acc[N], plane: [px, pz] };
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
  const col = mix(vec3(0.74, 0.33, 0.13), vec3(0.42, 0.17, 0.07), flake).toVar();
  col.assign(mix(col, vec3(0.86, 0.46, 0.20), smoothstep(0.62, 0.78, E.m).mul(0.5)));
  s.albedo = col.mul(E.h.mul(0.25).mul(near).add(0.9));
  s.n = normalize(s.n.add(D.n.sub(s.n).mul(0.7)).add(E.n.sub(s.n).mul(near.mul(0.6)))).toVar();
  s.ao = D.h.mul(0.4).add(0.68).min(1.0);
  s.spec = float(0.08); s.gloss = float(18.0); s.fluor = float(0.55);
}

function buildChain(ctx, q, bow, ring, foot) {
  const C = chainShape(bow, ring, foot);
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
  for (const z of [-0.9, 0.9]) blob(m, 0, stockY, z, () => 0.1, 4, (x, yy, zz, o) => { o[0] = x; o[1] = yy + 3; });
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

// ---- the giant clam ---------------------------------------------------------------------------

// The Clam Studio: a giant clam crocheted in orange, two valves hinged at the back, the upper
// one lifted, their rims ruffled the way hyperbolic crochet ruffles; a paler, softly lit
// inside, and a little cushion in the middle where the studio's object sits.
const CLAM = { x: 5.9, z: -178.0, a: 2.15, b: 1.7, depth: 0.62, open: 1.08, face: [-0.42, 0.91] };
function buildClam(ctx, q) {
  const { a, b, depth } = CLAM;
  const fl = Math.hypot(CLAM.face[0], CLAM.face[1]), fx = CLAM.face[0] / fl, fz = CLAM.face[1] / fl;
  // the clam's frame: local z toward `face`, x to its right
  const ex = [fz, 0, -fx], ez = [fx, 0, fz];
  const gy = groundY(CLAM.x, CLAM.z), tilt = 0.12;                     // tipped a little toward us
  const O = [CLAM.x, gy + depth * 0.62, CLAM.z];
  const toW = (x, y, z) => {
    const yy = y * Math.cos(tilt) + z * Math.sin(tilt), zz = -y * Math.sin(tilt) + z * Math.cos(tilt);
    return [O[0] + ex[0] * x + ez[0] * zz, O[1] + yy, O[2] + ex[2] * x + ez[2] * zz];
  };
  const NU = q.amount >= 0.5 ? 220 : 140, NV = 16, thick = 0.035;
  const ORANGE = [1.0, 0.44, 0.10], PEACH = [1.0, 0.58, 0.34], DEEP = [0.94, 0.34, 0.08];
  const y = new TMesh();
  // one valve's surface, before it is offset into two faces of yarn: (u round, v out) -> local
  const shape = (u, v, upper) => {
    const ph = u * TAU, sv = v;
    const front = (1 + Math.cos(ph)) / 2;                               // 1 at the front, 0 at the hinge
    const ruff = Math.pow(sv, 2.6) * (0.25 + 0.75 * front) * (1 - Math.pow(1 - front, 6) * 0.9);
    const k1 = Math.sin(ph * 9 + 0.6), k2 = Math.sin(ph * 23 + 1.9 + k1);
    const h = ruff * (0.46 * k1 + 0.13 * k2) * (upper ? 0.9 : 1);
    const rr = sv * (1 + 0.05 * ruff * Math.cos(ph * 9 + 0.6) + 0.04 * Math.sin(ph * 4));
    const x = a * rr * Math.sin(ph), z = b * rr * Math.cos(ph);
    const yb = -depth * (1 - sv * sv) + h + 0.12 * sv * sv * front;
    return [x, yb, z];
  };
  const valve = (upper) => {
    const tmp = new Mesh(false);
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
      const v = Math.pow(j / NV, 0.8), P = shape(i / NU, v, upper);
      let [x, yy, z] = P;
      if (upper) {
        // mirrored to close over the lower valve, then swung open about the hinge at the back
        yy = -yy; const zp = z + b, c = Math.cos(CLAM.open), s2 = Math.sin(CLAM.open);
        const y2 = yy * c + zp * s2, z2 = -yy * s2 + zp * c - b; yy = y2; z = z2;
      }
      tmp.vert(x, yy, z, 0, 1, 0);
    }
    const W = NU + 1;
    for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) { const k = j * W + i; tmp.i.push(k, k + W, k + 1, k + 1, k + W, k + W + 1); }
    tmp.normals(0, tmp.count, 0, { cols: NU, rows: NV, base: 0 });
    // the side of the surface that is the inside of the cup
    const inSign = upper ? -1 : 1;
    for (const layer of [1, -1]) {
      const inner = layer === inSign, base = y.count;
      for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++) {
        const k = j * W + i, v = j / NV;
        let nx = tmp.n[k * 3], ny = tmp.n[k * 3 + 1], nz = tmp.n[k * 3 + 2];
        if (upper) { /* (normals came from the swung shape already) */ }
        const px = tmp.p[k * 3] + nx * thick * 0.5 * layer, py = tmp.p[k * 3 + 1] + ny * thick * 0.5 * layer, pz = tmp.p[k * 3 + 2] + nz * thick * 0.5 * layer;
        const P = toW(px, py, pz), N = toW(nx * layer, ny * layer, nz * layer).map((vv, e) => vv - toW(0, 0, 0)[e]);
        const col = inner ? PEACH.map((c0, e) => lerp(c0, ORANGE[e], Math.pow(v, 3))) : DEEP.map((c0, e) => lerp(c0, ORANGE[e], v));
        y.paint([...col, 0], [...col, inner ? 1 - v * v : 0]);
        y.vert(P[0], P[1], P[2], N[0], N[1], N[2], 0, 0, 0, 0, 1, 0);
      }
      for (let j = 0; j < NV; j++) for (let i = 0; i < NU; i++) {
        const k = base + j * W + i;
        if (layer > 0) y.i.push(k, k + W, k + 1, k + 1, k + W, k + W + 1); else y.i.push(k, k + 1, k + W, k + 1, k + W + 1, k + W);
      }
    }
    // the rim: a soft roll of yarn along the edge
    const rim = [];
    for (let i = 0; i < NU; i++) { const k = NV * W + i; const P = toW(tmp.p[k * 3], tmp.p[k * 3 + 1], tmp.p[k * 3 + 2]); rim.push([P[0], P[1], P[2], thick * 0.62]); }
    y.paint(ORANGE, [...ORANGE, 0]);
    sweep(y, rim, 6, { closed: true, up: [0, 1, 0] });
  };
  valve(false);
  valve(true);
  // the hinge: a fat roll across the back
  y.paint(DEEP, [...DEEP, 0]);
  { const A = toW(-a * 0.55, -0.06, -b * 0.98), B = toW(a * 0.55, -0.06, -b * 0.98); sweep(y, [[A[0], A[1], A[2], 0.16], [(A[0] + B[0]) / 2, A[1] + 0.03, (A[2] + B[2]) / 2, 0.19], [B[0], B[1], B[2], 0.16]], 12, { caps: true }); }
  // the stage: a little round cushion in the middle
  const stage = toW(0, -depth + 0.16, 0.1);
  y.paint([0.98, 0.90, 0.78], [0.98, 0.90, 0.78, 0.6]);
  blob(y, stage[0], stage[1], stage[2], (dx, dy, dz) => 1 / Math.sqrt((dx / 0.5) ** 2 + (dy / 0.14) ** 2 + (dz / 0.5) ** 2), 10);
  const geo = sphereOf(y.build(), 0.5);
  addMesh(ctx, geo, yarnMat({
    fade: [82, 98], scale: 14,
    // the inside glows a little, warm, strongest deep in the cup (tint2.w)
    surface: (s, f) => { s.emis = s.emis.add(vec3(1.0, 0.55, 0.32).mul(vT2.w.mul(vT2.w)).mul(0.22)); },
  }), 98);
  // a soft light over the stage
  addMesh(ctx, halos([stage[0], stage[1] + 0.35, stage[2]], 1.6), material({
    additive: true, shadow: false, fade: [70, 90],
    vertex: (v) => haloVertex(v, 1.6),
    raw: (f) => { const d = length(vHalo); return { color: vec3(1.0, 0.62, 0.36).mul(exp(d.mul(d).mul(-4.0)).mul(0.22)).mul(exp(SIG.mul(f.dist).negate())), alpha: float(1.0) }; },
  }), 90, { noShadow: true });
  const up = toW(0, 1, 0).map((vv, e) => vv - toW(0, 0, 0)[e]);
  const front = toW(0, 0, 1).map((vv, e) => vv - toW(0, 0, 0)[e]);
  const normal = V(up[0] * 0.75 + front[0] * 0.66, up[1] * 0.75 + front[1] * 0.66, up[2] * 0.75 + front[2] * 0.66).normalize();
  return { position: V(stage[0], stage[1] + 0.14, stage[2]), normal };
}

// ---- the vents --------------------------------------------------------------------------------

// The chimneys stand as rock already (rocks.js); here they get their fire: glowing cracks
// over their surface, hottest at the mouth and among the coals at the foot, a glow at each
// mouth, and smoke. The two biggest clusters light what is round them (glow slots 1 and 2).
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
    for (let k = 0; k < I.length; k += 3) {
      const a = I[k], b = I[k + 1], c = I[k + 2];
      if (!(keep[a] && keep[b] && keep[c])) continue;
      for (const v of [a, b, c]) {
        pos.push(P[v * 3] + N[v * 3] * 0.025, P[v * 3 + 1] + N[v * 3 + 1] * 0.025, P[v * 3 + 2] + N[v * 3 + 2] * 0.025);
        nrm.push(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]);
        aux.push(rel[v], ci, A.height, 0);
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
        // two planes of cracks, blended by which way the rock faces; wobbled by the relief texture
        const wob = texture(G.detailTex, f.w.xz.mul(0.09).add(f.w.y.mul(0.05))).toVar();
        const pa = vec2(f.w.x, f.w.y.mul(0.7)).mul(1.05).add(wob.rg.sub(0.5).mul(1.2)), pb = vec2(f.w.z, f.w.y.mul(0.7)).mul(1.05).add(wob.gr.sub(0.5).mul(1.2));
        const ea = cellEdge(pa), eb = cellEdge(pb);
        const wx = abs(f.n.z), wz = abs(f.n.x);
        const e = ea.mul(wx).add(eb.mul(wz)).div(wx.add(wz).add(1e-3)).toVar();
        // how wide a crack shows: wider where it is hotter, never thinner than a pixel can hold
        const fw = max(fwidth(pa.x).add(fwidth(pa.y)), 0.004).toVar();
        // hot toward the mouth and among the coals at the foot; between, only a crack here and there
        const patch = smoothstep(0.48, 0.66, wob.a.add(wob.b.mul(0.35)).sub(0.12));
        const heat = smoothstep(0.55, 1.02, t).mul(1.3).add(float(1).sub(smoothstep(0.0, 0.16, t)).mul(0.55)).add(patch.mul(0.35)).toVar();
        const width = heat.mul(0.06).add(0.012).add(fw.mul(1.2));
        const crack = float(1).sub(smoothstep(width.mul(0.35), width, e)).mul(float(1).sub(smoothstep(0.25, 0.7, fw))).toVar();
        // the lip of the mouth glows all over
        const lip = smoothstep(0.84, 1.02, t);
        const flick = sin(G.time.mul(1.7).add(f.w.y.mul(1.3)).add(f.aux.y.mul(2.1))).mul(0.12).add(0.88);
        const k = max(crack.mul(heat).mul(smoothstep(0.08, 0.3, heat)), lip.mul(0.9)).mul(flick).toVar();
        const col = mix(vec3(0.9, 0.16, 0.03), vec3(1.0, 0.58, 0.16), smoothstep(0.4, 1.3, k.mul(heat)));
        return { color: col.mul(k).mul(2.4).mul(exp(SIG.mul(f.dist).negate())), alpha: float(1.0) };
      },
    }), 130, { noShadow: true });
  }
  // a glow over each mouth
  const mouths = [];
  for (const A of axes) mouths.push(A.mouth[0], A.mouth[1] + 0.3, A.mouth[2]);
  addMesh(ctx, halos(mouths, 2.4), material({
    additive: true, shadow: false,
    vertex: (v) => haloVertex(v, 2.4),
    raw: (f) => { const d = length(vHalo); return { color: vec3(1.0, 0.42, 0.12).mul(exp(d.mul(d).mul(-6.0)).mul(0.5)).mul(exp(SIG.mul(f.dist).negate())), alpha: float(1.0) }; },
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
      const a = puff.mul(smoothstep(0.0, 0.1, age)).mul(float(1).sub(smoothstep(0.45, 1.0, age))).mul(0.5);
      const lit = float(1).sub(smoothstep(0.02, 0.28, age));
      const col = mix(vec3(0.045, 0.04, 0.038), vec3(0.9, 0.36, 0.11), lit.mul(0.85));
      return { color: col.mul(exp(SIG.mul(f.dist).negate())), alpha: min(a, 0.6) };
    },
  }), 130, { noShadow: true });
  // the light of the two biggest clusters on what is round them
  const glow = (slot, list2) => {
    let x = 0, y = 0, z = 0;
    for (const i of list2) { x += axes[i].x; y += axes[i].g + axes[i].height * 0.55; z += axes[i].z; }
    x /= list2.length; y /= list2.length; z /= list2.length;
    G.glowPos.array[slot].set(x + 2.0, y, z + 1.0, 15.0);
    G.glowCol.array[slot].set(1.5, 0.52, 0.14, 0);
  };
  glow(1, [2, 3]);
  glow(2, [5, 6]);
  return axes;
}

// ---- the geode and the diving helmet --------------------------------------------------------

// The geode at the end of the vents: split open, a rough tan rind outside, a band of white
// agate on the cut face, and a hollow lined with crystals that glow from inside (glow slot 3).
// The main half faces the camera at p = 7 with the picture in its hollow; the other half lies
// beside it. Built as shells round a centre: aux.x is the kind (0 rind, 1 agate, 2 hollow).
const GEODE = { x: -4.4, z: -388.7, r: 1.3 };
function geodeHalf(m, crystals, c, Rot, R, seed, rng) {
  const Ri = R * 0.74, NA = 12, NB = 40;
  const lump = (dx, dy, dz) => 1 + 0.07 * noise3(dx * 2.3 + seed, dy * 2.3, dz * 2.3) + 0.035 * noise3(dx * 6 + seed, dy * 6, dz * 6);
  const toW = (x, y, z) => [c[0] + Rot[0] * x + Rot[3] * y + Rot[6] * z, c[1] + Rot[1] * x + Rot[4] * y + Rot[7] * z, c[2] + Rot[2] * x + Rot[5] * y + Rot[8] * z];
  const rot = (x, y, z) => [Rot[0] * x + Rot[3] * y + Rot[6] * z, Rot[1] * x + Rot[4] * y + Rot[7] * z, Rot[2] * x + Rot[5] * y + Rot[8] * z];
  // in its own frame the cut face is the plane z = 0 and the shell lies behind it (z < 0)
  const dirAt = (al, be) => [Math.sin(al) * Math.cos(be), Math.sin(al) * Math.sin(be), -Math.cos(al)];
  for (const [kind, rad, outward] of [[0, R, 1], [2, Ri, -1]]) {
    const base = m.count, i0 = m.i.length;
    for (let i = 0; i <= NA; i++) for (let j = 0; j <= NB; j++) {
      const al = (i / NA) * Math.PI / 2, be = (j / NB) * TAU, d = dirAt(al, be);
      const rr = rad * (kind ? 1 + 0.03 * noise3(d[0] * 5, d[1] * 5, d[2] * 5 + seed) : lump(d[0], d[1], d[2]));
      const P = toW(d[0] * rr, d[1] * rr, d[2] * rr);
      m.vert(P[0], P[1], P[2], 0, 1, 0, 0, 0, kind, rr / R, Math.cos(al), 0);
    }
    const W = NB + 1;
    for (let i = 0; i < NA; i++) for (let j = 0; j < NB; j++) {
      const a = base + i * W + j;
      if (outward > 0) m.i.push(a, a + 1, a + W, a + 1, a + W + 1, a + W); else m.i.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
    }
    m.normals(base, m.count, i0, { cols: NB, rows: NA, base });
  }
  // the cut face: an annulus from the hollow's rim to the rind's, banded
  {
    const base = m.count, N = rot(0, 0, 1);
    for (let j = 0; j <= NB; j++) for (const t of [0, 0.5, 1]) {
      const be = (j / NB) * TAU, d = dirAt(Math.PI / 2, be);
      const ro = R * lump(d[0], d[1], d[2]), ri = Ri * (1 + 0.03 * noise3(d[0] * 5, d[1] * 5, d[2] * 5 + seed));
      const rr = lerp(ri, ro, t), P = toW(d[0] * rr, d[1] * rr, 0);
      m.vert(P[0], P[1], P[2], N[0], N[1], N[2], 0, 0, 1, (rr - ri) / Math.max(ro - ri, 1e-3), 0, 0);
    }
    for (let j = 0; j < NB; j++) for (let t = 0; t < 2; t++) { const a = base + j * 3 + t; triFacing(m, a, a + 3, a + 1, N[0], N[1], N[2]); triFacing(m, a + 1, a + 3, a + 4, N[0], N[1], N[2]); }
  }
  // crystals: points on the hollow's wall, growing toward the centre; bigger deeper in
  for (let k = 0; k < crystals.n; k++) {
    const al = Math.acos(1 - rng() * 0.98) * 0.98, be = rng() * TAU, d = dirAt(Math.min(al, Math.PI / 2 * 0.97), be);
    const deepness = Math.cos(al);
    const len = R * (0.07 + 0.2 * rng() * (0.35 + 0.65 * deepness)), wid = len * rng.range(0.32, 0.5);
    const P = toW(d[0] * Ri * 1.02, d[1] * Ri * 1.02, d[2] * Ri * 1.02);
    const jx = rng.range(-0.35, 0.35), jy = rng.range(-0.35, 0.35), jz = rng.range(-0.35, 0.35);
    const n0 = [-d[0] + jx, -d[1] + jy, -d[2] + jz], nl = Math.hypot(n0[0], n0[1], n0[2]);
    const Dw = rot(n0[0] / nl, n0[1] / nl, n0[2] / nl);
    crystals.list.push(P[0], P[1], P[2], len, Dw[0], Dw[1], Dw[2], wid, rng() * TAU, deepness, rng(), 0);
  }
}
// A rotation (columns x, y, z) that turns local +z toward f, keeping y roughly up.
function frameTo(f) {
  const fl = Math.hypot(f[0], f[1], f[2]), Z = [f[0] / fl, f[1] / fl, f[2] / fl];
  let X = [Z[2], 0, -Z[0]];
  const xl = Math.hypot(X[0], X[1], X[2]) || 1; X = X.map((v) => v / xl);
  const Y = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];
  return [...X, ...Y, ...Z];
}
function buildGeode(ctx, q) {
  const rng = makeRng(808);
  const m = new Mesh(true), crystals = { n: Math.round(330 * Math.max(q.amount, 0.5)), list: [] };
  const R = GEODE.r, gy = groundY(GEODE.x, GEODE.z);
  // the main half: its hollow toward the camera at p = 7, tipped back a little
  const cam = [-4.16, -205.27, -383.0];
  const c1 = [GEODE.x, gy + R * 0.82, GEODE.z];
  const f1 = [cam[0] - c1[0], (cam[1] - c1[1]) * 0.55, cam[2] - c1[2]];
  geodeHalf(m, crystals, c1, frameTo(f1), R, 3.1, rng);
  // the other half, lying on its back to the right, its crystals to the sky
  const c2 = [GEODE.x + 2.45, groundY(GEODE.x + 2.45, GEODE.z - 0.4) + R * 0.86, GEODE.z - 0.4];
  geodeHalf(m, { n: Math.round(crystals.n * 0.6), list: crystals.list }, c2, frameTo([-0.45, 1.0, 0.55]), R * 0.94, 7.7, rng);
  const sh = material({
    aux: true, fade: [80, 98],
    surface: (s, f) => {
      const kind = f.aux.x, rind = float(1).sub(step(0.5, kind)), band = step(0.5, kind).mul(float(1).sub(step(1.5, kind))), hollow = step(1.5, kind);
      const D = detail(f.w, s.n, 1.8, 2.6), E = detail(f.w, s.n, 5.0, 2.0);
      // the rind: warm tan, lumpy, with darker pits
      const rc = mix(vec3(0.70, 0.58, 0.42), vec3(0.50, 0.40, 0.29), smoothstep(0.4, 0.7, D.m)).mul(E.h.mul(0.3).add(0.8));
      // the agate: white and grey bands, following the rim
      const bands = sin(f.aux.y.mul(26.0).add(D.h.mul(3.0))).mul(0.5).add(0.5);
      const ac = mix(vec3(0.80, 0.79, 0.76), vec3(0.50, 0.52, 0.55), bands.mul(smoothstep(0.15, 0.4, f.aux.y)));
      // the hollow's wall: a crust of tiny crystals, glowing
      const hc = vec3(0.70, 0.68, 0.66).mul(E.h.mul(0.35).add(0.75));
      s.albedo = rc.mul(rind).add(ac.mul(band)).add(hc.mul(hollow));
      s.n = normalize(mix(s.n, D.n, rind.mul(0.8).add(0.3))).toVar();
      s.ao = mix(D.h.mul(0.4).add(0.65), float(1.0), band);
      s.spec = mix(float(0.05), float(0.5), hollow.add(band.mul(0.4))); s.gloss = mix(float(14.0), float(60.0), hollow);
      s.fluor = float(0.2);
      const deep = f.aux.z.mul(hollow);
      s.emis = vec3(1.0, 0.82, 0.55).mul(deep.mul(deep).mul(0.32).add(hollow.mul(0.05))).add(vec3(0.9, 0.85, 0.75).mul(band).mul(0.04));
    },
  });
  addMesh(ctx, sphereOf(m.build(), 0.5), sh, 98);
  // the crystals: six-sided points, each a prism and a pyramid, flat-faced
  const cm = new Mesh(true);
  for (let k = 0; k < 6; k++) {
    const a0 = (k / 6) * TAU, a1 = ((k + 1) / 6) * TAU;
    const p0 = [Math.cos(a0), Math.sin(a0)], p1 = [Math.cos(a1), Math.sin(a1)];
    const nx = Math.cos((a0 + a1) / 2), ny = Math.sin((a0 + a1) / 2);
    // the side: (x, y) round, z along (0 foot, 0.72 shoulder)
    const v0 = cm.count;
    cm.vert(p0[0], p0[1], -0.1, nx, ny, 0, 0, 0, 0, 0, 1, 0); cm.vert(p1[0], p1[1], -0.1, nx, ny, 0, 0, 0, 1, 0, 1, 0);
    cm.vert(p1[0], p1[1], 0.72, nx, ny, 0, 0, 0, 1, 0.72, 1, 0); cm.vert(p0[0], p0[1], 0.72, nx, ny, 0, 0, 0, 0, 0.72, 1, 0);
    triFacing(cm, v0, v0 + 1, v0 + 2, nx, ny, 0); triFacing(cm, v0, v0 + 2, v0 + 3, nx, ny, 0);
    // the point's facet
    const tz = 1.0, fnx = nx * 0.68, fny = ny * 0.68, fnz = 0.73;
    const v1 = cm.count;
    cm.vert(p0[0], p0[1], 0.72, fnx, fny, fnz, 0, 0, 0, 0.72, 2, 0); cm.vert(p1[0], p1[1], 0.72, fnx, fny, fnz, 0, 0, 1, 0.72, 2, 0); cm.vert(0, 0, tz, fnx, fny, fnz, 0, 0, 0.5, 1, 2, 0);
    triFacing(cm, v1, v1 + 1, v1 + 2, fnx, fny, fnz);
  }
  const base = cm.build();
  const list = crystals.list, n = list.length / 12;
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
    aux: true, fade: [80, 98],
    vertex: (v) => {
      const D = GB.xyz, len = GA.w, wid = GB.w, spin = GC.x;
      const T0 = normalize(cross(D, select3(abs(D.y).lessThan(0.9)))).toVar();
      const T1 = cross(D, T0).toVar();
      const ca = cos(spin), sa = sin(spin);
      const U = T0.mul(ca).add(T1.mul(sa)).toVar(), W = T1.mul(ca).sub(T0.mul(sa)).toVar();
      v.P.assign(GA.xyz.add(U.mul(v.P.x.mul(wid))).add(W.mul(v.P.y.mul(wid))).add(D.mul(v.P.z.mul(len))));
      v.N.assign(normalize(U.mul(v.N.x).add(W.mul(v.N.y)).add(D.mul(v.N.z.mul(wid.div(len))))));
      vC.assign(vec4(GC.y, GC.z, len, 0.0));
    },
    surface: (s, f) => {
      // clear quartz, a little milky, lit from inside the hollow: bright toward its point
      const along = f.aux.y, edge = abs(f.aux.x.sub(0.5)).mul(2.0);
      const near = float(1).sub(smoothstep(4.0, 16.0, f.dist));
      const vv = normalize(cameraPosition.sub(f.w)), fres = pow(float(1).sub(abs(dot(s.n, vv))), 2.0);
      s.albedo = mix(vec3(0.62, 0.62, 0.62), vec3(0.82, 0.78, 0.72), along);
      s.spec = float(1.2); s.gloss = float(80.0); s.trans = float(0.6); s.fluor = float(0.1);
      const deep = vC.x;
      s.emis = vec3(1.0, 0.84, 0.58).mul(deep.mul(deep).mul(0.45).add(0.05)).mul(along.mul(0.8).add(0.4))
        .add(vec3(1.0, 0.95, 0.85).mul(smoothstep(0.82, 0.97, edge).mul(near).mul(0.22)))
        .add(vec3(0.9, 0.9, 1.0).mul(fres.mul(0.1)));
    },
  }), 98);
  // the glow: light from the hollow (slot 3), and a soft haze in it
  const fl = Math.hypot(f1[0], f1[1], f1[2]), N = [f1[0] / fl, f1[1] / fl, f1[2] / fl];
  const glowAt = [c1[0] + N[0] * 1.3, c1[1] + N[1] * 1.3 + 0.2, c1[2] + N[2] * 1.3];
  G.glowPos.array[3].set(glowAt[0], glowAt[1], glowAt[2], 9.0);
  G.glowCol.array[3].set(1.0, 0.8, 0.55, 0);
  addMesh(ctx, halos([c1[0] + N[0] * 0.1, c1[1] + N[1] * 0.1, c1[2] + N[2] * 0.1], 1.9), material({
    additive: true, shadow: false, fade: [70, 90],
    vertex: (v) => haloVertex(v, 1.9),
    raw: (f) => { const d = length(vHalo); return { color: vec3(1.0, 0.82, 0.55).mul(exp(d.mul(d).mul(-5.0)).mul(0.12)).mul(exp(SIG.mul(f.dist).negate())), alpha: float(1.0) }; },
  }), 90, { noShadow: true });
  // where the picture goes: in the main half's hollow, set back from the cut face
  const size = 1.12;
  return { position: V(c1[0] - N[0] * 0.16, c1[1] - N[1] * 0.16, c1[2] - N[2] * 0.16), normal: V(N[0], N[1], N[2]), size };
}
const select3 = (cond) => vec3(0.0, 1.0, 0.0).mul(cond.select(1.0, 0.0)).add(vec3(1.0, 0.0, 0.0).mul(cond.select(0.0, 1.0)));

// A brass diving helmet on the black sand by the geode: the dome with its three ports, the
// breastplate and its bolts, a valve at the back.
function buildHelmet(ctx) {
  const m = new Mesh(true), x = GEODE.x + 3.3, z = GEODE.z - 1.6, gy = groundY(x, z);
  const yaw = -0.75, tilt = 0.14, S = 1.0;
  const toW = (px, py, pz) => {
    const y1 = py * Math.cos(tilt) - pz * Math.sin(tilt), z1 = py * Math.sin(tilt) + pz * Math.cos(tilt);
    return [x + (px * Math.cos(yaw) + z1 * Math.sin(yaw)) * S, gy - 0.08 + y1 * S, z + (-px * Math.sin(yaw) + z1 * Math.cos(yaw)) * S];
  };
  const K = (kind) => (k, j, px, py, pz, o) => { o[0] = kind; };
  const place = (from) => { for (let v = from; v < m.count; v++) { const P = toW(m.p[v * 3], m.p[v * 3 + 1], m.p[v * 3 + 2]); const N = toW(m.n[v * 3], m.n[v * 3 + 1], m.n[v * 3 + 2]).map((vv, e) => (vv - toW(0, 0, 0)[e]) / S); m.p[v * 3] = P[0]; m.p[v * 3 + 1] = P[1]; m.p[v * 3 + 2] = P[2]; m.n[v * 3] = N[0]; m.n[v * 3 + 1] = N[1]; m.n[v * 3 + 2] = N[2]; } };
  const v0 = m.count;
  // the breastplate: a broad bell
  sweep(m, [[0, 0.0, 0, 0.62], [0, 0.12, 0, 0.6], [0, 0.26, 0, 0.5], [0, 0.36, 0, 0.36], [0, 0.4, 0, 0.3]], 24, { up: [1, 0, 0], aux: K(0) });
  // the dome
  blob(m, 0, 0.72, 0, (dx, dy, dz) => 0.38 * (dy < -0.5 ? 1.0 : 1.0) * (1 + 0.06 * Math.max(dy, 0)), 10, (dx, dy, dz, o) => { o[0] = 0; });
  // the ports: a thick brass ring and a glass in each, front and sides; a little one on top
  for (const [dx, dy, dz, rr] of [[0, 0, 1, 0.17], [1, 0, 0.15, 0.12], [-1, 0, 0.15, 0.12], [0, 0.85, 0.5, 0.08]]) {
    const l = Math.hypot(dx, dy, dz), d = [dx / l, dy / l, dz / l], c = [d[0] * 0.38, 0.72 + d[1] * 0.38, d[2] * 0.38];
    const ring = [];
    const u = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let a = [u[1] * d[2] - u[2] * d[1], u[2] * d[0] - u[0] * d[2], u[0] * d[1] - u[1] * d[0]]; const al = Math.hypot(...a); a = a.map((vv) => vv / al);
    const bv = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]];
    for (let i = 0; i < 18; i++) { const t = (i / 18) * TAU; ring.push([c[0] + (a[0] * Math.cos(t) + bv[0] * Math.sin(t)) * rr + d[0] * 0.04, c[1] + (a[1] * Math.cos(t) + bv[1] * Math.sin(t)) * rr + d[1] * 0.04, c[2] + (a[2] * Math.cos(t) + bv[2] * Math.sin(t)) * rr + d[2] * 0.04, 0.035]); }
    sweep(m, ring, 6, { closed: true, up: d, aux: K(0) });
    const g0 = m.count;
    m.vert(c[0] + d[0] * 0.03, c[1] + d[1] * 0.03, c[2] + d[2] * 0.03, d[0], d[1], d[2], 0, 0, 1, 0, 0, 0);
    for (let i = 0; i <= 18; i++) { const t = (i / 18) * TAU; m.vert(c[0] + (a[0] * Math.cos(t) + bv[0] * Math.sin(t)) * rr, c[1] + (a[1] * Math.cos(t) + bv[1] * Math.sin(t)) * rr, c[2] + (a[2] * Math.cos(t) + bv[2] * Math.sin(t)) * rr, d[0], d[1], d[2], 0, 0, 1, 0, 0, 0); }
    for (let i = 0; i < 18; i++) triFacing(m, g0, g0 + 1 + i, g0 + 2 + i, d[0], d[1], d[2]);
    if (rr > 0.15) for (const off of [-0.07, 0, 0.07]) {      // the grille across the front port
      sweep(m, [[c[0] + a[0] * 0.17 + bv[0] * off + d[0] * 0.05, c[1] + a[1] * 0.17 + bv[1] * off + d[1] * 0.05, c[2] + a[2] * 0.17 + bv[2] * off + d[2] * 0.05, 0.013], [c[0] - a[0] * 0.17 + bv[0] * off + d[0] * 0.05, c[1] - a[1] * 0.17 + bv[1] * off + d[1] * 0.05, c[2] - a[2] * 0.17 + bv[2] * off + d[2] * 0.05, 0.013]], 5, { aux: K(0) });
    }
  }
  // bolts round the breastplate, a valve at the back
  for (let i = 0; i < 10; i++) { const t = (i / 10) * TAU; blob(m, Math.cos(t) * 0.55, 0.13, Math.sin(t) * 0.55, () => 0.04, 2); }
  sweep(m, [[0, 0.8, -0.36, 0.05], [0, 0.84, -0.5, 0.05]], 8, { caps: true, aux: K(0) });
  place(v0);
  addMesh(ctx, sphereOf(m.build(), 0.3), material({
    aux: true, fade: [80, 98],
    surface: (s, f) => {
      const glass = step(0.5, f.aux.x);
      brassSurf(s, f, 0.35);
      s.albedo = mix(s.albedo, vec3(0.05, 0.07, 0.08), glass);
      s.spec = mix(s.spec, float(1.4), glass); s.gloss = mix(s.gloss, float(90.0), glass);
    },
  }), 98);
}

// ---- all of it ----------------------------------------------------------------------------------

export function buildSets(ctx) {
  const t0 = performance.now();
  const { q } = ctx;
  const start = buildMarina(ctx, q, MARINA_START, { seed: 5150, anchor: true });
  buildMarina(ctx, q, MARINA_END, { seed: 7272, lights: true, deep: true });
  // the chain: from the moored sailboat's bow roller down to the anchor in the sand
  const mo = start.moored;
  const bow = mo.at(0, mo.sheerAt(1) + 0.08, mo.len / 2 + 0.06);
  const tw = [mo.x - ANCHOR.x, mo.z - ANCHOR.z], tl = Math.hypot(tw[0], tw[1]);
  // (the arms turned 40 degrees from square to the way the camera comes, so arms and stock both show)
  const fa = Math.atan2(-0.9, 0.435) + 0.7;
  const ring = buildAnchor(ctx, [ANCHOR.x, ANCHOR.z], [tw[0] / tl, tw[1] / tl], [Math.cos(fa), Math.sin(fa)]);
  const chain = buildChain(ctx, q, bow, ring, [ANCHOR.x, ANCHOR.z]);
  const clam = buildClam(ctx, q);
  buildVents(ctx, q);
  const geode = buildGeode(ctx, q);
  buildHelmet(ctx);
  if (typeof DEV !== 'undefined' && DEV) console.log('sets ' + Math.round(performance.now() - t0) + ' ms');
  return {
    update(t) { chain.setTime(t); },
    chainAt: chain.chainAt,
    clam, geode,
  };
}
