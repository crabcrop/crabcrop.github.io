// The shallows' things (zone s1, and the kelp's tangled fish): crochet fish that the page
// places every frame, the cargo lying on the sand (five kinds of source), and the sun's glint
// on the sand under the visitor's hand.
//
// The fish are toys built like Snap: plush round bodies in single crochet worked round from
// the nose, fat stuffed fins and tails, big glossy bead eyes each in a ring of white felt, a
// stitched smile and pink felt cheeks. One kind per image format, as in the painted dive's
// atlas: AVIF a sleek blue mackerel, WebP an orange puffer, JPEG a yellow tang, JPEG XL a teal
// wrasse with cream bands, PNG a glass fish (you see through it), GIF a cluster of tiny bright
// ones whose tails beat in a few steps, like a GIF's frames. All the fish of a group are one
// mesh (two: the glass ones are see-through): each is placed from three numbers-of-four the
// page writes every frame (where it is and how long, which way it heads and its tail's phase,
// which way is up and how hard it wags), so that schools can gather by Snap's claw.
import { BufferAttribute, BufferGeometry, Matrix4, Mesh as ThreeMesh, PlaneGeometry, Sphere, Vector3, Vector4 } from 'three/webgpu';
import {
  abs, attribute, cameraPosition, clamp, cos, cross, dFdx, dFdy, dot, exp, float, fract, int, length, max, mix, normalize, pow,
  select, sign, sin, smoothstep, step, uniform, uniformArray, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';
import { groundY } from '../layout.js';
import { Mesh, TAU, blob, lathe, lerp, makeRng, tube } from '../math.js';
import { G, material, sunAt, yarn } from '../shaders.js';

// colours as the pictures have them, made linear (the light works in linear values)
const toLin = (x) => Math.pow(x, 2.2);
const L3 = (r, g, b) => [toLin(r), toLin(g), toLin(b)];
const lin = (r, g, b) => vec3(toLin(r), toLin(g), toLin(b));
// Snap's yarn: stitches (and rows) to a metre
const STITCH = 85;

// ---- shapes --------------------------------------------------------------------------------

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
// A stuffed fin or flap: two faces puffed apart along `dir`, fullest in the middle and meeting
// in a round seam at the edge. f(s, t, o): the point on its middle (o[0..2]) and how far it
// puffs there (o[3]). aux = (that point, part).
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
// how full a stuffed fin is across (s, edge to edge) and toward its tip (t)
const plump = (s, t, tipAt = 0.7) => Math.sqrt(Math.max(4 * s * (1 - s), 0)) * Math.sqrt(Math.max(1 - Math.pow(Math.max(t - tipAt, 0) / (1 - tipAt), 2) * 0.9, 0));
// a stuffed ball or egg (aux: its centre, part)
function ball(m, x, y, z, rx, ry, rz, res, part) {
  blob(m, x, y, z, (dx, dy, dz) => 1 / Math.hypot(dx / rx, dy / ry, dz / rz), res, (dx, dy, dz, o) => { o[0] = x; o[1] = y; o[2] = z; o[3] = part; });
}

// The kinds, each grown one metre long: nose at x = 0.5, tail tip at -0.5, back up (+y), its
// right side +z. h, w: half the height and width where deepest (`at`, 0 the nose, 1 the root
// of the tail); nose: how blunt (smaller is blunter); end: where the body ends; ped: the root
// of the tail; tail: [half span, how deep its notch]; dorsal, anal: [from x, to x, height];
// pect: [x, length, width]; eye: [x, y, radius]; fin: how fat the fins are; nubs: the
// puffer's soft spikes; keel: how flat its sides are.
export const KINDS = {
  avif: { h: 0.16, w: 0.13, at: 0.36, nose: 0.55, end: -0.25, ped: 0.05, tail: [0.25, 1.1], dorsal: [0.14, -0.05, 0.08], anal: [-0.04, -0.17, 0.05], pect: [0.17, 0.15, 0.08], eye: [0.35, 0.045, 0.078], fin: 0.05 },
  webp: { h: 0.33, w: 0.31, at: 0.5, nose: 0.36, end: -0.15, ped: 0.085, tail: [0.21, 0.0], dorsal: [0.02, -0.12, 0.09], anal: null, pect: [0.1, 0.15, 0.12], eye: [0.27, 0.115, 0.105], fin: 0.065, nubs: 26 },
  jpeg: { h: 0.41, w: 0.14, at: 0.45, nose: 0.75, end: -0.2, ped: 0.08, tail: [0.23, 0.15], dorsal: [0.27, -0.2, 0.1], anal: [0.1, -0.2, 0.095], pect: [0.12, 0.17, 0.11], eye: [0.27, 0.125, 0.095], fin: 0.055, keel: 0.2 },
  jxl: { h: 0.25, w: 0.19, at: 0.38, nose: 0.45, end: -0.2, ped: 0.07, tail: [0.23, 0.08], dorsal: [0.2, -0.15, 0.08], anal: [0.0, -0.15, 0.06], pect: [0.15, 0.16, 0.1], eye: [0.31, 0.08, 0.092], fin: 0.06 },
  png: { h: 0.22, w: 0.13, at: 0.36, nose: 0.5, end: -0.22, ped: 0.05, tail: [0.24, 0.5], dorsal: [0.1, -0.12, 0.08], anal: [0.0, -0.15, 0.065], pect: [0.16, 0.13, 0.08], eye: [0.33, 0.06, 0.1], fin: 0.05 },
  gif: { h: 0.32, w: 0.28, at: 0.42, nose: 0.4, end: -0.16, ped: 0.075, tail: [0.26, 0.3], dorsal: [0.06, -0.1, 0.09], anal: [-0.02, -0.12, 0.05], pect: [0.12, 0.15, 0.11], eye: [0.27, 0.1, 0.12], fin: 0.065 },
};
export const FORMATS = ['avif', 'webp', 'jpeg', 'jxl', 'png', 'gif'];
const KIND_ID = { avif: 0, webp: 1, jpeg: 2, jxl: 3, png: 4, gif: 5 };

// a kind's body: half height, half width and the middle's rise at u (0 nose .. 1 tail root)
function profile(sp) {
  const p = sp.nose, q = (p * (1 - sp.at)) / sp.at, peak = Math.pow(sp.at, p) * Math.pow(1 - sp.at, q);
  return (u) => {
    const b = (Math.pow(u, p) * Math.pow(1 - u, q)) / peak, k = u * u * u;
    return [sp.h * b + sp.ped * k, sp.w * b + sp.ped * 0.7 * k, 0.05 * sp.h * Math.sin(Math.PI * u)];
  };
}
// where a kind's eyes are: (x, y, z out from the middle, radius), half sunk in its head
export function eyeOf(sp) {
  const prof = profile(sp), [ex, ey, er] = sp.eye, u = Math.min(Math.max((0.5 - ex) / (0.5 - sp.end), 0), 1);
  const [a, w, yc] = prof(u), sn = Math.min(Math.abs(ey - yc) / a, 0.95);
  const zs = w * Math.sqrt(1 - sn * sn) * (1 - (sp.keel ?? 0) * Math.pow(sn, 3));
  return [ex, ey, zs - er * 0.3, er];
}

// One fish of a kind. aux = (x, y, how high round the body from -1 belly to 1 back, part):
// parts 0 body, 1 tail, 2 back and belly fins, 3 side fins, 4 eye beads, 5 nubs.
function fishShape(sp, lod) {
  const nr = lod ? 14 : 10, ns = lod ? 12 : 9, m = new Mesh(true), rng = makeRng(7);
  const prof = profile(sp), E = sp.end;
  const xAt = (u) => 0.5 - u * (0.5 - E), uAt = (x) => Math.min(Math.max((0.5 - x) / (0.5 - E), 0), 1);
  // the body: rounds from the nose back (closer together at both ends), closed behind the tail's root
  const i0 = m.i.length, base = m.count;
  m.grid(nr, ns, (s, t, o) => {
    const r = Math.round(t * ns), last = r === ns, u = last ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * r) / (ns - 1));
    const [a0, b0, yc] = prof(u), a = last ? 0 : a0, b = last ? 0 : b0, x = last ? xAt(1) - 0.03 : xAt(u);
    const ph = s * TAU - Math.PI / 2, sn = Math.sin(ph), cs = Math.cos(ph);
    o[0] = x; o[1] = yc + a * sn; o[2] = b * cs * (1 - (sp.keel ?? 0) * Math.pow(Math.abs(sn), 3));
    o[3] = x; o[4] = o[1]; o[5] = sn; o[6] = 0;
  }, true);
  orient(m, i0, base, (x, y, z) => [0, y - prof(uAt(x))[2], z]);
  const th = sp.fin, yE = prof(1)[2];
  // the tail: a fat fan from the root, a notch in its edge, stuffed to its rim
  pillow(m, lod ? 7 : 5, lod ? 3 : 2, [0, 0, 1], 1, (s, t, o) => {
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
  for (let k = 0; k < (sp.nubs ?? 0); k++) {
    const u = rng.range(0.14, 0.85), ph = rng() * TAU, [a, b, yc] = prof(u), x = xAt(u);
    const y = yc + a * Math.sin(ph), z = b * Math.cos(ph), nx = 0.15, ny = Math.sin(ph) / a, nz = Math.cos(ph) / b, l = Math.hypot(nx, ny, nz);
    const len = 0.05 + 0.02 * rng(), dx = nx / l, dy = ny / l, dz = nz / l;
    const v0 = m.count;
    tube(m, [[x - dx * 0.01, y - dy * 0.01, z - dz * 0.01, 0.032], [x + dx * len * 0.55, y + dy * len * 0.55, z + dz * len * 0.55, 0.024], [x + dx * len, y + dy * len, z + dz * len, 0.013]], 5);
    for (let v = v0; v < m.count; v++) { m.a[v * 4] = x; m.a[v * 4 + 1] = y; m.a[v * 4 + 2] = Math.sin(ph); m.a[v * 4 + 3] = 5; }
  }
  // the eyes: big black beads, half sunk, one on each side
  const [ex, ey, ez, er] = eyeOf(sp);
  for (const side of [1, -1]) ball(m, ex, ey, side * ez, er, er, er, lod ? 4 : 3, 4);
  return m;
}

// ---- the fish's material ------------------------------------------------------------------

const fk = attribute('fk', 'vec4');       // its kind, its slot, its seed, its colour pick
const fe = attribute('fe', 'vec4');       // where its eyes are (x, y, out, radius)
const vLoc = varyingProperty('vec3', 'v_sfl'), vF = varyingProperty('vec3', 'v_sff'), vU = varyingProperty('vec3', 'v_sfu');
const vI = varyingProperty('vec4', 'v_sfi'), vE = varyingProperty('vec4', 'v_sfe');

// one of six by index (TSL)
const pick6 = (k, list) => { let c = list[5]; for (let i = 4; i >= 0; i--) c = select(k.lessThan(i + 0.5), list[i], c); return c; };
// The yarn laid in the fish's own frame: yarn() reads its stitches along the three axes of `p`
// and weighs them by the normal; on a fish that turns both must be in its frame [A, B, C].
function knit(s, f, o) {
  const [A, B, C] = o.frame, n = s.n;
  s.n = vec3(dot(n, A), dot(n, B), dot(n, C));
  const r = yarn(s, f, { ...o, fuzz: 0 });
  const m = s.n;
  s.n = normalize(A.mul(m.x).add(B.mul(m.y)).add(C.mul(m.z))).toVar();
  const graze = pow(float(1.0).sub(abs(dot(s.n, normalize(cameraPosition.sub(f.w))))), 3.0);
  s.emis = s.emis.add(sunAt(f.w.y).mul(0.06).add(G.amb.mul(0.14)).mul(graze).mul(s.albedo));
  s.caustic = float(0.45);
  return r;
}
// a glossy black bead (k: 1 on it)
function bead(s, n0, k) {
  s.albedo = mix(s.albedo, vec3(0.008, 0.008, 0.011), k);
  s.emis = s.emis.mul(float(1.0).sub(k));
  s.n = normalize(mix(s.n, n0, k));
  s.spec = mix(s.spec, float(1.4), k); s.gloss = mix(s.gloss, float(90.0), k);
  s.trans = mix(s.trans, float(0.0), k); s.fluor = mix(s.fluor, float(0.0), k);
}

function fishMaterial(POSE, glass) {
  return material({
    aux: true, shadow: false, transparent: glass,
    vertex: (v) => {
      const i = int(fk.y).mul(3);
      const A = POSE.element(i), B = POSE.element(i.add(1)), C = POSE.element(i.add(2));
      const F = normalize(B.xyz).toVar(), Up = normalize(C.xyz).toVar(), R = normalize(cross(F, Up)).toVar();
      // it wags: the head barely, the tail most
      const lp = v.P.toVar(), ln = v.N.toVar();
      const u = clamp(float(0.45).sub(lp.x), 0.0, 1.0).toVar();
      const ph = B.w.sub(u.mul(2.4)).toVar();
      const amp = u.mul(u).mul(0.16).add(0.008).mul(C.w).toVar();
      const sw = sin(ph), cw = cos(ph);
      const slope = u.mul(0.32).mul(sw).mul(C.w).sub(amp.mul(2.4).mul(cw)).negate();
      const lq = vec3(lp.x, lp.y, lp.z.add(amp.mul(sw)));
      const nq = vec3(ln.x.sub(slope.mul(ln.z)), ln.y, ln.z);
      v.P.assign(A.xyz.add(F.mul(lq.x).add(Up.mul(lq.y)).add(R.mul(lq.z)).mul(A.w)));
      v.N.assign(normalize(F.mul(nq.x).add(Up.mul(nq.y)).add(R.mul(nq.z))));
      // the stitches' own place: rows run round the body, stacked from nose to tail
      vLoc.assign(vec3(lp.y, lp.x, lp.z).mul(A.w).add(fk.z.mul(3.1)));
      vF.assign(F); vU.assign(Up);
      vI.assign(vec4(fk.x, fk.z, A.w, fk.w));
      vE.assign(fe);
    },
    surface: (s, f) => {
      const kind = vI.x, pal = vI.w, q = f.obj.toVar(), part = f.aux.w, yn = f.aux.z;
      const body = float(1.0).sub(step(0.5, part)).toVar(), finK = step(0.5, part).mul(float(1.0).sub(step(3.5, part))).toVar();
      const nub = step(4.5, part), eyeK = step(3.5, part).mul(float(1.0).sub(nub)).toVar();
      const n0 = s.n;
      // colours by kind: body, second (stripes, bands, belly, head), fins
      const gifBody = pick6(pal, [lin(0.98, 0.52, 0.66), lin(0.99, 0.6, 0.22), lin(0.6, 0.86, 0.3), lin(0.36, 0.7, 0.98), lin(0.7, 0.5, 0.95), lin(0.99, 0.84, 0.28)]);
      const gifFin = pick6(pal, [lin(0.99, 0.84, 0.3), lin(0.98, 0.95, 0.88), lin(0.98, 0.52, 0.66), lin(0.99, 0.84, 0.28), lin(0.98, 0.62, 0.78), lin(0.36, 0.7, 0.98)]);
      const base = pick6(kind, [lin(0.4, 0.58, 0.84), lin(0.98, 0.55, 0.2), lin(0.99, 0.83, 0.16), lin(0.1, 0.6, 0.62), lin(0.88, 0.96, 0.99), gifBody]);
      const second = pick6(kind, [lin(0.12, 0.22, 0.46), lin(0.99, 0.88, 0.7), lin(0.99, 0.92, 0.5), lin(0.97, 0.93, 0.8), lin(1.0, 1.0, 1.0), lin(0.98, 0.95, 0.88)]);
      const fins = pick6(kind, [lin(0.55, 0.7, 0.9), lin(0.99, 0.78, 0.56), lin(0.98, 0.72, 0.1), lin(0.07, 0.48, 0.52), lin(0.8, 0.93, 0.99), gifFin]);
      // where the second colour goes: the mackerel's wavy bars on its back and pale belly; the
      // puffer's cream belly; the tang's paler belly; the wrasse's cream bands; the glass fish's
      // white ribs; the tiny ones' cream heads
      const bars = smoothstep(0.05, 0.3, yn).mul(smoothstep(0.55, 0.75, sin(q.x.mul(62.0).add(sin(q.y.mul(45.0)).mul(1.4))).mul(0.5).add(0.5)));
      const belly = float(1.0).sub(smoothstep(-0.45, -0.15, yn));
      const puffBelly = float(1.0).sub(smoothstep(-0.25, 0.05, yn));
      const bands = step(0.55, fract(q.x.mul(6.4).add(0.3))).mul(step(q.x, 0.33)).mul(step(-0.2, q.x));
      const ribs = float(1.0).sub(smoothstep(0.07, 0.15, abs(fract(q.x.mul(15.0)).sub(0.5)))).mul(step(q.x, 0.3)).mul(step(-0.2, q.x)).mul(float(1.0).sub(smoothstep(0.55, 0.8, abs(yn))));
      const spine = float(1.0).sub(smoothstep(0.06, 0.13, abs(yn))).mul(step(q.x, 0.34)).mul(step(-0.26, q.x));
      const head = smoothstep(0.17, 0.2, q.x);
      const sk = pick6(kind, [max(bars, belly), puffBelly, belly.mul(0.6), bands, max(ribs, spine), head]).mul(body).toVar();
      const bodyCol = mix(base, select(kind.lessThan(0.5), mix(second, lin(0.93, 0.93, 0.88), belly), second), sk);
      const col = select(body.greaterThan(0.5), bodyCol, select(nub.greaterThan(0.5), mix(base, lin(0.9, 0.42, 0.12), 0.5), fins));
      const F = normalize(vF), Up = normalize(vU), R = cross(F, Up);
      knit(s, f, { color: col, scale: STITCH, p: vLoc, frame: [Up, F, R], k: 1.1 });
      // the face: a ring of white felt round each eye, the bead in it; a stitched smile and
      // pink felt cheeks, both sides
      const ex = vE.x, ey = vE.y, ez = vE.z, er = vE.w;
      const d = length(vec3(q.x.sub(ex), q.y.sub(ey), abs(q.z).sub(ez)));
      const aa = max(length(vec2(dFdx(d), dFdy(d))), 1e-5);
      const ro = er.mul(1.72);
      const ring = float(1.0).sub(smoothstep(ro.sub(aa), ro.add(aa), d)).mul(float(1.0).sub(eyeK)).toVar();
      const edge = smoothstep(ro.sub(aa), ro.add(aa), d).mul(float(1.0).sub(smoothstep(ro, ro.add(er.mul(0.22)), d))).mul(float(1.0).sub(eyeK));
      s.albedo = mix(s.albedo.mul(float(1.0).sub(edge.mul(0.4))), lin(0.97, 0.95, 0.9), ring);
      s.n = normalize(mix(s.n, n0, ring.mul(0.8)));
      bead(s, n0, eyeK);
      // (the bead's catch light, up and forward)
      const c = vec3(ex, ey, sign(q.z).mul(ez)), nb = normalize(q.sub(c));
      const gl = smoothstep(0.86, 0.94, dot(nb, normalize(vec3(0.62, 0.62, sign(q.z).mul(0.48))))).mul(eyeK);
      s.albedo = mix(s.albedo, vec3(0.92), gl); s.emis = s.emis.add(vec3(0.6).mul(gl));
      // the smile just behind the nose, its ends turned up; the cheeks under the eyes
      const su = q.x.sub(ex.add(0.5).mul(0.5).add(0.03)), sv = q.y.sub(ey.mul(0.25).sub(0.035));
      const sx = clamp(su.div(0.05), -1.0, 1.0);
      const sd = length(vec2(max(abs(su).sub(0.05), 0.0), abs(sv.sub(sx.mul(sx).mul(0.02)))));
      const smile = float(1.0).sub(smoothstep(0.007, 0.007 + 0.006, sd)).mul(body).mul(step(0.02, abs(q.z)));
      const cheek = float(1.0).sub(smoothstep(0.02, 0.03, length(vec2(q.x.sub(ex.sub(er.mul(0.2))), q.y.sub(ey.sub(er.mul(1.9))))))).mul(body).mul(step(0.02, abs(q.z)));
      s.albedo = mix(s.albedo, lin(0.98, 0.55, 0.6), cheek.mul(0.8));
      s.albedo = mix(s.albedo, lin(0.07, 0.035, 0.04), smile);
      // glass: the body and fins let the water through; the ribs, spine and eyes are solid
      if (glass) {
        const solid = clamp(max(eyeK, sk.mul(0.75)).add(ring.mul(0.8)), 0.0, 1.0);
        const vv = normalize(cameraPosition.sub(f.w));
        const fr = pow(float(1.0).sub(abs(dot(s.n, vv))), 2.0);
        s.alpha = mix(mix(float(0.34), float(0.22), finK).add(fr.mul(0.4)), float(1.0), solid);
        s.spec = mix(float(0.6), s.spec, solid); s.gloss = mix(float(50.0), s.gloss, solid);
        s.emis = s.emis.add(G.amb.mul(0.2).mul(fr).mul(float(1.0).sub(solid)));
      }
    },
  });
}

// The fish of a group, `list` of { kind, seed, pal } (pal: a colour pick, for the tiny ones),
// as one mesh (and a second for glass fish). Returns the meshes and how to place each fish.
export function createFish(scene, list, lod = 1) {
  const n = list.length;
  const POSE = uniformArray(Array.from({ length: n * 3 }, (_, i) => (i % 3 === 0 ? new Vector4(0, -1000, 0, 0) : i % 3 === 1 ? new Vector4(1, 0, 0, 0) : new Vector4(0, 1, 0, 0))), 'vec4');
  const shapes = {};
  const build = (which) => {
    let nv = 0, ni = 0;
    for (let s = 0; s < n; s++) { if (which(list[s])) { const m = (shapes[list[s].kind] ??= fishShape(KINDS[list[s].kind], lod)); nv += m.count; ni += m.i.length; } }
    if (!nv) return null;
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), aux = new Float32Array(nv * 4), kk = new Float32Array(nv * 4), ee = new Float32Array(nv * 4);
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let v0 = 0, i0 = 0;
    for (let s = 0; s < n; s++) {
      const f = list[s];
      if (!which(f)) continue;
      const m = shapes[f.kind], eye = eyeOf(KINDS[f.kind]);
      pos.set(m.p, v0 * 3); nrm.set(m.n, v0 * 3); aux.set(m.a, v0 * 4);
      for (let v = 0; v < m.count; v++) {
        kk[(v0 + v) * 4] = KIND_ID[f.kind]; kk[(v0 + v) * 4 + 1] = s; kk[(v0 + v) * 4 + 2] = f.seed ?? 0; kk[(v0 + v) * 4 + 3] = f.pal ?? 0;
        ee[(v0 + v) * 4] = eye[0]; ee[(v0 + v) * 4 + 1] = eye[1]; ee[(v0 + v) * 4 + 2] = eye[2]; ee[(v0 + v) * 4 + 3] = eye[3];
      }
      for (let k = 0; k < m.i.length; k++) idx[i0 + k] = m.i[k] + v0;
      v0 += m.count; i0 += m.i.length;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('normal', new BufferAttribute(nrm, 3));
    g.setAttribute('aux', new BufferAttribute(aux, 4));
    g.setAttribute('fk', new BufferAttribute(kk, 4));
    g.setAttribute('fe', new BufferAttribute(ee, 4));
    g.setIndex(new BufferAttribute(idx, 1));
    g.boundingSphere = new Sphere(new Vector3(), 1e5);
    const mesh = new ThreeMesh(g, fishMaterial(POSE, which === isGlass));
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    mesh.renderOrder = which === isGlass ? 2 : 0;
    scene.add(mesh);
    return mesh;
  };
  const isGlass = (f) => f.kind === 'png', isSolid = (f) => f.kind !== 'png';
  const meshes = [build(isSolid), build(isGlass)].filter(Boolean);
  const a = POSE.array;
  return {
    POSE, meshes, count: n,
    // place fish i: where (a Vector3), heading F and up U (unit, square to each other), its
    // length (0 hides it), its tail's phase and how hard it wags
    set(i, P, F, U, len, phase, amp) {
      a[i * 3].set(P.x, P.y, P.z, len);
      a[i * 3 + 1].set(F.x, F.y, F.z, phase);
      a[i * 3 + 2].set(U.x, U.y, U.z, amp);
    },
    hide(i) { a[i * 3].w = 0; },
    show(on) { for (const m of meshes) m.visible = on; },
  };
}

// ---- the cargo on the sand: five kinds of source --------------------------------------------

// Its pieces in yarn and felt (aux: colour, and the stuff: 0 yarn, 1 felt, 2 silver thread,
// 3 rope, 4 sand)
function cargoMaterial() {
  return material({
    aux: true, fade: [44, 60],
    surface(s, f) {
      const kind = f.aux.w, col = f.aux.xyz;
      const isFelt = step(0.5, kind).mul(float(1.0).sub(step(1.5, kind))), metal = step(1.5, kind).mul(float(1.0).sub(step(2.5, kind)));
      const rope = step(2.5, kind).mul(float(1.0).sub(step(3.5, kind))), sand = step(3.5, kind);
      yarn(s, f, { color: col, scale: 56, p: f.w.mul(mix(float(1.0), float(1.7), isFelt.add(sand))), k: mix(float(1.25), float(0.4), isFelt.add(sand)) });
      s.spec = mix(s.spec, float(0.55), metal); s.gloss = mix(s.gloss, float(28.0), metal);
      s.fluor = mix(float(0.55), float(0.2), metal.add(sand));
      s.trans = mix(s.trans, float(0.25), isFelt);
      s.albedo = s.albedo.mul(mix(float(1.0), float(0.85), rope));
    },
  });
}
const paint = (m, from, rgb, kind) => { for (let v = from; v < m.count; v++) { m.a[v * 4] = rgb[0]; m.a[v * 4 + 1] = rgb[1]; m.a[v * 4 + 2] = rgb[2]; m.a[v * 4 + 3] = kind; } };
// turn and move what was added since `from`: about y by yaw, then tilted about x, rolled about z
const MT = new Matrix4(), MR = new Matrix4(), V = new Vector3();
function put(m, from, at, yaw, tilt = 0, roll = 0, scale = 1) {
  MT.makeRotationY(yaw).multiply(MR.makeRotationX(tilt)).multiply(new Matrix4().makeRotationZ(roll)).multiply(new Matrix4().makeScale(scale, scale, scale));
  for (let v = from; v < m.count; v++) {
    V.set(m.p[v * 3], m.p[v * 3 + 1], m.p[v * 3 + 2]).applyMatrix4(MT);
    m.p[v * 3] = V.x + at[0]; m.p[v * 3 + 1] = V.y + at[1]; m.p[v * 3 + 2] = V.z + at[2];
    V.set(m.n[v * 3], m.n[v * 3 + 1], m.n[v * 3 + 2]).transformDirection(MT);   // (a uniform scale keeps normals)
    m.n[v * 3] = V.x; m.n[v * 3 + 1] = V.y; m.n[v * 3 + 2] = V.z;
  }
}
// a rounded box (a superellipsoid), half sizes a, b, c
const roundBox = (m, a, b, c, res = 6, k = 8) => blob(m, 0, 0, 0, (x, y, z) => 1 / Math.pow(Math.pow(Math.abs(x / a), k) + Math.pow(Math.abs(y / b), k) + Math.pow(Math.abs(z / c), k), 1 / k), res);

// The five things, in a loose row across a spot on the sand (left to right as the camera
// comes: the film reel, the sand pails, the folded pages, the mooring buoy, the shoebox), a
// toy's size and a half. `at` [x, z] the spot; `right` and `toward` the level directions of
// the view's right and of the way back to the camera there. Returns the mesh and where each
// thing's ring goes (its middle), in the order the page names them: the film reel, the folded
// pages, the sand pails, the shoebox, the mooring buoy.
export function buildCargo(scene, at, right, toward, lod = 1, K = 1.45) {
  const m = new Mesh(true), rings = [null, null, null, null, null];
  const spot = (r, t) => { const x = at[0] + right[0] * r + toward[0] * t, z = at[1] + right[1] * r + toward[1] * t; return [x, groundY(x, z), z]; };
  const face = Math.atan2(toward[0], toward[1]);           // a yaw that turns +z toward the camera
  const sides = lod ? 18 : 12;
  const SILVER = L3(0.78, 0.8, 0.84), FILM = L3(0.3, 0.2, 0.15), HUB = L3(0.62, 0.64, 0.7);
  // the film reel, standing on its rim, a little turned; a strip of film trailing on the sand
  {
    const c = spot(-2.7, 0.3), R = 0.42, k0 = m.count;
    for (const zz of [-0.07, 0.07]) {
      const rim = [];
      for (let i = 0; i <= 26; i++) { const a = (i / 26) * TAU; rim.push([Math.cos(a) * R, Math.sin(a) * R, zz, 0.035]); }
      tube(m, rim, 6);
      for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU + 0.3; tube(m, [[Math.cos(a) * 0.09, Math.sin(a) * 0.09, zz, 0.032], [Math.cos(a) * R * 0.95, Math.sin(a) * R * 0.95, zz, 0.028]], 5); }
    }
    paint(m, k0, SILVER, 2);
    let k1 = m.count;
    lathe(m, 0, -0.1, 0, [[0.001, 0], [0.1, 0.0], [0.1, 0.2], [0.001, 0.2]], 12);
    put(m, k1, [0, 0, 0], 0, Math.PI / 2); paint(m, k1, HUB, 2);
    k1 = m.count;
    lathe(m, 0, -0.065, 0, [[0.1, 0], [0.27, 0.0], [0.27, 0.13], [0.1, 0.13]], sides);
    put(m, k1, [0, 0, 0], 0, Math.PI / 2); paint(m, k1, FILM, 1);
    put(m, k0, [c[0], c[1] + (R - 0.04) * K, c[2]], face + 0.45, 0, 0, K);
    rings[0] = new Vector3(c[0], c[1] + R * K, c[2]);
    // the strip: out from the bottom of the roll, flat over the sand, curling
    k1 = m.count;
    const strip = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12, r = -2.7 + 0.35 + t * 1.3, tt = 0.55 + Math.sin(t * 3.4) * 0.35; const p = spot(r, tt); strip.push([p[0], p[1] + 0.04 + 0.16 * Math.max(0, 1 - t * 3), p[2], 0.05]); }
    tube(m, strip, 4);
    for (let v = k1; v < m.count; v++) m.p[v * 3 + 1] = Math.max(m.p[v * 3 + 1], groundY(m.p[v * 3], m.p[v * 3 + 2]) + 0.01);
    paint(m, k1, FILM, 1);
  }
  // the folded pages: an open booklet of felt lying on the sand, its pages lifting
  {
    const c = spot(0, 0.8), k0 = m.count, W = 0.36, H = 0.5;
    // (a page rises from the spine as it goes out; the top one more)
    const pageY = (s, lift) => lift + Math.sin(s * Math.PI * 0.5) * 0.1 * (lift ? 1.4 : 1);
    for (const side of [-1, 1]) {
      for (const lift of [0, 0.035]) {
        const v0 = m.count;
        pillow(m, 4, 4, [0, 1, 0], 1, (s, t, o) => {
          o[0] = side * (0.02 + s * W); o[1] = pageY(s, lift); o[2] = (t - 0.5) * H;
          o[3] = 0.012 * plump(s * 0.8 + 0.1, t * 0.8 + 0.1, 0.9);
        });
        paint(m, v0, lift ? L3(0.99, 0.97, 0.92) : L3(0.93, 0.89, 0.8), 1);
      }
      // a few stitched lines of text on the top page
      for (let r = 0; r < 4; r++) {
        const v0 = m.count, z = -0.17 + r * 0.1, s0 = 0.15, s1 = 0.72 + (r % 2) * 0.14, pts = [];
        for (let k = 0; k <= 4; k++) { const sk = s0 + (s1 - s0) * (k / 4); pts.push([side * (0.02 + sk * W), pageY(sk, 0.035) + 0.016, z, 0.009]); }
        tube(m, pts, 4);
        paint(m, v0, L3(0.25, 0.3, 0.42), 1);
      }
    }
    put(m, k0, [c[0], c[1] + 0.02, c[2]], face + 0.25, 0.04, 0, K);
    rings[1] = new Vector3(c[0], c[1] + 0.22 * K, c[2]);
  }
  // the sand pails: two crochet buckets full of sand, one orange-red, one blue, with handles
  {
    for (const [r, t, col, yaw] of [[-1.62, -0.55, L3(0.95, 0.45, 0.2), 0.3], [-1.0, -0.95, L3(0.3, 0.55, 0.95), -0.4]]) {
      const c = spot(r, t), v0 = m.count;
      lathe(m, 0, 0, 0, [[0.001, 0], [0.19, 0.0], [0.205, 0.04], [0.25, 0.46], [0.27, 0.48], [0.265, 0.5]], sides);
      paint(m, v0, col, 0);
      const v1 = m.count;
      lathe(m, 0, 0, 0, [[0.265, 0.5], [0.2, 0.505], [0.001, 0.525]], sides);
      paint(m, v1, L3(0.92, 0.8, 0.58), 4);
      const v2 = m.count, hh = [];
      for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI; hh.push([Math.cos(a) * 0.26, 0.48 + Math.sin(a) * 0.2, 0, 0.014]); }
      tube(m, hh, 5);
      paint(m, v2, SILVER, 2);
      put(m, v0, [c[0], c[1] - 0.02, c[2]], face + yaw, 0.05, 0, K);
    }
    const c = spot(-1.31, -0.75);
    rings[2] = new Vector3(c[0], c[1] + 0.32 * K, c[2]);
  }
  // the shoebox: a felt box with its lid askew
  {
    const c = spot(2.7, -0.6), v0 = m.count;
    roundBox(m, 0.46, 0.17, 0.27, lod ? 7 : 5);
    for (let v = v0; v < m.count; v++) m.p[v * 3 + 1] += 0.17;
    paint(m, v0, L3(0.82, 0.62, 0.42), 1);
    const v1 = m.count;
    roundBox(m, 0.49, 0.045, 0.3, lod ? 6 : 4);
    put(m, v1, [0.05, 0.37, -0.05], 0.18, 0.0, -0.1);
    paint(m, v1, L3(0.7, 0.45, 0.3), 1);
    // a label stitched on its side
    const v2 = m.count;
    roundBox(m, 0.15, 0.06, 0.012, 4);
    put(m, v2, [0, 0.18, 0.272], 0);
    paint(m, v2, L3(0.97, 0.95, 0.9), 1);
    put(m, v0, [c[0], c[1] - 0.02, c[2]], face - 0.35, 0, 0, K);
    rings[3] = new Vector3(c[0], c[1] + 0.28 * K, c[2]);
  }
  // the mooring buoy: knitted, red and cream, on its side, with its rope and ring
  {
    const c = spot(1.35, 0.2), v0 = m.count;
    ball(m, 0, 0, 0, 0.36, 0.23, 0.23, lod ? 8 : 6, 0);
    for (let v = v0; v < m.count; v++) { const red = m.p[v * 3] > 0.02 || Math.abs(m.p[v * 3] + 0.13) < 0.04; m.a[v * 4] = red ? toLin(0.86) : toLin(0.95); m.a[v * 4 + 1] = red ? toLin(0.25) : toLin(0.9); m.a[v * 4 + 2] = red ? toLin(0.17) : toLin(0.8); m.a[v * 4 + 3] = 0; }
    const v1 = m.count;
    tube(m, [[0.34, 0, 0, 0.05], [0.42, 0, 0, 0.04]], 6);
    paint(m, v1, L3(0.86, 0.25, 0.17), 0);
    const v2 = m.count, loop = [];
    for (let i = 0; i <= 14; i++) { const a = (i / 14) * TAU; loop.push([0.5 + Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0, 0.016]); }
    tube(m, loop, 5);
    paint(m, v2, SILVER, 2);
    put(m, v0, [c[0], c[1] + 0.2 * K, c[2]], face + 1.9, 0, 0.12, K);
    // its rope, trailing away over the sand in a loose S
    const v3 = m.count, rp = [];
    const tip = [m.p[(v2 + 3) * 3], m.p[(v2 + 3) * 3 + 2]];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14, x = tip[0] + right[0] * t * 1.5 + toward[0] * (Math.sin(t * 5) * 0.3 + t * 0.4), z = tip[1] + right[1] * t * 1.5 + toward[1] * (Math.sin(t * 5) * 0.3 + t * 0.4);
      rp.push([x, groundY(x, z) + 0.05 + 0.18 * Math.max(0, 1 - t * 4), z, 0.042]);
    }
    tube(m, rp, 5);
    paint(m, v3, L3(0.82, 0.7, 0.52), 3);
    rings[4] = new Vector3(c[0], c[1] + 0.22 * K, c[2]);
  }
  const g = m.build();
  g.computeBoundingSphere();
  const mesh = new ThreeMesh(g, cargoMaterial());
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  scene.add(mesh);
  return { mesh, rings };
}

