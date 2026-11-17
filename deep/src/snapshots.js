// Pictures of Snap for the page: the Clam Studio's cards and the finish tiles (Snap on a warm
// studio backdrop with a soft shadow, Snap on a photo of the marina, Snap cut out on the
// checkerboard). The dive's own renderer draws him once, far off to the side of the world (as
// print.js photographs the print), with the cast's model and a pose and light of a studio's;
// the picture is read back, and set on each backdrop on a 2D canvas: the backdrops are painted
// here, nothing is loaded.
//
//   const shots = createSnapshots(engine)
//   shots.shoot(snap)       draws him (snap: the cast's Snap, once loaded); a promise of
//                           whether it worked
//   shots.paint(canvas, kind)   kind 'photo', 'studio' or 'cut': fills a canvas of any size
import { Group, HalfFloatType, Mesh, PerspectiveCamera, RenderTarget, Scene, UnsignedByteType, Vector3 } from 'three/webgpu';
import { clamp, max, pow, texture, uv, vec3, vec4 } from 'three/tsl';
import { CENTRE, META } from './snap.js';
import { G, pass } from './shaders.js';

const RW = 360, RH = 400;                       // the picture of him, before it is cropped to him
const AT = new Vector3(-600, -3, 600);          // (far outside the world, under three metres of water)

