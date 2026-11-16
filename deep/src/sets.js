// The set pieces: everything man-made or singular that the story needs, made in code.
//
//   the marina      pier pilings and their bracing from the sand up through the surface, the
//                   deck above it (seen only as its shade, and through the window overhead),
//                   the boat at anchor, its chain hanging down to the anchor on the sand
//   the giant clam  at the reef's far end: "a studio in a shell"
//   the wreck       a wooden sailing hull lying on its side on the ledge, a lantern inside
//   the vents       the chimneys' glowing cracks and mouths, and their black smoke
//   the geode       a rock split open at the end of the vents, lined with crystals
//
// buildSets(ctx) returns { update(t, dt, p), chainAt(s, out), clam, geode }:
//   chainAt(s, out)  s is 0 at the boat's bow and 1 at the anchor's ring; writes the point
//                    on the chain (out[0..2]) and its unit direction toward the anchor
//                    (out[3..5]), as the chain hangs at this frame (after update(t)).
//   clam             { position, normal }: where an object sits in the open clam, and the
//                    way the clam opens (unit vector out of its mouth).
//   geode            { position, normal, size }: the spot in the geode's hollow where the
//                    picture goes, the way it faces (toward the camera at p = 7), and the
//                    largest side a picture centred there can have.
import { DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, Mesh as ThreeMesh, Sphere, Vector3 } from 'three/webgpu';
import {
  abs, attribute, cameraPosition, clamp, cos, cross, dot, exp, float, floor, fract, fwidth, length, max, min, mix, normalize, pow,
  reflect, refract, select, sin, smoothstep, sqrt, step, texture, uniform, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';
import { centerX, groundY, offTrack } from './layout.js';
import { Mesh, TAU, blob, clamp as clampN, lerp, makeRng, noise3 } from './math.js';
import { G, SIG, detail, hash1, inWater, material, scatterFrom, sunAt } from './shaders.js';

// ---- building blocks ----------------------------------------------------------------------

const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const sphereOf = (geo, pad = 0) => {
  geo.computeBoundingSphere();
  geo.boundingSphere.radius += pad;
  return geo;
};
function addMesh(ctx, geo, mat, range, opts = {}) {
  const mesh = new ThreeMesh(geo, mat);
  mesh.matrixAutoUpdate = false;
  if (opts.order !== undefined) mesh.renderOrder = opts.order;
  if (opts.noShadow) mesh.userData.castShadow = false;
  ctx.add(mesh, range);
  return mesh;
}

// A tube along points [[x, y, z, r], ...] with a frame carried along it; radius(k, j, ang)
// scales the radius, aux(k, j, x, y, z, out) fills the vertex's aux. Smooth normals.
function sweep(m, pts, sides, { radius = null, aux = null, up = [1, 0, 0], closed = false } = {}) {
  const n = pts.length, base = m.count, i0 = m.i.length, o = [0, 0, 0, 0];
  let ux = up[0], uy = up[1], uz = up[2];
  for (let k = 0; k < n; k++) {
    const a = pts[closed ? (k - 1 + n) % n : Math.max(k - 1, 0)], b = pts[closed ? (k + 1) % n : Math.min(k + 1, n - 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    let sx = ty * uz - tz * uy, sy = tz * ux - tx * uz, sz = tx * uy - ty * ux;
    const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
    ux = sy * tz - sz * ty; uy = sz * tx - sx * tz; uz = sx * ty - sy * tx;
    for (let j = 0; j <= sides; j++) {
      const ang = (j / sides) * TAU, c = Math.cos(ang), s = Math.sin(ang);
      const r = pts[k][3] * (radius ? radius(k, j % sides, ang) : 1);
      const nx = sx * c + ux * s, ny = sy * c + uy * s, nz = sz * c + uz * s;
      const x = pts[k][0] + nx * r, y = pts[k][1] + ny * r, z = pts[k][2] + nz * r;
      o[0] = o[1] = o[2] = o[3] = 0;
      if (aux) aux(k, j, x, y, z, o);
      m.vert(x, y, z, nx, ny, nz, j / sides, k / (n - 1), o[0], o[1], o[2], o[3]);
    }
  }
  const w = sides + 1, segs = closed ? n : n - 1;
  for (let k = 0; k < segs; k++) for (let j = 0; j < sides; j++) {
    const a = base + k * w + j, b = base + ((k + 1) % n) * w + j;
    m.i.push(a, b, a + 1, a + 1, b, b + 1);
  }
  m.normals(base, m.count, i0, null);
  // (the seam: the first and last column share a normal)
  for (let k = 0; k < n; k++) {
    const a = (base + k * w) * 3, b = (base + k * w + sides) * 3;
    for (let e = 0; e < 3; e++) { const s = m.n[a + e] + m.n[b + e]; m.n[a + e] = s; m.n[b + e] = s; }
    const l = Math.hypot(m.n[a], m.n[a + 1], m.n[a + 2]) || 1;
    for (let e = 0; e < 3; e++) { m.n[a + e] /= l; m.n[b + e] = m.n[a + e]; }
  }
  return base;
}

// A squared timber from a to b: `w` wide along side, `h` deep along up (side = up x axis).
// Flat faces; aux = (across the face in metres, along in metres, a2, a3).
function beam(m, a, b, w, h, upv, a3 = 0, hfn = null) {
  const ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2], len = Math.hypot(ax, ay, az);
  const tx = ax / len, ty = ay / len, tz = az / len;
  let sx = upv[1] * tz - upv[2] * ty, sy = upv[2] * tx - upv[0] * tz, sz = upv[0] * ty - upv[1] * tx;
  const sl = Math.hypot(sx, sy, sz); sx /= sl; sy /= sl; sz /= sl;
  const ux = ty * sz - tz * sy, uy = tz * sx - tx * sz, uz = tx * sy - ty * sx;
  const hw = w / 2, hh = h / 2;
  // the four long faces: normal, then the two edges across it
  const faces = [[ux, uy, uz, sx, sy, sz, hh, hw], [-ux, -uy, -uz, -sx, -sy, -sz, hh, hw], [sx, sy, sz, -ux, -uy, -uz, hw, hh], [-sx, -sy, -sz, ux, uy, uz, hw, hh]];
  let f = 0;
  for (const [nx, ny, nz, ex, ey, ez, off, half] of faces) {
    const v0 = m.count;
    for (const [e, t] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
      const px = a[0] + ax * t + nx * off + ex * half * e, py = a[1] + ay * t + ny * off + ey * half * e, pz = a[2] + az * t + nz * off + ez * half * e;
      m.vert(px, py, pz, nx, ny, nz, 0, 0, e * half + f * 0.37, t * len + a3 * 3.7, hfn ? hfn(px, py, pz) : 0, 0);
    }
    m.i.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
    f++;
  }
  // the ends
  for (const [t, sgn] of [[0, -1], [1, 1]]) {
    const v0 = m.count;
    for (const [e1, e2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const px = a[0] + ax * t + sx * hw * e1 + ux * hh * e2, py = a[1] + ay * t + sy * hw * e1 + uy * hh * e2, pz = a[2] + az * t + sz * hw * e1 + uz * hh * e2;
      m.vert(px, py, pz, tx * sgn, ty * sgn, tz * sgn, 0, 0, e1 * hw, t * len + e2 * hh * 0.3 + a3 * 3.7, hfn ? hfn(px, py, pz) : 0, 0);
    }
    if (sgn > 0) m.i.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3); else m.i.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2);
  }
}

// ---- surfaces -------------------------------------------------------------------------------

// Weathered timber under water. aux: x across the grain (m), y along it (m), z height above
// the sand (m), w kind (0 timber, 1 growth lump). shade: how much of the sky a roof hides.
function woodSurf(s, f, { tint = vec3(1.0), shade = float(0.0), seed = float(0.0) } = {}) {
  const near = float(1).sub(smoothstep(4.0, 18.0, f.dist)).toVar();
  const mid = float(1).sub(smoothstep(12.0, 45.0, f.dist)).toVar();
  const D = detail(f.w, s.n, 1.3, 3.0), E = detail(f.w, s.n, 4.1, 3.5);
  // the grain: the relief texture drawn out along the timber, twice
  // (across: whole tiles per turn of a pile, so the grain meets itself without a seam)
  const gA = texture(G.detailTex, vec2(f.aux.x.mul(2.0).add(seed), f.aux.y.mul(0.06))).toVar();
  const gB = texture(G.detailTex, vec2(f.aux.x.mul(5.0).add(seed.mul(3.0)), f.aux.y.mul(0.21))).toVar();
  const grain = gA.b.mul(0.6).add(gB.b.mul(0.4)).toVar();
  const check = float(1).sub(smoothstep(0.12, 0.3, gB.b)).mul(mid).toVar();       // the splits along the grain
  const wood = mix(vec3(0.15, 0.125, 0.095), vec3(0.37, 0.31, 0.23), grain.mul(1.25).sub(0.12)).mul(tint).toVar();
  wood.mulAssign(float(1).sub(check.mul(0.55)));
  wood.mulAssign(gA.a.mul(0.35).add(0.82));
  // what grows: barnacles and mussels at the foot, a film of weed up the timber, green near the light
  const h = f.aux.z.add(D.m.sub(0.5).mul(0.9)).toVar();
  const foot = float(1).sub(smoothstep(0.5, 1.5, h)).toVar();
  const film = smoothstep(0.35, 0.75, gA.a.mul(0.6).add(D.h.mul(0.6))).mul(float(1).sub(foot)).toVar();
  const shallow = smoothstep(-1.9, -0.6, f.w.y).toVar();
  const barn = smoothstep(0.42, 0.62, E.h).mul(near.mul(0.6).add(0.4)).toVar();
  const mussel = smoothstep(0.55, 0.68, D.m.add(E.m.mul(0.3))).toVar();
  const foul = mix(mix(vec3(0.34, 0.33, 0.27), vec3(0.62, 0.60, 0.53), barn), vec3(0.05, 0.055, 0.07), mussel.mul(0.85)).toVar();
  const weed = mix(vec3(0.17, 0.17, 0.07), vec3(0.20, 0.33, 0.08), shallow).toVar();
  const col = mix(wood, weed, film.mul(0.75).add(shallow.mul(0.35)).min(0.9)).toVar();
  col.assign(mix(col, foul, foot));
  s.albedo = col;
  const nb = normalize(s.n.add(D.n.sub(s.n).mul(mid.mul(0.7).add(0.3))).add(E.n.sub(s.n).mul(near.mul(foot.mul(1.4).add(0.3)))));
  s.n = nb.toVar();
  s.ao = mix(float(1), grain.mul(0.5).add(0.55), 0.6).mul(float(1).sub(shade.mul(0.6))).mul(smoothstep(-0.2, 1.2, f.aux.z).mul(0.35).add(0.65));
  s.spec = mix(float(0.06), float(0.16), foot.mul(mussel)).mul(near.mul(0.6).add(0.4));
  s.gloss = float(22.0);
  s.fluor = film.mul(0.2).add(foot.mul(0.15));
}

// Rusted iron: chain and anchor. k is how far the growth has crept on (0..1).
function rustSurf(s, f, k) {
  const near = float(1).sub(smoothstep(3.0, 14.0, f.dist)).toVar();
  const D = detail(f.w, s.n, 2.3, 3.5), E = detail(f.w, s.n, 7.7, 3.0);
  const scale = smoothstep(0.35, 0.7, D.m.add(E.h.mul(0.4))).toVar();
  const col = mix(vec3(0.30, 0.14, 0.055), vec3(0.11, 0.085, 0.07), scale).toVar();
  col.assign(mix(col, vec3(0.42, 0.22, 0.08), smoothstep(0.62, 0.8, E.m).mul(0.6)));
  const grow = smoothstep(0.55, 0.85, s.n.y.mul(0.5).add(D.h.mul(0.6)).add(k.mul(0.5)).sub(0.3)).toVar();
  col.assign(mix(col, vec3(0.16, 0.19, 0.08), grow.mul(0.7)));
  s.albedo = col;
  s.n = normalize(s.n.add(D.n.sub(s.n).mul(0.8)).add(E.n.sub(s.n).mul(near.mul(0.9)))).toVar();
  s.ao = D.h.mul(0.5).add(0.6).min(1.0);
  s.spec = float(0.12).mul(float(1).sub(grow)); s.gloss = float(26.0); s.fluor = float(0.3).mul(float(1).sub(grow));
}

// ---- the marina -----------------------------------------------------------------------------

// The pier: a timber wharf running out over the sand to its end at z = -0.5, four rows of
// piles across it (bents every 4 m), the camera's way down its open middle bay. Its deck
// stands above the water: from below it is seen as its shade, and through the window.
const PIER = { x: 4.9, rows: [-7.1, -3.05, 3.05, 7.1], bents: 7, zEnd: -0.5, bay: 4.0, top: 0.42, cap: [0.42, 0.66], str: [0.66, 0.9], plank: 0.9, pitch: 0.215 };
const PIER_BOX = { x0: PIER.x - 7.75, x1: PIER.x + 7.75, z0: PIER.zEnd - 0.6, z1: PIER.zEnd + PIER.bay * (PIER.bents - 1) + 4.0 };
const STRINGERS = 8;
const strX = (k) => PIER_BOX.x0 + 0.6 + k * ((PIER_BOX.x1 - PIER_BOX.x0 - 1.2) / (STRINGERS - 1));
// A plank gone: the same rule here and in the shader (small whole numbers, exact in floats).
const plankGone = (i) => (i * 37 + 11) % 23 === 0 || (i * 13 + 5) % 31 === 0;
// The boat at anchor, and the anchor itself: the boat lies to its chain, bow toward it.
const BOAT = { x: 6.55, z: -7.2, len: 7.6, beam: 2.5 };
const ANCHOR = { x: 4.35, z: -24.5 };
const BOAT_F = (() => { const fx = ANCHOR.x - BOAT.x, fz = ANCHOR.z - BOAT.z, l = Math.hypot(fx, fz); return [fx / l, fz / l]; })();

// Light thrown back up by the sunlit sand: what lights the undersides of things in the
// shallows (the shared lighting has only the sky for them). up: metres above the sand;
// shade: how much of the sand below is in the pier's shade.
function sandBounce(s, f, up, shade) {
  const sand = sunAt(f.w.y.sub(up)).mul(0.36).mul(exp(SIG.mul(up).negate())).mul(float(1).sub(shade.mul(0.7)));
  const facing = max(s.n.y.negate(), 0.0).mul(0.75).add(float(1).sub(abs(s.n.y)).mul(0.3));
  return s.albedo.mul(sand).mul(facing).mul(s.ao.mul(0.5).add(0.5));
}
// How much of the sky the deck hides from a point under it, soft at its edges.
const underDeck = (w) => {
  const inX = smoothstep(PIER_BOX.x0 - 1.5, PIER_BOX.x0 + 2.0, w.x).mul(float(1).sub(smoothstep(PIER_BOX.x1 - 2.0, PIER_BOX.x1 + 1.5, w.x)));
  const inZ = smoothstep(PIER_BOX.z0 - 1.0, PIER_BOX.z0 + 2.5, w.z).mul(float(1).sub(smoothstep(PIER_BOX.z1 - 2.0, PIER_BOX.z1 + 1.5, w.z)));
  return inX.mul(inZ);
};

function buildPier(ctx, q, rng) {
  const m = new Mesh(true);
  const top = PIER.top, piles = [];
  for (let b = 0; b < PIER.bents; b++) {
    const z = PIER.zEnd + b * PIER.bay;
    for (let r = 0; r < PIER.rows.length; r++) {
      const x = PIER.x + PIER.rows[r] + rng.range(-0.08, 0.08), zz = z + rng.range(-0.07, 0.07);
      const g = groundY(x, zz), rad = rng.range(0.16, 0.19), lean = [rng.range(-0.018, 0.018), rng.range(-0.018, 0.018)];
      piles.push([x, zz, g, rad]);
      const pts = [], N = 13, y0 = g - 0.9;
      for (let k = 0; k <= N; k++) {
        const y = y0 + (top - y0) * (k / N), t = (y - g);
        pts.push([x + lean[0] * t, y, zz + lean[1] * t, rad * (1.07 - 0.07 * k / N)]);
      }
      const seed = rng() * 50;
      sweep(m, pts, 12, {
        radius: (k, j, ang) => 1 + 0.05 * noise3(Math.cos(ang) * 1.3 + seed, k * 0.45, Math.sin(ang) * 1.3) + 0.025 * Math.sin(ang * 3 + seed),
        aux: (k, j, px, py, pz, o) => { o[0] = j / 12; o[1] = py + seed * 7.3; o[2] = py - g; o[3] = 0; },
      });
      // mussels and barnacles clumped at the foot
      for (let c = 0; c < 5; c++) {
        const ang = rng() * TAU, hgt = rng.range(-0.05, 0.75) * rng(), rr = rng.range(0.07, 0.15);
        const cx = x + Math.cos(ang) * (rad + rr * 0.3), cz = zz + Math.sin(ang) * (rad + rr * 0.3);
        const s2 = rng() * 9, v0 = m.count;
        blob(m, cx, g + hgt, cz, (dx, dy, dz) => rr * (0.8 + 0.35 * noise3(dx * 3 + s2, dy * 3, dz * 3)) * (dy < 0 ? 0.7 : 1), 3);
        for (let v = v0; v < m.count; v++) { m.a[v * 4] = m.p[v * 3] * 3.1; m.a[v * 4 + 1] = m.p[v * 3 + 1] * 3.1; m.a[v * 4 + 2] = m.p[v * 3 + 1] - g; m.a[v * 4 + 3] = 1; }
      }
    }
  }
  // bracing: X in the outer bays of every other bent and along the outer rows, ties across
  // every bent (over the camera's way too) just under the water, walers along the rows
  const T = 0.085, W = 0.26;
  const pile = (b, r) => piles[b * PIER.rows.length + r];
  const hfn = (x, y, z) => y - groundY(x, z);
  const yTop = -0.42;
  let n = 0;
  for (let b = 0; b < PIER.bents; b++) {
    const A0 = pile(b, 0), A3 = pile(b, 3);
    const offT = Math.max(A0[3], A3[3]) + T * 0.5 + 0.015;
    beam(m, [A0[0] - 0.3, yTop, A0[1] + offT], [A3[0] + 0.3, yTop, A3[1] + offT + 0.02], W, T, [0, 0, 1], n++, hfn);
    if (b % 2) continue;
    for (const [r0, r1] of [[0, 1], [2, 3]]) {
      const A = pile(b, r0), B = pile(b, r1);
      const yb = Math.max(A[2], B[2]) + 0.8;
      const off = -(Math.max(A[3], B[3]) + T * 0.5 + 0.015);
      beam(m, [A[0], yTop - 0.15, A[1] + off], [B[0], yb, B[1] + off], W, T, [0, 0, 1], n++, hfn);
      beam(m, [A[0], yb, A[1] + off - T - 0.01], [B[0], yTop - 0.15, B[1] + off - T - 0.01], W, T, [0, 0, 1], n++, hfn);
    }
  }
  for (let b = 0; b < PIER.bents - 1; b++) {
    for (const r of [0, 3]) {
      const A = pile(b, r), B = pile(b + 1, r), side = r === 0 ? -1 : 1;
      const off = side * (Math.max(A[3], B[3]) + T * 0.5 + 0.015);
      const yb = Math.max(A[2], B[2]) + 1.0;
      if (b % 2 === 0) beam(m, [A[0] + off, yTop - 0.1, A[1]], [B[0] + off, yb, B[1]], W, T, [1, 0, 0], n++, hfn);
      else beam(m, [A[0] + off, yb, A[1]], [B[0] + off, yTop - 0.1, B[1]], W, T, [1, 0, 0], n++, hfn);
    }
    for (let r = 0; r < 4; r++) {
      const A = pile(b, r), B = pile(b + 1, r), side = r < 2 ? -1 : 1;
      const off = side * (Math.max(A[3], B[3]) + T * 1.5 + 0.03);
      beam(m, [A[0] + off, -0.62, A[1] - 0.3], [B[0] + off, -0.62, B[1] + 0.3], W * 1.1, T, [1, 0, 0], n++, hfn);
    }
  }
  const mat = material({
    aux: true,
    surface: (s, f) => {
      const lump = step(0.5, f.aux.w).toVar(), shade = underDeck(f.w).toVar();
      woodSurf(s, f, { shade });
      // the clumps at the foot: shells and barnacles all over
      const D = detail(f.w, f.n, 5.3, 4.0);
      s.albedo = mix(s.albedo, mix(vec3(0.05, 0.055, 0.075), vec3(0.55, 0.53, 0.46), smoothstep(0.45, 0.62, D.h)), lump);
      s.spec = mix(s.spec, float(0.2), lump);
      s.emis = sandBounce(s, f, max(f.aux.z, 0.2), shade);
    },
  });
  addMesh(ctx, sphereOf(m.build(), 0.5), mat, 110);

  // The deck, above the water: never seen directly (the surface hides it), but it throws its
  // shade on the sand and through the water. Planks across, a few gone; stringers; caps.
  const d = new Mesh(false), up = [0, 1, 0];
  for (let b = 0; b < PIER.bents; b++) {
    const z = PIER.zEnd + b * PIER.bay;
    beamPlain(d, [PIER_BOX.x0 + 0.3, (PIER.cap[0] + PIER.cap[1]) / 2, z], [PIER_BOX.x1 - 0.3, (PIER.cap[0] + PIER.cap[1]) / 2, z], 0.3, PIER.cap[1] - PIER.cap[0], up);
  }
  for (let k = 0; k < STRINGERS; k++) beamPlain(d, [strX(k), (PIER.str[0] + PIER.str[1]) / 2, PIER_BOX.z0], [strX(k), (PIER.str[0] + PIER.str[1]) / 2, PIER_BOX.z1], 0.1, PIER.str[1] - PIER.str[0], up);
  for (let i = 0, z = PIER_BOX.z0; z < PIER_BOX.z1; i++, z += PIER.pitch) {
    if (plankGone(i)) continue;
    beamPlain(d, [PIER_BOX.x0, PIER.plank + 0.025, z + 0.1], [PIER_BOX.x1, PIER.plank + 0.025, z + 0.1], 0.2, 0.05, up);
  }
  const deck = new ThreeMesh(sphereOf(d.build(), 0.5), material({ surface: (s) => { s.albedo = vec3(0.1, 0.08, 0.06); } }));
  deck.matrixAutoUpdate = false;
  deck.updateMatrixWorld(true);
  deck.visible = false;               // drawn only into the shadow map
  ctx.scene.add(deck);
  return { piles };
}
// A plain box beam (no aux), for what is only ever drawn into the shadow map.
function beamPlain(m, a, b, w, h, upv) {
  const save = m.a; m.a = null; beam(m, a, b, w, h, upv); m.a = save;
}

// What is above the water, seen from below through the window in the surface: the deck,
// its caps and stringers, the tops of the piles, the boat's topsides. A sheet just under
// the surface around the camera: each pixel follows its ray out through the wavy surface
// (the same waves the surface itself draws) and paints whatever the ray meets in the air,
// fading at the window's rim exactly as the sky does. Elsewhere it leaves the surface alone.
function buildWindow(ctx) {
  const SIZE = 18;
  const geo = new (Mesh)(false);
  geo.vert(-SIZE, 0, -SIZE, 0, -1, 0); geo.vert(SIZE, 0, -SIZE, 0, -1, 0); geo.vert(SIZE, 0, SIZE, 0, -1, 0); geo.vert(-SIZE, 0, SIZE, 0, -1, 0);
  geo.i.push(0, 1, 2, 0, 2, 3);
  const g = geo.build();
  g.boundingSphere = new Sphere(V(0, 0, 0), SIZE * 1.5);
  const [bfx, bfz] = BOAT_F;
  const mat = material({
    transparent: true, depthWrite: false, twoSided: true,
    raw: (f) => {
      const toP = f.w.sub(cameraPosition);
      const dist = length(toP);
      const v = toP.div(dist).toVar();
      // the surface's own slope, as sea.js reads it
      const fl = float(1).sub(smoothstep(60.0, 260.0, dist));
      const sl = texture(G.waterTex, f.w.xz.div(13.0)).ba.sub(0.5)
        .add(texture(G.waterTex, f.w.zx.div(4.7).add(0.2)).ba.sub(0.5).mul(0.7))
        .add(texture(G.waterTex, f.w.xz.div(37.0).add(0.6)).ba.sub(0.5).mul(0.8)).mul(fl.mul(2.0)).toVar();
      const n = normalize(vec3(sl.x.mul(-0.8), -1.0, sl.y.mul(-0.8))).toVar();
      const ci = clamp(dot(v, n.negate()), 0.0, 1.0);
      const k = float(1).sub(float(1.769).mul(float(1).sub(ci.mul(ci)))).toVar();
      const win = smoothstep(0.0, 0.22, k);
      const fres = pow(float(1).sub(sqrt(max(k, 0.0))), 5.0);
      const rd = refract(v, n, 1.333).toVar();
      const ry = max(rd.y, 0.03).toVar();
      const run = rd.xz.div(ry).toVar();                 // horizontal metres per metre of height
      const S = f.w.xz.toVar();
      const at = (h) => S.add(run.mul(h));
      // the planks' underside, with a gap between each and some planks gone
      const pd = at(PIER.plank).toVar();
      const inDeck = smoothstep(PIER_BOX.x0 - 0.02, PIER_BOX.x0 + 0.02, pd.x).mul(float(1).sub(smoothstep(PIER_BOX.x1 - 0.02, PIER_BOX.x1 + 0.02, pd.x)))
        .mul(smoothstep(PIER_BOX.z0 - 0.02, PIER_BOX.z0 + 0.02, pd.y)).mul(float(1).sub(smoothstep(PIER_BOX.z1 - 0.02, PIER_BOX.z1 + 0.02, pd.y))).toVar();
      const pz = pd.y.sub(PIER_BOX.z0).div(PIER.pitch).toVar();
      const idx = floor(pz);
      const fw = max(fwidth(pz), 0.002).toVar();
      const gz = fract(pz);
      const plank = smoothstep(0.0, fw.mul(1.5), gz).mul(float(1).sub(smoothstep(0.93 - 0.0, float(0.93).add(fw.mul(1.5)).min(1.0), gz))).toVar();
      const ra = idx.mul(37).add(11).mod(23), rb = idx.mul(13).add(5).mod(31);
      const gone = step(ra, 0.5).add(step(22.5, ra)).add(step(rb, 0.5)).add(step(30.5, rb)).min(1.0);
      const planks = inDeck.mul(mix(plank.mul(float(1).sub(gone)), float(0.86), smoothstep(0.12, 0.45, fw)));
      // the caps (across, at each bent) and the stringers (along): whatever the ray crosses
      // between their bottoms and tops
      const ca = at(PIER.cap[0]), cb = at(PIER.cap[1]);
      const zc = PIER.zEnd, bay = PIER.bay;
      const cz0 = min(ca.y, cb.y).sub(zc).div(bay), cz1 = max(ca.y, cb.y).sub(zc).div(bay);
      const capHit = step(floor(cz0.add(0.0375)), floor(cz1.add(0.0375)).sub(0.5)).add(step(fract(cz0.add(0.0375)), 0.075)).min(1.0)
        .mul(step(PIER_BOX.x0 + 0.3, ca.x)).mul(step(ca.x, PIER_BOX.x1 - 0.3)).mul(step(zc - 0.15, ca.y)).mul(step(ca.y, zc + bay * (PIER.bents - 1) + 0.15));
      const sa = at(PIER.str[0]), sb = at(PIER.str[1]);
      const sp = (PIER_BOX.x1 - PIER_BOX.x0 - 1.2) / (STRINGERS - 1), sx0 = PIER_BOX.x0 + 0.6;
      const k0 = min(sa.x, sb.x).sub(sx0).div(sp).add(0.024), k1 = max(sa.x, sb.x).sub(sx0).div(sp).add(0.024);
      const strHit = step(floor(k0), floor(k1).sub(0.5)).add(step(fract(k0), 0.048)).min(1.0)
        .mul(step(-0.5, k0)).mul(step(k1, STRINGERS - 0.5)).mul(step(PIER_BOX.z0, sa.y)).mul(step(sa.y, PIER_BOX.z1));
      // the piles' tops, between the water and the caps: the nearest pile to the ray's path
      const pa = S, pb = at(PIER.top);
      const pm = pa.add(pb).mul(0.5);
      const bi = clamp(floor(pm.y.sub(zc).div(bay).add(0.5)), 0.0, PIER.bents - 1).toVar();
      const pzc = bi.mul(bay).add(zc);
      const rowX = (r) => float(PIER.x + PIER.rows[r]);
      const segD = (cx) => {
        const c = vec2(cx, pzc), ab = pb.sub(pa);
        const t = clamp(dot(c.sub(pa), ab).div(max(dot(ab, ab), 1e-4)), 0.0, 1.0);
        return length(pa.add(ab.mul(t)).sub(c));
      };
      const dp = min(min(segD(rowX(0)), segD(rowX(1))), min(segD(rowX(2)), segD(rowX(3))));
      const pileHit = float(1).sub(smoothstep(0.15, 0.2, dp));
      // the boat's topsides: an ellipse round her waterline, from the water to her sheer
      const bc = vec2(BOAT.x, BOAT.z), bfw = vec2(bfx, bfz), bsd = vec2(bfz, -bfx);
      const toB = (p) => { const d = p.sub(bc); return vec2(dot(d, bsd).div(BOAT.beam * 0.5), dot(d, bfw).div(BOAT.len * 0.47)); };
      const ea = toB(S), eb = toB(at(0.75));
      const eab = eb.sub(ea);
      const et = clamp(dot(ea.negate(), eab).div(max(dot(eab, eab), 1e-5)), 0.0, 1.0);
      const boatHit = float(1).sub(smoothstep(0.96, 1.0, length(ea.add(eab.mul(et)))));
      // what the ray meets, nearest first: piles, caps, stringers, planks; the boat apart
      const wood = max(max(pileHit, capHit), max(strHit, planks)).toVar();
      const woodCol = mix(vec3(0.055, 0.05, 0.045), vec3(0.085, 0.075, 0.06), planks.mul(float(1).sub(max(capHit, strHit)))).mul(G.light.x);
      const boatCol = vec3(0.42, 0.45, 0.47).mul(G.light.x);
      const cover = max(wood, boatHit).toVar();
      const col = mix(woodCol, boatCol, boatHit.mul(float(1).sub(wood)));
      const refl = scatterFrom(float(0.0), float(1.0), reflect(v, n), float(300.0)).mul(1.15);
      return { color: vec3(inDeck, fract(pd.y.mul(0.25)), win), alpha: float(1.0) };
    },
  });
  const mesh = new ThreeMesh(g, mat);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.renderOrder = 2;
  ctx.scene.add(mesh);
  return {
    follow(cam) {
      const on = cam.position.z > -30 && cam.position.y > -14;
      mesh.visible = on;
      if (!on) return;
      mesh.position.set(cam.position.x, -0.012, cam.position.z);
      mesh.updateMatrix();
      mesh.updateMatrixWorld(true);
    },
  };
}

// The boat: a small sloop seen from below. Its frame: x to starboard, y up, z to the bow.
function buildBoat(ctx, rng) {
  const L = BOAT.len, B = BOAT.beam;
  // the hull's lines at a station t (0 transom, 1 stem): half-beam at the sheer, the sheer's
  // height, and how deep the canoe body is at the centre line
  const bTab = [[0, 0.84], [0.2, 0.97], [0.45, 1.0], [0.7, 0.9], [0.85, 0.64], [0.95, 0.32], [1, 0.0]];
  const dTab = [[0, -0.07], [0.15, -0.27], [0.4, -0.44], [0.6, -0.42], [0.8, -0.27], [0.92, -0.1], [1, 0.12]];
  const tab = (T, t) => { for (let i = 1; i < T.length; i++) if (t <= T[i][0]) { const a = T[i - 1], b = T[i], u = (t - a[0]) / (b[0] - a[0]); return a[1] + (b[1] - a[1]) * u * u * (3 - 2 * u); } return T[T.length - 1][1]; };
  const m = new Mesh(true);
  const sheer = (t) => 0.66 + 0.22 * t * t;
  const zOf = (t) => (t - 0.5) * L + (t > 0.9 ? (t - 0.9) * 2.2 : 0);
  // both sides of the hull, keel line to sheer
  for (const side of [-1, 1]) {
    m.grid(36, 14, (s, v, o) => {
      const t = s, hb = (B / 2) * tab(bTab, t), dk = tab(dTab, t), ys = sheer(t);
      const th = v * Math.PI / 2, e1 = 0.62 + 0.55 * t * t;
      const x = side * hb * Math.pow(Math.sin(th), e1);
      const y = dk + (ys - dk) * (1 - Math.pow(Math.cos(th), 1.25));
      o[0] = x; o[1] = y; o[2] = zOf(t);
      o[3] = t; o[4] = v; o[5] = 0; o[6] = 0;
    }, false, side > 0);
  }
  // the transom
  {
    const v0 = m.count, hb = (B / 2) * tab(bTab, 0), dk = tab(dTab, 0), ys = sheer(0);
    for (let k = 0; k <= 10; k++) {
      const th = (k / 10) * Math.PI / 2;
      const x = hb * Math.pow(Math.sin(th), 0.62), y = dk + (ys - dk) * (1 - Math.pow(Math.cos(th), 1.25));
      m.vert(x, y, -L / 2, 0, 0, -1, 0, 0, 0, 0, 0, 0); m.vert(-x, y, -L / 2, 0, 0, -1, 0, 0, 0, 0, 0, 0);
    }
    for (let k = 0; k < 10; k++) { const a = v0 + k * 2; m.i.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  }
  // keel and rudder: foils hung under the hull, the keel with a bulb at its tip
  const foil = (zc, chord0, chord1, y0, y1, sweepBack, thick, kind) => {
    const v0 = m.count, rows = 8, cols = 16;
    for (let r = 0; r <= rows; r++) {
      const u = r / rows, y = y0 + (y1 - y0) * u, ch = chord0 + (chord1 - chord0) * u, zl = zc - sweepBack * u;
      for (let c = 0; c <= cols; c++) {
        const a = (c / cols) * TAU, xc = 0.5 - 0.5 * Math.cos(a);
        const half = 5 * thick * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc ** 3 - 0.1036 * xc ** 4) * ch;
        m.vert(Math.sin(a) >= 0 ? half : -half, y, zl + ch * 0.3 - xc * ch, 0, 0, 0, 0, 0, 0.5, u, kind, 0);
      }
    }
    const w = cols + 1, i0 = m.i.length;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const a = v0 + r * w + c; m.i.push(a, a + w, a + 1, a + 1, a + w, a + w + 1); }
    m.normals(v0, m.count, i0, null);
  };
  foil(0.1, 1.05, 0.62, -0.3, -1.42, 0.32, 0.13, 1);
  foil(-L / 2 + 0.75, 0.46, 0.32, -0.12, -1.05, 0.12, 0.12, 2);
  // the bulb: a short torpedo under the keel's tip, blunt ahead and fining aft
  blob(m, 0, -1.47, -0.36, (x, y, z) => {
    const a = 0.12, b = 0.1, c = z > 0 ? 0.36 : 0.5;
    return 1 / Math.sqrt((x / a) ** 2 + (y / b) ** 2 + (z / c) ** 2);
  }, 5, (x, y, z, o) => { o[0] = 0.5; o[1] = 1; o[2] = 1; o[3] = 0; });
  const geo = m.build();
  // place her: bow toward the anchor. Her frame (x to port, y up, z to the bow) is right-handed.
  const fx = ANCHOR.x - BOAT.x, fz = ANCHOR.z - BOAT.z, fl = Math.hypot(fx, fz);
  const F = V(fx / fl, 0, fz / fl), P = V(F.z, 0, -F.x);
  const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal');
  for (let v = 0; v < pos.count; v++) {
    const x = pos.getX(v), y = pos.getY(v), z = pos.getZ(v);
    pos.setXYZ(v, BOAT.x + x * P.x + z * F.x, y, BOAT.z + x * P.z + z * F.z);
    const nx = nor.getX(v), ny = nor.getY(v), nz = nor.getZ(v);
    nor.setXYZ(v, nx * P.x + nz * F.x, ny, nx * P.z + nz * F.z);
  }
  sphereOf(geo, 0.4);
  const c = V(BOAT.x, -0.2, BOAT.z);
  const mat = material({
    aux: true,
    vertex: (v) => {
      if (v.shadow) return;
      // she rides the swell a little: heave, pitch and roll, slowly
      const t = G.time;
      const heave = sin(t.mul(0.83)).mul(0.035).add(sin(t.mul(1.31).add(1.0)).mul(0.015));
      const pitch = sin(t.mul(0.61).add(0.7)).mul(0.012), roll = sin(t.mul(0.47).add(2.1)).mul(0.02);
      const d = v.P.sub(vec3(c.x, c.y, c.z)).toVar();
      const fw = vec3(F.x, 0, F.z), sd = vec3(P.x, 0, P.z);
      // small rotations: about the starboard axis (pitch) and the fore-aft axis (roll)
      const lift = dot(d, fw).mul(pitch).add(dot(d, sd).mul(roll));
      v.P.assign(v.P.add(vec3(0, lift.add(heave), 0)).sub(fw.mul(d.y.mul(pitch))).sub(sd.mul(d.y.mul(roll))));
    },
    surface: (s, f) => {
      const t = f.aux.x, kind = f.aux.z, y = f.w.y.toVar();
      const near = float(1).sub(smoothstep(4.0, 20.0, f.dist)).toVar();
      const D = detail(f.w, s.n, 1.7, 2.0), E = detail(f.w, s.n, 5.0, 2.5);
      // antifouling below the waterline, a pale boot stripe at it, white topsides above
      const anti = vec3(0.30, 0.075, 0.06).mul(D.m.mul(0.25).add(0.85));
      const keelCol = vec3(0.07, 0.07, 0.08);
      const hullCol = select(kind.greaterThan(0.5), keelCol, anti).toVar();
      const boot = smoothstep(-0.07, -0.05, y).mul(float(1).sub(smoothstep(0.07, 0.09, y)));
      hullCol.assign(mix(hullCol, vec3(0.78, 0.76, 0.70), boot));
      hullCol.assign(mix(hullCol, vec3(0.86, 0.86, 0.84), smoothstep(0.08, 0.1, y)));
      // a little growth: a film of slime along the waterline and on the flat of the bottom, a few barnacles
      const slime = smoothstep(0.45, 0.8, D.h.mul(0.8).add(E.m.mul(0.4)).add(smoothstep(-0.5, -0.05, y).mul(0.35)).sub(0.15)).toVar();
      hullCol.assign(mix(hullCol, vec3(0.20, 0.22, 0.10), slime.mul(0.55).mul(float(1).sub(boot.mul(0.5)))));
      const barn = smoothstep(0.62, 0.7, E.h).mul(smoothstep(0.6, 0.9, D.m)).mul(near).toVar();
      hullCol.assign(mix(hullCol, vec3(0.55, 0.53, 0.47), barn));
      s.albedo = hullCol;
      s.n = normalize(s.n.add(E.n.sub(s.n).mul(near.mul(slime.mul(0.6).add(barn).add(0.08))))).toVar();
      s.spec = float(0.18).mul(float(1).sub(slime)); s.gloss = float(40.0);
      s.ao = float(1).sub(slime.mul(0.15));
      s.fluor = float(0.25);
      s.emis = sandBounce(s, f, f.w.y.add(6.6), float(0.0));
    },
  });
  addMesh(ctx, geo, mat, 120);
  // the bow roller, where the chain leaves her: on the stem, above the water
  const bowL = [0, 0.95, L / 2 + 0.2];
  return { bow: [BOAT.x + bowL[2] * F.x, 0.5, BOAT.z + bowL[2] * F.z], F, P };
}

