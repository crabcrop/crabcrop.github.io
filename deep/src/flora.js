// What grows: the kelp forest, sea grass in the shallows, and the reef's corals, sponges,
// fans and anemones.
//
// Kelp and grass are blades. A blade is never stored: the vertex shader builds each one
// from three numbers-of-four (where its plant stands and how tall it is; where on the
// stalk it hangs, which way, how long and wide; its own seed and droop), bends it along a
// curve, twists and ruffles it, and moves it with the water. Blades are solid leaves seen
// from both sides, not cards with holes cut in them, so their edges stay clean. They are
// kept in cells on the ground: a cell out of view or out of range is not drawn, and far
// blades are thinned out (and the ones left widened) rather than shrunk to shimmer.
//
// The reef is made of a dozen shapes grown here from tubes, lathes and blobs, each drawn
// many times over with its own place, size and colour.
import { BufferAttribute, BufferGeometry, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, Matrix4, Mesh as ThreeMesh, Quaternion, Sphere, Vector3 } from 'three';
import { centerX, groundY, halfWidth, offTrack } from './layout.js';
import { Mesh, TAU, blob, clamp, fbm2, lathe, makeRng, noise2, noise3, tube } from './math.js';
import { perches } from './rocks.js';
import { material } from './shaders.js';

// ---- blades ----------------------------------------------------------------------------

const BLADE_VERT = /* glsl */ `
attribute vec4 ia;   // the plant: x, y, z of its foot, and its height
attribute vec4 ib;   // the blade: how far up the stalk (0..1), which way it faces, its length, its width
attribute vec4 ic;   // its seed, its droop, its kind (0 kelp, 1 grass), the plant's seed
// Where the stalk is at a height: it leans with the water, more the higher, and is never quite straight.
vec3 stemAt(vec3 base, float hh, float seed) {
  float ph = uTime * 0.5 + base.x * 0.13 + base.z * 0.09 + seed * 6.28;
  float a = 0.03 * pow(hh, 1.25);
  vec2 sway = a * vec2(sin(ph) + 0.35 * sin(ph * 1.9 + 1.3), 0.7 * cos(ph * 0.83 + 0.6));
  vec2 bend = vec2(sin(hh * 0.31 + seed * 40.0), cos(hh * 0.23 + seed * 23.0)) * 0.4 * smoothstep(0.0, 4.0, hh);
  return base + vec3(sway.x + bend.x, hh, sway.y + bend.y);
}
`;
const bladeMat = () => material({
  twoSided: true,
  vert: BLADE_VERT,
  vertMain: /* glsl */ `
  float t = position.y, u = position.x, seed = ic.x, kind = ic.z;
  vec3 S = stemAt(ia.xyz, ib.x * ia.w, ic.w);
  #ifdef SHADOW_PASS
  float far = 0.0;
  #else
  float far = smoothstep(28.0, 62.0, distance(S, cameraPosition));
  #endif
  vec3 D = vec3(cos(ib.y), 0.0, sin(ib.y)), U = vec3(0.0, 1.0, 0.0), W0 = vec3(-D.z, 0.0, D.x);
  // kelp goes out and up from its float and then over; grass stands and leans
  vec3 c1 = mix(D * 0.42 + U * 0.5, D * 0.06 + U * 0.5, kind);
  vec3 c2 = mix(D * 0.95 + U * (0.42 - ic.y), D * (0.2 + ic.y * 0.5) + U * 0.95, kind);
  float ph = uTime * (1.0 + 0.5 * seed) + seed * 30.0 + S.x * 0.2 + S.z * 0.13;
  c2 += vec3(0.17, 0.0, 0.11) * sin(ph * 0.6) + U * 0.07 * sin(ph);
  vec3 Q = (2.0 * (1.0 - t) * t * c1 + t * t * c2) * ib.z;
  vec3 T = normalize(2.0 * (1.0 - 2.0 * t) * c1 + 2.0 * t * c2);
  vec3 N0 = normalize(cross(W0, T));
  float tw = (seed - 0.5) * 2.4 * t + 0.35 * sin(ph + t * 4.0);
  vec3 W = W0 * cos(tw) + N0 * sin(tw), Nn = N0 * cos(tw) - W0 * sin(tw);
  float wd = ib.w * mix(pow(sin(3.14159 * pow(t, 0.7)), 0.6), 1.0 - t * t * 0.9, kind) * (1.0 + 1.3 * far);
  float rp = t * 16.0 + seed * 50.0, edge = abs(u) * (1.0 - kind);
  P = S + Q + W * (u * wd) + Nn * (sin(rp) * 0.16 * ib.w * edge - (1.0 - abs(u)) * 0.12 * ib.w);
  N = normalize(Nn + W * u * 0.4 - T * cos(rp) * 0.5 * edge);
  vAux = vec4(t, u, seed, kind + ib.x * 0.5);
  `,
  vertEnd: /* glsl */ `
  // far away, most blades are not drawn at all
  if (fract(seed * 7.13) > 1.0 - 0.72 * far) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  `,
  surf: /* glsl */ `
  float t = vAux.x, u = vAux.y, kind = step(0.75, vAux.w), up = (vAux.w - kind) * 2.0;
  vec3 col = mix(mix(vec3(0.15, 0.14, 0.04), vec3(0.35, 0.33, 0.07), fract(vAux.z * 3.7) * (0.5 + 0.5 * up)), vec3(0.13, 0.32, 0.09), kind);
  col *= (0.72 + 0.28 * smoothstep(0.0, 0.35, abs(u))) * (0.85 + 0.3 * t);
  float sh = shadow1(vW + uSunDir * 0.3);
  // a leaf seen from its shaded side shows the light that came through it: gold
  float back = smoothstep(0.15, -0.45, dot(s.n, uSunDir));
  s.albedo = mix(col, mix(vec3(0.46, 0.40, 0.07), vec3(0.30, 0.46, 0.10), kind), back * 0.8);
  s.trans = 0.9; s.spec = 0.2; s.gloss = 36.0; s.shade = sh; s.fluor = 0.12;
  s.ao = mix(0.45 + 0.55 * up, 0.5 + 0.5 * t, kind);
  // and looking toward the sun through it, it glows
  vec3 vv = normalize(vW - cameraPosition);
  s.emis = sunAt(vW.y) * sh * pow(max(dot(vv, uSunDir), 0.0), 5.0) * vec3(0.40, 0.35, 0.06) * 0.55;
  `,
});
const stalkMat = () => material({
  vert: BLADE_VERT,
  vertMain: /* glsl */ `
  vec3 C = stemAt(ia.xyz, position.y * ia.w, ic.w);
  P = C + vec3(position.x, 0.0, position.z) * 0.05 * (1.0 - 0.5 * position.y);
  N = vec3(position.x, 0.0, position.z);
  `,
  surf: /* glsl */ `
  s.albedo = vec3(0.19, 0.16, 0.05); s.spec = 0.14; s.gloss = 30.0; s.shade = shadow1(vW + uSunDir * 0.2); s.trans = 0.3;
  `,
});

