// The agent's little submarine in the vents (zone s6, src/zones/s6.js): "the other little
// submarine down here", as in the painted dive's picture of the vents. Smaller and older than
// Snap's, in darker brass: its cabin a glass capsule between two thick brass bands, a strap over
// it, a fat tower with a lid on top, a lamp on a post at the front, a pontoon slung under it with
// two steel claws reaching forward, a propeller in a ring at the back. Nobody sits inside: the
// agent is a small light in the cabin that thinks (it brightens as it calls a tool: talk).
// Its frame: forward is -z, up is +y; about 1 m from the claws to the propeller.
import { Group, Mesh as ThreeMesh, Vector3 } from 'three/webgpu';
import { abs, cameraPosition, cos, dot, float, max, min, mix, normalize, pow, select, sin, smoothstep, uniform, vec3 } from 'three/tsl';
import { Mesh, TAU, blob, lathe, tube } from '../math.js';
import { G, detail, material, skyAt, sunAt } from '../shaders.js';

// what each part is made of (aux.x): 0 brass, 1 dark brass, 2 steel, 3 red leather, 4 the lamp's
// glass, 5 the agent's light, 6 the propeller (brass, turning)
const PAINT = [[0.8, 0.52, 0.2], [0.5, 0.3, 0.11], [0.56, 0.58, 0.6], [0.36, 0.05, 0.04], [1.0, 0.95, 0.85], [0.35, 1.0, 0.92], [0.8, 0.52, 0.2]];
const ell = (a, b, c) => (x, y, z) => 1 / Math.sqrt((x / a) ** 2 + (y / b) ** 2 + (z / c) ** 2);
// a ring round the z axis (or a line along z at height cy): at z, radius r, thickness th
const ringZ = (m, z, r, th, n = 28, cy = 0) => { const pts = []; for (let i = 0; i <= n; i++) { const a = (i / n) * TAU; pts.push([Math.cos(a) * r, cy + Math.sin(a) * r, z, th]); } tube(m, pts, 6); };
// the lathe stands a profile along y: turn what it made (from vertex k on) to lie along z
function lieAlongZ(m, k) {
  for (let i = k; i < m.count; i++) {
    const y = m.p[i * 3 + 1], z = m.p[i * 3 + 2]; m.p[i * 3 + 1] = -z; m.p[i * 3 + 2] = y;
    const ny = m.n[i * 3 + 1], nz = m.n[i * 3 + 2]; m.n[i * 3 + 1] = -nz; m.n[i * 3 + 2] = ny;
  }
}
const HUB = 0.37;            // where the propeller turns, on z

