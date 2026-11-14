import 'lenis/dist/lenis.css';
import './styles.css';
import { thumbHashToDataURL } from 'thumbhash';
import { media, url } from './media';
import { Scroll } from './scroll';
import { UI } from './ui';
import type { World } from './world';
import type { Fmt } from './world/fish';
import { MAX_DPR, PHONE, PLATE_OVER, PLATE_SLACK, SNAP_SHARP, SNAP_TALL } from './first-view';

const root = document.documentElement;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const phone = innerHeight > innerWidth * PHONE.ratio || innerWidth < PHONE.width;
const wide = !phone && innerWidth > 760;

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

// A blurred preview of the marina while the real plate loads.
const hash = media.plates[phone ? 'z0p' : 'z0'].thumbhash ?? '';
document.getElementById('placeholder')!.style.backgroundImage =
  `url(${thumbHashToDataURL(Uint8Array.from(atob(hash), (c) => c.charCodeAt(0)))})`;

const gl = !reduce && hasWebGL();
// The page head already guessed 'gl' so the still plates don't start loading; correct it here.
root.classList.toggle('gl', gl);
root.classList.toggle('static', !gl);
if (wide) root.classList.add('wide');

let world: World | null = null;
const t0 = performance.now();
// ?slowmo=20 plays Snap and the world twenty times slower, for tuning animation (videos keep their own pace).
const slowmo = Math.max(1, Number(new URLSearchParams(location.search).get('slowmo')) || 1);
const now = () => (performance.now() - t0) / 1000 / slowmo;
const ui = new UI({
  gl, wide,
  onFormat: (f) => world?.setFormat(f, now()),
  onFocus: (f: Fmt | null) => world?.focusFormat(f),
  onRaceView: () => world?.raceOnce(now()),
  onLook: (l) => world?.setLook(l),
  onLookPreview: (l) => world?.previewLook(l),
  onFreeFish: () => world?.freeFish(),
  onRemove: (rect) => world?.removeRegion(rect),
  onUpscale: (again) => world?.upscalePearl(again),
  onReefFocus: (i) => { if (world) scrollRef?.to(world.reefStopY(i)); },
  onChoice: () => world?.noteChoice(),
  onSeal: (sealed) => world?.sealUrl(sealed),
  onSealLetter: () => world?.sealLetter(),
});
let scrollRef: Scroll | null = null;

if (gl) painted().then(start);

/**
 * Once the text has had its first paint. The world starts then, not before:
 * its script is large, and nothing should share the line or the processor
 * with the text on its way to the screen.
 */
function painted(): Promise<void> {
  return new Promise((res) => {
    let done = false;
    const go = () => { if (!done) { done = true; res(); } };
    try {
      new PerformanceObserver((list, po) => {
        if (list.getEntries().some((e) => e.name === 'first-contentful-paint')) { po.disconnect(); go(); }
      }).observe({ type: 'paint', buffered: true });
    } catch { /* no paint timing here: the frames below stand in */ }
    // (where the browser reports no paint: a little after its second frame; and a tab opened in the background
    // paints nothing until it is looked at)
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(go, 250)));
    setTimeout(go, 4000);
  });
}

/**
 * The world's first files, asked for together with its script. Left to the
 * world they would follow one another: its script, then the marina's plate,
 * then Snap's shape and texture. They are the files the world will ask for
 * (the rules both sides go by are in first-view.ts), so each is fetched once.
 */
