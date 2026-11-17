// The reef's four stations (zone s3), as in the painted dive (experience/src/reef-ui.ts), on the
// 3D reef: things in the scene are projected onto the screen every frame and the page's pieces
// follow them. Its words are in zones/s3.html, its styles in zones/s3.css.
//   1  the crop frame hunts the visitor's cursor and snaps round the turtle: the third choice
//      shown live (a wide card, a square, the whole picture), and previewed while an option is
//      hovered or focused
//   2  stitched boxes on the faces of a school of seven fish
//   3  a ring on a cuttlefish: the visitor's hand over it blurs it (redaction)
//   4  a soda can in the coral: a box dragged over it (or a tap on it, or the button) erases
//      it, and the card's chip gets the box: filters:remove_region(x,y,w,h)
// The scene's pieces (the can, the cuttlefish, the school) are built here too.
// Then the Clam Studio (as in the painted dive: reef-ui.ts, world/reef.ts): its three jellyfish
// softboxes flicker on one after another as Snap arrives; its pearl is a mosaic until the AI
// upscale card is up, and is rebuilt (and again, on "Do it again"); the cards show Snap
// photographed by the page itself (snapshots.js): on a studio backdrop, and before and after his
// background is removed, under a line the visitor drags; the finish tiles show him each way.
import { Group, Mesh as ThreeMesh, Vector3, Vector4 } from 'three/webgpu';
import { float, select, vec3 } from 'three/tsl';
import { OPTIONS } from '../content.js';
import { groundY, pathAt } from '../layout.js';
import { Mesh, blob, lathe, tube } from '../math.js';
import { G, material, yarn } from '../shaders.js';
import { smooth } from '../math.js';
import { buildPearl } from '../props/reef.js';
import { createSnapshots } from '../snapshots.js';

// where the camera is while each station's card is up (p; the cards' stretches of scroll are
// sized in s3.css to match), and the studio's: its cards from p 3.6, the softboxes coming on as
// Snap swims to the shell (cast.js: 3.74 to 3.8), the upscale card's stretch while the camera
// holds on the open shell (layout.js: 3.8 to 3.96), where the pearl is in clear view
const ST = { crop: [3.08, 3.37], faces: [3.37, 3.46], cuttle: [3.46, 3.545], can: [3.545, 3.63] };
const STUDIO = { from: 3.6, lamps: 3.735, upscale: [3.83, 3.93], to: 3.97 };
const near = (p, r) => smooth(r[0] - 0.02, r[0] + 0.02, p) * (1 - smooth(r[1] - 0.02, r[1] + 0.02, p));
const ASPECT = [1200 / 630, 1, 0];
// colours as pictures have them, made linear
const lin = (r, g, b) => [r ** 2.2, g ** 2.2, b ** 2.2];

// A point in the view at p, as the path has it: forward, right and up of the camera, metres.
const O = [0, 0, 0, 0, 0];
function inView(p, f, r, u, out = new Vector3()) {
  pathAt(p, O);
  const y = (O[3] * Math.PI) / 180, x = (O[4] * Math.PI) / 180, cy = Math.cos(y), sy = Math.sin(y), cx = Math.cos(x), sx = Math.sin(x);
  out.set(O[0] + sy * cx * f + cy * r - sx * sy * u, O[1] + sx * f + cx * u, O[2] - cy * cx * f + sy * r + sx * cy * u);
  return out;
}