function agentShape() {
  const m = new Mesh(true);
  const tag = (from, id) => { for (let i = from; i < m.count; i++) { m.a[i * 4] = id; m.a[i * 4 + 1] = 0; m.a[i * 4 + 2] = 0; m.a[i * 4 + 3] = 0; } };
  let k = m.count;
  // the bands round the glass: a thick one at the front, a wider one at the back, and the back's
  // brass cap, a low dome
  ringZ(m, -0.25, 0.2, 0.03); ringZ(m, 0.135, 0.205, 0.036);
  tag(k, 0);
  k = m.count;
  lathe(m, 0, 0, 0, [[0.205, 0.13], [0.2, 0.18], [0.17, 0.24], [0.11, 0.285], [0.05, 0.305], [0.0, 0.31]], 22);
  lieAlongZ(m, k);
  tag(k, 0);
  // a strap over the glass from band to band, and the bolts where the bands meet the strap and the sides
  k = m.count;
  tube(m, [[0, 0.21, -0.25, 0.022], [0, 0.228, -0.12, 0.022], [0, 0.23, 0.0, 0.022], [0, 0.222, 0.135, 0.022]], 6);
  for (const s of [-1, 1]) blob(m, s * 0.215, 0, -0.25, () => 0.032, 3);
  for (const s of [-1, 1]) blob(m, s * 0.225, 0, 0.135, () => 0.026, 3);
  tag(k, 1);
  // the tower: a fat drum with a lid
  k = m.count;
  lathe(m, 0, 0, -0.02, [[0.072, 0.17], [0.078, 0.2], [0.078, 0.3], [0.088, 0.31], [0.088, 0.335], [0.06, 0.345], [0.0, 0.35]], 18);
  tag(k, 0);
  k = m.count;
  tube(m, [[-0.035, 0.352, -0.02, 0.009], [0, 0.366, -0.02, 0.01], [0.035, 0.352, -0.02, 0.009]], 5);
  tag(k, 1);
  // the lamp on its post at the front of the strap
  k = m.count;
  tube(m, [[0, 0.215, -0.22, 0.014], [0, 0.27, -0.25, 0.014], [0, 0.29, -0.27, 0.014]], 5);
  blob(m, 0, 0.3, -0.27, ell(0.04, 0.04, 0.045), 4);
  tag(k, 1);
  k = m.count;
  blob(m, 0, 0.3, -0.305, ell(0.03, 0.03, 0.016), 3);
  tag(k, 4);
  // the pontoon slung under it, on two short struts, banded
  k = m.count;
  tube(m, [[0, -0.27, -0.27, 0.055], [0, -0.27, -0.2, 0.066], [0, -0.27, 0.14, 0.066], [0, -0.27, 0.24, 0.05]], 14);
  blob(m, 0, -0.27, -0.28, ell(0.055, 0.055, 0.04), 4);
  tag(k, 0);
  k = m.count;
  for (const z of [-0.14, 0.08]) { tube(m, [[0, -0.21, z, 0.024], [0, -0.17, z, 0.024]], 6); ringZ(m, z, 0.068, 0.012, 16, -0.27); }
  tag(k, 1);
  // two steel arms from the pontoon's nose, each with a two-fingered claw
  k = m.count;
  for (const s of [-1, 1]) {
    const x = s * 0.06;
    tube(m, [[x * 0.6, -0.28, -0.3, 0.019], [x * 1.3, -0.31, -0.4, 0.017], [x * 1.25, -0.335, -0.48, 0.016]], 6);
    blob(m, x * 1.25, -0.335, -0.48, () => 0.024, 3);
    tube(m, [[x * 1.25, -0.33, -0.49, 0.012], [x * 1.25, -0.305, -0.54, 0.011], [x * 1.2, -0.315, -0.585, 0.009]], 5);
    tube(m, [[x * 1.25, -0.345, -0.49, 0.012], [x * 1.25, -0.37, -0.54, 0.011], [x * 1.2, -0.36, -0.585, 0.009]], 5);
  }
  tag(k, 2);
  // the propeller's ring on a strut behind the cap, and the propeller in it
  k = m.count;
  ringZ(m, HUB, 0.115, 0.016, 28);
  tube(m, [[0, 0.09, 0.27, 0.016], [0, 0.115, HUB, 0.014]], 5);
  tube(m, [[0, 0, 0.3, 0.02], [0, 0, HUB, 0.018]], 5);
  tag(k, 1);
  k = m.count;
  blob(m, 0, 0, HUB, ell(0.032, 0.032, 0.04), 3);
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * TAU + 0.3, c = Math.cos(a), s = Math.sin(a);
    tube(m, [[c * 0.03, s * 0.03, HUB, 0.016], [c * 0.065, s * 0.065, HUB + 0.006, 0.026], [c * 0.095, s * 0.095, HUB + 0.01, 0.016]], 5);
  }
  tag(k, 6);
  // inside the glass: a red seat, and on a little brass stand where a pilot would sit, the agent
  k = m.count;
  blob(m, 0, -0.09, 0.06, ell(0.13, 0.08, 0.06), 5);
  blob(m, 0, -0.03, 0.1, ell(0.12, 0.11, 0.035), 5);
  tag(k, 3);
  k = m.count;
  tube(m, [[0, -0.18, -0.1, 0.03], [0, -0.1, -0.1, 0.022], [0, -0.07, -0.1, 0.03]], 8);
  tag(k, 1);
  k = m.count;
  blob(m, 0, -0.0, -0.1, () => 0.065, 5);
  tag(k, 5);
  return m.build();
}

// the glass capsule: a round front, the cylinder back to the rear band (the cap closes it)
function glassShape() {
  const m = new Mesh(false), prof = [];
  for (let i = 0; i <= 7; i++) { const a = (i / 7) * Math.PI * 0.5; prof.push([0.19 * Math.sin(a), -0.25 - 0.19 * Math.cos(a)]); }
  prof.push([0.19, -0.1], [0.19, 0.05], [0.19, 0.14]);
  lathe(m, 0, 0, 0, prof, 24);
  lieAlongZ(m, 0);
  return m.build();
}

