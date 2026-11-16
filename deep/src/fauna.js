// The creatures, and what drifts in the water: schools of fish in every lit zone, a manta
// over the reef, jellyfish and lanternfish in the twilight, shrimp at the vents, marine
// snow and glowing plankton around the eye wherever it goes, and bubbles.
//
// Nothing is simulated. Each creature is a closed-form function of the time and of its
// own handful of numbers, worked out in its vertex shader. A school goes round a loop (an
// ellipse with a wobble in it, turned and tipped); each fish keeps its own place in the
// school, wanders a little about it, and now and then darts out and eases back; it faces
// the way it moves (where it was a moment ago is worked out too, and the difference is its
// heading), and its body bends in a wave that runs from head to tail. A school, or all the
// fish of one shape in one stretch of the dive, is one instanced draw.
//
// Small things are kept from sparkling: a fish too small on screen dissolves into the
// water behind it instead of shrinking to a flicker, and a speck is never drawn narrower
// than a pixel and a bit: below that it is drawn that wide and dimmer, so it carries the
// same light.
import { BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, Mesh as ThreeMesh, Sphere, Vector3, Vector4 } from 'three/webgpu';
import {
  abs, attribute, cameraPosition, clamp, cos, cross, dot, exp, float, floor, fract, fwidth, instanceIndex, length, max, min, mix,
  normalize, pow, reflect, sign, sin, smoothstep, step, texture, uniform, uniformArray, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';
import { centerX, floorY, groundY, offTrack, pathAt } from './layout.js';
import { Mesh, TAU, lerp, makeRng, smooth, tube } from './math.js';
import { SPIRE } from './rocks.js';
import { G, SIG, material, scatter, skyAt, sunAt, sunFoot } from './shaders.js';

// Set every frame: how many metres one pixel spans one metre from the eye, and the eye's
// right and up, for what is drawn as a card that faces it.
const U = { pix: uniform(0.0011), right: uniform(new Vector3(1, 0, 0)), up: uniform(new Vector3(0, 1, 0)) };
const UP = vec3(0.0, 1.0, 0.0);

// ---- light on a speck --------------------------------------------------------------------

// What lights a thing too small to have a side: the sun as it comes down through the
// caustics' net, the lamp, the glows. (These run per vertex, where a texture is read at a
// level chosen here; the lamp and the glows are as shadeLit has them.)
function causticAt(w) {
  const q = sunFoot(w);
  const lod = min(w.y.negate().mul(0.16), 6.0);
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

// Many cards, one per copy: a square from -1 to 1 that the vertex step turns to the eye.
function cards(n, attrs, sphere) {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  for (const [name, data] of Object.entries(attrs)) g.setAttribute(name, new InstancedBufferAttribute(data, 4));
  g.instanceCount = n;
  g.boundingSphere = sphere;
  return g;
}
const solid = (geo, mat) => { const m = new ThreeMesh(geo, mat); m.matrixAutoUpdate = false; return m; };
// A sphere around boxes [x0, x1, y0, y1, z0, z1], grown to hold them all.
function sphereOf(boxes) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const b of boxes) { x0 = Math.min(x0, b[0]); x1 = Math.max(x1, b[1]); y0 = Math.min(y0, b[2]); y1 = Math.max(y1, b[3]); z0 = Math.min(z0, b[4]); z1 = Math.max(z1, b[5]); }
  return new Sphere(new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 0.5);
}

// ---- fish: shapes ------------------------------------------------------------------------

// Each kind of fish is grown one metre long, nose at x = 0.5, tail tip at -0.5, back up, its
// right side +z. A body of oval rings that swell from the nose and taper into the root of
// the tail, a forked tail, a fin along the back and one under the belly, a pair at the
// sides. aux = (x, y, how high on the ring from -1 belly to 1 back, which part: 0 body,
// 1 tail, 2 back and belly fins, 3 side fins).
//   h, w     half the height and width where it is deepest, and `at` where that is (0 the
//            nose, 1 the root of the tail); nose: how blunt (smaller is blunter)
//   ped      the root of the tail; tail, fork: the tail's half span, and how deep its fork
//   dorsal, anal: [from x, to x, height]; pect: [x, length]; arch, curl: the back's rise
//            and the body's bend down toward the tail; eye: [x, y, radius]
const SHAPES = {
  sardine: { h: 0.085, w: 0.05, at: 0.3, nose: 0.62, ped: 0.022, tail: 0.13, fork: 1.0, dorsal: [0.08, -0.07, 0.07], anal: [-0.13, -0.25, 0.025], pect: [0.27, 0.08], arch: 0.1, keel: 0.15, eye: [0.395, 0.012, 0.024], small: true },
  garibaldi: { h: 0.2, w: 0.07, at: 0.36, nose: 0.42, ped: 0.06, tail: 0.16, fork: 0.3, dorsal: [0.17, -0.27, 0.075], anal: [-0.03, -0.26, 0.08], pect: [0.22, 0.12], arch: 0.14, keel: 0.3, eye: [0.335, 0.065, 0.036] },
  damsel: { h: 0.19, w: 0.058, at: 0.33, nose: 0.5, ped: 0.05, tail: 0.15, fork: 0.85, dorsal: [0.19, -0.24, 0.08], anal: [0.0, -0.24, 0.07], pect: [0.23, 0.11], arch: 0.12, keel: 0.3, eye: [0.345, 0.05, 0.04] },
  snapper: { h: 0.15, w: 0.068, at: 0.33, nose: 0.55, ped: 0.04, tail: 0.15, fork: 0.65, dorsal: [0.17, -0.2, 0.09], anal: [-0.08, -0.22, 0.07], pect: [0.25, 0.12], arch: 0.16, keel: 0.2, eye: [0.37, 0.045, 0.03] },
  parrot: { h: 0.16, w: 0.08, at: 0.38, nose: 0.4, ped: 0.05, tail: 0.13, fork: 0.15, dorsal: [0.2, -0.22, 0.05], anal: [-0.04, -0.22, 0.05], pect: [0.24, 0.11], arch: 0.1, keel: 0.15, eye: [0.38, 0.065, 0.026] },
  lantern: { h: 0.085, w: 0.055, at: 0.25, nose: 0.4, ped: 0.025, tail: 0.11, fork: 0.85, dorsal: [0.06, -0.08, 0.055], anal: [-0.08, -0.22, 0.04], pect: [0.28, 0.07], arch: 0.05, keel: 0.1, eye: [0.39, 0.022, 0.048], small: true },
  shrimp: { h: 0.07, w: 0.06, at: 0.22, nose: 0.9, ped: 0.025, tail: 0.075, fork: -0.5, dorsal: null, anal: null, pect: [0.18, 0.1], arch: 0.3, curl: -0.14, keel: 0, eye: [0.42, 0.035, 0.03], small: true, legs: true },
};
const XP = -0.31;               // where the body ends and the tail begins