// The crochet things here: the can's body red with a white wave, its rims tin; the creatures in
// yarn with bead eyes in white felt rings (aux.x: 0 yarn, 1 felt ring, 2 bead, 3 tin;
// aux.y: which of three colours)
function crochet(cols) {
  return material({
    aux: true, shadow: false, fade: [60, 72],
    surface(s, f) {
      const id = f.aux.x, ci = f.aux.y;
      const body = select(ci.lessThan(0.5), vec3(...cols[0]), select(ci.lessThan(1.5), vec3(...cols[1]), vec3(...cols[2])));
      yarn(s, f, { color: body, color2: body.mul(0.7), stripe: 3, scale: 36, k: 1.1 });
      const ring = id.greaterThan(0.5).and(id.lessThan(1.5)), bead = id.greaterThan(1.5).and(id.lessThan(2.5)), tin = id.greaterThan(2.5);
      s.albedo = select(bead, vec3(0.006, 0.006, 0.008), select(ring, vec3(0.86, 0.84, 0.78), select(tin, vec3(0.62, 0.64, 0.66), s.albedo)));
      s.spec = select(bead.or(tin), float(1.3), s.spec);
      s.gloss = select(bead, float(90.0), select(tin, float(40.0), s.gloss));
    },
  });
}
const tag = (m, from, id, ci = 0) => { for (let i = from; i < m.count; i++) { m.a[i * 4] = id; m.a[i * 4 + 1] = ci; } };
const ell = (a, b, c) => (x, y, z) => 1 / Math.sqrt((x / a) ** 2 + (y / b) ** 2 + (z / c) ** 2);
// a bead eye in its felt ring, on the side `sx` of a head, looking out along n
function eye(m, x, y, z, nx, ny, nz, r) {
  let k = m.count; blob(m, x, y, z, ell(r * (1 - 0.55 * Math.abs(nx)), r * (1 - 0.55 * Math.abs(ny)), r * (1 - 0.55 * Math.abs(nz))), 4); tag(m, k, 1);
  k = m.count; blob(m, x + nx * r * 0.32, y + ny * r * 0.32, z + nz * r * 0.32, () => r * 0.62, 3); tag(m, k, 2);
}

// a little reef fish: round body along +z, a tail, fins, bead eyes (face at (0, 0.02, 0.15))
function fishGeo(ci) {
  const m = new Mesh(true);
  let k = m.count; blob(m, 0, 0, 0, ell(0.1, 0.12, 0.2), 6); tag(m, k, 0, ci);
  k = m.count; blob(m, 0, 0.01, -0.24, ell(0.025, 0.11, 0.07), 4); tag(m, k, 0, ci);
  k = m.count; blob(m, 0, 0.12, -0.02, ell(0.02, 0.05, 0.08), 3); tag(m, k, 0, ci);
  eye(m, 0.075, 0.035, 0.11, 1, 0, 0.3, 0.035);
  eye(m, -0.075, 0.035, 0.11, -1, 0, 0.3, 0.035);
  return m.build();
}
// the cuttlefish: a mantle with its fin all round, a head, eight short arms and two long ones
function cuttleGeo() {
  const m = new Mesh(true);
  let k = m.count; blob(m, 0, 0, 0, ell(0.15, 0.11, 0.3), 7); tag(m, k, 0, 0);
  k = m.count; blob(m, 0, -0.01, 0, (x, y, z) => (Math.abs(y) < 0.4 ? 1 : 0.6) / Math.sqrt((x / 0.26) ** 2 + (y / 0.035) ** 2 + (z / 0.32) ** 2), 6); tag(m, k, 0, 1);
  k = m.count; blob(m, 0, 0.01, 0.31, ell(0.12, 0.1, 0.1), 5); tag(m, k, 0, 2);
  k = m.count;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, cx = Math.cos(a) * 0.055, cy = Math.sin(a) * 0.045;
    tube(m, [[cx, cy, 0.38, 0.026], [cx * 1.5, cy * 1.5 - 0.01, 0.5, 0.02], [cx * 1.7, cy * 1.7 - 0.03, 0.58, 0.012]], 5);
  }
  for (const sx of [-1, 1]) tube(m, [[sx * 0.03, -0.03, 0.38, 0.015], [sx * 0.08, -0.08, 0.62, 0.012], [sx * 0.1, -0.06, 0.78, 0.022]], 5);
  tag(m, k, 0, 2);
  eye(m, 0.1, 0.04, 0.32, 1, 0.1, 0.2, 0.04);
  eye(m, -0.1, 0.04, 0.32, -1, 0.1, 0.2, 0.04);
  return m.build();
}
// the soda can: a crocheted cozy, red with a white wave, tin top and bottom; 0.62 m tall
function canGeo() {
  const m = new Mesh(true);
  let k = m.count;
  lathe(m, 0, 0, 0, [[0.0, 0.0], [0.17, 0.0], [0.2, 0.03], [0.2, 0.08]], 20); tag(m, k, 3);
  k = m.count; lathe(m, 0, 0, 0, [[0.205, 0.08], [0.215, 0.12], [0.215, 0.5], [0.205, 0.54]], 20); tag(m, k, 0, 0);
  k = m.count; lathe(m, 0, 0, 0, [[0.2, 0.54], [0.2, 0.58], [0.17, 0.62], [0.12, 0.625], [0.0, 0.625]], 20); tag(m, k, 3);
  // the white wave round it
  k = m.count;
  const wave = [];
  for (let i = 0; i <= 28; i++) { const a = (i / 28) * Math.PI * 2; wave.push([Math.cos(a) * 0.222, 0.3 + Math.sin(a * 3) * 0.05, Math.sin(a) * 0.222, 0.024]); }
  tube(m, wave, 6); tag(m, k, 0, 1);
  // its pull tab
  k = m.count; tube(m, [[0.03, 0.63, 0, 0.012], [0.09, 0.635, 0, 0.012]], 4); tag(m, k, 3);
  return m.build();
}