// A strip of three columns: u is -1, 0, 1 across, t goes 0..1 up. The shader does the rest.
function strip(rows) {
  const pos = [], uv = [], idx = [];
  for (let r = 0; r <= rows; r++) for (let c = -1; c <= 1; c++) { pos.push(c, r / rows, 0); uv.push(c * 0.5 + 0.5, r / rows); }
  for (let r = 0; r < rows; r++) for (let c = 0; c < 2; c++) { const a = r * 3 + c; idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3); }
  return { position: new BufferAttribute(new Float32Array(pos), 3), uv: new BufferAttribute(new Float32Array(uv), 2), index: new BufferAttribute(new Uint16Array(idx), 1) };
}
// A stalk: a five-sided tube, y from 0 to 1.
function stalk(rows) {
  const pos = [], idx = [];
  for (let r = 0; r <= rows; r++) for (let c = 0; c < 5; c++) { const a = (c / 5) * TAU; pos.push(Math.cos(a), r / rows, Math.sin(a)); }
  for (let r = 0; r < rows; r++) for (let c = 0; c < 5; c++) { const a = r * 5 + c, b = r * 5 + (c + 1) % 5; idx.push(a, a + 5, b, b, a + 5, b + 5); }
  return { position: new BufferAttribute(new Float32Array(pos), 3), index: new BufferAttribute(new Uint16Array(idx), 1) };
}
// Gather instances by cell and make one mesh a cell.
function cells(add, shape, mat, list, size, range) {
  const by = new Map();
  for (let i = 0; i < list.length; i += 12) {
    const key = Math.floor(list[i] / size) + ',' + Math.floor(list[i + 2] / size);
    let c = by.get(key);
    if (!c) by.set(key, (c = []));
    for (let k = 0; k < 12; k++) c.push(list[i + k]);
  }
  for (const c of by.values()) {
    const n = c.length / 12, ia = new Float32Array(n * 4), ib = new Float32Array(n * 4), ic = new Float32Array(n * 4);
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 4; k++) { ia[i * 4 + k] = c[i * 12 + k]; ib[i * 4 + k] = c[i * 12 + 4 + k]; ic[i * 4 + k] = c[i * 12 + 8 + k]; }
      const x = ia[i * 4], y = ia[i * 4 + 1], z = ia[i * 4 + 2], top = y + ia[i * 4 + 3] + ib[i * 4 + 2];
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, top); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    const geo = new InstancedBufferGeometry();
    geo.setIndex(shape.index);
    geo.setAttribute('position', shape.position);
    if (shape.uv) geo.setAttribute('uv', shape.uv);
    geo.setAttribute('ia', new InstancedBufferAttribute(ia, 4));
    geo.setAttribute('ib', new InstancedBufferAttribute(ib, 4));
    geo.setAttribute('ic', new InstancedBufferAttribute(ic, 4));
    geo.instanceCount = n;
    geo.boundingSphere = new Sphere(new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 3);
    const mesh = new ThreeMesh(geo, mat);
    mesh.matrixAutoUpdate = false;
    add(mesh, range);
  }
}