function fishShape(sp, lod) {
  const big = !sp.small;
  const nr = [6, 8, big ? 10 : 8][lod], ns = [7, 9, big ? 13 : 10][lod];
  const m = new Mesh(true);
  const p = sp.nose, qq = (p * (1 - sp.at)) / sp.at, peak = Math.pow(sp.at, p) * Math.pow(1 - sp.at, qq);
  const prof = (u) => {
    const s = (Math.pow(u, p) * Math.pow(1 - u, qq)) / peak, tail = u * u * u;
    return [sp.h * s + sp.ped * tail, sp.w * s + sp.ped * 0.45 * tail, sp.arch * sp.h * Math.sin(Math.PI * u) + (sp.curl || 0) * u * u];
  };
  const xAt = (u) => 0.5 - u * (0.5 - XP), uAt = (x) => (0.5 - x) / (0.5 - XP);
  // the body: rings from the nose back (closer together at both ends), closed off just behind the root of the tail
  m.grid(nr, ns, (s, t, o) => {
    const r = Math.round(t * ns), last = r === ns;
    const u = last ? 1.04 : 0.5 - 0.5 * Math.cos((Math.PI * r) / (ns - 1));
    const [a0, b0, yc] = prof(Math.min(u, 1)), a = last ? 0 : a0, b = last ? 0 : b0;
    const ph = s * TAU - Math.PI / 2, sn = Math.sin(ph), cs = Math.cos(ph);
    const x = xAt(u), y = yc + a * sn, z = b * cs * (1 - sp.keel * Math.pow(Math.abs(sn), 3));
    o[0] = x; o[1] = y; o[2] = z; o[3] = x; o[4] = y; o[5] = sn; o[6] = 0;
  }, true);
  // fins are thin: each is laid down twice, back to back
  const twoSided = (cols, rows, f) => {
    const i0 = m.i.length, base = m.grid(cols, rows, f), n = m.count - base, i1 = m.i.length;
    for (let v = base; v < base + n; v++) m.vert(m.p[v * 3], m.p[v * 3 + 1], m.p[v * 3 + 2], -m.n[v * 3], -m.n[v * 3 + 1], -m.n[v * 3 + 2], 0, 0, m.a[v * 4], m.a[v * 4 + 1], m.a[v * 4 + 2], m.a[v * 4 + 3]);
    for (let k = i0; k < i1; k += 3) m.i.push(m.i[k] + n, m.i[k + 2] + n, m.i[k + 1] + n);
  };
  const yEnd = prof(1)[2];
  // the tail: two lobes from the root, the fork between them
  twoSided(lod ? 4 : 2, lod ? 3 : 2, (s, t, o) => {
    const v = s * 2 - 1, span = lerp(sp.ped * 0.75, sp.tail, Math.pow(t, 0.7));
    const xt = -0.5 + sp.fork * 0.13 * Math.pow(1 - Math.abs(v), 1.2);
    const x = lerp(XP + 0.04, xt, t), y = yEnd + v * span;
    o[0] = x; o[1] = y; o[2] = 0; o[3] = x; o[4] = y; o[5] = v; o[6] = 1;
  });
  // along the back and under the belly: tallest near the front, swept back
  for (const [fin, dir] of [[sp.dorsal, 1], [sp.anal, -1]]) {
    if (!fin) continue;
    twoSided(big ? 5 : 3, 1, (s, t, o) => {
      const xb = lerp(fin[0], fin[1], s), [a, , yc] = prof(uAt(xb));
      const hgt = fin[2] * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.6)), 0.7);
      const x = xb - t * hgt * 0.55, y = yc + dir * (a * 0.9 + t * hgt);
      o[0] = x; o[1] = y; o[2] = 0; o[3] = x; o[4] = y; o[5] = dir; o[6] = 2;
    });
  }
  // at the sides, behind the gills (a shrimp's hang down: its legs)
  if (sp.pect) {
    const [px, pl] = sp.pect, [a, b, yc] = prof(uAt(px));
    for (const side of [1, -1]) twoSided(2, 1, (s, t, o) => {
      const rl = pl * (1 - 0.55 * Math.pow(Math.abs(s - 0.4) / 0.6, 2));
      const x = px - 0.03 * s - t * rl * (sp.legs ? 0.25 : 0.8);
      const y = yc - a * (0.1 + 0.4 * s) - t * rl * (sp.legs ? 0.9 : 0.2 + 0.25 * s);
      const z = side * (b * 0.8 + t * rl * (sp.legs ? 0.2 : 0.5));
      o[0] = x; o[1] = y; o[2] = z; o[3] = x; o[4] = y; o[5] = -0.2; o[6] = 3;
    });
  }
  return m.build();
}

// ---- fish: where each one is -----------------------------------------------------------

// Per fish (each four numbers):
//   fA  the school's centre (x, y, z), and how fast it goes round its loop (radians a second)
//   fB  the loop's two radii, its turn about the vertical (which also seeds its wobble), how far it rises and falls
//   fC  the fish's place: how far along the loop (radians), out from it, up from it (metres); its length
//   fD  its seed, tail beats a second, seconds between darts, its colouring (KIND below)
//   fE, fF, fG   its back, belly and fin colours, and its eye (x, y, radius on the one-metre shape)
const fA = attribute('fA', 'vec4'), fB = attribute('fB', 'vec4'), fC = attribute('fC', 'vec4'), fD = attribute('fD', 'vec4');
const fE = attribute('fE', 'vec4'), fF = attribute('fF', 'vec4'), fG = attribute('fG', 'vec4');
const vBack = varyingProperty('vec4', 'v_fback'), vBelly = varyingProperty('vec4', 'v_fbelly'), vFin = varyingProperty('vec4', 'v_ffin'), vInfo = varyingProperty('vec4', 'v_finfo');

// Where a fish is at time t.
function fishAt(t) {
  const th = fA.w.mul(t).add(fC.x).toVar();
  const yaw = fB.z, cy = cos(yaw), sy = sin(yaw);
  const lobe = th.mul(3.0).add(yaw.mul(5.0));
  const r = sin(lobe).mul(0.16).add(1.0), dr = cos(lobe).mul(0.48);
  const ct = cos(th), st = sin(th);
  const ex = fB.x.mul(r).mul(ct), ez = fB.y.mul(r).mul(st);
  const tx = fB.x.mul(dr.mul(ct).sub(r.mul(st))), tz = fB.y.mul(dr.mul(st).add(r.mul(ct)));
  const C = fA.xyz.add(vec3(ex.mul(cy).sub(ez.mul(sy)), fB.w.mul(sin(th.mul(2.0).add(yaw.mul(3.0)))), ex.mul(sy).add(ez.mul(cy))));
  const T = normalize(vec3(tx.mul(cy).sub(tz.mul(sy)), 0.0, tx.mul(sy).add(tz.mul(cy)))).mul(sign(fA.w));
  const out = vec3(ct.mul(cy).sub(st.mul(sy)), 0.0, ct.mul(sy).add(st.mul(cy)));
  const s = fD.x, L = fC.w;
  // its place in the school breathes a little, and it wanders about it
  const side = fC.y.mul(sin(t.mul(0.21).add(s.mul(6.28))).mul(0.22).add(1.0));
  const up = fC.z.mul(sin(t.mul(0.17).add(s.mul(9.1))).mul(0.25).add(1.0));
  const wob = vec3(sin(t.mul(0.71).add(s.mul(40.0))), sin(t.mul(0.53).add(s.mul(23.0))).mul(0.5), cos(t.mul(0.61).add(s.mul(31.0)))).mul(L.mul(0.6));
  // now and then (in some of its cycles, not all) it darts ahead and to a side, and eases back
  const cyc = t.div(fD.z).add(s.mul(13.0));
  const k = fract(cyc), hh = fract(sin(floor(cyc).mul(91.7).add(s.mul(437.1))).mul(4375.5));
  const bump = smoothstep(0.0, 0.07, k).mul(float(1.0).sub(smoothstep(0.07, 0.6, k))).mul(step(0.4, hh));
  const dart = T.mul(0.8).add(out.mul(hh.sub(0.7).mul(3.0))).mul(bump.mul(L).mul(2.4));
  return C.add(out.mul(side)).add(vec3(0.0, up, 0.0)).add(wob).add(dart);
}

// The colourings.
const KIND = { silver: 0, gold: 1, blueYellow: 2, bands: 3, violet: 4, grey: 5, lantern: 6, parrot: 7, shrimp: 8 };
const is = (kind, k) => float(1.0).sub(step(0.5, abs(kind.sub(k))));

