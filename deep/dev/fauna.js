// Dev entry: the dive with only the creatures (src/fauna.js) in it, and stand-ins for what
// other parts set (the visitor's lamp, as src/cast.js aims it, and two vent glows) so the
// dark zones can be judged.
import { startDive } from '../src/app.js';
import { buildFauna } from '../src/fauna.js';
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
startDive({ parts: [buildFauna, devLights] }).then((r) => { window.__dive = r; }).catch((e) => { console.error('dive: ' + (e && e.stack || e)); });
