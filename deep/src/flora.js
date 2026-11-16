// What grows: the kelp forest, the sea grass, the reef's corals, sponges, fans and
// anemones, and what lies about on the sand.
//
// Kelp and grass are blades. A blade is never stored: the vertex shader builds each one
// from three numbers-of-four (where its plant stands and how tall it is; where on the
// stalk it hangs, which way, how long and wide; its own seed, droop and colour), bends it
// along a curve, twists and ruffles it, and moves it with the water. The kelp is knitted:
// a few thick stalks, a big yarn ball where each blade leaves its stalk, and wide felt
// ribbons that the light comes through. Near the camera the kelp moves slowly and bends
// out of the way: no blade comes within two metres of the lens or crosses the line from it
// to Snap (G.snapAt). Blades are kept in cells on the ground: a cell out of view or out of
// range is not drawn, and far away blades are thinned out by folding them away gradually.
//
// The reef is made of shapes grown here from tubes, lathes and blobs, each drawn many
// times over with its own place, size and colour.
import { BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh as ThreeMesh, Quaternion, Sphere, Vector3 } from 'three/webgpu';
import {
  Discard, If, abs, attribute, cameraPosition, clamp as clampN, cos, cross, dot, float, floor, fract, length, max, mix, normalize, pow, select, sin, smoothstep, sqrt, step,
  texture, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';
import { CLEARINGS, centerX, cleared, groundY, halfWidth, offTrack, pathAt } from './layout.js';
import { Mesh, TAU, clamp, fbm2, fbm3, lathe, makeRng, noise2, noise3, smooth, tube } from './math.js';
import { orb, perches } from './rocks.js';
import { G, detail, material, shadow1, sunAt, yarn } from './shaders.js';
import { instanced, place } from './world.js';

// Colours are written as they look in the pictures (sRGB) and used as light (linear): the
// picture's colour, to the power 2.2.
const lin = (c) => c.map((v) => Math.pow(v, 2.2));
const linV = (r, g, b) => vec3(...lin([r, g, b]));

// ---- blades ----------------------------------------------------------------------------

// ia: the plant (x, y, z of its foot, and its height); ib: the blade (how far up the stalk
// 0..1, which way it faces, its length, its width); ic: its seed, its droop, its colour (or
// for grass its kind), the plant's seed.
const ia = attribute('ia', 'vec4'), ib = attribute('ib', 'vec4'), ic = attribute('ic', 'vec4');

// A soft maximum of a and b, with a knee k wide (TSL).
const smax = (a, b, k) => a.add(b).add(sqrt(a.sub(b).mul(a.sub(b)).add(k * k))).mul(0.5);
// What to add to a point B to keep it out of a capsule round the segment from C along ax
// (L2: its length squared) whose radius goes from R0 at C to R1 at the far end. It moves
// along pd, square to the segment, toward the side its plant stands on, so that every point
// of a blade moves the same way and the blade bends away whole instead of tearing.
function capsulePush(B, C, ax, L2, pd, R0, R1) {
  const tb = clampN(dot(B.sub(C), ax).div(L2), 0.0, 1.0);
  const rb = B.sub(C.add(ax.mul(tb))).toVar();
  const R = mix(float(R0), float(R1), tb).toVar();
  const y = dot(rb, pd).toVar();
  const lat = dot(rb, rb).sub(y.mul(y));
  return pd.mul(smax(y, R, 0.6).sub(y).mul(float(1).sub(smoothstep(R.mul(R), R.mul(R).mul(2.6), lat))));
}
// The direction square to the segment (C along ax) toward A: the side a plant stands on.
function sideOf(A, C, ax, L2) {
  const ta = clampN(dot(A.sub(C), ax).div(L2), 0.0, 1.0);
  const ra = A.sub(C.add(ax.mul(ta))).toVar();
  return normalize(ra.sub(ax.mul(dot(ra, ax).div(L2))).add(vec3(0.0, 1e-3, 0.0)));
}
// How calm the water is round a plant: near the camera everything sways less, so that what
// is close does not sweep across the view.
const calmAt = (v, foot) => (v.shadow ? float(1.0) : smoothstep(2.5, 10.0, length(foot.xz.sub(cameraPosition.xz))).mul(0.7).add(0.3));

// Where the stalk is at a height: it leans with the water, more the higher, and is never
// quite straight. (written out where it is used: a function of its own would not see the
// time in the vertex stage)
const stemAt = (base, hh, seed, calm) => {
  const ph = G.time.mul(0.42).add(base.x.mul(0.13)).add(base.z.mul(0.09)).add(seed.mul(6.28)).toVar();
  const a = pow(hh, 1.2).mul(0.024).mul(calm);
  const sway = vec2(sin(ph).add(sin(ph.mul(1.9).add(1.3)).mul(0.3)), cos(ph.mul(0.83).add(0.6)).mul(0.7)).mul(a);
  const bend = vec2(sin(hh.mul(0.19).add(seed.mul(40.0))), cos(hh.mul(0.15).add(seed.mul(23.0)))).mul(smoothstep(0.0, 6.0, hh).mul(0.7));
  return base.add(vec3(sway.x.add(bend.x), hh, sway.y.add(bend.y)));
};
// a stalk's radius at its foot, and a float's radius
const stalkR = (ps) => mix(float(0.21), float(0.3), fract(ps.mul(7.31)));
const floatR = (seed, h) => mix(float(0.44), float(0.62), fract(seed.mul(3.71))).mul(float(1.0).sub(h.mul(0.25)));

// The kelp's blades: felt ribbons, in the colours of the picture.
const KELP = [[0.96, 0.62, 0.18], [0.96, 0.46, 0.16], [0.92, 0.46, 0.56], [0.18, 0.62, 0.62], [0.58, 0.36, 0.74], [0.64, 0.60, 0.24], [0.84, 0.64, 0.24]].map(lin);
const KELP_W = [0.17, 0.08, 0.12, 0.12, 0.11, 0.2, 0.2];
const pickKelp = (r) => { let a = 0; for (let i = 0; i < KELP_W.length; i++) { a += KELP_W[i]; if (r < a) return i; } return KELP_W.length - 1; };
const palette = (k, list) => {
  let c = vec3(...list[list.length - 1]);
  for (let i = list.length - 2; i >= 0; i--) c = select(k.lessThan(i + 0.5), vec3(...list[i]), c);
  return c;
};
const vBlade = varyingProperty('vec4', 'v_kelp');

const kelpBladeMat = () => material({
  twoSided: true, fade: [56, 72],
  vertex: (v) => {
    const t = v.P.y.toVar(), u = v.P.x.toVar(), seed = ic.x, h = ib.x, L = ib.z;
    const calm = calmAt(v, ia.xyz).toVar();
    const S = stemAt(ia.xyz, h.mul(ia.w), ic.w, calm).toVar();
    const D = vec3(cos(ib.y), 0.0, sin(ib.y)).toVar(), U = vec3(0.0, 1.0, 0.0), W0 = vec3(D.z.negate(), 0.0, D.x).toVar();
    const rf = floatR(seed, h);
    // it leaves its float on the far side from the stalk
    const A = S.add(D.mul(stalkR(ic.w).mul(float(1).sub(h.mul(0.35))).add(rf.mul(1.35)))).toVar();
    const C = cameraPosition;
    // far away, fewer blades: each folds away into its float at its own distance, gradually
    const far = v.shadow ? float(0.0) : smoothstep(26.0, 60.0, length(A.sub(C)));
    const thr = fract(seed.mul(7.13));
    const keep = float(1.0).sub(smoothstep(float(0.92).sub(thr), float(1.06).sub(thr), far.mul(0.72))).toVar();
    // out and up from the float, then over and down; streaming with the water
    const ph = G.time.mul(seed.mul(0.25).add(0.45)).add(seed.mul(30.0)).add(S.x.mul(0.2)).add(S.z.mul(0.13)).toVar();
    const c1 = D.mul(0.24).add(U.mul(0.34)).toVar();
    const c2 = D.mul(0.42).add(U.mul(float(0.3).sub(ic.y.mul(1.25)))).toVar();
    c2.addAssign(vec3(0.16, 0.0, 0.11).mul(sin(ph.mul(0.6))).add(U.mul(sin(ph).mul(0.04))).mul(calm));
    const omt = float(1.0).sub(t);
    const Q = c1.mul(omt.mul(t).mul(2.0)).add(c2.mul(t.mul(t))).mul(L.mul(keep));
    const T = normalize(c1.mul(omt.sub(t).mul(2.0)).add(c2.mul(t.mul(2.0)))).toVar();
    const B = A.add(Q).toVar();
    if (!v.shadow) {
      // out of the way: two metres round the lens, and the corridor from the lens to Snap
      const pc = normalize(A.sub(C));
      const yc = dot(B.sub(C), pc).toVar();
      const latc = dot(B.sub(C), B.sub(C)).sub(yc.mul(yc));
      B.addAssign(pc.mul(smax(yc, float(2.1), 0.7).sub(yc).mul(float(1).sub(smoothstep(4.4, 12.0, latc)))));
      const ax = G.snapAt.xyz.sub(C).toVar(), L2 = max(dot(ax, ax), 1e-3).toVar();
      // (only once Snap's place is known: until then G.snapAt sits a kilometre down)
      B.addAssign(capsulePush(B, C, ax, L2, sideOf(A, C, ax, L2), 1.35, 0.95).mul(step(-900.0, G.snapAt.y)));
    }
    const N0 = normalize(cross(W0, T)).toVar();
    const tw = seed.sub(0.5).mul(2.2).mul(t).add(sin(ph.add(t.mul(2.4))).mul(0.25).mul(calm)).toVar();
    const W = W0.mul(cos(tw)).add(N0.mul(sin(tw))).toVar(), Nn = N0.mul(cos(tw)).sub(W0.mul(sin(tw))).toVar();
    // a narrow stem at the float, wide, then a long point; ruffled at the edges, a little cupped
    const near = v.shadow ? float(1.0) : smoothstep(1.7, 2.6, length(A.sub(C)));
    const wd = ib.w.mul(smoothstep(0.0, 0.1, t).mul(0.7).add(0.3)).mul(float(1.0).sub(pow(t, 5.0).mul(0.92))).mul(keep).mul(near).toVar();
    const rp = t.mul(L).mul(2.6).add(seed.mul(50.0)).sub(G.time.mul(calm).mul(0.8)).toVar(), edge = pow(abs(u), 1.5).toVar();
    const P = B.add(W.mul(u.mul(wd))).add(Nn.mul(sin(rp).mul(0.22).mul(wd).mul(edge).add(u.mul(u).sub(0.4).mul(0.12).mul(wd))));
    v.P.assign(P);
    v.N.assign(normalize(Nn.add(W.mul(u).mul(0.3)).sub(T.mul(cos(rp)).mul(0.45).mul(edge))));
    v.aux.assign(vec4(t, u, ic.z.add(seed.mul(0.9)), L));
    vBlade.assign(vec4(ib.w, ic.w, 0.0, 0.0));
  },
  surface: (s, f) => {
    const t = f.aux.x, u = f.aux.y, L = f.aux.w, k = floor(f.aux.z);
    const col = palette(k, KELP).mul(fract(f.aux.z).mul(0.16).add(0.92)).toVar();
    // felt: a soft mottle, a midrib and veins running out to the edges, darker near the float
    const q = vec2(u.mul(vBlade.x), t.mul(L));
    const m = texture(G.detailTex, q.mul(1.3).add(vBlade.y)).toVar();
    const sv = abs(fract(t.mul(L).mul(2.3).sub(abs(u).mul(0.9))).sub(0.5)).mul(2.0);
    const vein = float(1).sub(smoothstep(0.0, 0.14, sv)).mul(smoothstep(0.08, 0.22, abs(u))).mul(float(1).sub(smoothstep(0.7, 0.92, abs(u))));
    const mid = float(1).sub(smoothstep(0.03, 0.1, abs(u)));
    // (the veins darker and redder, as in the picture's amber blade)
    s.albedo = col.mul(m.a.mul(0.24).add(0.88)).mul(mix(vec3(1.0), vec3(0.78, 0.5, 0.5), max(vein, mid).mul(0.55))).mul(smoothstep(0.0, 0.25, t).mul(0.25).add(0.75));
    s.n = normalize(s.n.add(vec3(m.r.sub(0.5), 0.0, m.g.sub(0.5)).mul(0.25)));
    s.ao = smoothstep(0.0, 0.3, t).mul(0.3).add(0.7);
    s.spec = float(0.02); s.gloss = float(6.0); s.fluor = float(0.95);
    const sh = shadow1(f.w.add(G.sunDir.mul(0.3))).toVar();
    s.shade = sh; s.trans = float(0.75);
    // felt is thin: the light comes through it, most of all looking toward the sun
    const vv = normalize(f.w.sub(cameraPosition));
    const toward = pow(max(dot(vv, G.sunDir), 0.0), 3.0);
    // (and seen from below, against the light above, it glows like stained glass)
    const below = smoothstep(-0.1, 0.6, vv.y);
    s.emis = s.emis.add(sunAt(f.w.y).mul(sh.mul(0.8).add(0.2)).mul(toward.mul(0.45).add(below.mul(0.16)).add(0.06)).mul(s.albedo).mul(s.albedo).mul(1.3));
    const graze = pow(float(1.0).sub(abs(dot(s.n, vv))), 3.0);
    s.emis = s.emis.add(G.amb.mul(0.18).mul(graze).mul(s.albedo));
  },
});
// The stalks: knitted, olive and ochre in long sections.
const kelpStalkMat = () => material({
  fade: [62, 76],
  vertex: (v) => {
    const p0 = v.P.toVar();
    const calm = calmAt(v, ia.xyz);
    const r = stalkR(ic.w).mul(float(1).sub(p0.y.mul(0.35))).toVar();
    const C = stemAt(ia.xyz, p0.y.mul(ia.w), ic.w, calm);
    v.N.assign(vec3(p0.x, 0.0, p0.z));
    v.P.assign(C.add(vec3(p0.x, 0.0, p0.z).mul(r)));
    // (its stitches are laid on the stalk as it stands, unbent, so they stay on it as it sways)
    v.aux.assign(vec4(ia.x.add(p0.x.mul(r)), ia.y.add(p0.y.mul(ia.w)), ia.z.add(p0.z.mul(r)), ic.w));
  },
  surface: (s, f) => {
    const k = fract(f.aux.w.mul(5.3)).mul(0.14).add(0.93);
    yarn(s, f, { color: linV(0.80, 0.56, 0.20).mul(k), color2: linV(0.90, 0.68, 0.26).mul(k), stripe: 14, scale: 16, p: f.aux.xyz, k: 1.4 });
    s.shade = shadow1(f.w.add(G.sunDir.mul(0.2)));
    s.fluor = float(0.7);
  },
});
// The floats: big yarn balls where each blade leaves the stalk.
const kelpFloatMat = () => material({
  fade: [50, 64],
  vertex: (v) => {
    const h = ib.x, calm = calmAt(v, ia.xyz);
    const S = stemAt(ia.xyz, h.mul(ia.w), ic.w, calm);
    const D = vec3(cos(ib.y), 0.0, sin(ib.y));
    const rf = floatR(ic.x, h).toVar();
    v.P.assign(S.add(D.mul(stalkR(ic.w).mul(float(1).sub(h.mul(0.35))).add(rf.mul(0.55)))).add(v.P.mul(rf)));
    v.aux.assign(vec4(rf, ic.x, ic.w, 0.0));
  },
  surface: (s, f) => {
    // ochre, olive or gold, by plant
    const c = fract(f.aux.z.mul(9.7).add(f.aux.y.mul(0.6)));
    const col = select(c.lessThan(0.4), linV(0.88, 0.62, 0.22), select(c.lessThan(0.75), linV(0.72, 0.58, 0.20), linV(0.94, 0.72, 0.30)));
    yarn(s, f, { color: col, p: f.obj.mul(f.aux.x), scale: 15, k: 1.5 });
    s.shade = shadow1(f.w.add(G.sunDir.mul(0.3)));
    s.fluor = float(0.7);
  },
});

// The sea grass: blades that stand and lean, in two greens; near the lens they fold away.
const grassMat = (fade) => material({
  twoSided: true, fade,
  vertex: (v) => {
    const t = v.P.y.toVar(), u = v.P.x.toVar(), seed = ic.x;
    const S = ia.xyz.toVar();
    const C = cameraPosition;
    const far = v.shadow ? float(0.0) : smoothstep(18.0, 40.0, length(S.sub(C))).toVar();
    const near = v.shadow ? float(1.0) : smoothstep(0.9, 1.8, length(S.sub(C)));
    const D = vec3(cos(ib.y), 0.0, sin(ib.y)).toVar(), U = vec3(0.0, 1.0, 0.0), W0 = vec3(D.z.negate(), 0.0, D.x).toVar();
    const c1 = D.mul(0.06).add(U.mul(0.5)).toVar();
    const c2 = D.mul(ic.y.mul(0.5).add(0.2)).add(U.mul(0.95)).toVar();
    const ph = G.time.mul(seed.mul(0.5).add(1.0)).add(seed.mul(30.0)).add(S.x.mul(0.2)).add(S.z.mul(0.13)).toVar();
    c2.addAssign(vec3(0.17, 0.0, 0.11).mul(sin(ph.mul(0.6))).add(U.mul(sin(ph).mul(0.07))));
    const omt = float(1.0).sub(t);
    const thr = fract(seed.mul(7.13));
    const keep = float(1.0).sub(smoothstep(float(0.92).sub(thr), float(1.06).sub(thr), far.mul(0.72))).mul(near).toVar();
    const Q = c1.mul(omt.mul(t).mul(2.0)).add(c2.mul(t.mul(t))).mul(ib.z).mul(keep);
    const T = normalize(c1.mul(omt.sub(t).mul(2.0)).add(c2.mul(t.mul(2.0)))).toVar();
    const N0 = normalize(cross(W0, T)).toVar();
    const tw = seed.sub(0.5).mul(2.4).mul(t).add(sin(ph.add(t.mul(4.0))).mul(0.35)).toVar();
    const W = W0.mul(cos(tw)).add(N0.mul(sin(tw))).toVar(), Nn = N0.mul(cos(tw)).sub(W0.mul(sin(tw))).toVar();
    const wd = ib.w.mul(float(1.0).sub(t.mul(t).mul(0.9))).mul(far.mul(1.3).add(1.0)).mul(keep);
    v.P.assign(S.add(Q).add(W.mul(u.mul(wd))).sub(Nn.mul(float(1.0).sub(abs(u)).mul(0.12).mul(ib.w))));
    v.N.assign(normalize(Nn.add(W.mul(u).mul(0.4))));
    v.aux.assign(vec4(t, u, seed, ic.z));
  },
  surface: (s, f) => {
    const t = f.aux.x;
    // the meadow's crochet greens; the tall clumps are felt in sage and olive
    const clump = step(0.5, f.aux.w);
    const g = fract(f.aux.z.mul(7.3));
    const gc = mix(mix(vec3(0.30, 0.66, 0.32), vec3(0.48, 0.72, 0.28), g), mix(linV(0.58, 0.70, 0.56), linV(0.66, 0.68, 0.40), g), clump);
    s.ao = t.mul(0.5).add(0.5);
    // (yarn's scale is a number: the felt's finer stitches are asked for by stretching p)
    yarn(s, f, { color: gc.mul(t.mul(0.2).add(0.88)), p: f.w.mul(mix(float(1.0), float(1.55), clump)), scale: 26, k: mix(float(1.1), float(0.6), clump) });
    // (the felt blades have a stitched line down their middle)
    s.albedo = s.albedo.mul(float(1).sub(clump.mul(float(1).sub(smoothstep(0.04, 0.1, abs(f.aux.y)))).mul(0.18)));
    const sh = shadow1(f.w.add(G.sunDir.mul(0.3))).toVar();
    s.shade = sh; s.trans = float(0.55);
    const vv = normalize(f.w.sub(cameraPosition));
    s.emis = s.emis.add(sunAt(f.w.y).mul(sh).mul(pow(max(dot(vv, G.sunDir), 0.0), 5.0)).mul(s.albedo).mul(0.35));
  },
});

// (the shapes below are bent in the vertex step, which makes its own normals; this one only stands in)
const up = (n) => { const a = new Float32Array(n * 3); for (let i = 1; i < a.length; i += 3) a[i] = 1; return new BufferAttribute(a, 3); };
// A strip of `cols` + 1 columns: u is -1..1 across, t goes 0..1 up. The shader does the rest.
function strip(rows, cols = 2) {
  const pos = [], uv = [], idx = [], w = cols + 1;
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) { pos.push((c / cols) * 2 - 1, r / rows, 0); uv.push(c / cols, r / rows); }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const a = r * w + c; idx.push(a, a + 1, a + w, a + 1, a + w + 1, a + w); }
  return { position: new BufferAttribute(new Float32Array(pos), 3), normal: up(pos.length / 3), uv: new BufferAttribute(new Float32Array(uv), 2), index: new BufferAttribute(new Uint16Array(idx), 1) };
}
// A stalk: a tube of `sides`, y from 0 to 1.
function stalk(rows, sides = 8) {
  const pos = [], idx = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c < sides; c++) { const a = (c / sides) * TAU; pos.push(Math.cos(a), r / rows, Math.sin(a)); }
  for (let r = 0; r < rows; r++) for (let c = 0; c < sides; c++) { const a = r * sides + c, b = r * sides + (c + 1) % sides; idx.push(a, a + sides, b, b, a + sides, b + sides); }
  return { position: new BufferAttribute(new Float32Array(pos), 3), normal: up(pos.length / 3), index: new BufferAttribute(new Uint16Array(idx), 1) };
}
// Gather instances by cell and make one mesh a cell. `reach`: how far a blade can wave
// beyond the feet and tops counted here.
function cells(add, shape, mat, list, size, range, reach = 3) {
  const by = new Map();
  for (let i = 0; i < list.length; i += 12) {
    const key = Math.floor(list[i] / size) + ',' + Math.floor(list[i + 2] / size);
    let c = by.get(key);
    if (!c) by.set(key, (c = []));
    for (let k = 0; k < 12; k++) c.push(list[i + k]);
  }
  for (const c of by.values()) {
    const n = c.length / 12, ia = new Float32Array(n * 4), ib = new Float32Array(n * 4), ic = new Float32Array(n * 4);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 4; k++) { ia[i * 4 + k] = c[i * 12 + k]; ib[i * 4 + k] = c[i * 12 + 4 + k]; ic[i * 4 + k] = c[i * 12 + 8 + k]; }
      const x = ia[i * 4], y = ia[i * 4 + 1], z = ia[i * 4 + 2], top = y + ia[i * 4 + 3] + ib[i * 4 + 2];
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, top); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    const geo = new InstancedBufferGeometry();
    geo.setIndex(shape.index);
    geo.setAttribute('position', shape.position);
    geo.setAttribute('normal', shape.normal);
    if (shape.uv) geo.setAttribute('uv', shape.uv);
    geo.setAttribute('ia', new InstancedBufferAttribute(ia, 4));
    geo.setAttribute('ib', new InstancedBufferAttribute(ib, 4));
    geo.setAttribute('ic', new InstancedBufferAttribute(ic, 4));
    geo.instanceCount = n;
    geo.boundingSphere = new Sphere(new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + reach);
    const mesh = new ThreeMesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    add(mesh, range);
  }
}

