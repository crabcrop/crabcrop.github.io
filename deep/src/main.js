// The page's entry: the words and the URL (ui), the sound (audio), and the dive with
// everything in it. Where the scene cannot run (reduced motion, no WebGPU and no WebGL 2,
// ?page), the words are the page and nothing else starts.
import { Mesh, PlaneGeometry, Vector3 } from 'three/webgpu';
import { abs, float, max, smoothstep, texture, uv, vec3 } from 'three/tsl';
import { startDive } from './app.js';
import { createAudio } from './audio.js';
import { buildCast } from './cast.js';
import { buildFauna } from './fauna.js';
import { createPrint } from './print.js';
import { buildSets } from './sets.js';
import { material } from './shaders.js';
import { createUI, depthAt } from './ui.js';

const audio = createAudio();
let dive = null, cast = null, sets = null, print = null, printDirty = true, printRead = false, frames = 0, zone = -1, lastP = 0;
const savedLevel = () => { try { return localStorage.getItem('deep-level') || 'auto'; } catch (e) { return 'auto'; } };

const ui = createUI({
  level: savedLevel(),
  onLevel(name) {
    try { if (name === 'auto') localStorage.removeItem('deep-level'); else localStorage.setItem('deep-level', name); } catch (e) { /* storage may be shut */ }
    location.reload();
  },
  onSound(on) { audio.setEnabled(on); },
  onChoice(key, i) {
    audio.cue('choice');
    if (key === 'look' && dive) dive.engine.pulseLook(i + 1);
    if (key === 'look' || key === 'crop' || key === 'finish') { printDirty = true; printRead = false; }
  },
  onStart() { audio.cue('start'); },
});

// the frame in the geode that holds the print, once both exist
let printNode = null;
function hangPrint(scene) {
  if (!sets || !sets.geode || !print || !print.texture || printNode) return;
  const g = sets.geode, w = g.size || 1, h = w / Math.max(print.aspect, 1);
  printNode = texture(print.texture);
  printNode.mergeable = false;
  const mat = material({
    shadow: false,
    raw: () => {
      const q = uv();
      // a pale border round the picture, which glows a little, as if lit from inside the stone
      const frame = smoothstep(0.455, 0.465, max(abs(q.x.sub(0.5)), abs(q.y.sub(0.5))));
      return printNode.sample(q).rgb.mul(1.4).mul(float(1).sub(frame)).add(vec3(0.85, 0.82, 0.75).mul(frame).mul(0.6));
    },
  });
  const plane = new Mesh(new PlaneGeometry(w, h), mat);
  plane.position.copy(g.position);
  plane.lookAt(new Vector3().copy(g.position).add(g.normal));
  scene.add(plane);
}

function onFrame(p, dt) {
  ui.frame(p, dt);
  audio.frame(p, depthAt(p), dt > 0 ? Math.abs(p - lastP) / dt : 0, dt);
  const z = Math.min(7, Math.floor(p));
  if (z !== zone) { if (zone >= 0) audio.cue('zone'); zone = z; }
  if (lastP < 7.7 && p >= 7.7) audio.cue('surface');
  lastP = p;
  if (ui.statsOn && ++frames % 30 === 0 && dive) ui.stats(dive.stats());
  // the print is drawn again only when a choice that shows in it changed; the finale gets
  // its own copy once the visitor nears it
  if (print && printDirty && cast && cast.snap.ready) {
    print.draw(ui.choices, dive ? dive.S.time : 0);
    if (printNode) printNode.value = print.texture;
    cast.showPrint(print.texture, print.aspect);
    printDirty = false;
  }
  if (print && !printDirty && !printRead && p > 7.3) {
    printRead = true;
    print.read().then((img) => {
      const c = img && document.getElementById('served');
      if (!c) return;
      c.width = img.width; c.height = img.height;
      c.getContext('2d').putImageData(img, 0, 0);
      c.parentElement.hidden = false;
    }).catch(() => {});
  }
}

// (for the end-to-end test only: where the page says the camera should be)
if (new URLSearchParams(location.search).has('e2e')) window.__pTo = () => ui.pTo;

export function start() {
  if (ui.mode === 'page') return;
  // the set pieces first (the cast holds on to their chain), then the creatures, then the cast
  let fauna = null;
  const parts = [(ctx) => (sets = buildSets(ctx)), (ctx) => (fauna = buildFauna({ ...ctx, wreck: sets.wreck })), (ctx) => {
    cast = buildCast(ctx);
    // Snap holds the set's own chain, and looks at the clam, the octopus and the geode as he passes
    if (sets.chainAt) cast.chainAt = sets.chainAt;
    if (sets.clam) cast.sights.push({ from: 3.6, to: 4.05, at: sets.clam.position });
    if (fauna.octopus) cast.sights.push({ from: 4.42, to: 4.78, at: fauna.octopus });
    if (sets.geode) cast.sights.push({ from: 6.7, to: 7.05, at: sets.geode.position });
    return cast;
  }];
  startDive({ parts, follow: () => ui.pTo, progress: (f, label) => ui.loading(f, label), onFrame, onFail: (why) => ui.failed(why) })
    .then((d) => {
      dive = d;
      print = createPrint(d.engine, cast.snap);
      cast.loading.then(() => { print.draw(ui.choices, 0); printDirty = false; hangPrint(d.scene); cast.showPrint(print.texture, print.aspect); });
      // the pointer steers the lamp; a tap on Snap, and he reacts
      const canvas = document.getElementById('world');
      addEventListener('pointermove', (e) => { if (e.target === canvas) cast.aim((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1)); }, { passive: true });
      addEventListener('pointerdown', (e) => { if (e.target === canvas) cast.poke((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1)); }, { passive: true });
      // the scene fades in once its first frame is drawn
      requestAnimationFrame(() => requestAnimationFrame(() => ui.ready()));
    })
    .catch((e) => { console.error('dive: ' + (e && e.stack || e)); ui.failed(String((e && e.message) || e).slice(0, 80)); });
}

start();
