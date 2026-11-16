// Dev entry: the dive with only the set pieces (src/sets.js) in it. window.__setsCam =
// [x, y, z, yaw, pitch] (degrees; yaw 0 looks down -z, positive to the right) puts the
// camera there for the next shots, wherever the path is. window.__sets holds the scene and
// the camera, for probes.
import { startDive } from '../src/app.js';
import { buildSets } from '../src/sets.js';

function camOverride(ctx) {
  const D = Math.PI / 180;
  window.__sets = ctx;
  return {
    update() {
      const c = window.__setsCam;
      if (!c) return;
      ctx.camera.position.set(c[0], c[1], c[2]);
      ctx.camera.rotation.set(c[4] * D, -c[3] * D, 0, 'YXZ');
      ctx.camera.updateMatrixWorld(true);
    },
  };
}
startDive({ parts: [buildSets, camOverride] }).catch((e) => { console.error('dive: ' + (e && e.stack || e)); });
