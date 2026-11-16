// What grows: the kelp forest, sea grass in the shallows, and the reef's corals, sponges,
// fans and anemones.
//
// Kelp and grass are blades. A blade is never stored: the vertex shader builds each one
// from three numbers-of-four (where its plant stands and how tall it is; where on the
// stalk it hangs, which way, how long and wide; its own seed and droop), bends it along a
// curve, twists and ruffles it, and moves it with the water. Blades are solid leaves seen
// from both sides, not cards with holes cut in them, so their edges stay clean. They are
// kept in cells on the ground: a cell out of view or out of range is not drawn, and far
// blades are thinned out (and the ones left widened) rather than shrunk to shimmer.
//
// The reef is made of a dozen shapes grown here from tubes, lathes and blobs, each drawn
// many times over with its own place, size and colour.
import { BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh as ThreeMesh, Quaternion, Sphere, Vector3 } from 'three/webgpu';
import {
  abs, attribute, cameraPosition, cos, cross, dot, float, floor, fract, length, max, mix, normalize, pow, select, sin, smoothstep, step,
  varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';
import { centerX, groundY, halfWidth, offTrack } from './layout.js';
import { Mesh, TAU, blob, clamp, fbm2, lathe, makeRng, noise2, noise3, tube } from './math.js';
import { perches } from './rocks.js';
import { G, detail, material, shadow1, sunAt, yarn } from './shaders.js';
import { instanced, place } from './world.js';

// ---- blades ----------------------------------------------------------------------------

// Where the stalk is at a height: it leans with the water, more the higher, and is never quite straight.
// (written out where it is used: a function of its own would not see the time in the vertex stage)
const stemAt = (base, hh, seed) => {
  const ph = G.time.mul(0.5).add(base.x.mul(0.13)).add(base.z.mul(0.09)).add(seed.mul(6.28)).toVar();
  const a = pow(hh, 1.25).mul(0.03);
  const sway = vec2(sin(ph).add(sin(ph.mul(1.9).add(1.3)).mul(0.35)), cos(ph.mul(0.83).add(0.6)).mul(0.7)).mul(a);
  const bend = vec2(sin(hh.mul(0.31).add(seed.mul(40.0))), cos(hh.mul(0.23).add(seed.mul(23.0)))).mul(smoothstep(0.0, 4.0, hh).mul(0.4));
  return base.add(vec3(sway.x.add(bend.x), hh, sway.y.add(bend.y)));
};

// ia: the plant (x, y, z of its foot, and its height); ib: the blade (how far up the stalk
// 0..1, which way it faces, its length, its width); ic: its seed, its droop, its kind (0
// kelp, 1 grass), the plant's seed.
const ia = attribute('ia', 'vec4'), ib = attribute('ib', 'vec4'), ic = attribute('ic', 'vec4');

const bladeMat = (fade) => material({
  twoSided: true, fade,
  vertex: (v) => {
    const t = v.P.y.toVar(), u = v.P.x.toVar(), seed = ic.x, kind = ic.z;
    const S = stemAt(ia.xyz, ib.x.mul(ia.w), ic.w).toVar();
    // far blades are fewer and wider (never in the shadow map, where the camera is the sun)
    const far = v.shadow ? float(0.0) : smoothstep(28.0, 62.0, length(S.sub(cameraPosition))).toVar();
    const D = vec3(cos(ib.y), 0.0, sin(ib.y)).toVar(), U = vec3(0.0, 1.0, 0.0), W0 = vec3(D.z.negate(), 0.0, D.x).toVar();
    // kelp goes out and up from its float and then over; grass stands and leans
    const c1 = mix(D.mul(0.42).add(U.mul(0.5)), D.mul(0.06).add(U.mul(0.5)), kind).toVar();
    const c2 = mix(D.mul(0.95).add(U.mul(float(0.42).sub(ic.y))), D.mul(ic.y.mul(0.5).add(0.2)).add(U.mul(0.95)), kind).toVar();
    const ph = G.time.mul(seed.mul(0.5).add(1.0)).add(seed.mul(30.0)).add(S.x.mul(0.2)).add(S.z.mul(0.13)).toVar();
    c2.addAssign(vec3(0.17, 0.0, 0.11).mul(sin(ph.mul(0.6))).add(U.mul(sin(ph).mul(0.07))));
    const omt = float(1.0).sub(t);
    const Q = c1.mul(omt.mul(t).mul(2.0)).add(c2.mul(t.mul(t))).mul(ib.z);
    const T = normalize(c1.mul(omt.sub(t).mul(2.0)).add(c2.mul(t.mul(2.0)))).toVar();
    const N0 = normalize(cross(W0, T)).toVar();
    const tw = seed.sub(0.5).mul(2.4).mul(t).add(sin(ph.add(t.mul(4.0))).mul(0.35)).toVar();
    const W = W0.mul(cos(tw)).add(N0.mul(sin(tw))).toVar(), Nn = N0.mul(cos(tw)).sub(W0.mul(sin(tw))).toVar();
    const ribbon = smoothstep(0.0, 0.12, t).mul(float(1.0).sub(pow(t, 6.0).mul(0.75)));
    const wd = ib.w.mul(mix(ribbon, float(1.0).sub(t.mul(t).mul(0.9)), kind)).mul(far.mul(1.3).add(1.0));
    const rp = t.mul(16.0).add(seed.mul(50.0)).toVar(), edge = abs(u).mul(float(1.0).sub(kind)).toVar();
    const P = S.add(Q).add(W.mul(u.mul(wd))).add(Nn.mul(sin(rp).mul(0.38).mul(ib.w).mul(edge).sub(float(1.0).sub(abs(u)).mul(0.12).mul(ib.w))));
    // far away, most blades are not drawn at all: they fold to a point
    v.P.assign(select(fract(seed.mul(7.13)).greaterThan(float(1.0).sub(far.mul(0.72))), S, P));
    v.N.assign(normalize(Nn.add(W.mul(u).mul(0.4)).sub(T.mul(cos(rp)).mul(0.5).mul(edge))));
    v.aux.assign(vec4(t, u, floor(ic.w.mul(4.0)).add(seed.mul(0.99)), kind.add(ib.x.mul(0.5))));
  },
  surface: (s, f) => {
    const t = f.aux.x, kind = step(0.75, f.aux.w).toVar(), up = f.aux.w.sub(kind).mul(2.0).toVar();
    // crochet kelp in the colours of the pictures: amber, olive, plum and green, one per
    // plant; the sea grass in two greens
    const k = floor(f.aux.z);
    const kc = select(k.lessThan(0.5), vec3(0.86, 0.56, 0.16), select(k.lessThan(1.5), vec3(0.62, 0.64, 0.18), select(k.lessThan(2.5), vec3(0.58, 0.25, 0.48), vec3(0.28, 0.60, 0.30))));
    const gc = mix(vec3(0.30, 0.66, 0.32), vec3(0.48, 0.72, 0.28), fract(f.aux.z.mul(7.3)));
    s.ao = mix(up.mul(0.45).add(0.55), t.mul(0.5).add(0.5), kind);
    yarn(s, f, { color: mix(kc, gc, kind).mul(t.mul(0.2).add(0.88)), p: f.w, scale: 26, k: 1.1 });
    const sh = shadow1(f.w.add(G.sunDir.mul(0.3))).toVar();
    s.shade = sh; s.trans = float(0.55);
    // looking toward the sun through it, the yarn glows
    const vv = normalize(f.w.sub(cameraPosition));
    s.emis = s.emis.add(sunAt(f.w.y).mul(sh).mul(pow(max(dot(vv, G.sunDir), 0.0), 5.0)).mul(s.albedo).mul(0.35));
  },
});
const stalkMat = () => material({
  fade: [62, 76],
  vertex: (v) => {
    const p0 = v.P.toVar();
    const C = stemAt(ia.xyz, p0.y.mul(ia.w), ic.w);
    v.N.assign(vec3(p0.x, 0.0, p0.z));
    v.P.assign(C.add(vec3(p0.x, 0.0, p0.z).mul(float(1.0).sub(p0.y.mul(0.5)).mul(0.05))));
  },
  surface: (s, f) => {
    yarn(s, f, { color: vec3(0.50, 0.40, 0.16), p: f.w, scale: 40 });
    s.shade = shadow1(f.w.add(G.sunDir.mul(0.2)));
  },
});

// The kelp's floats: round yarn balls where blades meet the stalk.
const ballMat = () => material({
  fade: [46, 58],
  vertex: (v) => {
    const S = stemAt(ia.xyz, ib.x.mul(ia.w), ic.w);
    const D = vec3(cos(ib.y), 0.0, sin(ib.y));
    v.P.assign(S.add(D.mul(0.1)).add(v.P.mul(ic.x.mul(0.05).add(0.07))));
    v.aux.assign(vec4(ic.x, 0.0, 0.0, 0.0));
  },
  surface: (s, f) => {
    // gold, or olive
    yarn(s, f, { color: mix(vec3(0.96, 0.70, 0.22), vec3(0.72, 0.68, 0.20), step(0.5, fract(f.aux.x.mul(9.7)))), scale: 7 });
  },
});

// (the shapes below are bent in the vertex step, which makes its own normals; this one only stands in)
const up = (n) => { const a = new Float32Array(n * 3); for (let i = 1; i < a.length; i += 3) a[i] = 1; return new BufferAttribute(a, 3); };
// A strip of three columns: u is -1, 0, 1 across, t goes 0..1 up. The shader does the rest.
function strip(rows) {
  const pos = [], uv = [], idx = [];
  for (let r = 0; r <= rows; r++) for (let c = -1; c <= 1; c++) { pos.push(c, r / rows, 0); uv.push(c * 0.5 + 0.5, r / rows); }
  for (let r = 0; r < rows; r++) for (let c = 0; c < 2; c++) { const a = r * 3 + c; idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3); }
  return { position: new BufferAttribute(new Float32Array(pos), 3), normal: up(pos.length / 3), uv: new BufferAttribute(new Float32Array(uv), 2), index: new BufferAttribute(new Uint16Array(idx), 1) };
}
// A stalk: a five-sided tube, y from 0 to 1.
function stalk(rows) {
  const pos = [], idx = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c < 5; c++) { const a = (c / 5) * TAU; pos.push(Math.cos(a), r / rows, Math.sin(a)); }
  for (let r = 0; r < rows; r++) for (let c = 0; c < 5; c++) { const a = r * 5 + c, b = r * 5 + (c + 1) % 5; idx.push(a, a + 5, b, b, a + 5, b + 5); }
  return { position: new BufferAttribute(new Float32Array(pos), 3), normal: up(pos.length / 3), index: new BufferAttribute(new Uint16Array(idx), 1) };
}
// Gather instances by cell and make one mesh a cell.
function cells(add, shape, mat, list, size, range) {
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
    geo.boundingSphere = new Sphere(new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 3);
    const mesh = new ThreeMesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    add(mesh, range);
  }
}

