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
  abs, attribute, cameraPosition, clamp as clampN, cos, cross, dot, float, floor, fract, length, max, mix, normalize, pow, select, sin, smoothstep, sqrt, step,
  texture, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';
import { centerX, cleared, groundY, halfWidth, offTrack } from './layout.js';
import { Mesh, TAU, blob, clamp, fbm2, fbm3, lathe, makeRng, noise2, noise3, tube } from './math.js';
import { perches } from './rocks.js';
import { G, detail, material, shadow1, sunAt, yarn } from './shaders.js';
import { instanced, place } from './world.js';

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
  const bend = vec2(sin(hh.mul(0.21).add(seed.mul(40.0))), cos(hh.mul(0.17).add(seed.mul(23.0)))).mul(smoothstep(0.0, 5.0, hh).mul(0.35));
  return base.add(vec3(sway.x.add(bend.x), hh, sway.y.add(bend.y)));
};
// a stalk's radius at its foot, and a float's radius
const stalkR = (ps) => mix(float(0.17), float(0.25), fract(ps.mul(7.31)));
const floatR = (seed, h) => mix(float(0.32), float(0.5), fract(seed.mul(3.71))).mul(float(1.0).sub(h.mul(0.25)));

// The kelp's blades: felt ribbons, in the colours of the picture.
const KELP = [[0.98, 0.52, 0.08], [0.98, 0.36, 0.08], [0.95, 0.32, 0.45], [0.08, 0.58, 0.55], [0.52, 0.22, 0.72], [0.58, 0.55, 0.12], [0.88, 0.62, 0.14]];
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
      B.addAssign(capsulePush(B, C, ax, L2, sideOf(A, C, ax, L2), 1.35, 0.95));
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
    s.albedo = col.mul(m.a.mul(0.24).add(0.88)).mul(float(1).sub(max(vein, mid).mul(0.2))).mul(smoothstep(0.0, 0.25, t).mul(0.25).add(0.75));
    s.n = normalize(s.n.add(vec3(m.r.sub(0.5), 0.0, m.g.sub(0.5)).mul(0.25)));
    s.ao = smoothstep(0.0, 0.3, t).mul(0.3).add(0.7);
    s.spec = float(0.02); s.gloss = float(6.0); s.fluor = float(0.5);
    const sh = shadow1(f.w.add(G.sunDir.mul(0.3))).toVar();
    s.shade = sh; s.trans = float(0.7);
    // felt is thin: the light comes through it, most of all looking toward the sun
    const vv = normalize(f.w.sub(cameraPosition));
    const toward = pow(max(dot(vv, G.sunDir), 0.0), 3.0);
    s.emis = s.emis.add(sunAt(f.w.y).mul(sh.mul(0.8).add(0.2)).mul(toward.mul(0.45).add(0.07)).mul(s.albedo));
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
    yarn(s, f, { color: vec3(0.60, 0.46, 0.14).mul(k), color2: vec3(0.82, 0.58, 0.17).mul(k), stripe: 22, scale: 26, p: f.aux.xyz, k: 1.3 });
    s.shade = shadow1(f.w.add(G.sunDir.mul(0.2)));
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
    const col = select(c.lessThan(0.4), vec3(0.80, 0.58, 0.18), select(c.lessThan(0.75), vec3(0.60, 0.52, 0.16), vec3(0.94, 0.68, 0.20)));
    yarn(s, f, { color: col, p: f.obj.mul(f.aux.x), scale: 26, k: 1.4 });
    s.shade = shadow1(f.w.add(G.sunDir.mul(0.3)));
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
    const gc = mix(mix(vec3(0.30, 0.66, 0.32), vec3(0.48, 0.72, 0.28), g), mix(vec3(0.44, 0.60, 0.42), vec3(0.58, 0.60, 0.30), g), clump);
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
  blob(m, 0, 0, 0, (x, y, z) => 0.5 * (1 + 0.2 * fbm3(x * 1.2 + seed, y * 1.2, z * 1.2, 3) + 0.06 * noise3(x * 3.1, y * 3.1 + seed, z * 3.1)), res);
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
const FELT = [[0.46, 0.52, 0.56], [0.38, 0.44, 0.50], [0.56, 0.54, 0.50], [0.68, 0.62, 0.52], [0.36, 0.50, 0.50], [0.52, 0.56, 0.60]];

