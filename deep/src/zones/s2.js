// The kelp forest (zone s2), as in the painted dive (experience/src/ui.ts, world/look.ts,
// world/netfish.ts): its words are in zones/s2.html, its styles in zones/s2.css.
//   - The look on the whole forest: while the camera is in the kelp the picked look holds on
//     the whole picture (easing in and out at the forest's edges); a look option or a silk
//     curtain shows its look while it is hovered or focused, and leaving it brings back the
//     picked one.
//   - Three silk curtains hang over the way, one per look; on wide screens each has a pill
//     and is a button: hover to try its look, click to keep it (the radio is set).
//   - A little fish is caught in an old fishing line by Snap's raised claw: click (tap) it, or
//     its button, and Snap snips the line; the line springs away, the fish spins free and
//     swims loops by Snap for the rest of the forest. If nobody does, he snips it himself
//     three quarters of a screen into the forest. Snap's story says so for 5 s.
//   - The Chained filters card shows the visitor's print in the look being tried or kept, and
//     its filters; the look tiles show the print in each look; the Size card frames one print
//     three ways.
import { Vector3 } from 'three/webgpu';
import { OPTIONS } from '../content.js';
import { smooth } from '../math.js';
import { G } from '../shaders.js';
import { createFish } from '../props/shallows.js';
import { CURTAIN_LOOK, LOOK_NAMES, buildCurtains, buildLine, fitInto } from '../props/kelp.js';

// the curtains: hung across the way, ahead of the camera as the look is chosen; the camera
// passes under their hems near p 2.74
const CURTAINS = { centre: [-8.4, -92.0], along: [1, 0], facing: [0, 1], high: 12.2, drop: 7.0, width: 1.75, gap: 2.45 };
const CURTAIN_PILLS = ['Vintage <code>sepia</code>', 'Deep sea <code>duotone</code>', 'Crisp <code>sharpen · saturation</code>'];
const FISH_LEN = 0.24;
const NOTE = 'A little fish is caught in an old fishing line. Snap clicks his claw, snips it, and the fish spins free. It follows him for a while.';

const S = {
  fish: null, line: null, curtains: null, camera: null, cast: null,
  state: 'tangled', byHimself: false, lastTap: 0, since: 0, rho: 0, x: 0, y: 0, z: 0, vx: 0, turn: -Math.PI + 0.3, wag: 0, placed: false, pAuto: 2.38,
  preview: null, hoverC: -1, lookShown: 0, lookMix: 1, held: false,
  looks: [null, null, null], whole: null, jobs: [], busy: false, stale: true,
};
// (dev builds only: for probes)
if (DEV) window.__s2 = S;
const R = new Vector3(), U = new Vector3(), F = new Vector3(), P = new Vector3(), FW = new Vector3(), UP = new Vector3(), V = new Vector3();
const PR = [0, 0, 0], PT = [0, 0, 0], PH = [0, 0, 0];

// whether the page's words (or the bar, a note, the dock) are over a point of the window
function underWords(x, y) { const e = document.elementFromPoint(x, y); return !!(e && e.closest('.beat, .bar, .note, .dock')); }
// the view's own frame, from the camera
function frameOf(cam) { const e = cam.matrixWorld.elements; R.set(e[0], e[1], e[2]); U.set(e[4], e[5], e[6]); F.set(-e[8], -e[9], -e[10]); }
// a point of the world in the view's frame (right, up, forward from the eye)
function local(v, cam, out) { V.copy(v).sub(cam.position); out[0] = V.dot(R); out[1] = V.dot(U); out[2] = V.dot(F); return out; }
const L3 = [0, 0, 0], L4 = [0, 0, 0];

