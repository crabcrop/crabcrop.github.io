// Rock that a height map cannot make: pinnacles among the kelp, coral heads with
// overhangs, the arch on the reef, the spire beside the long way down, the chimneys of the
// vents. Each is described as a distance (how far a point is from the rock, negative
// inside), sampled on a grid, and turned into a mesh by surface nets: one vertex in every
// grid cell the surface passes through, joined across every grid edge it cuts. The ground
// is blended into each one, so a formation flares into the sea floor and has no seam.
// And loose boulders, scattered along the valley. All of it is built once, at load.
import { Mesh as ThreeMesh, Quaternion, Vector3 } from 'three/webgpu';
import { centerX, floorY, groundY, halfWidth, offTrack } from './layout.js';
import { Mesh, TAU, blob, clamp, fbm3, lerp, makeRng, noise3, smooth } from './math.js';
import { rockyAt } from './terrain.js';
import { instanced, place } from './world.js';

// ---- distances -------------------------------------------------------------------------

export const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
// A rounded cone from a to b, with a radius at each end.
export function cone(x, y, z, ax, ay, az, bx, by, bz, ra, rb) {
  const px = x - ax, py = y - ay, pz = z - az, dx = bx - ax, dy = by - ay, dz = bz - az;
  const t = clamp((px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz), 0, 1);
  return Math.hypot(px - dx * t, py - dy * t, pz - dz * t) - (ra + (rb - ra) * t);
}
export function ball(x, y, z, cx, cy, cz, rx, ry, rz) {
  const k = Math.hypot((x - cx) / rx, (y - cy) / ry, (z - cz) / rz);
  return (k - 1) * Math.min(rx, ry, rz);
}
// Weather a smooth shape into rock: beds laid level, and lumps. Only near the surface,
// where it can matter.
function weather(d, x, y, z, amp, seed) {
  if (d > amp * 2.4 + 1 || d < -amp * 2.4 - 1) return d;
  const b = y * 0.42 + 0.35 * noise3(x * 0.13, y * 0.1, z * 0.13) + seed;
  const beds = Math.abs(b - Math.floor(b) - 0.5) * 2;
  return d - amp * (fbm3(x * 0.17 + seed, y * 0.34, z * 0.17, 3) * 1.7 + (beds - 0.5) * 0.6);
}

// ---- surface nets ----------------------------------------------------------------------

const CORNER = new Int32Array(8);
const EDGES = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];
function nets(field, x0, y0, z0, nx, ny, nz, h) {
  const v = new Float32Array(nx * ny * nz);
  for (let k = 0, n = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++, n++) v[n] = field(x0 + i * h, y0 + j * h, z0 + k * h, i, k);
  const id = new Int32Array(nx * ny * nz).fill(-1);
  const m = new Mesh(true);
  const sy = nx, sz = nx * ny;
  for (let e = 0; e < 8; e++) CORNER[e] = (e & 1) + ((e >> 1) & 1) * sy + (e >> 2) * sz;
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const c = i + j * sy + k * sz;
    let neg = 0;
    for (let e = 0; e < 8; e++) if (v[c + CORNER[e]] < 0) neg++;
    if (neg === 0 || neg === 8) continue;
    let px = 0, py = 0, pz = 0, cnt = 0;
    for (let e = 0; e < 24; e += 2) {
      const a = EDGES[e], b = EDGES[e + 1], fa = v[c + CORNER[a]], fb = v[c + CORNER[b]];
      if ((fa < 0) === (fb < 0)) continue;
      const t = fa / (fa - fb), ax = a & 1, ay = (a >> 1) & 1, az = a >> 2;
      px += ax + ((b & 1) - ax) * t; py += ay + (((b >> 1) & 1) - ay) * t; pz += az + ((b >> 2) - az) * t;
      cnt++;
    }
    // which way is out: the slope of the distance across the cell
    const gx = v[c + 1] + v[c + sy + 1] + v[c + sz + 1] + v[c + sz + sy + 1] - v[c] - v[c + sy] - v[c + sz] - v[c + sz + sy];
    const gy = v[c + sy] + v[c + sy + 1] + v[c + sz + sy] + v[c + sz + sy + 1] - v[c] - v[c + 1] - v[c + sz] - v[c + sz + 1];
    const gz = v[c + sz] + v[c + sz + 1] + v[c + sz + sy] + v[c + sz + sy + 1] - v[c] - v[c + 1] - v[c + sy] - v[c + sy + 1];
    const gl = Math.hypot(gx, gy, gz) || 1;
    id[c] = m.vert(x0 + (i + px / cnt) * h, y0 + (j + py / cnt) * h, z0 + (k + pz / cnt) * h, gx / gl, gy / gl, gz / gl);
  }
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) m.i.push(a, d, c, a, c, b); else m.i.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const c = i + j * sy + k * sz, inside = v[c] < 0;
    if (i < nx - 1 && j > 0 && k > 0 && inside !== (v[c + 1] < 0)) quad(id[c - sy - sz], id[c - sz], id[c], id[c - sy], !inside);
    if (j < ny - 1 && i > 0 && k > 0 && inside !== (v[c + sy] < 0)) quad(id[c - 1 - sz], id[c - 1], id[c], id[c - sz], !inside);
    if (k < nz - 1 && i > 0 && j > 0 && inside !== (v[c + sz] < 0)) quad(id[c - 1 - sy], id[c - sy], id[c], id[c - 1], !inside);
  }
  return m;
}