function buildKelp(add, q) {
  const rng = makeRng(4242);
  const plants = Math.round(210 * (q.amount >= 1 ? 1 : q.amount >= 0.5 ? 0.7 : 0.45)), perMetre = q.amount >= 1 ? 6.5 : q.amount >= 0.5 ? 4.2 : 2.6;
  const wide = q.amount >= 1 ? 1 : q.amount >= 0.5 ? 1.25 : 1.6;
  const blades = [], stalks = [];
  for (let n = 0, tries = 0; n < plants && tries < plants * 30; tries++) {
    const z = -52 - rng() * 74, edge = Math.min((-52 - z) / 8, (z + 126) / 8, 1);
    if (rng() > edge) continue;                          // thinner at both ends of the forest
    const x = centerX(z) + rng.bell() * 2.2 * (halfWidth(z) + 4);
    if (offTrack(x, z) < 2.7 || Math.abs(x - centerX(z)) > halfWidth(z) + 11) continue;
    // in clumps, with clearings between
    if (noise2(x * 0.11 + 3.3, z * 0.11) < -0.18 + 0.3 * rng()) continue;
    const g = groundY(x, z), H = (-g - rng.range(1.2, 5.5)) * rng.range(0.78, 1), ps = rng();
    if (H < 4) continue;
    stalks.push(x, g, z, H, 0, 0, 0, 0, 0, 0, 0, ps);
    const count = Math.round(H * perMetre * rng.range(0.75, 1.15));
    for (let b = 0; b < count; b++) {
      const h = 0.06 + 0.94 * Math.pow(rng(), 0.8), top = h > 0.9 ? 1.5 : 1;
      blades.push(x, g, z, H, h, rng() * TAU, rng.range(0.9, 1.6) * (0.75 + 0.45 * h) * top, rng.range(0.13, 0.21) * wide, rng(), rng.range(0.05, 0.8) / top, 0, ps);
    }
    n++;
  }
  cells(add, strip(q.amount >= 1 ? 6 : q.amount >= 0.5 ? 5 : 4), bladeMat(), blades, 14, 78);
  cells(add, stalk(14), stalkMat(), stalks, 28, 78);
  return { plants: stalks.length / 12, blades: blades.length / 12 };
}

function buildGrass(add, q) {
  const rng = makeRng(777);
  const count = Math.round(15000 * q.amount), list = [];
  for (let n = 0, tries = 0; n < count && tries < count * 8; tries++) {
    const z = 20 - rng() * 82;
    const x = centerX(z) + rng.range(-1, 1) * (halfWidth(z) + 3);
    // meadows with sand between
    const m = fbm2(x * 0.09 + 11, z * 0.09, 3);
    if (m < 0.02 + 0.25 * rng() || (z < -50 && rng() < (-50 - z) / 12)) continue;
    const s = rng();
    list.push(x, groundY(x, z) - 0.03, z, 0, 0, rng() * TAU, rng.range(0.3, 0.75) * (0.7 + 2.2 * m), rng.range(0.022, 0.04) / Math.sqrt(q.amount), s, rng.range(0.1, 0.9), 1, rng());
    n++;
  }
  cells(add, strip(3), bladeMat(), list, 12, 46);
  return list.length / 12;
}

