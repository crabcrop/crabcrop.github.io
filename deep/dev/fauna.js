// Dev entry: the dive with only the creatures (src/fauna.js) in it, and stand-ins for what
// other parts set (the visitor's lamp, as src/cast.js aims it, and two vent glows) so the
// dark zones can be judged.
import { startDive } from '../src/app.js';
import { buildFauna, fishParts } from '../src/fauna.js';
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
  const { SHAPES, COLOURS, KIND, fishShape, fishMaterial, fishMesh } = fishParts, mat = fishMaterial();
  const rows = [['sardine', 'silver', 0.3], ['garibaldi', 'gold', 0.34], ['damsel', 'blueYellow', 0.3], ['damsel', 'bands', 0.28], ['damsel', 'violet', 0.28],
    ['snapper', 'grey', 0.42], ['parrot', 'parrot', 0.45], ['parrot', 'grouper', 0.45], ['lantern', 'lantern', 0.3], ['shrimp', 'shrimp', 0.22]];
  rows.forEach(([shape, col, L], i) => {
    const x = 0.05 + (i % 5) * 0.62 - 0.4, y = -4.55 - Math.floor(i / 5) * 0.55, z = -31.6, eye = SHAPES[shape].eye, [b, l, f] = COLOURS[col];
    const fish = [{ A: [x, y, z + 1160, 0.0003], B: [1000, 1000, 0, 0], C: [-Math.PI / 2 - 0.006, 0, 0, L], D: [0.37 * i % 1, 1.2, 1e5, KIND[col] ?? 5],
      E: [...b, eye[0]], F: [...l, eye[1]], G: [...f, eye[2]] }];
    add(fishMesh(fishShape(SHAPES[shape], 2), fish, mat), 60);
  });
}
const extra = new URLSearchParams(location.search).has('lineup') ? [lineup] : [];
startDive({ parts: [buildFauna, devLights, ...extra] }).then((r) => { window.__dive = r; }).catch((e) => { console.error('dive: ' + (e && e.stack || e)); });