// Build one formation. `rock(x, y, z)` is its distance; `box` is [x0, x1, yTop, z0, z1]
// (it reaches down to the ground by itself); h is the size of a grid cell. Returns the
// geometry: aux.x is how rocky (the ground's own share where it has flared into ground),
// aux.y how open to the light.
const BLEND = 1.5;
export const perches = [];      // places on the formations where something can grow: x, y, z, and the way the rock faces
export function carve(rock, box, h) {
  const [x0, x1, yTop, z0, z1] = box;
  const nx = Math.ceil((x1 - x0) / h) + 1, nz = Math.ceil((z1 - z0) / h) + 1;
  const gy = new Float32Array(nx * nz);
  let low = 1e9;
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) { const g = groundY(x0 + i * h, z0 + k * h); gy[i + k * nx] = g; if (g < low) low = g; }
  const y0 = low - 2 * h, ny = Math.ceil((yTop - y0) / h) + 2;
  const m = nets((x, y, z, i, k) => {
    const g = y - gy[i + k * nx];
    if (g < -BLEND - h) return g;          // well under ground: no need to ask the rock
    return smin(rock(x, y, z), g, BLEND);
  }, x0, y0, z0, nx, ny, nz, h);
  // what each vertex is, and drop what is only ground
  const { p, n, a, i: idx } = m;
  const buried = new Uint8Array(m.count);
  for (let v = 0; v < m.count; v++) {
    const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
    const r = rock(x, y, z);
    if (r > BLEND * 1.02) { buried[v] = 1; p[v * 3 + 1] -= 0.6; }
    const w = 1 - smooth(0.15, BLEND, r);
    const qx = x + n[v * 3] * 1.3, qy = y + n[v * 3 + 1] * 1.3, qz = z + n[v * 3 + 2] * 1.3;
    const open = clamp(0.3 + 0.7 * Math.min(rock(qx, qy, qz), qy - groundY(qx, qz)) / 1.3, 0.25, 1);
    if (w > 0.9 && n[v * 3 + 1] > 0.45 && (v & 1)) perches.push(x, y, z, n[v * 3], n[v * 3 + 1], n[v * 3 + 2]);
    a[v * 4] = lerp(rockyAt(x, z), 1, w);
    a[v * 4 + 1] = open * clamp(0.62 + (y - floorY(z)) * 0.06, 0.4, 1);
  }
  const keep = [];
  for (let t = 0; t < idx.length; t += 6) {
    let all = 1;
    for (let e = 0; e < 6; e++) if (!buried[idx[t + e]]) { all = 0; break; }
    if (!all) for (let e = 0; e < 6; e++) keep.push(idx[t + e]);
  }
  m.i = keep;
  return m.build();
}

// ---- the formations --------------------------------------------------------------------

