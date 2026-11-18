// The scene's hands-on layer: what in the 3D scene can be pointed at, touched or named, and
// the words tied to it. Each zone's module (src/zones/*.js) puts its pieces here; main.js
// builds the zones' scene parts with the rest of the world, mounts them once the dive runs,
// and calls stage.frame(p, dt) every frame after the camera is placed.
//
// A zone module is { id, build(ctx), mount(stage, world), frame(stage) }, every member
// optional: build is a scene part (ctx as in app.js: add, scene, engine, q, camera; it may
// return { update(t, dt, p) }), mount sets up its page pieces (world: { sets, fauna, cast,
// engine, scene, camera, print, audio }), frame runs once a frame.
//
// All lengths here are CSS pixels of the window: x from the left, y from the top.
//
// The rules the painted dive settled on, kept: a cursor counts as the visitor's hand only if
// it moved in the last 2.5 s (a resting cursor finds and dismisses nothing), a tap counts for
// 1.4 s, a touch that turns into a scroll is not a tap; a cue goes only once the visitor has
// done what it asks, says so with a tick for 4 s, then fades; labels are kept inside the
// view while their yarn stays on the thing; on narrow screens nothing is tied to things (the
// dock asks instead).
import { Vector3 } from 'three/webgpu';
import { G } from './shaders.js';

