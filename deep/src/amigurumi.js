// Amigurumi: what every creature of the dive shares with Snap, so that they read as one cast of
// crocheted toys. Plush, rounded, chunky shapes with no hard edges and no thin flat parts;
// single crochet in the same yarn as his (a stitch is about a centimetre on Snap, who is 0.6 m
// tall), its rows worked round the body as an amigurumi is made; a little fuzz; glossy black bead
// eyes, each in a ring of white felt, set wide; a stitched smile and pink felt cheeks; fins,
// flippers, arms and legs as fat stuffed shapes. Colours are written as they look in the
// pictures (sRGB) and used linear.
//
// For the shape (built once, on the CPU):
//   ball(m, x, y, z, rx, ry, rz, res, part)     a stuffed ball or egg
//   pillow(m, cols, rows, dir, part, f)          a stuffed fin, flipper or flap: puffed along dir
//   tubes(m, n, rings, sides, tag)               rings of tubes for a vertex step to bend (arms)
//   orient(m, i0, base, out)                     make what was just added face out
// For the surface (TSL, in a material's surface step):
//   knit(s, f, o)          the yarn laid in the creature's own frame (rows stacked along one axis)
//   rounds(q, c, A, B, R, scale)  where the stitches are on a body worked in rounds about an axis,
//   stitches(s, f, o)      ... and the yarn laid by them (rows that ring the body)
//   felt(s, f, o)          felt: soft, matted, no stitches
//   eyes(s, f, o)          the bead eyes in their felt rings (mirrored across the shape's z)
//   bead(s, n, k), glint(...)      a bead's gloss, its catch light
//   arc(u, v, w, c, t, aa) a stitched line (a smile), spot(u, v, r, aa) a felt dot (a cheek)
//   ringAt(C, T, S0, phi, r)       a ring of a tube built in a vertex step
import {
  abs, acos, atan, cameraPosition, clamp, cos, cross, dFdx, dFdy, dot, float, floor, length, max, mix, normalize, pow, sign, sin, smoothstep,
  texture, vec2, vec3,
} from 'three/tsl';
import { blob } from './math.js';
import { G, detail, sunAt, yarn } from './shaders.js';

export const toLin = (x) => Math.pow(x, 2.2);
export const lin = (r, g, b) => vec3(toLin(r), toLin(g), toLin(b));
// stitches (and rows) to a metre of Snap's yarn (his stitches are about 1.8 cm: some 22 across his
// body); a toy much bigger than him is worked in a thicker one: yarnFor(its length in metres)
export const STITCH = 55;
export const yarnFor = (size) => STITCH / Math.max(1, Math.sqrt(size / 0.9));
// the felt of the eye rings, the dark thread of a smile, the pink felt of the cheeks
export const FELT = [0.97, 0.95, 0.9], INK = [0.07, 0.035, 0.04], BLUSH = [0.98, 0.55, 0.6];

// ---- the shape ----------------------------------------------------------------------------

