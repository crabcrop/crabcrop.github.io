// Snap's submarine, made in code, after the painted dive's own (sub.webp): a brass boat, its
// hull riveted plates tapering to a tail with four fins and a propeller, a short conning
// tower with its hatch, a periscope whose lamp is the visitor's light in the dark, a ballast
// tank slung underneath, a pincer arm under the bow, and in front the big glass bubble Snap
// sits in. Its own frame: forward is -z, up is +y, about 2.3 m from the glass to the tail.
import { Group, Mesh as ThreeMesh, Vector3 } from 'three/webgpu';
import { abs, cameraPosition, dot, float, max, min, mix, normalize, pow, select, smoothstep, uniform, varyingProperty, vec3 } from 'three/tsl';
import { Mesh, TAU, blob, lathe, tube } from './math.js';
import { G, detail, material, skyAt, sunAt } from './shaders.js';

// what each part is made of (aux.x): 0 brass, 1 dark brass (rivets, bands), 2 steel (the
// arm), 3 tan leather (the cabin behind the glass), 4 lamp glass, 5-7 the cabin's lights
const PAINT = [[0.96, 0.54, 0.19], [0.64, 0.33, 0.12], [0.52, 0.53, 0.55], [0.20, 0.09, 0.04], [1.0, 0.95, 0.85]];

const vLocal = varyingProperty('vec3', 'v_local');

function bodyMaterial(lamp) {
  return material({
    aux: true, shadow: false,
    vertex: (v) => { vLocal.assign(v.P); },
    surface: (s, f) => {
      const id = f.aux.x;
      const base = vec3(...PAINT[0]).toVar();
      for (let k = 1; k < PAINT.length; k++) base.assign(select(id.greaterThan(k - 0.5), vec3(...PAINT[k]), base));
      // old brass: uneven, tarnished darker and greener in the hollows, polished on the edges
      const D = detail(vLocal.mul(3.2), s.n, 1.0, 1.2);
      const tarnish = smoothstep(0.35, 0.75, D.m).mul(select(id.lessThan(1.5), float(1), float(0)));
      s.albedo = mix(base, base.mul(vec3(0.72, 0.66, 0.58)), tarnish.mul(0.5)).mul(D.h.mul(0.25).add(0.82));
      s.n = mix(s.n, D.n, 0.3).toVar();
      const metal = select(id.lessThan(2.5), float(1), float(0));
      s.spec = mix(float(0.2), float(1.1), metal).mul(float(1).sub(tarnish.mul(0.4)));
      s.gloss = mix(float(14.0), float(55.0), metal);
      s.fluor = float(0.08);
      // the lamp's glass glows when the lamp is on
      s.emis = vec3(1.0, 0.9, 0.72).mul(select(id.greaterThan(3.5).and(id.lessThan(4.5)), lamp.mul(10.0).add(0.8), float(0.0)));
      // the cabin's small lights behind Snap: red, amber, green
      s.emis = s.emis.add(select(id.greaterThan(4.5), select(id.lessThan(5.5), vec3(2.2, 0.25, 0.2), select(id.lessThan(6.5), vec3(2.2, 1.4, 0.3), vec3(0.3, 2.0, 0.6))), vec3(0.0)));
      // in the dark, the lamp's spill on the hull and a warm rim, so it still reads as brass
      const vv = normalize(cameraPosition.sub(f.w));
      s.emis = s.emis.add(s.albedo.mul(lamp.mul(0.09)).mul(pow(float(1).sub(abs(dot(s.n, vv))), 2.0).mul(2.0).add(0.5)));
      // (brass keeps a little of its own warmth in blue water, where the red has gone out of the light)
      s.emis = s.emis.add(s.albedo.mul(vec3(0.3, 0.12, 0.0)).mul(min(sunAt(f.w.y).g, 1.0)));
      // (and in the dark, where the lamp's spill alone would turn it copper, a little yellow of its own)
      s.emis = s.emis.add(s.albedo.mul(vec3(0.1, 0.075, 0.02)).mul(float(1).sub(min(sunAt(f.w.y).g, 1.0))).mul(select(id.lessThan(1.5), float(1), float(0))));
      // the cockpit behind Snap: dark leather, lit warm and low by its own small lights
      s.emis = s.emis.add(s.albedo.mul(select(id.greaterThan(2.5).and(id.lessThan(3.5)), float(0.95), float(0.0))));
      // polished: a warm brass sheen at grazing angles in any light, so it reads as metal
      // in the sunlit water and under the lamp alike
      const sheen = pow(float(1).sub(abs(dot(s.n, vv))), 3.0).mul(select(id.lessThan(1.5), float(1), float(0)));
      s.emis = s.emis.add(vec3(0.55, 0.32, 0.1).mul(sheen).mul(0.22));
    },
  });
}

