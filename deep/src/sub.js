// Snap's submarine, made in code: a glass bubble he sits in, a cream hull behind it with
// a coral collar, side thrusters, skids, a shrouded propeller, and the headlamp that is the
// visitor's lamp in the dark. Its own frame: forward is -z, up is +y, about 1.9 m long.
import { Group, Mesh as ThreeMesh, Vector3 } from 'three/webgpu';
import { abs, cameraPosition, dot, float, max, mix, normalize, pow, select, smoothstep, uniform, varyingProperty, vec3 } from 'three/tsl';
import { Mesh, TAU, blob, lathe, tube } from './math.js';
import { G, detail, material, skyAt, sunAt } from './shaders.js';

// what each part is made of (aux.x): 0 cream paint, 1 coral paint, 2 dark metal, 3 brass, 4 lamp glass
const PAINT = [[0.80, 0.77, 0.68], [0.78, 0.18, 0.12], [0.07, 0.075, 0.08], [0.62, 0.45, 0.20], [1.0, 0.95, 0.85]];

const vLocal = varyingProperty('vec3', 'v_local');

function bodyMaterial(lamp) {
  return material({
    aux: true, shadow: false,
    vertex: (v) => { vLocal.assign(v.P); },
    surface: (s, f) => {
      const id = f.aux.x;
      const base = vec3(...PAINT[0]).toVar();
      for (let k = 1; k < PAINT.length; k++) base.assign(select(id.greaterThan(k - 0.5), vec3(...PAINT[k]), base));
      // wear: the paint is a little uneven, darker in the seams, chipped at the edges
      const D = detail(vLocal.mul(3.0), s.n, 1.0, 1.2);
      s.albedo = base.mul(D.h.mul(0.25).add(0.8)).mul(D.m.mul(0.15).add(0.9));
      s.n = mix(s.n, D.n, 0.25).toVar();
      s.spec = mix(float(0.35), float(0.9), smoothstep(1.5, 3.0, id));
      s.gloss = mix(float(40.0), float(70.0), smoothstep(1.5, 3.0, id));
      s.fluor = select(id.greaterThan(0.5).and(id.lessThan(1.5)), float(0.5), float(0.1));
      // the lamp's glass glows when the lamp is on
      s.emis = vec3(1.0, 0.92, 0.78).mul(lamp).mul(select(id.greaterThan(3.5), float(4.0), float(0.0)));
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
      const fres = pow(float(1).sub(nd), 4.0).mul(0.85).add(0.06);
      const sun = sunAt(f.w.y).mul(pow(max(dot(f.n, normalize(G.sunDir.sub(v))), 0.0), 120.0)).mul(2.5);
      // the rim mirrors the water around it: as bright as the light that is there, which in
      // the deep is only the lamp's
      const lampOn = G.lampCol.rgb.mul(0.04);
      const rim = skyAt(f.w, f.n).mul(0.9).add(lampOn).mul(fres);
      return { color: rim.add(sun).add(lampOn.mul(0.2)), alpha: fres.add(0.04).min(0.9) };
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

export function buildSub(q) {
  const res = q.amount >= 1 ? 1 : q.amount >= 0.5 ? 0.75 : 0.55;
  const S = (n) => Math.max(6, Math.round(n * res));
  const m = new Mesh(true);
  const tag = (from, id) => { for (let i = from; i < m.count; i++) m.a[i * 4] = id; };
  let k = m.count;
  // the hull: a body of revolution along z, from the collar back to the propeller hub
  const hull = [[0.05, 1.02], [0.16, 0.98], [0.27, 0.86], [0.34, 0.6], [0.37, 0.3], [0.37, 0.05], [0.38, -0.08], [0.41, -0.1]];
  lathe(m, 0, 0, 0, hull.map(([r, z]) => [r, z]), S(28));
  // (lathe stands the profile along y: turn it to lie along z)
  lieAlongZ(m, k);
  tag(k, 0);
  // the bulkhead behind the glass, dark, closing the hull's front
  k = m.count;
  lathe(m, 0, 0, 0, [[0.0, -0.13], [0.2, -0.125], [0.41, -0.1]], S(28));
  lieAlongZ(m, k);
  tag(k, 2);
  // the coral collar where the glass sits, and a coral band toward the back
  k = m.count;
  lathe(m, 0, 0, 0, [[0.42, -0.16], [0.47, -0.12], [0.47, -0.04], [0.42, 0.0]], S(32));
  lathe(m, 0, 0, 0, [[0.372, 0.55], [0.385, 0.57], [0.385, 0.66], [0.365, 0.68]], S(28));
  lieAlongZ(m, k);
  tag(k, 1);
  // the thrusters on each side, and their coral caps
  for (const sx of [-1, 1]) {
    k = m.count;
    tube(m, [[sx * 0.5, -0.05, 0.05, 0.11], [sx * 0.5, -0.05, 0.25, 0.12], [sx * 0.5, -0.05, 0.45, 0.1]], S(14));
    tag(k, 0);
    k = m.count;
    blob(m, sx * 0.5, -0.05, -0.02, (x, y, z) => (z < 0 ? 0.11 * (1 - 0.3 * Math.max(0, -z)) : 0.1), S(5));
    tag(k, 1);
    // the strut to the hull
    k = m.count;
    tube(m, [[sx * 0.2, -0.05, 0.25, 0.04], [sx * 0.42, -0.05, 0.25, 0.04]], 6);
    tag(k, 2);
    // the skids
    k = m.count;
    tube(m, [[sx * 0.3, -0.52, -0.45, 0.03], [sx * 0.3, -0.55, -0.2, 0.035], [sx * 0.3, -0.55, 0.6, 0.035], [sx * 0.3, -0.5, 0.8, 0.03]], 6);
    tube(m, [[sx * 0.24, -0.3, -0.1, 0.03], [sx * 0.3, -0.54, -0.1, 0.03]], 6);
    tube(m, [[sx * 0.24, -0.3, 0.55, 0.03], [sx * 0.3, -0.54, 0.55, 0.03]], 6);
    tag(k, 2);
    // the lamps, on the collar: a brass rim and the glass
    k = m.count;
    tube(m, [[sx * 0.3, -0.22, -0.12, 0.075], [sx * 0.3, -0.22, -0.22, 0.075]], S(12));
    tag(k, 3);
    k = m.count;
    blob(m, sx * 0.3, -0.22, -0.225, (x, y, z) => (z < 0 ? 0.068 : 0.01), S(5));
    tag(k, 4);
  }
  // a fin on top at the back, coral
  k = m.count;
  tube(m, [[0, 0.3, 0.45, 0.025], [0, 0.48, 0.72, 0.02], [0, 0.42, 0.9, 0.015]], 5);
  tag(k, 1);
  // the propeller's shroud: a ring, dark
  k = m.count;
  const ring = [];
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * TAU; ring.push([Math.cos(a) * 0.26, Math.sin(a) * 0.26, 1.08, 0.035]); }
  tube(m, ring, 6);
  tag(k, 2);
  const lamp = uniform(0);                    // how bright the lamps are, 0 to 1
  const mat = bodyMaterial(lamp);
  const body = new ThreeMesh(m.build(), mat);

  // the propeller: three blades on a hub, turning about z
  const pm = new Mesh(true);
  blob(pm, 0, 0, 0, (x, y, z) => 0.06 * (z > 0 ? 1 - z * 0.3 : 1), 4);
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * TAU, c = Math.cos(a), si = Math.sin(a);
    tube(pm, [[c * 0.05, si * 0.05, 0, 0.03], [c * 0.13, si * 0.13, 0.02, 0.05], [c * 0.21, si * 0.21, 0.03, 0.035]], 5);
  }
  for (let i = 0; i < pm.count; i++) pm.a[i * 4] = 3;
  const prop = new ThreeMesh(pm.build(), mat);
  prop.position.set(0, 0, 1.06);

  // the glass bubble in front of the collar
  const gm = new Mesh(false);
  blob(gm, 0, 0, -0.5, () => 0.46, S(14));
  const glass = new ThreeMesh(gm.build(), glassMaterial());
  glass.renderOrder = 6;

  const group = new Group();
  for (const o of [body, prop, glass]) { o.frustumCulled = false; group.add(o); }
  return {
    group, prop, lamp,
    seat: new Vector3(0, -0.12, -0.5),          // where Snap's middle goes
    lampAt: new Vector3(0, -0.22, -0.3),        // between the two lamps
    turn(dt, thrust) { prop.rotation.z += dt * (2 + 14 * thrust); },
  };
}
