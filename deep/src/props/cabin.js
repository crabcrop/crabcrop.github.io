// The captain's cabin's loose things (zone s4, src/zones/s4.js), made in code in the wreck's own
// look (wood, brass, red sealing wax, a flame behind glass):
//   the chest      a small sea chest by the desk, bound in brass, whose barrel lid opens on its
//                  hinge (warm light inside) and shuts, with a thunk, over its lock plate
//   the wax seal   the desk's seal: a wooden stamp on a brass foot, and the blob of red wax it
//                  presses when the visitor's URL is sealed (gone again when it is readable)
//   the letter's   the red wax with a crab in it that Snap presses onto the octopus's letter
//   the lantern    hanging from its hook over the desk: it swings, and its light (the wreck's
//                  glow slot 0) and its warm haze swing with it, flickering
//   the dust       specks rising slowly through the cabin, glinting warm near the lantern and
//                  swirling away from the visitor's hand
// The wood, brass, wax and glass are one mesh: each vertex belongs to a part (the chest's box,
// its lid, the stamp, the letter's wax, the desk's wax, the lantern) whose placement is a
// 3 x 4 matrix in a uniform array, so all of them move without a draw call each. The two hazes
// (the lantern's, the open chest's) are one more, the dust one more.
//
// buildCabin(ctx, wreck) returns null without a wreck, else:
//   { mesh, haze, dust, frame, at: { chest, lidTip, stamp, deskWax, letter, lantern, hook },
//     setLid(open, squash), setStamp(press, lift), setWax(letterK, deskK), setLantern(angle, axis),
//     glow(k), flame(k), dustStep(...), show(on) }
// Everything is placed in the desk's frame: x across the cabin toward its port wall (away
// from the hole the camera looks in through), y up the deck, z along the ship toward the bow;
// lengths in metres from the foot of the desk's middle (sets.js builds the desk).
import { BufferAttribute, DynamicDrawUsage, InstancedBufferAttribute, InstancedBufferGeometry, Matrix4, Mesh as ThreeMesh, Quaternion, Sphere, Vector3, Vector4 } from 'three/webgpu';
import { abs, attribute, cameraPosition, cross, dot, exp, float, floor, fract, fwidth, int, length, max, mix, normalize, sin, smoothstep, step, texture, uniform, uniformArray, varyingProperty, vec2, vec3, vec4 } from 'three/tsl';
import { Mesh, TAU } from '../math.js';
import { G, SIG, detail, hash1, material } from '../shaders.js';

// The parts, and the kinds of surface (a vertex's aux.w is part * 10 + kind).
export const PART = { chest: 0, lid: 1, stamp: 2, letterWax: 3, deskWax: 4, lantern: 5 };
const NPART = 6;
const K = { wood: 0, dark: 1, brass: 2, wax: 3, flame: 4, inside: 5, rope: 6, iron: 7, lamp: 8, handle: 9 };
const lin = (c) => [Math.pow(c[0], 2.2), Math.pow(c[1], 2.2), Math.pow(c[2], 2.2)];

// The desk's frame: from what sets.js hands over (wreck.desk, once it does), else worked out from
// the envelope on the desk and the way out of the cabin (the ship's port side is the way in).
export function deskFrame(wreck) {
  if (wreck.desk) return wreck.desk;
  const f = wreck.cabinFacing, X = new Vector3(-f.x, -f.y, -f.z).normalize();
  const ph = Math.hypot(X.x, X.z) || 1, px = X.x / ph, pz = X.z / ph, sh = X.y, ch = Math.sqrt(Math.max(0, 1 - sh * sh));
  const Y = new Vector3(-px * sh, ch, -pz * sh), Z = new Vector3(-pz, 0, px);
  // (the envelope's middle is 0.05 toward the hole, 0.88 up and 0.25 sternward of the desk's foot)
  const at = wreck.envelope.clone().addScaledVector(X, 0.05).addScaledVector(Y, -0.88).addScaledVector(Z, 0.25);
  return { at, x: X, y: Y, z: Z };
}

// ---- geometry, in the world, from the desk's frame ----------------------------------------------