// The glass: nearly clear face on, a bright rim of reflected water at the edges, the sun's
// highlight on top. Blended over Snap.
function glassMaterial() {
  return material({
    transparent: true, depthWrite: false, shadow: false, side: 0,
    raw: (f) => {
      const v = normalize(f.w.sub(cameraPosition));
      const nd = abs(dot(f.n, v));
      const fres = pow(float(1).sub(nd), 3.0).mul(0.9).add(0.08).toVar();
      // highlights that show the glass is round: the light from above in a soft broad streak
      // and a sharp one, and the lamp's own glare where the dome faces it
      const up = max(dot(f.n, normalize(vec3(-0.3, 1.0, 0.25))), 0.0);
      const sun = sunAt(f.w.y).mul(pow(max(dot(f.n, normalize(G.sunDir.sub(v))), 0.0), 120.0).mul(2.5).add(pow(up, 24.0).mul(0.5)));
      const toLamp = normalize(G.lampPos.sub(f.w));
      const glare = G.lampCol.rgb.mul(pow(max(dot(f.n, normalize(toLamp.sub(v))), 0.0), 60.0)).mul(0.5);
      // the rim mirrors the water around it: as bright as the light that is there, which in
      // the deep is only the lamp's; a faint green-blue tint all over, as thick glass has
      const lampOn = G.lampCol.rgb.mul(0.04);
      const rim = skyAt(f.w, f.n).mul(0.9).add(lampOn).add(vec3(0.05, 0.07, 0.065)).mul(fres);
      return { color: rim.add(sun).add(glare).add(vec3(0.02, 0.035, 0.032)), alpha: fres.add(0.1).min(0.92) };
    },
  });
}

// The lathe stands a profile along y; turn what it made (from vertex k on) to lie along z,
// with the profile's height running toward +z.
function lieAlongZ(m, k) {
  for (let i = k; i < m.count; i++) {
    const y = m.p[i * 3 + 1], z = m.p[i * 3 + 2]; m.p[i * 3 + 1] = -z; m.p[i * 3 + 2] = y;
    const ny = m.n[i * 3 + 1], nz = m.n[i * 3 + 2]; m.n[i * 3 + 1] = -nz; m.n[i * 3 + 2] = ny;
  }
}
// an ellipsoid's radius toward a unit direction, for blob(): semi-axes a, b, c
const ellipsoid = (a, b, c) => (x, y, z) => 1 / Math.sqrt((x / a) ** 2 + (y / b) ** 2 + (z / c) ** 2);

// the hull's radius at z (behind the collar), for placing rivets and the tower on it
const HULL = [[0.42, -0.02], [0.41, 0.04], [0.41, 0.5], [0.39, 0.62], [0.3, 0.88], [0.19, 1.08], [0.1, 1.22], [0.055, 1.3]];
const hullR = (z) => {
  for (let i = 1; i < HULL.length; i++) if (z <= HULL[i][1]) { const a = HULL[i - 1], b = HULL[i], t = (z - a[1]) / (b[1] - a[1]); return a[0] + (b[0] - a[0]) * t; }
  return HULL[HULL.length - 1][0];
};