// The little fish: tangled by Snap's raised claw, snipped (spinning free), then free, looping
// by his right side. Placed in the view's frame each frame, so it keeps up with him.
function moveFish(stage, p) {
  const cam = S.camera, t = G.time.value, dt = Math.min(stage.dt || 0, 0.1), jump = dt <= 0 || !S.placed;
  frameOf(cam);
  const phone = cam.aspect < 1, L = FISH_LEN;
  // Snap's raised claw and his middle, in the view (where he usually is, if he is off on a card)
  const gx0 = phone ? -0.2 : 0.55, gy0 = phone ? 0.55 : 0.05, gz0 = phone ? 2.46 : 2.12;
  const sx0 = phone ? 0 : 0.72, sy0 = phone ? 0.43 : -0.03, sz0 = phone ? 2.45 : 2.0;
  let gx = gx0, gy = gy0, gz = gz0, sx = sx0, sy = sy0, sz = sz0;
  if (S.cast && S.cast.snap.ready) {
    local(S.cast.gripAt(P), cam, L3); local(S.cast.snapAt(P), cam, L4);
    if (Math.hypot(L3[0] - gx0, L3[1] - gy0, L3[2] - gz0) < 0.6) { gx = L3[0]; gy = L3[1]; gz = L3[2]; }
    if (Math.hypot(L4[0] - sx0, L4[1] - sy0, L4[2] - sz0) < 0.6) { sx = L4[0]; sy = L4[1]; sz = L4[2]; }
  }
  const age = t - S.since;
  let tx, ty, tz, rho = 0, fwd = 0;
  if (S.state === 'snip' && age > 0.8) { S.state = 'free'; S.since = t; }
  if (S.state === 'tangled') {
    // just off the claw, out in the open water; let down on its line as the forest begins
    tx = gx + (phone ? -0.27 : -0.36) + Math.sin(t * 7) * L * 0.06;
    ty = gy + (phone ? 0.08 : -0.02) + (1 - smooth(1.95, 2.07, p)) * 1.4;
    tz = gz + 0.12;
    rho = Math.sin(t * 5.5) * 0.25;
    S.wag += dt * Math.PI * 2 * 3.2;
  } else if (S.state === 'snip') {
    tx = S.x; ty = S.y + dt * L * 0.6; tz = S.z;
    S.rho += dt * 14 * (1 - Math.min(age / 0.8, 1));
    rho = S.rho;
    S.wag += dt * Math.PI * 2 * 2;
  } else {
    // loops by his right side; past the forest it swims off
    const a = t * 0.9, away = smooth(2.93, 3.05, p);
    tx = sx + (phone ? 0.3 : 0.46) + Math.cos(a) * 0.22 + away * 2.2;
    ty = sy + (phone ? -0.14 : 0.06) + Math.sin(a * 1.3) * 0.14 + away * 0.6;
    tz = sz + 0.1 + Math.sin(a * 0.7) * 0.18;
    fwd = 1;
    S.wag += dt * Math.PI * 2 * 2.2;
  }
  const k = S.state === 'free' ? 1 - Math.exp(-dt * 1.8) : 1 - Math.exp(-dt * 12);
  if (jump) { S.x = tx; S.y = ty; S.z = tz; }
  const ox = S.x;
  S.x += (tx - S.x) * k; S.y += (ty - S.y) * k; S.z += (tz - S.z) * k;
  if (dt > 0) S.vx = S.vx * 0.9 + ((S.x - ox) / dt) * 0.1;
  // tangled it pulls away from him (facing left), rocking; free it faces the way it goes
  if (fwd) {
    const want = Math.abs(S.vx) > 0.03 ? (S.vx > 0 ? -0.3 : -Math.PI + 0.3) : S.turn;
    S.turn += (want - S.turn) * (jump ? 1 : 1 - Math.exp(-dt * 5));
  } else S.turn = -Math.PI + 0.3;
  const cx = Math.cos(S.turn), cz = Math.sin(S.turn);
  // (turned, then rolled about the line of sight by rho)
  const fx = cx * Math.cos(rho), fy = cx * Math.sin(rho);
  FW.copy(R).multiplyScalar(fx).addScaledVector(U, fy).addScaledVector(F, cz).normalize();
  UP.copy(R).multiplyScalar(-Math.sin(rho)).addScaledVector(U, Math.cos(rho));
  UP.addScaledVector(FW, -FW.dot(UP)).normalize();
  P.copy(cam.position).addScaledVector(R, S.x).addScaledVector(U, S.y).addScaledVector(F, S.z);
  const shown = p > 1.95 && p < 3.05;
  S.fish.set(0, P, FW, UP, shown ? L : 0, S.wag, S.state === 'tangled' ? 1.5 : 1.1);
  // the line: from high above it, out of the view
  const cut = S.state === 'tangled' ? 0 : S.state === 'snip' ? Math.min(age / 0.5, 1) : 1;
  S.line.cut.value = cut;
  S.line.show.value = shown ? 1 : 0;
  S.line.mesh.visible = shown && cut < 1;
  S.line.top.value.copy(cam.position).addScaledVector(R, S.x + 0.12).addScaledVector(U, S.y + 3.4).addScaledVector(F, S.z + 0.3);
  S.placed = true;
  S.fishAt = P;
}