// Felt: soft and matte, a fine fibrous relief and a mottle, fibres catching the light at the
// edges. For the boulders among the kelp. (instanced, coloured by `tint`)
const feltMat = (fade = [60, 74]) => material({
  instanced: true, fade,
  vertex: () => { vTint.assign(tint); },
  surface: (s, f) => {
    const n0 = s.n;
    const D = detail(f.w, n0, 1.6, 1.4), E = detail(f.w, n0, 7.5, 0.9);
    s.n = normalize(D.n.add(E.n).sub(n0));
    // a little lighter on top, where the light felts it
    s.albedo = vTint.rgb.mul(D.m.mul(0.3).add(0.84)).mul(E.h.mul(0.16).add(0.92)).mul(smoothstep(-0.4, 0.9, n0.y).mul(0.18).add(0.9));
    s.ao = smoothstep(-0.8, 0.4, n0.y).mul(0.4).add(0.6);
    s.spec = float(0.02); s.gloss = float(6.0); s.fluor = float(0.3); s.trans = float(0.05);
    const vv = normalize(cameraPosition.sub(f.w));
    const graze = pow(float(1.0).sub(abs(dot(s.n, vv))), 2.5);
    s.emis = s.emis.add(sunAt(f.w.y).mul(0.07).add(G.amb.mul(0.2)).mul(graze).mul(s.albedo));
  },
});
// A lumpy, rounded stone, about one metre across.
function stoneShape(seed, res) {
  const m = new Mesh(false);
  orb(m, 0, 0, 0, (x, y, z) => 0.5 * (1 + 0.2 * fbm3(x * 1.2 + seed, y * 1.2, z * 1.2, 3) + 0.06 * noise3(x * 3.1, y * 3.1 + seed, z * 3.1)), res);
  return m.build();
}
// Many copies of a shape: `list` holds [x, y, z, size x, size y, size z, yaw, r, g, b] per
// copy. Split along the dive into runs `run` metres long, so a run out of view is not drawn.
function scatter(add, geo, mat, list, range, run = 40) {
  const by = new Map(), q = new Quaternion(), pos = new Vector3(), scl = new Vector3(), Y = new Vector3(0, 1, 0);
  for (let i = 0; i < list.length; i += 10) {
    const k = Math.floor(list[i + 2] / run);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(i);
  }
  for (const ids of by.values()) {
    const places = [], tints = new Float32Array(ids.length * 4);
    ids.forEach((i, j) => {
      q.setFromAxisAngle(Y, list[i + 6]);
      place(places, pos.set(list[i], list[i + 1], list[i + 2]), q, scl.set(list[i + 3], list[i + 4], list[i + 5]));
      tints[j * 4] = list[i + 7]; tints[j * 4 + 1] = list[i + 8]; tints[j * 4 + 2] = list[i + 9]; tints[j * 4 + 3] = (j * 0.618) % 1;
    });
    const mesh = new ThreeMesh(instanced(geo, places, { tint: [4, tints] }), mat);
    mesh.matrixAutoUpdate = false;
    add(mesh, range);
  }
}
const FELT = [[0.56, 0.62, 0.66], [0.48, 0.54, 0.60], [0.66, 0.64, 0.60], [0.76, 0.70, 0.60], [0.46, 0.58, 0.58], [0.62, 0.66, 0.70]].map(lin);