// ---- the chain --------------------------------------------------------------------------------

// The rest shape: a catenary from the bow roller down to where it touches the sand, then a
// lazy S along the sand to the anchor's ring. Sampled at even lengths for chainAt.
function chainShape(bow, ring, along) {
  const ax = along[0], az = along[2];
  const lie = 3.4;            // metres of chain on the sand before the ring
  const T = [ring[0] - ax * lie, 0, ring[2] - az * lie];
  T[1] = groundY(T[0], T[2]) + 0.02;
  const L = Math.hypot(bow[0] - T[0], bow[2] - T[2]), H = bow[1] - T[1];
  let lo = 0.3, hi = 300;
  for (let i = 0; i < 60; i++) { const a = (lo + hi) / 2; if (a * (Math.cosh(L / a) - 1) > H) lo = a; else hi = a; }
  const a = (lo + hi) / 2, Sh = a * Math.sinh(L / a);
  const ux = (bow[0] - T[0]) / L, uz = (bow[2] - T[2]) / L;
  const N = 400, pts = [];
  // hanging part, from the bow (u = L) down to T (u = 0), at even arc length
  for (let i = 0; i <= N; i++) {
    const sigma = Sh * (1 - i / N);                  // arc length from T
    const u = a * Math.asinh(sigma / a);
    const x = T[0] + ux * u, z = T[2] + uz * u;
    const y = Math.max(T[1] + a * (Math.cosh(u / a) - 1), groundY(x, z) + 0.03);
    pts.push([x, y, z]);
  }
  // on the sand: a gentle S, at even steps (re-sampled below)
  const sx = -az, sz = ax, M = 120, ground = [];
  for (let i = 1; i <= M; i++) {
    const t = i / M, wob = Math.sin(t * Math.PI * 2) * (1 - t) * 0.28;
    const x = T[0] + (ring[0] - T[0]) * t + sx * wob, z = T[2] + (ring[2] - T[2]) * t + sz * wob;
    ground.push([x, groundY(x, z) + 0.035, z]);
  }
  const all = pts.concat(ground);
  // arc lengths
  const acc = [0];
  for (let i = 1; i < all.length; i++) acc.push(acc[i - 1] + Math.hypot(all[i][0] - all[i - 1][0], all[i][1] - all[i - 1][1], all[i][2] - all[i - 1][2]));
  return { all, acc, total: acc[acc.length - 1], hang: acc[N], plane: [ux, uz] };
}