function fishMaterial() {
  return material({
    aux: true, shadow: false, ...(globalThis.__dbg ? { raw: () => vec3(8.0, 0.0, 0.0) } : {}),
    vertex: (v) => {
      const t = G.time, s = fD.x, L = fC.w;
      const P0 = fishAt(t).toVar('fishP');
      const d = P0.sub(fishAt(t.sub(0.08))).toVar();
      // it faces the way it goes, never steeper than about 30 degrees
      const hl = length(d.xz).add(1e-5);
      const F = normalize(vec3(d.x, clamp(d.y, hl.mul(-0.55), hl.mul(0.55)), d.z)).toVar();
      const R = normalize(cross(F, UP)).toVar();
      const Up = cross(R, F).toVar();
      // the wave down the body: small at the head, wide at the tail, and faster for a moment when it darts
      const lp = v.P.toVar(), ln = v.N.toVar();
      const u = clamp(float(0.5).sub(lp.x), 0.0, 1.0).toVar();
      const cyc = t.div(fD.z).add(s.mul(13.0));
      const beats = t.mul(fD.y).add(floor(cyc).add(smoothstep(0.0, 0.07, fract(cyc))).mul(1.4));
      const ph = beats.mul(TAU).add(s.mul(40.0)).sub(u.mul(5.6)).toVar();
      const A0 = mix(float(0.085), float(0.03), step(7.5, fD.w));
      const amp = A0.mul(u.mul(u).add(0.12));
      const sw = sin(ph), cw = cos(ph);
      const slope = A0.mul(u).mul(2.0).mul(sw).sub(amp.mul(5.6).mul(cw)).negate();
      const lq = vec3(lp.x, lp.y, lp.z.add(amp.mul(sw)));
      const nq = vec3(ln.x.sub(slope.mul(ln.z)), ln.y, ln.z);
      v.P.assign(P0.add(F.mul(lq.x).add(Up.mul(lq.y)).add(R.mul(lq.z)).mul(L)));
      v.N.assign(normalize(F.mul(nq.x).add(Up.mul(nq.y)).add(R.mul(nq.z))));
      // too small on screen, or near the edge of what is drawn: it dissolves into the water behind it
      const dc = length(P0.sub(cameraPosition));
      const keep = smoothstep(2.2, 5.0, L.div(dc.mul(U.pix))).mul(float(1.0).sub(smoothstep(44.0, 60.0, dc)));
      vBack.assign(fE); vBelly.assign(fF); vFin.assign(fG);
      vInfo.assign(vec4(L, fD.w, s, keep));
    },
    surface: (s, f) => {
      const lx = f.aux.x, ly = f.aux.y, yn = f.aux.z, part = f.aux.w;
      const kind = vInfo.y, seed = vInfo.z, keep = vInfo.w;
      const body = float(1.0).sub(step(0.5, part)).toVar(), fin = body.oneMinus();
      const aa = fwidth(lx).add(fwidth(ly)).add(1e-4).toVar();        // how much of the fish a pixel spans
      // darker back, pale belly
      const cs = smoothstep(-0.5, 0.55, yn).toVar();
      const col = mix(vBelly.rgb, vBack.rgb, cs).toVar();
      // silver: a dark line along each flank
      col.assign(mix(col, vec3(0.05, 0.17, 0.24), is(kind, 0).mul(body).mul(float(1.0).sub(smoothstep(0.04, 0.12, abs(yn.sub(0.3))))).mul(0.6)));
      // blue and yellow: the back of the body yellow, like the tail
      col.assign(mix(col, vFin.rgb, is(kind, 2).mul(float(1.0).sub(smoothstep(-0.2, -0.04, lx)))));
      // orange, with three white bands edged in black
      const bd = min(min(abs(lx.sub(0.3)).sub(0.03), abs(lx.sub(0.06)).sub(0.045)), abs(lx.add(0.19)).sub(0.025)).toVar();
      const white = float(1.0).sub(smoothstep(aa.negate(), aa, bd)).toVar();
      const k3 = is(kind, 3).mul(body);
      col.assign(mix(col, vec3(0.02), k3.mul(max(float(1.0).sub(smoothstep(float(0.014).sub(aa), aa.add(0.014), bd)).sub(white), 0.0))));
      col.assign(mix(col, vec3(0.92, 0.92, 0.9), k3.mul(white)));
      // grey: dark blotches (they fade out before they would sparkle)
      const sp = sin(lx.mul(43.0).add(seed.mul(20.0))).mul(sin(ly.mul(51.0).add(lx.mul(17.0))));
      col.assign(mix(col, col.mul(0.45), is(kind, 5).mul(body).mul(smoothstep(0.3, 0.6, sp)).mul(float(1.0).sub(smoothstep(0.015, 0.05, aa)))));
      // parrotfish: a pink face
      col.assign(mix(col, vFin.rgb, is(kind, 7).mul(body).mul(smoothstep(0.35, 0.45, lx)).mul(0.7)));
      // fins take the fin colour
      col.assign(mix(col, vFin.rgb, fin.mul(0.85)));
      // the eye: dark, a ring of gold, glossy
      const er = max(vFin.w, 1e-4);
      const ed = length(vec2(lx.sub(vBack.w), ly.sub(vBelly.w))).div(er).toVar();
      const eye = float(1.0).sub(smoothstep(float(1.0).sub(aa.div(er)), 1.0, ed)).mul(body).mul(step(0.001, vFin.w)).toVar();
      col.assign(mix(col, mix(vec3(0.01, 0.01, 0.012), vec3(0.6, 0.52, 0.3), smoothstep(0.45, 0.65, ed).mul(0.75)), eye));
      // shiny where silver, glossy everywhere a little
      const silver = is(kind, 0);
      s.spec = mix(float(0.2), float(0.7), silver.add(is(kind, 6).mul(0.4))).add(eye.mul(0.6));
      s.gloss = mix(float(26.0), float(64.0), silver).add(eye.mul(50.0));
      s.trans = fin.mul(0.55);
      s.fluor = float(0.2).add(is(kind, 1).add(is(kind, 2)).add(is(kind, 3)).add(is(kind, 4)).add(is(kind, 7)).mul(0.5));
      // the flanks are mirrors: they show the water around, bright from above, dark from below
      const vv = normalize(f.w.sub(cameraPosition)).toVar();
      const fres = pow(float(1.0).sub(abs(dot(s.n, vv))), 2.0).mul(0.6).add(0.4);
      const mirror = mix(float(0.1), float(0.8), silver.add(is(kind, 6).mul(0.3))).mul(float(1.0).sub(cs.mul(0.7))).mul(body).mul(eye.oneMinus());
      const emis = scatter(reflect(vv, s.n), float(80.0)).mul(mirror).mul(fres).mul(1.5).toVar();
      // lanternfish: two rows of lights along the belly (seen from afar, an even glow)
      const du = fract(lx.mul(15.0)).sub(0.5).div(15.0);
      const dd = min(length(vec2(du, yn.add(0.42).mul(0.04))), length(vec2(du, yn.add(0.8).mul(0.04))));
      const daa = max(fwidth(lx), fwidth(yn).mul(0.04)).add(1e-5);
      const rad = 0.011;
      const dots = mix(float(1.0).sub(smoothstep(float(rad).sub(daa), daa.add(rad), dd)), float(0.13), smoothstep(rad * 0.4, rad * 1.5, daa));
      const span = smoothstep(-0.26, -0.22, lx).mul(float(1.0).sub(smoothstep(0.28, 0.32, lx)));
      const flick = sin(G.time.mul(0.8).add(seed.mul(30.0))).mul(0.3).add(0.7);
      emis.addAssign(vec3(0.25, 0.55, 1.0).mul(dots.mul(span).mul(is(kind, 6)).mul(body).mul(flick).mul(4.0)));
      s.albedo = col.mul(keep);
      s.spec = s.spec.mul(keep);
      // dissolving: what would be seen through the fish is the water beyond it
      const beyond = scatter(vv, float(300.0)).sub(scatter(vv, f.dist)).mul(exp(SIG.mul(f.dist)));
      s.emis = emis.mul(keep).add(beyond.mul(keep.oneMinus()));
    },
  });
}

// The colourings, as back, belly, fins.
const COLOURS = {
  silver: [[0.09, 0.18, 0.24], [0.7, 0.74, 0.77], [0.46, 0.55, 0.6]],
  gold: [[0.82, 0.3, 0.04], [0.98, 0.48, 0.09], [0.94, 0.4, 0.05]],
  blueYellow: [[0.07, 0.2, 0.7], [0.3, 0.45, 0.85], [0.98, 0.78, 0.08]],
  fusilier: [[0.1, 0.3, 0.78], [0.82, 0.86, 0.9], [0.98, 0.8, 0.12]],
  bands: [[0.95, 0.36, 0.03], [0.98, 0.48, 0.08], [0.95, 0.38, 0.04]],
  violet: [[0.42, 0.11, 0.62], [0.78, 0.46, 0.86], [0.96, 0.62, 0.2]],
  grey: [[0.15, 0.17, 0.19], [0.6, 0.62, 0.6], [0.2, 0.22, 0.24]],
  grouper: [[0.33, 0.2, 0.09], [0.68, 0.53, 0.33], [0.38, 0.26, 0.11]],
  lantern: [[0.02, 0.025, 0.035], [0.1, 0.11, 0.13], [0.05, 0.06, 0.08]],
  parrot: [[0.07, 0.48, 0.44], [0.3, 0.74, 0.62], [0.9, 0.38, 0.5]],
  shrimp: [[0.86, 0.62, 0.55], [0.92, 0.82, 0.76], [0.9, 0.62, 0.52]],
};