// ---- the reef --------------------------------------------------------------------------

// Each shape is grown at about one metre high, then its vertices are told what they are:
// aux = (how far it gives with the water, 0, how open to the light, how near its tip).
function finish(m, f) {
  const o = [0, 0, 0, 0];
  for (let v = 0; v < m.count; v++) {
    f(m.p[v * 3], m.p[v * 3 + 1], m.p[v * 3 + 2], m.a[v * 4], m.a[v * 4 + 1], m.n[v * 3 + 1], o);
    m.a[v * 4] = o[0]; m.a[v * 4 + 1] = o[1]; m.a[v * 4 + 2] = o[2]; m.a[v * 4 + 3] = o[3];
  }
  return m.build();
}
const SHAPES = {
  // antlers: branches that fork and reach up
  staghorn(rng) {
    const m = new Mesh(true);
    const grow = (x, y, z, dx, dy, dz, len, r, depth) => {
      const ex = x + dx * len, ey = y + dy * len, ez = z + dz * len;
      tube(m, [[x, y, z, r], [(x + ex) / 2 + rng.bell() * len * 0.14, (y + ey) / 2, (z + ez) / 2 + rng.bell() * len * 0.14, r * 0.85], [ex, ey, ez, r * 0.6]], 4, [depth, 0, 0]);
      if (depth >= 3) return;
      const kids = depth === 0 ? 4 : 2 + (rng() < 0.35 ? 1 : 0);
      for (let k = 0; k < kids; k++) {
        const cx = dx + rng.bell() * 1.2, cy = dy + 0.3 + rng() * 0.5, cz = dz + rng.bell() * 1.2, l = Math.hypot(cx, cy, cz);
        grow(ex, ey, ez, cx / l, cy / l, cz / l, len * rng.range(0.62, 0.86), r * 0.62, depth + 1);
      }
    };
    grow(0, -0.08, 0, 0, 1, 0, 0.3, 0.085, 0);
    return finish(m, (x, y, z, s, depth, ny, o) => { o[0] = 0; o[1] = 0; o[2] = 0.4 + 0.6 * clamp(y / 0.6, 0, 1); o[3] = clamp((depth + s) / 4, 0, 1); });
  },
  // a table: a wide thin plate on a stem
  table(rng) {
    const m = new Mesh(true), a = rng() * TAU;
    lathe(m, 0, 0, 0, [[0.16, -0.1], [0.11, 0.2], [0.16, 0.36], [0.6, 0.47], [1.0, 0.5], [1.04, 0.54], [0.8, 0.57], [0.3, 0.55], [0, 0.55]], 22, (ang, t) => 1 + (t > 0.3 ? 0.09 * Math.sin(ang * 5 + a) + 0.05 * Math.sin(ang * 11 - a) : 0));
    return finish(m, (x, y, z, t, _, ny, o) => { o[0] = 0; o[1] = 0; o[2] = ny < 0 ? 0.35 : 0.6 + 0.4 * clamp(Math.hypot(x, z), 0, 1); o[3] = clamp(Math.hypot(x, z), 0, 1); });
  },
  // a mound, lumpy like a brain
  mound(rng) {
    const m = new Mesh(true), s = rng() * 9;
    blob(m, 0, 0.3, 0, (x, y, z) => (0.55 + 0.1 * noise3(x * 2.2 + s, y * 2.2, z * 2.2) + 0.03 * noise3(x * 7 + s, y * 7, z * 7)) * (y < 0 ? 0.75 : 1), 7);
    return finish(m, (x, y, z, _, __, ny, o) => { o[0] = 0; o[1] = 1; o[2] = 0.45 + 0.55 * clamp(y / 0.5, 0, 1); o[3] = 0.5 + 0.4 * clamp(y, 0, 1); });
  },
  // knobs on knobs
  cauliflower(rng) {
    const m = new Mesh(true), s = rng() * 9;
    blob(m, 0, 0.28, 0, (x, y, z) => 0.42 + 0.16 * Math.abs(noise3(x * 3.1 + s, y * 3.1, z * 3.1)) + 0.1 * Math.abs(noise3(x * 6.3, y * 6.3 + s, z * 6.3)), 8);
    return finish(m, (x, y, z, _, __, ny, o) => { const r = Math.hypot(x, y - 0.28, z); o[0] = 0; o[1] = 0; o[2] = clamp((r - 0.4) * 4, 0.3, 1); o[3] = clamp((r - 0.42) * 5, 0, 1); });
  },
  // tubes: open at the top, in a bunch
  sponge(rng) {
    const m = new Mesh(true), n = 3 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, d = i ? rng.range(0.1, 0.3) : 0, h = rng.range(0.5, 1.1), r = rng.range(0.07, 0.13), lean = rng.range(0, 0.25);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const g = m.count;
      lathe(m, 0, 0, 0, [[r * 0.7, -0.1], [r, h * 0.5], [r * 1.25, h], [r * 1.05, h + 0.02], [r * 0.8, h * 0.55]], 9, null, [h, 0, 0]);
      for (let v = g; v < m.count; v++) { const y = m.p[v * 3 + 1]; m.p[v * 3] += x + Math.cos(a) * lean * y; m.p[v * 3 + 2] += z + Math.sin(a) * lean * y; }
    }
    return finish(m, (x, y, z, t, h, ny, o) => { o[0] = 0.02 * clamp(y, 0, 1); o[1] = 0; o[2] = t > 0.9 ? 0.25 : 0.5 + 0.5 * clamp(y / h, 0, 1); o[3] = clamp(y / h, 0, 1) * 0.8; });
  },
  // a fan: fine branches in one plane, across the current
  fan(rng) {
    const m = new Mesh(true);
    const grow = (x, y, ang, len, r, depth) => {
      const ex = x + Math.sin(ang) * len, ey = y + Math.cos(ang) * len;
      tube(m, [[x, y, rng.bell() * 0.02, r], [ex, ey, rng.bell() * 0.02, r * 0.7]], 3, [depth, 0, 0]);
      if (depth >= 5) return;
      const kids = depth < 2 ? 3 : 2;
      for (let k = 0; k < kids; k++) grow(ex, ey, ang + (k - (kids - 1) / 2) * rng.range(0.45, 0.75) + rng.bell() * 0.2, len * rng.range(0.66, 0.84), r * 0.72, depth + 1);
    };
    grow(0, -0.08, 0, 0.26, 0.035, 0);
    return finish(m, (x, y, z, s, depth, ny, o) => { o[0] = 0.07 * clamp(y, 0, 1.4) * clamp(y, 0, 1.4); o[1] = 0; o[2] = 0.75; o[3] = clamp((depth + s) / 6, 0, 1); });
  },
  // whips: tall and thin, a handful together
  whips(rng) {
    const m = new Mesh(true), n = 5 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, d = rng.range(0, 0.14), h = rng.range(0.7, 1.5), lx = Math.cos(a) * rng.range(0.05, 0.3), lz = Math.sin(a) * rng.range(0.05, 0.3);
      const pts = [];
      for (let k = 0; k <= 4; k++) { const t = k / 4; pts.push([Math.cos(a) * d + lx * t * t, -0.05 + h * t, Math.sin(a) * d + lz * t * t, 0.022 * (1 - 0.5 * t)]); }
      tube(m, pts, 4, [h, 0, 0]);
    }
    return finish(m, (x, y, z, s, h, ny, o) => { o[0] = 0.16 * s * s; o[1] = 0; o[2] = 0.6 + 0.4 * s; o[3] = s; });
  },
  // an anemone: a short column under a crown of arms
  anemone(rng) {
    const m = new Mesh(true);
    lathe(m, 0, 0, 0, [[0.2, -0.05], [0.17, 0.16], [0.24, 0.24], [0, 0.27]], 10, null, [-1, 0, 0]);
    for (let i = 0; i < 26; i++) {
      const a = rng() * TAU, d = 0.05 + 0.17 * Math.sqrt(rng()), len = rng.range(0.22, 0.4), out = d * 1.3;
      const pts = [];
      for (let k = 0; k <= 3; k++) { const t = k / 3; pts.push([Math.cos(a) * (d + out * t * t), 0.24 + len * t, Math.sin(a) * (d + out * t * t), 0.022 * (1 - 0.35 * t)]); }
      tube(m, pts, 4, [1, 0, 0]);
    }
    return finish(m, (x, y, z, s, arm, ny, o) => { const k = arm > 0 ? s : 0; o[0] = 0.09 * k; o[1] = 0; o[2] = arm > 0 ? 0.55 + 0.45 * k : 0.6; o[3] = arm > 0 ? k : 0.15; });
  },
  // a tube worm: a white tube with a red plume, for the vents
  worm(rng) {
    const m = new Mesh(true), h = rng.range(0.6, 1.2);
    const pts = [];
    for (let k = 0; k <= 3; k++) { const t = k / 3; pts.push([0.06 * Math.sin(t * 3 + h * 9), -0.1 + h * t, 0.05 * Math.cos(t * 2.4 + h * 5), 0.035]); }
    tube(m, pts, 5, [0, 0, 0]);
    blob(m, pts[3][0], pts[3][1] + 0.07, pts[3][2], () => 0.06, 3, (x, y, z, o) => { o[0] = 1; o[1] = 1; });
    return finish(m, (x, y, z, s, plume, ny, o) => { o[0] = 0.03 * s; o[1] = plume > 0.5 ? 2 : 0; o[2] = 0.5 + 0.5 * s; o[3] = plume > 0.5 ? 1 : 0.2; });
  },
};