function buildKelp(add, q) {
  const rng = makeRng(4242);
  const lvl = q.amount >= 1 ? 1 : q.amount >= 0.5 ? 0.72 : 0.5;
  const plants = Math.round(58 * lvl);
  const blades = [], stalks = [], feet = [];
  for (let n = 0, tries = 0; n < plants && tries < plants * 40; tries++) {
    const z = -50 - rng() * 78, edge = Math.min((-50 - z) / 9, (z + 128) / 9, 1);
    if (rng() > edge) continue;                          // thinner at both ends of the forest
    const x = centerX(z) + rng.bell() * 2.2 * (halfWidth(z) + 4);
    const d = offTrack(x, z);
    if (d < 4.2 || Math.abs(x - centerX(z)) > halfWidth(z) + 12) continue;
    // (fewer near the camera on the left, where the words are)
    if (x < centerX(z) - 1 && d < 12 && rng() < 0.55) continue;
    // in groves, with clearings between
    if (noise2(x * 0.1 + 3.3, z * 0.1) < -0.2 + 0.3 * rng()) continue;
    // not too close to another stalk
    let crowd = false;
    for (let i = 0; i < feet.length; i += 2) if ((feet[i] - x) ** 2 + (feet[i + 1] - z) ** 2 < 5.2 * 5.2) { crowd = true; break; }
    if (crowd) continue;
    feet.push(x, z);
    const g = groundY(x, z), H = (-g - rng.range(0.3, 2.5)) * rng.range(0.88, 1), ps = rng();
    if (H < 4) continue;
    stalks.push(x, g, z, H, 0, 0, 0, 0, 0, 0, 0, ps);
    // a float and a blade every metre and a half or two up the stalk, turning round it, and
    // two that stream up from the top; most in the plant's own colour
    const own = pickKelp(rng()), count = Math.max(2, Math.round(H / rng.range(2.8, 3.6)));
    let ang = rng() * TAU;
    for (let b = 0; b <= count; b++) {
      const top = b === count;
      const h = top ? 1 : clamp(0.2 + 0.78 * (b + rng.range(-0.25, 0.25)) / count, 0.12, 0.97);
      ang += rng.range(1.6, 2.9);
      const col = rng() < 0.7 ? own : pickKelp(rng());
      const len = top ? rng.range(3.2, 4.4) : rng.range(4.0, 6.2) * (0.8 + 0.3 * h);
      const droop = top ? rng.range(-0.3, 0.05) : rng.range(0.55, 1.0);
      blades.push(x, g, z, H, h, ang, len, rng.range(0.48, 0.72), rng(), droop, col, ps);
    }
    n++;
  }
  const rows = q.amount >= 1 ? 16 : q.amount >= 0.5 ? 12 : 9;
  cells(add, strip(rows, 4), kelpBladeMat(), blades, 24, 76, 7);
  const bm = new Mesh(false);
  orb(bm, 0, 0, 0, () => 1, q.amount >= 1 ? 5 : 4);
  const bg = bm.build();
  cells(add, { position: bg.getAttribute('position'), normal: bg.getAttribute('normal'), uv: bg.getAttribute('uv'), index: bg.index }, kelpFloatMat(), blades, 24, 64, 2);
  cells(add, stalk(q.amount >= 1 ? 18 : 12, q.amount >= 0.5 ? 8 : 6), kelpStalkMat(), stalks, 28, 78, 2);
  // felted boulders: a few at each stalk's foot, and a border along the sand down the middle
  const stones = [], srng = makeRng(5150);
  const stone = (x, z, r, flat) => {
    const c = srng.pick(FELT), k = srng.range(0.88, 1.1);
    stones.push(x, groundY(x, z) - r * flat * 0.3, z, 2 * r * srng.range(0.9, 1.25), 2 * r * flat, 2 * r * srng.range(0.85, 1.15), srng() * TAU, c[0] * k, c[1] * k, c[2] * k);
  };
  for (let i = 0; i < feet.length; i += 2) {
    const n = 1 + Math.floor(srng() * 3 * Math.max(lvl, 0.6));
    for (let k = 0; k < n; k++) {
      const a = srng() * TAU, d = srng.range(0.45, 1.3), x = feet[i] + Math.cos(a) * d, z = feet[i + 1] + Math.sin(a) * d;
      if (offTrack(x, z) < 2.6) continue;
      stone(x, z, srng.range(0.3, 0.75), srng.range(0.55, 0.8));
    }
  }
  for (let z = -54; z > -126; z -= srng.range(1.6, 3.2) / lvl) {
    for (const side of [-1, 1]) {
      if (srng() < 0.35) continue;
      const x = centerX(z) + side * srng.range(2.4, 7.0);
      const d = offTrack(x, z);
      if (d < 2.5 || d > 7.5) continue;
      stone(x, z, srng.range(0.25, 0.6) * (0.7 + 0.12 * d), srng.range(0.5, 0.75));
    }
  }
  scatter(add, stoneShape(3.7, q.amount >= 1 ? 7 : 5), feltMat(), stones, 70, 40);
  return { plants: stalks.length / 12, blades: blades.length / 12, stones: stones.length / 10 };
}