// Where the schools are. Each: the mesh it is drawn with (one draw per mesh), the shape, the
// colouring and how many (on high); its centre, the loop's radii, its turn, how far it rises
// and falls, seconds per lap (negative: the other way round); how long its fish are; how far
// they spread (metres along the loop, out, up); tail beats a second; seconds between darts.
function plan() {
  const g = (x, z, up) => groundY(x, z) + up;
  const S = (mesh, shape, colours, n, at, r, yaw, h, period, size, spread, beat, dart, phase) =>
    ({ mesh, shape, colours, n, at, r, yaw, h, period, size, spread, beat, dart, phase });
  return [
    // under the pier, and over the sand of the shallows: small silver fish
    S('pier', 'sardine', 'silver', 70, [11, -3.4, -3], [2.6, 6], 0.1, 0.35, 46, [0.13, 0.18], [3, 1.2, 0.6], 3.4, 7, 2.0),
    S('shallows', 'sardine', 'silver', 100, [-6.5, g(-6.5, -30, 3.3), -30], [3.5, 5], -0.3, 0.5, -52, [0.12, 0.18], [3.5, 1.4, 0.7], 3.2, 8, 4.0),
    S('shallows', 'sardine', 'silver', 140, [-3, -3.0, -44], [5, 3.5], 0.4, 0.4, 58, [0.12, 0.19], [4, 1.6, 0.7], 3.3, 7, 1.0),
    // the last of the way up, near the surface again
    S('surface', 'sardine', 'silver', 80, [-1, -7, -402], [5, 5], 0.2, 0.5, 50, [0.13, 0.19], [3.5, 1.4, 0.7], 3.3, 8, 0.5),
    // among the kelp: loose groups of golden-orange fish
    S('kelp', 'garibaldi', 'gold', 8, [-1.5, g(-1.5, -78, 2.0), -78], [2.5, 3.0], 0.5, 0.4, 40, [0.2, 0.3], [2.5, 1.3, 0.8], 1.7, 9, 0.3),
    S('kelp', 'garibaldi', 'gold', 10, [-14, g(-14, -92, 3.5), -92], [2.0, 3.0], -0.4, 0.5, -45, [0.2, 0.3], [2.5, 1.3, 0.9], 1.7, 9, 2.2),
    S('kelp', 'garibaldi', 'gold', 7, [0.5, g(0.5, -103, 2.5), -103], [1.8, 3.0], 0.2, 0.4, 38, [0.2, 0.28], [2.2, 1.1, 0.8], 1.8, 10, 4.1),
    S('kelp', 'garibaldi', 'gold', 9, [-10.5, g(-10.5, -110, 4.0), -110], [2.0, 2.6], 0.9, 0.5, -42, [0.2, 0.3], [2.5, 1.2, 0.9], 1.7, 9, 5.5),
    // the reef: small bright schools by the coral heads, fusiliers over it, a few big fish on their own
    S('reef', 'damsel', 'blueYellow', 30, [-5.5, g(-5.5, -139.5, 2.4), -139.5], [1.5, 2.0], 0.2, 0.25, 22, [0.09, 0.13], [1.6, 0.8, 0.6], 3.6, 5, 0.0),
    S('reef', 'damsel', 'violet', 45, [-9.2, -22.7, -144], [1.8, 2.2], 0.0, 0.4, -30, [0.07, 0.11], [2.5, 1.2, 1.0], 4.0, 4, 1.0),
    S('reef', 'damsel', 'bands', 22, [6.3, g(6.3, -154, 2.6), -154], [1.3, 1.8], 0.7, 0.25, 20, [0.08, 0.11], [1.2, 0.6, 0.5], 3.8, 5, 2.0),
    S('reef', 'damsel', 'blueYellow', 1, [5.6, g(5.6, -127, 2.0), -127], [3.5, 3.2], 0.0, 0.3, 30, [0.3, 0.3], [0, 0, 0], 1.6, 0, 3.0),
    S('reef2', 'damsel', 'blueYellow', 30, [5.5, g(5.5, -167, 2.4), -167], [1.5, 2.0], -0.3, 0.25, -24, [0.09, 0.13], [1.6, 0.8, 0.6], 3.6, 5, 4.0),
    S('reef2', 'damsel', 'violet', 40, [-8.1, -25.3, -176], [1.8, 2.2], 0.3, 0.4, 28, [0.07, 0.11], [2.5, 1.2, 1.0], 4.0, 4, 5.0),
    S('fusiliers', 'sardine', 'fusilier', 60, [1.0, g(1.0, -146, 6.5), -146], [9, 5], 0.2, 0.6, 45, [0.15, 0.22], [3.5, 1.5, 0.7], 3.0, 6, 3.6),
    S('reefBig', 'parrot', 'parrot', 1, [-9.7, g(-9.7, -135, 1.6), -135], [4.0, 3.6], 0.0, 0.3, 36, [0.55, 0.55], [0, 0, 0], 1.3, 0, 0.0),
    S('reefBig', 'parrot', 'parrot', 1, [9.9, g(9.9, -170, 1.8), -170], [4.4, 4.0], 0.0, 0.3, -40, [0.5, 0.5], [0, 0, 0], 1.3, 0, 2.0),
    S('reefBig', 'parrot', 'grouper', 1, [10.8, g(10.8, -150, 1.2), -150], [4.6, 4.2], 0.0, 0.2, 50, [0.7, 0.7], [0, 0, 0], 1.0, 0, 4.0),
    S('reefBig', 'parrot', 'grouper', 1, [-8.1, g(-8.1, -176, 1.2), -176], [4.2, 4.0], 0.0, 0.2, -46, [0.65, 0.65], [0, 0, 0], 1.0, 0, 1.0),
    // over the wreck's ledge: big grey fish, slow
    S('wreck', 'snapper', 'grey', 9, [centerX(-238) - 1, floorY(-238) + 8, -238], [6, 8], 0.3, 0.8, 75, [0.55, 0.85], [5, 2.0, 1.2], 1.1, 12, 0.0),
    S('wreck', 'snapper', 'grey', 4, [centerX(-253) + 2, floorY(-253) + 3.5, -253], [3, 4], -0.5, 0.4, -60, [0.5, 0.7], [2, 1.0, 0.6], 1.2, 14, 2.0),
    // the twilight, down the wall: lanternfish
    S('twilight', 'lantern', 'lantern', 40, [9.7, -78, -297], [2.5, 3], 0.3, 0.5, 32, [0.07, 0.11], [3, 1.2, 1.0], 3.0, 6, 0.0),
    S('twilight', 'lantern', 'lantern', 40, [10.1, -104, -299], [2.5, 3], -0.2, 0.5, -30, [0.07, 0.11], [3, 1.2, 1.0], 3.0, 6, 1.5),
    S('twilight', 'lantern', 'lantern', 40, [10.2, -134, -299.8], [2.5, 3], 0.6, 0.5, 34, [0.07, 0.11], [3, 1.2, 1.0], 3.0, 6, 3.0),
    S('twilight', 'lantern', 'lantern', 40, [7.5, -168, -299], [2.5, 3], 0.1, 0.5, -31, [0.07, 0.11], [3, 1.2, 1.0], 3.0, 6, 4.5),
    S('ascent', 'lantern', 'lantern', 30, [2.0, -120, -394], [2.5, 3], 0.0, 0.5, 30, [0.07, 0.11], [3, 1.2, 1.0], 3.0, 6, 0.0),
  ];
}

// The vents' chimneys, as src/rocks.js stands them (z, distance off the centre line,
// height, radius, seed): the shrimp swarm on them and the bubbles rise from them.
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

// Every fish's numbers, by mesh.
function populate(rng, amt) {
  const meshes = new Map();
  const push = (mesh, shape, f) => {
    let m = meshes.get(mesh);
    if (!m) meshes.set(mesh, (m = { shape, fish: [] }));
    m.fish.push(f);
  };
  const colour = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  for (const sc of plan()) {
    const n = sc.n === 1 ? 1 : Math.max(4, Math.round(sc.n * amt));
    const R = Math.max((sc.r[0] + sc.r[1]) / 2, 0.5), w = TAU / sc.period, eye = SHAPES[sc.shape].eye, [back, belly, fin] = COLOURS[sc.colours];
    for (let i = 0; i < n; i++) {
      const L = lerp(sc.size[0], sc.size[1], rng()), k = rng.range(0.85, 1.12);
      push(sc.mesh, sc.shape, {
        A: [sc.at[0], sc.at[1], sc.at[2], w], B: [sc.r[0], sc.r[1], sc.yaw, sc.h],
        C: [sc.phase + (rng.bell() * sc.spread[0]) / R, rng.bell() * sc.spread[1], rng.bell() * sc.spread[2], L],
        D: [rng(), sc.beat * rng.range(0.85, 1.15), sc.dart ? sc.dart * rng.range(0.7, 1.4) : 1e5, KIND[sc.colours] ?? (sc.colours === 'fusilier' ? 2 : 5)],
        E: [...colour(back, k), eye[0]], F: [...colour(belly, k), eye[1]], G: [...colour(fin, k), eye[2]],
      });
    }
  }
  // shrimp at the vents: each goes round its chimney at its own height, just off the rock
  for (const c of chimneys()) {
    const n = Math.max(6, Math.round(30 * amt)), [back, belly, fin] = COLOURS.shrimp, eye = SHAPES.shrimp.eye;
    for (let i = 0; i < n; i++) {
      const t = rng.range(0.12, 0.92), y = c.g + c.height * t;
      const ax = lerp(c.x, c.top[0], t), az = lerp(c.z, c.top[2], t);
      const rr = c.radius * (1.15 - 0.81 * t) + c.radius * 0.35 + rng.range(0.15, 0.6);
      const k = rng.range(0.85, 1.1);
      push('vents', 'shrimp', {
        A: [ax, y, az, rng.sign() * rng.range(0.05, 0.16)], B: [rr, rr, rng() * TAU, rng.range(0.05, 0.2)],
        C: [rng() * TAU, 0, 0, rng.range(0.045, 0.065)], D: [rng(), rng.range(4, 7), rng.range(3, 6), KIND.shrimp],
        E: [...colour(back, k), eye[0]], F: [...colour(belly, k), eye[1]], G: [...colour(fin, k), eye[2]],
      });
    }
  }
  return meshes;
}