export default {
  id: 's2',
  build(ctx) {
    const { scene, camera, q } = ctx;
    S.camera = camera; S.cast = ctx.cast;
    const lod = q.amount >= 0.5 ? 1 : 0;
    S.fish = createFish(scene, [{ kind: 'jpeg', seed: 0.37 }], lod);
    S.line = buildLine(scene, S.fish.POSE, 0);
    S.curtains = buildCurtains(scene, { ...CURTAINS, lod });
    return {
      update(t, dt, p) {
        S.curtains.show(p > 2.05 && p < 2.82);
        S.fish.show(p > 1.95 && p < 3.05);
      },
    };
  },

  mount(stage, world) {
    const doc = document;
    S.world = world;
    // ---- the curtains: a button over each (wide screens), its pill; the cue on the middle one
    S.silks = [0, 1, 2].map((c) => {
      // (the middle one's pill sits higher, so neighbours' pills never sit on each other)
      const b = stage.el('button', c === 1 ? 'silk mid' : 'silk', stage.layer, '<span class="pill">' + CURTAIN_PILLS[c] + '</span>');
      b.type = 'button';
      b.tabIndex = -1;
      b.setAttribute('aria-label', LOOK_NAMES[c] + ' look, on the curtain');
      b.setAttribute('aria-pressed', String(stage.choices.look === CURTAIN_LOOK[c]));
      const o = { el: b, c, on: false, hot: false, focus: false, last: '' };
      b.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch' && stage.live()) o.hot = true; });
      b.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') o.hot = true; });
      b.addEventListener('pointerleave', () => { o.hot = false; });
      b.addEventListener('focus', () => { o.focus = true; });
      b.addEventListener('blur', () => { o.focus = false; });
      b.addEventListener('click', () => stage.choose('look', CURTAIN_LOOK[c]));
      return o;
    });
    S.cueSilk = stage.cue({ verb: 'Hover', text: 'a curtain to try a look, <b class="do">Click</b> to keep it', done: { text: 'Tried', more: '· click a curtain to keep its look' }, tie: true, knot: 70, yarn: 22 });
    S.tried = -1; S.cueGone = false;
    // ---- the look being tried or kept: the card's specimen, the forest
    stage.onPreview((key, i) => { if (key === 'look') S.preview = i; });
    const chain = doc.getElementById('look-chain'), spec = doc.getElementById('look-print');
    let shownSpec = -1;
    S.showSpec = (k, force = false) => {
      if ((k === shownSpec && !force) || !S.looks[k]) return;
      shownSpec = k;
      fitInto(spec, S.looks[k], 'cover');
      chain.textContent = 'filters:' + OPTIONS.look[k];
    };
    S.chain = chain;
    stage.onChoice((key, i) => {
      if (key === 'look') {
        for (const o of S.silks) o.el.setAttribute('aria-pressed', String(CURTAIN_LOOK[o.c] === i));
        S.wholeStale = true;
      }
      if (key === 'crop' || key === 'finish') S.stale = true;
    });
    // ---- the tangled fish's button, tied to it
    S.free = stage.cue({ verb: 'Click', text: 'the fish to cut it free', button: true, cls: 'free-fish' });
    S.freeVerb = S.free.el.querySelector('.do');
    S.free.el.addEventListener('click', () => snip(stage));
    S.freeOn = false; S.freeSide = null; S.freeLast = ''; S.frameNo = 0; S.covered = false;
    // where the fish is snipped by itself: three quarters of a screen past the forest's top
    // (as the painted dive had it: the section's top three quarters of a window up the page)
    const sec = doc.getElementById('s2');
    const measureAuto = () => { if (sec && sec.offsetHeight) S.pAuto = Math.min(2.5, Math.max(2.2, 2 + (1.6 * innerHeight) / sec.offsetHeight)); };
    measureAuto();
    addEventListener('resize', measureAuto);
    // ---- the print in each look, for the card and the tiles; and whole, for the Size card
    S.tiles = [...doc.querySelectorAll('#s2 .looks .swatch')];
    S.frames = [...doc.querySelectorAll('#s2 .spec-size canvas')];
  },

  frame(stage) {
    const p = stage.p, world = S.world;
    if (!S.fish || !world) return;
    const dt = stage.dt || 0;

    // ---- the look on the whole forest
    const amt = smooth(1.96, 2.12, p) * (1 - smooth(2.9, 3.04, p));
    let hotC = -1;
    for (let i = 0; i < 3; i++) { const o = S.silks[i]; if (o.on && (o.hot || o.focus)) { hotC = i; break; } }
    const want = S.preview ?? (hotC >= 0 ? CURTAIN_LOOK[hotC] : stage.choices.look);
    if (dt <= 0) { S.lookShown = want; S.lookMix = 1; }
    else if (want !== S.lookShown) { S.lookMix -= dt * 9; if (S.lookMix <= 0) { S.lookMix = 0; S.lookShown = want; } }
    else S.lookMix = Math.min(1, S.lookMix + dt * 5);
    const a = amt * S.lookMix;
    if (world.engine && (a > 0.001 || S.held)) { world.engine.holdLook(S.lookShown + 1, a); S.held = a > 0.001; }
    if (S.showSpec) S.showSpec(want);

    // ---- the curtains' buttons and pills (wide screens), and their cue
    const cam = S.camera, cu = S.curtains;
    const near = stage.wide && p > 2.36 && p < 2.69;
    for (const o of S.silks) {
      let on = false;
      if (near) {
        stage.project(cu.tops[o.c], PT); stage.project(cu.hems[o.c], PH);
        if (PH[2] > 3.5 && PT[2] > 3.5 && PH[2] < 19 && stage.onScreen(PH[0], PH[1], -10)) {
          const w = Math.max(54, cu.width * stage.pxPerMetre(PH[2]) * 0.92), top = Math.max(PT[1], 70), h = PH[1] - top;
          if (h > 60) {
            on = true;
            const key = Math.round(PH[0] - w / 2) + ',' + Math.round(top) + ',' + Math.round(w) + ',' + Math.round(h);
            if (key !== o.last) { o.last = key; o.el.style.transform = 'translate(' + Math.round(PH[0] - w / 2) + 'px,' + Math.round(top) + 'px)'; o.el.style.width = Math.round(w) + 'px'; o.el.style.height = Math.round(h) + 'px'; }
            o.x = PH[0]; o.y = PH[1];
          }
        }
      }
      if (on !== o.on) { o.on = on; o.el.classList.toggle('on', on); o.el.tabIndex = on ? 0 : -1; if (!on) { o.hot = false; } }
      const hot = on && (o.hot || o.focus);
      if (hot !== o.hotShown) { o.hotShown = hot; o.el.classList.toggle('hot', hot); }
    }
    if (hotC >= 0 && S.tried < 0) S.tried = stage.t;
    const mid = S.silks[1], cueOn = mid.on && (S.tried < 0 || stage.t - S.tried < 2.2);
    // (over the middle curtain's pill, which sits 76 px up from its hem)
    if (cueOn) S.cueSilk.at(mid.x, mid.y - 124);
    S.cueSilk.show(cueOn).done(S.tried >= 0);
    if ((S.tried >= 0) !== S.cueGone) { S.cueGone = S.tried >= 0; S.cueSilk.gone(S.cueGone); }
    cu.hover.value.set(S.silks[0].hotShown ? 1 : 0, S.silks[1].hotShown ? 1 : 0, S.silks[2].hotShown ? 1 : 0);

    // ---- the tangled fish
    // (tangled again when the visitor goes back into the shallows; and, if he snipped it by
    // himself, when they scroll back above where he did, so they can free it themselves)
    if (S.state !== 'tangled' && (p < 1.93 || (S.byHimself && p < S.pAuto - 0.06))) { S.state = 'tangled'; S.rho = 0; S.byHimself = false; }
    if (S.state === 'tangled' && p >= S.pAuto && p < 2.95) { snip(stage); S.byHimself = true; }
    // a click or tap on the fish itself frees it too
    if (stage.pointer.tapAt > (S.lastTap || 0)) {
      S.lastTap = stage.pointer.tapAt;
      if (S.state === 'tangled' && S.fishAt && p > 2.0 && p < 2.95) {
        stage.project(S.fishAt, PR);
        const r = Math.max(28, FISH_LEN * 0.7 * stage.pxPerMetre(Math.max(PR[2], 0.3)));
        if (PR[2] > 0.3 && Math.hypot(stage.pointer.tapX - PR[0], stage.pointer.tapY - PR[1]) < r) snip(stage);
      }
    }
    if (p > 1.94 && p < 3.06) moveFish(stage, p); else { S.fish.hide(0); S.line.mesh.visible = false; S.placed = false; }
    // its button: beside it while there is room (and Snap is not there), else under it
    let showFree = false;
    if (S.state === 'tangled' && p > 2.02 && p < 3.0 && S.fishAt) {
      stage.project(S.fishAt, PR);
      if (PR[2] > 0.5 && stage.onScreen(PR[0], PR[1], -20)) {
        const verb = stage.wide ? 'Click' : 'Tap';
        if (S.freeVerb.textContent !== verb) { S.freeVerb.textContent = verb; S.free.w = 0; }
        const el = S.free.el;
        if (!S.free.w) { S.free.w = el.offsetWidth || 260; S.free.h = el.offsetHeight || 42; }
        const w = S.free.w, h = S.free.h, fx = PR[0], fy = PR[1];
        // (Snap is to the fish's right: beside it only if the button clears him)
        stage.project(S.cast ? S.cast.snapAt(V) : V, PT);
        const snapLeft = PT[0] - 0.42 * stage.pxPerMetre(Math.max(PT[2], 0.5));
        const side = stage.wide && fx + 48 + w < Math.min(stage.W - 70, fx < PT[0] ? snapLeft : stage.W);
        const x = side ? fx + 46 : Math.min(Math.max(fx - 40, 12), stage.W - w - 12), y = side ? fy - h / 2 : fy + 34;
        const key = Math.round(x) + ',' + Math.round(y) + (side ? 's' : 'u');
        if (key !== S.freeLast) {
          S.freeLast = key;
          el.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
          el.style.setProperty('--knot', Math.round(fx - x) + 'px');
          if (side !== S.freeSide) { S.freeSide = side; el.classList.toggle('side', side); }
        }
        // (hidden while the words cover the fish or the button)
        if (++S.frameNo % 4 === 0) S.covered = underWords(fx, fy) || underWords(x + w / 2, y + h / 2);
        showFree = !S.covered;
      }
    }
    if (showFree !== S.freeOn) { S.freeOn = showFree; S.free.el.classList.toggle('on', showFree); S.free.el.tabIndex = showFree ? 0 : -1; }

    // ---- the print in each look, for the card and the tiles (one picture a frame, once the
    // forest is near, and again when the crop or finish changes)
    renderLooks(stage, world, p);
  },
};

