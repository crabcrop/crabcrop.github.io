// The kelp forest's things (zone s2): three silk curtains hung on a rope between two knitted
// kelp stalks, over the camera's way, one per look (Vintage, Deep sea, Crisp, left to right,
// as in the painted kelp plate); and the old fishing line the little fish is caught in.
//
// The curtains are felt-silk: smooth, pleated, the light coming through them like stained glass
// when the eye is under them; they sway in the swell, the hem most. The line is drawn from the
// fish's own placement (the shallows' fish system, props/shallows.js): it comes down from
// above the view and winds round the fish's body; once cut, its upper part springs up and the
// loops fall open as it fades.
import { BufferAttribute, BufferGeometry, Mesh as ThreeMesh, Sphere, Vector3 } from 'three/webgpu';
import {
  abs, cameraPosition, cos, cross, dot, float, fract, int, length, max, mix, normalize, pow, select, sin, smoothstep, step, uniform, vec3,
} from 'three/tsl';
import { groundY } from '../layout.js';
import { Mesh, TAU, blob, tube } from '../math.js';
import { G, material, sunAt, yarn } from '../shaders.js';

const toLin = (x) => Math.pow(x, 2.2);
const lin = (r, g, b) => vec3(toLin(r), toLin(g), toLin(b));
export const LOOK_NAMES = ['Vintage', 'Deep sea', 'Crisp'];
// (which look each curtain is, as an index of the look choice: Crisp 0, Deep sea 1, Vintage 2)
export const CURTAIN_LOOK = [2, 1, 0];

// ---- the curtains and their frame ------------------------------------------------------------