function buildGrass(add, q) {
  const rng = makeRng(777), list = [];
  // the marina: a soft meadow of crochet grass, thinning out into the shallows
  const count = Math.round(9000 * q.amount);
  for (let n = 0, tries = 0; n < count && tries < count * 8; tries++) {
    const z = 20 - rng() * 36;
    const x = centerX(z) + rng.range(-1, 1) * (halfWidth(z) + 3);
    if (cleared(x, z)) continue;
    const m = fbm2(x * 0.09 + 11, z * 0.09, 3);
    if (m < 0.02 + 0.25 * rng() || (z < -4 && rng() < (-4 - z) / 12)) continue;
    const s = rng();
    list.push(x, groundY(x, z) - 0.03, z, 0, 0, rng() * TAU, rng.range(0.3, 0.75) * (0.7 + 2.2 * m), rng.range(0.022, 0.04) / Math.sqrt(q.amount), s, rng.range(0.1, 0.9), 0, rng());
    n++;
  }
  // the shallows: open sand down the middle; tall felt grass in clumps toward the sides
  const clumps = Math.round(240 * Math.max(q.amount, 0.4));
  for (let n = 0, tries = 0; n < clumps && tries < clumps * 20; tries++) {
    const z = -4 - rng() * 54, side = rng.sign();
    const x = centerX(z) + side * rng.range(3.5, halfWidth(z) + 6);
    const d = offTrack(x, z);
    if (d < 4.2 || cleared(x, z)) continue;
    if (noise2(x * 0.15 + 5.1, z * 0.15) < -0.1 + 0.25 * rng() - Math.min((d - 4.2) * 0.04, 0.2)) continue;
    const tall = rng.range(0.8, 1.25) * (0.75 + 0.4 * Math.min((d - 4.2) / 6, 1)), blades = 7 + Math.floor(rng() * 7), out = Math.atan2(z - (z), x - centerX(z));
    for (let b = 0; b < blades; b++) {
      const a = rng() * TAU, r = rng() * 0.14, bx = x + Math.cos(a) * r, bz = z + Math.sin(a) * r;
      // they lean outward, away from the middle of the path
      const lean = side > 0 ? rng.range(-0.9, 0.9) : Math.PI + rng.range(-0.9, 0.9);
      list.push(bx, groundY(bx, bz) - 0.04, bz, 0, 0, lean + out * 0, rng.range(0.9, 2.1) * tall, rng.range(0.045, 0.075), rng(), rng.range(0.15, 0.6), 1, rng());
    }
    n++;
  }
  cells(add, strip(4), grassMat([34, 45]), list, 12, 46, 2.5);
  return list.length / 12;
}

// ---- the reef --------------------------------------------------------------------------

// The line from the camera to Snap at every step of the path, for wide and for tall windows
// (src/cast.js puts him 2.8 m ahead, 1.05 m right and 0.28 m down, or 3.3 m ahead and 0.55 m
// up): nothing is planted across it. Six numbers a line: the camera, and Snap.
const SIGHT = (() => {
  const out = [], o = [0, 0, 0, 0, 0], D = Math.PI / 180;
  for (let p = 0; p <= 8.0001; p += 0.004) {
    pathAt(p, o);
    const [x, y, z, yaw, pitch] = o;
    const cy = Math.cos(-yaw * D), sy = Math.sin(-yaw * D), cp = Math.cos(pitch * D), sp = Math.sin(pitch * D);
    const F = [-sy * cp, sp, -cy * cp], R = [cy, 0, -sy], U = [sy * sp, cp, cy * sp];
    for (const [f, r, u] of [[2.8, 1.05, -0.28], [3.3, 0, 0.55]]) out.push(x, y, z, x + F[0] * f + R[0] * r + U[0] * u, y + F[1] * f + R[1] * r + U[1] * u, z + F[2] * f + R[2] * r + U[2] * u);
  }
  return new Float32Array(out);
})();
// How far a point is from the nearest of those lines (beyond `far` metres away in z, not asked).
export function offSight(x, y, z, far = 8) {
  let best = 1e9;
  for (let i = 0; i < SIGHT.length; i += 6) {
    if (Math.abs(SIGHT[i + 2] - z) > far) continue;
    const ax = SIGHT[i], ay = SIGHT[i + 1], az = SIGHT[i + 2], dx = SIGHT[i + 3] - ax, dy = SIGHT[i + 4] - ay, dz = SIGHT[i + 5] - az;
    const t = clamp(((x - ax) * dx + (y - ay) * dy + (z - az) * dz) / (dx * dx + dy * dy + dz * dz), 0, 1);
    const d = Math.hypot(x - ax - dx * t, y - ay - dy * t, z - az - dz * t);
    if (d < best) best = d;
  }
  return best;
}