function buildKelp(add, q) {
  const rng = makeRng(4242);
  const lvl = q.amount >= 1 ? 1 : q.amount >= 0.5 ? 0.72 : 0.5;
  const plants = Math.round(70 * lvl);
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
    for (let i = 0; i < feet.length; i += 2) if ((feet[i] - x) ** 2 + (feet[i + 1] - z) ** 2 < 4.6 * 4.6) { crowd = true; break; }
    if (crowd) continue;
    feet.push(x, z);
    const g = groundY(x, z), H = (-g - rng.range(0.8, 4.5)) * rng.range(0.8, 1), ps = rng();
    if (H < 4) continue;
    stalks.push(x, g, z, H, 0, 0, 0, 0, 0, 0, 0, ps);
    // a float and a blade every metre and a half or two up the stalk, turning round it, and
    // two that stream up from the top; most in the plant's own colour
    const own = pickKelp(rng()), count = Math.max(3, Math.round(H / rng.range(2.1, 2.9)));
    let ang = rng() * TAU;
    for (let b = 0; b <= count; b++) {
      const top = b === count;
      const h = top ? 1 : clamp(0.2 + 0.78 * (b + rng.range(-0.25, 0.25)) / count, 0.12, 0.97);
      ang += rng.range(1.6, 2.9);
      const col = rng() < 0.7 ? own : pickKelp(rng());
      const len = top ? rng.range(2.8, 3.8) : rng.range(3.4, 5.2) * (0.8 + 0.3 * h);
      const droop = top ? rng.range(-0.3, 0.05) : rng.range(0.55, 1.0);
      blades.push(x, g, z, H, h, ang, len, rng.range(0.4, 0.62), rng(), droop, col, ps);
    }
    n++;
  }
  const rows = q.amount >= 1 ? 16 : q.amount >= 0.5 ? 12 : 9;
  cells(add, strip(rows, 4), kelpBladeMat(), blades, 20, 76, 7);
  const bm = new Mesh(false);
  blob(bm, 0, 0, 0, () => 1, q.amount >= 1 ? 5 : 4);
  const bg = bm.build();
  cells(add, { position: bg.getAttribute('position'), normal: bg.getAttribute('normal'), uv: bg.getAttribute('uv'), index: bg.index }, kelpFloatMat(), blades, 20, 64, 2);
  cells(add, stalk(q.amount >= 1 ? 18 : 12, q.amount >= 0.5 ? 8 : 6), kelpStalkMat(), stalks, 28, 78, 2);
  // felted boulders: a few at each stalk's foot, and a border along the sand down the middle
  const stones = [], srng = makeRng(5150);
  const stone = (x, z, r, flat) => {
    const c = srng.pick(FELT), k = srng.range(0.88, 1.1);
    stones.push(x, groundY(x, z) - r * 0.28, z, r * srng.range(0.9, 1.25), r * flat, r * srng.range(0.85, 1.15), srng() * TAU, c[0] * k, c[1] * k, c[2] * k);
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
  scatter(add, stoneShape(3.7, q.amount >= 1 ? 7 : 5), feltMat(), stones, 70, 26);
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

// Each shape is grown at about one metre high, then its vertices are told what they are:
// aux = (how far it gives with the water, 0, how open to the light, how near its tip).
function finish(m, f) {
  const o = [0, 0, 0, 0];
  for (let v = 0; v < m.count; v++) {
    f(m.p[v * 3], m.p[v * 3 + 1], m.p[v * 3 + 2], m.a[v * 4], m.a[v * 4 + 1], m.n[v * 3 + 1], o);
    m.a[v * 4] = o[0]; m.a[v * 4 + 1] = o[1]; m.a[v * 4 + 2] = o[2]; m.a[v * 4 + 3] = o[3];
  }
  return m.build();
}
const SHAPES = {
  // antlers: branches that fork and reach up
  staghorn(rng) {
    const m = new Mesh(true);
    const grow = (x, y, z, dx, dy, dz, len, r, depth) => {
      const ex = x + dx * len, ey = y + dy * len, ez = z + dz * len;
      tube(m, [[x, y, z, r], [(x + ex) / 2 + rng.bell() * len * 0.14, (y + ey) / 2, (z + ez) / 2 + rng.bell() * len * 0.14, r * 0.85], [ex, ey, ez, r * 0.6]], 4, [depth, 0, 0]);
      if (depth >= 3) return;
      const kids = depth === 0 ? 4 : 2 + (rng() < 0.35 ? 1 : 0);
      for (let k = 0; k < kids; k++) {
        const cx = dx + rng.bell() * 1.2, cy = dy + 0.3 + rng() * 0.5, cz = dz + rng.bell() * 1.2, l = Math.hypot(cx, cy, cz);
        grow(ex, ey, ez, cx / l, cy / l, cz / l, len * rng.range(0.62, 0.86), r * 0.62, depth + 1);
      }
    };
    grow(0, -0.08, 0, 0, 1, 0, 0.3, 0.085, 0);
    return finish(m, (x, y, z, s, depth, ny, o) => { o[0] = 0; o[1] = 0; o[2] = 0.4 + 0.6 * clamp(y / 0.6, 0, 1); o[3] = clamp((depth + s) / 4, 0, 1); });
  },
  // a ruffle: a cup of hyperbolic crochet that flares into a frilled, wavy edge
  table(rng) {
    const m = new Mesh(true), a = rng() * TAU, waves = 7 + Math.floor(rng() * 6), tall = rng.range(0.35, 0.6);
    m.grid(72, 12, (s, t, o) => {
      const ang = s * TAU, fr = Math.pow(t, 2.0);
      const r = (0.06 + 0.7 * Math.pow(t, 1.25)) * (1 + 0.1 * fr * Math.cos(ang * waves * 2 + a));
      o[0] = Math.cos(ang) * r; o[1] = 0.02 + tall * t + 0.17 * fr * Math.sin(ang * waves + a); o[2] = Math.sin(ang) * r;
      o[3] = t;
    }, true, true);
    return finish(m, (x, y, z, t, _, ny, o) => { o[0] = 0; o[1] = 0; o[2] = 0.45 + 0.55 * t; o[3] = t; });
  },
  // a mound, lumpy like a brain
  // a brain coral: a dome of coiled cord, its grooves winding over it
  mound(rng) {
    const m = new Mesh(true), s = rng() * 9;
    blob(m, 0, 0.3, 0, (x, y, z) => (0.55 + 0.06 * noise3(x * 2.2 + s, y * 2.2, z * 2.2) + 0.035 * (1 - 2 * Math.abs(Math.sin(noise3(x * 3 + s, y * 3, z * 3) * 9 + x * 3)))) * (y < 0 ? 0.75 : 1), 14);
    return finish(m, (x, y, z, _, __, ny, o) => { o[0] = 0; o[1] = 1; o[2] = 0.45 + 0.55 * clamp(y / 0.5, 0, 1); o[3] = 0.5 + 0.4 * clamp(y, 0, 1); });
  },
  // knobs on knobs
  cauliflower(rng) {
    const m = new Mesh(true), s = rng() * 9;
    blob(m, 0, 0.28, 0, (x, y, z) => 0.42 + 0.16 * Math.abs(noise3(x * 3.1 + s, y * 3.1, z * 3.1)) + 0.1 * Math.abs(noise3(x * 6.3, y * 6.3 + s, z * 6.3)), 8);
    return finish(m, (x, y, z, _, __, ny, o) => { const r = Math.hypot(x, y - 0.28, z); o[0] = 0; o[1] = 0; o[2] = clamp((r - 0.4) * 4, 0.3, 1); o[3] = clamp((r - 0.42) * 5, 0, 1); });
  },
  // tubes: open at the top, in a bunch
  sponge(rng) {
    const m = new Mesh(true), n = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, d = i ? rng.range(0.1, 0.3) : 0, h = rng.range(0.5, 1.1), r = rng.range(0.07, 0.13), lean = rng.range(0, 0.25);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const g = m.count;
      lathe(m, 0, 0, 0, [[r * 0.7, -0.1], [r, h * 0.5], [r * 1.25, h], [r * 1.05, h + 0.02], [r * 0.8, h * 0.55]], 9, null, [h, 0, 0]);
      for (let v = g; v < m.count; v++) { const y = m.p[v * 3 + 1]; m.p[v * 3] += x + Math.cos(a) * lean * y; m.p[v * 3 + 2] += z + Math.sin(a) * lean * y; }
    }
    return finish(m, (x, y, z, t, h, ny, o) => { o[0] = 0.02 * clamp(y, 0, 1); o[1] = 0; o[2] = t > 0.9 ? 0.25 : 0.5 + 0.5 * clamp(y / h, 0, 1); o[3] = clamp(y / h, 0, 1) * 0.8; });
  },
  // a fan: fine branches in one plane, across the current
  fan(rng) {
    const m = new Mesh(true);
    const grow = (x, y, ang, len, r, depth) => {
      const ex = x + Math.sin(ang) * len, ey = y + Math.cos(ang) * len;
      tube(m, [[x, y, rng.bell() * 0.02, r], [ex, ey, rng.bell() * 0.02, r * 0.7]], 3, [depth, 0, 0]);
      if (depth >= 5) return;
      const kids = depth < 2 ? 3 : 2;
      for (let k = 0; k < kids; k++) grow(ex, ey, ang + (k - (kids - 1) / 2) * rng.range(0.45, 0.75) + rng.bell() * 0.2, len * rng.range(0.66, 0.84), r * 0.72, depth + 1);
    };
    grow(0, -0.08, 0, 0.26, 0.035, 0);
    return finish(m, (x, y, z, s, depth, ny, o) => { o[0] = 0.07 * clamp(y, 0, 1.4) * clamp(y, 0, 1.4); o[1] = 0; o[2] = 0.75; o[3] = clamp((depth + s) / 6, 0, 1); });
  },
  // whips: tall and thin, a handful together
  whips(rng) {
    const m = new Mesh(true), n = 5 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, d = rng.range(0, 0.14), h = rng.range(0.7, 1.5), lx = Math.cos(a) * rng.range(0.05, 0.3), lz = Math.sin(a) * rng.range(0.05, 0.3);
      const pts = [];
      for (let k = 0; k <= 4; k++) { const t = k / 4; pts.push([Math.cos(a) * d + lx * t * t, -0.05 + h * t, Math.sin(a) * d + lz * t * t, 0.022 * (1 - 0.5 * t)]); }
      tube(m, pts, 4, [h, 0, 0]);
    }
    return finish(m, (x, y, z, s, h, ny, o) => { o[0] = 0.16 * s * s; o[1] = 0; o[2] = 0.6 + 0.4 * s; o[3] = s; });
  },
  // an anemone: a short column under a crown of arms
  anemone(rng) {
    const m = new Mesh(true);
    lathe(m, 0, 0, 0, [[0.2, -0.05], [0.17, 0.16], [0.24, 0.24], [0, 0.27]], 10, null, [-1, 0, 0]);
    for (let i = 0; i < 26; i++) {
      const a = rng() * TAU, d = 0.05 + 0.17 * Math.sqrt(rng()), len = rng.range(0.22, 0.4), out = d * 1.3;
      const pts = [];
      for (let k = 0; k <= 3; k++) { const t = k / 3; pts.push([Math.cos(a) * (d + out * t * t), 0.24 + len * t, Math.sin(a) * (d + out * t * t), 0.022 * (1 - 0.35 * t)]); }
      tube(m, pts, 4, [1, 0, 0]);
    }
    return finish(m, (x, y, z, s, arm, ny, o) => { const k = arm > 0 ? s : 0; o[0] = 0.09 * k; o[1] = 0; o[2] = arm > 0 ? 0.55 + 0.45 * k : 0.6; o[3] = arm > 0 ? k : 0.15; });
  },
  // a starfish: five plump arms, flat on the sand
  starfish(rng) {
    const m = new Mesh(true), twist = rng() * TAU;
    blob(m, 0, 0.04, 0, (x, y, z) => {
      const a = Math.atan2(z, x) + twist, arm = Math.pow(Math.max(0, Math.cos(a * 2.5)), 2.2);
      const flat = 0.35 + 0.65 * Math.abs(y) < 0.5 ? 1 : 1;
      return (0.16 + 0.42 * arm) * (Math.abs(y) > 0.3 ? 0.55 : 1) * flat;
    }, 10);
    for (let i = 0; i < m.count; i++) m.p[i * 3 + 1] *= 0.32;
    return finish(m, (x, y, z, _, __, ny, o) => { o[0] = 0; o[1] = 0; o[2] = 0.6 + 0.4 * Math.max(ny, 0); o[3] = 0.6 + 0.4 * Math.min(1, Math.hypot(x, z) * 2); });
  },
  // a scallop shell: a fan of ribs, cupped, lying on the sand
  shell(rng) {
    const m = new Mesh(true);
    m.grid(28, 8, (s, t, o) => {
      const a = (s - 0.5) * 2.4, r = 0.08 + 0.42 * t;
      const rib = 1 + 0.05 * Math.cos(s * 28 * Math.PI) * t;
      o[0] = Math.sin(a) * r * rib; o[2] = Math.cos(a) * r * rib - 0.2; o[1] = 0.03 + 0.14 * Math.sin(t * Math.PI * 0.9) * (1 - 0.4 * Math.abs(s - 0.5) * 2);
      o[3] = t;
    }, false, true);
    return finish(m, (x, y, z, t, _, ny, o) => { o[0] = 0; o[1] = 0; o[2] = 0.65 + 0.35 * t; o[3] = 0.55 + 0.45 * t; });
  },
  // a tube worm: a white tube with a red plume, for the vents
  worm(rng) {
    const m = new Mesh(true), h = rng.range(0.6, 1.2);
    const pts = [];
    for (let k = 0; k <= 3; k++) { const t = k / 3; pts.push([0.06 * Math.sin(t * 3 + h * 9), -0.1 + h * t, 0.05 * Math.cos(t * 2.4 + h * 5), 0.035]); }
    tube(m, pts, 5, [0, 0, 0]);
    blob(m, pts[3][0], pts[3][1] + 0.07, pts[3][2], () => 0.06, 3, (x, y, z, o) => { o[0] = 1; o[1] = 1; });
    return finish(m, (x, y, z, s, plume, ny, o) => { o[0] = 0.03 * s; o[1] = plume > 0.5 ? 2 : 0; o[2] = 0.5 + 0.5 * s; o[3] = plume > 0.5 ? 1 : 0.2; });
  },
};