function buildKelp(add, q) {
  const rng = makeRng(4242);
  const plants = Math.round(210 * (q.amount >= 1 ? 1 : q.amount >= 0.5 ? 0.7 : 0.45)), perMetre = q.amount >= 1 ? 4.2 : q.amount >= 0.5 ? 3.0 : 2.0;
  const wide = q.amount >= 1 ? 1 : q.amount >= 0.5 ? 1.25 : 1.6;
  const blades = [], stalks = [];
  for (let n = 0, tries = 0; n < plants && tries < plants * 30; tries++) {
    const z = -52 - rng() * 74, edge = Math.min((-52 - z) / 8, (z + 126) / 8, 1);
    if (rng() > edge) continue;                          // thinner at both ends of the forest
    const x = centerX(z) + rng.bell() * 2.2 * (halfWidth(z) + 4);
    if (offTrack(x, z) < 2.7 || Math.abs(x - centerX(z)) > halfWidth(z) + 11) continue;
    // (fewer near the camera on the left, where the words are)
    if (x < centerX(z) - 1 && offTrack(x, z) < 13 && rng() < 0.6) continue;
    // in clumps, with clearings between
    if (noise2(x * 0.11 + 3.3, z * 0.11) < -0.18 + 0.3 * rng()) continue;
    const g = groundY(x, z), H = (-g - rng.range(1.2, 5.5)) * rng.range(0.78, 1), ps = rng();
    if (H < 4) continue;
    stalks.push(x, g, z, H, 0, 0, 0, 0, 0, 0, 0, ps);
    const count = Math.round(H * perMetre * rng.range(0.75, 1.15));
    for (let b = 0; b < count; b++) {
      const h = 0.06 + 0.94 * Math.pow(rng(), 0.8), top = h > 0.9 ? 1.5 : 1;
      blades.push(x, g, z, H, h, rng() * TAU, rng.range(1.4, 2.4) * (0.7 + 0.5 * h) * top, rng.range(0.11, 0.17) * wide, rng(), rng.range(0.35, 1.1) / top, 0, ps);
    }
    n++;
  }
  cells(add, strip(q.amount >= 1 ? 6 : q.amount >= 0.5 ? 5 : 4), bladeMat([62, 76]), blades, 14, 78);
  // a float on every third blade below the top
  const balls = [];
  for (let i = 0; i < blades.length; i += 12 * 7) if (blades[i + 4] < 0.9) for (let k = 0; k < 12; k++) balls.push(blades[i + k]);
  const bm = new Mesh(false);
  blob(bm, 0, 0, 0, () => 1, q.amount >= 1 ? 3 : 2);
  const bg = bm.build();
  cells(add, { position: bg.getAttribute('position'), normal: bg.getAttribute('normal'), uv: bg.getAttribute('uv'), index: bg.index }, ballMat(), balls, 14, 60);
  cells(add, stalk(14), stalkMat(), stalks, 28, 78);
  return { plants: stalks.length / 12, blades: blades.length / 12 };
}

function buildGrass(add, q) {
  const rng = makeRng(777);
  const count = Math.round(15000 * q.amount), list = [];
  for (let n = 0, tries = 0; n < count && tries < count * 8; tries++) {
    const z = 20 - rng() * 82;
    const x = centerX(z) + rng.range(-1, 1) * (halfWidth(z) + 3);
    // meadows with sand between
    const m = fbm2(x * 0.09 + 11, z * 0.09, 3);
    if (m < 0.02 + 0.25 * rng() || (z < -50 && rng() < (-50 - z) / 12)) continue;
    const s = rng();
    list.push(x, groundY(x, z) - 0.03, z, 0, 0, rng() * TAU, rng.range(0.3, 0.75) * (0.7 + 2.2 * m), rng.range(0.022, 0.04) / Math.sqrt(q.amount), s, rng.range(0.1, 0.9), 1, rng());
    n++;
  }
  cells(add, strip(3), bladeMat([34, 45]), list, 12, 46);
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
  const kelp = buildKelp(add, q), grass = buildGrass(add, q), reef = buildReef(add, q);
  return { ...kelp, grass, reef };
}