// A triangle wound so that it faces n.
function triFacing(m, a, b, c, nx, ny, nz) {
  const p = m.p;
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
  if ((uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz >= 0) m.i.push(a, b, c); else m.i.push(a, c, b);
}
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// A box with rounded edges: centre c, unit axes X, Y, Z (arrays), half sizes h, edge radius r.
// aux(lx, ly, lz, out) fills each vertex's aux from where it is on the box.
function rbox(m, c, X, Y, Z, h, r, aux) {
  const rr = Math.min(r, Math.min(h[0], h[1], h[2]) * 0.98);
  const coords = (hh) => [-hh, -hh + rr * 0.3, -hh + rr, hh - rr, hh - rr * 0.3, hh];
  const L = [coords(h[0]), coords(h[1]), coords(h[2])];
  const o = [0, 0, 0, 0], q = [0, 0, 0], inner = [0, 0, 0], A = [X, Y, Z];
  for (let axis = 0; axis < 3; axis++) for (const sgn of [-1, 1]) {
    const b = (axis + 1) % 3, cc = (axis + 2) % 3, Lb = L[b], Lc = L[cc], v0 = m.count;
    for (let i = 0; i < Lb.length; i++) for (let j = 0; j < Lc.length; j++) {
      q[axis] = sgn * h[axis]; q[b] = Lb[i]; q[cc] = Lc[j];
      for (let e = 0; e < 3; e++) inner[e] = clamp(q[e], -(h[e] - rr), h[e] - rr);
      const dx = q[0] - inner[0], dy = q[1] - inner[1], dz = q[2] - inner[2], dl = Math.hypot(dx, dy, dz) || 1;
      const nx = dx / dl, ny = dy / dl, nz = dz / dl;
      const lx = inner[0] + nx * rr, ly = inner[1] + ny * rr, lz = inner[2] + nz * rr;
      o[0] = lx; o[1] = ly; o[2] = 1; o[3] = 0;
      if (aux) aux(lx, ly, lz, o);
      m.vert(c[0] + X[0] * lx + Y[0] * ly + Z[0] * lz, c[1] + X[1] * lx + Y[1] * ly + Z[1] * lz, c[2] + X[2] * lx + Y[2] * ly + Z[2] * lz,
        X[0] * nx + Y[0] * ny + Z[0] * nz, X[1] * nx + Y[1] * ny + Z[1] * nz, X[2] * nx + Y[2] * ny + Z[2] * nz, 0, 0, o[0], o[1], o[2], o[3]);
    }
    const F = A[axis], wc = Lc.length;
    for (let i = 0; i < Lb.length - 1; i++) for (let j = 0; j < wc - 1; j++) {
      const a = v0 + i * wc + j;
      triFacing(m, a, a + wc, a + 1, F[0] * sgn, F[1] * sgn, F[2] * sgn); triFacing(m, a + 1, a + wc, a + wc + 1, F[0] * sgn, F[1] * sgn, F[2] * sgn);
    }
  }
}

// A tube through points [[x, y, z, r], ...] with a frame carried along it; radius(k, j, ang)
// scales the radius (a flat strap, a rounded one); caps rounds off both ends.
function sweep(m, pts, sides, { radius = null, up = [1, 0, 0], closed = false, caps = false, code = 0, along = null, plain = false } = {}) {
  const n = pts.length, base = m.count, i0 = m.i.length;
  let ux = up[0], uy = up[1], uz = up[2];
  for (let k = 0; k < n; k++) {
    const a = pts[closed ? (k - 1 + n) % n : Math.max(k - 1, 0)], b = pts[closed ? (k + 1) % n : Math.min(k + 1, n - 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    let sx = ty * uz - tz * uy, sy = tz * ux - tx * uz, sz = tx * uy - ty * ux;
    let sl = Math.hypot(sx, sy, sz);
    if (sl < 1e-4) { const alt = Math.abs(tx) < 0.9 ? [1, 0, 0] : [0, 1, 0]; sx = ty * alt[2] - tz * alt[1]; sy = tz * alt[0] - tx * alt[2]; sz = tx * alt[1] - ty * alt[0]; sl = Math.hypot(sx, sy, sz); }
    sx /= sl; sy /= sl; sz /= sl;
    ux = sy * tz - sz * ty; uy = sz * tx - sx * tz; uz = sx * ty - sy * tx;
    for (let j = 0; j <= sides; j++) {
      const ang = (j / sides) * TAU, c = Math.cos(ang), s = Math.sin(ang);
      const r = pts[k][3] * (radius ? radius(k, j % sides, ang) : 1);
      const nx = sx * c + ux * s, ny = sy * c + uy * s, nz = sz * c + uz * s;
      m.vert(pts[k][0] + nx * r, pts[k][1] + ny * r, pts[k][2] + nz * r, nx, ny, nz, j / sides, k / Math.max(n - 1, 1), plain ? 0.05 : j / sides, along ? along[k] : k / Math.max(n - 1, 1), 1, code);
    }
  }
  const w = sides + 1, segs = closed ? n : n - 1;
  for (let k = 0; k < segs; k++) for (let j = 0; j < sides; j++) {
    const a = base + k * w + j, b = base + ((k + 1) % n) * w + j;
    m.i.push(a, b, a + 1, a + 1, b, b + 1);
  }
  m.normals(base, m.count, i0, null);
  for (let k = 0; k < n; k++) {
    const a = (base + k * w) * 3, b = (base + k * w + sides) * 3;
    for (let e = 0; e < 3; e++) { const s = m.n[a + e] + m.n[b + e]; m.n[a + e] = s; m.n[b + e] = s; }
    const l = Math.hypot(m.n[a], m.n[a + 1], m.n[a + 2]) || 1;
    for (let e = 0; e < 3; e++) { m.n[a + e] /= l; m.n[b + e] = m.n[a + e]; }
  }
  if (caps && !closed) for (const k of [0, n - 1]) {
    const a = pts[k], b = pts[k === 0 ? 1 : n - 2];
    let tx = a[0] - b[0], ty = a[1] - b[1], tz = a[2] - b[2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    const c = m.vert(a[0] + tx * a[3] * 0.4, a[1] + ty * a[3] * 0.4, a[2] + tz * a[3] * 0.4, tx, ty, tz, 0.5, k ? 1 : 0, plain ? 0.05 : 0.5, along ? along[k] : k ? 1 : 0, 1, code);
    const ring = base + k * w;
    for (let j = 0; j < sides; j++) triFacing(m, ring + j, ring + j + 1, c, tx, ty, tz);
  }
}

// A blob of red sealing wax pressed flat on a surface (Y up from it): a wobbly rim, the stamp's
// face sunk into it with a raised ring and a little crab of three bumps. R its radius, H its height.
function waxSeal(m, c, X, Y, Z, R, H, seed, code) {
  const rings = 11, segs = 30, base = m.count, i0 = m.i.length;
  const hAt = (rho, phi) => {
    const rim = 0.86 + 0.05 * Math.sin(phi * 5 + seed) + 0.03 * Math.sin(phi * 9 - seed * 2) + 0.025 * Math.sin(phi * 14 + seed);
    const body = Math.sqrt(Math.max(0, 1 - sstep(rim - 0.3, rim + 0.04, rho)));
    const x = rho * Math.cos(phi), y = rho * Math.sin(phi);
    const face = 1 - sstep(0.56, 0.64, rho);
    const ring = Math.exp(-((rho - 0.55) ** 2) / 0.0012);
    const crab = Math.exp(-(x * x + (y + 0.05) ** 2) / 0.02) + 0.7 * Math.exp(-((x - 0.21) ** 2 + (y - 0.2) ** 2) / 0.005) + 0.7 * Math.exp(-((x + 0.21) ** 2 + (y - 0.2) ** 2) / 0.005);
    return H * (body - 0.32 * face + 0.22 * ring * face + 0.3 * Math.min(crab, 1.2) * face) - 0.002;
  };
  for (let k = 0; k <= rings; k++) for (let j = 0; j <= segs; j++) {
    const rho = (k / rings) * 1.08, phi = (j / segs) * TAU, h = Math.max(hAt(rho, phi), -0.002);
    const lx = Math.cos(phi) * rho * R, lz = Math.sin(phi) * rho * R;
    m.vert(c[0] + X[0] * lx + Y[0] * h + Z[0] * lz, c[1] + X[1] * lx + Y[1] * h + Z[1] * lz, c[2] + X[2] * lx + Y[2] * h + Z[2] * lz, Y[0], Y[1], Y[2], 0, 0, rho, phi, 1, code);
  }
  const w = segs + 1;
  for (let k = 0; k < rings; k++) for (let j = 0; j < segs; j++) {
    const a = base + k * w + j;
    triFacing(m, a, a + w, a + 1, Y[0], Y[1], Y[2]); triFacing(m, a + 1, a + w, a + w + 1, Y[0], Y[1], Y[2]);
  }
  m.normals(base, m.count, i0, null);
}

// ---- the material ----------------------------------------------------------------------------

// one 3 x 4 matrix per part (three rows), set every frame the part moves
const ROWS = Array.from({ length: NPART * 3 }, (_, i) => new Vector4(i % 3 === 0 ? 1 : 0, i % 3 === 1 ? 1 : 0, i % 3 === 2 ? 1 : 0, 0));
const U = { flame: uniform(1), inside: uniform(0), pix: uniform(0.002) };

function propsMaterial(PARTS) {
  const WOOD = lin([0.46, 0.29, 0.16]), DARK = lin([0.30, 0.17, 0.09]), HANDLE = lin([0.5, 0.27, 0.14]), WAX = lin([0.72, 0.11, 0.09]), IRON = lin([0.09, 0.08, 0.075]), ROPE = lin([0.62, 0.50, 0.34]);
  const srgb = (r, g, b) => vec3(Math.pow(r, 2.2), Math.pow(g, 2.2), Math.pow(b, 2.2));
  return material({
    aux: true, shadow: false, fade: [40, 55],
    vertex: (v) => {
      const code = v.aux.w;
      const i = int(floor(code.add(0.5).div(10))).mul(3);
      const r0 = PARTS.element(i), r1 = PARTS.element(i.add(1)), r2 = PARTS.element(i.add(2));
      const P0 = v.P.toVar(), N0 = v.N.toVar();
      v.P.assign(vec3(dot(r0.xyz, P0).add(r0.w), dot(r1.xyz, P0).add(r1.w), dot(r2.xyz, P0).add(r2.w)));
      v.N.assign(normalize(vec3(dot(r0.xyz, N0), dot(r1.xyz, N0), dot(r2.xyz, N0))));
    },
    surface: (s, f) => {
      const code = f.aux.w, kind = code.sub(floor(code.add(0.5).div(10)).mul(10)).toVar();
      const is = (k) => float(1).sub(step(0.5, abs(kind.sub(k))));
      const handleK = is(K.handle), woodK = is(K.wood).add(is(K.dark)).add(handleK).toVar(), brassK = is(K.brass).add(is(K.lamp)).toVar();
      const waxK = is(K.wax), flameK = is(K.flame), insideK = is(K.inside), ropeK = is(K.rope), ironK = is(K.iron);
      // wood: planks 0.1 m wide across aux.x, each its own tone, the grain in streaks along aux.y,
      // the seams dark (never thinner than a pixel holds)
      const near = float(1).sub(smoothstep(3.0, 16.0, f.dist)).toVar();
      const pk = f.aux.x.div(0.1).toVar(), row = floor(pk);
      const tone = hash1(row.mul(0.173).add(0.31)).mul(0.22).add(0.88);
      const g1 = texture(G.detailTex, vec2(f.aux.x.mul(1.6), f.aux.y.mul(0.11))).toVar();
      const g2 = texture(G.detailTex, vec2(f.aux.x.mul(4.3).add(0.37), f.aux.y.mul(0.35))).toVar();
      const streak = g1.b.mul(0.55).add(g2.b.mul(0.45));
      const lines = sin(f.aux.x.mul(41.0).add(g1.r.mul(9.0)).add(g2.g.mul(4.0))).mul(0.5).add(0.5);
      const fw = fwidth(pk);
      const seam = float(1).sub(smoothstep(0.0, max(float(0.05), fw.mul(0.9)), float(0.5).sub(abs(fract(pk).sub(0.5))))).mul(float(1).sub(smoothstep(0.25, 0.6, fw)));
      const woodCol = mix(mix(vec3(...WOOD), vec3(...DARK), is(K.dark)), vec3(...HANDLE), handleK).mul(tone).mul(streak.sub(0.45).mul(0.6).add(0.86)).mul(float(1).sub(smoothstep(0.55, 0.95, lines).mul(near).mul(0.16))).mul(float(1).sub(seam.mul(0.6)));
      // brass: warm metal, tarnished green in the hollows
      const D = detail(f.w, s.n, 3.0, 0.8);
      const tarn = smoothstep(0.35, 0.75, D.m).mul(0.55);
      const brassCol = mix(srgb(0.80, 0.60, 0.30), srgb(0.42, 0.48, 0.36), tarn);
      // the inside of the open chest: dark wood, lit warm from within
      const albedo = woodCol.mul(woodK).add(brassCol.mul(brassK)).add(vec3(...WAX).mul(waxK)).add(vec3(...IRON).mul(ironK)).add(vec3(...ROPE).mul(ropeK))
        .add(vec3(...DARK).mul(0.6).mul(insideK)).add(srgb(0.2, 0.26, 0.28).mul(flameK));
      s.albedo = albedo;
      s.n = normalize(mix(s.n, D.n, brassK.mul(0.8)));
      s.spec = woodK.mul(0.06).add(handleK.mul(0.3)).add(brassK.mul(mix(float(1.1), float(0.3), tarn))).add(waxK.mul(0.9)).add(flameK.mul(1.2)).add(ironK.mul(0.4)).add(ropeK.mul(0.03));
      s.gloss = woodK.mul(18.0).add(handleK.mul(24.0)).add(brassK.mul(50.0)).add(waxK.mul(70.0)).add(flameK.mul(80.0)).add(ironK.mul(20.0)).add(ropeK.mul(10.0)).add(insideK.mul(10.0));
      s.fluor = woodK.mul(0.3).add(brassK.mul(0.25)).add(waxK.mul(0.6)).add(ropeK.mul(0.35));
      // indoors: the water's light hardly reaches in (it is the lantern's), as on the cabin's walls
      s.ao = f.aux.z.mul(0.42);
      s.caustic = float(0.15);
      // the flame in the lantern's chimney: gold in the middle, orange at its ends; brass glints
      // warm round it; the chest's inside glows when it is open
      const fl = mix(vec3(1.55, 0.6, 0.1), vec3(0.95, 0.28, 0.04), smoothstep(0.08, 0.5, abs(f.aux.y.sub(0.45))));
      s.emis = fl.mul(U.flame).mul(flameK)
        .add(albedo.mul(vec3(0.9, 0.4, 0.08)).mul(is(K.lamp)).mul(U.flame.mul(0.3)))
        .add(vec3(0.95, 0.56, 0.2).mul(insideK).mul(U.inside).mul(smoothstep(0.0, 0.26, f.aux.x).mul(0.6).add(0.4)))
        .add(G.amb.mul(0.1).mul(brassCol).mul(brassK));
    },
  });
}

// ---- the hazes: the lantern's, and the open chest's ----------------------------------------------
const HZ = uniformArray([new Vector4(0, -1000, 0, 0.75), new Vector4(0, -1000, 0, 0.4)], 'vec4');
const HC = uniformArray([new Vector4(0, 0, 0, 5.5), new Vector4(0, 0, 0, 4.0)], 'vec4');
const vH = varyingProperty('vec3', 'v_cab_h');
function hazes() {
  const geo = new InstancedBufferGeometry();
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  geo.setAttribute('hid', new InstancedBufferAttribute(new Float32Array([0, 1]), 1));
  geo.instanceCount = 2;
  const mat = material({
    additive: true, shadow: false,
    vertex: (v) => {
      const id = int(attribute('hid', 'float'));
      const at = HZ.element(id);
      const toCam = normalize(cameraPosition.sub(at.xyz)).toVar();
      const right = normalize(cross(vec3(0, 1, 0), toCam)).toVar(), upv = cross(toCam, right);
      vH.assign(vec3(v.P.xy, float(id)));
      v.P.assign(at.xyz.add(right.mul(v.P.x.mul(at.w))).add(upv.mul(v.P.y.mul(at.w))).add(toCam.mul(0.05)));
    },
    raw: (f) => {
      const d = length(vH.xy), id = int(vH.z.add(0.5)), col = HC.element(id);
      return { color: col.rgb.mul(exp(d.mul(d).mul(col.w).negate())).mul(exp(SIG.mul(f.dist).negate())), alpha: float(1.0) };
    },
  });
  return { geo, mat };
}

// ---- the dust ------------------------------------------------------------------------------------
const NDUST = 90;
const vD = varyingProperty('vec4', 'v_cab_d');
function dustMesh() {
  const geo = new InstancedBufferGeometry();
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  const dp = new InstancedBufferAttribute(new Float32Array(NDUST * 4), 4), dc = new InstancedBufferAttribute(new Float32Array(NDUST * 4), 4);
  dp.setUsage(DynamicDrawUsage); dc.setUsage(DynamicDrawUsage);
  geo.setAttribute('dp', dp); geo.setAttribute('dc', dc);
  geo.instanceCount = NDUST;
  const mat = material({
    additive: true, shadow: false,
    vertex: (v) => {
      const at = attribute('dp', 'vec4'), c = attribute('dc', 'vec4');
      const toCam = cameraPosition.sub(at.xyz).toVar();
      const dist = length(toCam);
      const n = toCam.div(dist).toVar();
      const right = normalize(cross(vec3(0, 1, 0), n)).toVar(), upv = cross(n, right);
      // (never narrower than about a pixel: smaller, it is drawn that wide and dimmer)
      const size = max(at.w, dist.mul(U.pix)), k = at.w.div(size);
      vD.assign(vec4(v.P.xy, c.x.mul(k).mul(k), c.y));
      v.P.assign(at.xyz.add(right.mul(v.P.x.mul(size))).add(upv.mul(v.P.y.mul(size))));
    },
    raw: (f) => {
      const r = length(vD.xy), a = float(1).sub(smoothstep(0.0, 1.0, r));
      const col = mix(vec3(0.62, 0.74, 0.8), vec3(1.0, 0.72, 0.4), vD.w);
      return { color: col.mul(a.mul(a)).mul(vD.z).mul(exp(SIG.mul(f.dist).negate())), alpha: float(1.0) };
    },
  });
  return { geo, mat, dp, dc };
}

// ---- the whole --------------------------------------------------------------------------------------

export function buildCabin(ctx, wreck) {
  if (!wreck || !wreck.envelope || !wreck.cabinFacing) return null;
  const { add, camera } = ctx;
  const F = deskFrame(wreck), O = F.at, X = F.x.toArray(), Y = F.y.toArray(), Z = F.z.toArray();
  // a point of the desk's frame in the world
  const W = (a, b, c, out = [0, 0, 0]) => { out[0] = O.x + X[0] * a + Y[0] * b + Z[0] * c; out[1] = O.y + X[1] * a + Y[1] * b + Z[1] * c; out[2] = O.z + X[2] * a + Y[2] * b + Z[2] * c; return out; };
  const V = (a, b, c) => new Vector3(...W(a, b, c));
  // whether the cabin's loose things are this file's (sets.js no longer builds its own lantern,
  // chest, stamp and the wax on the letter): only then are they built here, so nothing is doubled
  const own = !!wreck.loose;
  const m = new Mesh(true);
  const code = (part, kind) => part * 10 + kind;
  const CH = { a: -0.05, c: 1.35 };                 // the chest's middle (it stands on the deck)
  const ST = { a: -0.15, b: 0.865, c: 0.075 };      // the stamp's foot on the desk's top
  const DW = { a: -0.27, b: 0.867, c: 0.175 };      // where the stamp presses its wax
  const LID = { r: 0.305, h: 0.27, b0: 0.4, half: 0.405 };

  if (own) {
    // ---- the chest's box: planks stacked up its sides, brass straps and corners, a lock plate
    const cb = code(PART.chest, K.wood);
    rbox(m, W(CH.a, 0.2, CH.c), X, Y, Z, [0.3, 0.2, 0.4], 0.03, (lx, ly, lz, o) => { o[0] = ly + 0.2; o[1] = lz + Math.abs(lx); o[2] = ly < -0.17 ? 0.7 : 1; o[3] = cb; });
    // (the inside: the light of what is in it, seen when the lid is up)
    {
      const v0 = m.count, ci = code(PART.chest, K.inside);
      for (const [a, c] of [[-0.26, -0.36], [0.26, -0.36], [0.26, 0.36], [-0.26, 0.36]]) {
        const p = W(CH.a + a, 0.401, CH.c + c);
        m.vert(p[0], p[1], p[2], Y[0], Y[1], Y[2], 0, 0, 0.26 - Math.abs(a), 0, 1, ci);
      }
      m.vert(...W(CH.a, 0.401, CH.c), Y[0], Y[1], Y[2], 0, 0, 0.5, 0, 1, ci);
      for (let k = 0; k < 4; k++) triFacing(m, v0 + k, v0 + ((k + 1) % 4), v0 + 4, Y[0], Y[1], Y[2]);
    }
    const strap = (k, j, ang) => 1 / Math.max(Math.abs(Math.cos(ang)) / 0.007, Math.abs(Math.sin(ang)) / 0.03);
    const cbr = code(PART.chest, K.brass);
    for (const sz of [-0.26, 0.26]) for (const sa of [-1, 1]) sweep(m, [[...W(CH.a + sa * 0.303, 0.015, CH.c + sz), 1], [...W(CH.a + sa * 0.303, 0.4, CH.c + sz), 1]], 8, { up: Z, radius: strap, code: cbr });
    for (const sa of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0.035, 0.365]) rbox(m, W(CH.a + sa * 0.287, y, CH.c + sz * 0.387), X, Y, Z, [0.024, 0.04, 0.024], 0.012, (lx, ly, lz, o) => { o[3] = cbr; });
    rbox(m, W(CH.a - 0.306, 0.29, CH.c), X, Y, Z, [0.008, 0.05, 0.055], 0.006, (lx, ly, lz, o) => { o[3] = cbr; });
    rbox(m, W(CH.a - 0.316, 0.272, CH.c), X, Y, Z, [0.004, 0.014, 0.006], 0.003, (lx, ly, lz, o) => { o[3] = code(PART.chest, K.iron); });

    // ---- the lid, shut (it turns on its hinge along the back edge): a barrel of planks, its ends,
    // its underside, the straps over it and the hasp that hangs over the lock plate
    {
      const lc = code(PART.lid, K.wood), segs = 18, rows = 6, v0 = m.count;
      for (let r = 0; r <= rows; r++) for (let s = 0; s <= segs; s++) {
        const th = Math.PI * (1 - s / segs), ca = Math.cos(th), sa = Math.sin(th), cz = -LID.half + (2 * LID.half * r) / rows;
        const p = W(CH.a + LID.r * ca, LID.b0 + LID.h * sa, CH.c + cz);
        const nx = ca / LID.r, ny = sa / LID.h, nl = Math.hypot(nx, ny);
        const n = [(X[0] * nx + Y[0] * ny) / nl, (X[1] * nx + Y[1] * ny) / nl, (X[2] * nx + Y[2] * ny) / nl];
        m.vert(p[0], p[1], p[2], n[0], n[1], n[2], 0, 0, th * 0.29, cz, 1, lc);
      }
      const w = segs + 1;
      for (let r = 0; r < rows; r++) for (let s = 0; s < segs; s++) {
        const a = v0 + r * w + s, th = Math.PI * (1 - (s + 0.5) / segs), out = [Math.cos(th) * X[0] + Math.sin(th) * Y[0], Math.cos(th) * X[1] + Math.sin(th) * Y[1], Math.cos(th) * X[2] + Math.sin(th) * Y[2]];
        triFacing(m, a, a + w, a + 1, ...out); triFacing(m, a + 1, a + w, a + w + 1, ...out);
      }
      // its two ends
      for (const e of [-1, 1]) {
        const c0 = m.count, cp = W(CH.a, LID.b0, CH.c + e * LID.half), en = [Z[0] * e, Z[1] * e, Z[2] * e];
        m.vert(cp[0], cp[1], cp[2], en[0], en[1], en[2], 0, 0, 0.15, 0, 1, lc);
        for (let s = 0; s <= segs; s++) { const th = Math.PI * (1 - s / segs), p = W(CH.a + LID.r * Math.cos(th), LID.b0 + LID.h * Math.sin(th), CH.c + e * LID.half); m.vert(p[0], p[1], p[2], en[0], en[1], en[2], 0, 0, Math.sin(th) * 0.27, Math.cos(th) * 0.3, 1, lc); }
        for (let s = 0; s < segs; s++) triFacing(m, c0, c0 + 1 + s, c0 + 2 + s, ...en);
      }
      // its underside (dark: the inside of the lid)
      const u0 = m.count, uc = code(PART.lid, K.dark), dn = [-Y[0], -Y[1], -Y[2]];
      for (const [a, c] of [[-LID.r, -LID.half], [LID.r, -LID.half], [LID.r, LID.half], [-LID.r, LID.half]]) { const p = W(CH.a + a, LID.b0 + 0.002, CH.c + c); m.vert(p[0], p[1], p[2], dn[0], dn[1], dn[2], 0, 0, c, a, 0.8, uc); }
      triFacing(m, u0, u0 + 1, u0 + 2, ...dn); triFacing(m, u0, u0 + 2, u0 + 3, ...dn);
      // the straps over it, and the hasp
      const lb = code(PART.lid, K.brass);
      for (const sz of [-0.26, 0.26]) {
        const pts = [];
        for (let i = 0; i <= 16; i++) { const th = (Math.PI * i) / 16; pts.push([...W(CH.a + (LID.r + 0.005) * Math.cos(th), LID.b0 + (LID.h + 0.005) * Math.sin(th), CH.c + sz), 1]); }
        sweep(m, pts, 8, { up: Z, radius: strap, code: lb });
      }
      rbox(m, W(CH.a - 0.321, 0.365, CH.c), X, Y, Z, [0.006, 0.05, 0.03], 0.005, (lx, ly, lz, o) => { o[3] = lb; });
    }

    // ---- the desk's wax seal: a wooden stamp on a brass foot
    {
      const sb = code(PART.stamp, K.brass), sw = code(PART.stamp, K.handle);
      const P = (h) => W(ST.a, ST.b + h, ST.c);
      sweep(m, [[...P(0.004), 0.05], [...P(0.025), 0.053], [...P(0.05), 0.045]], 12, { caps: true, code: sb });
      sweep(m, [[...P(0.05), 0.022], [...P(0.125), 0.02], [...P(0.185), 0.031], [...P(0.23), 0.041], [...P(0.265), 0.034]], 12, { caps: true, code: sw, along: [0.05, 0.125, 0.185, 0.23, 0.265], plain: true });
    }

    // ---- the lantern, at rest: a brass foot and cap, its cage, the glass chimney with the flame,
    // the ring at its top, and the short rope up to its hook under the deck
    {
      const L = wreck.lantern, lc = code(PART.lantern, K.lamp);
      const L0 = (x, y, z) => [L.x + X[0] * x + Y[0] * y + Z[0] * z, L.y + X[1] * x + Y[1] * y + Z[1] * z, L.z + X[2] * x + Y[2] * y + Z[2] * z];
      const S = (pts, sides, kc = lc) => sweep(m, pts.map(([x, y, z, rr]) => [...L0(x, y, z), rr]), sides, { caps: true, code: kc });
      S([[0, -0.21, 0, 0.11], [0, -0.18, 0, 0.13], [0, -0.14, 0, 0.1]], 12);
      S([[0, 0.17, 0, 0.1], [0, 0.22, 0, 0.12], [0, 0.29, 0, 0.06], [0, 0.34, 0, 0.03]], 12);
      for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + 0.4; S([[Math.cos(a) * 0.105, -0.15, Math.sin(a) * 0.105, 0.012], [Math.cos(a) * 0.09, 0.18, Math.sin(a) * 0.09, 0.012]], 5); }
      const ring = [];
      for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU; ring.push([...L0(Math.cos(a) * 0.06, 0.41 + Math.sin(a) * 0.06, 0), 0.013]); }
      sweep(m, ring, 6, { closed: true, up: Z, code: lc });
      sweep(m, [[...L0(0, 0.465, 0), 0.013], [...L0(0, 0.6, 0), 0.013]], 6, { caps: true, code: code(PART.lantern, K.rope) });
      sweep(m, [[...L0(0, -0.14, 0), 0.06], [...L0(0, -0.02, 0), 0.09], [...L0(0, 0.1, 0), 0.08], [...L0(0, 0.17, 0), 0.05]], 14, { caps: true, code: code(PART.lantern, K.flame), along: [0, 0.33, 0.67, 1] });
    }
  }
  // ---- the red wax: on the octopus's letter (pressed by Snap), and by the stamp (pressed by it)
  const env = wreck.envelope;
  const letterAt = [env.x + Y[0] * 0.01, env.y + Y[1] * 0.01, env.z + Y[2] * 0.01];
  waxSeal(m, letterAt, X, Y, Z, 0.058, 0.016, 1.7, code(PART.letterWax, K.wax));
  if (own) waxSeal(m, W(DW.a, DW.b, DW.c), X, Y, Z, 0.05, 0.014, 4.1, code(PART.deskWax, K.wax));

  const PARTS = uniformArray(ROWS, 'vec4');
  const geo = m.build();
  geo.boundingSphere = new Sphere(V(0.2, 1.1, 0.4), 2.6);
  const mesh = new ThreeMesh(geo, propsMaterial(PARTS));
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  add(mesh, 55);

  const hz = hazes(), haze = new ThreeMesh(hz.geo, hz.mat);
  hz.geo.boundingSphere = new Sphere(V(0.2, 1.1, 0.4), 3);
  haze.matrixAutoUpdate = false; haze.userData.castShadow = false;
  add(haze, 55);
  const ds = dustMesh(), dust = new ThreeMesh(ds.geo, ds.mat);
  ds.geo.boundingSphere = new Sphere(V(-0.5, 1.2, 0.1), 4.5);
  dust.matrixAutoUpdate = false; dust.userData.castShadow = false;
  add(dust, 30);

  // ---- moving the parts -------------------------------------------------------------------------
  // (M, M2 hold results; T1, T2, SQ are the helpers' own)
  const M = new Matrix4(), M2 = new Matrix4(), T1 = new Matrix4(), T2 = new Matrix4(), SQ = new Matrix4(), Q = new Quaternion(), P0 = new Vector3();
  const rows = PARTS.array;
  const put = (part, mat) => {
    const e = mat.elements, k = part * 3;
    rows[k].set(e[0], e[4], e[8], e[12]); rows[k + 1].set(e[1], e[5], e[9], e[13]); rows[k + 2].set(e[2], e[6], e[10], e[14]);
  };
  // a turn by `ang` about `axis` through `pivot`, then a move by `off` (Vector3s), into out
  const turnAbout = (out, pivot, axis, ang, off = null) => {
    Q.setFromAxisAngle(axis, ang);
    T1.makeTranslation(-pivot.x, -pivot.y, -pivot.z);
    T2.makeRotationFromQuaternion(Q).multiply(T1);
    return out.makeTranslation(pivot.x + (off ? off.x : 0), pivot.y + (off ? off.y : 0), pivot.z + (off ? off.z : 0)).multiply(T2);
  };
  // a squash about `pivot` in the desk's frame: k across (its x and z), j up (its y)
  const BASIS = new Matrix4().makeBasis(F.x, F.y, F.z), BASIS_T = BASIS.clone().transpose();
  const squashAbout = (out, pivot, k, j) => {
    T1.makeTranslation(-pivot.x, -pivot.y, -pivot.z);
    T2.copy(BASIS).multiply(SQ.makeScale(k, j, k)).multiply(BASIS_T).multiply(T1);
    return out.makeTranslation(pivot.x, pivot.y, pivot.z).multiply(T2);
  };
  const scaleAbout = (out, pivot, s) => out.makeTranslation(pivot.x * (1 - s), pivot.y * (1 - s), pivot.z * (1 - s)).multiply(T1.makeScale(s, s, s));

  const at = {
    chest: V(CH.a, 0.3, CH.c), chestFoot: V(CH.a, 0, CH.c), hinge: V(CH.a + LID.r, LID.b0, CH.c),
    lidTip: V(CH.a - 0.3, 0.5, CH.c), lock: V(CH.a - 0.31, 0.3, CH.c), inside: V(CH.a, 0.5, CH.c),
    // (until sets.js leaves the stamp to this file, its own stands further along the desk)
    stamp: own ? V(ST.a, ST.b + 0.17, ST.c) : V(-0.15, ST.b + 0.17, 0.32), stampFoot: V(ST.a, ST.b, ST.c), deskWax: V(DW.a, DW.b + 0.01, DW.c),
    letter: new Vector3(...letterAt), lantern: wreck.lantern.clone(), hook: wreck.lantern.clone().addScaledVector(F.y, 0.6),
    // corners of what the chest takes on the screen (shut, and open)
    box: [V(CH.a - 0.31, 0, CH.c - 0.41), V(CH.a - 0.31, 0, CH.c + 0.41), V(CH.a + 0.31, 0, CH.c - 0.41), V(CH.a + 0.31, 0, CH.c + 0.41),
      V(CH.a - 0.31, 0.68, CH.c - 0.41), V(CH.a - 0.31, 0.68, CH.c + 0.41), V(CH.a + 0.31, 0.68, CH.c - 0.41), V(CH.a + 0.31, 0.68, CH.c + 0.41),
      V(CH.a + 0.42, 1.0, CH.c), V(CH.a + 0.1, 1.05, CH.c)],
  };
  const lidAxis = F.z.clone(), stampTilt = F.z.clone(), lightAt = new Vector3().copy(wreck.lantern);
  const cabin = {
    mesh, haze, dust, frame: F, at, own, light: lightAt,
    // the lid: open 1 (up, 112 degrees) to 0 (shut); the box squashed by `squash` (the thunk)
    setLid(open, squash = 0) {
      const k = 1 + 0.02 * squash, j = 1 - 0.03 * squash;
      squashAbout(M, at.chestFoot, k, j);
      put(PART.chest, M);
      // (the lid turns on its hinge, and the box's squash carries it)
      turnAbout(M2, at.hinge, lidAxis, -open * (112 * Math.PI) / 180);
      put(PART.lid, M.multiply(M2));
      HC.array[1].set(0.75 * open, 0.42 * open, 0.13 * open, 4.5);
      HZ.array[1].set(at.inside.x, at.inside.y, at.inside.z, 0.42);
      U.inside.value = open;
    },
    // the stamp: `lift` up from the desk and `press` of the way over to the wax and down onto it
    setStamp(press, lift) {
      // over to the wax: along the desk toward it, tipped a little that way as it goes
      P0.set(0, 0, 0).addScaledVector(F.x, (DW.a - ST.a) * press).addScaledVector(F.z, (DW.c - ST.c) * press).addScaledVector(F.y, lift);
      stampTilt.copy(F.x).multiplyScalar(DW.c - ST.c).addScaledVector(F.z, -(DW.a - ST.a)).normalize();
      put(PART.stamp, turnAbout(M, at.stampFoot, stampTilt, Math.sin(press * Math.PI) * 0.25, P0));
    },
    // the red wax: how much of each is there (0 none, 1 pressed; more than 1 while pressing on)
    setWax(letterK, deskK) {
      put(PART.letterWax, scaleAbout(M, at.letter, Math.max(letterK, 1e-4)));
      put(PART.deskWax, scaleAbout(M, at.deskWax, Math.max(deskK, 1e-4)));
    },
    // the lantern's swing about its hook (radians, about a level axis) and where its light is
    setLantern(angle, axis, flicker) {
      put(PART.lantern, turnAbout(M, at.hook, axis, angle));
      lightAt.copy(at.lantern).applyMatrix4(M);
      U.flame.value = flicker;
      HZ.array[0].set(lightAt.x, lightAt.y, lightAt.z, 0.75);
      HC.array[0].set(1.0 * 0.45 * flicker, 0.48 * 0.45 * flicker, 0.12 * 0.45 * flicker, 5.5);
      return lightAt;
    },
    show(on) {
      mesh.visible = mesh.visible && on;
      haze.visible = haze.visible && on && own;
    },
  };
  cabin.setLid(1, 0);
  cabin.setStamp(0, 0);
  cabin.setWax(0, 0);
  if (own) cabin.setLantern(0, F.z, 1);
  else { HZ.array[0].set(0, -1000, 0, 0.01); HZ.array[1].set(0, -1000, 0, 0.01); }

  // ---- the dust: specks in the cabin's air, in the desk's frame ([a, b, c], a velocity, a layer)
  const BOX = { a: [-2.3, 1.3], b: [0.15, 2.3], c: [-2.1, 2.3] };
  const sp = new Float32Array(NDUST * 3), sv = new Float32Array(NDUST * 3), sl = new Float32Array(NDUST * 2);
  let seed = 9123;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < NDUST; i++) {
    sp[i * 3] = BOX.a[0] + rnd() * (BOX.a[1] - BOX.a[0]); sp[i * 3 + 1] = BOX.b[0] + rnd() * (BOX.b[1] - BOX.b[0]); sp[i * 3 + 2] = BOX.c[0] + rnd() * (BOX.c[1] - BOX.c[0]);
    sl[i * 2] = rnd(); sl[i * 2 + 1] = rnd() * TAU;
  }
  const pos = ds.dp.array, col = ds.dc.array, PW = [0, 0, 0], v = new Vector3();
  // each frame while the cabin is seen: vis (0..1), the hand on the screen (px) or null, the
  // window's size, where the lantern's light is
  cabin.dustStep = (dt, t, vis, hx, hy, live, Wpx, Hpx) => {
    dust.visible = dust.visible && vis > 0.01;
    if (!dust.visible) return;
    U.pix.value = (1.2 * 2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(Hpx, 1);
    const e = camera.matrixWorld.elements, rx = e[0], ry = e[1], rz = e[2], ux = e[4], uy = e[5], uz = e[6];
    const R = 0.2 * Hpx, th = Math.tan((camera.fov * Math.PI) / 360);
    for (let i = 0; i < NDUST; i++) {
      const z = sl[i * 2], ph = sl[i * 2 + 1];
      let a = sp[i * 3], b = sp[i * 3 + 1], c = sp[i * 3 + 2];
      W(a, b, c, PW);
      // a slow rise with a lazy wander, faster for the near ones (in the desk's frame)
      const rise = 0.012 + 0.03 * z, wa = Math.sin(t * 0.37 + ph) * 0.012, wc = Math.cos(t * 0.29 + ph * 1.7) * 0.01;
      let ax = (wa - sv[i * 3]) * 1.6, ay = (rise - sv[i * 3 + 1]) * 1.6, az = (wc - sv[i * 3 + 2]) * 1.6;
      // the hand: within R of it on the screen, pushed away and swirled round
      v.set(PW[0], PW[1], PW[2]).applyMatrix4(camera.matrixWorldInverse);
      const depth = -v.z;
      let near = 1;
      if (depth > 0.05) {
        near = sstep(0.35, 0.9, depth);
        if (live) {
          v.applyMatrix4(camera.projectionMatrix);
          const sx = (v.x * 0.5 + 0.5) * Wpx, sy = (0.5 - v.y * 0.5) * Hpx, dx = sx - hx, dy = sy - hy, r = Math.hypot(dx, dy);
          if (r < R && r > 1) {
            const f = (1 - r / R) * 160, fx = (dx / r) * f - (dy / r) * f * 0.6, fy = (dy / r) * f + (dx / r) * f * 0.6;
            // (pixels a second, squared, at its depth: into metres along the view's right and up)
            const mpp = (2 * depth * th) / Hpx, kx = fx * mpp, ky = -fy * mpp;
            const wx = rx * kx + ux * ky, wy = ry * kx + uy * ky, wz = rz * kx + uz * ky;
            ax += wx * X[0] + wy * X[1] + wz * X[2]; ay += wx * Y[0] + wy * Y[1] + wz * Y[2]; az += wx * Z[0] + wy * Z[1] + wz * Z[2];
          }
        }
      }
      sv[i * 3] += ax * dt; sv[i * 3 + 1] += ay * dt; sv[i * 3 + 2] += az * dt;
      a += sv[i * 3] * dt * (0.6 + z); b += sv[i * 3 + 1] * dt * (0.6 + z); c += sv[i * 3 + 2] * dt * (0.6 + z);
      // round the edges: up out of the top, in again from the floor
      if (b > BOX.b[1]) { b = BOX.b[0]; a = BOX.a[0] + rnd() * (BOX.a[1] - BOX.a[0]); c = BOX.c[0] + rnd() * (BOX.c[1] - BOX.c[0]); }
      if (a < BOX.a[0]) a = BOX.a[1]; else if (a > BOX.a[1]) a = BOX.a[0];
      if (c < BOX.c[0]) c = BOX.c[1]; else if (c > BOX.c[1]) c = BOX.c[0];
      sp[i * 3] = a; sp[i * 3 + 1] = b; sp[i * 3 + 2] = c;
      W(a, b, c, PW);
      // warmer and brighter in the lantern's light
      const lx = PW[0] - lightAt.x, ly = PW[1] - lightAt.y, lz = PW[2] - lightAt.z;
      const lit = Math.exp(-(lx * lx + ly * ly + lz * lz) / 0.9);
      const tw = 0.5 + 0.5 * Math.sin(t * (1.1 + z) + ph * 3);
      pos[i * 4] = PW[0]; pos[i * 4 + 1] = PW[1]; pos[i * 4 + 2] = PW[2]; pos[i * 4 + 3] = 0.003 + 0.007 * z * z;
      col[i * 4] = vis * near * (0.12 + 0.22 * tw * (1 - z * 0.5) + 0.75 * lit) * 0.9; col[i * 4 + 1] = Math.min(1, lit * 1.6);
    }
    ds.dp.needsUpdate = true; ds.dc.needsUpdate = true;
  };
  return cabin;
}