// Each shape is grown at about one metre, then its vertices are told what they are: aux =
// (how far it gives with the water, its kind, how open to the light, a number of its own).
// Kinds: 0 yarn in the copy's colour; 1 yarn in its second colour where the number is over
// a half (two-tone rows, a lip, an anemone's arms); 2 lace (the openness and the number are
// where on the fan it is, for its holes); 3 a brain coral (the number is how deep in a groove).
function finish(m, f) {
  const o = [0, 0, 0, 0];
  for (let v = 0; v < m.count; v++) {
    f(m.p[v * 3], m.p[v * 3 + 1], m.p[v * 3 + 2], m.a[v * 4], m.a[v * 4 + 1], m.n[v * 3 + 1], o, m.a[v * 4 + 2], m.a[v * 4 + 3]);
    m.a[v * 4] = o[0]; m.a[v * 4 + 1] = o[1]; m.a[v * 4 + 2] = o[2]; m.a[v * 4 + 3] = o[3];
  }
  const g = m.build();
  g.deleteAttribute('uv');           // (a slot for the second colour: WebGPU allows eight buffers)
  return g;
}
const SHAPES = {
  // hyperbolic crochet: cups whose edges grow faster than they can lie flat, so they fold
  // into deep, rounded waves; two or three of them nested, the inner ones higher
  ruffle(rng, lod) {
    const m = new Mesh(true), layers = 3, cols = lod ? 48 : 30, rows = lod ? 6 : 4, k0 = 5 + Math.floor(rng() * 2);
    for (let L = 0; L < layers; L++) {
      const f = L / 2;
      const R = (0.62 - 0.26 * f) * rng.range(0.92, 1.08), k = k0 + L, ph = rng() * TAU, y0 = 0.17 * L, H = rng.range(0.36, 0.46) * (1 - 0.2 * f);
      const amp = rng.range(0.22, 0.27), tone = L === 1 ? 1 : 0;
      const at = (s, t, o) => {
        const ang = s * TAU, e = Math.pow(t, 1.3);
        const fold = Math.sin(ang * k + ph) * amp * R * e;
        const rr = (0.05 + R * Math.pow(t, 0.8)) * (1 + 0.05 * Math.cos(ang * k + ph) * e);
        o[0] = Math.cos(ang) * rr; o[2] = Math.sin(ang) * rr; o[1] = y0 + 0.04 + H * Math.pow(t, 1.15) + fold;
      };
      m.grid(cols, rows, (s, t, o) => { at(s, t, o); o[3] = t; o[4] = tone; }, true, true);
      // the edge rolls over, as a crochet edge does: a round cord all along the rim
      if (lod) {
        const pts = [], o = [0, 0, 0];
        for (let i = 0; i <= cols; i++) { at(i / cols, 1, o); pts.push([o[0], o[1], o[2], 0.026]); }
        const v0 = m.count;
        tube(m, pts, 4, [1, tone, 0]);
        for (let v = v0; v < m.count; v++) { m.a[v * 4] = 1; m.a[v * 4 + 1] = tone; }
      }
    }
    return finish(m, (x, y, z, t, tone, ny, o) => { o[0] = 0.012 * t; o[1] = 1; o[2] = 0.4 + 0.6 * t; o[3] = tone; });
  },
  // a brain coral: a dome of coiled cord, its grooves winding over it
  brain(rng, lod) {
    const m = new Mesh(true), sd = rng() * 9, K = rng.range(3.6, 4.4), sq = rng.range(0.78, 0.95);
    const groove = (x, y, z) => { const v = Math.sin(fbm3(x * 1.1 + sd, y * 1.1, z * 1.1, 2) * K * Math.PI * 2); return 1 - smooth(0.0, 0.7, Math.abs(v)); };
    orb(m, 0, 0, 0, (x, y, z) => 0.5 * (1 - 0.13 * groove(x, y, z)) * (1 + 0.05 * noise3(x * 1.7 + sd, y * 1.7, z * 1.7)), lod ? 15 : 8,
      (x, y, z, o) => { o[0] = groove(x, y, z); });
    for (let v = 0; v < m.count; v++) { const y = m.p[v * 3 + 1]; m.p[v * 3 + 1] = y < 0 ? y * 0.2 : y * sq; }
    m.normals(0, m.count, 0, null);
    return finish(m, (x, y, z, g, _, ny, o) => { o[0] = 0; o[1] = 3; o[2] = 0.45 + 0.55 * clamp(y / 0.35, 0, 1); o[3] = g; });
  },
  // tube corals: a bunch of chunky tubes, open at the top, the lip and the inside a second colour
  tubes(rng, lod) {
    const m = new Mesh(true), n = 3 + Math.floor(rng() * 4), sides = lod ? 14 : 8;
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, d = i ? rng.range(0.2, 0.36) : 0, h = rng.range(0.5, 1.0) * (i ? 0.8 : 1), r = rng.range(0.13, 0.19), fl = rng.range(1.0, 1.35), lean = rng.range(0.05, 0.25);
      const g = m.count;
      lathe(m, 0, 0, 0, [[r * 0.85, -0.08], [r, h * 0.4], [r * (0.55 + 0.45 * fl), h * 0.82], [r * fl, h], [r * fl * 1.1, h + 0.035], [r * fl * 0.92, h + 0.05], [r * fl * 0.78, h * 0.86], [r * 0.62, h * 0.45]], sides, null, [h, 0, 0]);
      for (let v = g; v < m.count; v++) { const y = m.p[v * 3 + 1]; m.p[v * 3] += Math.cos(a) * (d + lean * y * y / h); m.p[v * 3 + 2] += Math.sin(a) * (d + lean * y * y / h); }
    }
    return finish(m, (x, y, z, t, h, ny, o) => { o[0] = 0.01 * clamp(y, 0, 1); o[1] = 1; o[2] = t > 0.62 ? 0.3 : 0.5 + 0.5 * clamp(y / h, 0, 1); o[3] = t > 0.4 ? 1 : 0; });
  },
  // finger corals: chunky branches, forking twice, with round tips
  fingers(rng, lod) {
    const m = new Mesh(true), sides = lod ? 8 : 5;
    const grow = (x, y, z, dx, dy, dz, len, r, depth) => {
      const ex = x + dx * len, ey = y + dy * len, ez = z + dz * len;
      tube(m, [[x, y, z, r], [(x + ex) / 2 + rng.bell() * len * 0.1, (y + ey) / 2, (z + ez) / 2 + rng.bell() * len * 0.1, r * 0.96], [ex, ey, ez, r * 0.9]], sides, [depth, 0, 0]);
      if (depth >= 2) return;
      const kids = depth === 0 ? 3 + (rng() < 0.5 ? 1 : 0) : 2;
      for (let k = 0; k < kids; k++) {
        const cx = dx + rng.bell() * 1.1, cy = dy + 0.5 + rng() * 0.5, cz = dz + rng.bell() * 1.1, l = Math.hypot(cx, cy, cz);
        grow(ex, ey, ez, cx / l, cy / l, cz / l, len * rng.range(0.75, 0.95), r * 0.8, depth + 1);
      }
    };
    grow(0, -0.06, 0, 0, 1, 0, 0.32, 0.085, 0);
    return finish(m, (x, y, z, s, depth, ny, o) => { o[0] = 0.006 * y; o[1] = 0; o[2] = 0.5 + 0.5 * clamp(y / 0.7, 0, 1); o[3] = 0; });
  },
  // a sea fan of crochet lace: upright, a little cupped and waved, its rim scalloped
  lace(rng, lod) {
    const m = new Mesh(true), cols = lod ? 26 : 14, rows = lod ? 10 : 6, span = rng.range(2.0, 2.7), wv = rng() * TAU, cup = rng.range(0.1, 0.22);
    m.grid(cols, rows, (s, t, o) => {
      const a = (s - 0.5) * span, r = 0.05 + 0.95 * t;
      o[0] = Math.sin(a) * r * 0.62; o[1] = Math.cos(a) * r * 0.92 - 0.04; o[2] = 0.07 * Math.sin(s * 6 + wv) * t + cup * (s - 0.5) * (s - 0.5) * 4 * t;
      o[3] = s; o[4] = t;
    }, false, false);
    return finish(m, (x, y, z, s, t, ny, o) => { o[0] = 0.035 * t * t; o[1] = 2; o[2] = s; o[3] = t; });
  },
  // an anemone: a short column under a crown of thick yarn arms that curl out
  anemone(rng, lod) {
    const m = new Mesh(true);
    lathe(m, 0, 0, 0, [[0.17, -0.05], [0.15, 0.13], [0.19, 0.23], [0.18, 0.27], [0.0, 0.29]], lod ? 14 : 9, null, [0, 0, 0]);
    const arms = lod ? 17 : 11;
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * TAU + rng() * 0.3, d = 0.05 + 0.09 * rng(), len = rng.range(0.3, 0.46), out = rng.range(0.55, 0.95), pts = [];
      for (let k = 0; k <= 4; k++) { const t = k / 4; pts.push([Math.cos(a) * (d + out * len * t * t), 0.26 + len * (t - 0.35 * t * t), Math.sin(a) * (d + out * len * t * t), 0.036 * (1 - 0.3 * t)]); }
      tube(m, pts, lod ? 5 : 4, [1, 0, 0]);
    }
    return finish(m, (x, y, z, s, arm, ny, o) => { const k = arm > 0 ? s : 0; o[0] = 0.06 * k; o[1] = 1; o[2] = arm > 0 ? 0.6 + 0.4 * k : 0.6; o[3] = arm > 0 ? 1 : 0; });
  },
  // pillar coral: tall round fingers standing together
  pillars(rng, lod) {
    const m = new Mesh(true), n = 4 + Math.floor(rng() * 4), sides = lod ? 8 : 5;
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, d = i ? rng.range(0.1, 0.28) : 0, h = rng.range(0.55, 1.0) * (i ? 0.85 : 1), lx = Math.cos(a) * rng.range(0.03, 0.15), lz = Math.sin(a) * rng.range(0.03, 0.15), pts = [];
      for (let k = 0; k <= 3; k++) { const t = k / 3; pts.push([Math.cos(a) * d + lx * t * t, -0.05 + h * t, Math.sin(a) * d + lz * t * t, 0.07 * (1 - 0.12 * t)]); }
      tube(m, pts, sides, [h, 0, 0]);
    }
    return finish(m, (x, y, z, s, h, ny, o) => { o[0] = 0.005 * y; o[1] = 0; o[2] = 0.5 + 0.5 * clamp(y, 0, 1); o[3] = 0; });
  },
  // a crochet starfish: five plump arms and a raised middle, lying on the sand
  starfish(rng, lod) {
    const m = new Mesh(true), twist = rng() * TAU;
    orb(m, 0, 0, 0, (x, y, z) => {
      const a = Math.atan2(z, x) + twist, arm = Math.pow(Math.max(0, Math.cos(a * 2.5)), 1.6);
      return 0.17 + 0.36 * arm;
    }, lod ? 10 : 6);
    for (let i = 0; i < m.count; i++) { const r = Math.hypot(m.p[i * 3], m.p[i * 3 + 2]); m.p[i * 3 + 1] = m.p[i * 3 + 1] * (0.5 - 0.22 * clamp(r / 0.55, 0, 1)) + 0.06; }
    m.normals(0, m.count, 0, null);
    return finish(m, (x, y, z, _, __, ny, o) => { o[0] = 0; o[1] = 0; o[2] = 0.6 + 0.4 * Math.max(ny, 0); o[3] = 0; });
  },
  // a knitted pebble: a round soft stone with a seam round its middle
  knitball(rng, lod) {
    const m = new Mesh(true), sq = rng.range(0.6, 0.8);
    orb(m, 0, 0, 0, (x, y, z) => 0.5 * (1 + 0.06 * noise3(x * 2, y * 2, z * 2)), lod ? 9 : 6, (x, y, z, o) => { o[0] = Math.abs(y) < 0.08 ? 1 : 0; });
    for (let i = 0; i < m.count; i++) m.p[i * 3 + 1] = m.p[i * 3 + 1] * sq + 0.5 * sq * 0.8;
    m.normals(0, m.count, 0, null);
    return finish(m, (x, y, z, seam, _, ny, o) => { o[0] = 0; o[1] = 1; o[2] = 0.55 + 0.45 * Math.max(ny, 0); o[3] = seam; });
  },
};

