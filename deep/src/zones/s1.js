// The shallows (zone s1), as in the painted dive (experience/src/world/fish.ts, ui.ts): its words
// are in zones/s1.html, its styles in zones/s1.css.
//   - Six schools of crochet fish, one per image format, swim in the open water above and
//     beside Snap. Hovering or focusing a format option gathers its school by his raised claw,
//     and the picked one stays there; when the choice first comes into view, and whenever Auto
//     is picked, AVIF, JPEG XL and WebP race to the claw, 0.45 s apart. Fish dart from the hand.
//   - Five things lie on the sand: the five kinds of source. On wide screens each wears a
//     stitched ring that opens its tip (hover, focus or click); on narrow ones the Sources
//     card lists them, a tap opening one.
//   - The sun's glint follows the hand over the sand.
//   - The Signed URLs card shows the visitor's own URL with its signature lit; the Formats
//     card weighs the visitor's own picture in the formats this browser can write.
import { Vector3 } from 'three/webgpu';
import { BASE, remainder, sign } from '../content.js';
import { groundY, pathAt } from '../layout.js';
import { smooth } from '../math.js';
import { G } from '../shaders.js';
import { buildCargo, buildGlint, createFish } from '../props/shallows.js';

// where the schools live in the view, as shares of its width and height (home: wide screens;
// tall: phones, in rows above and beside Snap, who is in the middle there); how many fish each
// has, and how long they are (metres)
const SCHOOLS = [
  { kind: 'avif', home: [0.64, 0.21], tall: [0.2, 0.215], n: 4, len: 0.36 },
  { kind: 'webp', home: [0.83, 0.26], tall: [0.13, 0.3], n: 4, len: 0.29 },
  { kind: 'jpeg', home: [0.81, 0.44], tall: [0.87, 0.29], n: 4, len: 0.32 },
  { kind: 'jxl', home: [0.74, 0.37], tall: [0.64, 0.205], n: 4, len: 0.34 },
  { kind: 'png', home: [0.56, 0.31], tall: [0.4, 0.165], n: 4, len: 0.32 },
  { kind: 'gif', home: [0.87, 0.18], tall: [0.85, 0.165], n: 6, len: 0.18 },
];
const OPTION_KIND = [null, 'avif', 'jxl', 'webp'];        // the format choice's options
const RACE = ['avif', 'jxl', 'webp'];                     // the order they reach the claw on a tie
const HOME_DEPTH = 4.3;                                   // how far off the schools swim, metres
const ON = [1.16, 2.06];                                  // the stretch of the dive they are in (they come as the camera leaves the anchor)
// the cargo: where it lies (a spot beside the camera's way at p, metres right and ahead)
const CARGO_AT = { p: 1.95, right: 0.9, ahead: 9.5 };
const CARGO_RINGS = [1.76, 1.995];                        // while the rings are out (p): near enough to tell apart
const NAMES = [
  ['Film reel', 'frame:50%', 'One frame of a video'],
  ['Folded pages', 'page:2', 'One page of a PDF'],
  ['Sand pails', 's3:// · gs://', 'Objects in S3 and GCS'],
  ['Shoebox', 'file://', 'A local file'],
  ['Mooring buoy', 'root:photos/print.jpg', 'A short root reference'],
];

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const soft = (t) => esc(t).replace(/([/:,])(?=[^/\s])/g, '$1<wbr>');
const kb = (n) => (n < 10240 ? (n / 1024).toFixed(1) : String(Math.round(n / 1024))) + ' KB';

// everything here, made once
const S = {
  fish: null, list: [], schools: [], cargo: null, glint: null, camera: null, cast: null,
  focus: null, picked: null, raceAt: -1, raced: false, time: 0, placed: false, phone: false,
};
// camera frame and scratch vectors (no frame allocates)
const R = new Vector3(), U = new Vector3(), F = new Vector3(), P = new Vector3(), FW = new Vector3(), UP = new Vector3(), GRIP = new Vector3();
const H2 = [0, 0], PR = [0, 0, 0], O5 = [0, 0, 0, 0, 0];