function early() {
  const ask = (href: string, as: string, type?: string, priority?: string) => {
    const l = document.createElement('link');
    l.rel = 'preload';
    l.as = as;
    if (type) l.type = type;
    if (as === 'fetch') l.crossOrigin = 'anonymous';
    if (priority) l.setAttribute('fetchpriority', priority);
    l.href = href;
    document.head.appendChild(l);
  };
  const key = phone ? 'z0p' : 'z0', p = media.plates[key], dpr = Math.min(devicePixelRatio || 1, MAX_DPR);
  const need = Math.max(innerWidth, innerHeight * (p.w / p.h)) * dpr * PLATE_OVER * PLATE_SLACK;
  const width = p.widths.find((x) => x >= need) ?? p.widths[p.widths.length - 1];
  const tall = (phone ? SNAP_TALL.phone : SNAP_TALL.wide) * innerHeight * dpr;
  // (AVIF only: a browser without it skips these, and the world asks for the WebP files itself)
  ask(url(`${key}-${width}.avif`), 'image', 'image/avif', 'high');
  ask(url('snap-3d.txt'), 'fetch', undefined, 'low');
  ask(url(`snap-3d${tall > SNAP_SHARP ? '' : '-1024'}.avif`), 'image', 'image/avif');
}

async function start() {
  const scroll = new Scroll(true);
  scrollRef = scroll;
  early();
  const { World } = await import('./world');
  const canvas = document.getElementById('world') as HTMLCanvasElement;
  const w = new World(canvas, scroll, phone);
  world = w;
  // (in development the world is within reach of the scripts that photograph the page: scripts/snap-still.mjs)
  if (import.meta.env.DEV) (window as unknown as { __world: World }).__world = w;
  w.load().catch((e) => console.warn('dive: loading failed', e));

  // The cursor drives ripples, glints and the fish; a tap does the same on phones.
  let tapTimer = 0;
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    w.mouse = [e.clientX, e.clientY];
    document.body.classList.toggle('on-snap', w.snapHit(e.clientX, e.clientY) && !(e.target as Element).closest?.('a, button, input, label, .card, .panel'));
  });
  // Click or tap Snap and he answers: a spin round the chain, a wave, a snap of his pincer, a hop.
  addEventListener('click', (e) => {
    if ((e.target as Element).closest?.('a, button, input, label, select, textarea, .card, .panel')) return;
    if (w.snapHit(e.clientX, e.clientY)) w.pokeSnap();
  });
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
  // Where the sections are is measured again whenever the page's height changes: the fonts arriving re-flow the
  // text, and that can come after the first measure. (The window's load event used to be the cue, and it can fire
  // before the world's script is in to hear it: then the world ran a little out of step with the text.)
  new ResizeObserver(() => { scroll.measure(); w.measure(); }).observe(document.body);

  // "Dive again": the view fades to the next morning, the page goes back to the top behind it, and the day
  // starts over with Snap on the pier. (Left to itself the link would rewind through every zone.)
  const dawn = document.getElementById('dawn');
  document.getElementById('dive-again')?.addEventListener('click', (e) => {
    if (!dawn) return;
    e.preventDefault();
    e.stopPropagation();
    if (dawn.classList.contains('on')) return;
    dawn.classList.add('on');
    setTimeout(() => {
      scroll.lenis?.scrollTo(0, { immediate: true, force: true });
      scrollTo(0, 0);
      document.getElementById('s0-title')?.focus({ preventScroll: true });
      setTimeout(() => dawn.classList.remove('on'), 650);
    }, 480);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) w.rest(); });

  // Step down to a lighter pixel ratio if frames run slow: 1.5, then 1.
  const lighter = [1.5, 1];
  let slow = 0, frames = 0, level = 0;
  let last = performance.now();
  const loop = (time: number) => {
    const dt = Math.min(0.05, (time - last) / 1000 / slowmo);
    last = time;
    scroll.update(time);
    w.frame(dt, now());
    const doc = document.documentElement.scrollHeight - innerHeight;
    ui.update(w.out, now(), scroll.v, doc > 0 ? scroll.y / doc : 0, dt, w.mouse);
    if (level < lighter.length && frames++ > 30) {
      slow = slow * 0.95 + (dt > 0.024 ? 1 : 0) * 0.05;
      if (slow > 0.6) { w.stage.setMaxDpr(lighter[level++]); slow = 0; frames = 0; }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
