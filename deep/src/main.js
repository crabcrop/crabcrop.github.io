// The page's entry: the words and the URL (ui), the sound (audio), and the dive with
// everything in it. Where the scene cannot run (reduced motion, no WebGPU and no WebGL 2,
// ?page), the words are the page and nothing else starts.
import { Mesh, PlaneGeometry, Vector3 } from 'three/webgpu';
import { float } from 'three/tsl';
import { startDive } from './app.js';
import { createAudio } from './audio.js';
import { LOCKS, buildCast } from './cast.js';
import { buildFauna } from './fauna.js';
import { PHOTO, photoPrint, photoReady } from './photo.js';
import { startPage } from './page.js';
import { createPrint } from './print.js';
import { buildSets } from './sets.js';
import { material } from './shaders.js';
import { createStage } from './stage.js';
import { createUI, depthAt } from './ui.js';
import { ZONE_MODULES } from './zones/index.js';

const audio = createAudio();
let dive = null, cast = null, sets = null, fauna = null, stage = null, print = null, printDirty = true, printRead = false, frames = 0, zone = -1, lastP = 0;
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
  // as a page (asked for, or where the scene cannot run): the cards that follow the choices
  onPage() { startPage(ui); },
});

// Snap's print in the geode's hollow, where the story finds it: the photo he chased down,
// printed with a white border, lying on the crystals, a little lit by them.
let hung = null;
function hangPrint(scene) {
  if (!sets || !sets.geode || hung) return hung;
  const g = sets.geode, w = Math.min(g.size || 1, 0.75), h = w / PHOTO.aspect;
  const pic = photoPrint();
  const mat = material({
    shadow: false,
    surface(s) { s.albedo = pic; s.spec = float(0.05); s.gloss = float(8.0); s.emis = s.albedo.mul(0.18); },
  });
  const plane = new Mesh(new PlaneGeometry(w, h), mat);
  plane.position.copy(g.position);
  plane.lookAt(new Vector3().copy(g.position).add(g.normal));
  scene.add(plane);
  hung = plane;
  return plane;
}

// Snap's card visits: when the visitor has paused a while on a card, he leaps onto its top
// edge (once a card), snaps his pincer on it, and the card tips a little under him; scrolling
// on brings him back.
const visited = new WeakSet(), onCard = new Vector3(), V3 = new Vector3();
let visiting = null;
function cardVisits() {
  if (!cast || !stage || !cast.snap.ready) return;
  if (visiting && cast.idle < 0.1) { cast.visit(null); visiting.classList.remove('visited'); visiting = null; return; }
  if (visiting || cast.idle < 3.5) return;
  const card = ui.cardInPlace();
  if (!card || visited.has(card)) return;
  const r = card.getBoundingClientRect(), cam = stage.camera;
  // the top edge, a little in from its right end, at Snap's distance from the camera
  const x = r.left + r.width * 0.72, y = r.top;
  const d = cam.position.distanceTo(cast.snapAt(V3));
  onCard.set((x / stage.W) * 2 - 1, 1 - (y / stage.H) * 2, 0.5).unproject(cam).sub(cam.position).normalize();
  const along = d / Math.max(0.2, onCard.dot(V3.set(0, 0, -1).applyQuaternion(cam.quaternion)));
  onCard.multiplyScalar(along).add(cam.position);
  onCard.addScaledVector(V3.set(0, 1, 0).applyQuaternion(cam.quaternion), cast.snap.height * 0.42);
  if (!cast.visit(onCard)) return;
  visited.add(card);
  visiting = card;
  setTimeout(() => { if (visiting === card) card.classList.add('visited'); }, 600);
}