const tint = attribute('tint', 'vec4');
const vTint = varyingProperty('vec4', 'v_tint');
const reefMat = () => material({
  aux: true, instanced: true, fade: [55, 68], twoSided: true,
  vertex: (v) => {
    vTint.assign(tint);
    // what is soft gives with the water, more toward its ends
    const ph = G.time.mul(0.9).add(tint.w.mul(40.0)).toVar();
    const k = v.aux.x.mul(length(attribute('i0', 'vec4').xyz));
    v.P.assign(v.P.add(vec3(sin(ph).add(sin(ph.mul(2.3)).mul(0.4)), 0.0, cos(ph.mul(0.8)).mul(0.6)).mul(k)));
  },
  surface: (s, f) => {
    const base = select(f.aux.y.greaterThan(1.5), vec3(0.92, 0.12, 0.10), vTint.rgb);        // (a plume is always red)
    s.ao = f.aux.z;
    yarn(s, f, { color: base.mul(f.aux.w.mul(0.3).add(0.8)), scale: 18 });
    s.trans = select(f.aux.x.greaterThan(0.0), float(0.35), float(0.18));
  },
});

// The colours corals come in.
const CORAL = [[0.96, 0.38, 0.55], [0.98, 0.45, 0.33], [0.98, 0.56, 0.16], [0.64, 0.32, 0.84], [0.88, 0.16, 0.24], [0.98, 0.84, 0.26], [0.16, 0.66, 0.62], [0.78, 0.56, 0.92]];
const SPONGE = [[0.98, 0.76, 0.20], [0.64, 0.30, 0.82], [0.96, 0.42, 0.18], [0.22, 0.62, 0.86]];
const FAN = [[0.72, 0.30, 0.86], [0.94, 0.30, 0.32], [0.98, 0.64, 0.22]];
const BONE = [[0.82, 0.80, 0.74]];
const STAR = [[0.98, 0.50, 0.20], [0.96, 0.36, 0.40], [0.66, 0.36, 0.84], [0.98, 0.74, 0.26]];
const SHELL = [[0.96, 0.86, 0.74], [0.98, 0.70, 0.66], [0.92, 0.80, 0.56]];