function bodyMaterial(talk) {
  return material({
    aux: true, shadow: false,
    vertex(v) {
      // the propeller turns about z
      const a = G.time.mul(9.0), c = cos(a), s = sin(a), prop = v.aux.x.greaterThan(5.5);
      v.P.assign(select(prop, vec3(v.P.x.mul(c).sub(v.P.y.mul(s)), v.P.x.mul(s).add(v.P.y.mul(c)), v.P.z), v.P));
      v.N.assign(select(prop, vec3(v.N.x.mul(c).sub(v.N.y.mul(s)), v.N.x.mul(s).add(v.N.y.mul(c)), v.N.z), v.N));
    },
    surface(s, f) {
      const id = f.aux.x;
      const base = vec3(...PAINT[0]).toVar();
      for (let k = 1; k < PAINT.length; k++) base.assign(select(id.greaterThan(k - 0.5), vec3(...PAINT[k]), base));
      const metal = select(id.lessThan(2.5).or(id.greaterThan(5.5)), float(1), float(0));
      // old brass: tarnished darker and greener in the hollows, polished on the edges
      const D = detail(f.obj.mul(3.0), s.n, 1.0, 1.2);
      const tarnish = smoothstep(0.3, 0.72, D.m).mul(metal);
      s.albedo = mix(base, base.mul(vec3(0.6, 0.62, 0.5)), tarnish.mul(0.55)).mul(D.h.mul(0.25).add(0.82));
      s.n = mix(s.n, D.n, 0.3).toVar();
      s.spec = mix(float(0.15), float(1.0), metal).mul(float(1).sub(tarnish.mul(0.4)));
      s.gloss = mix(float(12.0), float(48.0), metal);
      s.fluor = float(0.1);
      // the lamp's glass glows warm; the agent's light, sea-glass, brighter while it talks
      s.emis = vec3(1.0, 0.9, 0.7).mul(select(id.greaterThan(3.5).and(id.lessThan(4.5)), float(5.0), float(0.0)));
      s.emis = s.emis.add(vec3(0.3, 1.0, 0.9).mul(select(id.greaterThan(4.5).and(id.lessThan(5.5)), talk.mul(5.0).add(1.4), float(0.0))));
      // down here it reads as brass by a little warmth of its own and a sheen at its edges
      const vv = normalize(cameraPosition.sub(f.w));
      const edge = pow(float(1).sub(abs(dot(s.n, vv))), 2.5);
      const dark = float(1).sub(min(sunAt(f.w.y).g, 1.0));
      s.emis = s.emis.add(s.albedo.mul(vec3(0.16, 0.11, 0.05)).mul(dark).mul(edge.mul(1.5).add(0.5)));
      // (the seat lit by the agent's light beside it)
      s.emis = s.emis.add(s.albedo.mul(select(id.greaterThan(2.5).and(id.lessThan(3.5)), talk.mul(0.6).add(0.5), float(0.0))));
    },
  });
}

function glassMaterial(talk) {
  return material({
    transparent: true, depthWrite: false, shadow: false,
    raw: (f) => {
      const v = normalize(f.w.sub(cameraPosition));
      const nd = abs(dot(f.n, v));
      const fres = pow(float(1).sub(nd), 3.0).mul(0.85).add(0.07).toVar();
      const up = max(dot(f.n, normalize(vec3(-0.3, 1.0, 0.25))), 0.0);
      const sun = sunAt(f.w.y).mul(pow(up, 24.0).mul(0.5));
      // the rim mirrors the water, and the warm vents and the agent's light inside tint it
      const rim = skyAt(f.w, f.n).mul(0.9).add(vec3(0.07, 0.08, 0.075)).add(vec3(0.05, 0.16, 0.15).mul(talk.add(0.3))).mul(fres);
      const glint = pow(max(dot(f.n, normalize(vec3(-0.2, 0.9, 0.4).sub(v))), 0.0), 50.0).mul(0.35);
      return { color: rim.add(sun).add(vec3(glint)).add(vec3(0.02, 0.035, 0.032)), alpha: fres.add(0.08).min(0.9) };
    },
  });
}

// The agent's submarine: { group, talk (0..1: its light brightens), dome (where it speaks from,
// in its own frame: just over the front of its glass) }.
export function buildAgent() {
  const talk = uniform(0);
  const body = new ThreeMesh(agentShape(), bodyMaterial(talk));
  const glass = new ThreeMesh(glassShape(), glassMaterial(talk));
  glass.renderOrder = 5;
  const group = new Group();
  group.add(body, glass);
  group.scale.setScalar(1.4);
  group.visible = false;
  return { group, talk, dome: new Vector3(0, 0.22, -0.3) };
}