// A pinnacle: a leaning, fluted tooth of rock with lumps up its sides.
function pinnacle(z, off, height, radius, seed) {
  const rng = makeRng(seed);
  const x = centerX(z) + off, g = groundY(x, z);
  const lx = rng.range(-0.22, 0.22) * height, lz = rng.range(-0.22, 0.22) * height;
  const flutes = 3 + Math.floor(rng() * 3), fa = rng() * TAU, lumps = [];
  for (let i = 0; i < 4; i++) {
    const t = rng.range(0.12, 0.88), a = rng() * TAU, rr = radius * (1 - 0.62 * t);
    lumps.push([x + lx * t + Math.cos(a) * rr * 0.85, g + height * t, z + lz * t + Math.sin(a) * rr * 0.85, rr * rng.range(0.5, 0.85), rr * rng.range(0.6, 1.2)]);
  }
  const rock = (px, py, pz) => {
    const t = clamp((py - g) / height, 0, 1);
    const qx = px - 0.5 * radius * t * noise3(py * 0.22, seed, 0.3), qz = pz - 0.5 * radius * t * noise3(py * 0.22, seed, 5.3);
    let d = cone(qx, py, qz, x, g - 2, z, x + lx, g + height, z + lz, radius, radius * 0.2);
    for (const l of lumps) d = smin(d, ball(qx, py, qz, l[0], l[1], l[2], l[3], l[4], l[3]), 0.7);
    d += 0.2 * radius * (0.5 + 0.5 * Math.sin(Math.atan2(qz - z - lz * t, qx - x - lx * t) * flutes + fa + py * 0.35));
    return weather(d, px, py, pz, 0.62, seed * 0.37);
  };
  const r = radius * 1.7 + Math.hypot(lx, lz) + 2.5;
  return [rock, [x - r, x + r, g + height + 2, z - r, z + r]];
}
// A coral head: a stem with a wide lumpy cap, so there is shade under its rim.
function bommie(z, off, height, radius, seed) {
  const rng = makeRng(seed);
  const x = centerX(z) + off, g = groundY(x, z), lobes = [];
  for (let i = 0; i < 5; i++) { const a = rng() * TAU, rr = radius * rng.range(0.3, 0.9); lobes.push([x + Math.cos(a) * rr, g + height * rng.range(0.78, 1.0), z + Math.sin(a) * rr, radius * rng.range(0.42, 0.7), height * rng.range(0.16, 0.3)]); }
  const rock = (px, py, pz) => {
    let d = cone(px, py, pz, x, g - 1.5, z, x + 0.4, g + height * 0.7, z - 0.3, radius * 0.78, radius * 0.5);
    for (const l of lobes) d = smin(d, ball(px, py, pz, l[0], l[1], l[2], l[3], l[4], l[3]), 0.6);
    return weather(d, px, py, pz, 0.5, seed * 0.53);
  };
  const r = radius * 1.7 + 2.5;
  return [rock, [x - r, x + r, g + height * 1.3 + 2, z - r, z + r]];
}
// An arch from one foot to the other.
function arch(z, offA, offB, height, thick, seed) {
  const xa = centerX(z) + offA, xb = centerX(z) + offB, za = z + 1.5, zb = z - 1.5;
  const ga = groundY(xa, za), gb = groundY(xb, zb);
  const N = 9, pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, lift = Math.sin(t * Math.PI);
    pts.push([lerp(xa, xb, t), lerp(ga, gb, t) - 2 + (height + 2) * Math.pow(lift, 0.6), lerp(za, zb, t) + Math.sin(t * TAU) * 1.2, thick * (1.25 - 0.45 * lift)]);
  }
  const rock = (px, py, pz) => {
    let d = 1e9;
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[i + 1];
      d = smin(d, cone(px, py, pz, a[0], a[1], a[2], b[0], b[1], b[2], a[3], b[3]), 0.6);
    }
    return weather(d, px, py, pz, 0.42, seed * 0.29);
  };
  const lo = Math.min(xa, xb) - thick * 2 - 2, hi = Math.max(xa, xb) + thick * 2 + 2;
  return [rock, [lo, hi, Math.max(ga, gb) + height + thick + 2, z - thick * 2 - 4.5, z + thick * 2 + 4.5]];
}
// A low outcrop: a few lumps run together.
function outcrop(z, off, length, height, seed) {
  const rng = makeRng(seed);
  const x = centerX(z) + off, g = groundY(x, z), ang = rng() * TAU;
  const lumps = [];
  for (let i = 0; i < 4; i++) {
    const t = (i / 3 - 0.5) * length, w = rng.range(0.9, 1.5);
    lumps.push([x + Math.cos(ang) * t + rng.range(-0.8, 0.8), 0, z + Math.sin(ang) * t + rng.range(-0.8, 0.8), length * 0.2 * w, height * rng.range(0.7, 1.15), length * 0.17 * w]);
  }
  for (const l of lumps) l[1] = groundY(l[0], l[2]) + l[4] * 0.2;
  const rock = (px, py, pz) => {
    let d = 1e9;
    for (const l of lumps) d = smin(d, ball(px, py, pz, l[0], l[1], l[2], l[3], l[4], l[5]), 1.0);
    return weather(d, px, py, pz, 0.36, seed * 0.41);
  };
  const r = length * 0.75 + 3;
  return [rock, [x - r, x + r, g + height * 1.6 + 2, z - r, z + r]];
}
// The spire: a column that stands off the cliff from the plain to above the ledge, fluted
// and stepped, the only thing beside the long way down.
function spire(x, z, yBottom, yTop, radius, seed) {
  const rock = (px, py, pz) => {
    const t = clamp((py - yBottom) / (yTop - yBottom), 0, 1);
    const wob = 2.2 * noise3(py * 0.03, seed, 1.7), wob2 = 2.2 * noise3(py * 0.03, seed, 9.2);
    const dx = px - x - wob, dz = pz - z - wob2;
    const ang = Math.atan2(dz, dx);
    const r = radius * (1.25 - 0.75 * Math.pow(t, 1.4)) * (1 + 0.16 * Math.sin(ang * 5 + py * 0.05) + 0.1 * Math.sin(ang * 9 - py * 0.11));
    let d = Math.hypot(dx, dz) - r;
    d = Math.max(d, py - yTop);                 // a flat, broken top
    // ledges every so often
    const s = py * 0.085 + 0.4 * noise3(px * 0.05, py * 0.02, pz * 0.05);
    d -= 0.9 * smooth(0.78, 0.98, Math.abs(s - Math.floor(s) - 0.5) * 2);
    return weather(d, px, py, pz, 0.8, seed * 0.19);
  };
  const r = radius * 1.7 + 4;
  return [rock, [x - r, x + r, yTop + 1.5, z - r, z + r]];
}
// A vent chimney: a knobbled stack that narrows to its mouth.
function chimney(z, off, height, radius, seed) {
  const rng = makeRng(seed);
  const x = centerX(z) + off, g = groundY(x, z);
  const knobs = [];
  for (let i = 0; i < 7; i++) { const t = rng.range(0.1, 0.95), a = rng() * TAU, rr = radius * (1.05 - 0.6 * t); knobs.push([x + Math.cos(a) * rr * 0.7, g + height * t, z + Math.sin(a) * rr * 0.7, rr * rng.range(0.45, 0.75)]); }
  const lean = rng.range(-0.6, 0.6);
  const rock = (px, py, pz) => {
    let d = cone(px, py, pz, x, g - 1.5, z, x + lean, g + height, z - lean * 0.5, radius * 1.15, radius * 0.34);
    for (const k of knobs) d = smin(d, Math.hypot(px - k[0], py - k[1], pz - k[2]) - k[3], 0.45);
    return weather(d, px, py, pz, 0.22, seed * 0.61);
  };
  const r = radius * 1.6 + 2.5;
  return [rock, [x - r, x + r, g + height + 1.5, z - r, z + r]];
}
// Pillow lava: a heap of rounded lobes.
function pillows(z, off, length, seed) {
  const rng = makeRng(seed);
  const x = centerX(z) + off, lobes = [];
  for (let i = 0; i < 12; i++) {
    const lx = x + rng.range(-0.5, 0.5) * length * 0.55, lz = z + rng.range(-0.5, 0.5) * length, r = rng.range(0.9, 1.9);
    lobes.push([lx, groundY(lx, lz) + r * rng.range(0.2, 1.3), lz, r * rng.range(1, 1.5), r * 0.8, r * rng.range(1, 1.5)]);
  }
  const rock = (px, py, pz) => {
    let d = 1e9;
    for (const l of lobes) d = smin(d, ball(px, py, pz, l[0], l[1], l[2], l[3], l[4], l[5]), 0.35);
    return weather(d, px, py, pz, 0.12, seed * 0.47);
  };
  const r = length * 0.75 + 4;
  return [rock, [x - r, x + r, groundY(x, z) + 6.5, z - r, z + r]];
}