const reefMat = () => material({
  aux: true,
  vert: /* glsl */ `attribute vec4 tint; varying vec4 vTint;`,
  vertMain: /* glsl */ `
  vTint = tint;
  // what is soft gives with the water, more toward its ends
  float ph = uTime * 0.9 + tint.w * 40.0;
  P.xz += aux.x * vec2(sin(ph) + 0.4 * sin(ph * 2.3), 0.6 * cos(ph * 0.8));
  `,
  frag: /* glsl */ `varying vec4 vTint;`,
  surf: /* glsl */ `
  vec2 hm;
  float near = 1.0 - smoothstep(6.0, 24.0, length(vW - cameraPosition));
  vec3 nn = detail(vW, s.n, mix(2.9, 1.3, step(0.5, vAux.y)), 3.0, hm);
  s.n = normalize(mix(s.n, nn, near * 0.8));
  vec3 base = vAux.y > 1.5 ? vec3(0.78, 0.07, 0.05) : vTint.rgb;        // (a plume is always red)
  s.albedo = base * (0.5 + 0.75 * vAux.w) * mix(1.0, 0.6 + 0.8 * hm.x, near);
  s.ao = vAux.z; s.fluor = 0.7; s.spec = 0.05; s.gloss = 18.0; s.trans = vAux.x > 0.0 ? 0.35 : 0.0;
  `,
});