const LIVE_MOUSE = 2.5, LIVE_TAP = 1.4;
const now = () => performance.now() / 1000;
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function createStage({ camera, ui }) {
  const doc = document, root = doc.documentElement;
  const layer = doc.getElementById('fx'), dockEl = doc.getElementById('dock'), noteEl = doc.getElementById('note');
  const v = new Vector3();
  const pointer = { x: -1e4, y: -1e4, moved: -1e9, tapAt: -1e9, kind: 'mouse', down: null, tapX: -1e4, tapY: -1e4 };
  let overAt = -1, overWords = false;

  const stage = {
    camera, ui, layer, pointer,
    W: innerWidth, H: innerHeight, wide: true, p: 0, t: 0, dt: 0, frameNo: 0,
    zones: [],

    // ---- where things are on the screen ----------------------------------------------------

    // A point of the world (a Vector3 or [x, y, z]) on the screen: out = [x, y, depth], depth in
    // metres along the view (not in front of the camera when <= 0).
    project(at, out = [0, 0, 0]) {
      if (Array.isArray(at)) v.set(at[0], at[1], at[2]); else v.copy(at);
      v.applyMatrix4(camera.matrixWorldInverse);
      const depth = -v.z;
      v.applyMatrix4(camera.projectionMatrix);
      out[0] = (v.x * 0.5 + 0.5) * stage.W;
      out[1] = (0.5 - v.y * 0.5) * stage.H;
      out[2] = depth;
      return out;
    },
    // how many pixels a metre is, at that depth
    pxPerMetre(depth) { return stage.H / (2 * Math.max(depth, 0.05) * Math.tan((camera.fov * Math.PI) / 360)); },
    onScreen(x, y, pad = 0) { return x > -pad && x < stage.W + pad && y > -pad && y < stage.H + pad; },

    // ---- the visitor's hand -----------------------------------------------------------------

    // whether the pointer is the visitor's hand now (a cursor that moved lately, or a tap)
    live() { const t = now(); return (pointer.kind !== 'touch' && t - pointer.moved < LIVE_MOUSE) || t - pointer.tapAt < LIVE_TAP; },
    // where it is: the cursor, or the last tap while it counts
    hand(out = [0, 0]) {
      const t = now();
      if (t - pointer.tapAt < LIVE_TAP && (pointer.kind === 'touch' || pointer.tapAt > pointer.moved)) { out[0] = pointer.tapX; out[1] = pointer.tapY; } else { out[0] = pointer.x; out[1] = pointer.y; }
      return out;
    },
    // the hand within r of (x, y)
    near(x, y, r) { if (!stage.live()) return false; const h = stage.hand(H2); return Math.hypot(h[0] - x, h[1] - y) < r; },
    // the hand is over the words, the bar, the gauge or a cue (once a frame)
    overWords() {
      if (overAt !== stage.frameNo) {
        overAt = stage.frameNo;
        const h = stage.hand(H2), e = doc.elementFromPoint(h[0], h[1]);
        overWords = !!(e && e.closest('.beat, .bar, .gauge, .dock, .cue, .note, button, a, input, label'));
      }
      return overWords;
    },

    // ---- pieces --------------------------------------------------------------------------------

    el(tag, cls, parent = layer, html = '') {
      const e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (html) e.innerHTML = html;
      if (parent) parent.append(e);
      return e;
    },
    // A cue: a verb on a sun badge, then the thing it is done to ({ verb, text, more }), and what it
    // says once done ({ verb: '✓', text, more }). tie: hung by a stitch of yarn at a point ({ knot,
    // yarn, gap, under }: px; wide screens only). big: the dock's size. button: a real button.
    cue(o) {
      const tag = o.button ? 'button' : 'span';
      const part = (c, d) => '<b class="do">' + esc(d.verb) + '</b><span>' + d.text + (d.more ? ' <span class="more">' + d.more + '</span>' : '') + '</span>';
      const e = stage.el(tag, 'cue' + (o.big ? ' big' : '') + (o.tie ? ' tie' : '') + (o.under ? ' under' : '') + (o.cls ? ' ' + o.cls : ''), o.parent === undefined ? layer : o.parent,
        '<span class="ask">' + part('ask', o) + '</span>' + (o.done ? '<span class="did">' + part('did', { verb: '✓', ...o.done }) + '</span>' : ''));
      if (o.button) e.type = 'button';
      const c = {
        el: e, on: false, isDone: false, w: 0, h: 0, knot: o.knot ?? 34, yarn: o.yarn ?? 24, gap: o.gap ?? 0, under: !!o.under, last: '',
        show(on) { if (on !== c.on) { c.on = on; e.classList.toggle('on', on); if (on) c.w = 0; } return c; },
        done(d) { if (d !== c.isDone) { c.isDone = d; e.classList.toggle('done', d); c.w = 0; } return c; },
        gone(g) { e.classList.toggle('gone', g); return c; },
        // hang it with its yarn's end at (x, y): the label slides to stay in the view
        at(x, y) {
          if (!c.w) { c.w = e.offsetWidth; c.h = e.offsetHeight; }
          const m = 12, right = stage.wide ? 64 : 12;
          const want = x - c.knot, left = Math.min(Math.max(want, m), stage.W - right - c.w);
          const top = c.under ? y + c.yarn + c.gap : y - c.h - c.yarn - c.gap;
          const key = Math.round(left) + ',' + Math.round(top) + ',' + Math.round(x - left);
          if (key !== c.last) {
            c.last = key;
            e.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round(top) + 'px)';
            e.style.setProperty('--yx', Math.round(x - left) + 'px');
          }
          return c;
        },
      };
      if (o.tie) { e.style.setProperty('--yarn', c.yarn + 'px'); }
      return c;
    },
    // The one ring for every thing in the world that can be touched: stitched, a sun centre,
    // breathing. beacon: not a button (it marks what the hand should go over). label: its name
    // for screen readers (a button).
    ring(o = {}) {
      const e = stage.el(o.beacon ? 'span' : 'button', 'ring' + (o.beacon ? ' beacon' : ''), o.parent === undefined ? layer : o.parent);
      if (!o.beacon) { e.type = 'button'; e.setAttribute('aria-label', o.label || ''); } else e.setAttribute('aria-hidden', 'true');
      const r = {
        el: e, on: false, last: '',
        show(on) { if (on !== r.on) { r.on = on; e.classList.toggle('on', on); } return r; },
        done(d) { e.classList.toggle('done', d); return r; },
        at(x, y) { const key = Math.round(x) + ',' + Math.round(y); if (key !== r.last) { r.last = key; e.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)'; } return r; },
      };
      return r;
    },

    // ---- the dock: one big cue at a time at the foot of the open water (on phones, under the
    // bar), for what has no one thing to tie it to and for what narrow screens cannot tie ----
    dock: {
      cues: new Map(), current: null,
      // ask(id, spec) makes a cue the first time; show(id) shows it (null: none)
      ask(id, spec) { if (!this.cues.has(id)) this.cues.set(id, stage.cue({ ...spec, big: true, parent: dockEl })); return this.cues.get(id); },
      show(id) {
        if (id === this.current) return;
        if (this.current && this.cues.has(this.current)) this.cues.get(this.current).show(false);
        this.current = id;
        if (id && this.cues.has(id)) this.cues.get(id).show(true);
      },
    },

    // ---- a burst of sparkles at a point of the world (a Vector3 or [x, y, z]) or of the
    // screen ([x, y]): for a snip, a seal, a find ---------------------------------------------
    // (kind 'drop': water drops instead, for a splash)
    sparkle(at, n = 8, kind = '') {
      let x, y;
      if (Array.isArray(at) && at.length === 2) { x = at[0]; y = at[1]; } else { const q = stage.project(at, SP); if (q[2] <= 0) return; x = q[0]; y = q[1]; }
      for (let i = 0; i < n; i++) {
        const e = stage.el('i', kind ? 'spark ' + kind : 'spark');
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.6, r = 26 + Math.random() * 30;
        e.style.left = Math.round(x) + 'px'; e.style.top = Math.round(y) + 'px';
        e.style.setProperty('--dx', Math.round(Math.cos(a) * r) + 'px'); e.style.setProperty('--dy', Math.round(Math.sin(a) * r) + 'px');
        e.style.animationDelay = Math.round(Math.random() * 90) + 'ms';
        setTimeout(() => e.remove(), 900);
      }
    },

    // ---- Snap's story: a note, timed to what happened -------------------------------------
    note(html, secs = 7) {
      noteEl.querySelector('p').innerHTML = html;
      noteEl.classList.add('on');
      clearTimeout(stage._noteT);
      stage._noteT = setTimeout(() => noteEl.classList.remove('on'), secs * 1000);
    },

    // ---- the five choices ------------------------------------------------------------------
    // ui.choices: { format, look, crop, finish, seal }, each the index of the picked option
    // (content.js: KEYS, OPTIONS, NOTES); choose() picks one as if its radio were clicked;
    // onChoice(fn(key, i)) when one is picked; onPreview(fn(key, i or null)) while an option
    // is hovered or focused (null when it is left)
    get choices() { return ui.choices; },
    choose(key, i) { ui.choose(key, i); },
    onChoice(fn) { ui.onChoice.push(fn); },
    onPreview(fn) { ui.onPreview.push(fn); },

    // ---- each frame ----------------------------------------------------------------------
    frame(p, dt) {
      stage.p = p; stage.dt = dt; stage.t = now(); stage.frameNo++;
      // the hand, for the shaders that answer it
      const h = stage.hand(H2), on = stage.live() ? 1 : 0;
      handOn += (on - handOn) * (dt > 0 ? Math.min(1, dt * 6) : 1);
      G.hand.value.set((h[0] / stage.W) * 2 - 1, 1 - (h[1] / stage.H) * 2, handOn, stage.W / stage.H);
      for (let i = 0; i < stage.zones.length; i++) { const z = stage.zones[i]; if (z.frame) z.frame(stage); }
    },
  };
  const H2 = [0, 0], SP = [0, 0, 0];
  let handOn = 0;

  // the window: its size, and whether this is the wide layout (the words on the left)
  const size = () => {
    stage.W = innerWidth; stage.H = innerHeight;
    stage.wide = innerWidth > 760 && innerWidth >= innerHeight;
    root.classList.toggle('wide', stage.wide);
    for (const c of stage.dock.cues.values()) c.w = 0;
  };
  size();
  addEventListener('resize', size);

  // the hand: a mouse or pen moving; a tap (a touch, or a click, that did not travel)
  addEventListener('pointermove', (e) => {
    pointer.kind = e.pointerType || 'mouse';
    if (pointer.kind === 'touch') return;
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.moved = now();
  }, { passive: true });
  addEventListener('pointerdown', (e) => {
    pointer.kind = e.pointerType || 'mouse';
    pointer.down = { x: e.clientX, y: e.clientY, t: now() };
    if (pointer.kind !== 'touch') { pointer.x = e.clientX; pointer.y = e.clientY; pointer.moved = now(); }
  }, { passive: true });
  addEventListener('pointerup', (e) => {
    const d = pointer.down;
    pointer.down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10 || now() - d.t > 0.6) return;
    pointer.tapX = e.clientX; pointer.tapY = e.clientY; pointer.tapAt = now();
    if (e.pointerType === 'touch') { pointer.x = e.clientX; pointer.y = e.clientY; }
  }, { passive: true });
  addEventListener('pointercancel', () => { pointer.down = null; }, { passive: true });

  return stage;
}
