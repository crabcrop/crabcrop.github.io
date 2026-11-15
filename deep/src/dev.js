// Development tools, only in dev.html: still frames at chosen places for the visual
// critic, the scripted descent, and the benchmark.
//
//   dev.html?still        do not run the loop; window.__deep.shot(p, time, yaw, pitch)
//                         draws one frame at p on the path (yaw and pitch in degrees are
//                         added to where the path looks) and resolves when it is drawn
import { G } from './shaders.js';

export function installDev({ S, engine, scene, camera, place, draw }) {
  const params = new URLSearchParams(location.search);
  const api = {
    ready: true, level: engine.level,
    shot(p, time = 20, yaw = 0, pitch = 0) {
      S.p = S.pTo = p; S.time = time; G.uTime.value = time;
      S.lookX = S.lookXTo = yaw; S.lookY = S.lookYTo = pitch;
      place(p);
      draw();
      engine.gl.finish();
      return { calls: engine.calls, tris: engine.tris, pos: camera.position.toArray().map((v) => +v.toFixed(1)), size: [engine.width, engine.height] };
    },
  };
  window.__deep = api;
  return params.has('still');   // true: the page does not start its own loop
}
