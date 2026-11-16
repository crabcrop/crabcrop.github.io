// Dev entry: the dive with a few test shapes in yarn, in front of the camera in the shallows.
import { Mesh as ThreeMesh } from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { startDive } from '../src/app.js';
import { groundY } from '../src/layout.js';
import { Mesh, blob, lathe } from '../src/math.js';
import { material, yarn } from '../src/shaders.js';

function swatches(ctx) {
  const shapes = [
    { x: -1.6, c: [0.95, 0.42, 0.35], c2: null, r: 0.45 },
    { x: 0, c: [0.98, 0.78, 0.25], c2: [0.30, 0.55, 0.85], r: 0.55 },
    { x: 1.7, c: [0.62, 0.40, 0.80], c2: null, r: 0.4 },
  ];
  for (const sh of shapes) {
    const m = new Mesh(false);
    blob(m, 0, 0, 0, (x, y, z) => sh.r * (1 + 0.15 * Math.sin(x * 4) * Math.sin(z * 3)), 16);
    const mat = material({ surface: (s, f) => yarn(s, f, { color: vec3(...sh.c), color2: sh.c2 ? vec3(...sh.c2) : null, stripe: 3 }) });
    const mesh = new ThreeMesh(m.build(), mat);
    const z = -33.6;
    mesh.position.set(0.9 + sh.x, groundY(0.9 + sh.x, z) + sh.r * 0.9, z);
    ctx.add(mesh, 60);
  }
  // a ruffled cup, like a crochet coral
  const m = new Mesh(false);
  lathe(m, 0, 0, 0, [[0.05, 0], [0.18, 0.1], [0.32, 0.3], [0.55, 0.55], [0.62, 0.6]], 48, (a, t) => 1 + t * t * 0.25 * Math.sin(a * 9));
  const mesh = new ThreeMesh(m.build(), material({ side: 2, surface: (s, f) => yarn(s, f, { color: vec3(0.95, 0.35, 0.45) }) }));
  mesh.position.set(3.2, groundY(3.2, -33.2) - 0.02, -33.2);
  ctx.add(mesh, 60);
}
startDive({ parts: [swatches] }).catch((e) => console.error('dive: ' + (e && e.stack || e)));