// What is planted: shape, how many (on high), where (z from, z to), on the ground or on
// the formations or both, size from and to, colours, variants of the shape.
const PLANTING = [
  ['staghorn', 280, -122, -192, 'both', 0.7, 1.9, CORAL, 3], ['table', 90, -124, -190, 'both', 0.7, 2.0, CORAL, 2], ['mound', 170, -120, -194, 'ground', 0.6, 1.8, CORAL, 3],
  ['cauliflower', 190, -120, -194, 'both', 0.5, 1.3, CORAL, 3], ['sponge', 150, -118, -196, 'both', 0.6, 1.5, SPONGE, 3], ['fan', 90, -126, -196, 'rock', 0.9, 2.2, FAN, 2],
  ['whips', 90, -128, -200, 'both', 0.8, 1.7, FAN, 2], ['anemone', 140, -118, -192, 'both', 0.6, 1.3, CORAL, 2],
  // the shallows and the kelp have a little of it too
  ['starfish', 70, 14, -60, 'ground', 0.25, 0.42, STAR, 2], ['shell', 60, 14, -60, 'ground', 0.18, 0.32, SHELL, 2], ['sponge', 26, -60, -118, 'ground', 0.6, 1.2, SPONGE, 1],
  // the ledge and the wreck: fans, whips and sponges, sparser
  ['fan', 26, -200, -264, 'both', 0.9, 2.0, FAN, 1], ['whips', 26, -200, -264, 'both', 0.8, 1.6, FAN, 1], ['sponge', 30, -198, -264, 'both', 0.6, 1.4, SPONGE, 1],

];