const S = {
  can: null, canAt: new Vector3(), canK: 1, canGone: -1, erased: false,
  cuttle: null, cuttleAt: new Vector3(), fish: [], fishAt: [], school: new Vector3(), p: 0,
  pearl: null,
};

// The softboxes: how bright lamp i is, t seconds into the dive, if they started at `at` (-1: off):
// on one after another 0.45 s apart, each with a flicker, then a slow breath (world/reef.ts).
function lampLevel(t, at, i) {
  if (at < 0) return 0;
  const tau = t - at - 0.45 * i;
  if (tau < 0) return 0;
  if (tau < 0.5) return tau < 0.07 || (tau > 0.15 && tau < 0.21) || tau > 0.32 ? 1 : 0.2;
  return 0.94 + 0.06 * Math.sin(t * 1.7 + i);
}

export default {
  id: 's3',
  build(ctx) {
    const { add } = ctx;
    // the can stands in the coral, a little right of the middle of the view at its stop (the
    // words are on the left)
    inView((ST.can[0] + ST.can[1]) / 2, 3.0, 0.22, 0, S.canAt);
    S.canAt.y = groundY(S.canAt.x, S.canAt.z) - 0.04;
    S.can = new ThreeMesh(canGeo(), crochet([lin(0.86, 0.13, 0.12), lin(0.97, 0.95, 0.9), lin(0.97, 0.95, 0.9)]));
    S.can.position.copy(S.canAt);
    S.can.rotation.set(0.12, 0.6, -0.08);
    add(S.can, 72);
    // the cuttlefish hovers in the middle of the view at its stop
    inView((ST.cuttle[0] + ST.cuttle[1]) / 2, 3.0, 0.18, 0.05, S.cuttleAt);
    S.cuttle = new ThreeMesh(cuttleGeo(), crochet([lin(0.78, 0.55, 0.85), lin(0.93, 0.62, 0.78), lin(0.86, 0.6, 0.84)]));
    S.cuttle.position.copy(S.cuttleAt);
    add(S.cuttle, 72);
    // the school: seven fish in a loose cluster, all heading left across the view
    inView((ST.faces[0] + ST.faces[1]) / 2, 4.0, 0.25, -0.05, S.school);
    const geos = [fishGeo(0), fishGeo(1), fishGeo(2)], mat = crochet([lin(0.98, 0.72, 0.18), lin(0.32, 0.72, 0.86), lin(0.95, 0.45, 0.5)]);
    const OFF = [[-0.62, 0.18, 0], [-0.22, 0.42, 0.25], [0.18, 0.22, -0.12], [0.6, 0.4, 0.12], [-0.4, -0.18, 0.16], [0.08, -0.1, 0], [0.48, -0.22, -0.18]];
    pathAt((ST.faces[0] + ST.faces[1]) / 2, O);
    const yaw = (O[3] * Math.PI) / 180, R = [Math.cos(yaw), Math.sin(yaw)];
    for (let i = 0; i < 7; i++) {
      const f = new ThreeMesh(geos[i % 3], mat), o = OFF[i];
      const at = new Vector3(S.school.x + R[0] * o[0], S.school.y + o[1], S.school.z + R[1] * o[0] + o[2]);
      f.position.copy(at);
      // heading left across the view (-right), each a little turned toward the visitor
      f.rotation.y = Math.atan2(-R[0], -R[1]) + 0.35 + (i % 3) * 0.12;
      f.scale.setScalar(1.15 + (i % 2) * 0.15);
      add(f, 72);
      S.fish.push(f); S.fishAt.push(at.clone());
    }
    // the studio's pearl: in place of the clam's own, as large again as before and sitting where
    // it sat (its foot on the mound of sand), traced by props/reef.js so its upscale can show
    if (ctx.sets && ctx.sets.clam) {
      const r = 0.4, at = ctx.sets.clam.position.clone();
      at.y += r - 0.3;
      S.pearl = buildPearl(ctx.scene, at, r);
    }
    return {
      update(t, dt, p) {
        S.p = p;
        // the can: there until it is erased (it shrinks and spins away), back when the visitor
        // scrolls back before its stop
        if (S.erased && p < ST.can[0] - 0.06) { S.erased = false; S.canK = 1; }
        if (S.erased) S.canK = Math.max(0, S.canK - dt * 1.8);
        S.can.visible = p > ST.can[0] - 0.17 && p < ST.can[1] + 0.18 && S.canK > 0.001;
        const k = S.canK * S.canK * (3 - 2 * S.canK);
        S.can.scale.setScalar(Math.max(k, 0.001));
        S.can.position.copy(S.canAt); S.can.position.y += (1 - k) * 0.35;
        S.can.rotation.y = 0.6 + (1 - k) * 5;
        // the cuttlefish breathes and bobs, its fin rippling with the swell
        S.cuttle.visible = p > ST.cuttle[0] - 0.14 && p < ST.cuttle[1] + 0.18;
        S.cuttle.position.copy(S.cuttleAt); S.cuttle.position.y += Math.sin(t * 1.1) * 0.05;
        S.cuttle.rotation.set(Math.sin(t * 0.7) * 0.06, -0.9 + Math.sin(t * 0.4) * 0.15, Math.sin(t * 0.9) * 0.05);
        // the school wiggles where it is
        const on = p > ST.faces[0] - 0.13 && p < ST.faces[1] + 0.14;
        for (let i = 0; i < S.fish.length; i++) {
          const f = S.fish[i];
          f.visible = on;
          if (!on) continue;
          f.position.copy(S.fishAt[i]);
          f.position.y += Math.sin(t * 1.3 + i * 1.7) * 0.04;
          f.position.x += Math.sin(t * 0.6 + i) * 0.03;
        }
      },
    };
  },

  mount(stage, world) {
    const doc = document, el = (cls, html) => stage.el('div', cls, stage.layer, html);
    const P = [0, 0, 0], v = new Vector3(), H = [0, 0];
    // ---- station 1: the frame and its label, its cue under it
    const frame = el('crop-frame', '<span class="crop-label">crop:1200x630:smart</span>');
    frame.setAttribute('aria-hidden', 'true');
    const label = frame.firstChild;
    const cueCrop = stage.cue({ verb: 'Move', text: 'the cursor: the frame keeps the turtle', tie: true, under: true, knot: 60, yarn: 26 });
    const rect = { x: -999, y: 0, w: 10, h: 10 }, target = { x: 0, y: 0, w: 0, h: 0 };
    let preview = null, drove = 0, lastFrame = '', lastLabel = '';
    stage.onPreview((key, i) => { if (key === 'crop') preview = i; });
    const chip = doc.getElementById('crop-chip');
    const setChip = () => { chip.textContent = OPTIONS.crop[stage.choices.crop]; };
    stage.onChoice((key) => { if (key === 'crop') setChip(); });
    setChip();
    // ---- station 2: seven boxes
    const boxes = [];
    for (let i = 0; i < 7; i++) { const b = el('face-box', '<span>face ' + (0.97 - i * 0.01).toFixed(2) + '</span>'); b.setAttribute('aria-hidden', 'true'); boxes.push({ el: b, last: '', on: -1 }); }
    const cueFaces = stage.cue({ verb: 'Hover', text: 'the school to find its faces', tie: true, knot: 96, yarn: 22 });
    let arrived2 = -1, found = false;
    // ---- station 3: the blur over the cuttlefish, its ring and cue
    const lens = el('blur-lens'); lens.setAttribute('aria-hidden', 'true');
    const ring = stage.ring({ beacon: true });
    const cueCuttle = stage.cue({ verb: 'Hover', text: 'the cuttlefish to blur it', done: { text: 'Blurred', more: '· that is blurclass(person)' }, tie: true, knot: 84, yarn: 22, gap: 25 });
    let arrived3 = -1, blurAt = -1, lastLens = '';
    // ---- station 4: the box stitched round the can, the drag layer, the chip
    const hint = el('can-hint'); hint.setAttribute('aria-hidden', 'true');
    const cueCan = stage.cue({ verb: 'Drag', text: 'a box over the can to erase it', done: { text: 'Erased', more: '· that is remove_region' }, tie: true, knot: 40, yarn: 20 });
    const drag = el('reef-drag'), dragRect = el('drag-rect');
    drag.setAttribute('aria-hidden', 'true');
    const removeChip = doc.getElementById('remove-chip');
    const DEFAULT = 'filters:remove_region(40,120,300,200)';
    let start = null, canBox = { x: 0, y: 0, w: 0, h: 0 }, goneAt = -1, lastHint = '';
    const setRemove = (text) => {
      removeChip.innerHTML = text.replace(/,/g, ',<wbr>');
      removeChip.classList.remove('stamp'); void removeChip.offsetWidth; removeChip.classList.add('stamp');
    };
    // a box in pixels of a 1600 x 679 frame of the view
    const erase = (r) => {
      if (S.erased) return;
      S.erased = true; goneAt = stage.t;
      const fx = 1600 / stage.W, fy = 679 / stage.H;
      setRemove('filters:remove_region(' + Math.round(r.x * fx) + ',' + Math.round(r.y * fy) + ',' + Math.round(r.w * fx) + ',' + Math.round(r.h * fy) + ')');
      stage.sparkle(S.canAt.clone().setY(S.canAt.y + 0.35), 10);
      if (world.cast) world.cast.react('snap');
    };
    const presetErase = () => erase({ x: canBox.x - 8, y: canBox.y - 8, w: canBox.w + 16, h: canBox.h + 16 });
    doc.getElementById('remove-can').addEventListener('click', () => { if (S.erased) return; if (canBox.w < 2) { canBox = { x: stage.W * 0.42, y: stage.H * 0.45, w: stage.W * 0.08, h: stage.H * 0.2 }; } presetErase(); });
    const norm = (a, b) => ({ x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) });
    drag.addEventListener('pointerdown', (e) => { start = [e.clientX, e.clientY]; if (e.pointerType !== 'touch') drag.setPointerCapture(e.pointerId); });
    drag.addEventListener('pointermove', (e) => {
      if (!start || e.pointerType === 'touch') return;
      const r = norm(start, [e.clientX, e.clientY]);
      dragRect.style.transform = 'translate(' + r.x + 'px,' + r.y + 'px)'; dragRect.style.width = r.w + 'px'; dragRect.style.height = r.h + 'px';
      dragRect.classList.toggle('on', r.w > 6 || r.h > 6);
    });
    drag.addEventListener('pointerup', (e) => {
      if (!start) return;
      const r = norm(start, [e.clientX, e.clientY]);
      start = null; dragRect.classList.remove('on');
      const b = canBox, pad = 20;
      if (r.w < 10 && r.h < 10) { if (r.x > b.x - pad && r.x < b.x + b.w + pad && r.y > b.y - pad && r.y < b.y + b.h + pad) presetErase(); return; }
      if (e.pointerType === 'touch') return;
      // (a box that covers some of the can erases it)
      if (r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y) erase(r);
    });
    drag.addEventListener('pointercancel', () => { start = null; dragRect.classList.remove('on'); });
    // narrow screens: the asks wait in the dock
    stage.dock.ask('cuttle', { verb: 'Tap', text: 'the cuttlefish to blur it', done: { text: 'Blurred', more: '· that is blurclass(person)' } });
    stage.dock.ask('can', { verb: 'Tap', text: 'the can to erase it', done: { text: 'Erased', more: '· that is remove_region' } });

    const css = (e, x, y, w, h) => { e.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)'; e.style.width = Math.round(w) + 'px'; e.style.height = Math.round(h) + 'px'; };

    // ---- the Clam Studio ----
    const studio = { lampsAt: -1, pearlAt: -1, armed: true, sparked: true, shot: false };
    if (DEV) window.__s3 = { studio, S };          // (dev builds: for probes)
    const shots = world.engine && world.engine.renderer ? createSnapshots(world.engine) : null;
    const pics = [...doc.querySelectorAll('#s3 canvas.snapshot[data-pic]')];
    // the before and after: the range moves the line; arrows move it too (it is a real range)
    const compare = doc.getElementById('compare'), range = doc.getElementById('compare-range');
    if (compare && range) range.addEventListener('input', () => compare.style.setProperty('--cut', range.value + '%'));
    // "Do it again": the pearl is a mosaic again at once, and rebuilt half a second later
    const again = doc.getElementById('upscale-again');
    if (again) again.addEventListener('click', () => { studio.pearlAt = stage.t + 0.5; studio.sparked = false; studio.armed = false; });
    // the softboxes are the set's (sets.js: the clam's three jellyfish lamps, lit by glow slots
    // 1 to 3 while the camera is on the reef). With its hook, clam.lampLevel(i, k), they are put
    // out and lit here; without it, only the light they throw is (the glow slots' colours),
    // taken as the set lent them and scaled
    const clam = world.sets && world.sets.clam;
    const glowBase = [new Vector4(), new Vector4(), new Vector4()], glowMine = [new Vector4(), new Vector4(), new Vector4()];
    let glowHave = false;
    const ppm = (d) => stage.pxPerMetre(d);

    this.tick = () => {
      const p = stage.p, t = stage.t, dt = Math.min(stage.dt || 0.016, 0.1), W = stage.W, Hh = stage.H;
      const n1 = near(p, ST.crop), n2 = near(p, ST.faces), n3 = near(p, ST.cuttle), n4 = near(p, ST.can);
      const live = stage.live(), hand = stage.hand(H);

      // ---- 1: the crop frame on the turtle
      const tt = world.fauna && world.fauna.spots && world.fauna.spots.turtle;
      let on1 = 0;
      if (tt && tt.on && n1 > 0.001) {
        stage.project(tt.at, P);
        if (P[2] > 0.5) {
          on1 = n1;
          const ppm = stage.pxPerMetre(P[2]), tw = 2.1 * tt.r * ppm, th = 1.25 * tt.r * ppm, cx = P[0], cy = P[1];
          const shape = preview ?? stage.choices.crop;
          let snapped = true, rest = null;
          if (shape === 2) { target.x = 8; target.y = 8; target.w = W - 16; target.h = Hh - 16; }
          else {
            const a = ASPECT[shape], fw = Math.max(tw, th * a) * 1.14, fh = fw / a;
            const sx = cx - fw / 2, sy = cy - fh / 2;
            rest = [sx + fw * 0.16 + 60, sy + fh];
            const lively = live && stage.wide && stage.pointer.kind !== 'touch' && Math.hypot(hand[0] - cx, hand[1] - cy) < W * 0.4 && !stage.overWords();
            let hx, hy;
            if (lively) {
              snapped = Math.hypot(hand[0] - cx, hand[1] - cy) < Math.max(fw, fh) * 0.75;
              if (n1 > 0.8) drove += dt;
              hx = hand[0]; hy = hand[1];
            } else {
              // no cursor: wander for a moment, then find it again
              snapped = (t % 4.2) / 4.2 > 0.38;
              hx = cx - fw * 0.9 + Math.sin(t * 2.1) * fw * 0.5; hy = cy + Math.cos(t * 1.7) * fh * 0.6;
            }
            if (snapped) { target.x = sx; target.y = sy; target.w = fw; target.h = fh; }
            else { target.x = hx - fw * 0.4; target.y = hy - fh * 0.4; target.w = fw * 0.8; target.h = fh * 0.8; }
          }
          if (rect.x < -900) Object.assign(rect, target);
          const e = 1 - Math.exp(-dt * (snapped ? 11 : 7));
          rect.x += (target.x - rect.x) * e; rect.y += (target.y - rect.y) * e; rect.w += (target.w - rect.w) * e; rect.h += (target.h - rect.h) * e;
          const key = Math.round(rect.x) + ',' + Math.round(rect.y) + ',' + Math.round(rect.w) + ',' + Math.round(rect.h);
          if (key !== lastFrame) { lastFrame = key; css(frame, rect.x, rect.y, rect.w, rect.h); }
          frame.classList.toggle('whole', shape === 2);
          frame.classList.toggle('snapped', snapped);
          const lab = OPTIONS.crop[shape] + (shape === 2 ? ' · nothing cut' : snapped ? ' · subject found' : '');
          if (lab !== lastLabel) { lastLabel = lab; label.textContent = lab; }
          if (rest && stage.wide) cueCrop.at(rest[0], rest[1]);
          cueCrop.show(!!rest && n1 > 0.8 && drove <= 1.2);
        }
      }
      if (!on1) { cueCrop.show(false); rect.x = -999; }
      frame.style.opacity = on1.toFixed(2);

      // ---- 2: the faces
      if (n2 > 0.85 && arrived2 < 0) arrived2 = t;
      if (n2 < 0.2) arrived2 = -1;
      const since = arrived2 < 0 ? -1 : t - arrived2;
      let topY = 1e9, midX = 0, seen = 0;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i], f = S.fish[i];
        if (n2 <= 0.001 || !f) { if (b.on !== 0) { b.on = 0; b.el.style.opacity = '0'; b.el.classList.remove('on'); } continue; }
        v.set(0, 0.03, 0.15).applyMatrix4(f.matrixWorld);
        stage.project(v, P);
        if (P[2] <= 0.3) continue;
        const ppm = stage.pxPerMetre(P[2]) * f.scale.x, w = 0.24 * ppm, h = 0.24 * ppm;
        const intro = since >= 0 && (since < 3 || !live || !stage.wide) ? (since > i * 0.18 ? 1 : 0) : 0;
        const nr = live ? 1 - Math.min(1, Math.max(0, (Math.hypot(hand[0] - P[0], hand[1] - P[1]) - Hh * 0.18) / (Hh * 0.12))) : 0;
        const a = Math.max(intro, nr) * n2;
        if (nr > 0.6 && n2 > 0.8 && live) found = true;
        const key = Math.round(P[0] - w / 2) + ',' + Math.round(P[1] - h / 2) + ',' + Math.round(w);
        if (key !== b.last) { b.last = key; css(b.el, P[0] - w / 2, P[1] - h / 2, w, h); }
        const ab = Math.round(a * 20) / 20;
        if (ab !== b.on) { b.on = ab; b.el.style.opacity = String(ab); b.el.classList.toggle('on', ab > 0.5); }
        topY = Math.min(topY, P[1] - h / 2); midX += P[0]; seen++;
      }
      if (seen && stage.wide) cueFaces.at(midX / seen, topY - 4);
      cueFaces.show(n2 > 0.8 && seen > 0 && !found);

      // ---- 3: the cuttlefish
      let on3 = false;
      if (n3 > 0.001 && S.cuttle) {
        stage.project(S.cuttle.position, P);
        if (P[2] > 0.3) {
          const ppm = stage.pxPerMetre(P[2]), d = 0.95 * ppm;
          on3 = n3 > 0.8;
          if (on3 && arrived3 < 0) arrived3 = t;
          // its blur: where the hand is near (a resting cursor counts here), and once, shyly, on arrival
          const dh = Math.hypot(hand[0] - P[0], hand[1] - P[1]);
          const nearK = stage.pointer.x > -1e3 || stage.live() ? 1 - smooth(Hh * 0.12, Hh * 0.32, dh) : 0;
          const s = arrived3 < 0 ? 0 : t - arrived3, shy = s < 2 ? smooth(0, 0.25, s) * (1 - smooth(1.3, 2.0, s)) : 0;
          const k = Math.max(nearK, shy) * n3;
          const key = Math.round(P[0] - d / 2) + ',' + Math.round(P[1] - d * 0.45) + ',' + Math.round(d) + ',' + k.toFixed(2);
          if (key !== lastLens) { lastLens = key; css(lens, P[0] - d / 2, P[1] - d * 0.45, d, d * 0.9); lens.style.opacity = k.toFixed(2); }
          if (on3 && blurAt < 0 && live && dh < Hh * 0.2) blurAt = t;
          ring.at(P[0], P[1] - 0.32 * ppm);
          cueCuttle.at(P[0], P[1] - 0.32 * ppm - 23);
        }
      }
      if (n3 < 0.2) arrived3 = -1;
      const blurred = blurAt >= 0, ringOn = on3 && !(blurred && t - blurAt > 2.6);
      ring.show(ringOn).done(blurred);
      cueCuttle.show(ringOn && stage.wide).done(blurred);
      if (!on3 && lens.style.opacity !== '0') { lens.style.opacity = '0'; lastLens = ''; }

      // ---- 4: the can
      const live4 = n4 > 0.8;
      let fits = false;
      if (n4 > 0.001 && S.can.visible) {
        v.copy(S.canAt); v.y += 0.31;
        stage.project(v, P);
        if (P[2] > 0.3) {
          const ppm = stage.pxPerMetre(P[2]), w = 0.46 * ppm, h = 0.66 * ppm, pad = 0.03 * Hh;
          canBox = { x: P[0] - w / 2, y: P[1] - h / 2, w, h };
          const hx = canBox.x - pad, hy = canBox.y - pad, hw = w + 2 * pad, hh = h + 2 * pad;
          fits = stage.wide || (hx >= 0 && hy >= 0 && hx + hw <= W && hy + hh <= Hh);
          const key = Math.round(hx) + ',' + Math.round(hy) + ',' + Math.round(hw) + ',' + Math.round(hh);
          if (key !== lastHint) { lastHint = key; css(hint, hx, hy, hw, hh); }
          cueCan.at(hx + 40, hy);
        }
      }
      const shown4 = live4 && !(S.erased && t - goneAt > 2.6);
      hint.classList.toggle('on', shown4 && fits && !start);
      hint.classList.toggle('done', S.erased);
      cueCan.show(shown4 && stage.wide).done(S.erased);
      drag.classList.toggle('live', live4 && !S.erased);
      if (!S.erased && n4 < 0.3 && p < ST.can[0] && removeChip.textContent !== DEFAULT) removeChip.innerHTML = DEFAULT.replace(/,/g, ',<wbr>');

      // (narrow screens: the same two asks, in the dock)
      if (!stage.wide) {
        const want = shown4 ? 'can' : on3 && !(blurred && t - blurAt > 2.6) ? 'cuttle' : null;
        if (want === 'can') stage.dock.ask('can').done(S.erased);
        if (want === 'cuttle') stage.dock.ask('cuttle').done(blurred);
        if (want) stage.dock.show(want);
        else if (stage.dock.current === 'can' || stage.dock.current === 'cuttle') stage.dock.show(null);
      }
      // a tap on the cuttlefish or the can on a narrow screen
      if (!stage.wide && stage.pointer.tapAt > (this.lastTap || 0)) {
        this.lastTap = stage.pointer.tapAt;
        const tx = stage.pointer.tapX, ty = stage.pointer.tapY;
        if (live4 && !S.erased && tx > canBox.x - 20 && tx < canBox.x + canBox.w + 20 && ty > canBox.y - 20 && ty < canBox.y + canBox.h + 20) presetErase();
        if (on3 && blurAt < 0) blurAt = t;
      }

      // ---- the Clam Studio
      // Snap's pictures, once he is there to be photographed (the cards and the finish tiles)
      if (shots && !studio.shot && world.cast && world.cast.snap && world.cast.snap.ready) {
        studio.shot = true;
        shots.shoot(world.cast.snap).then((ok) => {
          if (!ok) return;
          for (const cv of pics) if (shots.paint(cv, cv.dataset.pic) && cv.parentElement.classList.contains('fpic')) cv.parentElement.classList.add('pic');
        }).catch((e) => console.warn('dive: Snap\'s pictures were not taken: ' + (e && e.message || e)));
      }
      // the softboxes: off until Snap comes to the studio, then on one after another; off again
      // when the visitor goes back up the reef, to come on again next time
      if (p < STUDIO.from - 0.03 || p > 4.1) studio.lampsAt = -1;
      else if (studio.lampsAt < 0 && p >= STUDIO.lamps) studio.lampsAt = t + 0.3;
      if (clam && clam.lampLevel) {
        for (let i = 0; i < 3; i++) clam.lampLevel(i, lampLevel(t, studio.lampsAt, i));
      } else if (p < 4.15) {
        for (let i = 0; i < 3; i++) {
          const g = G.glowCol.array[i + 1];
          if (!glowHave || !g.equals(glowMine[i])) glowBase[i].copy(g);
          g.copy(glowBase[i]).multiplyScalar(lampLevel(t, studio.lampsAt, i));
          glowMine[i].copy(g);
        }
        glowHave = true;
      }
      // the pearl: a mosaic (blocks of 2 % of the view's height, at least 8 px) until the upscale
      // card is up while it is in view; then the blocks shrink to nothing over 1.4 s, and it
      // sparkles. Leaving the studio puts the mosaic back for next time.
      if (S.pearl) {
        if (p < STUDIO.from || p > STUDIO.to) { studio.armed = true; studio.pearlAt = -1; studio.sparked = true; }
        else if (studio.armed && p >= STUDIO.upscale[0] && p <= STUDIO.upscale[1]) { studio.armed = false; studio.pearlAt = t; studio.sparked = false; }
        const full = Math.max(8, Hh * 0.02), since = studio.pearlAt < 0 ? -1 : t - studio.pearlAt;
        const block = since < 0 ? full : full * (1 - smooth(0, 1.4, since));
        const lit = (lampLevel(t, studio.lampsAt, 0) + lampLevel(t, studio.lampsAt, 1) + lampLevel(t, studio.lampsAt, 2)) / 3;
        const on = p > STUDIO.from - 0.12 && p < STUDIO.to + 0.06 && S.pearl.set(stage.camera, block, ppm, lit);
        S.pearl.mesh.visible = !!on;
        if (!studio.sparked && since >= 1.4) { studio.sparked = true; if (on) stage.sparkle(S.pearl.at, 8); }
      }
    };
  },
  frame() { if (this.tick) this.tick(); },
};