// Where each stands: [kind, cell size, ...its numbers]. z runs down the dive; `off` is the
// distance from the valley's centre line (negative is left as the camera goes).
export const SPIRE = { x: centerX(-306) + 17, z: -306, bottom: -209, top: -74, radius: 6.5 };
const FORMATIONS = [
  // the shallows
  [outcrop, 0.4, -27, 10.5, 6, 1.5, 11], [outcrop, 0.4, -38, -11, 7, 2.1, 12], [outcrop, 0.4, -50, 9.5, 6, 1.8, 13],
  // among the kelp
  [pinnacle, 0.5, -64, -9.5, 6.5, 2.2, 21], [pinnacle, 0.5, -73, 10.5, 9, 2.6, 22], [pinnacle, 0.5, -86, -11, 11, 3.0, 23],
  [pinnacle, 0.5, -95, 9.5, 8, 2.4, 24], [pinnacle, 0.5, -106, -9, 10, 2.8, 25], [pinnacle, 0.5, -115, 11, 7, 2.5, 26],
  // the reef
  [bommie, 0.42, -127, 8, 4.2, 3.0, 31], [bommie, 0.42, -135, -8.5, 5.0, 3.4, 32], [bommie, 0.42, -144, -9, 4.4, 2.8, 33],
  [bommie, 0.42, -150, 10.5, 5.6, 3.6, 34], [arch, 0.5, -158, -8.5, 7.5, 9.5, 1.7, 35], [bommie, 0.42, -170, 9, 4.8, 3.2, 36],
  [bommie, 0.42, -176, -9, 5.4, 3.3, 37], [outcrop, 0.42, -189, 1.0, 6.5, 2.2, 38],
  // the ledge and its wreck
  [outcrop, 0.5, -214, 13, 9, 3.2, 41], [pinnacle, 0.55, -238, -19, 9, 3.4, 42], [outcrop, 0.5, -258, -12, 9, 3.5, 43], [outcrop, 0.5, -262, 13, 8, 3.0, 44],
  // the plain: chimneys and pillow lava
  [pillows, 0.45, -316, 10, 12, 51], [pillows, 0.45, -326, -11, 12, 52], [chimney, 0.36, -331, 6.5, 9, 1.5, 53], [chimney, 0.36, -334, 9, 6, 1.2, 54],
  [chimney, 0.36, -346, -7.5, 12, 1.8, 55], [chimney, 0.36, -349, -10, 7, 1.3, 56], [pillows, 0.45, -352, 11, 14, 57], [chimney, 0.36, -359, 8, 8.5, 1.5, 58],
  [chimney, 0.36, -372, -6.5, 11, 1.7, 59], [chimney, 0.36, -375, -9.5, 6.5, 1.2, 60], [pillows, 0.45, -380, 9.5, 12, 61], [pillows, 0.45, -396, -4, 10, 62],
];

