// Dev entry: the dive with only the creatures (src/fauna.js) in it, and stand-ins for what
// other parts set (the visitor's lamp, as src/cast.js aims it, and two vent glows) so the
// dark zones can be judged.
import { startDive } from '../src/app.js';
import { buildFauna, faunaParts } from '../src/fauna.js';
import { G } from '../src/shaders.js';
import { clamp, smooth } from '../src/math.js';

function devLights({ camera }) {
  G.glowPos.array[1].set(3.5, -197.0, -331.3, 16);
  G.glowCol.array[1].set(2.2, 0.75, 0.22, 0);
  G.glowPos.array[2].set(-12.6, -194.5, -346.2, 18);
  G.glowCol.array[2].set(2.4, 0.8, 0.24, 0);
  const params = new URLSearchParams(location.search);
  const lamp = params.has('nolamp') ? 0 : 1;
  return {
    update(t, dt, p) {
      const e = camera.matrixWorld.elements;
      const on = lamp * smooth(45, 95, -camera.position.y) * clamp((p - 3.82) / 0.26, 0, 1);
      G.lampPos.value.set(camera.position.x - e[8] * 4.3 + e[0] * 1.3 - e[4] * 0.35, camera.position.y - e[9] * 4.3 + e[1] * 1.3 - e[5] * 0.35, camera.position.z - e[10] * 4.3 + e[2] * 1.3 - e[6] * 0.35);
      G.lampDir.value.set(-e[8], -e[9], -e[10]);
      G.lampCol.value.set(9 * on, 8.1 * on, 6.75 * on, 0.86);
    },
  };
}

if (new URLSearchParams(location.search).has('dbgfish')) globalThis.__dbg = 1;

// ?lineup: one of each fish, side on, a few metres in front of the camera at p 1.6 (time 20)
function lineup({ add }) {
  const { FISH, COL, KINDS, fishShape, fishMaterial, fishMesh } = faunaParts, mat = fishMaterial();
  const all = [...KINDS.pastel, ...KINDS.reefY, ...KINDS.reefT, ...KINDS.striped, ...KINDS.puffer, ...KINDS.kelp.slice(0, 2)];
  all.forEach(([shape, pattern, body, second, fins], i) => {
    const x = 0.05 + (i % 5) * 0.62 - 0.9, y = -4.25 - Math.floor(i / 5) * 0.48, z = -31.6, L = shape === 'puffer' ? 0.36 : 0.32;
    const fish = [{ A: [x, y, z + 1160, 0.0003], B: [1000, 1000, 0, 0], C: [-Math.PI / 2 - 0.006, 0, 0, L], D: [(0.37 * i) % 1, 1.4, 1e5, pattern],
      E: [...COL[body], 2], F: [...COL[second], 0], G: [...COL[fins], 0] }];
    add(fishMesh(fishShape(FISH[shape], 2), fish, mat), 60);
  });
}
const extra = new URLSearchParams(location.search).has('lineup') ? [lineup] : [];
startDive({ parts: [buildFauna, devLights, ...extra] }).then((r) => { window.__dive = r; }).catch((e) => { console.error('dive: ' + (e && e.stack || e)); });