// The colours corals come in.
const CORAL = [[0.86, 0.36, 0.30], [0.84, 0.52, 0.16], [0.58, 0.27, 0.68], [0.24, 0.56, 0.46], [0.86, 0.76, 0.26], [0.78, 0.2, 0.38], [0.86, 0.80, 0.70], [0.3, 0.42, 0.78]];
const SPONGE = [[0.88, 0.70, 0.14], [0.58, 0.26, 0.70], [0.86, 0.34, 0.14], [0.2, 0.5, 0.74]];
const FAN = [[0.6, 0.22, 0.7], [0.82, 0.24, 0.2], [0.86, 0.58, 0.16]];
const BONE = [[0.82, 0.80, 0.74]];

// What is planted: shape, how many (on high), where (z from, z to), on the ground or on
// the formations or both, size from and to, colours, variants of the shape.
const PLANTING = [
  ['staghorn', 150, -122, -192, 'both', 0.7, 1.9, CORAL, 3], ['table', 62, -124, -190, 'both', 0.7, 2.0, CORAL, 2], ['mound', 80, -120, -194, 'ground', 0.6, 1.8, CORAL, 2],
  ['cauliflower', 90, -120, -194, 'both', 0.5, 1.3, CORAL, 2], ['sponge', 80, -118, -196, 'both', 0.6, 1.5, SPONGE, 3], ['fan', 60, -126, -196, 'rock', 0.9, 2.2, FAN, 2],
  ['whips', 46, -128, -200, 'both', 0.8, 1.7, FAN, 2], ['anemone', 74, -118, -192, 'both', 0.6, 1.3, CORAL, 2],
  // the shallows and the kelp have a little of it too
  ['mound', 22, -20, -118, 'ground', 0.4, 1.0, CORAL, 1], ['anemone', 30, -24, -118, 'rock', 0.5, 1.0, CORAL, 1], ['sponge', 26, -60, -118, 'rock', 0.6, 1.2, SPONGE, 1],
  // the ledge and the wreck: fans, whips and sponges, sparser
  ['fan', 26, -200, -264, 'both', 0.9, 2.0, FAN, 1], ['whips', 26, -200, -264, 'both', 0.8, 1.6, FAN, 1], ['sponge', 30, -198, -264, 'both', 0.6, 1.4, SPONGE, 1],
  // the vents: tube worms on the pillow lava and at the chimneys' feet
  ['worm', 420, -306, -400, 'both', 0.6, 1.5, BONE, 3],
];