function buildSchools(lod) {
  const rng = (() => { let s = 7351; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  let slot = 0;
  for (let i = 0; i < SCHOOLS.length; i++) {
    const def = SCHOOLS[i], fish = [];
    for (let j = 0; j < def.n; j++) {
      const a = (j / def.n) * Math.PI * 2 + i;
      S.list.push({ kind: def.kind, seed: rng(), pal: def.kind === 'gif' ? j % 6 : 0 });
      fish.push({
        slot: slot++, ox: Math.cos(a) * (0.7 + 0.3 * Math.sin(j * 2.1)), oy: Math.sin(a) * 0.45, oz: Math.sin(a * 1.7 + j) * 0.5, ph: j * 1.7 + i,
        len: def.len * (0.92 + 0.14 * rng()), x: 0, y: 0, z: 0, vx: 0, vy: 0, turn: -0.3, wag: rng() * 6.28, fresh: true,
      });
    }
    S.schools.push({ ...def, fish, ph: i * 1.3, x: 0, y: 0, z: 0, fresh: true });
  }
  S.fish = createFish(S.scene, S.list, lod);
}

// A view-space point (right, up, forward metres from the eye) for a share (sx, sy) of the view
// at depth d.
function viewPoint(sx, sy, d, cam, out) {
  const tanV = Math.tan((cam.fov * Math.PI) / 360);
  out[0] = (sx * 2 - 1) * tanV * cam.aspect * d; out[1] = (1 - sy * 2) * tanV * d; out[2] = d;
  return out;
}

// Each frame: the schools swim toward where they want to be, the fish in each toward their
// places in it, away from the hand; then each is placed in the world and told how to wag.
const T3 = [0, 0, 0];
function swim(stage, p) {
  const cam = S.camera, e = cam.matrixWorld.elements, t = G.time.value;
  R.set(e[0], e[1], e[2]); U.set(e[4], e[5], e[6]); F.set(-e[8], -e[9], -e[10]);
  const dt = Math.min(stage.dt || 0, 0.1), jump = dt <= 0 || !S.placed;
  const tanV = Math.tan((cam.fov * Math.PI) / 360), W = stage.W, H = stage.H, phone = cam.aspect < 1;
  // they swim in from the right as the shallows open, and away as the forest begins
  const here = smooth(ON[0], ON[0] + 0.22, p) * (1 - smooth(ON[1] - 0.12, ON[1], p));
  // Snap's raised claw, in the view (where he usually holds it, if he is off on a card)
  let gx, gy, gz;
  if (S.cast && S.cast.snap.ready) {
    S.cast.gripAt(GRIP).sub(cam.position);
    gx = GRIP.dot(R); gy = GRIP.dot(U); gz = GRIP.dot(F);
  }
  const ex = phone ? -0.2 : 0.87, ey = phone ? 0.53 : -0.4, ez = phone ? 2.46 : 2.48;
  if (gx === undefined || Math.hypot(gx - ex, gy - ey, gz - ez) > 0.6) { gx = ex; gy = ey; gz = ez; }
  // the tag: beside the claw, out in the open water, a little behind it
  const tx = gx + (phone ? -0.24 : -0.42), ty = gy + (phone ? 0.3 : 0.14), tz = gz + (phone ? 0.45 : 0.4);
  const live = stage.live() && !stage.overWords(), hand = stage.hand(H2);
  if (S.raceAt >= 0 && t - S.raceAt > 5.2) S.raceAt = -2;
  for (let s = 0; s < S.schools.length; s++) {
    const sc = S.schools[s];
    // where it wants to be: home, drifting; or by the claw
    const home = phone ? sc.tall : sc.home, drift = phone ? 0.5 : 1;
    const hx = home[0] + Math.sin(t * 0.21 + sc.ph) * 0.035 * drift, hy = home[1] + Math.sin(t * 0.29 + sc.ph * 1.7) * 0.03 * drift;
    viewPoint(hx + (1 - here) * 0.75, hy, HOME_DEPTH, cam, T3);
    const gather = here > 0.5 && (S.picked === sc.kind || S.focus === sc.kind);
    let racing = false;
    if (gather) { T3[0] = tx; T3[1] = ty; T3[2] = tz; }
    if (S.raceAt >= 0 && !S.picked && here > 0.5) {
      const i = RACE.indexOf(sc.kind), rt = t - S.raceAt - i * 0.45;
      if (i >= 0 && rt > 0 && rt < 3.4) { racing = true; T3[0] = tx - i * (phone ? 0.16 : 0.3); T3[1] = ty - i * 0.12; T3[2] = tz + i * 0.55; }
    }
    if (sc.fresh || jump) { sc.x = T3[0]; sc.y = T3[1]; sc.z = T3[2]; sc.fresh = false; }
    const k = 1 - Math.exp(-dt * (gather || racing ? 3.2 : 0.9));
    sc.x += (T3[0] - sc.x) * k; sc.y += (T3[1] - sc.y) * k; sc.z += (T3[2] - sc.z) * k;
    // (a school keeps closer together on a phone's narrow view)
    const spread = (gather || racing ? 1.4 : 1) * (phone ? 0.72 : 1);
    for (let j = 0; j < sc.fish.length; j++) {
      const f = sc.fish[j], L = f.len;
      if (phone && j === 3) { S.fish.hide(f.slot); continue; }
      let fx = sc.x + (f.ox * L * 1.3 + Math.sin(t * 1.1 + f.ph) * L * 0.25) * spread;
      let fy = sc.y + (f.oy * L * 1.1 + Math.sin(t * 1.6 + f.ph * 1.3) * L * 0.15) * spread;
      const fz = sc.z + f.oz * L * spread;
      // the hand pushes it away (within a few of its own sizes of it, on the screen)
      if (live && fz > 0.3) {
        const ppm = H / (2 * fz * tanV), sxp = (fx / (fz * tanV * cam.aspect) * 0.5 + 0.5) * W, syp = (0.5 - fy / (fz * tanV) * 0.5) * H;
        const dx = sxp - hand[0], dy = syp - hand[1], d = Math.hypot(dx, dy), reach = L * 0.5 * ppm * 3.4 + 18;
        if (d < reach) { const push = (reach - d) * 0.8 / ppm; fx += (dx / (d + 1e-3)) * push; fy -= (dy / (d + 1e-3)) * push; }
      }
      const kf = 1 - Math.exp(-dt * 6);
      if (f.fresh || jump) { f.x = fx; f.y = fy; f.z = fz; f.fresh = false; }
      const ox = f.x, oy = f.y;
      f.x += (fx - f.x) * kf; f.y += (fy - f.y) * kf; f.z += (fz - f.z) * kf;
      // which way it faces: to the right or the left as it goes, turning through facing the
      // visitor (a little toward them either way); nose up or down a little as it climbs
      if (dt > 0) { f.vx = f.vx * 0.9 + ((f.x - ox) / dt) * 0.1; f.vy = f.vy * 0.9 + ((f.y - oy) / dt) * 0.1; }
      const want = Math.abs(f.vx) > 0.04 ? (f.vx > 0 ? -0.3 : -Math.PI + 0.3) : f.turn;
      f.turn += (want - f.turn) * (jump ? 1 : 1 - Math.exp(-dt * 5));
      const pitch = Math.max(-0.35, Math.min(0.35, f.vy * 0.6));
      const cx = Math.cos(f.turn) * Math.cos(pitch), cz = Math.sin(f.turn) * Math.cos(pitch), cy = Math.sin(pitch);
      FW.copy(R).multiplyScalar(cx).addScaledVector(U, cy).addScaledVector(F, cz).normalize();
      UP.copy(U).addScaledVector(FW, -FW.dot(U)).normalize();
      P.copy(cam.position).addScaledVector(R, f.x).addScaledVector(U, f.y).addScaledVector(F, f.z);
      // its tail: faster when it hurries; the tiny ones in a few steps, like a GIF's frames
      const speed = Math.hypot(f.vx, f.vy);
      f.wag += dt * Math.PI * 2 * (1.6 + Math.min(speed, 2) * 0.9);
      const phase = sc.kind === 'gif' ? Math.floor(f.wag / (Math.PI / 3)) * (Math.PI / 3) : f.wag;
      S.fish.set(f.slot, P, FW, UP, here > 0.02 ? L : 0, phase, 1 + Math.min(speed, 2) * 0.25);
    }
  }
  S.placed = true;
}

export default {
  id: 's1',
  build(ctx) {
    const { scene, camera, q } = ctx;
    S.scene = scene; S.camera = camera; S.cast = ctx.cast;
    const lod = q.amount >= 0.5 ? 1 : 0;
    buildSchools(lod);
    // the cargo: on the sand right of the camera's way, where it looks as the Sources card is up
    pathAt(CARGO_AT.p, O5);
    const yaw = (O5[3] * Math.PI) / 180, fx = Math.sin(yaw), fz = -Math.cos(yaw);
    const at = [O5[0] + Math.cos(yaw) * CARGO_AT.right + fx * CARGO_AT.ahead, O5[2] + Math.sin(yaw) * CARGO_AT.right + fz * CARGO_AT.ahead];
    S.cargo = buildCargo(scene, at, [Math.cos(yaw), Math.sin(yaw)], [-fx, -fz], lod);
    S.glint = buildGlint(scene);
    return {
      update(t, dt, p) {
        S.fish.show(p > ON[0] - 0.02 && p < ON[1] + 0.02);
        S.cargo.mesh.visible = p > 1.4 && p < 2.08;
      },
    };
  },

  mount(stage, world) {
    const doc = document;
    S.world = world;
    // ---- the Signed URLs card: the visitor's own URL, its signature lit
    const sigSpec = doc.getElementById('sig-spec');
    const showSig = () => {
      const rem = remainder(stage.choices);
      const html = '<span class="su">' + soft(BASE) + '</span><b>' + sign(rem).slice(0, 8) + '…</b><span class="su">/' + soft(rem) + '</span>';
      if (sigSpec && sigSpec.innerHTML !== html) sigSpec.innerHTML = html;
    };
    showSig();
    // ---- Choice 1: hover or focus gathers a school; the pick keeps one; Auto races them
    stage.onPreview((key, i) => { if (key === 'format') S.focus = i === null ? null : OPTION_KIND[i]; });
    S.picked = OPTION_KIND[stage.choices.format];
    stage.onChoice((key, i) => {
      if (key === 'format') { S.picked = OPTION_KIND[i]; if (!S.picked) S.raceAt = G.time.value; }
      showSig();
      if (key === 'look' || key === 'crop' || key === 'finish') fmtStale = true;
    });
    const pickBeat = doc.querySelector('#s1 .beat.pick');
    if (pickBeat && typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver((es) => {
        for (const en of es) if (en.isIntersecting && en.intersectionRatio >= 0.6 && !S.raced && stage.p > 1.2 && stage.p < 2.05) { S.raced = true; S.raceAt = G.time.value; io.disconnect(); }
      }, { threshold: [0.6] });
      io.observe(pickBeat);
    }
    // ---- the Formats card: the visitor's picture, encoded here as each format (by this browser)
    const fmtSpec = doc.getElementById('fmt-spec'), card = doc.getElementById('card-format');
    let fmtStale = true, measuring = false;
    const blob = (cv, type, q) => new Promise((res) => { try { cv.toBlob((b) => res(b), type, q); } catch (e) { res(null); } });
    const measure = async () => {
      if (measuring || !fmtStale || !world.print || !fmtSpec) return;
      measuring = true; fmtStale = false;
      try {
        const img = await world.print.read();
        if (!img) return;
        const cv = doc.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        cv.getContext('2d').putImageData(img, 0, 0);
        const out = [];
        for (const [name, type] of [['AVIF', 'image/avif'], ['WebP', 'image/webp'], ['JPEG', 'image/jpeg']]) {
          const b = await blob(cv, type, 0.8);
          if (b && b.type === type) out.push('<b>' + name + ' ' + kb(b.size) + '</b>');
        }
        if (!out.length) return;
        fmtSpec.innerHTML = '<span>Your print, ' + img.width + ' × ' + img.height + ' px, as this browser writes it:</span> ' + out.join(' · ')
          + (out.length < 3 ? '<span class="q">(the formats it cannot write are left out)</span>' : '');
        fmtSpec.hidden = false;
      } catch (e) { /* the card keeps its words */ } finally { measuring = false; }
    };
    if (card && typeof IntersectionObserver !== 'undefined') {
      new IntersectionObserver((es) => { for (const en of es) if (en.isIntersecting) S.wantFmt = true; }, { rootMargin: '0px 0px 40% 0px' }).observe(card);
    }
    S.measure = measure;
    // ---- the cargo: a ring on each thing (wide screens), its tip; the tied cue on the pails
    S.rings = NAMES.map(([name, code, text], i) => {
      const ring = stage.ring({ label: name + ': ' + text });
      const tip = stage.el('div', 'tip', stage.layer, '<b>' + esc(name) + '</b><code>' + esc(code) + '</code> ' + esc(text));
      tip.id = 'cargo-tip-' + i;
      tip.setAttribute('role', 'tooltip');
      ring.el.setAttribute('aria-expanded', 'false');
      ring.el.setAttribute('aria-describedby', tip.id);
      ring.el.tabIndex = -1;
      const r = { ring, tip, i, hover: false, focus: false, open: false, x: -1e4, y: -1e4, w: 0, shown: false, tipOn: false, last: '' };
      ring.el.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch' && stage.live()) r.hover = true; });
      ring.el.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') r.hover = true; });
      ring.el.addEventListener('pointerleave', () => { r.hover = false; });
      ring.el.addEventListener('focus', () => { if (ring.el.matches(':focus-visible')) r.focus = true; });
      ring.el.addEventListener('blur', () => { r.focus = false; });
      ring.el.addEventListener('click', () => {
        const open = !r.open;
        for (const o of S.rings) { o.open = false; o.ring.el.setAttribute('aria-expanded', 'false'); }
        r.open = open; ring.el.setAttribute('aria-expanded', String(open));
      });
      return r;
    });
    S.cueCargo = stage.cue({ verb: 'Hover', text: 'the cargo', more: '· five kinds of source', done: { text: 'Five kinds of source' }, tie: true, knot: 44, yarn: 22 });
    S.seen = -1;
    // narrow screens (and the page): the Sources card's list, a tap opening one
    const list = doc.getElementById('cargo-list');
    if (list) {
      const items = [...list.querySelectorAll('li')];
      items.forEach((li, i) => {
        const b = li.querySelector('.src');
        const btn = doc.createElement('button');
        btn.type = 'button'; btn.className = 'src'; btn.textContent = b.textContent;
        btn.setAttribute('aria-expanded', 'false');
        const tip = li.querySelector('.src-tip');
        tip.id = 'src-tip-' + i;
        btn.setAttribute('aria-controls', tip.id);
        b.replaceWith(btn);
        btn.addEventListener('click', () => {
          const open = !btn.classList.contains('open');
          for (const o of list.querySelectorAll('.src')) { o.classList.remove('open'); o.setAttribute('aria-expanded', 'false'); }
          btn.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open));
          S.listOpen = open ? i : -1;
        });
      });
    }
    S.listOpen = -1;
  },

  frame(stage) {
    const p = stage.p;
    if (!S.fish) return;
    if (S.wantFmt && S.measure) { S.wantFmt = false; S.measure(); }
    // ---- the schools
    if (p > ON[0] - 0.02 && p < ON[1] + 0.02) swim(stage, p);
    else S.placed = false;

    // ---- the cargo's rings and tips
    const onRings = stage.wide && p > CARGO_RINGS[0] && p < CARGO_RINGS[1];
    let any = false;
    for (let i = 0; i < S.rings.length; i++) {
      const r = S.rings[i];
      let show = false;
      if (onRings) {
        stage.project(S.cargo.rings[i], PR);
        show = PR[2] > 1.5 && PR[2] < 24 && stage.onScreen(PR[0], PR[1], -30) && PR[1] < stage.H - 40;
        if (show) { r.x = PR[0]; r.y = PR[1]; r.ring.at(PR[0], PR[1]); }
      }
      if (show !== r.shown) { r.shown = show; r.ring.show(show); r.ring.el.tabIndex = show ? 0 : -1; if (!show) { r.open = false; r.hover = false; r.ring.el.setAttribute('aria-expanded', 'false'); } }
      if (r.hover && !stage.live()) r.hover = false;
      const tipOn = show && (r.hover || r.focus || r.open);
      if (tipOn) {
        any = true;
        if (!r.w) r.w = r.tip.offsetWidth || 220;
        const left = r.x + 30 + r.w > stage.W - 70;
        const x = left ? r.x - 30 - r.w : r.x + 30, y = r.y - 24;
        const key = Math.round(x) + ',' + Math.round(y) + (left ? 'l' : 'r');
        if (key !== r.last) { r.last = key; r.tip.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)'; r.tip.classList.toggle('left', left); }
      }
      if (tipOn !== r.tipOn) { r.tipOn = tipOn; r.tip.classList.toggle('on', tipOn); }
    }
    // the cue hangs over the pails until a ring has been tried, then says so and goes
    if (any && S.seen < 0) S.seen = stage.t;
    const pails = S.rings[2], cueOn = pails.shown && (S.seen < 0 || stage.t - S.seen < 2.2);
    if (cueOn) S.cueCargo.at(pails.x, pails.y - 26);
    S.cueCargo.show(cueOn).done(S.seen >= 0);
    if ((S.seen >= 0) !== S.cueGone) { S.cueGone = S.seen >= 0; S.cueCargo.gone(S.cueGone); }

    // ---- the sun's glint on the sand, under the hand
    const g = S.glint, inS1 = p > 1.1 && p < 2.03;
    let want = 0;
    if (inS1 && stage.live() && !stage.overWords()) {
      const cam = S.camera, e = cam.matrixWorld.elements, hand = stage.hand(H2);
      const tanV = Math.tan((cam.fov * Math.PI) / 360), nx = (hand[0] / stage.W) * 2 - 1, ny = 1 - (hand[1] / stage.H) * 2;
      R.set(e[0], e[1], e[2]); U.set(e[4], e[5], e[6]); F.set(-e[8], -e[9], -e[10]);
      FW.copy(F).addScaledVector(R, nx * tanV * cam.aspect).addScaledVector(U, ny * tanV).normalize();
      // march along the ray until it is under the sand, then close in on where it entered
      const o = cam.position;
      let a = 0, b = -1;
      for (let s = 0.6; s < 34; s += 0.7) { if (o.y + FW.y * s < groundY(o.x + FW.x * s, o.z + FW.z * s)) { b = s; break; } a = s; }
      if (b > 0) {
        for (let k = 0; k < 7; k++) { const m = (a + b) / 2; if (o.y + FW.y * m < groundY(o.x + FW.x * m, o.z + FW.z * m)) b = m; else a = m; }
        const d = (a + b) / 2, x = o.x + FW.x * d, z = o.z + FW.z * d;
        g.mesh.position.set(x, groundY(x, z) + 0.05, z);
        // about 150 px across on the screen, wherever it falls
        const ppm = stage.H / (2 * Math.max(d * FW.dot(F), 0.5) * tanV);
        g.mesh.scale.setScalar(Math.min(7, 300 / ppm));
        g.mesh.updateMatrixWorld();
        want = 1;
      }
    }
    const kk = g.k.value + (want - g.k.value) * Math.min(1, (stage.dt || 0.016) * (want ? 5 : 3));
    g.k.value = kk < 0.005 && !want ? 0 : kk;
    g.mesh.visible = g.k.value > 0.005;
  },
};
