import 'lenis/dist/lenis.css';
import './styles.css';
import { thumbHashToDataURL } from 'thumbhash';
import { media } from './media';
import { Scroll } from './scroll';
import { UI } from './ui';
import type { World } from './world';
import type { Fmt } from './world/fish';

const root = document.documentElement;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = innerHeight > innerWidth * 1.05 || innerWidth < 640;
const wide = !phone && innerWidth > 760;

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

// A blurred preview of the marina while the real plate loads.
const hash = media.plates[phone ? 'z0p' : 'z0'].thumbhash;
document.getElementById('placeholder')!.style.backgroundImage =
  `url(${thumbHashToDataURL(Uint8Array.from(atob(hash), (c) => c.charCodeAt(0)))})`;

const gl = !reduce && hasWebGL();
// The page head already guessed 'gl' so the still plates don't start loading; correct it here.
root.classList.toggle('gl', gl);
root.classList.toggle('static', !gl);
if (wide) root.classList.add('wide');

let world: World | null = null;
const t0 = performance.now();
const now = () => (performance.now() - t0) / 1000;
const ui = new UI({
  gl, wide,
  onFormat: (f) => world?.setFormat(f, now()),
  onFocus: (f: Fmt | null) => world?.focusFormat(f),
  onRaceView: () => world?.raceOnce(now()),
  onLook: (l) => world?.setLook(l),
  onLookPreview: (l) => world?.previewLook(l),
  onFreeFish: () => world?.freeFish(),
});

if (gl) start();

async function start() {
  const scroll = new Scroll(true);
  const { World } = await import('./world');
  const canvas = document.getElementById('world') as HTMLCanvasElement;
  const w = new World(canvas, scroll, phone);
  world = w;
  w.load().catch((e) => console.warn('dive: loading failed', e));

  // The cursor drives ripples, glints and the fish; a tap does the same on phones.
  let tapTimer = 0;
  addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') w.mouse = [e.clientX, e.clientY]; });
  document.addEventListener('pointerleave', () => { w.mouse = null; });
  addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    w.mouse = [e.clientX, e.clientY];
    clearTimeout(tapTimer);
    tapTimer = window.setTimeout(() => { w.mouse = null; }, 1400);
  });

  // Phones resize as the address bar moves; only react to real changes.
  let lastW = innerWidth, lastH = innerHeight;
  addEventListener('resize', () => {
    if (innerWidth === lastW && Math.abs(innerHeight - lastH) < 140) return;
    lastW = innerWidth; lastH = innerHeight;
    scroll.measure();
    w.resize();
  });
  addEventListener('load', () => { scroll.measure(); w.measure(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) w.snap.pause(); });

  // Drop to a lighter pixel ratio if frames run slow.
  let slow = 0, frames = 0, lowered = false;
  let last = performance.now();
  const loop = (time: number) => {
    const dt = Math.min(0.05, (time - last) / 1000);
    last = time;
    scroll.update(time);
    w.frame(dt, now());
    const doc = document.documentElement.scrollHeight - innerHeight;
    ui.update(w.out, now(), scroll.v, doc > 0 ? scroll.y / doc : 0);
    if (!lowered && frames++ > 30) { slow = slow * 0.95 + (dt > 0.024 ? 1 : 0) * 0.05; if (slow > 0.6) { w.stage.setMaxDpr(1); lowered = true; } }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