function fishMesh(geo, fish, mat) {
  const n = fish.length, g = new InstancedBufferGeometry();
  g.setIndex(geo.index);
  for (const k of ['position', 'normal', 'aux']) g.setAttribute(k, geo.getAttribute(k));
  const boxes = [];
  for (const key of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
    const a = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) a[i * 4 + c] = fish[i][key][c];
    g.setAttribute('f' + key, new InstancedBufferAttribute(a, 4));
  }
  for (const f of fish) {
    const L = f.C[3], out = Math.max(f.B[0], f.B[1]) * 1.16 + Math.abs(f.C[1]) * 1.25 + L * 3.5 + 0.3, up = f.B[3] + Math.abs(f.C[2]) * 1.3 + L * 2 + 0.3;
    boxes.push([f.A[0] - out, f.A[0] + out, f.A[1] - up, f.A[1] + up, f.A[2] - out, f.A[2] + out]);
  }
  g.instanceCount = n;
  g.boundingSphere = sphereOf(boxes);
  return solid(g, mat);
}

// ---- the manta -----------------------------------------------------------------------------

// A manta: one metre across, nose at +x, wing tips at z = ±0.5, flat and thick only in the
// middle. aux = (x, z, how far out along the wing 0..1, which part: 0 back, 1 belly, 2 tail,
// 3 the horns at its mouth).
function mantaShape(lod) {
  const m = new Mesh(true), nu = [16, 22, 28][lod], nv = [6, 8, 10][lod];
  const le = (a) => (a < 0.14 ? 0.26 : 0.26 - 0.36 * Math.pow((a - 0.14) / 0.86, 1.25));
  const te = (a) => (a < 0.08 ? -0.24 : -0.24 + 0.14 * Math.pow((a - 0.08) / 0.92, 0.55));
  const thick = (a, v) => (0.07 * (1 - smooth(0.04, 0.45, a)) + 0.012 * (1 - a) + 0.0025) * Math.sqrt(Math.max(4 * v * (1 - v), 0));
  for (const top of [true, false]) {
    m.grid(nu, nv, (s, t, o) => {
      const k = s * 2 - 1, a = Math.pow(Math.abs(k), 1.25), z = Math.sign(k) * a * 0.5;
      const x = lerp(le(a), te(a), t), y = 0.022 * (1 - a * a) * Math.sin(Math.PI * t) + (top ? 0.5 : -0.5) * thick(a, t);
      o[0] = x; o[1] = y; o[2] = z; o[3] = x; o[4] = z; o[5] = a; o[6] = top ? 0 : 1;
    }, false, top);
  }
  const t0 = m.count;
  tube(m, [[-0.225, 0.0, 0, 0.012], [-0.35, 0.004, 0, 0.006], [-0.5, 0.008, 0, 0.0035], [-0.64, 0.012, 0, 0.0015]], 5, [0, 0, 2]);
  for (const sd of [1, -1]) tube(m, [[0.235, 0.0, sd * 0.088, 0.02], [0.29, -0.01, sd * 0.082, 0.016], [0.32, -0.035, sd * 0.07, 0.011]], 5, [0, 0, 3]);
  // (the tubes' aux is (along, tag): put x and z in place for the surface step)
  for (let v = t0; v < m.count; v++) { m.a[v * 4 + 3] = m.a[v * 4 + 3] || m.a[v * 4 + 2]; m.a[v * 4] = m.p[v * 3]; m.a[v * 4 + 1] = m.p[v * 3 + 2]; m.a[v * 4 + 2] = 0; }
  return m.build();
}

// Where each manta is: per manta three vec4 (place and flap phase, heading and span, up).
const MANTA_POSE = uniformArray([0, 1, 2, 3, 4, 5].map(() => new Vector4(0, -1000, 0, 0)), 'vec4');

function mantaMaterial() {
  return material({
    aux: true, shadow: false,
    vertex: (v) => {
      const i = instanceIndex.mul(3);
      const A = MANTA_POSE.element(i), B = MANTA_POSE.element(i.add(1)), C = MANTA_POSE.element(i.add(2));
      const F = B.xyz, Up = C.xyz, R = cross(F, Up).toVar();
      const lp = v.P.toVar(), ln = v.N.toVar();
      // the wings beat slowly, the beat running out toward the tips and back along the chord
      const az = min(abs(lp.z).mul(2.0), 1.0).toVar();
      const ph = G.time.mul(TAU * 0.21).add(A.w).toVar();
      const kx = float(0.26).sub(lp.x).mul(2.6).mul(az);
      const k = ph.sub(az.mul(1.25)).sub(kx).toVar();
      const ap = pow(az, 1.6);
      const flap = ap.mul(0.17).mul(sin(k));
      // slopes of the beat, for the normal
      const gz = float(0.17).mul(pow(az, 0.6).mul(1.6).mul(sin(k)).sub(ap.mul(cos(k)).mul(float(1.25).add(float(0.26).sub(lp.x).mul(2.6))))).mul(2.0).mul(sign(lp.z));
      const gx = ap.mul(0.17).mul(cos(k)).mul(az.mul(2.6));
      // the tail trails, swaying
      const tail = smoothstep(-0.22, -0.3, lp.x);
      const lq = vec3(lp.x, lp.y.add(flap).sub(sin(ph).mul(0.012)), lp.z.add(tail.mul(sin(G.time.mul(1.1).sub(lp.x.mul(9.0))).mul(0.02))));
      const nq = normalize(vec3(ln.x.sub(gx.mul(ln.y)), ln.y, ln.z.sub(gz.mul(ln.y))));
      v.P.assign(A.xyz.add(F.mul(lq.x).add(Up.mul(lq.y)).add(R.mul(lq.z)).mul(B.w)));
      v.N.assign(F.mul(nq.x).add(Up.mul(nq.y)).add(R.mul(nq.z)));
    },
    surface: (s, f) => {
      const x = f.aux.x, z = f.aux.y, a = f.aux.z, part = f.aux.w;
      const back = float(1.0).sub(step(0.5, part)), belly = is(part, 1);
      const aa = fwidth(x).add(fwidth(z)).add(1e-4).toVar();
      const mott = sin(x.mul(31.0).add(z.mul(23.0))).mul(sin(z.mul(37.0).sub(x.mul(19.0)))).toVar();
      // the back: near black, with pale shoulder marks running back from the head
      const chev = float(1.0).sub(smoothstep(0.03, aa.add(0.065), abs(x.sub(float(0.2).sub(a.mul(0.42)))))).mul(smoothstep(0.1, 0.2, a)).mul(float(1.0).sub(smoothstep(0.34, 0.5, a)));
      const top = mix(vec3(0.035, 0.045, 0.06), vec3(0.42, 0.45, 0.46), chev.mul(mott.mul(0.2).add(0.8))).mul(mott.mul(0.12).add(1.0));
      // the belly: pale, dark along the wing's edges, a few dark spots, the gill slits
      const spots = smoothstep(0.55, 0.75, mott).mul(float(1.0).sub(smoothstep(0.03, 0.08, aa))).mul(float(1.0).sub(smoothstep(0.2, 0.35, a)));
      const gill = smoothstep(0.55, 0.9, sin(x.mul(TAU * 32.0))).mul(step(0.07, x)).mul(step(x, 0.17)).mul(smoothstep(0.1, 0.12, a)).mul(float(1.0).sub(smoothstep(0.17, 0.19, a))).mul(float(1.0).sub(smoothstep(0.01, 0.03, aa)));
      const under = mix(vec3(0.8, 0.8, 0.76), vec3(0.08, 0.09, 0.11), max(smoothstep(0.62, 0.95, a), max(spots, gill.mul(0.8))));
      s.albedo = mix(mix(vec3(0.04, 0.045, 0.055), top, back), under, belly);
      s.spec = float(0.14); s.gloss = float(22.0); s.fluor = float(0.0);
      s.ao = mix(float(1.0), float(0.75), belly.mul(float(1.0).sub(a)));
    },
  });
}

// The mantas' rounds: an oval over the reef, the far side of the arch's top, high enough to
// clear the coral heads. [centre x, centre z, radius across, radius along, height over the
// floor, seconds a lap, phase, span]
const MANTAS = [[0.5, -157, 12, 30, 9.5, 140, 0.4, 4.6], [0.5, -160, 15, 35, 12.5, 150, 3.4, 3.0]];
function mantaAt(mt, t, out) {
  const th = (TAU * t) / mt[5] + mt[6];
  out[0] = mt[0] + mt[2] * Math.cos(th);
  out[2] = mt[1] + mt[3] * Math.sin(th);
  out[1] = floorY(out[2]) + mt[4] + 1.2 * Math.sin(2 * th + mt[6]);
}