const tint = attribute('tint', 'vec4'), tint2 = attribute('tint2', 'vec4');
const vTint = varyingProperty('vec4', 'v_tint'), vTint2 = varyingProperty('vec4', 'v_tint2');
const reefMat = (fade = [55, 68]) => material({
  aux: true, instanced: true, fade, twoSided: true,
  vertex: (v) => {
    vTint.assign(tint); vTint2.assign(tint2);
    // what is soft gives with the water, more toward its ends
    const ph = G.time.mul(0.8).add(tint.w.mul(40.0)).toVar();
    const k = v.aux.x.mul(length(attribute('i0', 'vec4').xyz));
    v.P.assign(v.P.add(vec3(sin(ph).add(sin(ph.mul(2.3)).mul(0.4)), 0.0, cos(ph.mul(0.8)).mul(0.6)).mul(k)));
  },
  surface: (s, f) => {
    const kind = f.aux.y.toVar();
    const lace = step(1.5, kind).mul(step(kind, 2.5)).toVar(), brain = step(2.5, kind);
    const tone = step(0.5, kind).mul(step(kind, 1.5)).mul(step(0.5, f.aux.w));
    const base = mix(vTint.rgb, vTint2.rgb, tone).toVar();
    s.ao = mix(f.aux.z, float(1.0), lace).mul(float(1).sub(brain.mul(f.aux.w).mul(0.45)));
    // chunky stitches, scaled with each piece (they are laid on its own shape)
    yarn(s, f, { color: base.mul(float(1).sub(brain.mul(f.aux.w).mul(0.45))), scale: 20, k: 1.3, fuzz: 0.45 });
    s.fluor = float(0.8); s.trans = mix(float(0.2), float(0.5), lace);
    // (in the shade a crochet colour still holds a little of itself)
    s.emis = s.emis.add(base.mul(base).mul(G.amb).mul(0.12));
    // lace: diamond holes in staggered rows, more of them toward the rim; a solid border and
    // scalloped edge
    const t = f.aux.w, u = f.aux.z;
    const rowN = float(12.0), cv = t.mul(rowN).toVar(), row = floor(cv);
    const cu = u.mul(t.mul(18.0).add(4.0)).add(row.mul(0.5)).toVar();
    const fu = fract(cu).sub(0.5), fv = fract(cv).sub(0.5);
    const d = length(vec2(fu, fv.mul(1.15))).add(abs(fu).add(abs(fv)).mul(0.25));
    const rim = float(0.965).sub(abs(sin(u.mul(Math.PI * 9.0))).mul(0.05));
    const hole = step(d, float(0.46)).mul(step(0.1, t)).mul(step(t, rim.sub(0.035))).max(step(rim, t));
    If(lace.mul(hole).greaterThan(0.5), () => { Discard(); });
  },
});
// Stone, shell and glass: smooth, with a sheen; glass shows the water's light through it.
// (tint.w over 0.5: glass)
const pebbleMat = (fade = [50, 62]) => material({
  instanced: true, fade, aux: true,
  vertex: () => { vTint.assign(tint); vTint2.assign(tint2); },
  surface: (s, f) => {
    const glass = step(0.5, vTint2.w).toVar();
    const D = detail(f.w, s.n, 3.0, 0.5);
    s.n = mix(D.n, s.n, glass);
    s.albedo = vTint.rgb.mul(mix(D.m.mul(0.25).add(0.85), float(1.0), glass)).mul(mix(float(1.0), f.aux.w.mul(0.25).add(0.8), step(0.5, f.aux.y)));
    s.spec = mix(float(0.12), float(1.2), glass); s.gloss = mix(float(24.0), float(80.0), glass);
    s.fluor = float(0.35); s.trans = glass.mul(0.6);
    const vv = normalize(cameraPosition.sub(f.w));
    s.emis = vTint.rgb.mul(G.amb).mul(glass.mul(0.5).mul(pow(float(1.0).sub(abs(dot(s.n, vv))), 2.0).add(0.3)));
  },
});
// A smooth pebble, a scallop shell.
function pebbleShape(seed, res) {
  const m = new Mesh(true);
  orb(m, 0, 0, 0, (x, y, z) => 0.5 * (1 + 0.1 * noise3(x * 1.4 + seed, y * 1.4, z * 1.4)), res);
  for (let i = 0; i < m.count; i++) m.p[i * 3 + 1] *= 0.55;
  m.normals(0, m.count, 0, null);
  const g = m.build(); g.deleteAttribute('uv');
  return g;
}
function shellShape(res) {
  const m = new Mesh(true);
  m.grid(res * 3, res, (s, t, o) => {
    const a = (s - 0.5) * 2.5, r = 0.06 + 0.44 * t, rib = 1 + 0.06 * Math.cos(s * 26 * Math.PI) * t;
    o[0] = Math.sin(a) * r * rib; o[2] = Math.cos(a) * r * rib - 0.22; o[1] = 0.02 + 0.16 * Math.sin(t * Math.PI * 0.85) * (1 - 0.35 * Math.abs(s - 0.5) * 2) + 0.012 * Math.cos(s * 26 * Math.PI) * t;
    o[3] = 0; o[4] = 1; o[5] = 0; o[6] = 0.5 + 0.5 * Math.cos(s * 26 * Math.PI);
  }, false, true);
  const g = m.build(); g.deleteAttribute('uv');
  return g;
}

// The colours: [first, second] for each kind of coral (the second for lips, rows, arms).
const C = Object.fromEntries(Object.entries({
  pink: [0.95, 0.44, 0.54], coral: [0.96, 0.47, 0.40], orange: [0.98, 0.54, 0.16], purple: [0.60, 0.36, 0.82], yellow: [0.98, 0.82, 0.26],
  teal: [0.14, 0.62, 0.62], red: [0.86, 0.22, 0.22], lilac: [0.74, 0.62, 0.94], green: [0.50, 0.70, 0.30], cream: [0.96, 0.88, 0.74],
  salmon: [0.96, 0.62, 0.55], white: [0.90, 0.92, 0.96], blush: [0.98, 0.78, 0.74],
}).map(([k, v]) => [k, lin(v)]));
const PAIRS = {
  ruffle: [['pink', 'coral'], ['orange', 'coral'], ['purple', 'lilac'], ['coral', 'pink'], ['orange', 'orange'], ['pink', 'salmon'], ['purple', 'purple'], ['coral', 'orange']],
  brain: [['salmon', 'salmon'], ['teal', 'teal'], ['yellow', 'yellow'], ['green', 'green'], ['coral', 'coral'], ['pink', 'pink']],
  tubes: [['purple', 'lilac'], ['teal', 'green'], ['pink', 'blush'], ['red', 'coral'], ['lilac', 'purple']],
  fingers: [['orange', 'orange'], ['red', 'red'], ['coral', 'coral'], ['purple', 'purple'], ['yellow', 'yellow']],
  lace: [['lilac', 'lilac'], ['pink', 'pink'], ['orange', 'orange'], ['white', 'white'], ['purple', 'purple']],
  anemone: [['pink', 'cream'], ['red', 'cream'], ['orange', 'blush'], ['teal', 'cream'], ['coral', 'cream']],
  pillars: [['purple', 'purple'], ['lilac', 'lilac'], ['teal', 'teal']],
  starfish: [['orange', 'orange'], ['coral', 'coral'], ['yellow', 'yellow'], ['salmon', 'salmon'], ['cream', 'cream']],
  knitball: [['white', 'cream'], ['cream', 'salmon'], ['teal', 'cream'], ['salmon', 'cream']],
};

// Planted copies, gathered by shape and level of detail, then made into meshes by runs along
// the dive. A copy: x, y, z, size, ground normal (x, y, z), yaw, colour (r, g, b), its seed,
// second colour (r, g, b), glass.
function planter() {
  const lists = new Map();
  const q = new Quaternion(), yawQ = new Quaternion(), pos = new Vector3(), scl = new Vector3(), up = new Vector3(0, 1, 0), nrm = new Vector3();
  return {
    put(key, x, y, z, s, nx, ny, nz, yaw, c, c2, glass = 0, k = 1) {
      if (!lists.has(key)) lists.set(key, []);
      const kk = k * (0.9 + 0.2 * ((x * 12.9898 + z * 78.233) % 1 + 1) % 1);
      lists.get(key).push(x, y, z, s, nx, ny, nz, yaw, c[0] * kk, c[1] * kk, c[2] * kk, Math.abs(Math.sin(x * 3.7 + z * 1.3)), c2[0] * kk, c2[1] * kk, c2[2] * kk, glass);
    },
    // geo(key) -> geometry, mat(key) -> material; run: metres along z a mesh may span
    make(add, geo, mat, range, runOf) {
      let n = 0;
      for (const [key, list] of lists) {
        const by = new Map();
        const run = typeof runOf === 'function' ? runOf(key) : runOf;
        for (let i = 0; i < list.length; i += 16) { const r = Math.floor(list[i + 2] / run); if (!by.has(r)) by.set(r, []); by.get(r).push(i); }
        const g = geo(key), mt = mat(key);
        for (const ids of by.values()) {
          const places = [], t1 = new Float32Array(ids.length * 4), t2 = new Float32Array(ids.length * 4);
          ids.forEach((i, j) => {
            q.setFromUnitVectors(up, nrm.set(list[i + 4], list[i + 5], list[i + 6]).normalize());
            q.multiply(yawQ.setFromAxisAngle(up, list[i + 7]));
            place(places, pos.set(list[i], list[i + 1], list[i + 2]), q, scl.setScalar(list[i + 3]));
            for (let c = 0; c < 4; c++) { t1[j * 4 + c] = list[i + 8 + c]; t2[j * 4 + c] = list[i + 12 + c]; }
          });
          const mesh = new ThreeMesh(instanced(g, places, { tint: [4, t1], tint2: [4, t2] }), mt);
          mesh.matrixAutoUpdate = false;
          mesh.name = key;
          add(mesh, range);
          n += ids.length;
        }
      }
      return n;
    },
  };
}
const VARIANTS = { ruffle: 2, tubes: 2 };
// Whether a thing r across stays out of the set pieces' clearings (layout.js), whole.
const clearOf = (x, z, r) => !CLEARINGS.some(([cx, cz, cr]) => (x - cx) * (x - cx) + (z - cz) * (z - cz) < (cr + r) * (cr + r));
const groundN = (x, z, out) => { out[0] = groundY(x - 0.4, z) - groundY(x + 0.4, z); out[1] = 1.6; out[2] = groundY(x, z - 0.4) - groundY(x, z + 0.4); return out; };