// The sway, the same in JavaScript and in the shader: h is how far down the hanging part
// (0 at the bow, 1 where it meets the sand); returns side, along, up offsets in metres.
const swayJS = (h, t, out) => {
  const e = Math.sin(Math.PI * clampN(h, 0, 1));
  const lat = e * 0.24 * (0.7 * Math.sin(t * 0.55 - h * 2.2 + 0.5) + 0.3 * Math.sin(t * 0.93 - h * 4.1 + 2.0));
  const surge = Math.sin(t * 0.37 + 1.0);
  out[0] = lat; out[1] = e * 0.12 * surge; out[2] = e * 0.07 * Math.sin(t * 0.37 + 1.6);
  return out;
};
const swayTSL = (h, t) => {
  const e = sin(clamp(h, 0.0, 1.0).mul(Math.PI)).toVar();
  const lat = e.mul(0.24).mul(sin(t.mul(0.55).sub(h.mul(2.2)).add(0.5)).mul(0.7).add(sin(t.mul(0.93).sub(h.mul(4.1)).add(2.0)).mul(0.3)));
  return vec3(lat, e.mul(0.12).mul(sin(t.mul(0.37).add(1.0))), e.mul(0.07).mul(sin(t.mul(0.37).add(1.6))));
};

function buildChain(ctx, q, bow, ring, along) {
  const C = chainShape(bow, ring, along);
  const d = 0.02, r = d / 2, a = 0.85 * d, cR = 1.25 * d, pitch = 3.2 * d;
  // one link: a stadium-shaped ring in its own plane (x across, y along the chain)
  const m = new Mesh(true), line = [];
  const arcN = q.amount >= 0.5 ? 6 : 4;
  for (let i = 0; i <= arcN; i++) { const th = Math.PI * (i / arcN); line.push([Math.cos(th) * cR, a + Math.sin(th) * cR, 0, r]); }
  for (let i = 0; i <= arcN; i++) { const th = Math.PI + Math.PI * (i / arcN); line.push([Math.cos(th) * cR, -a + Math.sin(th) * cR, 0, r]); }
  sweep(m, line, q.amount >= 0.5 ? 6 : 4, { closed: true, up: [0, 0, 1], aux: (k, j, x, y, z, o) => { const c = line[k]; o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; o[3] = j; } });
  const link = m.build();
  // the links along the shape
  const count = Math.floor(C.total / pitch);
  const ca = new Float32Array(count * 4), cb = new Float32Array(count * 4), cc = new Float32Array(count * 4);
  let seg = 0;
  const at = (sig, out) => {
    while (seg < C.acc.length - 2 && C.acc[seg + 1] < sig) seg++;
    while (seg > 0 && C.acc[seg] > sig) seg--;
    const A = C.all[seg], B = C.all[seg + 1], u = (sig - C.acc[seg]) / Math.max(C.acc[seg + 1] - C.acc[seg], 1e-6);
    out[0] = lerp(A[0], B[0], u); out[1] = lerp(A[1], B[1], u); out[2] = lerp(A[2], B[2], u);
    const l = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]) || 1;
    out[3] = (B[0] - A[0]) / l; out[4] = (B[1] - A[1]) / l; out[5] = (B[2] - A[2]) / l;
    return out;
  };
  const o = [0, 0, 0, 0, 0, 0];
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (let i = 0; i < count; i++) {
    const sig = (i + 0.5) * pitch;
    at(sig, o);
    // the side: level and square to the chain (on the sand: links lie flat, then stand)
    let sx = -o[5], sz = o[3];
    const sl = Math.hypot(sx, sz) || 1; sx /= sl; sz /= sl;
    ca[i * 4] = o[0]; ca[i * 4 + 1] = o[1]; ca[i * 4 + 2] = o[2]; ca[i * 4 + 3] = sig / C.total;
    cb[i * 4] = o[3]; cb[i * 4 + 1] = o[4]; cb[i * 4 + 2] = o[5]; cb[i * 4 + 3] = i & 1;
    cc[i * 4] = sx; cc[i * 4 + 1] = 0; cc[i * 4 + 2] = sz; cc[i * 4 + 3] = Math.min(sig / C.hang, 1);
    x0 = Math.min(x0, o[0]); x1 = Math.max(x1, o[0]); y0 = Math.min(y0, o[1]); y1 = Math.max(y1, o[1]); z0 = Math.min(z0, o[2]); z1 = Math.max(z1, o[2]);
  }
  const geo = new InstancedBufferGeometry();
  geo.setIndex(link.index);
  for (const k of ['position', 'normal', 'aux']) geo.setAttribute(k, link.getAttribute(k));
  geo.setAttribute('ca', new InstancedBufferAttribute(ca, 4));
  geo.setAttribute('cb', new InstancedBufferAttribute(cb, 4));
  geo.setAttribute('cc', new InstancedBufferAttribute(cc, 4));
  geo.instanceCount = count;
  geo.boundingSphere = new Sphere(V((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 1);
  const [px, pz] = C.plane;          // the chain's plane: level, from the sand toward the bow
  const SIDE = vec3(-pz, 0, px), ALONG = vec3(px, 0, pz), UP = vec3(0, 1, 0);
  const A0 = attribute('ca', 'vec4'), B0 = attribute('cb', 'vec4'), C0 = attribute('cc', 'vec4');
  const mat = material({
    aux: true, shadow: false,
    vertex: (v) => {
      const h = C0.w, t = G.time;
      const sw = swayTSL(h, t), sw2 = swayTSL(min(h.add(0.01), 1.0), t);
      const off = SIDE.mul(sw.x).add(ALONG.mul(sw.y)).add(UP.mul(sw.z)).toVar();
      const off2 = SIDE.mul(sw2.x).add(ALONG.mul(sw2.y)).add(UP.mul(sw2.z));
      const Tn = normalize(B0.xyz.add(off2.sub(off).div(0.01 * C.hang))).toVar();
      const e0 = normalize(C0.xyz.sub(Tn.mul(dot(C0.xyz, Tn)))).toVar();
      const X = mix(e0, cross(Tn, e0), B0.w).toVar();
      const Z = cross(X, Tn).toVar();
      const centre = A0.xyz.add(off).toVar();
      // far away the wire thickens a little, so it never thins below a pixel and shimmers
      const fat = max(float(1.0), length(centre.sub(cameraPosition)).mul(0.0006 / r));
      const lp = v.aux.xyz.add(v.N.mul(r).mul(fat));
      v.P.assign(centre.add(X.mul(lp.x)).add(Tn.mul(lp.y)).add(Z.mul(lp.z)));
      v.N.assign(normalize(X.mul(v.N.x).add(Tn.mul(v.N.y)).add(Z.mul(v.N.z))));
      v.aux.assign(vec4(A0.w, h, B0.w, 0.0));
    },
    surface: (s, f) => rustSurf(s, f, f.aux.y.mul(0.6)),
  });
  addMesh(ctx, geo, mat, 100, { noShadow: true });
  // chainAt: the rest shape plus this frame's sway
  const sw = [0, 0, 0], sw2 = [0, 0, 0], tmp = [0, 0, 0, 0, 0, 0];
  let now = 0;
  const chainAt = (s, out) => {
    const sig = clampN(s, 0, 1) * C.total;
    at(sig, tmp);
    const h = Math.min(sig / C.hang, 1);
    swayJS(h, now, sw); swayJS(Math.min(h + 0.01, 1), now, sw2);
    const ox = -pz * sw[0] + px * sw[1], oy = sw[2], oz = px * sw[0] + pz * sw[1];
    const dx = -pz * sw2[0] + px * sw2[1] - ox, dy = sw2[2] - oy, dz = px * sw2[0] + pz * sw2[1] - oz;
    out[0] = tmp[0] + ox; out[1] = tmp[1] + oy; out[2] = tmp[2] + oz;
    let tx = tmp[3] + dx / (0.01 * C.hang), ty = tmp[4] + dy / (0.01 * C.hang), tz = tmp[5] + dz / (0.01 * C.hang);
    const l = Math.hypot(tx, ty, tz) || 1;
    out[3] = tx / l; out[4] = ty / l; out[5] = tz / l;
    return out;
  };
  return { chainAt, setTime: (t) => { now = t; }, total: C.total };
}

// A triangle wound so that it faces n.
function triFacing(m, a, b, c, nx, ny, nz) {
  const p = m.p;
  const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3], vy = p[c * 3 + 1] - p[a * 3 + 1], vz = p[c * 3 + 2] - p[a * 3 + 2];
  const d = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
  if (d >= 0) m.i.push(a, b, c); else m.i.push(a, c, b);
}
// A flat plate with some thickness: outline [[u, w], ...] in the plane of U and W around c,
// thickness along N = U x W.
function plate(m, c, U, W, outline, thick, aux = [0, 0, 0, 0]) {
  const N = [U[1] * W[2] - U[2] * W[1], U[2] * W[0] - U[0] * W[2], U[0] * W[1] - U[1] * W[0]];
  const nl = Math.hypot(N[0], N[1], N[2]); N[0] /= nl; N[1] /= nl; N[2] /= nl;
  const k = outline.length, v0 = m.count;
  for (const face of [1, -1]) for (const [u, w] of outline) {
    const x = c[0] + U[0] * u + W[0] * w + N[0] * thick * 0.5 * face, y = c[1] + U[1] * u + W[1] * w + N[1] * thick * 0.5 * face, z = c[2] + U[2] * u + W[2] * w + N[2] * thick * 0.5 * face;
    m.vert(x, y, z, N[0] * face, N[1] * face, N[2] * face, 0, 0, aux[0], aux[1], aux[2], aux[3]);
  }
  for (let i = 1; i < k - 1; i++) { triFacing(m, v0, v0 + i, v0 + i + 1, N[0], N[1], N[2]); triFacing(m, v0 + k, v0 + k + i, v0 + k + i + 1, -N[0], -N[1], -N[2]); }
  // the rim
  let cu = 0, cw = 0;
  for (const [u, w] of outline) { cu += u / k; cw += w / k; }
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k, mu = (outline[i][0] + outline[j][0]) / 2 - cu, mw = (outline[i][1] + outline[j][1]) / 2 - cw;
    const ox = U[0] * mu + W[0] * mw, oy = U[1] * mu + W[1] * mw, oz = U[2] * mu + W[2] * mw;
    const r0 = m.count;
    for (const [ii, f] of [[i, 1], [j, 1], [j, -1], [i, -1]]) {
      const b = v0 + (f > 0 ? 0 : k) + ii;
      m.vert(m.p[b * 3], m.p[b * 3 + 1], m.p[b * 3 + 2], ox, oy, oz, 0, 0, aux[0], aux[1], aux[2], aux[3]);
    }
    triFacing(m, r0, r0 + 1, r0 + 2, ox, oy, oz); triFacing(m, r0, r0 + 2, r0 + 3, ox, oy, oz);
  }
  return v0;
}

