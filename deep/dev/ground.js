// Dev entry: the dive with only the ground, the rocks and what grows (terrain.js, rocks.js,
// flora.js), and a stand-in for Snap: a red ball where src/cast.js puts him, which also sets
// G.snapAt, so the plants' corridor to him can be judged. ?nosnap hides the ball (G.snapAt
// is still set). window.__setsCam = [x, y, z, yaw, pitch] (degrees) puts the camera there.
import { Mesh, SphereGeometry } from 'three/webgpu';
import { float, vec3 } from 'three/tsl';
import { startDive } from '../src/app.js';
import { G, material } from '../src/shaders.js';

function standIn(ctx) {
  const ball = new Mesh(new SphereGeometry(0.3, 20, 14), material({ surface: (s) => { s.albedo = vec3(0.85, 0.16, 0.12); s.fluor = float(0.5); } }));
  ball.frustumCulled = false;
  ball.visible = !new URLSearchParams(location.search).has('nosnap');
  ctx.scene.add(ball);
  const D = Math.PI / 180;
  return {
    update() {
      const cam = ctx.camera, c = window.__setsCam;
      if (c) {
        cam.position.set(c[0], c[1], c[2]);
        cam.rotation.set(c[4] * D, -c[3] * D, 0, 'YXZ');
        cam.updateMatrixWorld(true);
      }
      // (as cast.js: metres forward, right, up in the camera's view; wide and tall windows)
      const e = cam.matrixWorld.elements, o = cam.aspect < 1 ? [3.3, 0.0, 0.55] : [2.8, 1.05, -0.28];
      ball.position.set(
        cam.position.x - e[8] * o[0] + e[0] * o[1] + e[4] * o[2],
        cam.position.y - e[9] * o[0] + e[1] * o[1] + e[5] * o[2],
        cam.position.z - e[10] * o[0] + e[2] * o[1] + e[6] * o[2]);
      ball.updateMatrixWorld(true);
      G.snapAt.value.set(ball.position.x, ball.position.y, ball.position.z, 0.45);
    },
  };
}
startDive({ parts: [standIn] }).catch((e) => { console.error('dive: ' + (e && e.stack || e)); });