// `centre` [x, z]: the middle of the rope; `along` [x, z]: the rope's level direction (left to
// right as the camera sees it); `facing` [x, z]: toward the camera's approach. The rope hangs
// `high` metres over the sand, the curtains `drop` metres down from it, `width` wide, `gap`
// apart. Returns the meshes, the uniforms (hover per curtain), and each curtain's top and hem
// middles (for the page's buttons and pills).
export function buildCurtains(scene, { centre, along, facing, high = 11, drop = 6, width = 1.5, gap = 2.3, lod = 1 }) {
  const g0 = groundY(centre[0], centre[1]), ropeY = g0 + high;
  const A = (s, out) => { out[0] = centre[0] + along[0] * s; out[1] = centre[1] + along[1] * s; return out; };
  const P2 = [0, 0];
  // the rope's height along it: tied to the stalks at both ends, sagging between
  const half = gap * 1.5 + width * 0.5 + 0.55, sag = 0.35;
  const ropeAt = (s) => ropeY - sag * (1 - (s / half) * (s / half));
  // ---- the silk
  const cols = lod ? 12 : 8, rows = lod ? 26 : 16;
  const m = new Mesh(true), tops = [], hems = [];
  for (let c = 0; c < 3; c++) {
    const mid = (c - 1) * gap;
    m.grid(cols, rows, (u, v, o) => {
      const s = mid + (u - 0.5) * width;
      A(s, P2);
      // gathered in pleats, deeper at the top where it is bunched on the rope; the hem a
      // little longer at the middle
      const pleat = Math.sin(u * TAU * 3.5 + c) * (0.07 - 0.03 * v);
      const y = ropeAt(s) - 0.06 - v * (drop + 0.25 * Math.sin(u * Math.PI));
      o[0] = P2[0] + facing[0] * pleat; o[1] = y; o[2] = P2[1] + facing[1] * pleat;
      o[3] = u; o[4] = v; o[5] = c; o[6] = 0;
    }, false);
    A(mid, P2);
    tops.push(new Vector3(P2[0], ropeAt(mid) - 0.06, P2[1]));
    hems.push(new Vector3(P2[0], ropeAt(mid) - 0.06 - drop - 0.25, P2[1]));
  }
  const geo = m.build();
  geo.boundingSphere = new Sphere(new Vector3(centre[0], ropeY - drop / 2, centre[1]), half + drop);
  const hover = uniform(new Vector3(0, 0, 0));
  const FX = vec3(facing[0], 0, facing[1]), AX = vec3(along[0], 0, along[1]);
  const silk = material({
    aux: true, twoSided: true, transparent: true, shadow: false, fade: [42, 58],
    vertex: (v) => {
      const u = v.aux.x, w = v.aux.y, c = v.aux.z, t = G.time;
      const k = w.mul(w);
      // the swell: the hem swings most, a ripple runs across it
      const sway = sin(t.mul(0.7).add(c.mul(2.1)).add(w.mul(2.2))).mul(0.24).mul(k).add(sin(t.mul(1.3).add(u.mul(5.0)).add(c)).mul(0.05).mul(w));
      const swing = sin(t.mul(0.45).add(c.mul(1.7))).mul(0.14).mul(k);
      v.P.assign(v.P.add(FX.mul(sway)).add(AX.mul(swing)));
    },
    surface: (s, f) => {
      const u = f.aux.x, w = f.aux.y, c = f.aux.z;
      // each curtain dyed in its look: Vintage the warm browns of an old print, mottled as if
      // faded; Deep sea two inks, sand above and deep blue below, meeting in a wavy line; Crisp
      // vivid rose and violet in sharp-edged bands
      const fade = sin(u.mul(7.0).add(w.mul(11.0)).add(c)).mul(sin(u.mul(13.0).sub(w.mul(5.0)))).mul(0.5).add(0.5);
      const vint = mix(lin(0.93, 0.74, 0.5), lin(0.62, 0.38, 0.24), smoothstep(0.05, 1.0, w)).mul(fade.mul(0.14).add(0.9));
      const ink = smoothstep(0.42, 0.5, w.add(sin(u.mul(11.0).add(w.mul(3.0))).mul(0.045)));
      const deep = mix(lin(1.0, 0.847, 0.541), lin(0.07, 0.17, 0.27), ink);
      const band = step(0.5, fract(w.mul(5.0).add(u.mul(0.6))));
      const crisp = mix(lin(1.0, 0.3, 0.6), lin(0.62, 0.3, 1.0), band);
      const base = select(c.lessThan(0.5), vint, select(c.lessThan(1.5), deep, crisp)).toVar();
      // its folds: each pleat a little darker in its hollow
      const fold = cos(u.mul(TAU * 3.5).add(c)).mul(0.5).add(0.5);
      // a stitched hem at the foot and a turned band at the top, in a paler thread
      const hem = smoothstep(0.955, 0.965, w), top = float(1.0).sub(smoothstep(0.035, 0.045, w));
      const stitch = step(0.5, fract(u.mul(46.0))).mul(float(1.0).sub(smoothstep(0.002, 0.006, abs(w.sub(0.94)))));
      const thread = select(c.lessThan(0.5), lin(0.98, 0.92, 0.8), select(c.lessThan(1.5), lin(1.0, 0.86, 0.55), lin(1.0, 0.9, 0.96)));
      s.albedo = mix(mix(base, base.mul(0.8), max(hem, top)).mul(fold.mul(0.22).add(0.8)), thread, stitch).toVar();
      // silk: a sheen along the folds, thin enough for the light to come through it as through
      // stained glass, the more so looking up at it
      s.spec = float(0.5); s.gloss = float(22.0); s.fluor = float(0.7); s.trans = float(0.9);
      const vv = normalize(f.w.sub(cameraPosition));
      const toward = pow(max(dot(vv, G.sunDir), 0.0), 2.0), below = smoothstep(-0.25, 0.5, vv.y);
      const back = toward.mul(0.9).add(below.mul(0.8)).add(0.22);
      s.emis = s.emis.add(sunAt(f.w.y).mul(back).mul(s.albedo).mul(fold.mul(0.4).add(0.8)).mul(0.9));
      // the one the hand is over glows a little
      const h = select(c.lessThan(0.5), hover.x, select(c.lessThan(1.5), hover.y, hover.z));
      s.emis = s.emis.add(s.albedo.mul(h).mul(0.6)).add(vec3(0.25, 0.22, 0.16).mul(h).mul(0.3));
      s.alpha = mix(float(0.76), float(1.0), max(hem, top));
      s.caustic = float(0.6);
    },
  });
  const silkMesh = new ThreeMesh(geo, silk);
  silkMesh.matrixAutoUpdate = false;
  silkMesh.renderOrder = 2;
  silkMesh.visible = false;
  scene.add(silkMesh);

  // ---- the frame: two knitted stalks, a rope between them, a ring for each curtain
  const f = new Mesh(true);
  const paint = (from, r, g, b, kind) => { for (let i = from; i < f.count; i++) { f.a[i * 4] = toLin(r); f.a[i * 4 + 1] = toLin(g); f.a[i * 4 + 2] = toLin(b); f.a[i * 4 + 3] = kind; } };
  for (const end of [-1, 1]) {
    A(end * (half + 0.05), P2);
    const gx = P2[0], gz = P2[1], gy = groundY(gx, gz) - 0.2, top = ropeY + 6.5, pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12, y = gy + (top - gy) * t; pts.push([gx + Math.sin(t * 2.4 + end) * 0.25, y, gz + Math.cos(t * 1.9 + end) * 0.2, 0.32 * (1 - 0.3 * t)]); }
    let k = f.count;
    tube(f, pts, lod ? 12 : 8);
    paint(k, 0.5, 0.49, 0.22, 1);
    // floats: big yarn balls up the stalk, on alternate sides
    for (const [h, sd] of [[0.3, 1], [0.58, -1], [0.86, 1]]) {
      const y = gy + (top - gy) * h, ox = facing[0] * 0.15 + along[0] * sd * 0.42, oz = facing[1] * 0.15 + along[1] * sd * 0.42;
      k = f.count;
      blob(f, gx + ox + Math.sin(h * 2.4 + end) * 0.25, y, gz + oz + Math.cos(h * 1.9 + end) * 0.2, () => 0.46, lod ? 6 : 4);
      paint(k, 0.86, 0.64, 0.24, 0);
    }
    // the rope tied round it
    k = f.count;
    const ty = ropeY, lp = [];
    for (let i = 0; i <= 10; i++) { const a = (i / 10) * TAU * 1.5; lp.push([gx + Math.sin(TAU * 0.2 + end) * 0.25 + Math.cos(a) * 0.36, ty - 0.12 + i * 0.024, gz + Math.cos(TAU * 0.16 + end) * 0.2 + Math.sin(a) * 0.36, 0.05]); }
    tube(f, lp, 6);
    paint(k, 0.82, 0.7, 0.52, 2);
  }
  {
    const k = f.count, rp = [];
    for (let i = 0; i <= 24; i++) { const s = -half + (2 * half * i) / 24; A(s, P2); rp.push([P2[0], ropeAt(s), P2[1], 0.045]); }
    tube(f, rp, 6);
    // and a felt loop at the top of each curtain, round the rope
    for (let c = 0; c < 3; c++) for (let j = 0; j < 4; j++) {
      const s = (c - 1) * gap + (j / 3 - 0.5) * width * 0.92;
      A(s, P2);
      const y = ropeAt(s), lp = [];
      for (let i = 0; i <= 8; i++) { const a = (i / 8) * TAU; lp.push([P2[0] + facing[0] * Math.cos(a) * 0.08, y - 0.04 + Math.sin(a) * 0.09, P2[1] + facing[1] * Math.cos(a) * 0.08, 0.025]); }
      tube(f, lp, 4);
    }
    paint(k, 0.82, 0.7, 0.52, 2);
  }
  const fg = f.build();
  fg.computeBoundingSphere();
  const frame = new ThreeMesh(fg, material({
    aux: true, fade: [46, 60],
    surface(s, fr) {
      const kind = fr.aux.w, col = fr.aux.xyz;
      // the stalk knitted in olive with an ochre stripe that wanders round it; the floats and
      // the rope in their own yarns
      const stalk = step(0.5, kind).mul(float(1.0).sub(step(1.5, kind)));
      const stripe = smoothstep(-0.1, 0.1, sin(fr.w.y.mul(0.45).add(fr.n.x.mul(2.0)).add(fr.n.z.mul(1.4))));
      const c = mix(col, mix(col, lin(0.84, 0.62, 0.22), stripe), stalk);
      yarn(s, fr, { color: c, scale: 18, p: fr.w, k: 1.4 });
      s.fluor = float(0.7);
    },
  }));
  frame.matrixAutoUpdate = false;
  frame.visible = false;
  scene.add(frame);
  return { silk: silkMesh, frame, hover, tops, hems, width, show(on) { silkMesh.visible = on; frame.visible = on; } };
}