function buildReef(add, q) {
  const rng = makeRng(31337), pl = planter(), gn = [0, 1, 0], o = [0, 0, 0, 0, 0], o2 = [0, 0, 0, 0, 0];
  const lvl = q.amount;
  // a piece: its shape, near (1) or far (0) detail, where, how big, its colours; kept off the
  // path of the camera and its line to Snap (checked at a few heights up the piece)
  const piece = (shape, lod, x, z, s, tall, faceX, faceZ) => {
    if (!clearOf(x, z, 0.62 * s)) return false;
    const y = groundY(x, z);
    // (the piece reaches about 0.62 of its size out from its middle; Snap is 0.45 round)
    for (const h of [0.25, 0.6, 1.0]) if (offSight(x, y + tall * s * h, z) < 0.6 + 0.66 * s) return false;
    if (offTrack(x, z, y + tall * s * 0.6) < 0.9 + 0.5 * s) return false;
    const pair = rng.pick(PAIRS[shape]);
    groundN(x, z, gn);
    // fans turn their face to the way the camera comes; the rest any way
    const yaw = shape === 'lace' ? Math.atan2(faceX, faceZ) + rng.range(-0.35, 0.35) : rng() * TAU;
    // full detail only close to the camera's way; two shapes of the commonest kinds
    const fine = lod && lvl >= 0.5 && offTrack(x, z) < (lvl >= 1 ? 5.4 : 4.2) ? 1 : 0, v = fine && VARIANTS[shape] > 1 && rng() < 0.5 ? 'b' : '';
    pl.put(shape + v + fine, x, y - 0.04 * s, z, s, gn[0] * 0.6, gn[1], gn[2] * 0.6, yaw, C[pair[0]], C[pair[1]], 0, rng.range(0.85, 1.1));
    return true;
  };
  // the way through the reef: clusters on both sides of it, big and close to the camera's
  // way, framing a path of white sand; smaller and fewer further out
  const TALL = { ruffle: 0.8, brain: 0.7, tubes: 1.05, anemone: 0.65, fingers: 0.9, lace: 0.95, pillars: 1.0 };
  const FRONT = ['brain', 'anemone', 'tubes', 'ruffle', 'anemone', 'tubes'];
  let travelled = 0;
  pathAt(2.98, o2);
  for (let p = 2.98; p < 4.12; p += 0.002) {
    pathAt(p, o);
    travelled += Math.hypot(o[0] - o2[0], o[2] - o2[2]);
    const dx = o[0] - o2[0], dz = o[2] - o2[2], dl = Math.hypot(dx, dz) || 1;
    o2[0] = o[0]; o2[1] = o[1]; o2[2] = o[2];
    if (travelled < 2.3 / Math.sqrt(Math.max(lvl, 0.4))) continue;
    travelled = 0;
    const fx = dx / dl, fz = dz / dl, rx = -fz, rz = fx;      // ahead, and to the right
    for (const side of [-1, 1]) {
      // a cluster: one or two big pieces at the back, smaller ones in front of them
      const d0 = rng.range(2.9, 4.4), ax = o[0] + rx * side * d0 + fx * rng.range(-1, 1), az = o[2] + rz * side * d0 + fz * rng.range(-1, 1);
      const n = 3 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const back = i < 2, w = back ? rng.range(0.8, 2.6) : rng.range(-0.5, 0.5);
        const x = ax + rx * side * w + fx * rng.range(-1.6, 1.6), z = az + rz * side * w + fz * rng.range(-1.6, 1.6);
        let shape;
        if (back) { const r = rng(); shape = r < 0.36 ? 'ruffle' : r < 0.6 ? 'lace' : r < 0.76 ? 'pillars' : r < 0.88 ? 'fingers' : 'brain'; }
        else { const r = rng(); shape = r < 0.3 ? 'brain' : r < 0.5 ? 'tubes' : r < 0.68 ? 'anemone' : r < 0.88 ? 'ruffle' : 'fingers'; }
        const s = (back ? rng.range(1.8, 2.7) : rng.range(1.2, 1.9)) * (shape === 'lace' ? 1.3 : shape === 'anemone' ? 0.9 : shape === 'pillars' ? 1.25 : 1);
        piece(shape, 1, x, z, s, TALL[shape], -rx * side, -rz * side);
      }
      // the front row, low, close to the path, for a phone's narrower view
      if (rng() < 0.8) {
        const d = rng.range(1.5, 2.4), shape = rng.pick(FRONT);
        piece(shape, 1, o[0] + rx * side * d + fx * rng.range(-1, 1), o[2] + rz * side * d + fz * rng.range(-1, 1), rng.range(0.8, 1.2) * (shape === 'anemone' ? 0.7 : 1), 0.7, -rx * side, -rz * side);
      }
      // further out: smaller clusters, plainer shapes
      if (rng() < 0.75) {
        const d = rng.range(7, 15), bx = o[0] + rx * side * d + fx * rng.range(-2, 2), bz = o[2] + rz * side * d + fz * rng.range(-2, 2);
        for (let i = 0, m = 2 + Math.floor(rng() * 2); i < m; i++) {
          const r = rng(), shape = r < 0.35 ? 'ruffle' : r < 0.55 ? 'brain' : r < 0.72 ? 'lace' : r < 0.86 ? 'tubes' : 'pillars';
          piece(shape, 0, bx + rng.range(-2, 2), bz + rng.range(-2, 2), rng.range(1.4, 2.4), 1, -rx * side, -rz * side);
        }
      }
      // and far out, scattered
      if (rng() < 0.5) {
        const d = rng.range(15, 30), r = rng(), shape = r < 0.4 ? 'ruffle' : r < 0.7 ? 'brain' : r < 0.85 ? 'lace' : 'fingers';
        piece(shape, 0, o[0] + rx * side * d + fx * rng.range(-3, 3), o[2] + rz * side * d + fz * rng.range(-3, 3), rng.range(1.5, 2.6), 1, -rx * side, -rz * side);
      }
    }
  }
  // on the reef's rocks (the arch, the outcrops): fans, tubes and ruffles crusting them
  for (let i = 0; i < perches.length; i += 6) {
    const z = perches[i + 2];
    if (!((z < -118 && z > -200) || (z < -250 && z > -305)) || rng() > 0.3 * Math.max(lvl, 0.5)) continue;
    const x = perches[i], y = perches[i + 1], r = rng();
    if (y < -80) continue;                       // (none on the spur's face down in the dark)
    const shape = r < 0.3 ? 'lace' : r < 0.5 ? 'tubes' : r < 0.75 ? 'ruffle' : r < 0.9 ? 'fingers' : 'brain';
    const s = rng.range(0.8, 1.5) * (shape === 'lace' ? 1.25 : 1);
    if (offSight(x, y + s * 0.5, z) < 0.8 + 0.5 * s || offTrack(x, z, y + s * 0.5) < 1.0 + 0.5 * s || !clearOf(x, z, 0.62 * s)) continue;
    const pair = rng.pick(PAIRS[shape]);
    pl.put(shape + (lvl >= 0.5 && offTrack(x, z) < 5.4 ? 1 : 0), x, y - 0.05 * s, z, s, perches[i + 3] * 0.7, perches[i + 4] + 0.6, perches[i + 5] * 0.7, rng() * TAU, C[pair[0]], C[pair[1]], 0, rng.range(0.85, 1.1));
  }
  // the ledge round the wreck, and the edge of the drop: sparser, then thick along the lip
  for (let i = 0, n = Math.round(190 * Math.max(lvl, 0.4)); i < n; i++) {
    const lip = i < n * 0.55, z = lip ? rng.range(-252, -267.5) : rng.range(-200, -252);
    const x = centerX(z) + rng.range(-1, 1) * (lip ? 16 : halfWidth(z) + 4);
    const r = rng(), shape = r < 0.3 ? 'ruffle' : r < 0.45 ? 'lace' : r < 0.6 ? 'brain' : r < 0.75 ? 'fingers' : r < 0.88 ? 'tubes' : 'pillars';
    piece(shape, lip ? 1 : 0, x, z, rng.range(1.2, lip ? 2.4 : 1.9), TALL[shape], 0, 1);
  }
  const lods = { 1: new Map(), 0: new Map() };
  const geo = (key) => {
    const lod = +key.slice(-1), name = key.slice(0, -1), b = name.endsWith('b'), shape = b ? name.slice(0, -1) : name;
    if (!lods[lod].has(name)) lods[lod].set(name, SHAPES[shape](makeRng(name.length * 977 + lod + (b ? 51 : 0)), lod));
    return lods[lod].get(name);
  };
  const nearMat = reefMat([52, 66]), farMat = reefMat([55, 68]);
  // (the fine ones in shorter runs, so that what is beyond the water's reach is not drawn)
  return pl.make(add, geo, (key) => (key.endsWith('1') ? nearMat : farMat), 68, (key) => (key.endsWith('1') ? 34 : 64));
}

// ---- the shallows: what lies about on the sand ------------------------------------------

// Rope: three strands twisted, hemp-coloured (aux: around 0..1, along in metres).
const ropeMat = () => material({
  aux: true,
  surface: (s, f) => {
    const ph = f.aux.x.mul(3.0).sub(f.aux.y.mul(9.0)).toVar();
    const near = float(1).sub(smoothstep(4.0, 16.0, f.dist));
    const k = mix(float(0.5), cos(ph.mul(TAU)).mul(0.5).add(0.5), near).toVar();
    const fib = texture(G.detailTex, vec2(f.aux.x.mul(2.0), f.aux.y.mul(1.7))).b;
    s.albedo = linV(0.82, 0.70, 0.52).mul(k.mul(0.42).add(0.66)).mul(fib.mul(0.2).add(0.9));
    s.ao = k.mul(0.35).add(0.65);
    s.spec = float(0.03); s.gloss = float(10.0); s.fluor = float(0.4); s.trans = float(0.1);
  },
});
// Glass: the bottle. Clear and a little green, bright where it turns from the eye.
const glassMat = () => material({
  transparent: true, shadow: false,
  surface: (s, f) => {
    const vv = normalize(cameraPosition.sub(f.w));
    const fr = pow(float(1.0).sub(abs(dot(s.n, vv))), 2.5);
    s.albedo = linV(0.62, 0.82, 0.72); s.spec = float(1.6); s.gloss = float(90.0); s.fluor = float(0.2);
    s.emis = G.amb.mul(0.25).mul(fr).add(vec3(0.6, 0.9, 0.8).mul(fr).mul(0.25));
    s.alpha = fr.mul(0.7).add(0.2);
  },
});
// Plain yarn things lying about (the message's paper, the cork, the buoy): colours in aux.
const plainMat = () => material({
  aux: true,
  surface: (s, f) => {
    yarn(s, f, { color: f.aux.xyz, color2: linV(0.96, 0.92, 0.84), stripe: 5, scale: 22, p: f.w });
    s.albedo = select(f.aux.w.greaterThan(0.5), s.albedo, f.aux.xyz);
    s.fluor = float(0.6);
  },
});