export function createSnapshots(engine) {
  const scene = new Scene(), holder = new Group();
  holder.position.copy(AT);
  holder.rotation.y = -0.32;                    // (a three-quarter view, turned toward his raised claw)
  scene.add(holder);
  const camera = new PerspectiveCamera(23, RW / RH, 0.1, 20);
  camera.position.copy(AT).add(new Vector3(0.06, 0.1, 2.05));
  camera.lookAt(AT.x, AT.y - 0.02, AT.z);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  let him = null, box = null;

  // His picture as rendered holds, in its alpha, how far each pixel of him is (shaders.js): more
  // than a metre and a half all over him, a share of it where a pixel is only partly him. So the
  // grade divides it out into how much of the pixel he covers, and keeps the colour as it is
  // where he is (not darkened toward the clear black at his edge).
  const src = texture(engine.water.texture); src.mergeable = false;
  const grade = pass(null);
  grade.fragmentNode = (() => {
    const s = src.sample(uv());
    const cov = clamp(s.a.div(1.6), 0.0, 1.0);
    const x = s.rgb.div(max(cov, 0.004)).mul(1.06);
    const c = clamp(x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)), 0.0, 1.0);
    return vec4(pow(c, vec3(1 / 2.2)), cov);
  })();

  async function shoot(snap) {
    if (him || !snap || !snap.ready || !snap.mesh) return !!him;
    const r = engine.renderer, U = snap.U;
    const mesh = new Mesh(snap.mesh.geometry, snap.mesh.material);
    mesh.scale.setScalar(snap.height);
    mesh.position.copy(CENTRE).multiplyScalar(-snap.height);
    mesh.frustumCulled = false;
    holder.add(mesh);
    holder.updateMatrixWorld(true);
    // his pose: as he was made (standing, one claw up), looking into the lens, smiling; the
    // cast's own is put back after
    const keep = {
      rot: U.rot.array.map((v) => v.clone()), eyeC: U.eyeC.array.map((v) => v.clone()), eyeRot: U.eyeRot.array.map((v) => v.clone()),
      thumb: U.thumbRot.value.clone(), blink: U.blink.value, squint: U.squint.value, grow: U.eyeGrow.value, cabin: U.cabin.value,
    };
    for (const v of U.rot.array) v.set(0, 0, 0);
    const inv = holder.quaternion.clone().invert(), rest = new Vector3(), want = new Vector3(), axis = new Vector3();
    META.eyes.forEach((e, k) => {
      U.eyeC.array[k].set(e.c[0], e.c[1], e.c[2]);
      rest.set(e.look[0], e.look[1], e.look[2]);
      want.set(e.c[0], e.c[1], e.c[2]);
      mesh.localToWorld(want);
      want.subVectors(camera.position, want).applyQuaternion(inv).normalize();
      axis.crossVectors(rest, want);
      const ang = Math.min(0.56, Math.acos(Math.min(1, Math.max(-1, rest.dot(want)))));
      if (axis.lengthSq() > 1e-10) axis.normalize().multiplyScalar(ang); else axis.set(0, 0, 0);
      U.eyeRot.array[k].copy(axis);
    });
    U.thumbRot.value.set(0, 0, 0); U.blink.value = 0; U.squint.value = 0.4; U.eyeGrow.value = 0; U.cabin.value = 0;
    // a studio's light: a shallow, clear tank, warm light from above and in front, no caustics,
    // no lamp
    const g = { opt: G.opt.value.clone(), light: G.light.value.clone(), lamp: G.lampCol.value.clone(), scat: G.scat.value.clone(), amb: G.amb.value.clone(), deep: G.deepAmb.value.clone() };
    G.opt.value.set(3, 1, g.opt.z, g.opt.w);
    G.light.value.set(1.12, 1.25, 0, 0);
    G.lampCol.value.set(0, 0, 0, 0.8);
    G.scat.value.setRGB(0.3, 0.42, 0.46);
    G.amb.value.setRGB(0.64, 0.62, 0.6);
    G.deepAmb.value.setRGB(0, 0, 0);
    const raw = new RenderTarget(RW, RH, { type: HalfFloatType, samples: engine.q.msaa || 0 });
    const out = new RenderTarget(RW, RH, { type: UnsignedByteType, depthBuffer: false });
    const alpha = r.getClearAlpha();
    try {
      r.setClearAlpha(0);
      r.setRenderTarget(raw);
      r.clear();
      r.render(scene, camera);
      src.value = raw.texture;
      engine.drawQuad(grade, out);
    } finally {
      r.setClearAlpha(alpha);
      G.opt.value.copy(g.opt); G.light.value.copy(g.light); G.lampCol.value.copy(g.lamp);
      G.scat.value.copy(g.scat); G.amb.value.copy(g.amb); G.deepAmb.value.copy(g.deep);
      keep.rot.forEach((v, i) => U.rot.array[i].copy(v));
      keep.eyeC.forEach((v, i) => U.eyeC.array[i].copy(v));
      keep.eyeRot.forEach((v, i) => U.eyeRot.array[i].copy(v));
      U.thumbRot.value.copy(keep.thumb); U.blink.value = keep.blink; U.squint.value = keep.squint; U.eyeGrow.value = keep.grow; U.cabin.value = keep.cabin;
      holder.remove(mesh);
      src.value = engine.water.texture;
    }
    let px;
    try { px = await r.readRenderTargetPixelsAsync(out, 0, 0, RW, RH); } finally { raw.dispose(); out.dispose(); }
    // (WebGPU reads rows from the top, WebGL from the bottom; WebGPU may pad each row)
    const img = new ImageData(RW, RH), row = RW * 4, stride = px.length / RH;
    for (let y = 0; y < RH; y++) { const from = (engine.webgpu ? y : RH - 1 - y) * stride; img.data.set(px.subarray(from, from + row), y * row); }
    // where he is in it
    let x0 = RW, y0 = RH, x1 = -1, y1 = -1;
    for (let y = 0; y < RH; y++) for (let x = 0; x < RW; x++) if (img.data[(y * RW + x) * 4 + 3] > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return false;
    const c = document.createElement('canvas');
    c.width = RW; c.height = RH;
    c.getContext('2d').putImageData(img, 0, 0);
    him = c;
    box = { x: Math.max(0, x0 - 2), y: Math.max(0, y0 - 2), w: Math.min(RW, x1 + 3) - Math.max(0, x0 - 2), h: Math.min(RH, y1 + 3) - Math.max(0, y0 - 2) };
    return true;
  }

  // Fill a canvas: the backdrop, then Snap standing on it (on the marina's pier in the photo; in
  // the middle of a studio backdrop, padded, with his soft shadow; on the checkerboard that
  // means "nothing here")
  function paint(cv, kind) {
    if (!him) return false;
    const w = cv.width, h = cv.height, c = cv.getContext('2d');
    c.clearRect(0, 0, w, h);
    if (kind === 'photo') marina(c, w, h);
    else if (kind === 'cut') checker(c, w, h, Math.max(6, Math.round(h * (h > 150 ? 0.12 : 0.2))));
    else studio(c, w, h);
    const tall = kind === 'studio' ? 0.7 : 0.82, foot = kind === 'studio' ? 0.86 : kind === 'photo' ? 0.97 : 0.93;
    const k = (tall * h) / box.h, dw = box.w * k, dh = box.h * k, x = (w - dw) / 2, y = foot * h - dh;
    if (kind === 'studio') {
      // (his shadow on the sweep, soft)
      c.save();
      c.translate(w / 2, foot * h - h * 0.012);
      c.scale(1, 0.16);
      const s = c.createRadialGradient(0, 0, 0, 0, 0, dw * 0.62);
      s.addColorStop(0, 'rgba(70,45,20,0.42)'); s.addColorStop(0.55, 'rgba(70,45,20,0.2)'); s.addColorStop(1, 'rgba(70,45,20,0)');
      c.fillStyle = s; c.beginPath(); c.arc(0, 0, dw * 0.62, 0, Math.PI * 2); c.fill();
      c.restore();
    }
    c.imageSmoothingQuality = 'high';
    c.drawImage(him, box.x, box.y, box.w, box.h, x, y, dw, dh);
    return true;
  }

  return { shoot, paint, get ready() { return !!him; } };
}

