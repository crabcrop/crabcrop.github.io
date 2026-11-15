// Development tools, only in dev.html: still frames at chosen places for the visual
// critic, the scripted descent, and the benchmark.
//
//   dev.html?still        do not run the loop; window.__deep.shot(p, time, yaw, pitch)
//                         draws one frame at p on the path (yaw and pitch in degrees are
//                         added to where the path looks) and resolves when it is drawn
//   dev.html?capture      draw the last pass into a target, read it back and show it on a
//                         2D canvas: how frames are seen where WebGPU cannot present to
//                         the screen (this sandbox), on either backend
//   dev.html?webgl        use the WebGL 2 backend even where WebGPU exists
import { RenderTarget, UnsignedByteType } from 'three/webgpu';
import { G } from './shaders.js';

export function installDev({ S, engine, scene, camera, place, draw }) {
  const params = new URLSearchParams(location.search);
  let shown = null, target = null;
  const capture = async () => {
    const w = engine.width, h = engine.height, r = engine.renderer;
    if (!target || target.width !== w || target.height !== h) { target?.dispose(); target = new RenderTarget(w, h, { type: UnsignedByteType, depthBuffer: false }); }
    engine.capture = target;
    draw();
    engine.capture = null;
    const px = await r.readRenderTargetPixelsAsync(target, 0, 0, w, h);
    if (!shown) {
      shown = document.createElement('canvas');
      shown.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:1';
      document.body.appendChild(shown);
    }
    shown.width = w; shown.height = h;
    const img = new ImageData(w, h), row = w * 4, stride = px.length / h;
    // WebGPU reads rows from the top, WebGL from the bottom; WebGPU may pad each row
    for (let y = 0; y < h; y++) {
      const from = (engine.webgpu ? y : h - 1 - y) * stride;
      img.data.set(px.subarray(from, from + row), y * row);
    }
    shown.getContext('2d').putImageData(img, 0, 0);
  };
  const api = {
    ready: true, level: engine.level, backend: engine.webgpu ? 'WebGPU' : 'WebGL 2',
    async shot(p, time = 20, yaw = 0, pitch = 0) {
      S.p = S.pTo = p; S.time = time; G.time.value = time;
      S.lookX = S.lookXTo = yaw; S.lookY = S.lookYTo = pitch;
      place(p);
      if (params.has('capture')) await capture();
      else { draw(); await engine.renderer.backend.device?.queue.onSubmittedWorkDone(); }
      return { calls: engine.calls, tris: engine.tris, pos: camera.position.toArray().map((v) => +v.toFixed(1)), size: [engine.width, engine.height], backend: api.backend };
    },
  };
  window.__deep = api;
  return params.has('still');   // true: the page does not start its own loop
}