function onFrame(p, dt) {
  ui.frame(p, dt);
  if (stage) stage.frame(p, dt);
  cardVisits();
  audio.frame(p, depthAt(p), dt > 0 ? Math.abs(p - lastP) / dt : 0, dt);
  const z = Math.min(7, Math.floor(p));
  if (z !== zone) { if (zone >= 0) audio.cue('zone'); zone = z; }
  if (lastP < 7.7 && p >= 7.7) audio.cue('surface');
  if (lastP < LOCKS[0] && p >= LOCKS[0]) audio.cue('lock');
  lastP = p;
  if (ui.statsOn && ++frames % 30 === 0 && dive) ui.stats(dive.stats());
  // the print is drawn again only when a choice that shows in it changed; the finale gets
  // its own copy once the visitor nears it
  if (print && printDirty) {
    print.draw(ui.choices);
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

// (dev builds only: the cast and the sets, for probes)
if (DEV) window.__dbg = { get cast() { return cast; }, get sets() { return sets; }, get fauna() { return fauna; }, get stage() { return stage; }, get print() { return print; } };

// (for the end-to-end test only: where the page says the camera should be)
if (new URLSearchParams(location.search).has('e2e')) window.__pTo = () => ui.pTo;

export function start() {
  if (ui.mode === 'page') return;
  // the set pieces first (the cast holds on to their chain), then the creatures, then the cast,
  // then each zone's own pieces (which may look for any of them)
  const parts = [(ctx) => (sets = buildSets(ctx)), (ctx) => (fauna = buildFauna({ ...ctx, wreck: sets.wreck })), (ctx) => {
    cast = buildCast(ctx);
    // Snap holds the set's own chain, and looks at the clam, the octopus and the geode as he passes
    if (sets.chainAt) cast.chainAt = sets.chainAt;
    if (sets.geode) cast.geodeAt = sets.geode.position;
    if (sets.clam) cast.sights.push({ from: 3.6, to: 4.05, at: sets.clam.position });
    // (his place in the Clam Studio: just in front of the open shell's lip, on its left as the
    // camera sees it, its lamps and its pearl behind him)
    if (sets.clam && sets.clam.normal) {
      const c = sets.clam, l = Math.hypot(c.normal.x, c.normal.z) || 1, ezx = c.normal.x / l, ezz = c.normal.z / l;
      cast.studioAt = c.position.clone().add(new Vector3(-1.516 * ezz + 1.8 * ezx, 0.11, 1.516 * ezx + 1.8 * ezz));
    }
    if (fauna.octopus) cast.sights.push({ from: 4.42, to: 4.7, at: fauna.octopus });
    cast.sights.push({ from: 4.68, to: 4.86, at: cast.sub.group.position });     // (the submarine, as it comes for him)
    if (sets.geode) cast.sights.push({ from: 6.7, to: 7.05, at: sets.geode.position });
    return cast;
  }];
  for (const z of ZONE_MODULES) if (z.build) parts.push((ctx) => z.build({ ...ctx, sets, fauna, cast }));
  startDive({ parts, follow: () => ui.pTo, progress: (f, label) => ui.loading(f, label), onFrame, onFail: (why) => ui.failed(why) })
    .then((d) => {
      dive = d;
      print = createPrint(d.engine);
      print.draw(ui.choices); printDirty = false;
      // (drawn again once the photo is in: until then the felt print stands in)
      photoReady().then(() => { printDirty = true; printRead = false; });
      const geodePrint = hangPrint(d.scene);
      // the zones' hands-on pieces: mounted once the scene runs, run every frame after the camera
      stage = createStage({ camera: d.camera, ui });
      const world = { sets, fauna, cast, engine: d.engine, scene: d.scene, camera: d.camera, print, audio, ui, geodePrint };
      for (const z of ZONE_MODULES) {
        try { if (z.mount) z.mount(stage, world); stage.zones.push(z); } catch (e) { console.error('dive: zone ' + z.id + ' did not mount: ' + (e && e.stack || e)); }
      }
      // the pointer steers the lamp; a tap on Snap, and he reacts
      const canvas = document.getElementById('world');
      // (the scene takes the pointer where nothing of the page is over it: the canvas, or the
      // hands-on layer's empty space)
      const onScene = (e) => e.target === canvas || e.target === document.getElementById('fx');
      let overSnap = false;
      addEventListener('pointermove', (e) => {
        if (!onScene(e)) { if (overSnap) { overSnap = false; document.body.style.cursor = ''; } return; }
        const x = (e.clientX / innerWidth) * 2 - 1, y = -((e.clientY / innerHeight) * 2 - 1);
        cast.aim(x, y);
        // the cursor turns to a pointer over Snap: he can be tapped
        const on = e.pointerType !== 'touch' && cast.hits(x, y);
        if (on !== overSnap) { overSnap = on; document.body.style.cursor = on ? 'pointer' : ''; }
      }, { passive: true });
      addEventListener('pointerdown', (e) => {
        if (!onScene(e)) return;
        // (on a touch screen a tap aims the lamp too, as a moving cursor does)
        if (e.pointerType === 'touch') cast.aim((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1));
        if (cast.poke((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1)) && stage) stage.sparkle([e.clientX, e.clientY], 7);
      }, { passive: true });
      // the scene fades in once its first frame is drawn
      requestAnimationFrame(() => requestAnimationFrame(() => ui.ready()));
    })
    .catch((e) => { console.error('dive: ' + (e && e.stack || e)); ui.failed(String((e && e.message) || e).slice(0, 80)); });
}

start();