// Snap snips the line: his pincer, a sparkle where it parts, the line springs away, the fish
// spins free; his story says so.
function snip(stage) {
  if (S.state !== 'tangled') return;
  S.state = 'snip'; S.since = G.time.value; S.rho = 0;
  if (S.cast) S.cast.react('snap');
  if (S.fishAt && stage.sparkle) { V.copy(S.fishAt).addScaledVector(UP, FISH_LEN * 0.55); stage.sparkle(V, 9); }
  stage.note(NOTE, 5);
}

// The print photographed in each look (and whole, for the Size card) by the page's own print
// renderer, read back into canvases; the renderer is left holding the visitor's own choices.
function renderLooks(stage, world, p) {
  const print = world.print;
  if (!print || S.busy || p < 1.6 || p > 3.3) return;
  if (!S.jobs.length) {
    if (S.stale) { S.stale = false; S.wholeStale = true; S.jobs.push(0, 1, 2); }
    if (S.wholeStale) { S.wholeStale = false; S.jobs.push('whole'); }
    if (!S.jobs.length) return;
    S.jobs.push('restore');
  }
  const job = S.jobs.shift(), c = stage.choices;
  if (job === 'restore') { print.draw(c); return; }
  S.busy = true;
  print.draw(job === 'whole' ? { ...c, crop: 2 } : { ...c, look: job });
  print.read().then((img) => {
    if (!img) return;
    const cv = document.createElement('canvas');
    cv.width = img.width; cv.height = img.height;
    cv.getContext('2d').putImageData(img, 0, 0);
    if (job === 'whole') {
      S.whole = cv;
      const [crop, fit, pad] = S.frames;
      if (crop) fitInto(crop, cv, 'cover');
      if (fit) fitInto(fit, cv, 'contain');
      if (pad) fitInto(pad, cv, 'contain', '#FFD88A', 6);
    } else {
      S.looks[job] = cv;
      const tile = S.tiles[job];
      if (tile) fitInto(tile, cv, 'cover');
      if (S.chain) S.showSpec(S.preview ?? stage.choices.look, true);
    }
  }).catch(() => {}).finally(() => { S.busy = false; });
}