// ---- the backdrops ------------------------------------------------------------------------

// A warm studio sweep: the brand's cream to sun, lighter where the light falls.
function studio(c, w, h) {
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#FFEFCF'); g.addColorStop(0.62, '#FFE0A6'); g.addColorStop(1, '#FFD27E');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  const l = c.createRadialGradient(w * 0.5, h * 0.38, 0, w * 0.5, h * 0.38, Math.max(w, h) * 0.7);
  l.addColorStop(0, 'rgba(255,255,245,0.55)'); l.addColorStop(1, 'rgba(255,255,245,0)');
  c.fillStyle = l; c.fillRect(0, 0, w, h);
}

// The checkerboard of "nothing here": two sands, in squares.
function checker(c, w, h, cell) {
  c.fillStyle = '#F6E7C8'; c.fillRect(0, 0, w, h);
  c.fillStyle = '#E9D3A1';
  const ox = Math.round((w / 2) % (2 * cell)), oy = Math.round(h % (2 * cell));
  for (let y = -2 * cell + oy; y < h; y += cell) for (let x = -2 * cell + ox; x < w; x += cell) if (((Math.round((x - ox) / cell) + Math.round((y - oy) / cell)) & 1) === 0) c.fillRect(x, y, cell, cell);
}

// A photo of the marina at sunset, as the dive opens on it: a lilac and gold sky, the sun low
// by the lighthouse on its point, a sailboat, the sea with the sun's path in it, and the
// planks of the pier in front, where Snap stands.
function marina(c, w, h) {
  const hz = h * 0.55;
  let g = c.createLinearGradient(0, 0, 0, hz);
  g.addColorStop(0, '#9E93D6'); g.addColorStop(0.42, '#E7AEB0'); g.addColorStop(0.78, '#FFC98E'); g.addColorStop(1, '#FFDFA6');
  c.fillStyle = g; c.fillRect(0, 0, w, hz + 1);
  // the sun, low on the right, and its glow
  const sx = w * 0.74, sy = hz - h * 0.07;
  g = c.createRadialGradient(sx, sy, 0, sx, sy, h * 0.6);
  g.addColorStop(0, 'rgba(255,246,214,0.95)'); g.addColorStop(0.1, 'rgba(255,222,160,0.65)'); g.addColorStop(0.4, 'rgba(255,196,140,0.22)'); g.addColorStop(1, 'rgba(255,190,140,0)');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  c.fillStyle = '#FFF6DE'; c.beginPath(); c.arc(sx, sy, h * 0.042, 0, Math.PI * 2); c.fill();
  // the far shore, low in the haze, and the point with its lighthouse
  c.fillStyle = 'rgba(150,110,150,0.55)';
  c.beginPath(); c.moveTo(0, hz); c.bezierCurveTo(w * 0.12, hz - h * 0.06, w * 0.3, hz - h * 0.035, w * 0.42, hz - h * 0.01); c.lineTo(w * 0.42, hz); c.closePath(); c.fill();
  c.fillStyle = 'rgba(120,86,120,0.75)';
  c.beginPath(); c.moveTo(w * 0.8, hz); c.bezierCurveTo(w * 0.86, hz - h * 0.05, w * 0.95, hz - h * 0.06, w, hz - h * 0.05); c.lineTo(w, hz); c.closePath(); c.fill();
  const lx = w * 0.9, lb = hz - h * 0.05, lh = h * 0.16, lw = h * 0.032;
  c.fillStyle = '#F7EFE4';
  c.beginPath(); c.moveTo(lx - lw, lb); c.lineTo(lx - lw * 0.62, lb - lh); c.lineTo(lx + lw * 0.62, lb - lh); c.lineTo(lx + lw, lb); c.closePath(); c.fill();
  c.fillStyle = '#D9503A';
  for (const f of [0.28, 0.62]) c.fillRect(lx - lw * (1 - f * 0.38), lb - lh * f - lh * 0.1, lw * 2 * (1 - f * 0.38), lh * 0.12);
  c.fillStyle = '#3E3346'; c.fillRect(lx - lw * 0.7, lb - lh - h * 0.03, lw * 1.4, h * 0.03);
  c.fillStyle = 'rgba(255,236,180,0.9)'; c.beginPath(); c.arc(lx, lb - lh - h * 0.015, h * 0.012, 0, Math.PI * 2); c.fill();
  // the sea: pale where it meets the sky, deeper toward the pier
  g = c.createLinearGradient(0, hz, 0, h);
  g.addColorStop(0, '#9CC6CE'); g.addColorStop(0.35, '#5E9FB4'); g.addColorStop(1, '#2C6A86');
  c.fillStyle = g; c.fillRect(0, hz, w, h - hz);
  // the sun's path on it, broken into glints, and a few on the swell elsewhere
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    const y = hz + Math.pow(rnd(), 1.6) * (h - hz) * 0.8, spread = (y - hz) * 0.55 + h * 0.02;
    const x = sx + (rnd() - 0.5) * 2 * spread, len = h * (0.015 + 0.05 * rnd()) * (1 + (y - hz) / h);
    c.fillStyle = 'rgba(255,224,160,' + (0.35 + 0.5 * rnd()).toFixed(2) + ')';
    c.fillRect(x - len / 2, y, len, Math.max(1, h * 0.006));
  }
  c.fillStyle = 'rgba(255,255,255,0.18)';
  for (let i = 0; i < 26; i++) { const y = hz + rnd() * (h - hz) * 0.7, len = h * 0.04 * rnd(); c.fillRect(rnd() * w * 0.6, y, len, Math.max(1, h * 0.004)); }
  // a sailboat on the left, small with distance
  const bx = w * 0.2, by = hz + h * 0.03, bs = h * 0.11;
  c.fillStyle = '#FBF4E6';
  c.beginPath(); c.moveTo(bx, by - bs * 0.15); c.lineTo(bx, by - bs); c.lineTo(bx + bs * 0.5, by - bs * 0.15); c.closePath(); c.fill();
  c.fillStyle = '#F0C0A0';
  c.beginPath(); c.moveTo(bx - bs * 0.04, by - bs * 0.15); c.lineTo(bx - bs * 0.04, by - bs * 0.8); c.lineTo(bx - bs * 0.36, by - bs * 0.15); c.closePath(); c.fill();
  c.fillStyle = '#6B3E2C'; c.fillRect(bx - bs * 0.4, by - bs * 0.13, bs * 0.95, bs * 0.12);
  // the pier: weathered planks running into the picture, their gaps, two posts
  const py = h * 0.8;
  g = c.createLinearGradient(0, py, 0, h);
  g.addColorStop(0, '#A87650'); g.addColorStop(1, '#7A5036');
  c.fillStyle = g;
  c.beginPath(); c.moveTo(0, py + h * 0.02); c.lineTo(w, py - h * 0.01); c.lineTo(w, h); c.lineTo(0, h); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(60,34,22,0.55)'; c.lineWidth = Math.max(1, h * 0.006);
  for (let i = 1; i < 5; i++) { const y = py + (h - py) * (i / 5) * (i / 5) + h * 0.006; c.beginPath(); c.moveTo(0, y + h * 0.02 * (1 - i / 5)); c.lineTo(w, y - h * 0.01 * (1 - i / 5)); c.stroke(); }
  c.fillStyle = '#5E3A27';
  for (const x of [w * 0.06, w * 0.95]) c.fillRect(x - h * 0.03, py - h * 0.12, h * 0.06, h * 0.16);
  c.fillStyle = 'rgba(255,214,150,0.35)';
  for (const x of [w * 0.06, w * 0.95]) c.fillRect(x + h * 0.012, py - h * 0.12, h * 0.014, h * 0.16);
}