// ---- jellyfish -------------------------------------------------------------------------------

// Per jelly: jA where it lives (x, y, z) and its bell's radius; jB its seed, pulses a
// second, how fast it rises, how long its tentacles are (in bell radii); jC its light (rgb)
// and how bright.
const jA = attribute('jA', 'vec4'), jB = attribute('jB', 'vec4'), jC = attribute('jC', 'vec4');
const vJ0 = varyingProperty('vec4', 'v_j0'), vJ1 = varyingProperty('vec4', 'v_j1'), vJ2 = varyingProperty('vec4', 'v_j2');

// How contracted the bell is at time t: 0 at rest, 1 squeezed; a quick stroke and a slow refill.
const pulse = (t) => {
  const k = fract(t.mul(jB.y).add(jB.x.mul(7.0)));
  return smoothstep(0.0, 0.2, k).mul(float(1.0).sub(smoothstep(0.24, 0.95, k)));
};
// Where the jelly is: it rises (faster just after each stroke) and drifts, and keeps to a
// band thirty metres tall around its home: at the top it fades and comes back in at the bottom.
function jellyAt(t) {
  const cyc = t.mul(jB.y).add(jB.x.mul(7.0));
  const yr = jB.z.mul(t.add(sin(cyc.mul(TAU).sub(1.0)).mul(0.5).div(jB.y.mul(TAU)))).add(15.0);
  const yw = fract(yr.div(30.0)).mul(30.0);
  const fade = smoothstep(0.0, 4.0, yw).mul(float(1.0).sub(smoothstep(26.0, 30.0, yw)));
  const c = vec3(jA.x.add(sin(t.mul(0.031).add(jB.x.mul(6.0))).mul(1.6)), jA.y.sub(15.0).add(yw), jA.z.add(cos(t.mul(0.027).add(jB.x.mul(9.0))).mul(1.6)));
  return { c, fade };
}
// How a jelly is seen from here: what the water leaves of its light, and how many pixels
// wide its bell is (so fine detail can give way to an even glow before it would flicker).
function jellySeen(c, fade) {
  const d = length(c.sub(cameraPosition));
  const keep = exp(SIG.mul(d).negate()).mul(fade).mul(smoothstep(0.5, 1.6, d));
  return { keep, d, px: jA.w.div(d.mul(U.pix)) };
}

// The bell: a dome that squeezes from its rim. Seen through, it is glass with a glowing rim:
// eight canals, four gonads, a ring of lights round the margin with a wave running round it.
function bellMaterial() {
  return material({
    aux: true, additive: true, twoSided: true,
    vertex: (v) => {
      const t = G.time, R = jA.w, J = jellyAt(t), con = pulse(t);
      const lp = v.P.toVar(), ln = v.N.toVar(), tb = v.aux.x;
      const sq = float(1.0).sub(con.mul(0.3).mul(pow(tb, 1.3))), st = con.mul(0.12).add(1.0);
      const tilt = vec2(sin(t.mul(0.37).add(jB.x.mul(17.0))), cos(t.mul(0.31).add(jB.x.mul(11.0)))).mul(0.12);
      const q = vec3(lp.x.mul(sq).sub(lp.y.mul(tilt.x)), lp.y.mul(st), lp.z.mul(sq).sub(lp.y.mul(tilt.y)));
      v.P.assign(J.c.add(q.mul(R)));
      v.N.assign(normalize(vec3(ln.x.div(sq), ln.y.div(st), ln.z.div(sq))));
      const seen = jellySeen(J.c, J.fade);
      vJ0.assign(vec4(seen.keep, smoothstep(10.0, 28.0, seen.px)));
      vJ1.assign(vec4(lampAt(J.c), con));
      vJ2.assign(jC);
      v.aux.assign(vec4(tb, v.aux.y, jB.x, 0.0));
    },
    raw: (f) => {
      const tb = f.aux.x, ang = f.aux.y, seed = f.aux.z, detail = vJ0.w;
      const glow = vJ2.rgb, tint = mix(vec3(0.62, 0.74, 0.95), glow, 0.3);
      const vv = normalize(f.w.sub(cameraPosition));
      const fres = pow(float(1.0).sub(abs(dot(f.n, vv))), 2.5);
      const canal = smoothstep(0.75, 1.0, cos(ang.mul(TAU * 8.0))).mul(smoothstep(0.12, 0.4, tb)).mul(float(1.0).sub(smoothstep(0.85, 0.95, tb))).mul(detail);
      const gonad = smoothstep(0.35, 0.9, cos(ang.mul(TAU * 4.0).add(0.4))).mul(smoothstep(0.2, 0.34, tb)).mul(float(1.0).sub(smoothstep(0.44, 0.6, tb)));
      const warm = mix(glow, vec3(1.0, 0.45, 0.3), step(0.5, fract(seed.mul(3.7))));
      const dots = mix(float(0.5), smoothstep(0.1, 0.8, cos(ang.mul(TAU * 24.0))), detail);
      const wave = pow(sin(ang.mul(TAU).sub(G.time.mul(1.6)).add(seed.mul(20.0))).mul(0.5).add(0.5), 3.0);
      const rim = smoothstep(0.84, 0.97, tb).mul(dots).mul(wave.mul(1.6).add(0.35));
      const lit = vJ1.rgb.mul(fres.mul(0.25).add(0.04));
      const col = tint.mul(fres.mul(0.32).add(0.02)).add(glow.mul(rim.mul(2.4).add(canal.mul(0.22)))).add(warm.mul(gonad).mul(0.45)).add(tint.mul(lit));
      return { color: col.mul(vJ2.w).mul(vJ0.rgb), alpha: float(1.0) };
    },
  });
}

// Tentacles from the rim and frilled arms from the middle, as ribbons that face the eye. Each
// point along one follows the bell as it was a moment before, so the pulse runs down them.
// aux = (along 0..1, across -1..1, where round the bell, length: > 0 tentacle, < 0 arm)
function ribbonMaterial() {
  return material({
    aux: true, additive: true, twoSided: true,
    vertex: (v) => {
      const t = G.time, R = jA.w, J = jellyAt(t);
      const s = v.aux.x, side = v.aux.y, ang = v.aux.z.mul(TAU), arm = step(v.aux.w, 0.0), lf = abs(v.aux.w);
      const conL = pulse(t.sub(s.mul(mix(float(0.9), float(0.5), arm))));
      const rm = mix(float(0.95).mul(float(1.0).sub(conL.mul(0.3))), float(0.12), arm);
      const y0 = mix(float(-0.66).mul(conL.mul(0.12).add(1.0)), float(-0.3), arm);
      const len = R.mul(jB.w).mul(lf).mul(mix(float(1.0), float(0.45), arm)).toVar();
      const out = vec3(cos(ang), 0.0, sin(ang));
      const at = (ss) => {
        const sway = vec3(sin(t.mul(0.7).add(ss.mul(3.5)).add(ang.mul(2.0)).add(jB.x.mul(9.0))), 0.0, cos(t.mul(0.6).add(ss.mul(3.0)).add(ang.mul(1.7)).add(jB.x.mul(5.0)))).mul(ss.mul(len).mul(0.16));
        return J.c.add(out.mul(R.mul(rm).mul(float(1.0).sub(ss.mul(0.3))))).add(vec3(0.0, y0.mul(R).sub(ss.mul(len).mul(float(1.0).sub(conL.mul(0.12)))), 0.0)).add(sway);
      };
      const C0 = at(s).toVar(), T = normalize(at(s.add(0.03)).sub(C0));
      const across = normalize(cross(T, normalize(C0.sub(cameraPosition))));
      const d = length(C0.sub(cameraPosition));
      const w0 = mix(float(0.011).mul(float(1.0).sub(s.mul(0.6))), float(0.06).mul(float(1.0).sub(s.mul(0.5))).mul(sin(s.mul(26.0).add(t.mul(1.7))).mul(0.25).add(0.75)), arm).mul(R);
      const w = max(w0, d.mul(U.pix).mul(0.75));
      v.P.assign(C0.add(across.mul(side.mul(w))));
      const seen = jellySeen(J.c, J.fade);
      vJ0.assign(vec4(seen.keep.mul(w0.div(w)), arm));
      vJ1.assign(vec4(lampAt(J.c), s));
      vJ2.assign(jC);
    },
    raw: (f) => {
      const across = float(1.0).sub(f.aux.y.mul(f.aux.y));
      const s = vJ1.w, arm = vJ0.w;
      const ends = float(1.0).sub(smoothstep(0.7, 1.0, s));
      const glow = vJ2.rgb.mul(mix(float(0.32), float(0.5), arm)).add(vJ1.rgb.mul(0.05));
      return { color: glow.mul(across.mul(across)).mul(ends).mul(vJ2.w).mul(vJ0.rgb), alpha: float(1.0) };
    },
  });
}