// The anchor: a fisherman's anchor, its stock flat on the sand, one fluke dug in, the other
// up in the water. Built in its own frame (shank along y from the crown, arms in the xy
// plane, stock along z), then laid down with its shank toward the boat. Returns the point
// on its ring where the chain is shackled.
function buildAnchor(ctx, crownXZ, along) {
  const m = new Mesh(true);
  const shank = 1.55, ringY = shank + 0.14, stockY = shank - 0.16;
  const S = (pts, sides) => sweep(m, pts, sides, { aux: (k, j, x, y, z, o) => { o[0] = x; o[1] = y; } });
  S([[0, -0.03, 0, 0.072], [0, 0.4, 0, 0.062], [0, 1.0, 0, 0.053], [0, shank + 0.02, 0, 0.046]], 8);
  for (const sx of [-1, 1]) {
    const th1 = 1.12, R = 0.62, pts = [];
    for (let i = 0; i <= 6; i++) { const th = (i / 6) * th1; pts.push([sx * Math.sin(th) * R, R - Math.cos(th) * R, 0, 0.064 - i * 0.004]); }
    S(pts, 8);
    // the palm: a spade across the arms' plane, its broad face toward the shank
    const tx = sx * Math.sin(th1) * R, ty = R - Math.cos(th1) * R, dx = sx * Math.cos(th1), dy = Math.sin(th1);
    plate(m, [tx - dx * 0.03, ty - dy * 0.03, 0], [dx, dy, 0], [0, 0, 1], [[-0.2, 0], [-0.07, 0.15], [0.13, 0.12], [0.22, 0], [0.13, -0.12], [-0.07, -0.15]], 0.035, [tx, ty, 0, 0]);
    S([[tx + dx * 0.16, ty + dy * 0.16, 0, 0.032], [tx + dx * 0.31, ty + dy * 0.31, 0, 0.01]], 6);
  }
  // the stock, square to the arms, a ball at each end
  S([[0, stockY, -0.8, 0.038], [0, stockY, -0.3, 0.05], [0, stockY, 0.3, 0.05], [0, stockY, 0.8, 0.038]], 8);
  for (const z of [-0.82, 0.82]) blob(m, 0, stockY, z, () => 0.068, 3, (x, y, zz, o) => { o[0] = x; o[1] = y + 3; });
  // the ring, in the plane of the shank and the stock
  const ringPts = [];
  for (let i = 0; i < 14; i++) { const th = (i / 14) * TAU; ringPts.push([0, ringY + Math.sin(th) * 0.12, Math.cos(th) * 0.12, 0.022]); }
  sweep(m, ringPts, 6, { closed: true, up: [1, 0, 0], aux: (k, j, x, y, z, o) => { o[0] = z; o[1] = y; } });
  const geo = m.build();
  // laid down: shank level toward the boat and tilted up by the stock resting on the sand,
  // the arms upright (local x up), the stock level (local z). (F, up, side) keeps it right-handed.
  const fx = -along[0], fz = -along[2], sx = fz, sz = -fx;
  const cx = crownXZ[0], cz = crownXZ[1], cy = groundY(cx, cz) - 0.06;
  const stockAt = [cx + fx * stockY, cz + fz * stockY];
  const tilt = Math.asin(clampN((groundY(stockAt[0], stockAt[1]) + 0.035 - cy) / stockY, -0.3, 0.3));
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const pos = geo.getAttribute('position'), nor = geo.getAttribute('normal');
  const toWorld = (x, y, z, out) => {
    const a = y * ct - x * st, u = x * ct + y * st;
    out[0] = cx + fx * a + sx * z; out[1] = cy + u; out[2] = cz + fz * a + sz * z;
    return out;
  };
  const w = [0, 0, 0];
  for (let v = 0; v < pos.count; v++) {
    toWorld(pos.getX(v), pos.getY(v), pos.getZ(v), w);
    pos.setXYZ(v, w[0], w[1], w[2]);
    const nx = nor.getX(v), ny = nor.getY(v), nz = nor.getZ(v);
    const a = ny * ct - nx * st, u = nx * ct + ny * st;
    nor.setXYZ(v, fx * a + sx * nz, u, fz * a + sz * nz);
  }
  sphereOf(geo, 0.2);
  const mat = material({ aux: true, surface: (s, f) => rustSurf(s, f, float(0.35)) });
  addMesh(ctx, geo, mat, 90);
  return toWorld(0, ringY + 0.09, 0, [0, 0, 0]);
}