function buildReef(add, q) {
  const rng = makeRng(31337), mat = reefMat();
  const m4 = new Matrix4(), pos = new Vector3(), quat = new Quaternion(), yaw = new Quaternion(), scl = new Vector3(), up = new Vector3(0, 1, 0), nrm = new Vector3();
  let planted = 0;
  for (const [name, count, zA, zB, where, s0, s1, colours, variants] of PLANTING) {
    // the formations' own places in this stretch
    const spots = [];
    for (let i = 0; i < perches.length; i += 6) if (perches[i + 2] <= zA && perches[i + 2] >= zB) spots.push(i);
    const total = Math.max(2, Math.round(count * q.amount));
    for (let v = 0; v < variants; v++) {
      const geo = SHAPES[name](rng), n = Math.ceil(total / variants);
      // two halves along the dive, so the far half can be left undrawn
      for (let half = 0; half < 2; half++) {
        const z0 = half ? (zA + zB) / 2 : zA, z1 = half ? zB : (zA + zB) / 2, list = [];
        for (let tries = 0; tries < n * 12 && list.length < Math.ceil(n / 2) * 12; tries++) {
          const onRock = where === 'rock' || (where === 'both' && rng() < 0.55);
          let x, y, z;
          if (onRock) {
            if (!spots.length) continue;
            const i = spots[(rng() * spots.length) | 0];
            x = perches[i]; y = perches[i + 1]; z = perches[i + 2];
            if (z > z0 || z < z1) continue;
            nrm.set(perches[i + 3], perches[i + 4] + 1.2, perches[i + 5]).normalize();
          } else {
            z = z0 + (z1 - z0) * rng();
            const w = halfWidth(z);
            x = centerX(z) + rng.range(-1, 1) * (w + 5);
            y = groundY(x, z);
            if (name === 'worm' && noise2(x * 0.2, z * 0.2) < 0.05) continue;       // in colonies
            nrm.set(groundY(x - 0.4, z) - groundY(x + 0.4, z), 1.6, groundY(x, z - 0.4) - groundY(x, z + 0.4)).normalize();
          }
          const s = s0 + (s1 - s0) * rng() * rng();
          if (offTrack(x, z, y + s * 0.5) < 1.6 + s) continue;
          const c = colours[(rng() * colours.length) | 0], k = rng.range(0.75, 1.15);
          list.push(x, y, z, s, nrm.x, nrm.y, nrm.z, rng() * TAU);
          list.push(c[0] * k, c[1] * k, c[2] * k, rng());
        }
        const cnt = list.length / 12;
        if (!cnt) continue;
        // (its own geometry, sharing the shape's buffers, to carry its own colours)
        const own = new BufferGeometry(), tint = new Float32Array(cnt * 4);
        own.setIndex(geo.index);
        for (const k of ['position', 'normal', 'uv', 'aux']) own.setAttribute(k, geo.getAttribute(k));
        own.setAttribute('tint', new InstancedBufferAttribute(tint, 4));
        const mesh = new InstancedMesh(own, mat, cnt);
        for (let i = 0; i < cnt; i++) {
          const o = i * 12;
          quat.setFromUnitVectors(up, nrm.set(list[o + 4], list[o + 5], list[o + 6]));
          quat.multiply(yaw.setFromAxisAngle(up, list[o + 7]));
          m4.compose(pos.set(list[o], list[o + 1], list[o + 2]), quat, scl.setScalar(list[o + 3]));
          mesh.setMatrixAt(i, m4);
          tint.set(list.slice(o + 8, o + 12), i * 4);
        }
        mesh.matrixAutoUpdate = false;
        add(mesh, 70);
        planted += cnt;
      }
    }
  }
  return planted;
}

export function buildFlora(add, q) {
  const kelp = buildKelp(add, q), grass = buildGrass(add, q), reef = buildReef(add, q);
  return { ...kelp, grass, reef };
}
