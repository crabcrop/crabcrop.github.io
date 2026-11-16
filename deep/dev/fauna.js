// Dev entry: the dive with only the creatures (src/fauna.js) in it, and stand-ins for what
// other parts set (the visitor's lamp, as src/cast.js aims it, and two vent glows) so the
// dark zones can be judged.
//   ?lineup   one of each fish, side on, a few metres in front of the camera at p 1.6 (time 20)
//   ?cast     the turtles, the octopus (at a desk, and swimming), the anglerfish and a gull,
//             side by side in front of the camera at p 1.6; &castyaw=deg turns them,
//             &castroll=rad rolls them toward the camera
import { startDive } from '../src/app.js';
import { buildFauna, faunaParts } from '../src/fauna.js';
import { G } from '../src/shaders.js';
import { Sphere, Vector3 } from 'three/webgpu';
import { clamp, smooth } from '../src/math.js';

const params = new URLSearchParams(location.search);

function devLights({ camera }) {
  G.glowPos.array[1].set(3.5, -197.0, -331.3, 16);
  G.glowCol.array[1].set(2.2, 0.75, 0.22, 0);
  G.glowPos.array[2].set(-12.6, -194.5, -346.2, 18);
  G.glowCol.array[2].set(2.4, 0.8, 0.24, 0);
  const lamp = params.has('nolamp') ? 0 : 1;
  return {
    update(t, dt, p) {
      const e = camera.matrixWorld.elements;
      const on = lamp * smooth(45, 95, -camera.position.y) * clamp((p - 3.82) / 0.26, 0, 1);
      G.lampPos.value.set(camera.position.x - e[8] * 4.3 + e[0] * 1.3 - e[4] * 0.35, camera.position.y - e[9] * 4.3 + e[1] * 1.3 - e[5] * 0.35, camera.position.z - e[10] * 4.3 + e[2] * 1.3 - e[6] * 0.35);
      G.lampDir.value.set(-e[8], -e[9], -e[10]);
      G.lampCol.value.set(9 * on, 8.1 * on, 6.75 * on, 0.86);
      // (the cast's own places, as cast.js sets them, so the creatures keep clear of them)
      G.subAt.value.set(camera.position.x - e[8] * 4.3 + e[0] * 1.3 - e[4] * 0.35, p > 4.8 ? camera.position.y - e[9] * 4.3 + e[1] * 1.3 - e[5] * 0.35 : -1000, camera.position.z - e[10] * 4.3 + e[2] * 1.3 - e[6] * 0.35, 1.3);
      G.snapAt.value.set(camera.position.x - e[8] * 2.8 + e[0] * 1.05 - e[4] * 0.28, camera.position.y - e[9] * 2.8 + e[1] * 1.05 - e[5] * 0.28, camera.position.z - e[10] * 2.8 + e[2] * 1.05 - e[6] * 0.28, 0.45);
    },
  };
}

// ?lineup: one of each fish, side on, a few metres in front of the camera at p 1.6 (time 20)
function lineup({ add }) {
  const { FISH, COL, KINDS, fishShape, fishMaterial, fishMesh, eyeOf, toLin } = faunaParts, mat = fishMaterial();
  const all = [...KINDS.pastel, ...KINDS.reefY, ...KINDS.reefT, ...KINDS.striped, ...KINDS.puffer, ...KINDS.kelp.slice(0, 2)];
  all.forEach(([shape, pattern, body, second, fins], i) => {
    const x = 0.05 + (i % 5) * 0.62 - 0.9, y = -4.25 - Math.floor(i / 5) * 0.48, z = -31.6, L = shape === 'puffer' ? 0.36 : 0.32;
    // (a school of one on a loop so wide it is a straight line across the view)
    const fish = [{ A: [x, y, z + 1000, 0.0003], B: [1000, 1000, 0, 0], C: [0, 0, 0, L], D: [(0.37 * i) % 1, 1.4, -Math.PI / 2 - 0.006, pattern],
      E: [...COL[body].map(toLin), 2], F: [...COL[second].map(toLin), 0.5], G: [...COL[fins].map(toLin), 0], H: eyeOf(FISH[shape]) }];
    add(fishMesh(fishShape(FISH[shape], 2), fish, mat), 60);
  });
}
// ?cast: the turtles, the octopus at a desk and swimming, the anglerfish and a gull, side by side
function castLineup({ add }) {
  const { turtleShape, turtleMaterial, octopusShape, octopusMaterial, anglerShape, anglerMaterial, lureGlowMaterial, gullShape, gullMaterial, copies, cards, solid, POSE } = faunaParts;
  const sph = new Sphere(new Vector3(1.2, -5, -32), 12), at = (n, look, seed) => ({ cS: new Float32Array([n, seed, look, 0]) });
  add(solid(copies(turtleShape(2), 1, at(0, 0, 0.3), sph), turtleMaterial()), 60);
  add(solid(copies(turtleShape(2), 1, at(1, 1, 0.7), sph), turtleMaterial()), 60);
  add(solid(copies(octopusShape(2), 1, at(2, 0, 0.1), sph), octopusMaterial()), 60);
  add(solid(copies(octopusShape(2), 1, at(3, 0, 0.6), sph), octopusMaterial()), 60);
  add(solid(copies(anglerShape(2), 1, at(4, 0, 0.5), sph), anglerMaterial()), 60);
  add(solid(cards(1, at(4, 0, 0.5), sph), lureGlowMaterial()), 60);
  add(solid(copies(gullShape(2), 1, { gA: new Float32Array([1.4, -3.9, -32.4, 0.0001]), gB: new Float32Array([0.0001, 1.5708, 0.9, 0.3]) }, sph), gullMaterial()), 60);
  const yaw = (params.get('castyaw') || 0) * Math.PI / 180, roll = Number(params.get('castroll') || 0);
  return {
    update() {
      const a = POSE.array, c = Math.cos(yaw), s = Math.sin(yaw);
      const put = (n, x, y, z, size, look, d = [0, 0, 0, 0]) => {
        // facing (c, 0, s), rolled toward the camera (+z) by `roll`
        const ux = -s * Math.sin(roll) * 0, uy = Math.cos(roll), uz = Math.sin(roll);
        a[n * 4].set(x, y, z, size); a[n * 4 + 1].set(c, 0, s, 0.4); a[n * 4 + 2].set(ux, uy, uz, look); a[n * 4 + 3].set(...d);
      };
      put(0, -0.55, -5.0, -32.6, 0.9, 0); put(1, 0.75, -5.25, -33.4, 0.9, 1);
      // the octopus at a desk: its letter half a metre in front of it, a little below
      put(2, 2.0, -5.95, -32.4, 0.8, 0, [1, 0.62 / 0.8, 0.18 / 0.8, 0]); put(3, 2.4, -4.6, -33.6, 0.6, 0);
      put(4, -1.85, -5.35, -32.2, 0.8, 0);
    },
  };
}
const extra = [...(params.has('lineup') ? [lineup] : []), ...(params.has('cast') ? [castLineup] : [])];
startDive({ parts: [buildFauna, devLights, ...extra] }).then((r) => { window.__dive = r; }).catch((e) => { console.error('dive: ' + (e && e.stack || e)); });