// The haze of light around each jelly.
function haloMaterial() {
  return material({
    additive: true,
    vertex: (v) => {
      const J = jellyAt(G.time), c0 = v.P.xy.toVar();
      const centre = J.c.sub(vec3(0.0, jA.w.mul(0.3), 0.0));
      v.P.assign(centre.add(U.right.mul(c0.x).add(U.up.mul(c0.y)).mul(jA.w.mul(2.4))));
      v.aux.assign(vec4(c0, 0.0, 0.0));
      vJ0.assign(vec4(jellySeen(J.c, J.fade).keep, 0.0));
      vJ2.assign(jC);
    },
    raw: (f) => {
      const r2 = dot(f.aux.xy, f.aux.xy);
      const m = exp(r2.mul(-3.2)).mul(float(1.0).sub(smoothstep(0.6, 1.0, r2)));
      return { color: vJ2.rgb.mul(m).mul(0.1).mul(vJ2.w).mul(vJ0.rgb), alpha: float(1.0) };
    },
  });
}

function jellyShapes(lod) {
  const nb = [6, 8, 10][lod], na = [14, 18, 24][lod], nt = [6, 9, 12][lod], ns = [6, 8, 10][lod];
  const bell = new Mesh(true);
  bell.grid(na, nb, (s, t, o) => {
    const ph = t * 1.72, r = Math.sin(ph), y = 0.62 * (Math.cos(ph) - 1), a = s * TAU;
    o[0] = Math.cos(a) * r; o[1] = y; o[2] = Math.sin(a) * r; o[3] = t; o[4] = s;
  }, true);
  const rib = new Mesh(true), rng = makeRng(99);
  const strip = (angle, len) => {
    const base = rib.count;
    for (let i = 0; i <= ns; i++) for (const side of [-1, 1]) rib.vert(0, 0, 0, 0, 1, 0, 0, 0, i / ns, side, angle, len);
    for (let i = 0; i < ns; i++) { const a = base + i * 2; rib.quad(a, a + 1, a + 3, a + 2); }
  };
  for (let k = 0; k < nt; k++) strip((k + rng.range(-0.2, 0.2)) / nt, rng.range(0.6, 1.0));
  for (let k = 0; k < 4; k++) strip((k + 0.5) / 4, -rng.range(0.7, 1.0));
  return { bell: bell.build(), ribbons: rib.build() };
}

// Where the jellies live: down the wall beside the spire, around the camera's way down and
// mostly where it looks, some close; and a few on the way back up.
function jellySpots(rng, n, nUp) {
  const o = [0, 0, 0, 0, 0], list = [];
  const camAt = (y, p0, p1) => {
    let best = p0, bd = 1e9;
    for (let p = p0; p <= p1; p += 0.01) { pathAt(p, o); const d = Math.abs(o[1] - y); if (d < bd) { bd = d; best = p; } }
    return pathAt(best, o);
  };
  const clear = (x, y, z, r) => {
    for (let dy = -15; dy <= 15; dy += 7.5) if (offTrack(x, z, y + dy) < r) return false;
    return true;
  };
  for (let tries = 0; list.length < n && tries < n * 40; tries++) {
    const y = rng.range(-186, -76), c = camAt(y, 5.15, 6.05);
    const near = rng() < 0.3, dist = near ? rng.range(3.8, 6.5) : rng.range(6.5, 20);
    const ang = ((c[3] + rng.bell() * 80) * Math.PI) / 180;
    const x = c[0] + Math.sin(ang) * dist, z = c[2] - Math.cos(ang) * dist;
    // not in the spire, not in the cliff behind, clear of the camera's way
    const tt = Math.min(Math.max((y - SPIRE.bottom) / (SPIRE.top - SPIRE.bottom), 0), 1);
    const sr = SPIRE.radius * (1.25 - 0.75 * Math.pow(tt, 1.4)) * 1.3 + 4.5;
    if (Math.hypot(x - SPIRE.x, z - SPIRE.z) < sr || z > -280 || !clear(x, y, z, 3.4)) continue;
    list.push([x, y, z, near]);
  }
  for (let tries = 0, k = 0; k < nUp && tries < nUp * 40; tries++) {
    const y = rng.range(-165, -70), dist = rng.range(4.5, 12), ang = rng.bell() * 2.2;
    const x = -3.7 + Math.sin(ang) * dist, z = -388 - Math.cos(ang) * dist;
    if (!clear(x, y, z, 3.4)) continue;
    list.push([x, y, z, false]);
    k++;
  }
  return list;
}

// ---- what drifts -----------------------------------------------------------------------------

// Marine snow: flecks in a forty-metre box that moves with the eye (each fleck wraps round
// it), sinking slowly in the current. Lit by the sun from above, by the lamp and the glows in
// the dark, and bright when looked at against the light.
const sA = attribute('sA', 'vec4'), vSnow = varyingProperty('vec4', 'v_snow');
function snowMaterial() {
  const B = 40.0;
  return material({
    additive: true,
    vertex: (v) => {
      const t = G.time, s = sA.w, c0 = v.P.xy.toVar();
      const flow = vec3(t.mul(0.05), t.mul(-0.03), t.mul(0.035)).add(vec3(sin(t.mul(0.31).add(s.mul(61.0))), sin(t.mul(0.23).add(s.mul(47.0))).mul(0.5), cos(t.mul(0.27).add(s.mul(73.0)))).mul(0.25));
      const rel = fract(sA.xyz.mul(B).add(flow).sub(cameraPosition).div(B).add(0.5)).sub(0.5).mul(B).toVar();
      const w = cameraPosition.add(rel).toVar();
      const d = length(rel).toVar();
      const r = s.mul(s).mul(s).mul(0.016).add(0.004);
      const rr = max(r, d.mul(U.pix).mul(1.2)).toVar();
      const dim = r.div(rr).mul(r.div(rr));
      const fade = smoothstep(0.35, 1.4, d).mul(float(1.0).sub(smoothstep(B * 0.36, B * 0.47, d)));
      const toward = pow(max(dot(rel.div(d), G.sunDir), 0.0), 4.0).mul(2.5).add(0.3);
      const light = sunAt(w.y).mul(causticAt(w).mul(2.2).add(0.12)).mul(toward).add(skyAt(w, UP).mul(0.45)).add(lampAt(w)).add(glowsAt(w));
      vSnow.assign(vec4(light.mul(vec3(0.75, 0.78, 0.72)).mul(exp(SIG.mul(d).negate())).mul(dim.mul(fade).mul(0.55)), 0.0));
      v.P.assign(w.add(U.right.mul(c0.x).add(U.up.mul(c0.y)).mul(rr.mul(2.0))));
      v.aux.assign(vec4(c0, 0.0, 0.0));
    },
    raw: (f) => {
      const q = f.aux.xy.mul(2.0), r2 = dot(q, q);
      return { color: vSnow.rgb.mul(exp(r2.negate()).mul(float(1.0).sub(smoothstep(2.6, 4.0, r2)))), alpha: float(1.0) };
    },
  });
}

// Plankton that makes its own light, in the twilight and below: blue-green points in a
// thirty-metre box round the eye, each blinking softly now and then.
const pA = attribute('pA', 'vec4'), vPlank = varyingProperty('vec4', 'v_plank');
function planktonMaterial() {
  const B = 30.0;
  return material({
    additive: true,
    vertex: (v) => {
      const t = G.time, s = pA.w, c0 = v.P.xy.toVar();
      const flow = vec3(t.mul(0.02), t.mul(0.01), t.mul(-0.015)).add(vec3(sin(t.mul(0.21).add(s.mul(37.0))), cos(t.mul(0.17).add(s.mul(53.0))), sin(t.mul(0.19).add(s.mul(29.0)))).mul(0.3));
      const rel = fract(pA.xyz.mul(B).add(flow).sub(cameraPosition).div(B).add(0.5)).sub(0.5).mul(B).toVar();
      const w = cameraPosition.add(rel).toVar();
      const d = length(rel).toVar();
      const r = s.mul(0.006).add(0.004);
      const rr = max(r, d.mul(U.pix).mul(1.2)).toVar();
      const dim = r.div(rr).mul(r.div(rr));
      const fade = smoothstep(0.35, 1.4, d).mul(float(1.0).sub(smoothstep(B * 0.36, B * 0.47, d))).mul(smoothstep(55.0, 95.0, w.y.negate()));
      const blink = pow(sin(t.mul(s.mul(0.9).add(0.35)).add(s.mul(91.0))).mul(0.5).add(0.5), 6.0).mul(1.8).add(0.12);
      const hue = mix(vec3(0.15, 1.0, 0.72), vec3(0.22, 0.6, 1.0), fract(s.mul(7.3)));
      vPlank.assign(vec4(hue.mul(blink).mul(exp(SIG.mul(d).negate())).mul(dim.mul(fade).mul(3.0)), 0.0));
      v.P.assign(w.add(U.right.mul(c0.x).add(U.up.mul(c0.y)).mul(rr.mul(2.0))));
      v.aux.assign(vec4(c0, 0.0, 0.0));
    },
    raw: (f) => {
      const q = f.aux.xy.mul(2.0), r2 = dot(q, q);
      return { color: vPlank.rgb.mul(exp(r2.negate()).mul(float(1.0).sub(smoothstep(2.6, 4.0, r2)))), alpha: float(1.0) };
    },
  });
}