export function buildRocks(add, mat, looseMat, q) {
  for (const [kind, h, ...args] of FORMATIONS) {
    const [rock, box] = kind(...args);
    const mesh = new ThreeMesh(carve(rock, box, q.amount >= 1 ? h : h * 1.25), mat);
    mesh.matrixAutoUpdate = false;
    add(mesh, 130);
  }
  {
    const [rock, box] = spire(SPIRE.x, SPIRE.z, SPIRE.bottom, SPIRE.top, SPIRE.radius, 71);
    const mesh = new ThreeMesh(carve(rock, box, q.amount >= 1 ? 1.0 : 1.3), mat);
    mesh.matrixAutoUpdate = false;
    add(mesh, 150);
  }

  // boulders: two sizes of the same lumpy stone, in stretches of the valley
  const rng = makeRng(9001);
  const stone = (res, seed) => { const m = new Mesh(false); blob(m, 0, 0, 0, (x, y, z) => 1 + 0.26 * fbm3(x * 1.3 + seed, y * 1.3, z * 1.3, 3) + 0.1 * noise3(x * 4, y * 4 + seed, z * 4), res); return m.build(); };
  const small = stone(4, 3.1), big = stone(7, 8.4);
  const pos = new Vector3(), quat = new Quaternion(), scl = new Vector3(), axis = new Vector3();
  for (let z1 = 58; z1 > -440; z1 -= 62) {
    for (const [geo, count, lo, hi] of [[small, Math.round(64 * q.amount), 0.22, 0.85], [big, Math.round(11 * q.amount), 1.0, 2.6]]) {
      const list = [];
      for (let tries = 0; tries < count * 6 && list.length < count; tries++) {
        const z = z1 - rng() * 62;
        if (z < -266 && z > -300) continue;              // none on the cliff
        const s = lo + (hi - lo) * rng() * rng();
        const x = centerX(z) + rng.sign() * halfWidth(z) * rng.range(0.35, 1.7);
        if (offTrack(x, z) < 2.2 + s * 2) continue;
        list.push(x, groundY(x, z) - s * 0.3, z, s);
      }
      if (!list.length) continue;
      const places = [];
      for (let i = 0; i < list.length; i += 4) {
        const s = list[i + 3];
        quat.setFromAxisAngle(axis.set(rng.bell(), 1, rng.bell()).normalize(), rng() * TAU);
        place(places, pos.set(list[i], list[i + 1], list[i + 2]), quat, scl.set(s * rng.range(0.9, 1.3), s * rng.range(0.6, 0.9), s * rng.range(0.9, 1.2)));
      }
      const mesh = new ThreeMesh(instanced(geo, places), looseMat);
      mesh.matrixAutoUpdate = false;
      add(mesh, 100);
    }
  }
}
