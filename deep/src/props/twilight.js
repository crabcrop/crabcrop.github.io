// The twilight's lost fish (zone s5, src/zones/s5.js): a tiny crocheted puffer, orange with a
// cream belly as the one in the painted dive's fish sheet, little bobbles all over it, peach felt
// fins and tail, glossy bead eyes in rings of white felt, a stitched smile and pink felt cheeks.
// Worked in Snap's yarn. In the dark it is a dim blue-grey shape until the visitor's light finds
// it (lit: 0 to 1); then its own colours come up, warm, as if the light stayed on it.
// Its frame: nose toward +z, back up; about 0.24 m from the nose to the tip of the tail.
// And the visitor's light as it is seen in the water: a soft beam from the submarine's lamp.
import { Mesh as ThreeMesh } from 'three/webgpu';
import { abs, cameraPosition, clamp, dot, exp, float, length, max, mix, normalize, pow, select, sin, smoothstep, uniform, vec2, vec3 } from 'three/tsl';
import { Mesh, TAU, blob } from '../math.js';
import { G, SIG, material, yarn } from '../shaders.js';

const lin = (r, g, b) => vec3(r ** 2.2, g ** 2.2, b ** 2.2);
// an egg's radius toward a unit direction (semi-axes a, b, and c in front and behind), and the
// same turned about y by `turn`
const egg = (a, b, cf, cb) => (x, y, z) => 1 / Math.sqrt((x / a) ** 2 + (y / b) ** 2 + (z / (z > 0 ? cf : cb)) ** 2);
const ell = (a, b, c, turn = 0) => (x, y, z) => {
  const co = Math.cos(turn), si = Math.sin(turn), u = co * x - si * z, w = si * x + co * z;
  return 1 / Math.sqrt((u / a) ** 2 + (y / b) ** 2 + (w / c) ** 2);
};
// the body: a round puffer, a little fuller at the head
const BODY = egg(0.084, 0.079, 0.1, 0.088);
// a point on the body's surface toward (x, y, z), pushed out by k of its radius
const onBody = (x, y, z, k = 1) => { const l = Math.hypot(x, y, z), r = BODY(x / l, y / l, z / l) * k; return [(x / l) * r, (y / l) * r, (z / l) * r]; };
// the eyes: set wide on the face, half sunk; [x (each side), y, z, radius]
const EYE_R = 0.019, EYE = (() => { const e = onBody(0.058, 0.03, 0.07, 0.985); return [e[0], e[1], e[2], EYE_R]; })();
// parts (aux.x): 0 yarn, 1 felt (fins, tail), 2 bead eyes
const part = (k) => (x, y, z, o) => { o[0] = k; o[1] = 0; o[2] = 0; o[3] = 0; };

function fishShape() {
  const m = new Mesh(true);
  blob(m, 0, 0, 0, BODY, 11, part(0));
  // bobbles all over, as the painted puffer's little spikes (none on the face or round the eyes)
  const n = 34, ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * ga;
    const d = [Math.cos(a) * r, y, Math.sin(a) * r];
    if (d[2] > 0.55 && Math.abs(d[1]) < 0.55) continue;                     // the face
    if (d[2] < -0.86) continue;                                              // where the tail goes
    const c = onBody(d[0], d[1], d[2], 0.99);
    if (Math.hypot(Math.abs(c[0]) - EYE[0], c[1] - EYE[1], c[2] - EYE[2]) < EYE_R * 2.4) continue;
    blob(m, c[0], c[1], c[2], ell(0.0105, 0.0105, 0.0105), 2, part(0));
  }
  // the tail: a fat felt fan with a soft notch (two lobes); the fin on its back; a fin each side
  blob(m, 0, 0.022, -0.112, ell(0.011, 0.034, 0.03), 4, part(1));
  blob(m, 0, -0.02, -0.112, ell(0.011, 0.032, 0.028), 4, part(1));
  blob(m, 0, 0.074, -0.03, ell(0.009, 0.026, 0.034), 3, part(1));
  for (const s of [-1, 1]) blob(m, s * 0.084, -0.014, 0.004, ell(0.009, 0.022, 0.03, s * 0.55), 3, part(1));
  // the bead eyes
  for (const s of [-1, 1]) blob(m, s * EYE[0], EYE[1], EYE[2], () => EYE_R, 4, part(2));
  return m.build();
}

