// Numbers and shapes: a seeded random source, noise for building the world, and a mesh
// builder that packs many simple shapes into one geometry. Nothing here runs per frame.
import { BufferAttribute, BufferGeometry } from 'three/webgpu';

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const TAU = Math.PI * 2;

// A small, fast, seedable generator (mulberry32). rng() is 0..1.
export function makeRng(seed) {
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (a, b) => a + (b - a) * rng();
  rng.sign = () => (rng() < 0.5 ? -1 : 1);
  rng.pick = (list) => list[(rng() * list.length) | 0];
  // (roughly normal, -1..1, cheap)
  rng.bell = () => (rng() + rng() + rng() + rng() - 2) * 0.5;
  return rng;
}

// Value noise with a quintic fade, in 2 and 3 dimensions, -1..1; and its sum over octaves.
function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const a = lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u);
  const b = lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u);
  const c = lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u);
  const d = lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u);
  return lerp(lerp(a, b, v), lerp(c, d, v), w) * 2 - 1;
}
export const noise2 = (x, y) => noise3(x, y, 7.31);
export function fbm3(x, y, z, octaves = 4, gain = 0.5, lac = 2.03) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x, y, z); norm += amp;
    x = x * lac + 17.1; y = y * lac + 9.2; z = z * lac + 3.7; amp *= gain;
  }
  return sum / norm;
}
export const fbm2 = (x, y, octaves, gain, lac) => fbm3(x, y, 7.31, octaves, gain, lac);
// Ridges: sharp crests where the noise crosses zero. 0..1.
export function ridge3(x, y, z, octaves = 4) {
  let sum = 0, amp = 0.5, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise3(x, y, z));
    sum += amp * n * n; norm += amp;
    x = x * 2.07 + 5.3; y = y * 2.07 + 1.9; z = z * 2.07 + 8.1; amp *= 0.5;
  }
  return sum / norm;
}

// A geometry under construction. Shapes are appended with a transform already applied;
// build() hands back one indexed BufferGeometry. `aux` is a free vec4 per vertex that
// each kind of mesh uses in its own way (a colour, a height along a stalk, a phase).
export class Mesh {
  constructor(withAux = false) {
    this.p = []; this.n = []; this.u = []; this.i = []; this.a = withAux ? [] : null;
    this.count = 0;
  }
  vert(px, py, pz, nx, ny, nz, u = 0, v = 0, a0 = 0, a1 = 0, a2 = 0, a3 = 0) {
    this.p.push(px, py, pz); this.n.push(nx, ny, nz); this.u.push(u, v);
    if (this.a) this.a.push(a0, a1, a2, a3);
    return this.count++;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  // A grid of (cols + 1) x (rows + 1) points from f(s, t, out), s and t in 0..1.
  // f fills out = [x, y, z, a0, a1, a2, a3]. Normals come from the grid itself.
  grid(cols, rows, f, wrapS = false, flip = false) {
    const base = this.count, out = [0, 0, 0, 0, 0, 0, 0];
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
      out[3] = out[4] = out[5] = out[6] = 0;
      f(c / cols, r / rows, out);
      this.vert(out[0], out[1], out[2], 0, 1, 0, c / cols, r / rows, out[3], out[4], out[5], out[6]);
    }
    const w = cols + 1;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const a = base + r * w + c, b = a + 1, d = a + w, e = d + 1;
      if (flip) this.i.push(a, d, b, b, d, e); else this.i.push(a, b, d, b, e, d);
    }
    this.normals(base, this.count, this.i.length - cols * rows * 6, wrapS ? { cols, rows, base } : null);
    return base;
  }
  // Smooth normals for the vertices base..end from the triangles that start at index i0.
  normals(base, end, i0, seam) {
    const { p, n, i } = this;
    for (let k = base * 3; k < end * 3; k++) n[k] = 0;
    for (let k = i0; k < i.length; k += 3) {
      const a = i[k] * 3, b = i[k + 1] * 3, c = i[k + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      n[a] += nx; n[a + 1] += ny; n[a + 2] += nz; n[b] += nx; n[b + 1] += ny; n[b + 2] += nz; n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
    }
    if (seam) { // a grid closed on itself in s: the first and last column share a normal
      const w = seam.cols + 1;
      for (let r = 0; r <= seam.rows; r++) {
        const a = (seam.base + r * w) * 3, b = (seam.base + r * w + seam.cols) * 3;
        for (let k = 0; k < 3; k++) { const s = n[a + k] + n[b + k]; n[a + k] = s; n[b + k] = s; }
      }
    }
    for (let k = base * 3; k < end * 3; k += 3) {
      const l = Math.hypot(n[k], n[k + 1], n[k + 2]) || 1;
      n[k] /= l; n[k + 1] /= l; n[k + 2] /= l;
    }
  }
  build() {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(this.p), 3));
    g.setAttribute('normal', new BufferAttribute(new Float32Array(this.n), 3));
    g.setAttribute('uv', new BufferAttribute(new Float32Array(this.u), 2));
    if (this.a) g.setAttribute('aux', new BufferAttribute(new Float32Array(this.a), 4));
    g.setIndex(this.count > 65535 ? new BufferAttribute(new Uint32Array(this.i), 1) : new BufferAttribute(new Uint16Array(this.i), 1));
    return g;
  }
}