// Make the triangles added since i0 face the way out(x, y, z) says is out (and their normals).
export function orient(m, i0, base, out) {
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
// A stuffed fin, flipper or flap: two faces puffed apart along `dir`, fullest in the middle and
// meeting in a round seam at the edge. f(s, t, o) gives the point on its middle (o[0..2]) and
// how far it puffs there (o[3]): make that a good part of its width, not a sheet's.
// aux = (x, y, z of that point, part).
export function pillow(m, cols, rows, dir, part, f) {
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
// How full a pillow is across its width (s 0..1 from edge to edge) and toward its tip (t 0..1):
// round in section, plump to near the tip, which is round too.
export const plump = (s, t, tipAt = 0.75) => Math.sqrt(Math.max(4 * s * (1 - s), 0)) * Math.sqrt(Math.max(1 - Math.pow(Math.max(t - tipAt, 0) / (1 - tipAt), 2) * 0.9, 0));
// A stuffed ball or egg: a blob with aux (centre, part).
export function ball(m, x, y, z, rx, ry, rz, res, part) {
  blob(m, x, y, z, (dx, dy, dz) => 1 / Math.hypot(dx / rx, dy / ry, dz / rz), res, (dx, dy, dz, o) => { o[0] = x; o[1] = y; o[2] = z; o[3] = part; });
}
// The rings of tubes a vertex step builds round a centreline: n tubes of `rings` rings, `sides`
// round. aux = (along 0..1, round 0..1, which tube, tag(tube)).
export function tubes(m, n, rings, sides, tag) {
  for (let k = 0; k < n; k++) {
    const base = m.count, g = tag(k);
    for (let r = 0; r <= rings; r++) for (let j = 0; j <= sides; j++) m.vert(0, 0, 0, 0, 1, 0, 0, 0, r / rings, j / sides, k, g);
    for (let r = 0; r < rings; r++) for (let j = 0; j < sides; j++) {
      const a = base + r * (sides + 1) + j;
      m.quad(a, a + 1, a + sides + 2, a + sides + 1);
    }
  }
}
// A ring of a tube (in a vertex step): the centre C, the tangent T, a side S0 (made square to T),
// the angle round and the radius. Gives the point, its normal and the ring's two axes.
export function ringAt(C, T, S0, phi, r) {
  const S = normalize(S0.sub(T.mul(dot(S0, T)))).toVar();
  const B = cross(T, S).toVar();
  const n = S.mul(cos(phi)).add(B.mul(sin(phi))).toVar();
  return { p: C.add(n.mul(r)), n, S, B };
}

// ---- the yarn -----------------------------------------------------------------------------

// What wool does with the light: soft, a little light through it, warm colours answering the
// blue water, and a halo on every outline where the fibres catch the light (as on Snap). The
// caustics' sharp net is softened on it, as on him: on stitches it would flicker.
function wool(s, f, fuzz) {
  s.spec = float(0.04); s.gloss = float(10.0); s.trans = float(0.15); s.fluor = float(0.6);
  s.caustic = float(0.4);
  const graze = pow(float(1.0).sub(abs(dot(s.n, normalize(cameraPosition.sub(f.w))))), 3.0);
  s.emis = s.emis.add(sunAt(f.w.y).mul(0.06).add(G.amb.mul(0.14)).mul(graze).mul(s.albedo).mul(fuzz));
}

// The yarn laid in the creature's own frame: yarn() reads its stitches along the three axes of
// `p` and weighs them by the normal; on a creature that turns both must be in its frame. o.frame
// = [A, B, C]: where the frame's axes point in the world (rows are stacked along B). The rest of
// o as yarn() takes it (color, color2, stripe, scale, p, k), and fuzz. The stitches stand out as
// Snap's do: round, with deep gaps between them.
export function knit(s, f, o) {
  const [A, B, C] = o.frame, n = s.n;
  s.n = vec3(dot(n, A), dot(n, B), dot(n, C));
  const r = yarn(s, f, { ...o, k: (o.k ?? 1.3) * 1.5, fuzz: 0 });
  const m = s.n;
  s.n = normalize(A.mul(m.x).add(B.mul(m.y)).add(C.mul(m.z))).toVar();
  s.albedo = s.albedo.mul(r.h.mul(0.3).add(0.78));
  s.ao = s.ao.mul(r.h.mul(0.2).add(0.8));
  wool(s, f, o.fuzz ?? 1.0);
  return r;
}

// Where the stitches are on a body worked in rounds about an axis, as an amigurumi body, head or
// dome is made: from a ring of stitches at its pole, round after round, each round as many
// stitches longer as it takes to stay square. q: the point and c the body's middle, in its own
// frame (metres); A: the axis, toward the pole the rounds start from; B: square to it (where the
// rounds start); R: the body's radius; scale: stitches to a metre. tube 1: a tube, an arm or a
// flipper instead, worked along A (from its far end): its rounds all as long, the rows stacked
// down the axis. (R, tube, c, A and B may be shader values.) Gives the stitch coordinates (a
// round the body, b along the rows' stack, both in stitches), how they change across the
// screen, and the directions they grow on the surface (in the same frame).
export function rounds(q, c, A, B, R, scale, tube = 0) {
  const d = q.sub(c).toVar(), dn = normalize(d).toVar();
  const C = cross(A, B).toVar();
  const ct = clamp(dot(dn, A), -0.9999, 0.9999).toVar(), Rs = float(R).mul(scale).toVar();
  const b = mix(acos(ct).mul(Rs), dot(d, A).negate().mul(scale), tube).toVar();
  const x = dot(d, B), y = dot(d, C);
  // (the round's stitches, a whole number of eights so that the rounds close without a seam; the
  // round's own count, so each round's stitches sit between the last one's, as they do)
  const ring = mix(sin(floor(b).add(0.5).div(Rs)), float(1.0), tube);
  const N = max(floor(ring.mul(Rs).mul(2 * Math.PI / 8).add(0.5)), 1.0).mul(8.0).toVar();
  const a = atan(y, x).div(2 * Math.PI).mul(N);
  // (how the angle round changes across the screen, from the point's own smooth change: no seam
  // where the angle wraps)
  const r2 = max(x.mul(x).add(y.mul(y)), 1e-8);
  const dphi = (dd) => x.mul(dd(y)).sub(y.mul(dd(x))).div(r2);
  const k = N.div(2 * Math.PI);
  return {
    a, b, ga: vec2(dphi(dFdx).mul(k), dphi(dFdy).mul(k)), gb: vec2(dFdx(b), dFdy(b)),
    Ta: normalize(cross(A, d).add(B.mul(1e-5))), Tb: normalize(mix(dn.mul(ct).sub(A), A.negate(), tube).add(C.mul(1e-5))),
  };
}
// The yarn laid by stitch coordinates (from rounds(), or any a, b of a shape's own): o.st = {a, b,
// ga, gb, Ta, Tb} with Ta, Tb in the world; color, color2 and stripe (rows of `stripe` stitches
// of each, counted up b), k (how much the stitches bend the light), fuzz.
export function stitches(s, f, o) {
  const st = o.st, uv = vec2(st.a, st.b).div(8.0);
  const t = texture(G.stitchTex, uv).grad(vec2(st.ga.x, st.gb.x).div(8.0), vec2(st.ga.y, st.gb.y).div(8.0)).toVar();
  const k = (o.k ?? 1.3) * 1.5, g = t.rg.sub(0.5).mul(k);
  s.n = normalize(s.n.sub(st.Ta.mul(g.x)).sub(st.Tb.mul(g.y))).toVar();
  let col = o.color;
  if (o.color2) col = mix(o.color, o.color2, floor(st.b.div(o.stripe ?? 3)).mul(0.5).fract().mul(2.0).floor());
  s.albedo = vec3(col).mul(t.b.mul(0.62).add(0.38)).mul(t.a.mul(0.16).add(0.92));
  s.ao = s.ao.mul(t.b.mul(0.45).add(0.55));
  wool(s, f, o.fuzz ?? 1.0);
  return { h: t.b, id: t.a };
}
// A frame's direction (given in it) in the world: [A, B, C] where its axes point.
export const inWorld = (frame, d) => frame[0].mul(d.x).add(frame[1].mul(d.y)).add(frame[2].mul(d.z));

// Felt: matted wool, no stitches; a soft mottle of fibres and a fuzz on its outline. p: where to
// read the fibres (the shape's own space, metres), scale: how fine.
export function felt(s, f, o) {
  const d = detail(o.p, s.n, o.scale ?? 30, 0.35);
  s.n = d.n;
  s.albedo = vec3(o.color).mul(d.m.mul(0.16).add(0.9));
  wool(s, f, o.fuzz ?? 1.4);
  s.trans = float(0.1);
}

// ---- the face -----------------------------------------------------------------------------

// A glass bead (an eye): black, glossy, smooth. k: 1 on the bead.
export function bead(s, nSmooth, k) {
  s.albedo = mix(s.albedo, vec3(0.008, 0.008, 0.011), k);
  s.emis = s.emis.mul(float(1.0).sub(k));
  s.n = normalize(mix(s.n, nSmooth, k));
  s.spec = mix(s.spec, float(1.4), k); s.gloss = mix(s.gloss, float(90.0), k);
  s.trans = mix(s.trans, float(0.0), k); s.fluor = mix(s.fluor, float(0.0), k);
}
// The catch light on a bead eye (either side): a small bright spot where it faces up and
// forward. q the point in the shape's frame, the eye at (ex, ey, +-ez) of radius er; k: 1 on it.
export function glint(s, q, ex, ey, ez, er, k) {
  const sd = sign(q.z), c = vec3(ex, ey, sd.mul(ez)), n = normalize(q.sub(c));
  const g = smoothstep(0.86, 0.94, dot(n, normalize(vec3(0.62, 0.62, sd.mul(0.48))))).mul(k).mul(float(1.0).sub(smoothstep(0.0, float(er).mul(0.4), abs(length(q.sub(c)).sub(er)))));
  s.albedo = mix(s.albedo, vec3(0.92), g);
  s.emis = s.emis.add(vec3(0.6).mul(g));
}
// The bead eyes in their rings of white felt, one each side (mirrored across the shape's z): the
// bead is its own part of the shape (o.bead: 1 on it), half sunk in the face; the felt ring is
// sewn on round it, out to o.ring times its radius, with a little shadow under its edge so it
// reads as a piece laid on. q: the point in the shape's frame; o.at: [x, y, z, r] the bead (numbers
// or shader values); o.on: where the ring may be (1, or a part's mask). n0: the smooth normal (the
// felt and the bead are not stitched).
export function eyes(s, q, n0, o) {
  const [ex, ey, ez, er] = o.at, ro = float(er).mul(o.ring ?? 1.75);
  const d = length(vec3(q.x.sub(ex), q.y.sub(ey), abs(q.z).sub(ez)));
  const aa = max(length(vec2(dFdx(d), dFdy(d))), 1e-5);
  const off = float(1.0).sub(o.bead).mul(o.on ?? 1.0);
  const ring = float(1.0).sub(smoothstep(ro.sub(aa), ro.add(aa), d)).mul(off).toVar();
  const edge = smoothstep(ro.sub(aa), ro.add(aa), d).mul(float(1.0).sub(smoothstep(ro, ro.add(float(er).mul(0.22)), d))).mul(off);
  s.albedo = mix(s.albedo.mul(float(1.0).sub(edge.mul(0.45))), lin(...FELT), ring);
  s.n = normalize(mix(s.n, n0, ring.mul(0.8)));
  s.fluor = mix(s.fluor, float(0.3), ring);
  bead(s, n0, o.bead);
  glint(s, q, ex, ey, ez, er, o.bead);
  return ring;
}
// A stitched line (a smile): points (u, v) where v = c (u / w)^2 for |u| < w (the ends turn up by
// c), thread t thick; aa: a pixel, in the same units. 1 on the thread.
export function arc(u, v, w, c, t, aa) {
  const x = clamp(u.div(w), -1.0, 1.0);
  const dv = abs(v.sub(x.mul(x).mul(c))), du = max(abs(u).sub(w), 0.0);
  return float(1.0).sub(smoothstep(float(t).sub(aa), aa.add(t), length(vec2(du, dv))));
}
// A round felt dot (a cheek): 1 inside radius r of (u, v), soft at its edge.
export function spot(u, v, r, aa) {
  return float(1.0).sub(smoothstep(float(r).mul(0.82).sub(aa), aa.add(r), length(vec2(u, v))));
}
// Sew the face's thread and felt onto the surface: the smile in dark thread, the cheeks in pink
// felt (both smooth, over the stitches).
export function sew(s, n0, smile, cheeks) {
  s.albedo = mix(s.albedo, lin(...BLUSH), cheeks.mul(0.85));
  s.albedo = mix(s.albedo, lin(...INK), smile);
  s.n = normalize(mix(s.n, n0, max(smile, cheeks).mul(0.6)));
  s.fluor = mix(s.fluor, float(0.2), smile);
}