function buildShallows(add, q) {
  const rng = makeRng(2024), pl = planter(), gn = [0, 1, 0], o = [0, 0, 0, 0, 0], taken = [];
  // copies of the small things: on the sand, off the camera's way and its line to Snap, and
  // not on top of each other
  const free = (x, z, r) => { for (let i = 0; i < taken.length; i += 3) if ((taken[i] - x) ** 2 + (taken[i + 1] - z) ** 2 < (taken[i + 2] + r) ** 2) return false; return true; };
  const lie = (shape, x, z, s, c, c2, glass = 0, r = s * 0.5) => {
    if (!clearOf(x, z, r) || offTrack(x, z) < 0.6 || !free(x, z, r)) return false;
    const y = groundY(x, z);
    if (offSight(x, y + s * 0.3, z) < 0.6 + s) return false;
    groundN(x, z, gn);
    taken.push(x, z, r);
    pl.put(shape, x, y - 0.02 * s, z, s, gn[0], gn[1], gn[2], rng() * TAU, c, c2, glass, rng.range(0.9, 1.08));
    return true;
  };
  const at = (p, side, d, ahead, out) => {
    pathAt(p, o);
    const yaw = o[3] * Math.PI / 180, fx = Math.sin(yaw), fz = -Math.cos(yaw);
    out[0] = o[0] + Math.cos(yaw) * side * d + fx * ahead; out[1] = o[2] + Math.sin(yaw) * side * d + fz * ahead;
    return out;
  };
  const P = [0, 0];
  const STONE = [[0.62, 0.60, 0.56], [0.50, 0.46, 0.42], [0.70, 0.62, 0.52], [0.46, 0.52, 0.58], [0.78, 0.74, 0.66]].map(lin);
  const GLASS = [[0.30, 0.70, 0.66], [0.40, 0.62, 0.82], [0.55, 0.80, 0.60]].map(lin);
  const SHELL = [[0.98, 0.88, 0.76], [0.98, 0.74, 0.70], [0.94, 0.80, 0.62]].map(lin);
  // the bottle's and the coil's places, kept for them
  const bottleAt = at(1.5, 1, 2.7, 5.2, [0, 0]), coilAt = at(1.9, 1, 4.2, 6.4, [0, 0]);
  taken.push(bottleAt[0], bottleAt[1], 0.9, coilAt[0], coilAt[1], 1.2);
  // groups on both sides where the camera looks over the sand (p 1.34 to 2.1): some close to
  // the way, for a phone's narrow view, some further out
  for (let p = 1.34; p < 2.1; p += 0.045) {
    for (const side of [-1, 1]) {
      const r0 = rng(), d = r0 < 0.3 ? rng.range(0.7, 1.1) : r0 < 0.6 ? rng.range(1.1, 1.8) : rng.range(2.0, 3.6);
      at(p, side, d, rng.range(4.5, 7.5), P);
      const [cx, cz] = P;
      for (let i = 0, n = 1 + Math.floor(rng() * 2); i < n; i++) lie('starfish', cx + rng.range(-0.9, 0.9), cz + rng.range(-0.9, 0.9), rng.range(0.55, 0.85), ...rng.pick(PAIRS.starfish).map((k) => C[k]), 0, 0.38);
      if (rng() < 0.6) for (let i = 0, n = 1 + Math.floor(rng() * 2); i < n; i++) { const pr = rng.pick(PAIRS.knitball); lie('knitball', cx + rng.range(-1, 1), cz + rng.range(-1, 1), rng.range(0.5, 0.8), C[pr[0]], C[pr[1]]); }
      for (let i = 0, n = 2 + Math.floor(rng() * 3); i < n; i++) { const c = rng.pick(STONE); lie('pebble', cx + rng.range(-1.4, 1.4), cz + rng.range(-1.4, 1.4), rng.range(0.14, 0.32), c, c); }
      if (rng() < 0.6) { const c = rng.pick(SHELL); lie('shell', cx + rng.range(-1.2, 1.2), cz + rng.range(-1.2, 1.2), rng.range(0.6, 0.9), c, c, 0, 0.3); }
      if (rng() < 0.5) { const c = rng.pick(GLASS); lie('pebble', cx + rng.range(-1.2, 1.2), cz + rng.range(-1.2, 1.2), rng.range(0.12, 0.2), c, c, 1); }
    }
  }
  // and here and there along the way, from the marina to the kelp
  for (let i = 0, n = Math.round(110 * Math.max(q.amount, 0.4)); i < n; i++) {
    const z = rng.range(8, -60), x = centerX(z) + rng.range(-1, 1) * (halfWidth(z) + 2), r = rng();
    if (r < 0.3) lie('starfish', x, z, rng.range(0.45, 0.7), ...rng.pick(PAIRS.starfish).map((k) => C[k]), 0, 0.3);
    else if (r < 0.55) lie('shell', x, z, rng.range(0.5, 0.8), rng.pick(SHELL), rng.pick(SHELL), 0, 0.25);
    else { const c = rng.pick(STONE); lie('pebble', x, z, rng.range(0.12, 0.3), c, c); }
  }
  const geos = {}, sh = (key) => geos[key] ?? (geos[key] = key === 'pebble' ? pebbleShape(1.7, q.amount >= 1 ? 6 : 4) : key === 'shell' ? shellShape(q.amount >= 1 ? 8 : 5) : SHAPES[key](makeRng(key.length * 131), q.amount >= 0.5 ? 1 : 0));
  const ym = reefMat([40, 52]), pm = pebbleMat([40, 52]);
  let n = pl.make(add, sh, (key) => (key === 'pebble' || key === 'shell' ? pm : ym), 52, 40);

  // the bottle with a message, and the coil of rope with its knitted buoy, on the right
  const r = new Mesh(true), g = new Mesh(false), y = new Mesh(true);
  {
    const [bx, bz] = bottleAt, by = groundY(bx, bz), K = 1.8;
    // lying on the sand, its neck raised a little, pointing away to the left: its own +y laid
    // along the axis A, its x along B (level), its z along A x B
    const ang = -0.25, tilt = 0.32;
    const A = [Math.cos(ang) * Math.cos(tilt), Math.sin(tilt), Math.sin(ang) * Math.cos(tilt)], B = [-Math.sin(ang), 0, Math.cos(ang)];
    const Cv = [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]];
    const put = (m, v0, sx, sy, sz) => {
      for (let v = v0; v < m.count; v++) {
        const px = m.p[v * 3], py = m.p[v * 3 + 1], pz = m.p[v * 3 + 2], nx = m.n[v * 3], ny = m.n[v * 3 + 1], nz = m.n[v * 3 + 2];
        for (let k = 0; k < 3; k++) { m.p[v * 3 + k] = [sx, sy, sz][k] + (A[k] * py + B[k] * px + Cv[k] * pz) * K; m.n[v * 3 + k] = A[k] * ny + B[k] * nx + Cv[k] * nz; }
      }
    };
    const v0 = g.count;
    lathe(g, 0, 0, 0, [[0.001, 0.0], [0.11, 0.01], [0.125, 0.06], [0.125, 0.3], [0.1, 0.38], [0.045, 0.45], [0.04, 0.55], [0.048, 0.565], [0.04, 0.58]], 18);
    put(g, v0, bx - A[0] * 0.25, by + 0.2, bz - A[2] * 0.25);
    // the message inside, rolled and tied; the cork
    const v1 = r.count;
    lathe(r, 0, 0, 0, [[0.001, 0.08], [0.05, 0.085], [0.05, 0.3], [0.001, 0.305]], 10, null, [0.94, 0.88, 0.74]);
    for (let v = v1; v < r.count; v++) { r.a[v * 4] = 0.87; r.a[v * 4 + 1] = 0.75; r.a[v * 4 + 2] = 0.52; r.a[v * 4 + 3] = 0; }
    const v2 = r.count;
    lathe(r, 0, 0, 0, [[0.001, 0.54], [0.043, 0.545], [0.046, 0.62], [0.001, 0.625]], 10);
    for (let v = v2; v < r.count; v++) { r.a[v * 4] = 0.35; r.a[v * 4 + 1] = 0.16; r.a[v * 4 + 2] = 0.06; r.a[v * 4 + 3] = 0; }
    const v3 = r.count;
    tube(r, [[0, 0.17, -0.052, 0.012], [0.052, 0.17, 0, 0.012], [0, 0.17, 0.052, 0.012], [-0.052, 0.17, 0, 0.012], [0, 0.17, -0.052, 0.012]], 5);
    for (let v = v3; v < r.count; v++) { r.a[v * 4] = 0.70; r.a[v * 4 + 1] = 0.03; r.a[v * 4 + 2] = 0.03; r.a[v * 4 + 3] = 0; }
    put(r, v1, bx - A[0] * 0.25, by + 0.2, bz - A[2] * 0.25);
  }
  const rope = new Mesh(true);
  {
    const [cx, cz] = coilAt, cy = groundY(cx, cz) - 0.02, R = 0.55, rr = 0.07, turns = 4.2, N = Math.round(turns * (q.amount >= 1 ? 26 : 16)), pts = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, a = t * turns * TAU, rad = R * (1 - 0.06 * Math.sin(t * turns * 2.1)) - (t > 0.85 ? (t - 0.85) * R * 1.4 : 0);
      pts.push([cx + Math.cos(a) * rad, cy + rr + t * turns * rr * 1.75, cz + Math.sin(a) * rad, rr]);
    }
    // a loose end trailing over the sand
    const e = pts[pts.length - 1];
    for (let i = 1; i <= 8; i++) { const t = i / 8, ex = e[0] + t * 1.4, ez = e[2] + Math.sin(t * 3) * 0.35; pts.push([ex, Math.max(groundY(ex, ez) + rr * 0.8, e[1] - t * 0.5), ez, rr]); }
    const v0 = rope.count, acc = [0];
    for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
    tube(rope, pts, q.amount >= 1 ? 8 : 6);
    // aux: around (0..1), along (metres), from the tube's own coordinates
    for (let v = v0; v < rope.count; v++) { rope.a[v * 4] = rope.u[v * 2]; rope.a[v * 4 + 1] = acc[Math.round(rope.u[v * 2 + 1] * (pts.length - 1))]; }
    // the buoy resting on it, tilted: knitted, red and cream
    const v1 = y.count, tl = 0.6, ct = Math.cos(tl), st = Math.sin(tl);
    orb(y, 0, 0, 0, (dx, dy, dz) => 1 / Math.sqrt((dx / 0.36) ** 2 + (dy / 0.55) ** 2 + (dz / 0.36) ** 2), q.amount >= 1 ? 10 : 7);
    for (let v = v1; v < y.count; v++) {
      const px = y.p[v * 3], py = y.p[v * 3 + 1], pz = y.p[v * 3 + 2], nx = y.n[v * 3], ny = y.n[v * 3 + 1];
      y.p[v * 3] = cx + px * ct - py * st; y.p[v * 3 + 1] = cy + turns * rr * 1.75 + 0.45 + px * st + py * ct; y.p[v * 3 + 2] = cz + pz;
      y.n[v * 3] = nx * ct - ny * st; y.n[v * 3 + 1] = nx * st + ny * ct;
      // aux: red, and the stripes come from the yarn's second colour by row along its length
      y.a[v * 4] = 0.80; y.a[v * 4 + 1] = 0.16; y.a[v * 4 + 2] = 0.10; y.a[v * 4 + 3] = 1;
    }
  }
  const mk = (m, mat, range) => { const geo = m.build(); geo.computeBoundingSphere(); const mesh = new ThreeMesh(geo, mat); mesh.matrixAutoUpdate = false; add(mesh, range); };
  mk(rope, ropeMat(), 50); mk(y, plainMat(), 50); mk(r, plainMat(), 40); mk(g, glassMat(), 40);
  return n;
}

export function buildFlora(add, q) {
  const { plants, blades, stones } = buildKelp(add, q), grass = buildGrass(add, q), reef = buildReef(add, q), props = buildShallows(add, q);
  return { plants, blades, stones, grass, reef, props };
}