// A tube along points [[x, y, z, radius], ...], closed with a rounded tip at its end.
// aux = (s along the tube 0..1, a0, a1, a2) from `tag`.
export function tube(mesh, pts, sides = 6, tag = [0, 0, 0]) {
  const n = pts.length, base = mesh.count;
  let ux = 0, uy = 1, uz = 0; // a frame carried along the tube so it does not twist
  for (let k = 0; k < n; k++) {
    const a = pts[Math.max(k - 1, 0)], b = pts[Math.min(k + 1, n - 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    if (k === 0 && Math.abs(ty) > 0.9) { ux = 1; uy = 0; uz = 0; }
    // side = t x u, then u = side x t
    let sx = ty * uz - tz * uy, sy = tz * ux - tx * uz, sz = tx * uy - ty * ux;
    const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
    ux = sy * tz - sz * ty; uy = sz * tx - sx * tz; uz = sx * ty - sy * tx;
    const r = pts[k][3];
    for (let j = 0; j <= sides; j++) {
      const ang = (j / sides) * TAU, c = Math.cos(ang), s = Math.sin(ang);
      const nx = sx * c + ux * s, ny = sy * c + uy * s, nz = sz * c + uz * s;
      mesh.vert(pts[k][0] + nx * r, pts[k][1] + ny * r, pts[k][2] + nz * r, nx, ny, nz, j / sides, k / (n - 1), k / (n - 1), tag[0], tag[1], tag[2]);
    }
  }
  const w = sides + 1;
  for (let k = 0; k < n - 1; k++) for (let j = 0; j < sides; j++) {
    const a = base + k * w + j;
    mesh.i.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
  }
  // the tip
  const last = pts[n - 1], prev = pts[n - 2];
  let tx = last[0] - prev[0], ty = last[1] - prev[1], tz = last[2] - prev[2];
  const tl = Math.hypot(tx, ty, tz) || 1;
  const tip = mesh.vert(last[0] + (tx / tl) * last[3] * 0.6, last[1] + (ty / tl) * last[3] * 0.6, last[2] + (tz / tl) * last[3] * 0.6, tx / tl, ty / tl, tz / tl, 0.5, 1, 1, tag[0], tag[1], tag[2]);
  const ring = base + (n - 1) * w;
  for (let j = 0; j < sides; j++) mesh.i.push(ring + j, tip, ring + j + 1);
}

// A sphere-like blob: f(dirX, dirY, dirZ) gives the radius in that direction. Built from a
// cube pushed out to a sphere, so its triangles are even. aux from tag(dir, out) if given.
export function blob(mesh, cx, cy, cz, f, res = 12, tag = null) {
  const start = mesh.count, i0 = mesh.i.length, out = [0, 0, 0, 0];
  const index = new Map();
  const faces = [[1, 0, 0, 0, 1, 0, 0, 0, 1], [-1, 0, 0, 0, 0, 1, 0, 1, 0], [0, 1, 0, 0, 0, 1, 1, 0, 0], [0, -1, 0, 1, 0, 0, 0, 0, 1], [0, 0, 1, 1, 0, 0, 0, 1, 0], [0, 0, -1, 0, 1, 0, 1, 0, 0]];
  for (const [nx, ny, nz, ax, ay, az, bx, by, bz] of faces) {
    const ids = [];
    for (let r = 0; r <= res; r++) for (let c = 0; c <= res; c++) {
      const s = (c / res) * 2 - 1, t = (r / res) * 2 - 1;
      let x = nx + ax * s + bx * t, y = ny + ay * s + by * t, z = nz + az * s + bz * t;
      const l = Math.hypot(x, y, z); x /= l; y /= l; z /= l;
      const key = Math.round(x * 4096) + ',' + Math.round(y * 4096) + ',' + Math.round(z * 4096);
      let id = index.get(key);
      if (id === undefined) {
        const rad = f(x, y, z);
        if (tag) tag(x, y, z, out);
        id = mesh.vert(cx + x * rad, cy + y * rad, cz + z * rad, x, y, z, Math.atan2(z, x) / TAU + 0.5, Math.asin(clamp(y, -1, 1)) / Math.PI + 0.5, out[0], out[1], out[2], out[3]);
        index.set(key, id);
      }
      ids.push(id);
    }
    const w = res + 1;
    for (let r = 0; r < res; r++) for (let c = 0; c < res; c++) {
      const a = ids[r * w + c], b = ids[r * w + c + 1], d = ids[(r + 1) * w + c], e = ids[(r + 1) * w + c + 1];
      mesh.i.push(a, d, b, b, d, e);
    }
  }
  mesh.normals(start, mesh.count, i0, null);
}

// A solid of revolution around the y axis from a profile [[radius, y], ...], bottom to top.
// ripple(angle, t) scales the radius, for scalloped or fluted shapes.
export function lathe(mesh, cx, cy, cz, profile, sides = 16, ripple = null, tag = [0, 0, 0]) {
  const rows = profile.length - 1;
  return mesh.grid(sides, rows, (s, t, o) => {
    const k = Math.min(Math.round(t * rows), rows), ang = s * TAU;
    const r = profile[k][0] * (ripple ? ripple(ang, t) : 1);
    o[0] = cx + Math.cos(ang) * r; o[1] = cy + profile[k][1]; o[2] = cz + Math.sin(ang) * r;
    o[3] = t; o[4] = tag[0]; o[5] = tag[1]; o[6] = tag[2];
  }, true, true);
}