function buildReef(add, q) {
  const rng = makeRng(31337), mat = reefMat();
  const pos = new Vector3(), quat = new Quaternion(), yaw = new Quaternion(), scl = new Vector3(), up = new Vector3(0, 1, 0), nrm = new Vector3();
  let planted = 0;
  for (const [name, count, zA, zB, where, s0, s1, colours, variants] of PLANTING) {
    // the formations' own places in this stretch
    const spots = [];
    for (let i = 0; i < perches.length; i += 6) if (perches[i + 2] <= zA && perches[i + 2] >= zB) spots.push(i);
    const total = Math.max(2, Math.round(count * q.amount));
    for (let v = 0; v < variants; v++) {
      const geo = SHAPES[name](rng), n = Math.ceil(total / variants);
      // two halves along the dive, so the far half can be left undrawn
      for (let half = 0; half < 2; half++) {
        const z0 = half ? (zA + zB) / 2 : zA, z1 = half ? zB : (zA + zB) / 2, list = [];
        for (let tries = 0; tries < n * 12 && list.length < Math.ceil(n / 2) * 12; tries++) {
          const onRock = where === 'rock' || (where === 'both' && rng() < 0.55);
          let x, y, z;
          if (onRock) {
            if (!spots.length) continue;
            const i = spots[(rng() * spots.length) | 0];
            x = perches[i]; y = perches[i + 1]; z = perches[i + 2];
            if (z > z0 || z < z1) continue;
            nrm.set(perches[i + 3], perches[i + 4] + 1.2, perches[i + 5]).normalize();
          } else {
            z = z0 + (z1 - z0) * rng();
            const w = halfWidth(z);
            // most along the camera's way, a few metres to either side, where it sees them close
            x = rng() < 0.7 ? centerX(z) + rng.sign() * (2.5 + Math.abs(rng.bell()) * 11) : centerX(z) + rng.range(-1, 1) * (w + 5);
            y = groundY(x, z);
            if (name === 'worm' && noise2(x * 0.2, z * 0.2) < 0.05) continue;       // in colonies
            nrm.set(groundY(x - 0.4, z) - groundY(x + 0.4, z), 1.6, groundY(x, z - 0.4) - groundY(x, z + 0.4)).normalize();
          }
          const s = s0 + (s1 - s0) * rng() * rng();
          if (offTrack(x, z, y + s * 0.5) < 1.6 + s) continue;
          if (cleared(x, z)) continue;
          const c = colours[(rng() * colours.length) | 0], k = rng.range(0.75, 1.15);
          list.push(x, y, z, s, nrm.x, nrm.y, nrm.z, rng() * TAU);
          list.push(c[0] * k, c[1] * k, c[2] * k, rng());
        }
        const cnt = list.length / 12;
        if (!cnt) continue;
        const places = [], tints = new Float32Array(cnt * 4);
        for (let i = 0; i < cnt; i++) {
          const o = i * 12;
          quat.setFromUnitVectors(up, nrm.set(list[o + 4], list[o + 5], list[o + 6]));
          quat.multiply(yaw.setFromAxisAngle(up, list[o + 7]));
          place(places, pos.set(list[o], list[o + 1], list[o + 2]), quat, scl.setScalar(list[o + 3]));
          for (let k = 0; k < 4; k++) tints[i * 4 + k] = list[o + 8 + k];
        }
        const mesh = new ThreeMesh(instanced(geo, places, { tint: [4, tints] }), mat);
        mesh.matrixAutoUpdate = false;
        add(mesh, 70);
        planted += cnt;
      }
    }
  }
  return planted;
}

export function buildFlora(add, q) {
  const { plants, blades } = buildKelp(add, q), grass = buildGrass(add, q), reef = buildReef(add, q);
  return { plants, blades, grass, reef };
}