// Bubbles: streams that rise from a source, each bubble wobbling, growing a little as it
// goes and drifting with the current; a bright rim and a highlight, the light of the water
// round it, or of the lamp and the vents' glow. bA: the source (x, y, z) and the bubble's
// seed; bB: how high the stream rises, how fast, the bubble's radius, the stream's own phase.
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

// ---- the part ------------------------------------------------------------------------------

export function buildFauna(ctx) {
  const { add, scene, engine, q, camera } = ctx;
  const t0 = performance.now();
  const amt = q.amount, lod = amt >= 1 ? 2 : amt >= 0.5 ? 1 : 0;
  const rng = makeRng(20261115);
  const counts = {};

  // fish
  const fishMat = fishMaterial(), geos = {};
  let fishN = 0;
  for (const [name, { shape, fish }] of populate(rng, amt)) {
    geos[shape] ??= fishShape(SHAPES[shape], lod);
    add(fishMesh(geos[shape], fish, fishMat), 64);
    counts[name] = fish.length;
    fishN += fish.length;
  }

  // the mantas
  const mg = new InstancedBufferGeometry(), mshape = mantaShape(lod);
  mg.setIndex(mshape.index);
  for (const k of ['position', 'normal', 'aux']) mg.setAttribute(k, mshape.getAttribute(k));
  mg.setAttribute('mI', new InstancedBufferAttribute(new Float32Array(8), 4));
  mg.instanceCount = MANTAS.length;
  mg.boundingSphere = new Sphere(new Vector3(0.5, floorY(-158) + 11, -158), 44);
  add(solid(mg, mantaMaterial()), 110);
  const mp = [0, 0, 0], mq = [0, 0, 0], mr = [0, 0, 0], F = new Vector3(), Up = new Vector3(), R = new Vector3(), Y = new Vector3(0, 1, 0);

  // jellyfish
  const spots = jellySpots(rng, Math.max(14, Math.round(34 * Math.sqrt(amt))), Math.max(3, Math.round(6 * Math.sqrt(amt))));
  const nj = spots.length, ja = new Float32Array(nj * 4), jb = new Float32Array(nj * 4), jc = new Float32Array(nj * 4);
  const GLOWS = [[0.3, 0.75, 1.0], [0.25, 0.5, 1.0], [0.35, 1.0, 0.65], [0.65, 0.4, 1.0]];
  const jboxes = [];
  spots.forEach(([x, y, z, near], i) => {
    const R0 = near ? rng.range(0.12, 0.2) : rng.range(0.14, 0.32), c = rng.pick(GLOWS);
    ja.set([x, y, z, R0], i * 4);
    jb.set([rng(), rng.range(0.45, 0.8), rng.range(0.04, 0.1), rng.range(3, 7)], i * 4);
    jc.set([c[0], c[1], c[2], rng.range(0.7, 1.3)], i * 4);
    jboxes.push([x - 4, x + 4, y - 20, y + 16, z - 4, z + 4]);
  });
  const jsphere = sphereOf(jboxes), js = jellyShapes(lod);
  const jattrs = { jA: new InstancedBufferAttribute(ja, 4), jB: new InstancedBufferAttribute(jb, 4), jC: new InstancedBufferAttribute(jc, 4) };
  const jellyGeo = (base) => {
    const g = new InstancedBufferGeometry();
    if (base.index) g.setIndex(base.index);
    for (const k of ['position', 'normal', 'aux']) if (base.getAttribute(k)) g.setAttribute(k, base.getAttribute(k));
    for (const [k, a] of Object.entries(jattrs)) g.setAttribute(k, a);
    g.instanceCount = nj;
    g.boundingSphere = jsphere;
    return g;
  };
  add(solid(jellyGeo(js.ribbons), ribbonMaterial()), 110);
  add(solid(jellyGeo(js.bell), bellMaterial()), 110);
  add(solid(cards(nj, { jA: ja, jB: jb, jC: jc }, jsphere), haloMaterial()), 110);

  // marine snow and plankton, round the eye wherever it is
  const far = new Sphere(new Vector3(0, 0, 0), 1e6);
  const nSnow = Math.round(9000 * amt), sa = new Float32Array(nSnow * 4);
  for (let i = 0; i < nSnow * 4; i++) sa[i] = rng();
  const snow = solid(cards(nSnow, { sA: sa }, far), snowMaterial());
  snow.frustumCulled = false;
  scene.add(snow);
  const nPl = Math.round(3200 * amt), pa = new Float32Array(nPl * 4);
  for (let i = 0; i < nPl * 4; i++) pa[i] = rng();
  const plankton = solid(cards(nPl, { pA: pa }, far), planktonMaterial());
  plankton.frustumCulled = false;
  scene.add(plankton);

  // bubbles: from the chimneys and the vent field, and a trickle from the sand in the shallows
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
  const vents = [], shallows = [];
  for (const c of chimneys()) {
    for (let k = 0; k < 2; k++) {
      const a = rng() * TAU, rr = c.radius * 0.42;
      vents.push([c.top[0] + Math.cos(a) * rr, c.top[1] - rng.range(0.3, 1.2), c.top[2] + Math.sin(a) * rr, rng.range(14, 22), rng.range(0.3, 0.42), rng.range(0.006, 0.012)]);
    }
    const a = rng() * TAU, rr = c.radius * 1.35 + 0.3, x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr;
    vents.push([x, groundY(x, z) + 0.05, z, rng.range(12, 18), rng.range(0.28, 0.38), rng.range(0.005, 0.01)]);
  }
  const ventBubbles = [], sandBubbles = [];
  streams(vents, 16, ventBubbles);
  for (let k = 0, tries = 0; k < 6 && tries < 200; tries++) {
    const z = rng.range(-14, -52), x = centerX(z) + rng.sign() * rng.range(2.5, 12);
    if (offTrack(x, z) < 3) continue;
    const g = groundY(x, z);
    shallows.push([x, g + 0.02, z, -g - 0.1, rng.range(0.24, 0.34), rng.range(0.004, 0.009)]);
    k++;
  }
  streams(shallows, 9, sandBubbles);
  counts.bubbles = bubbleMesh(ventBubbles, 90) + bubbleMesh(sandBubbles, 70);

  if (DEV) console.log(`fauna: ${fishN} fish ${JSON.stringify(counts)}, ${MANTAS.length} mantas, ${nj} jellies, ${nSnow} flecks, ${nPl} plankton, ${Math.round(performance.now() - t0)} ms`);

  return {
    update(t) {
      const e = camera.matrixWorld.elements;
      U.right.value.set(e[0], e[1], e[2]);
      U.up.value.set(e[4], e[5], e[6]);
      U.pix.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(engine.height, 1);
      plankton.visible = camera.position.y < -45;
      // the mantas: where each is on its round, which way it heads, and how it banks into the turn
      for (let i = 0; i < MANTAS.length; i++) {
        const mt = MANTAS[i];
        mantaAt(mt, t, mp); mantaAt(mt, t + 0.6, mq); mantaAt(mt, t - 0.6, mr);
        F.set(mq[0] - mr[0], mq[1] - mr[1], mq[2] - mr[2]).normalize();
        R.crossVectors(F, Y).normalize();
        const lat = ((mq[0] + mr[0] - 2 * mp[0]) * R.x + (mq[2] + mr[2] - 2 * mp[2]) * R.z) / 0.36;
        const roll = Math.max(-0.45, Math.min(0.45, lat * 0.9));
        Up.crossVectors(R, F);
        Up.multiplyScalar(Math.cos(roll)).addScaledVector(R, Math.sin(roll));
        const P = MANTA_POSE.array;
        P[i * 3].set(mp[0], mp[1], mp[2], mt[6] * 3.1);
        P[i * 3 + 1].set(F.x, F.y, F.z, mt[7]);
        P[i * 3 + 2].set(Up.x, Up.y, Up.z, 0);
      }
    },
  };
}
