// The dive. Builds the world in stages behind a loading bar, then runs one loop: where the
// page is scrolled to decides where the camera is on its path, and everything else follows.
//
// startDive({ parts }) is the whole of it. Each part is a function (ctx) => part, called
// once the ground, rocks and plants stand; ctx is { add, scene, engine, q, camera, rng }.
// A part may return { update(t, dt, p) }, called every frame before drawing (t: seconds
// since the dive began, p: where the camera is on its path).
import { Euler, PerspectiveCamera, Scene } from 'three/webgpu';
import { Engine, pickLevel } from './engine.js';
import { buildFlora } from './flora.js';
import { DEEPER, KNEE, P_MAX, optDepth, optSlope, pathAt, waterAt } from './layout.js';
import { clamp } from './math.js';
import { buildRocks } from './rocks.js';
import { buildSea } from './sea.js';
import { G } from './shaders.js';
import { buildTerrain, rockMaterial } from './terrain.js';
import { cull, makeWorld } from './world.js';

export async function startDive({ parts = [] } = {}) {
const canvas = document.getElementById('world');
const params = new URLSearchParams(location.search);
const level = pickLevel();
if (DEV && params.has('dbg')) G.debug = 1;
const engine = new Engine(canvas, level, params.has('webgl'));
const scene = new Scene();
const add = makeWorld(scene);
const camera = new PerspectiveCamera(58, 1, 0.12, 460);
camera.rotation.order = 'YXZ';

// Everything the loop needs, made once.
const S = {
  p: 0, pTo: 0,              // where on the path the camera is, and where the scroll wants it
  lookX: 0, lookY: 0, lookXTo: 0, lookYTo: 0,   // the pointer's nudge to where it looks
  time: 0, dt: 0, last: 0, fade: 1,
  path: [0, 0, 0, 0, 0], water: [0, 0, 0, 0, 0, 0, 0, 0],
  running: false, parts: {},
};
const DEG = Math.PI / 180;
const euler = new Euler(0, 0, 0, 'YXZ');

function resize() {
  const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
  engine.resize(w, h, devicePixelRatio || 1);
  camera.aspect = w / h;
  // a tall, narrow window sees less to the sides: widen the view on phones held upright
  camera.fov = camera.aspect < 1 ? 74 : 58;
  camera.updateProjectionMatrix();
}

// Put the camera at p and set what depends on where it is.
function place(p) {
  pathAt(p, S.path);
  camera.position.set(S.path[0], S.path[1], S.path[2]);
  euler.set((S.path[4] + S.lookY) * DEG, -(S.path[3] + S.lookX) * DEG, 0, 'YXZ');
  camera.quaternion.setFromEuler(euler);
  camera.updateMatrixWorld(true);
  const d = -camera.position.y;
  const w = waterAt(d, S.water);
  G.scat.value.setRGB(w[0], w[1], w[2]);
  G.amb.value.setRGB(w[3], w[4], w[5]);
  G.opt.value.set(optDepth(d), optSlope(d), KNEE, DEEPER);
  G.light.value.set(1, 1, 1, w[7]);
  S.parts.sea.follow(camera);
  cull(camera);
  for (let i = 0; i < live.length; i++) live[i].update(S.time, S.dt, p);
}
const live = [];

function draw() {
  engine.render(scene, camera, S.water[6], S.fade);
}

function frame(now) {
  if (!S.running) return;
  requestAnimationFrame(frame);
  const dt = Math.min((now - S.last) / 1000, 0.1);
  S.last = now;
  S.dt = dt;
  S.time += dt;
  G.time.value = S.time;
  // ease toward where the scroll is, quickly but without a jerk
  const k = 1 - Math.exp(-dt * 5.5);
  S.p += (S.pTo - S.p) * k;
  S.lookX += (S.lookXTo - S.lookX) * k * 0.7;
  S.lookY += (S.lookYTo - S.lookY) * k * 0.7;
  place(S.p);
  draw();
}

const pause = () => new Promise((r) => setTimeout(r, 0));

async function boot() {
  await engine.init();
  resize();
  S.parts.sea = buildSea(scene);
  await pause();
  let t0 = performance.now();
  S.parts.terrain = buildTerrain(add, engine.q);
  await pause();
  buildRocks(add, S.parts.terrain.material, rockMaterial(), engine.q);
  if (DEV) console.log('ground and rocks ' + Math.round(performance.now() - t0) + ' ms');
  await pause();
  t0 = performance.now();
  S.parts.flora = buildFlora(add, engine.q);
  if (DEV) console.log('flora ' + Math.round(performance.now() - t0) + ' ms ' + JSON.stringify(S.parts.flora));
  await pause();
  for (const make of parts) {
    const t1 = performance.now();
    const part = make({ add, scene, engine, q: engine.q, camera });
    if (part && part.update) live.push(part);
    if (DEV) console.log((make.name || 'part') + ' ' + Math.round(performance.now() - t1) + ' ms');
    await pause();
  }
  engine.bakeShadow(scene);
  addEventListener('resize', resize);
  addEventListener('scroll', () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    S.pTo = max > 0 ? clamp(scrollY / max, 0, 1) * P_MAX : 0;
  }, { passive: true });
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    S.lookXTo = (e.clientX / innerWidth - 0.5) * 16;
    S.lookYTo = -(e.clientY / innerHeight - 0.5) * 9;
  }, { passive: true });
  place(0);
  if (DEV) {
    const { installDev } = await import('./dev.js');
    if (installDev({ S, engine, scene, camera, place, draw, resize })) return;
  }
  S.running = true;
  S.last = performance.now();
  requestAnimationFrame(frame);
}
await boot();
return { S, engine, scene, camera };
}
