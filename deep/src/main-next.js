// The page's entry: the words and the URL (ui), the sound (audio), and the dive with
// everything in it. Where the scene cannot run (reduced motion, no WebGPU and no WebGL 2,
// ?page), the words are the page and nothing else starts.
import { Mesh, PlaneGeometry, Vector3 } from 'three/webgpu';
import { texture, vec3, vec4, uv, float, smoothstep, abs, max } from 'three/tsl';
import { startDive } from './app.js';
import { createAudio } from './audio.js';
import { buildCast } from './cast.js';
import { buildFauna } from './fauna.js';
import { storyDepth } from './layout.js';
import { createPrint } from './print.js';
import { buildSets } from './sets.js';
import { material } from './shaders.js';
import { createUI } from './ui.js';

const audio = createAudio();
let dive = null, cast = null, sets = null, print = null, printDirty = true, printShown = -1;
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
    if (key === 'look' || key === 'crop' || key === 'finish') printDirty = true;
  },
  onStart() { audio.cue('start'); },
});

// the frame in the geode that holds the print, once both exist
function hangPrint(scene) {
  if (!sets || !sets.geode || !print || !print.texture) return;
  const g = sets.geode, w = (g.size || 0.9), h = w / print.aspect;
  const mat = material({
    shadow: false,
    raw: () => {
      const q = uv();
      const pic = texture(print.texture, q).rgb;
      // a pale border, and the picture glowing a little, as if lit from inside the stone
      const edge = max(abs(q.x.sub(0.5)), abs(q.y.sub(0.5)));
      const frame = smoothstep(0.455, 0.465, edge);
      return vec3(pic.mul(float(1.5))).mul(float(1).sub(frame)).add(vec3(0.85, 0.82, 0.75).mul(frame).mul(0.6));
    },
  });
  const plane = new Mesh(new PlaneGeometry(w, h), mat);
  plane.position.copy(g.position);
  plane.lookAt(new Vector3().copy(g.position).add(g.normal));
  scene.add(plane);
}

let lastP = 0;
function onFrame(p, dt) {
  ui.frame(p, dt);
  const speed = dt > 0 ? Math.abs(p - lastP) / dt : 0;
  lastP = p;
  audio.frame(p, storyDepth(p), speed, dt);
  // the print is drawn again only when a choice that shows in it changed, and read back for
  // the finale once the visitor is near it
  if (print && printDirty && cast && cast.snap.ready) {
    print.draw(ui.choices, dive.S.time);
    printDirty = false;
    printShown = -1;
  }
  if (print && p > 7.3 && printShown !== 1) {
    printShown = 1;
    print.read().then((img) => { if (img && ui.showPrint) ui.showPrint(img); }).catch(() => {});
  }
}

if (ui.mode !== 'page') {
  const parts = [
    (ctx) => (sets = buildSets(ctx)),
    buildFauna,
    (ctx) => (cast = buildCast(ctx)),
  ];
  startDive({ parts, follow: () => ui.pTo, progress: (f, label) => ui.loading(f, label), onFrame })
    .then((d) => {
      dive = d;
      if (sets && sets.chainAt) cast.chainAt = sets.chainAt;
      // what Snap glances at on the way
      if (sets && sets.clam) cast.sights.push({ from: 3.6, to: 4.05, at: sets.clam.position });
      if (sets && sets.geode) cast.sights.push({ from: 6.7, to: 7.05, at: sets.geode.position });
      print = createPrint(d.engine, cast.snap);
      cast.loading.then(() => { print.draw(ui.choices, 0); printDirty = false; hangPrint(d.scene); });
      // the pointer steers the lamp; a tap on Snap, and he reacts
      addEventListener('pointermove', (e) => cast.aim((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1)), { passive: true });
      addEventListener('pointerdown', (e) => {
        if (e.target !== document.getElementById('world') && e.target !== document.body && e.target !== document.documentElement) return;
        cast.poke((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1));
      }, { passive: true });
      ui.ready();
    })
    .catch((e) => { console.error('dive: ' + (e && e.stack || e)); ui.failed(String(e && e.message || e)); });
}