// ---- the fishing line ----------------------------------------------------------------------

// A line from `top` (a uniform, world) down to the fish in slot `slot` of the fish system's
// POSE, wound round its body; `cut` 0 (whole) to 1 (sprung away and gone). Drawn as a thin
// ribbon that faces the eye, about a pixel and a half wide wherever it is.
export function buildLine(scene, POSE, slot, n = 64) {
  const top = uniform(new Vector3(0, -1000, 0)), cut = uniform(0), show = uniform(0);
  const pos = new Float32Array((n + 1) * 2 * 3), aux = new Float32Array((n + 1) * 2 * 4), idx = [];
  for (let i = 0; i <= n; i++) for (let k = 0; k < 2; k++) { const j = i * 2 + k; aux[j * 4] = i / n; aux[j * 4 + 1] = k ? 1 : -1; pos[j * 3 + 1] = i / n; }
  for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array((n + 1) * 2 * 3).fill(0.577), 3));
  g.setAttribute('aux', new BufferAttribute(aux, 4));
  g.setIndex(idx);
  g.boundingSphere = new Sphere(new Vector3(), 1e5);
  const i3 = slot * 3;
  const centre = (s) => {
    const A = POSE.element(int(i3)), B = POSE.element(int(i3 + 1)), C = POSE.element(int(i3 + 2));
    const L = A.w, F = normalize(B.xyz), Up = normalize(C.xyz), R = cross(F, Up);
    const knot = A.xyz.add(F.mul(L.mul(0.1))).add(Up.mul(L.mul(0.23)));
    // above: from the top down to the knot, swaying; once cut its lower end springs up
    const g1 = s.div(0.55).min(1.0);
    const end = mix(knot, top, cut.mul(0.75));
    const upper = mix(top, end, g1).add(R.mul(sin(G.time.mul(1.3).add(g1.mul(3.0))).mul(0.04).mul(g1)));
    // round the body: a loose spiral from the back of the head toward the tail, falling open
    const g2 = s.sub(0.55).div(0.45).max(0.0);
    const ang = g2.mul(TAU * 1.7), open = cut.mul(1.8).add(1.0);
    const loops = A.xyz.add(F.mul(mix(float(0.1), float(-0.16), g2).mul(L)))
      .add(Up.mul(cos(ang).mul(L).mul(0.23).mul(open))).add(R.mul(sin(ang).mul(L).mul(0.1).mul(open)));
    return select(s.lessThan(0.55), upper, loops);
  };
  const mat = material({
    aux: true, transparent: true, twoSided: true, shadow: false,
    vertex: (v) => {
      const s = v.aux.x, side = v.aux.y;
      const P = centre(s).toVar(), P2 = centre(s.add(0.012).min(1.0)).toVar(), P0 = centre(s.sub(0.012).max(0.0)).toVar();
      const T = normalize(P2.sub(P0).add(vec3(0.0, 1e-5, 0.0)));
      const toEye = normalize(cameraPosition.sub(P));
      const W = normalize(cross(T, toEye).add(vec3(1e-5, 0.0, 0.0)));
      const d = length(cameraPosition.sub(P));
      v.P.assign(P.add(W.mul(side).mul(max(d.mul(0.0011), 0.0028))));
      v.N.assign(toEye);
    },
    raw: () => {
      // monofilament: pale, catching the light of the water round it
      const col = G.amb.mul(0.55).add(vec3(0.42, 0.42, 0.38)).mul(1.1);
      return { color: col, alpha: float(0.85).mul(float(1.0).sub(cut)).mul(show) };
    },
  });
  const mesh = new ThreeMesh(g, mat);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.visible = false;
  mesh.renderOrder = 3;
  scene.add(mesh);
  return { mesh, top, cut, show };
}

// (for the look tiles and specimens: the print in a look, fitted into a canvas: 'cover' fills
// it, cutting the rest; 'contain' fits it whole on `bg`, or the canvas's own colour)
export function fitInto(canvas, src, mode, bg = null, pad = 0) {
  const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
  if (!src || !src.width) return;
  g.clearRect(0, 0, W, H);
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, W, H); }
  const sw = src.width, sh = src.height, k = mode === 'cover' ? Math.max(W / sw, H / sh) : Math.min((W - 2 * pad) / sw, (H - 2 * pad) / sh);
  const w = sw * k, h = sh * k;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
}