// The fish: { mesh, lit, swim } (lit: 0 dim in the dark, 1 its own colours; swim: how hard its
// tail beats, 0 to 1).
export function buildLostFish() {
  const lit = uniform(0), swim = uniform(0.3);
  const ORANGE = lin(0.9, 0.47, 0.16), CREAM = lin(0.96, 0.88, 0.74), PEACH = lin(0.97, 0.76, 0.58);
  const FELT = lin(0.97, 0.95, 0.9), INK = lin(0.07, 0.035, 0.04), BLUSH = lin(0.98, 0.55, 0.6);
  const mat = material({
    aux: true, shadow: false,
    vertex(v) {
      // the tail beats, the body swings a little against it, the fins paddle
      const z = v.P.z, t = G.time;
      const tail = float(1.0).sub(smoothstep(-0.13, 0.0, z)), beat = sin(t.mul(swim.mul(7.0).add(5.0)).add(z.mul(9.0)));
      const sway = beat.mul(tail.mul(tail).mul(0.03)).add(sin(t.mul(swim.mul(7.0).add(5.0)).sub(1.2)).mul(0.004)).mul(swim.mul(0.7).add(0.3));
      const fin = select(v.aux.x.greaterThan(0.5).and(v.aux.x.lessThan(1.5)).and(abs(v.P.x).greaterThan(0.06)), float(1.0), float(0.0));
      v.P.assign(vec3(v.P.x.add(sway), v.P.y.add(sin(t.mul(8.0)).mul(0.006).mul(fin)), v.P.z));
    },
    surface(s, f) {
      const q = f.obj, id = f.aux.x, n0 = s.n;
      const felt = id.greaterThan(0.5).and(id.lessThan(1.5)), bead = id.greaterThan(1.5);
      // orange above, cream below, along a gently wavy line round its middle
      const belly = float(1.0).sub(smoothstep(-0.014, -0.004, q.y.add(sin(q.z.mul(70.0)).mul(0.004))));
      yarn(s, f, { color: mix(ORANGE, CREAM, belly), scale: 85, p: q, k: 1.25 });
      // felt fins: smooth, matted
      s.albedo = select(felt, PEACH, s.albedo);
      s.n = select(felt.or(bead), n0, s.n);
      // the felt rings round the eyes, and the eyes' glossy beads with a catch light
      const ex = EYE[0], ey = EYE[1], ez = EYE[2], er = EYE[3];
      const de = length(vec3(abs(q.x).sub(ex), q.y.sub(ey), q.z.sub(ez)));
      const ring = float(1.0).sub(smoothstep(er * 1.7, er * 1.85, de)).mul(select(bead, float(0.0), float(1.0)));
      s.albedo = mix(s.albedo, FELT, ring);
      s.n = normalize(mix(s.n, n0, ring.mul(0.8)));
      s.albedo = select(bead, vec3(0.008, 0.008, 0.011), s.albedo);
      s.spec = select(bead, float(1.4), s.spec); s.gloss = select(bead, float(90.0), s.gloss);
      s.fluor = select(bead, float(0.0), s.fluor); s.trans = select(bead, float(0.0), s.trans);
      const eyeN = normalize(vec3(abs(q.x).sub(ex), q.y.sub(ey), q.z.sub(ez)));
      const catchLight = smoothstep(0.86, 0.95, dot(eyeN, normalize(vec3(0.35, 0.72, 0.6)))).mul(select(bead, float(1.0), float(0.0)));
      // the stitched smile under the eyes, and pink felt cheeks beside it
      const face = smoothstep(0.075, 0.09, q.z).mul(select(felt.or(bead), float(0.0), float(1.0)));
      const u = clamp(q.x.div(0.022), -1.0, 1.0);
      const smile = float(1.0).sub(smoothstep(0.0028, 0.0042, length(vec2(max(abs(q.x).sub(0.022), 0.0), abs(q.y.add(0.011).sub(u.mul(u).mul(0.008))))))).mul(face);
      const cheek = float(1.0).sub(smoothstep(0.009, 0.0115, length(vec2(abs(q.x).sub(0.04), q.y.add(0.004))))).mul(face).mul(float(1.0).sub(ring));
      s.albedo = mix(mix(s.albedo, BLUSH, cheek.mul(0.85)), INK, smile);
      s.n = normalize(mix(s.n, n0, max(smile, cheek).mul(0.6)));
      // in the dark: a dim blue-grey until the light finds it, then its own colours, warm
      const lum = dot(s.albedo, vec3(0.3, 0.55, 0.15));
      const vv = normalize(cameraPosition.sub(f.w)), rim = pow(float(1.0).sub(abs(dot(n0, vv))), 2.0);
      const dim = vec3(0.28, 0.34, 0.5).mul(lum.mul(0.35).add(0.02)).mul(rim.mul(1.4).add(0.35));
      const glow = s.albedo.mul(vec3(1.05, 1.0, 0.92)).mul(rim.mul(0.35).add(0.5));
      s.emis = s.emis.add(mix(dim, glow, lit)).add(vec3(0.9).mul(catchLight).mul(lit.mul(0.7).add(0.3)));
    },
  });
  const mesh = new ThreeMesh(fishShape(), mat);
  mesh.visible = false;
  return { mesh, lit, swim };
}

// The beam: the lamp's light in the water, as a soft cone from the lamp along where it is aimed
// (the engine's shafts carry a faint one; down here the visitor must see where their light goes).
// A cone one metre long and one wide at its end along +z, scaled to the beam each frame; brightest
// near the lamp and along its middle as seen, gone at its end and its edges. on: 0 to 1.
export function buildBeam() {
  const on = uniform(0);
  const m = new Mesh(false), SIDES = 28, RINGS = 8;
  m.grid(SIDES, RINGS, (s, t, o) => { const a = s * TAU, r = 0.02 + t * 0.98; o[0] = Math.cos(a) * r; o[1] = Math.sin(a) * r; o[2] = t; }, true);
  const mat = material({
    additive: true, twoSided: true, depthWrite: false, shadow: false,
    raw: (f) => {
      const along = f.obj.z;
      const v = normalize(cameraPosition.sub(f.w));
      const face = pow(abs(dot(f.n, v)), 1.6);
      const k = smoothstep(0.0, 0.07, along).mul(pow(float(1.0).sub(along), 1.8)).mul(face).mul(exp(SIG.mul(f.dist).negate()));
      return { color: vec3(1.0, 0.9, 0.72).mul(G.lampCol.rgb).mul(k).mul(on).mul(0.075), alpha: float(1.0) };
    },
  });
  const mesh = new ThreeMesh(m.build(), mat);
  mesh.visible = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return { mesh, on };
}