function buildMarina(ctx, q) {
  const rng = makeRng(5150);
  buildPier(ctx, q, rng);
  const win = buildWindow(ctx);
  const boat = buildBoat(ctx, rng);
  const fx = BOAT.x - ANCHOR.x, fz = BOAT.z - ANCHOR.z, fl = Math.hypot(fx, fz);
  const along = [-fx / fl, 0, -fz / fl];       // from the boat toward the anchor
  const ring = buildAnchor(ctx, [ANCHOR.x, ANCHOR.z], along);
  const chain = buildChain(ctx, q, boat.bow, ring, along);
  return { chain, win };
}

// ---- all of it ----------------------------------------------------------------------------------

export function buildSets(ctx) {
  const t0 = performance.now();
  const { q } = ctx;
  const marina = buildMarina(ctx, q);
  const clam = { position: V(5.6, -32.6, -177.5), normal: V(-0.5, 0.5, 0.7).normalize() };
  const geode = { position: V(-4.4, -206.6, -389.4), normal: V(0, 0.15, 1).normalize(), size: 1.2 };
  if (typeof DEV !== 'undefined' && DEV) console.log('sets ' + Math.round(performance.now() - t0) + ' ms');
  return {
    update(t) {
      marina.chain.setTime(t);
      marina.win.follow(ctx.camera);
    },
    chainAt: marina.chain.chainAt,
    clam, geode,
  };
}
