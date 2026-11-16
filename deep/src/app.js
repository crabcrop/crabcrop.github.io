// The dive. Builds the world in stages behind a loading bar, then runs one loop: where the
// page is scrolled to decides where the camera is on its path, and everything else follows.
//
// startDive({ parts }) is the whole of it. Each part is a function (ctx) => part, called
// once the ground, rocks and plants stand; ctx is { add, scene, engine, q, camera, rng }.
// A part may return { update(t, dt, p) }, called every frame before drawing (t: seconds
// since the dive began, p: where the camera is on its path), and { loading }, a promise
// for what it still fetches (the dive does not wait for it; dev stills do).
import { Euler, PerspectiveCamera, Scene } from 'three/webgpu';
import { Engine, pickLevel } from './engine.js';
import { buildFlora } from './flora.js';
import { DEEPER, KNEE, P_MAX, optDepth, optSlope, pathAt, waterAt } from './layout.js';
import { clamp } from './math.js';
import { buildRocks } from './rocks.js';
import { buildSea } from './sea.js';
import { G } from './shaders.js';
import { buildTerrain, rockMaterial } from './terrain.js';
import { createPace } from './pace.js';
import { cull, makeWorld } from './world.js';

// Options besides parts: follow() returns where the page says the camera should be (else
// the scroll decides, evenly over the page); progress(fraction, label) is told how the
// building goes; onFrame(p, dt) runs every frame after the camera is placed.
export async function startDive({ parts = [], follow = null, progress = null, onFrame = null, onFail = null } = {}) {
const canvas = document.getElementById('world');
const params = new URLSearchParams(location.search);
const level = pickLevel();
if (DEV && params.has('dbg')) G.debug = 1;
const engine = new Engine(canvas, level, params.has('webgl'), { timestamps: params.has('bench') });
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
  // the deep's own faint indigo: from the twilight down, a touch of violet at the vents
  const deep = Math.min(1, Math.max(0, (d - 70) / 60));
  G.deepAmb.value.setRGB(0.020 * deep, 0.020 * deep, 0.058 * deep);
  S.parts.sea.follow(camera);
  cull(camera);
  for (let i = 0; i < live.length; i++) live[i].update(S.time, S.dt, p);
}
const live = [], waits = [];

function draw() {
  engine.render(scene, camera, S.water[6], S.fade);
}

function frame(now) {
  if (!S.running) return;
  requestAnimationFrame(frame);
  pace.frame(now - S.last);
  const dt = Math.min((now - S.last) / 1000, 0.1);
  S.last = now;
  S.dt = dt;
  S.time += dt;
  G.time.value = S.time;
  // ease toward where the scroll is, quickly but without a jerk
  if (follow) {
    S.pTo = follow();
    // a jump (a link to a zone, or "Dive again"): go there at once rather than fly
    if (Math.abs(S.pTo - S.p) > 1.5) S.p = S.pTo;
  }
  const k = 1 - Math.exp(-dt * 5.5);
  S.p += (S.pTo - S.p) * k;
  S.lookX += (S.lookXTo - S.lookX) * k * 0.7;
  S.lookY += (S.lookYTo - S.lookY) * k * 0.7;
  place(S.p);
  if (onFrame) onFrame(S.p, dt);
  draw();
}

const pause = () => new Promise((r) => setTimeout(r, 0));
const pace = createPace(engine, () => resize());


const told = (f, label) => { if (progress) progress(f, label); };
async function boot() {
  told(0.05, 'Waking the graphics card');
  await engine.init();
  resize();
  S.parts.sea = buildSea(scene);
  told(0.15, 'Filling the sea');
  await pause();
  let t0 = performance.now();
  S.parts.terrain = buildTerrain(add, engine.q);
  told(0.35, 'Laying the sea floor');
  await pause();
  buildRocks(add, S.parts.terrain.material, rockMaterial(), engine.q);
  told(0.5, 'Raising the rocks');
  if (DEV) console.log('ground and rocks ' + Math.round(performance.now() - t0) + ' ms');
  await pause();
  t0 = performance.now();
  S.parts.flora = buildFlora(add, engine.q);
  told(0.62, 'Growing the kelp and the reef');
  if (DEV) console.log('flora ' + Math.round(performance.now() - t0) + ' ms ' + JSON.stringify(S.parts.flora));
  await pause();
  for (let i = 0; i < parts.length; i++) {
    const make = parts[i];
    told(0.62 + 0.28 * (i / Math.max(parts.length, 1)), 'Bringing everyone in');
    const t1 = performance.now();
    const part = make({ add, scene, engine, q: engine.q, camera });
    if (part && part.update) live.push(part);
    if (part && part.loading) waits.push(part.loading.catch(() => {}));
    if (DEV) console.log((make.name || 'part') + ' ' + Math.round(performance.now() - t1) + ' ms');
    await pause();
  }
  told(0.92, 'Casting the shadows');
  engine.bakeShadow(scene);
  addEventListener('resize', resize);
  if (!follow) addEventListener('scroll', () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    S.pTo = max > 0 ? clamp(scrollY / max, 0, 1) * P_MAX : 0;
  }, { passive: true });
  if (follow) { S.pTo = S.p = follow(); }
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    S.lookXTo = (e.clientX / innerWidth - 0.5) * 16;
    S.lookYTo = -(e.clientY / innerHeight - 0.5) * 9;
  }, { passive: true });
  place(S.p);
  told(1, 'Ready');
  if (DEV) {
    await Promise.all(waits);
    const { installDev } = await import('./dev.js');
    if (installDev({ S, engine, scene, camera, place, draw, resize })) return;
  }
  if (params.has('bench')) {
    const { runBench, showReport } = await import('./bench.js');
    showReport(await runBench({ S, engine, place, draw, resize }));
  }
  S.running = true;
  S.last = performance.now();
  requestAnimationFrame(frame);
}
await boot();
// if the graphics device is lost, say so: the page carries on as words
const lost = (why) => { S.running = false; if (onFail) onFail(why); };
canvas.addEventListener('webglcontextlost', () => lost('the graphics context was lost'));
engine.renderer.backend.device?.lost?.then((info) => { if (info.reason !== 'destroyed') lost('the graphics device was lost'); });
return { S, engine, scene, camera, place, draw, stats: () => pace.stats() };
}