export function buildSub(q) {
  const res = q.amount >= 1 ? 1 : q.amount >= 0.5 ? 0.75 : 0.55;
  const S = (n) => Math.max(6, Math.round(n * res));
  const m = new Mesh(true);
  const tag = (from, id) => { for (let i = from; i < m.count; i++) m.a[i * 4] = id; };
  let k = m.count;
  // the hull: a body of revolution along z, from the collar back to the propeller's hub
  lathe(m, 0, 0, 0, HULL.map(([r, z]) => [r, z]), S(30));
  lieAlongZ(m, k);
  tag(k, 0);
  // the back wall of the cabin, behind the glass: tan leather, with three small lights
  k = m.count;
  lathe(m, 0, 0, 0, [[0.0, -0.13], [0.22, -0.125], [0.44, -0.1]], S(28));
  lieAlongZ(m, k);
  tag(k, 3);
  for (const [x, y, id] of [[-0.13, -0.3, 5], [0.0, -0.32, 6], [0.13, -0.3, 7]]) { k = m.count; blob(m, x, y, -0.128, () => 0.016, 3); tag(k, id); }
  // the dials above the lights, small brass rims round dark faces
  k = m.count;
  for (const x of [-0.16, 0.0, 0.16]) tube(m, [[x, -0.17, -0.12, 0.045], [x, -0.17, -0.14, 0.045]], 10);
  tag(k, 1);
  // his seat's padded back behind him, and two levers by his claws with red knobs
  k = m.count;
  blob(m, 0, -0.16, -0.3, ellipsoid(0.21, 0.2, 0.055), S(5));
  tag(k, 3);
  k = m.count;
  for (const x of [-0.19, 0.19]) tube(m, [[x, -0.4, -0.3, 0.012], [x * 1.05, -0.22, -0.46, 0.011]], 6);
  tag(k, 2);
  for (const x of [-0.19, 0.19]) { k = m.count; blob(m, x * 1.05, -0.21, -0.47, () => 0.026, 3); tag(k, 5); }
  // the collar where the glass sits: a thick brass ring with a lip
  k = m.count;
  lathe(m, 0, 0, 0, [[0.43, -0.2], [0.5, -0.17], [0.52, -0.1], [0.5, -0.02], [0.43, 0.03]], S(34));
  lieAlongZ(m, k);
  tag(k, 0);
  // raised bands where the plates meet, each with a row of rivets
  k = m.count;
  for (const z of [0.26, 0.6]) {
    const r = hullR(z) + 0.012;
    lathe(m, 0, 0, 0, [[r - 0.012, z - 0.03], [r, z - 0.022], [r, z + 0.022], [r - 0.012, z + 0.03]], S(30));
  }
  lieAlongZ(m, k);
  tag(k, 1);
  k = m.count;
  const rivets = res >= 1 ? 22 : res >= 0.75 ? 16 : 0;
  for (const z of [-0.12, 0.26, 0.6]) {
    const r = z < 0 ? 0.52 : hullR(z) + 0.022;
    for (let i = 0; i < rivets; i++) {
      const a = (i / rivets) * TAU;
      blob(m, Math.cos(a) * r, Math.sin(a) * r, z + (z < 0 ? 0 : 0.0), () => 0.014, 2);
    }
  }
  // and a seam along each side, riveted
  for (const sx of [-1, 1]) for (let i = 0; i < (rivets ? 7 : 0); i++) {
    const z = 0.05 + i * 0.075, r = hullR(z) + 0.004;
    blob(m, sx * r, 0, z, () => 0.013, 2);
  }
  tag(k, 1);
  // the conning tower: a short brass drum on top, its flange, and the hatch lid
  k = m.count;
  tube(m, [[0, 0.3, 0.3, 0.17], [0, 0.4, 0.3, 0.16], [0, 0.6, 0.3, 0.16]], S(18));
  blob(m, 0, 0.6, 0.3, ellipsoid(0.17, 0.035, 0.17), S(4));
  tag(k, 0);
  k = m.count;
  tube(m, [[0, 0.39, 0.3, 0.185], [0, 0.42, 0.3, 0.185]], S(18));
  blob(m, 0, 0.64, 0.3, ellipsoid(0.13, 0.025, 0.13), S(4));
  tube(m, [[-0.05, 0.665, 0.3, 0.012], [0, 0.69, 0.3, 0.014], [0.05, 0.665, 0.3, 0.012]], 5);
  tag(k, 1);
  // the periscope: a pipe up from the front of the tower, and the lamp on it facing ahead
  k = m.count;
  tube(m, [[0, 0.5, 0.16, 0.028], [0, 0.82, 0.16, 0.028], [0, 0.86, 0.12, 0.03]], 7);
  tube(m, [[0, 0.88, 0.2, 0.07], [0, 0.88, 0.04, 0.075], [0, 0.88, -0.04, 0.08]], S(14));
  tag(k, 0);
  k = m.count;
  blob(m, 0, 0.88, -0.045, (x, y, z) => (z < 0 ? 0.072 : 0.01), S(5));
  tag(k, 4);
  // four fins at the tail, in a cross, rounded like a toy's
  k = m.count;
  for (const [fx, fy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const r = hullR(1.02);
    blob(m, fx * (r + 0.12), fy * (r + 0.12), 1.05, fx ? ellipsoid(0.17, 0.022, 0.15) : ellipsoid(0.022, 0.17, 0.15), S(5));
  }
  tag(k, 0);
  // the ballast tank slung underneath, on two straps
  k = m.count;
  tube(m, [[0, -0.56, -0.02, 0.13], [0, -0.56, 0.2, 0.14], [0, -0.56, 0.5, 0.14], [0, -0.56, 0.7, 0.12]], S(16));
  blob(m, 0, -0.56, -0.02, (x, y, z) => (z < 0 ? 0.13 : 0.02), S(5));
  blob(m, 0, -0.56, 0.7, (x, y, z) => (z > 0 ? 0.12 : 0.02), S(5));
  tag(k, 0);
  k = m.count;
  for (const z of [0.12, 0.55]) tube(m, [[0, -0.36, z, 0.03], [0, -0.44, z, 0.03]], 6);
  tag(k, 1);
  // the pincer arm under the bow: two steel links and a two-fingered claw
  k = m.count;
  tube(m, [[0.0, -0.36, -0.08, 0.035], [0.0, -0.58, -0.32, 0.03]], 7);
  tube(m, [[0.0, -0.58, -0.32, 0.028], [0.0, -0.62, -0.62, 0.026]], 7);
  for (const s of [-1, 1]) tube(m, [[0, -0.62, -0.62, 0.02], [s * 0.06, -0.66, -0.72, 0.018], [s * 0.03, -0.7, -0.8, 0.014]], 6);
  blob(m, 0.0, -0.58, -0.32, () => 0.045, 3);
  blob(m, 0.0, -0.62, -0.62, () => 0.04, 3);
  tag(k, 2);
  const lamp = uniform(0);                    // how bright the lamp is, 0 to 1
  const mat = bodyMaterial(lamp);
  const body = new ThreeMesh(m.build(), mat);

  // the propeller: four blades on a hub, turning about z
  const pm = new Mesh(true);
  blob(pm, 0, 0, 0, (x, y, z) => 0.065 * (z > 0 ? 1 - z * 0.3 : 1), 4);
  for (let b = 0; b < 4; b++) {
    const a = (b / 4) * TAU + 0.4, c = Math.cos(a), si = Math.sin(a);
    tube(pm, [[c * 0.05, si * 0.05, 0, 0.03], [c * 0.13, si * 0.13, 0.025, 0.06], [c * 0.21, si * 0.21, 0.035, 0.04]], 5);
  }
  for (let i = 0; i < pm.count; i++) pm.a[i * 4] = 0;
  const prop = new ThreeMesh(pm.build(), mat);
  prop.position.set(0, 0, 1.33);

  // the glass bubble in front of the collar
  const gm = new Mesh(false);
  blob(gm, 0, 0, -0.6, () => 0.47, S(14));
  const glass = new ThreeMesh(gm.build(), glassMaterial());
  glass.renderOrder = 6;

  // a soft glow round the lamp, from any side: a ball that is bright where it faces the eye
  const halo = material({
    additive: true, shadow: false,
    raw: (f) => {
      const v = normalize(cameraPosition.sub(f.w));
      const c = pow(max(dot(f.n, v), 0.0), 7.0);
      return { color: vec3(1.0, 0.86, 0.62).mul(c).mul(lamp.mul(lamp)).mul(0.9), alpha: float(1.0) };
    },
  });
  const hm = new Mesh(false);
  blob(hm, 0, 0, 0, () => 0.16, 6);
  const h = new ThreeMesh(hm.build(), halo);
  h.position.set(0, 0.88, -0.07);
  h.renderOrder = 7;
  const group = new Group();
  for (const o of [body, prop, glass, h]) { o.frustumCulled = false; group.add(o); }
  return {
    group, prop, lamp,
    seat: new Vector3(0, -0.12, -0.6),          // where Snap's middle goes
    lampAt: new Vector3(0, 0.88, -0.14),        // the periscope's lamp
    turn(dt, thrust) { prop.rotation.z += dt * (2 + 14 * thrust); },
  };
}
