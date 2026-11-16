// Dev only, never shipped: the page shell (ui.js, audio.js) running without the scene. A
// stand-in loop eases p toward ui.pTo as the dive does, calls ui.frame and audio.frame, and
// paints the canvas with renders of the real scene for the sunlit zones (the test server
// serves them at bg/*.jpg) and dark gradients below, drifting slowly, so the words can be
// judged against something bright and moving.
//
//   node build.mjs --dev --entry=dev/page-harness.js --out=<folder>/page.html
//
//   ?fast      the scene is "ready" at once      ?noload   it never is
//   ?fail      it fails after a second           ?page     the page, as always
import { createUI, depthAt } from '../src/ui.js';
import { createAudio } from '../src/audio.js';

const params = new URLSearchParams(location.search);
const audio = createAudio();
const log = [];
const ui = createUI({
  level: params.get('level') || 'auto',
  onLevel: (name) => log.push('level ' + name),
  onSound: (on) => { audio.setEnabled(on); log.push('sound ' + on); },
  onChoice: (key, i) => { audio.cue('choice'); log.push('choice ' + key + ' ' + i); },
  onStart: () => { audio.cue('start'); log.push('start'); },
});
const H = { ui, audio, log, p: 0, frames: 0, pointer: '', createAudio, depthAt };
window.__page = H;

// the stand-in scene
const canvas = document.getElementById('world');
const g = canvas.getContext('2d');
const pic = (name) => { const i = new Image(); i.src = 'bg/' + name + '.jpg'; return i; };
const PICS = { 0: pic('surface'), 1: pic('shallows'), 2: pic('kelp'), 3: pic('reef'), 8: pic('surface') };
// the deep: top and bottom colours of a gradient, and a glow from below for the vents
const DARK = { 4: ['#0d4058', '#06202e', 0], 5: ['#05202d', '#010609', 0], 6: ['#030a0e', '#010203', 1], 7: ['#06283a', '#0a4a63', 0] };
let W = 0, Hh = 0, lookX = 0, lookY = 0, lookXTo = 0, lookYTo = 0;
function size() { W = canvas.width = innerWidth; Hh = canvas.height = innerHeight; }
size();
addEventListener('resize', size);
addEventListener('pointermove', (e) => {
  H.pointer = e.target.id || e.target.tagName;
  if (e.pointerType === 'touch') return;
  lookXTo = (e.clientX / innerWidth - 0.5) * 2;
  lookYTo = (e.clientY / innerHeight - 0.5) * 2;
}, { passive: true });

function layer(i, alpha, t) {
  if (alpha <= 0) return;
  g.globalAlpha = alpha;
  const img = PICS[i];
  if (img && img.complete && img.naturalWidth) {
    // cover the window, drifting and zooming a little, nudged by the pointer
    const z = 1.12 + 0.03 * Math.sin(t * 0.13 + i);
    const s = Math.max(W / img.naturalWidth, Hh / img.naturalHeight) * z;
    const w = img.naturalWidth * s, h = img.naturalHeight * s;
    const x = (W - w) / 2 + (w - W) * 0.3 * (Math.sin(t * 0.07 + i) * 0.5 - lookX * 0.5);
    const y = (Hh - h) / 2 + (h - Hh) * 0.3 * (Math.cos(t * 0.05 + i) * 0.5 - lookY * 0.5);
    g.drawImage(img, x, y, w, h);
  } else {
    const d = DARK[i] || ['#0b3446', '#04121a', 0];
    const gr = g.createLinearGradient(0, 0, 0, Hh);
    gr.addColorStop(0, d[0]);
    gr.addColorStop(1, d[1]);
    g.fillStyle = gr;
    g.fillRect(0, 0, W, Hh);
    if (d[2]) {
      const r = g.createRadialGradient(W * 0.62, Hh * 1.05, 10, W * 0.62, Hh * 1.05, Hh * 0.7);
      r.addColorStop(0, 'rgba(255,120,40,.35)');
      r.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, W, Hh);
    }
  }
}
function paint(p, t) {
  // each zone's picture, and the next one fading in over its last third
  const i = Math.min(7, Math.floor(p)), f = p - i;
  layer(i, 1, t);
  const next = i === 7 ? 8 : i + 1;
  layer(next, Math.max(0, (f - 0.66) / 0.34), t);
  g.globalAlpha = 1;
}

// the stand-in loading
const STAGES = ['Filling the sea', 'Laying the sand', 'Growing the kelp', 'Building the reef', 'Sinking the wreck', 'Lighting the vents'];
if (ui.mode === 'dive') {
  if (params.has('fast')) ui.ready();
  else if (!params.has('noload')) {
    let k = 0;
    const tick = setInterval(() => {
      k++;
      ui.loading(k / (STAGES.length + 1), STAGES[Math.min(k, STAGES.length - 1)]);
      if (k > STAGES.length) { clearInterval(tick); ui.ready(); }
    }, 450);
    ui.loading(0, STAGES[0]);
  }
  if (params.has('fail')) setTimeout(() => ui.failed('WebGL 2 could not start'), 1000);
}

// the loop, as the dive runs it
let last = performance.now(), zone = 0, fpsT = 0, fpsN = 0, fps = 0;
function loop(now) {
  if (ui.mode !== 'dive') return;
  requestAnimationFrame(loop);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  const k = 1 - Math.exp(-dt * 5.5);
  const prev = H.p;
  H.p += (ui.pTo - H.p) * k;
  lookX += (lookXTo - lookX) * k * 0.5;
  lookY += (lookYTo - lookY) * k * 0.5;
  ui.frame(H.p, dt);
  audio.frame(H.p, depthAt(H.p), Math.abs(H.p - prev) / Math.max(dt, 1e-3), dt);
  const z = Math.min(7, Math.floor(H.p));
  if (z !== zone) { zone = z; audio.cue('zone'); }
  if (prev < 7.7 && H.p >= 7.7) audio.cue('surface');
  paint(H.p, now / 1000);
  H.frames++;
  fpsN++;
  fpsT += dt;
  if (fpsT >= 0.5) {
    fps = fpsN / fpsT;
    fpsN = 0;
    fpsT = 0;
    if (ui.statsOn) ui.stats(fps.toFixed(0) + ' fps\np ' + H.p.toFixed(3) + ' → ' + ui.pTo.toFixed(3) + '\nzone ' + zone);
  }
}
requestAnimationFrame(loop);