// ---- the sun's glint on the sand, under the visitor's hand ----------------------------------

// A warm glint of the caustics on the sand where the hand points (a soft patch about 150 px
// across on the screen): one flat card, laid on the sand there each frame, added to the light.
export function buildGlint(scene) {
  const k = uniform(0);
  const mat = material({
    additive: true, shadow: false,
    raw: (f) => {
      const q = f.obj.xy, r2 = dot(q, q).mul(4.0);
      const g = exp(r2.mul(-1.7)).mul(float(1.0).sub(smoothstep(0.75, 1.0, r2)));
      // (the sunlit sand is near white already: the glint is a net of caustic lines of its own,
      // drifting, in warm gold glitter far brighter than the sand round them, with a little haze)
      const t = G.time, pp = f.w.xz.mul(2.4).toVar();
      const a = sin(pp.x.add(sin(pp.y.mul(1.3).add(t.mul(1.1))).mul(1.2)).add(t.mul(0.7)));
      const b = sin(pp.y.mul(1.1).add(sin(pp.x.mul(0.9).sub(t.mul(0.9))).mul(1.3)).sub(t.mul(0.6)));
      const net = pow(float(1.0).sub(abs(a.mul(b))), 9.0);
      const col = vec3(1.0, 0.7, 0.34).mul(net.mul(5.5).add(0.45)).mul(g).mul(k).mul(exp(f.dist.mul(-0.04)));
      return { color: col, alpha: float(1.0) };
    },
  });
  mat.depthWrite = false;
  const mesh = new ThreeMesh(new PlaneGeometry(1, 1), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 3;
  scene.add(mesh);
  return { mesh, k };
}
