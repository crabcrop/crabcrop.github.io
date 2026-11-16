// The creatures, crocheted, and what drifts in the water: little stitched fish in the
// marina, the shallows, the kelp and on the reef; a sea turtle gliding over the reef; the
// pink octopus with the letter at the wreck; glowing jellies, a siphonophore and an
// anglerfish in the twilight; tube worms and sea sheep at the vents; the turtle and the
// octopus again below the surface at the end; specks and bubbles everywhere.
//
// Nothing is simulated. Each creature is a closed-form function of the time and of its
// own handful of numbers, worked out in its vertex shader. A group of fish goes round a
// small loop where the camera will look; each fish keeps its own place in it, wanders a
// little, now and then darts out and eases back, faces the way it goes (where it was a
// moment ago is worked out too, and the difference is its heading) and wags its tail. The
// bigger creatures (the turtle, the octopus, the anglerfish) are placed each frame from a
// few numbers worked out here, and move their own parts in their shaders: flippers beat,
// tentacles curl. Tentacles, cords and coils are built in the shader round a centreline.
//
// Everything wears the shared yarn (shaders.js), laid in each creature's own frame so the
// stitches stay on it as it turns, with rows running round a fish from nose to tail as an
// amigurumi is worked. Small things are kept from sparkling: a fish too small on screen
// dissolves into the water behind it, and a speck is never drawn narrower than about a
// pixel: below that it is drawn that wide and dimmer, so it carries the same light.
import {
  BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, InstancedInterleavedBuffer, InterleavedBufferAttribute, Mesh as ThreeMesh, Sphere, Vector3, Vector4,
} from 'three/webgpu';
import {
  abs, atan, attribute, cameraPosition, clamp, cos, cross, dot, exp, float, floor, fract, fwidth, int, length, max, min, mix, normalize,
  pow, select, sign, sin, smoothstep, sqrt, step, texture, uniform, uniformArray, varyingProperty, vec2, vec3, vec4,
} from 'three/tsl';
import { centerX, floorY, groundY, offTrack, pathAt } from './layout.js';
import { Mesh, TAU, blob, lerp, makeRng, smooth, tube } from './math.js';
import { G, SIG, material, scatter, skyAt, sunAt, sunFoot, yarn } from './shaders.js';

// Set every frame: how many metres one pixel spans one metre from the eye, and the eye's
// right and up, for what is drawn as a card that faces it.
const U = { pix: uniform(0.002), right: uniform(new Vector3(1, 0, 0)), up: uniform(new Vector3(0, 1, 0)) };
const UP = vec3(0.0, 1.0, 0.0);
const one = (x, k) => float(1.0).sub(step(0.5, abs(x.sub(k))));      // 1 where x is k

// ---- yarn on a creature ----------------------------------------------------------------------

// yarn() reads its stitches along the three axes of `p` and weighs them by the normal. On
// a creature that turns, both must be in the creature's own frame: knit() hands yarn() the
// normal in that frame (A, B, C: where the frame's axes point in the world, for p's x, y,
// z; rows are stacked along B), turns the stitched normal back, and adds the wool's halo
// with it (as yarn() does).
function knit(s, f, o) {
  const [A, B, C] = o.frame, n = s.n;
  s.n = vec3(dot(n, A), dot(n, B), dot(n, C));
  const r = yarn(s, f, { ...o, fuzz: 0 });
  const m = s.n;
  s.n = normalize(A.mul(m.x).add(B.mul(m.y)).add(C.mul(m.z))).toVar();
  const graze = pow(float(1.0).sub(abs(dot(s.n, normalize(cameraPosition.sub(f.w))))), 3.0);
  s.emis = s.emis.add(sunAt(f.w.y).mul(0.06).add(G.amb.mul(0.14)).mul(graze).mul(s.albedo).mul(o.fuzz ?? 1.0));
  return r;
}
// A glass bead (the eyes): black, glossy, smooth.
function bead(s, nSmooth, k) {
  s.albedo = mix(s.albedo, vec3(0.012, 0.012, 0.016), k);
  s.n = normalize(mix(s.n, nSmooth, k));
  s.spec = mix(s.spec, float(1.2), k); s.gloss = mix(s.gloss, float(80.0), k);
  s.trans = mix(s.trans, float(0.0), k); s.fluor = mix(s.fluor, float(0.0), k);
}

// ---- light on a speck ------------------------------------------------------------------------

// What lights a thing too small to have a side: the sun as it comes down through the
// caustics' net, the lamp, the glows. (These run per vertex, where a texture is read at a
// level chosen here; the lamp and the glows are as shadeLit has them.)
function causticAt(w) {
  const q = sunFoot(w);
  const lod = min(max(w.y.negate(), 0.0).mul(0.16), 6.0);
  const a = texture(G.waterTex, q.div(4.3)).level(lod).r;
  const b = texture(G.waterTex, q.yx.div(9.1).add(0.37)).level(lod).r;
  return min(a.mul(b.mul(1.5).add(0.5)), 1.6);
}
function lampAt(w) {
  const toL0 = G.lampPos.sub(w);
  const dl = length(toL0);
  const cone = smoothstep(G.lampCol.w, mix(G.lampCol.w, 1.0, 0.75), dot(toL0.div(dl).negate(), G.lampDir));
  return G.lampCol.rgb.mul(cone).mul(exp(SIG.mul(dl).negate())).div(dl.mul(dl).mul(0.012).add(1.0));
}
function glowsAt(w) {
  let sum = vec3(0.0);
  for (let i = 0; i < 4; i++) {
    const gp = G.glowPos.element(i);
    const f = max(float(1.0).sub(length(gp.xyz.sub(w)).div(gp.w)), 0.0);
    sum = sum.add(G.glowCol.element(i).rgb.mul(f.mul(f)));
  }
  return sum;
}

// ---- building shapes -------------------------------------------------------------------------

// Many cards, one per copy: a square from -1 to 1 that the vertex step turns to the eye.
function cards(n, attrs, sphere) {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  for (const [name, data] of Object.entries(attrs)) g.setAttribute(name, data.isBufferAttribute || data.isInterleavedBufferAttribute ? data : new InstancedBufferAttribute(data, 4));
  g.instanceCount = n;
  g.boundingSphere = sphere;
  return g;
}
// Copies of a base shape, with per-copy numbers.
function copies(base, n, attrs, sphere) {
  const g = new InstancedBufferGeometry();
  g.setIndex(base.index);
  for (const k of ['position', 'normal', 'aux']) if (base.getAttribute(k)) g.setAttribute(k, base.getAttribute(k));
  for (const [name, data] of Object.entries(attrs)) g.setAttribute(name, data.isBufferAttribute || data.isInterleavedBufferAttribute ? data : new InstancedBufferAttribute(data, 4));
  g.instanceCount = n;
  g.boundingSphere = sphere;
  return g;
}
const solid = (geo, mat) => { const m = new ThreeMesh(geo, mat); m.matrixAutoUpdate = false; m.userData.fauna = true; return m; };
// A sphere round boxes [x0, x1, y0, y1, z0, z1].
function sphereOf(boxes) {
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const b of boxes) { x0 = Math.min(x0, b[0]); x1 = Math.max(x1, b[1]); y0 = Math.min(y0, b[2]); y1 = Math.max(y1, b[3]); z0 = Math.min(z0, b[4]); z1 = Math.max(z1, b[5]); }
  return new Sphere(new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 0.5);
}
// Make the triangles added since i0 face the way out(x, y, z) says is out (and their normals).
function orient(m, i0, base, out) {
  const p = m.p;
  let sum = 0;
  for (let k = i0; k < m.i.length; k += 3) {
    const a = m.i[k] * 3, b = m.i[k + 1] * 3, c = m.i[k + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
    const o = out((p[a] + p[b] + p[c]) / 3, (p[a + 1] + p[b + 1] + p[c + 1]) / 3, (p[a + 2] + p[b + 2] + p[c + 2]) / 3);
    sum += (uy * vz - uz * vy) * o[0] + (uz * vx - ux * vz) * o[1] + (ux * vy - uy * vx) * o[2];
  }
  if (sum >= 0) return;
  for (let k = i0; k < m.i.length; k += 3) { const t = m.i[k + 1]; m.i[k + 1] = m.i[k + 2]; m.i[k + 2] = t; }
  for (let v = base * 3; v < m.count * 3; v++) m.n[v] = -m.n[v];
}
// A crocheted fin: flat but puffed, thickest in the middle and meeting itself at the edge.
// f(s, t, o) gives the point on its middle (o[0..2]) and how thick it is there (o[3]); it
// puffs along `dir`. aux = (x, y, z of that point, part).
function pillow(m, cols, rows, dir, part, f) {
  const o = [0, 0, 0, 0];
  for (const sg of [1, -1]) {
    const i0 = m.i.length, base = m.count;
    m.grid(cols, rows, (s, t, out) => {
      f(s, t, o);
      out[0] = o[0] + dir[0] * o[3] * sg; out[1] = o[1] + dir[1] * o[3] * sg; out[2] = o[2] + dir[2] * o[3] * sg;
      out[3] = o[0]; out[4] = o[1]; out[5] = o[2]; out[6] = part;
    });
    orient(m, i0, base, () => [dir[0] * sg, dir[1] * sg, dir[2] * sg]);
  }
}
// A bead, a ball, an egg: a blob with aux (centre, part).
function ball(m, x, y, z, rx, ry, rz, res, part) {
  blob(m, x, y, z, (dx, dy, dz) => 1 / Math.hypot(dx / rx, dy / ry, dz / rz), res, (dx, dy, dz, o) => { o[0] = x; o[1] = y; o[2] = z; o[3] = part; });
}
// A box (the letter): centre, half sizes, tilted about z. aux = (x, y, z in its own frame, part).
function box(m, cx, cy, cz, hx, hy, hz, tilt, part) {
  const c = Math.cos(tilt), s = Math.sin(tilt);
  const P = (x, y, z) => [cx + x * c - y * s, cy + x * s + y * c, cz + z];
  for (const [nx, ny, nz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const ax = ny || nz ? [1, 0, 0] : [0, 1, 0], bx = [ny * ax[2] - nz * ax[1], nz * ax[0] - nx * ax[2], nx * ax[1] - ny * ax[0]], vs = [];
    const n = [nx * c - ny * s, nx * s + ny * c, nz];
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const lx = (nx + ax[0] * u + bx[0] * v) * hx, ly = (ny + ax[1] * u + bx[1] * v) * hy, lz = (nz + ax[2] * u + bx[2] * v) * hz;
      const q = P(lx, ly, lz);
      vs.push(m.vert(q[0], q[1], q[2], n[0], n[1], n[2], 0, 0, lx, ly, lz, part));
    }
    m.tri(vs[0], vs[1], vs[2]); m.tri(vs[0], vs[2], vs[3]);
    orient(m, m.i.length - 6, m.count, () => n);
  }
}
// The rings of tubes the vertex shader builds round a centreline: n tubes of `rings` rings,
// `sides` round. aux = (along 0..1, round 0..1, which tube, tag(tube)).
function tubes(m, n, rings, sides, tag) {
  for (let k = 0; k < n; k++) {
    const base = m.count, g = tag(k);
    for (let r = 0; r <= rings; r++) for (let j = 0; j <= sides; j++) m.vert(0, 0, 0, 0, 1, 0, 0, 0, r / rings, j / sides, k, g);
    for (let r = 0; r < rings; r++) for (let j = 0; j < sides; j++) {
      const a = base + r * (sides + 1) + j;
      m.quad(a, a + 1, a + sides + 2, a + sides + 1);
    }
  }
}
// A ring of a tube: the centre C, the tangent T, a side S0 (made square to T), the angle
// round and the radius. Gives the point, its normal and the ring's two axes.
function ringAt(C, T, S0, phi, r) {
  const S = normalize(S0.sub(T.mul(dot(S0, T)))).toVar();
  const B = cross(T, S).toVar();
  const n = S.mul(cos(phi)).add(B.mul(sin(phi))).toVar();
  return { p: C.add(n.mul(r)), n, S, B };
}

// ---- where the camera looks ------------------------------------------------------------------

const DEG = Math.PI / 180, _o = [0, 0, 0, 0, 0];
// The camera at p: where it is, its level forward and right, its pitch.
function view(p) {
  pathAt(p, _o);
  const yaw = _o[3] * DEG;
  return { x: _o[0], y: _o[1], z: _o[2], fx: Math.sin(yaw), fz: -Math.cos(yaw), rx: Math.cos(yaw), rz: Math.sin(yaw), pitch: _o[4] };
}
// A place in front of the camera at p: `ahead` along its level forward, `side` to its right,
// `up` above it. (Into `out`, a Vector3, so it can run every frame.)
function aheadTo(out, p, ahead, side, up) {
  pathAt(p, _o);
  const yaw = _o[3] * DEG, s = Math.sin(yaw), c = Math.cos(yaw);
  return out.set(_o[0] + s * ahead + c * side, _o[1] + up, _o[2] - c * ahead + s * side);
}
const inView = (p, ahead, side, up) => aheadTo(new Vector3(), p, ahead, side, up).toArray();

// ---- fish ------------------------------------------------------------------------------------

// Each kind is grown one metre long, nose at x = 0.5, tail tip at -0.5, back up, its right
// side +z: a plump body of round rings, a tail, a fin along the back and one under the
// belly, a pair at the sides, two bead eyes. aux = (x, y, how high round the body from -1
// belly to 1 back, part: 0 body, 1 tail, 2 back and belly fins, 3 side fins, 4 eyes, 5 spikes).
//   h, w     half the height and width where it is deepest, `at` where that is (0 the nose,
//            1 the root of the tail); nose: how blunt (smaller is blunter); end: where the
//            body ends; ped: the root of the tail; tail: [half span, how deep the notch]
//   dorsal, anal: [from x, to x, height]; pect: [x, length, width]; eye: [x, y, radius]
const FISH = {
  round: { h: 0.24, w: 0.2, at: 0.36, nose: 0.4, end: -0.18, ped: 0.06, tail: [0.25, 0.3], dorsal: [0.12, -0.12, 0.13], anal: [-0.02, -0.14, 0.06], pect: [0.14, 0.17, 0.1], eye: [0.31, 0.08, 0.068], fin: 0.035 },
  tang: { h: 0.38, w: 0.12, at: 0.45, nose: 0.75, end: -0.2, ped: 0.07, tail: [0.22, 0.12], dorsal: [0.24, -0.18, 0.09], anal: [0.1, -0.18, 0.09], pect: [0.12, 0.17, 0.1], eye: [0.28, 0.12, 0.062], fin: 0.03, keel: 0.2 },
  long: { h: 0.17, w: 0.14, at: 0.34, nose: 0.5, end: -0.24, ped: 0.05, tail: [0.2, 0.45], dorsal: [0.16, -0.16, 0.08], anal: [0.0, -0.17, 0.05], pect: [0.18, 0.13, 0.07], eye: [0.37, 0.05, 0.055], fin: 0.03 },
  puffer: { h: 0.3, w: 0.29, at: 0.5, nose: 0.36, end: -0.14, ped: 0.07, tail: [0.2, 0.0], dorsal: [0.0, -0.12, 0.09], anal: null, pect: [0.1, 0.15, 0.11], eye: [0.28, 0.11, 0.07], fin: 0.035, spikes: 36 },
};

function fishShape(sp, lod) {
  const nr = [8, 10, 12][lod], ns = [8, 10, 12][lod], m = new Mesh(true), rng = makeRng(7);
  const p = sp.nose, q = (p * (1 - sp.at)) / sp.at, peak = Math.pow(sp.at, p) * Math.pow(1 - sp.at, q), E = sp.end;
  const prof = (u) => {
    const b = (Math.pow(u, p) * Math.pow(1 - u, q)) / peak, k = u * u * u;
    return [sp.h * b + sp.ped * k, sp.w * b + sp.ped * 0.7 * k, 0.05 * sp.h * Math.sin(Math.PI * u)];
  };
  const xAt = (u) => 0.5 - u * (0.5 - E), uAt = (x) => Math.min(Math.max((0.5 - x) / (0.5 - E), 0), 1);
  // the body: rings from the nose back (closer together at both ends), closed behind the root of the tail
  const i0 = m.i.length, base = m.count;
  m.grid(nr, ns, (s, t, o) => {
    const r = Math.round(t * ns), last = r === ns, u = last ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * r) / (ns - 1));
    const [a0, b0, yc] = prof(u), a = last ? 0 : a0, b = last ? 0 : b0, x = last ? xAt(1) - 0.03 : xAt(u);
    const ph = s * TAU - Math.PI / 2, sn = Math.sin(ph), cs = Math.cos(ph);
    o[0] = x; o[1] = yc + a * sn; o[2] = b * cs * (1 - (sp.keel ?? 0) * Math.pow(Math.abs(sn), 3)); o[3] = x; o[4] = o[1]; o[5] = sn; o[6] = 0;
  }, true);
  orient(m, i0, base, (x, y, z) => [0, y - prof(uAt(x))[2], z]);
  const th = sp.fin, yE = prof(1)[2];
  // the tail: a fan from the root, a notch in its edge
  pillow(m, lod ? 6 : 4, lod ? 3 : 2, [0, 0, 1], 1, (s, t, o) => {
    const v = s * 2 - 1, span = lerp(sp.ped * 0.85, sp.tail[0], Math.pow(t, 0.6));
    o[0] = lerp(E + 0.05, -0.5 + sp.tail[1] * 0.12 * (1 - Math.abs(v)), t); o[1] = yE + v * span; o[2] = 0;
    o[3] = th * Math.sqrt(Math.max(1 - v * v, 0)) * (1 - Math.pow(t, 3) * 0.85);
  });
  // along the back and under the belly
  for (const [fin, dir] of [[sp.dorsal, 1], [sp.anal, -1]]) {
    if (!fin) continue;
    pillow(m, 5, 2, [0, 0, 1], 2, (s, t, o) => {
      const xb = lerp(fin[0], fin[1], s), [a, , yc] = prof(uAt(xb)), hgt = fin[2] * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.75)), 0.8);
      o[0] = xb - t * hgt * 0.4; o[1] = yc + dir * (a * 0.82 + t * hgt); o[2] = 0;
      o[3] = th * 0.85 * Math.sqrt(Math.max(4 * s * (1 - s), 0)) * (1 - Math.pow(t, 3) * 0.85);
    });
  }
  // a little paddle at each side, behind the eye
  {
    const [px, pl, pw] = sp.pect, [a, b, yc] = prof(uAt(px));
    for (const side of [1, -1]) {
      const d = [-0.8, -0.15, side * 0.58], nn = [-d[2], 0, d[0]], ln = Math.hypot(...nn);
      pillow(m, 3, 3, [nn[0] / ln, nn[1] / ln, nn[2] / ln], 3, (s, t, o) => {
        const w = pw * Math.sqrt(Math.max(1 - Math.pow(t * 1.05 - 0.05, 2), 0)) * (1 - 0.3 * t);
        o[0] = px + d[0] * t * pl; o[1] = yc - a * 0.2 + d[1] * t * pl + (s - 0.5) * w; o[2] = side * b * 0.85 + d[2] * t * pl;
        o[3] = th * 0.8 * Math.sqrt(Math.max(4 * s * (1 - s), 0)) * (1 - t * t * 0.8);
      });
    }
  }
  // spikes (the puffer)
  for (let k = 0; k < (sp.spikes ?? 0); k++) {
    const u = rng.range(0.12, 0.85), ph = rng() * TAU, [a, b, yc] = prof(u), x = xAt(u);
    const y = yc + a * Math.sin(ph), z = b * Math.cos(ph), nx = 0.15, ny = Math.sin(ph) / a, nz = Math.cos(ph) / b, l = Math.hypot(nx, ny, nz);
    const len = 0.06 + 0.03 * rng(), dx = nx / l, dy = ny / l, dz = nz / l;
    tube(m, [[x - dx * 0.01, y - dy * 0.01, z - dz * 0.01, 0.022], [x + dx * len, y + dy * len, z + dz * len, 0.004]], 4, [0, 0, 5]);
  }
  // the eyes: black beads, half sunk
  const [ex, ey, er] = sp.eye, eb = prof(uAt(ex))[1];
  for (const side of [1, -1]) ball(m, ex, ey, side * eb * 0.8, er, er, er, 3, 4);
  return m.build();
}

// Per fish (each four numbers):
//   fA  its group's centre (x, y, z), and how fast the group goes round its loop (radians a second)
//   fB  the loop's two radii, its turn about the vertical (which also seeds its wobble), how far it rises and falls
//   fC  the fish's place: how far along the loop (radians), out from it, up from it (metres); its length
//   fD  its seed, tail wags a second, seconds between darts, its pattern (0 plain, 1 a head of
//       the second colour, 2 stripes, 3 a belly of the second colour)
//   fE, fF, fG   its body, second and fin colours (and the stripes' rows in fE.w)
const fA = attribute('fA', 'vec4'), fB = attribute('fB', 'vec4'), fC = attribute('fC', 'vec4'), fD = attribute('fD', 'vec4');
const fE = attribute('fE', 'vec4'), fF = attribute('fF', 'vec4'), fG = attribute('fG', 'vec4');
const vC1 = varyingProperty('vec4', 'v_fc1'), vC2 = varyingProperty('vec4', 'v_fc2'), vC3 = varyingProperty('vec4', 'v_fc3'), vInfo = varyingProperty('vec4', 'v_finfo');
const vFwd = varyingProperty('vec3', 'v_ffwd'), vUp = varyingProperty('vec3', 'v_fup'), vLoc = varyingProperty('vec3', 'v_floc');

// Where a fish is at time t.
function fishAt(t) {
  const th = fA.w.mul(t).add(fC.x).toVar();
  const yaw = fB.z, cy = cos(yaw), sy = sin(yaw);
  const lobe = th.mul(3.0).add(yaw.mul(5.0));
  const r = sin(lobe).mul(0.16).add(1.0), dr = cos(lobe).mul(0.48);
  const ct = cos(th), st = sin(th);
  const ex = fB.x.mul(r).mul(ct), ez = fB.y.mul(r).mul(st);
  const tx = fB.x.mul(dr.mul(ct).sub(r.mul(st))), tz = fB.y.mul(dr.mul(st).add(r.mul(ct)));
  const centre = fA.xyz.add(vec3(ex.mul(cy).sub(ez.mul(sy)), fB.w.mul(sin(th.mul(2.0).add(yaw.mul(3.0)))), ex.mul(sy).add(ez.mul(cy))));
  const T = normalize(vec3(tx.mul(cy).sub(tz.mul(sy)), 0.0, tx.mul(sy).add(tz.mul(cy)))).mul(sign(fA.w));
  const out = vec3(ct.mul(cy).sub(st.mul(sy)), 0.0, ct.mul(sy).add(st.mul(cy)));
  const s = fD.x, L = fC.w;
  // its place in the group breathes a little; it bobs and wanders about it
  const side = fC.y.mul(sin(t.mul(0.21).add(s.mul(6.28))).mul(0.22).add(1.0));
  const up = fC.z.mul(sin(t.mul(0.17).add(s.mul(9.1))).mul(0.25).add(1.0));
  const wob = vec3(sin(t.mul(0.53).add(s.mul(40.0))), sin(t.mul(0.9).add(s.mul(23.0))).mul(0.6), cos(t.mul(0.47).add(s.mul(31.0)))).mul(L.mul(0.5));
  // now and then (in some of its cycles, not all) it darts ahead and to a side, and eases back
  const cyc = t.div(fD.z).add(s.mul(13.0));
  const k = fract(cyc), hh = fract(sin(floor(cyc).mul(91.7).add(s.mul(437.1))).mul(4375.5));
  const bump = smoothstep(0.0, 0.1, k).mul(float(1.0).sub(smoothstep(0.1, 0.65, k))).mul(step(0.45, hh));
  const dart = T.mul(0.8).add(out.mul(hh.sub(0.72).mul(3.0))).mul(bump.mul(L).mul(1.1));
  return centre.add(out.mul(side)).add(vec3(0.0, up, 0.0)).add(wob).add(dart);
}

function fishMaterial() {
  return material({
    aux: true, shadow: false,
    vertex: (v) => {
      const t = G.time, s = fD.x, L = fC.w;
      const P0 = fishAt(t).toVar('fishP');
      const d = P0.sub(fishAt(t.sub(0.1))).toVar();
      // it faces the way it goes, never steeper than about 30 degrees
      const hl = length(d.xz).add(1e-5);
      const F = normalize(vec3(d.x, clamp(d.y, hl.mul(-0.55), hl.mul(0.55)), d.z)).toVar();
      const R = normalize(cross(F, UP)).toVar();
      const Up = cross(R, F).toVar();
      // it wags: the head barely, the tail most, faster for a moment when it darts
      const lp = v.P.toVar(), ln = v.N.toVar();
      const u = clamp(float(0.45).sub(lp.x), 0.0, 1.0).toVar();
      const cyc = t.div(fD.z).add(s.mul(13.0));
      const beats = t.mul(fD.y).add(floor(cyc).add(smoothstep(0.0, 0.1, fract(cyc))).mul(1.2));
      const ph = beats.mul(TAU).add(s.mul(40.0)).sub(u.mul(2.4)).toVar();
      const amp = u.mul(u).mul(0.16).add(0.008);
      const sw = sin(ph), cw = cos(ph);
      const slope = u.mul(0.32).mul(sw).sub(amp.mul(2.4).mul(cw)).negate();
      const lq = vec3(lp.x, lp.y, lp.z.add(amp.mul(sw)));
      const nq = vec3(ln.x.sub(slope.mul(ln.z)), ln.y, ln.z);
      v.P.assign(P0.add(F.mul(lq.x).add(Up.mul(lq.y)).add(R.mul(lq.z)).mul(L)));
      v.N.assign(normalize(F.mul(nq.x).add(Up.mul(nq.y)).add(R.mul(nq.z))));
      // too small on screen, or near the edge of what is drawn: it dissolves into the water behind it
      const dc = length(P0.sub(cameraPosition));
      const keep = smoothstep(2.2, 5.0, L.div(dc.mul(U.pix))).mul(float(1.0).sub(smoothstep(44.0, 60.0, dc)));
      vC1.assign(fE); vC2.assign(fF); vC3.assign(fG);
      vInfo.assign(vec4(L, fD.w, s, keep));
      vFwd.assign(F); vUp.assign(Up);
      // the stitches' own place: rows run round the body, stacked from nose to tail
      vLoc.assign(vec3(lp.y, lp.x, lp.z).mul(L).add(s.mul(3.1)));
    },
    surface: (s, f) => {
      const lx = f.aux.x, yn = f.aux.z, part = f.aux.w;
      const pattern = vInfo.y, keep = vInfo.w;
      const body = float(1.0).sub(step(0.5, part)).toVar(), eye = one(part, 4);
      const n0 = s.n;
      // the body's colour, its second colour by pattern, the fins' colour
      const A = vC1.rgb, B = vC2.rgb;
      const second = one(pattern, 1).mul(smoothstep(0.14, 0.18, lx)).add(one(pattern, 3).mul(float(1.0).sub(smoothstep(-0.3, -0.12, yn)))).mul(body);
      const col = mix(mix(A, B, second), vC3.rgb, float(1.0).sub(body));
      const stripes = one(pattern, 2).mul(body);
      const F = normalize(vFwd), Up = normalize(vUp);
      knit(s, f, { color: col, color2: mix(col, B, stripes), stripe: max(vC1.w, 1.0), scale: 40, p: vLoc, frame: [Up, F, cross(F, Up)], k: 1.0 });
      bead(s, n0, eye);
      // dissolving: what would be seen through the fish is the water beyond it
      const vv = normalize(f.w.sub(cameraPosition));
      const beyond = scatter(vv, float(300.0)).sub(scatter(vv, f.dist)).mul(exp(SIG.mul(f.dist)));
      s.albedo = s.albedo.mul(keep); s.spec = s.spec.mul(keep);
      s.emis = s.emis.mul(keep).add(beyond.mul(keep.oneMinus()));
    },
  });
}

// Colours, warm and saturated as the pictures have them.
const COL = {
  yellow: [0.98, 0.78, 0.12], orange: [0.98, 0.5, 0.14], coral: [0.96, 0.44, 0.38], pink: [0.95, 0.56, 0.62],
  cream: [0.95, 0.88, 0.74], sand: [0.88, 0.76, 0.58], teal: [0.1, 0.6, 0.62], aqua: [0.36, 0.78, 0.8], blue: [0.24, 0.42, 0.82],
  mint: [0.55, 0.85, 0.66], grey: [0.55, 0.58, 0.62],
};
// The fish a group may have: [shape, pattern, body, second, fins].
const KINDS = {
  pastel: [['round', 1, 'blue', 'yellow', 'yellow'], ['round', 2, 'cream', 'blue', 'yellow'], ['round', 1, 'pink', 'yellow', 'yellow'], ['round', 3, 'aqua', 'cream', 'coral'], ['round', 2, 'grey', 'coral', 'coral'], ['long', 2, 'mint', 'cream', 'orange'], ['round', 0, 'coral', 'coral', 'yellow']],
  reefY: [['tang', 0, 'yellow', 'yellow', 'yellow']],
  reefT: [['round', 0, 'teal', 'teal', 'teal'], ['round', 3, 'teal', 'aqua', 'teal']],
  striped: [['long', 2, 'teal', 'cream', 'teal'], ['long', 2, 'cream', 'teal', 'teal']],
  puffer: [['puffer', 3, 'orange', 'sand', 'sand']],
  kelp: [['round', 1, 'orange', 'yellow', 'yellow'], ['long', 2, 'yellow', 'orange', 'orange'], ['round', 3, 'coral', 'cream', 'yellow']],
};

// The groups, each where the camera looks at p: `ahead` and `side` (metres, along its level
// forward and to its right) and `up`; how many (on high), which kinds, the loop's radii, its
// turn, how far it rises and falls, seconds a lap (negative: the other way round), the fish's
// length, how far they spread (along the loop, out, up), tail wags a second, seconds between darts.
function groups() {
  const S = (mesh, p, ahead, side, up, n, kinds, r, yaw, h, period, size, spread, wag = 1.6, dart = 9) => ({ mesh, p, ahead, side, up, n, kinds, r, yaw, h, period, size, spread, wag, dart });
  const small = [0.38, 0.5], spread = [1.2, 0.5, 0.3], r = [1.1, 0.9];
  return [
    // the marina, round the posts and under the boats
    S('marina', 0.12, 6, -1.6, -1.5, 6, 'pastel', r, 0.3, 0.15, 24, small, spread),
    S('marina', 0.32, 6, 1.8, -1.3, 6, 'pastel', r, -0.4, 0.15, -22, small, spread),
    S('marina', 0.55, 5.5, -2.0, -0.4, 6, 'pastel', r, 0.6, 0.15, 25, small, spread),
    S('marina', 0.8, 5.5, 2.0, 0.1, 6, 'pastel', r, -0.2, 0.15, -23, small, spread),
    // the shallows: over the sand, against the bright water
    S('shallows', 1.36, 5.5, -2.2, 0.4, 7, 'pastel', r, 0.2, 0.2, 26, small, spread),
    S('shallows', 1.5, 6, 2.3, 0.5, 6, 'pastel', r, -0.3, 0.2, -24, small, spread),
    S('shallows', 1.64, 5.5, -2.0, 0.3, 7, 'pastel', r, 0.6, 0.2, 25, small, spread),
    S('shallows', 1.78, 6, 2.4, 0.6, 6, 'pastel', r, -0.6, 0.2, -23, small, spread),
    S('shallows', 1.92, 5.5, -2.2, 0.4, 7, 'pastel', r, 0.1, 0.2, 27, small, spread),
    // the kelp: a few at a time, between the stalks
    S('kelp', 2.38, 6, 1.6, 1.1, 5, 'kelp', [0.8, 0.6], 0.1, 0.2, 26, small, spread, 1.4),
    S('kelp', 2.54, 6, -1.6, 1.3, 5, 'kelp', [0.8, 0.6], 0.7, 0.2, -24, small, spread, 1.4),
    S('kelp', 2.7, 6, 1.6, 1.2, 5, 'kelp', [0.8, 0.6], -0.5, 0.2, 22, small, spread, 1.4),
    S('kelp', 2.88, 6, -1.6, 0.9, 5, 'kelp', [0.8, 0.6], 0.3, 0.2, -25, small, spread, 1.4),
    // the reef: yellow ones, teal ones, striped ones, a puffer
    S('reef', 3.34, 5.5, 2.0, 0.4, 5, 'reefY', r, 0.2, 0.2, 22, [0.42, 0.52], spread, 1.5),
    S('reef', 3.46, 5.5, -2.2, 0.2, 4, 'reefT', r, -0.6, 0.2, -20, small, spread, 1.7),
    S('reef', 3.58, 5.5, 2.2, 0.5, 5, 'reefY', r, 0.9, 0.2, 21, [0.42, 0.52], spread, 1.5),
    S('reef', 3.7, 5, -1.9, 0.1, 1, 'puffer', [0.9, 0.7], 0.0, 0.15, -30, [0.55, 0.55], [0, 0, 0], 1.2, 0),
    S('reef2', 3.8, 5.5, -2.2, 0.4, 4, 'striped', r, 0.4, 0.2, 23, [0.44, 0.52], spread, 1.5),
    S('reef2', 3.9, 5.5, 2.2, 0.5, 5, 'reefY', r, -0.2, 0.2, -21, [0.42, 0.52], spread, 1.5),
    S('reef2', 4.0, 6, -1.8, 0.3, 4, 'reefT', r, 0.3, 0.2, 20, small, spread, 1.7),
    // the end: just below the surface again
    S('surface', 7.95, 7, -2.4, -1.6, 6, 'pastel', r, 0.0, 0.15, 26, small, spread),
    S('surface', 7.95, 8.5, 2.6, -2.0, 5, 'pastel', r, 0.5, 0.15, -24, small, spread),
  ];
}

// Every fish's numbers, by mesh and shape.
function populate(rng, amt) {
  const meshes = new Map();
  for (const g of groups()) {
    const n = g.n === 1 ? 1 : Math.max(3, Math.round(g.n * Math.sqrt(amt)));
    let at = inView(g.p, g.ahead, g.side, g.up);
    // keep the loop clear of the camera's way: step away from it until it is
    const R = Math.max(g.r[0], g.r[1]) + g.spread[1] * 0.5 + 1.3;
    for (let k = 0; k < 16 && offTrack(at[0], at[2], at[1]) < R; k++) at = inView(g.p, g.ahead, g.side * (1 + 0.08 * (k + 1)), g.up);
    const w = TAU / g.period, phase = rng() * TAU, Rm = Math.max((g.r[0] + g.r[1]) / 2, 0.5);
    for (let i = 0; i < n; i++) {
      const [shape, pattern, body, second, fins] = rng.pick(KINDS[g.kinds]);
      const key = g.mesh + '/' + shape;
      let m = meshes.get(key);
      if (!m) meshes.set(key, (m = { shape, fish: [] }));
      const L = lerp(g.size[0], g.size[1], rng()) * (shape === 'long' ? 1.15 : 1), k = rng.range(0.92, 1.06);
      const c = (name) => COL[name].map((x) => Math.min(x * k, 1));
      m.fish.push({
        A: [at[0], at[1], at[2], w], B: [g.r[0], g.r[1], g.yaw, g.h],
        C: [phase + (rng.bell() * g.spread[0]) / Rm, rng.bell() * g.spread[1], rng.bell() * g.spread[2], L],
        D: [rng(), g.wag * rng.range(0.85, 1.15), g.dart ? g.dart * rng.range(0.7, 1.4) : 1e5, pattern],
        E: [...c(body), 2 + Math.floor(rng() * 2)], F: [...c(second), 0], G: [...c(fins), 0],
      });
    }
  }
  return meshes;
}

// (the seven numbers-of-four of each fish share one buffer: WebGPU allows only eight vertex buffers to a draw)
function fishMesh(geo, fish, mat) {
  const n = fish.length, attrs = {}, boxes = [], buf = new InstancedInterleavedBuffer(new Float32Array(n * 28), 28, 1);
  ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach((key, j) => {
    for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) buf.array[i * 28 + j * 4 + c] = fish[i][key][c];
    attrs['f' + key] = new InterleavedBufferAttribute(buf, 4, j * 4);
  });
  for (const f of fish) {
    const L = f.C[3], out = Math.max(f.B[0], f.B[1]) * 1.16 + Math.abs(f.C[1]) * 1.25 + L * 3 + 0.3, up = f.B[3] + Math.abs(f.C[2]) * 1.3 + L * 2 + 0.3;
    boxes.push([f.A[0] - out, f.A[0] + out, f.A[1] - up, f.A[1] + up, f.A[2] - out, f.A[2] + out]);
  }
  return solid(copies(geo, n, attrs, sphereOf(boxes)), mat);
}

// ---- the creatures placed each frame ------------------------------------------------------

// Each has a slot here: three numbers-of-four, set every frame (where it is and how big;
// which way it heads and its own phase; which way is up and its colouring). The turtle over
// the reef, the turtle at the end, the octopus at the wreck, the octopus at the end, the anglerfish.
const SLOTS = 5;
const POSE = uniformArray(Array.from({ length: SLOTS * 3 }, () => new Vector4(0, -1000, 0, 0)), 'vec4');
const cS = attribute('cS', 'vec4');             // per copy: its slot, its seed, its colouring
const vA = varyingProperty('vec3', 'v_ca'), vB = varyingProperty('vec3', 'v_cb'), vP = varyingProperty('vec3', 'v_cp'), vK = varyingProperty('vec4', 'v_ck');

// Place a point and a normal of the creature in its slot, from its own frame.
function placed(lp, ln) {
  const i = int(cS.x).mul(3);
  const A = POSE.element(i), B = POSE.element(i.add(1)), Cc = POSE.element(i.add(2));
  const F = B.xyz, Up = Cc.xyz, R = cross(F, Up);
  return { P: A.xyz.add(F.mul(lp.x).add(Up.mul(lp.y)).add(R.mul(lp.z)).mul(A.w)), N: normalize(F.mul(ln.x).add(Up.mul(ln.y)).add(R.mul(ln.z))), F, Up, R, size: A.w, phase: B.w, look: Cc.w };
}
// Turn a direction from the creature's own frame into the world.
const toWorld = (pl, d) => pl.F.mul(d.x).add(pl.Up.mul(d.y)).add(pl.R.mul(d.z));
// Turn a point about an axis (x, y or z of the creature's frame) through `at` by angle a.
function turn(p, at, axis, a) {
  const d = p.sub(at), c = cos(a), s = sin(a);
  if (axis === 'x') return at.add(vec3(d.x, d.y.mul(c).sub(d.z.mul(s)), d.y.mul(s).add(d.z.mul(c))));
  if (axis === 'y') return at.add(vec3(d.x.mul(c).add(d.z.mul(s)), d.y, d.z.mul(c).sub(d.x.mul(s))));
  return at.add(vec3(d.x.mul(c).sub(d.y.mul(s)), d.x.mul(s).add(d.y.mul(c)), d.z));
}
const turnN = (n, axis, a) => turn(n, vec3(0.0), axis, a);

// The turtle: a domed shell over a flat belly, a head on a short neck, long front flippers
// and short back ones, a stub of a tail. About a metre long. aux.w: 0 shell, 1 skin, 2 front
// flippers, 3 back flippers, 4 eyes.
function turtleShape(lod) {
  const m = new Mesh(true), res = [6, 8, 10][lod];
  blob(m, 0, 0, 0, (dx, dy, dz) => 1 / Math.hypot(dx / 0.42, dy / (dy > 0 ? 0.2 : 0.075), dz / 0.34), res, (dx, dy, dz, o) => { o[3] = 0; });
  ball(m, 0.47, 0.035, 0, 0.14, 0.105, 0.1, Math.max(res - 3, 4), 1);
  tube(m, [[0.3, 0.0, 0, 0.075], [0.37, 0.015, 0, 0.07], [0.42, 0.03, 0, 0.068]], 8, [0, 0, 1]);
  tube(m, [[-0.38, -0.02, 0, 0.045], [-0.47, -0.035, 0, 0.025], [-0.52, -0.04, 0, 0.008]], 6, [0, 0, 1]);
  for (const side of [1, -1]) ball(m, 0.545, 0.075, side * 0.07, 0.024, 0.024, 0.024, 2, 4);
  // flippers: long and swept back in front, small behind
  for (const side of [1, -1]) {
    pillow(m, 4, lod ? 7 : 5, [0, 1, 0], 2, (s, t, o) => {
      const w = 0.17 * (1 - Math.pow(t, 1.4)) + 0.025;
      o[0] = 0.24 - 0.32 * Math.pow(t, 1.3) + (0.5 - s) * w; o[1] = -0.03 - 0.03 * t; o[2] = side * (0.25 + 0.52 * t);
      o[3] = 0.032 * (1 - t * t * 0.7) * Math.sqrt(Math.max(4 * s * (1 - s), 0));
    });
    pillow(m, 3, 3, [0, 1, 0], 3, (s, t, o) => {
      const w = 0.11 * (1 - Math.pow(t, 1.5)) + 0.02;
      o[0] = -0.3 - 0.14 * t + (0.5 - s) * w; o[1] = -0.045; o[2] = side * (0.17 + 0.17 * t);
      o[3] = 0.026 * (1 - t * t * 0.7) * Math.sqrt(Math.max(4 * s * (1 - s), 0));
    });
  }
  return m.build();
}

// The shell's plates (their centres, seen from above: a row down the middle and four a
// side), and round the rim a ring cut into short plates: where they meet, a pale seam.
const PLATES = [[0.27, 0], [0.13, 0], [0, 0], [-0.13, 0], [-0.26, 0], [0.2, 0.15], [0.07, 0.17], [-0.07, 0.17], [-0.2, 0.15], [0.2, -0.15], [0.07, -0.17], [-0.07, -0.17], [-0.2, -0.15]];
function shellSeam(lp, aa) {
  let d1 = float(9.0), d2 = float(9.0);
  for (const [x, z] of PLATES) {
    const d = length(vec2(lp.x.sub(x), lp.z.sub(z)));
    d2 = min(d2, max(d1, d));
    d1 = min(d1, d);
  }
  const rim = length(vec2(lp.x.div(0.42), lp.z.div(0.34))).toVar();
  const inner = float(1.0).sub(smoothstep(0.012, aa.add(0.014), d2.sub(d1))).mul(step(rim, 0.8));
  const ring = float(1.0).sub(smoothstep(0.03, fwidth(rim).add(0.034), abs(rim.sub(0.8))));
  const k = atan(lp.z.div(0.34), lp.x.div(0.42)).mul(22.0 / TAU);
  const cut = float(1.0).sub(smoothstep(0.06, fwidth(k).add(0.07), abs(fract(k).sub(0.5)).oneMinus().sub(0.5))).mul(step(0.8, rim));
  // (thin lines: seen from far, where a pixel would be wider than they are, they fade into the shell)
  return max(max(inner, ring), cut).mul(smoothstep(0.0, 0.03, lp.y)).mul(float(1.0).sub(smoothstep(0.012, 0.03, aa)));
}

function turtleMaterial() {
  const FRONT = [0.24, -0.03, 0.25], BACK = [-0.3, -0.045, 0.17], NECK = vec3(0.3, 0.0, 0.0);
  return material({
    aux: true, shadow: false,
    vertex: (v) => {
      const t = G.time, lp = v.P.toVar(), ln = v.N.toVar(), part = v.aux.w;
      const pl0 = placed(vec3(0.0), vec3(1.0, 0.0, 0.0));
      const w = t.mul(TAU * 0.3).add(pl0.phase).toVar();
      const side = sign(lp.z).toVar();
      // the front flippers beat slowly, up and down; the back ones paddle; the head nods
      const af = side.mul(sin(w).mul(0.5).add(0.12)), ab = side.mul(sin(w.sub(1.3)).mul(0.22));
      const ah = sin(w.mul(0.5).add(0.7)).mul(0.06);
      const pf = turn(lp, vec3(FRONT[0], FRONT[1], side.mul(FRONT[2])), 'x', af), nf = turnN(ln, 'x', af);
      const pb = turn(lp, vec3(BACK[0], BACK[1], side.mul(BACK[2])), 'x', ab), nb = turnN(ln, 'x', ab);
      const head = step(0.31, lp.x).mul(one(part, 1).add(one(part, 4)));
      const ph = turn(lp, NECK, 'z', ah), nh = turnN(ln, 'z', ah);
      const front = one(part, 2).greaterThan(0.5), back = one(part, 3).greaterThan(0.5), isHead = head.greaterThan(0.5);
      const q = select(front, pf, select(back, pb, select(isHead, ph, lp)));
      const qn = select(front, nf, select(back, nb, select(isHead, nh, ln)));
      const pl = placed(q, qn);
      v.P.assign(pl.P); v.N.assign(pl.N);
      vA.assign(pl.F); vB.assign(pl.Up); vP.assign(lp.mul(pl.size));
      vK.assign(vec4(cS.z, 0.0, 0.0, 0.0));
    },
    surface: (s, f) => {
      const part = f.aux.w, lp = f.obj, look = vK.x;
      const n0 = s.n, F = normalize(vA), Up = normalize(vB), R = cross(F, Up);
      const shell = one(part, 0), eye = one(part, 4);
      // the reef's turtle is brown with cream seams; the one at the end, coral with teal skin
      const shellCol = mix(vec3(0.55, 0.3, 0.2), vec3(0.72, 0.25, 0.1), look), seamCol = mix(vec3(0.9, 0.8, 0.62), vec3(0.98, 0.8, 0.55), look);
      const skinCol = mix(vec3(0.86, 0.76, 0.58), vec3(0.22, 0.62, 0.6), look), bellyCol = mix(vec3(0.93, 0.83, 0.55), vec3(0.98, 0.82, 0.5), look);
      const under = shell.mul(float(1.0).sub(smoothstep(-0.02, 0.01, lp.y)));
      const spots = smoothstep(0.35, 0.65, sin(lp.x.mul(53.0).add(lp.z.mul(17.0))).mul(sin(lp.z.mul(47.0).sub(lp.x.mul(13.0))))).mul(float(1.0).sub(shell)).mul(float(1.0).sub(eye));
      const skin = mix(skinCol, skinCol.mul(mix(vec3(0.55, 0.4, 0.3), vec3(0.6, 0.8, 0.75), look)), spots);
      const st = knit(s, f, { color: mix(skin, mix(shellCol, bellyCol, under), shell), scale: 26, p: vP, frame: [F, Up, R], k: 1.3 });
      const aa = fwidth(lp.x).add(fwidth(lp.z)).add(1e-4);
      const seam = shellSeam(lp, aa).mul(shell).mul(float(1.0).sub(under));
      s.albedo = mix(s.albedo, seamCol.mul(st.h.mul(0.4).add(0.6)), seam);
      bead(s, n0, eye);
    },
  });
}

// The octopus: a round head, bead eyes, a stitched smile; eight chunky tentacles that curl,
// the front two holding the letter up. About 0.7 high before it is sized. aux.w: 0 head,
// 2 tentacles (built in the shader: aux = along, round, which), 4 eyes, 5 the letter.
function octopusShape(lod) {
  const m = new Mesh(true), res = [7, 9, 11][lod];
  blob(m, 0, 0.4, 0, (dx, dy, dz) => 1 / Math.hypot(dx / 0.26, dy / (dy < 0 ? 0.25 : 0.28), dz / 0.26), res, (dx, dy, dz, o) => { o[3] = 0; });
  for (const side of [1, -1]) ball(m, 0.245, 0.375, side * 0.1, 0.04, 0.04, 0.04, 3, 4);
  box(m, 0.36, 0.165, 0, 0.008, 0.095, 0.15, 0.12, 5);
  tubes(m, 8, [10, 14, 18][lod], [6, 7, 8][lod], () => 2);
  return m.build();
}
// A tentacle at s: in the upright plane of its direction out from the body, bending at a
// steady rate from its starting angle psi0, so it is an arc that curls.
function curl(s, a, psi0, kap, len, base) {
  const ps = psi0.add(kap.mul(s));
  return base.add(vec3(cos(a), 0.0, sin(a)).mul(sin(ps).sub(sin(psi0)).div(kap).mul(len))).add(vec3(0.0, cos(psi0).sub(cos(ps)).div(kap).mul(len), 0.0));
}
function octopusMaterial() {
  return material({
    aux: true, shadow: false,
    vertex: (v) => {
      const t = G.time, lp = v.P.toVar(), ln = v.N.toVar(), part = v.aux.w;
      const pl0 = placed(vec3(0.0), vec3(1.0, 0.0, 0.0));
      const s = v.aux.x, phi = v.aux.y.mul(TAU), k = v.aux.z;
      const a = k.add(0.5).mul(TAU / 8).toVar();
      const hold = step(6.5, k).add(step(k, 0.5));
      const wave = sin(t.mul(1.05).add(k.mul(1.7)).add(pl0.phase)).toVar();
      const psi0 = mix(wave.mul(0.12).sub(1.0), wave.mul(0.04).sub(0.5), hold);
      const kap = mix(wave.mul(0.55).add(3.5), wave.mul(0.1).add(1.6), hold);
      const len = mix(float(0.44), float(0.34), hold);
      const base = vec3(cos(a).mul(0.12), 0.16, sin(a).mul(0.12));
      const C0 = curl(s, a, psi0, kap, len, base).toVar(), T = normalize(curl(s.add(0.02), a, psi0, kap, len, base).sub(C0)).toVar();
      const r = float(0.07).mul(float(1.0).sub(s.mul(0.5))).mul(sqrt(min(float(1.0).sub(s).mul(12.0), 1.0)));
      const rg = ringAt(C0, T, vec3(sin(a).negate(), 0.0, cos(a)), phi, r);
      // the head breathes
      const breathe = sin(t.mul(1.3).add(pl0.phase)).mul(0.025);
      const head = vec3(lp.x.mul(float(1.0).sub(breathe)), lp.y.sub(0.4).mul(breathe.add(1.0)).add(0.4), lp.z.mul(float(1.0).sub(breathe)));
      const isT = one(part, 2).greaterThan(0.5);
      const pl = placed(select(isT, rg.p, select(one(part, 0).greaterThan(0.5), head, lp)), select(isT, rg.n, ln));
      v.P.assign(pl.P); v.N.assign(pl.N);
      // the stitches: on the head in the octopus's frame; on a tentacle, along it as if it were straight
      vA.assign(select(isT, toWorld(pl, rg.S), pl.F));
      vB.assign(select(isT, toWorld(pl, T), pl.Up));
      vP.assign(select(isT, vec3(cos(phi).mul(0.06), s.mul(len), sin(phi).mul(-0.06)).add(k.mul(1.3)), lp).mul(pl.size));
    },
    surface: (s, f) => {
      const part = f.aux.w, lp = f.obj, n0 = s.n;
      const A = normalize(vA), B = normalize(vB);
      const eye = one(part, 4), paper = one(part, 5);
      knit(s, f, { color: vec3(0.84, 0.5, 0.66), scale: 30, p: vP, frame: [A, B, cross(A, B)], k: 1.4 });
      // the smile: a short dark arc of stitches under the eyes
      const aa = fwidth(lp.y).add(fwidth(lp.z)).add(1e-4);
      const smile = float(1.0).sub(smoothstep(0.009, aa.add(0.009), abs(lp.y.sub(lp.z.mul(lp.z).mul(3.2).add(0.3))))).mul(step(abs(lp.z), 0.055)).mul(step(0.15, lp.x)).mul(one(part, 0));
      s.albedo = mix(s.albedo, vec3(0.06, 0.03, 0.04), smile);
      bead(s, n0, eye);
      // the letter: paper, its flap folded down to a red wax seal
      const ly = f.aux.y, lz = f.aux.z, front = step(0.0, f.aux.x);
      const flap = float(1.0).sub(smoothstep(0.003, aa.add(0.004), abs(ly.sub(float(0.1).sub(float(0.09).mul(float(1.0).sub(abs(lz).div(0.15)))))))).mul(front);
      const seal = float(1.0).sub(smoothstep(0.018, aa.add(0.02), length(vec2(ly.sub(0.01), lz)))).mul(front);
      const pcol = mix(mix(vec3(0.95, 0.92, 0.85), vec3(0.62, 0.57, 0.5), flap), vec3(0.72, 0.08, 0.08), seal);
      s.albedo = mix(s.albedo, pcol, paper); s.n = normalize(mix(s.n, n0, paper));
      s.spec = mix(s.spec, mix(float(0.12), float(0.5), seal), paper); s.gloss = mix(s.gloss, float(30.0), paper);
      s.trans = mix(s.trans, float(0.1), paper); s.fluor = mix(s.fluor, float(0.0), paper);
    },
  });
}

// The anglerfish: a round purple body, a big mouth of white teeth, bead eyes, pink fins and
// tail, and the lure on its stalk. aux.w: 0 body, 1 fins, 3 stalk, 4 eyes, 6 the lure.
const LURE = [0.45, 0.27, 0];
function anglerShape(lod) {
  const m = new Mesh(true), res = [6, 8, 10][lod];
  ball(m, 0, 0, 0, 0.26, 0.22, 0.2, res, 0);
  for (const side of [1, -1]) {
    ball(m, 0.17, 0.08, side * 0.135, 0.034, 0.034, 0.034, 2, 4);
    pillow(m, 4, 3, [0, 0.35, side], 1, (s, t, o) => {
      const w = 0.2 * Math.sqrt(Math.max(1 - Math.pow(t - 0.1, 2), 0));
      o[0] = -0.02 - 0.16 * t; o[1] = -0.02 + (s - 0.5) * w + 0.04 * t; o[2] = side * (0.17 + 0.12 * t);
      o[3] = 0.02 * Math.sqrt(Math.max(4 * s * (1 - s), 0)) * (1 - t * t * 0.8);
    });
  }
  pillow(m, 5, 3, [0, 0, 1], 1, (s, t, o) => {
    const v = s * 2 - 1;
    o[0] = -0.23 - 0.2 * t; o[1] = v * (0.05 + 0.14 * Math.pow(t, 0.7)); o[2] = 0;
    o[3] = 0.022 * Math.sqrt(Math.max(1 - v * v, 0)) * (1 - t * t * 0.8);
  });
  pillow(m, 4, 2, [0, 0, 1], 1, (s, t, o) => {
    o[0] = lerp(0.02, -0.16, s) - t * 0.04; o[1] = 0.19 + t * 0.08 * Math.sin(Math.PI * s); o[2] = 0;
    o[3] = 0.016 * Math.sqrt(Math.max(4 * s * (1 - s), 0)) * (1 - t * t);
  });
  tube(m, [[0.1, 0.19, 0, 0.013], [0.18, 0.33, 0, 0.011], [0.32, 0.37, 0, 0.009], [0.42, 0.31, 0, 0.008]], 5, [0, 0, 3]);
  ball(m, LURE[0], LURE[1], LURE[2], 0.042, 0.042, 0.042, 3, 6);
  return m.build();
}
// (the lure sways on its stalk: the same turn in both materials)
const lureSway = (t, phase) => sin(t.mul(0.9).add(phase)).mul(0.18);
const STALK = vec3(0.1, 0.19, 0.0);
function anglerMaterial() {
  return material({
    aux: true, shadow: false,
    vertex: (v) => {
      const t = G.time, lp = v.P.toVar(), ln = v.N.toVar(), part = v.aux.w;
      const pl0 = placed(vec3(0.0), vec3(1.0, 0.0, 0.0));
      const w = t.mul(TAU * 0.7).add(pl0.phase);
      // the tail wags, the fins flutter, the lure sways on its stalk
      const at = sin(w).mul(0.35).mul(float(1.0).sub(smoothstep(-0.3, -0.2, lp.x)).mul(one(part, 1)));
      const q0 = turn(lp, vec3(-0.22, 0.0, 0.0), 'y', at), n0 = turnN(ln, 'y', at);
      const af = sin(w.mul(1.3)).mul(0.3).mul(one(part, 1).mul(step(0.12, abs(lp.z)))).mul(sign(lp.z));
      const q1 = turn(q0, vec3(0.0, 0.0, lp.z.mul(0.9)), 'x', af), n1 = turnN(n0, 'x', af);
      const al = lureSway(t, pl0.phase).mul(one(part, 3).add(one(part, 6)));
      const pl = placed(turn(q1, STALK, 'z', al), turnN(n1, 'z', al));
      v.P.assign(pl.P); v.N.assign(pl.N);
      vA.assign(pl.F); vB.assign(pl.Up); vP.assign(lp.mul(pl.size));
    },
    surface: (s, f) => {
      const part = f.aux.w, lp = f.obj, n0 = s.n, F = normalize(vA), Up = normalize(vB);
      const fins = one(part, 1).add(one(part, 3)), eye = one(part, 4), lure = one(part, 6);
      knit(s, f, { color: mix(vec3(0.42, 0.4, 0.74), vec3(0.94, 0.5, 0.74), fins), scale: 34, p: vP, frame: [F, Up, cross(F, Up)], k: 1.3 });
      // the mouth: a dark grin across the front with a row of white teeth
      const aa = fwidth(lp.y).add(fwidth(lp.z)).add(1e-4);
      const front = smoothstep(0.12, 0.18, lp.x).mul(one(part, 0));
      const lipY = lp.z.mul(lp.z).mul(1.6).sub(0.045);
      const gap = float(1.0).sub(smoothstep(0.012, aa.add(0.014), abs(lp.y.sub(lipY)))).mul(front);
      const tooth = abs(fract(lp.z.mul(26.0)).sub(0.5)).mul(2.0);
      const teeth = float(1.0).sub(smoothstep(0.0, aa.mul(2.0).add(0.004), lp.y.sub(lipY).add(0.004).sub(tooth.mul(0.014)))).mul(step(lipY.sub(0.02), lp.y)).mul(front);
      s.albedo = mix(mix(s.albedo, vec3(0.05, 0.02, 0.06), gap), vec3(0.95, 0.94, 0.9), teeth.mul(gap));
      bead(s, n0, eye);
      // the lure lights the face below it, and glows
      const toLure = length(lp.sub(vec3(LURE[0], LURE[1], LURE[2])));
      s.emis = s.emis.add(s.albedo.mul(vec3(0.45, 1.0, 0.9)).mul(float(0.5).div(toLure.mul(toLure).mul(40.0).add(1.0)).add(0.035)).mul(float(1.0).sub(lure)).mul(far(f.dist, 34.0, 48.0)));
      s.albedo = mix(s.albedo, vec3(0.7, 1.0, 0.95), lure);
      s.emis = s.emis.add(vec3(0.55, 1.0, 0.95).mul(lure).mul(5.0).mul(far(f.dist, 34.0, 48.0)));
    },
  });
}
// The light round the lure: a soft card where the lure is.
function lureGlowMaterial() {
  return material({
    additive: true,
    vertex: (v) => {
      const t = G.time, c0 = v.P.xy.toVar();
      const pl0 = placed(vec3(0.0), vec3(1.0, 0.0, 0.0));
      const at = placed(turn(vec3(LURE[0], LURE[1], LURE[2]), STALK, 'z', lureSway(t, pl0.phase)), vec3(1.0, 0.0, 0.0));
      const d = length(at.P.sub(cameraPosition));
      v.P.assign(at.P.add(U.right.mul(c0.x).add(U.up.mul(c0.y)).mul(at.size.mul(0.42))));
      v.aux.assign(vec4(c0, 0.0, 0.0));
      vK.assign(vec4(exp(SIG.mul(d).negate()).mul(smoothstep(0.4, 1.2, d)).mul(far(d, 34.0, 48.0)), 0.0));
    },
    raw: (f) => {
      const r2 = dot(f.aux.xy, f.aux.xy);
      const m = exp(r2.mul(-5.0)).mul(float(1.0).sub(smoothstep(0.55, 1.0, r2)));
      return { color: vec3(0.35, 1.0, 0.9).mul(m).mul(0.9).mul(vK.rgb), alpha: float(1.0) };
    },
  });
}

// ---- jellies and the siphonophore ------------------------------------------------------------

// Per jelly: jA where it lives (x, y, z) and its bell's radius; jB its seed, pulses a
// second, how fast it rises, how long its tentacles are (in bell radii); jC, jD its two
// yarns (the bell's stripes) and, in .w, how brightly it glows and which glow (0 teal, 1 pink).
const jA = attribute('jA', 'vec4'), jB = attribute('jB', 'vec4'), jC = attribute('jC', 'vec4'), jD = attribute('jD', 'vec4');
const vJ0 = varyingProperty('vec4', 'v_j0'), vJ1 = varyingProperty('vec4', 'v_j1'), vJ2 = varyingProperty('vec4', 'v_j2');
const TEAL = vec3(0.25, 1.0, 0.88), PINK = vec3(1.0, 0.36, 0.78);
const glowOf = (k) => mix(TEAL, PINK, k);

// How squeezed the bell is at time t: 0 at rest, 1 squeezed; a soft stroke, a slow refill.
const pulse = (t) => {
  const k = fract(t.mul(jB.y).add(jB.x.mul(7.0)));
  return smoothstep(0.0, 0.3, k).mul(float(1.0).sub(smoothstep(0.32, 0.95, k)));
};
// Where the jelly is: it rises, a little faster after each stroke, and drifts; it keeps to a
// band thirty metres tall round its home: at the top it fades and comes back at the bottom.
function jellyAt(t) {
  const cyc = t.mul(jB.y).add(jB.x.mul(7.0));
  const yr = jB.z.mul(t.add(sin(cyc.mul(TAU).sub(1.0)).mul(0.4).div(jB.y.mul(TAU)))).add(15.0);
  const yw = fract(yr.div(30.0)).mul(30.0);
  const fade = smoothstep(0.0, 4.0, yw).mul(float(1.0).sub(smoothstep(26.0, 30.0, yw)));
  const c = vec3(jA.x.add(sin(t.mul(0.031).add(jB.x.mul(6.0))).mul(1.2)), jA.y.sub(15.0).add(yw), jA.z.add(cos(t.mul(0.027).add(jB.x.mul(9.0))).mul(1.2)));
  return { c, fade };
}
// What the water leaves of a jelly's light, from here.
// (and nothing glowing is drawn beyond about 44 m: it fades out before it is switched off)
const far = (d, a, b) => float(1.0).sub(smoothstep(a, b, d));
const jellyKeep = (c, fade) => { const d = length(c.sub(cameraPosition)); return exp(SIG.mul(d).negate()).mul(fade).mul(smoothstep(0.5, 1.6, d)).mul(far(d, 32.0, 44.0)); };

// The bell: a crocheted dome in two colours of stripes, a rolled rim of glowing yarn; it
// squeezes from the rim and the light inside it brightens as it does. aux = (from the top
// 0 to the rim 1 and past it round the rolled edge, round 0..1).
function bellShape(lod) {
  const m = new Mesh(true), nb = [6, 8, 10][lod], na = [14, 18, 24][lod];
  const prof = [];
  for (let i = 0; i <= nb; i++) { const ph = (1.55 * i) / nb; prof.push([Math.sin(ph), 0.78 * (Math.cos(ph) - 1), i / nb]); }
  prof.push([1.07, -0.8, 1.05], [1.06, -0.9, 1.1], [0.96, -0.9, 1.15]);
  const i0 = m.i.length, base = m.count;
  m.grid(na, prof.length - 1, (s, t, o) => {
    const [r, y, tb] = prof[Math.round(t * (prof.length - 1))], a = s * TAU;
    o[0] = Math.cos(a) * r; o[1] = y; o[2] = Math.sin(a) * r; o[3] = tb; o[4] = s;
  }, true);
  orient(m, i0, base, (x, y, z) => [x, y + 0.2, z]);
  return m.build();
}
function bellMaterial() {
  return material({
    aux: true, twoSided: true, shadow: false,
    vertex: (v) => {
      const t = G.time, R = jA.w, J = jellyAt(t), con = pulse(t);
      const lp = v.P.toVar(), ln = v.N.toVar(), tb = v.aux.x;
      const sq = float(1.0).sub(con.mul(0.16).mul(pow(min(tb, 1.0), 1.3))), st = con.mul(0.08).add(1.0);
      const tilt = vec2(sin(t.mul(0.37).add(jB.x.mul(17.0))), cos(t.mul(0.31).add(jB.x.mul(11.0)))).mul(0.1);
      const q = vec3(lp.x.mul(sq).sub(lp.y.mul(tilt.x)), lp.y.mul(st), lp.z.mul(sq).sub(lp.y.mul(tilt.y)));
      v.P.assign(J.c.add(q.mul(R)));
      v.N.assign(normalize(vec3(ln.x.div(sq), ln.y.div(st), ln.z.div(sq))));
      vJ0.assign(vec4(jellyKeep(J.c, J.fade), con));
      vJ1.assign(jC); vJ2.assign(jD);
      vP.assign(lp.mul(R).add(jB.x.mul(5.0)));
    },
    surface: (s, f) => {
      const tb = f.aux.x, glow = glowOf(vJ2.w), keep = vJ0.rgb, con = vJ0.w;
      knit(s, f, { color: vJ1.rgb, color2: vJ2.rgb, stripe: 2, scale: 34, p: vP, frame: [vec3(1.0, 0.0, 0.0), UP, vec3(0.0, 0.0, 1.0)], k: 1.3 });
      // the rim is glowing yarn; the dome glows faintly from inside, more as it squeezes
      const rim = smoothstep(0.97, 1.03, tb);
      const inside = float(0.18).add(con.mul(0.25)).mul(float(1.0).sub(rim));
      s.emis = s.emis.add(glow.mul(rim.mul(2.2).add(inside.mul(s.albedo.g.add(0.3)))).mul(vJ1.w).mul(keep.mul(0.5).add(0.5)));
    },
  });
}
// Its tentacles: cords of glowing yarn hanging from under the rim, and three arms in tight
// corkscrew curls from the middle, each point following the bell as it was a moment before,
// so the pulse runs down them. (aux.z: where round the bell; aux.w: 0 a cord, 1 a curl, plus
// half its length.)
function tentacleShape(lod) {
  const m = new Mesh(true), ns = [10, 14, 18][lod], nside = [4, 5, 6][lod], rng = makeRng(31), nc = [5, 6, 7][lod];
  tubes(m, nc, ns, nside, () => rng.range(0.6, 1.0) * 0.5);
  const first = m.count;
  tubes(m, 3, ns * 2, nside, () => 1 + rng.range(0.7, 1.0) * 0.5);
  for (let v = 0; v < m.count; v++) m.a[v * 4 + 2] = v < first ? (m.a[v * 4 + 2] + 0.5) / nc : (m.a[v * 4 + 2] + 0.3) / 3;
  return m.build();
}
function tentacleMaterial() {
  return material({
    aux: true, shadow: false,
    vertex: (v) => {
      const t = G.time, R = jA.w, J = jellyAt(t);
      const s = v.aux.x, phi = v.aux.y.mul(TAU), ang = v.aux.z.mul(TAU), curly = step(1.0, v.aux.w), lf = fract(v.aux.w).mul(2.0);
      const conL = pulse(t.sub(s.mul(0.9)));
      const len = R.mul(jB.w).mul(lf).mul(mix(float(1.0), float(0.6), curly)).toVar();
      const out = vec3(cos(ang), 0.0, sin(ang)), tang = vec3(sin(ang).negate(), 0.0, cos(ang));
      const at = (ss) => {
        const sway = vec3(sin(t.mul(0.6).add(ss.mul(3.2)).add(ang.mul(2.0)).add(jB.x.mul(9.0))), 0.0, cos(t.mul(0.5).add(ss.mul(2.7)).add(ang.mul(1.7)).add(jB.x.mul(5.0)))).mul(ss.mul(ss).mul(len).mul(0.2));
        // a cord hangs from under the rim, drawn in a little as the bell squeezes
        const cord = out.mul(R.mul(float(0.8).sub(conL.mul(0.12))).mul(float(1.0).sub(ss.mul(0.25))));
        // a curl winds round a line that hangs from near the middle
        const th = ss.mul(len).div(R.mul(0.11)).add(t.mul(0.6));
        const coil = out.mul(R.mul(0.22)).add(vec3(cos(th), 0.0, sin(th)).mul(R.mul(0.09)));
        return J.c.add(mix(cord, coil, curly)).add(vec3(0.0, R.mul(-0.7).sub(ss.mul(len).mul(float(1.0).sub(conL.mul(0.08)))), 0.0)).add(sway);
      };
      const C0 = at(s).toVar(), T = normalize(at(s.add(0.01)).sub(C0)).toVar();
      const r = R.mul(mix(float(0.075), float(0.06), curly)).mul(float(1.0).sub(s.mul(0.35))).mul(sqrt(min(float(1.0).sub(s).mul(25.0), 1.0)));
      const rg = ringAt(C0, T, tang, phi, r);
      v.P.assign(rg.p); v.N.assign(rg.n);
      vJ0.assign(vec4(jellyKeep(J.c, J.fade), s));
      vJ1.assign(jC); vJ2.assign(jD);
      vA.assign(rg.S); vB.assign(T);
      vP.assign(vec3(cos(phi).mul(0.03), s.mul(len), sin(phi).mul(-0.03)).add(v.aux.z.mul(7.0)));
    },
    surface: (s, f) => {
      const A = normalize(vA), B = normalize(vB);
      // each strand in one of the two glows; the glowing yarn is bright all along
      const glow = glowOf(step(0.5, fract(f.aux.z.mul(3.7).add(vJ2.w))));
      knit(s, f, { color: mix(glow, vJ2.rgb, 0.35), scale: 40, p: vP, frame: [A, B, cross(A, B)], k: 1.1 });
      s.emis = s.emis.add(glow.mul(float(1.5).sub(vJ0.w.mul(0.6))).mul(vJ1.w).mul(vJ0.rgb.mul(0.5).add(0.5)));
    },
  });
}
// The haze of light round each jelly.
function haloMaterial() {
  return material({
    additive: true,
    vertex: (v) => {
      const J = jellyAt(G.time), c0 = v.P.xy.toVar();
      v.P.assign(J.c.sub(vec3(0.0, jA.w.mul(0.9), 0.0)).add(U.right.mul(c0.x).add(U.up.mul(c0.y)).mul(jA.w.mul(3.2))));
      v.aux.assign(vec4(c0, 0.0, 0.0));
      vJ0.assign(vec4(jellyKeep(J.c, J.fade), 0.0));
      vJ2.assign(jD); vJ1.assign(jC);
    },
    raw: (f) => {
      const r2 = dot(f.aux.xy, f.aux.xy);
      const m = exp(r2.mul(-3.0)).mul(float(1.0).sub(smoothstep(0.5, 1.0, r2)));
      return { color: glowOf(vJ2.w).mul(m).mul(0.07).mul(vJ1.w).mul(vJ0.rgb), alpha: float(1.0) };
    },
  });
}

// The siphonophore: a long cord coiled like a spring round a line that sways, glowing teal
// and pink along its length. Built in the shader: aux = (along 0..1, round 0..1).
function siphonoMaterial(P0, D, N1, N2, len) {
  const turns = 150, rh = 0.11, rc = 0.028;
  return material({
    aux: true, shadow: false,
    vertex: (v) => {
      const t = G.time, s = v.aux.x, phi = v.aux.y.mul(TAU);
      const spine = (ss) => P0.add(D.mul(ss.mul(len))).add(N1.mul(sin(ss.mul(TAU * 1.1).sub(t.mul(0.21))).mul(1.4)))
        .add(N2.mul(sin(ss.mul(TAU * 0.7).add(t.mul(0.17)).add(1.3)).mul(1.1))).add(vec3(0.0, sin(ss.mul(Math.PI)).mul(1.6), 0.0));
      const coil = (ss) => {
        const S0 = spine(ss), Ts = normalize(spine(ss.add(0.002)).sub(S0));
        const n1 = normalize(cross(Ts, N2)), n2 = cross(Ts, n1);
        const th = ss.mul(TAU * turns).add(t.mul(0.5));
        return { p: S0.add(n1.mul(cos(th)).add(n2.mul(sin(th))).mul(rh)), Ts };
      };
      const H0 = coil(s), T = normalize(coil(s.add(0.0006)).p.sub(H0.p)).toVar();
      const rg = ringAt(H0.p, T, H0.Ts, phi, float(rc));
      v.P.assign(rg.p); v.N.assign(rg.n);
      vA.assign(rg.S); vB.assign(T);
      vP.assign(vec3(cos(phi).mul(rc), s.mul(len * turns * 0.7), sin(phi).mul(-rc)));
      const dc = length(H0.p.sub(cameraPosition));
      vJ0.assign(vec4(exp(SIG.mul(dc).negate()).mul(far(dc, 38.0, 52.0)), s));
    },
    surface: (s, f) => {
      const A = normalize(vA), B = normalize(vB), along = vJ0.w;
      const glow = mix(TEAL, PINK, smoothstep(0.25, 0.75, sin(along.mul(TAU * 5.0)).mul(0.5).add(0.5)));
      knit(s, f, { color: mix(glow, vec3(0.9, 0.85, 0.95), 0.3), scale: 60, p: vP, frame: [A, B, cross(A, B)], k: 1.0 });
      const ends = smoothstep(0.0, 0.04, along).mul(float(1.0).sub(smoothstep(0.96, 1.0, along)));
      s.emis = s.emis.add(glow.mul(1.4).mul(ends).mul(vJ0.rgb.mul(0.5).add(0.5)));
    },
  });
}

// ---- the vents ------------------------------------------------------------------------------

// Tube worms: crocheted tubes in red and white rows, in clumps; most with a red plume of
// short fat tentacles on top, a few just an open red rim. Built in the shader from rings:
// aux = (along, round, which: the tube or the plume's tentacles, 0 the tube or 1 a tentacle).
// Per worm: wA its foot (x, y, z) and height; wB its lean (x, z), its seed, plume (1) or not.
const wA = attribute('wA', 'vec4'), wB = attribute('wB', 'vec4');
function wormShape(lod) {
  const m = new Mesh(true);
  tubes(m, 1, [7, 9, 10][lod], [6, 7, 8][lod], () => 0);
  tubes(m, 7, [3, 4, 4][lod], [4, 4, 4][lod], () => 1);
  return m.build();
}
function wormMaterial() {
  return material({
    aux: true, twoSided: true, shadow: false,
    vertex: (v) => {
      const t = G.time, s = v.aux.x, phi = v.aux.y.mul(TAU), k = v.aux.z, plumeK = v.aux.w;
      const H = wA.w, seed = wB.z;
      const sway = vec2(sin(t.mul(0.5).add(seed.mul(20.0))), cos(t.mul(0.43).add(seed.mul(13.0)))).mul(0.06).add(wB.xy);
      const stem = (ss) => wA.xyz.add(vec3(sway.x.mul(ss).mul(ss).mul(H), ss.mul(H), sway.y.mul(ss).mul(ss).mul(H)));
      // the tube, flaring a little at its mouth
      const C0 = stem(s).toVar(), T0 = normalize(stem(s.add(0.02)).sub(C0)).toVar();
      const rgT = ringAt(C0, T0, vec3(1.0, 0.0, 0.0), phi, float(0.085).mul(smoothstep(0.85, 1.0, s).mul(0.25).add(1.0)));
      // a plume tentacle: out from the rim, up, and over, waving
      const top = stem(float(1.0)), Tt = normalize(top.sub(stem(float(0.95))));
      const a = k.mul(TAU / 7).add(seed.mul(6.0)), o0 = vec3(cos(a), 0.0, sin(a));
      const out = normalize(o0.sub(Tt.mul(dot(o0, Tt))));
      const wave = sin(t.mul(1.4).add(k.mul(1.9)).add(seed.mul(9.0))).mul(0.25);
      const pl = (ss) => top.add(out.mul(ss.mul(0.15).add(0.05).add(ss.mul(ss).mul(wave).mul(0.1)))).add(Tt.mul(ss.mul(0.12).sub(ss.mul(ss).mul(0.06)).add(0.015)));
      const C1 = pl(s).toVar(), T1 = normalize(pl(s.add(0.05)).sub(C1)).toVar();
      const rgP = ringAt(C1, T1, cross(out, Tt), phi, float(0.032).mul(float(1.0).sub(s.mul(0.4))).mul(sqrt(min(float(1.0).sub(s).mul(10.0), 1.0))));
      const tent = step(0.5, plumeK).greaterThan(0.5), isP = step(0.5, plumeK).mul(step(0.5, wB.w)).greaterThan(0.5);
      v.P.assign(select(isP, rgP.p, select(tent, top, rgT.p)));
      v.N.assign(select(isP, rgP.n, rgT.n));
      vA.assign(select(isP, rgP.S, rgT.S)); vB.assign(select(isP, T1, T0));
      vP.assign(vec3(cos(phi).mul(0.075), s.mul(select(isP, float(0.2), H)), sin(phi).mul(-0.075)).add(seed.mul(4.0)));
      vK.assign(vec4(plumeK, s, 0.0, 0.0));
    },
    surface: (s, f) => {
      const A = normalize(vA), B = normalize(vB), red = vec3(0.86, 0.13, 0.11), white = vec3(0.95, 0.92, 0.86);
      const solidRed = max(step(0.5, vK.x), smoothstep(0.88, 0.92, vK.y));
      knit(s, f, { color: mix(white, red, solidRed), color2: red, stripe: 3, scale: 32, p: vP, frame: [A, B, cross(A, B)], k: 1.3 });
    },
  });
}

// Sea sheep: little fluffy white slugs, all bobbles, two bead eyes and two soft ears.
// aux.w: 0 wool, 4 eyes. Per sheep: hA where it sits and its size; hB which way it faces, its seed.
const hA = attribute('hA', 'vec4'), hB = attribute('hB', 'vec4');
function sheepShape(lod) {
  const m = new Mesh(true), rng = makeRng(5), res = [5, 6, 7][lod];
  ball(m, 0, 0.08, 0, 0.17, 0.09, 0.105, res, 0);
  for (let i = 0, n = [16, 22, 28][lod]; i < n; i++) {
    const a = rng() * TAU, up = rng.range(0.1, 1), x = rng.range(-0.15, 0.13);
    const y = 0.08 + 0.085 * up, z = Math.cos(a) * 0.1 * Math.sqrt(1 - up * up * 0.6) * (1 - Math.abs(x) * 1.5);
    const r = rng.range(0.03, 0.048);
    ball(m, x, y + Math.abs(Math.sin(a)) * 0.02, z, r, r * 0.9, r, 2, 0);
  }
  for (const side of [1, -1]) {
    ball(m, 0.15, 0.12, side * 0.045, 0.018, 0.018, 0.018, 2, 4);
    tube(m, [[0.11, 0.15, side * 0.035, 0.016], [0.1, 0.21, side * 0.05, 0.014], [0.07, 0.25, side * 0.06, 0.01]], 5, [0, 0, 0]);
  }
  return m.build();
}
function sheepMaterial() {
  return material({
    aux: true, shadow: false,
    vertex: (v) => {
      const t = G.time, lp = v.P.toVar(), ln = v.N.toVar(), seed = hB.z;
      // it breathes, and now and then looks about
      const b = sin(t.mul(1.1).add(seed.mul(20.0))).mul(0.03);
      const look = sin(t.mul(0.23).add(seed.mul(7.0))).mul(0.3).mul(smoothstep(0.0, 0.12, lp.x));
      const q = turn(vec3(lp.x, lp.y.mul(b.add(1.0)), lp.z.mul(b.mul(0.5).add(1.0))), vec3(0.05, 0.1, 0.0), 'y', look);
      const F = vec3(cos(hB.x), 0.0, sin(hB.x)), R = vec3(sin(hB.x).negate(), 0.0, cos(hB.x));
      v.P.assign(hA.xyz.add(F.mul(q.x).add(UP.mul(q.y)).add(R.mul(q.z)).mul(hA.w)));
      v.N.assign(normalize(F.mul(ln.x).add(UP.mul(ln.y)).add(R.mul(ln.z))));
      vA.assign(F); vP.assign(lp.mul(hA.w).add(seed.mul(3.0)));
    },
    surface: (s, f) => {
      const n0 = s.n, F = normalize(vA);
      knit(s, f, { color: vec3(0.96, 0.92, 0.84), scale: 46, p: vP, frame: [F, UP, cross(F, UP)], k: 1.6, fuzz: 2.2 });
      bead(s, n0, one(f.aux.w, 4));
    },
  });
}

// ---- what drifts ----------------------------------------------------------------------------

// Specks of the sea: soft round flecks in a box that moves with the eye (each wraps round
// it), drifting and sinking slowly. In the light they are pale motes, bright against the
// light; lower down they are the gold and teal dust of the twilight, glowing a little and
// blinking slowly. sA: where in the box (0..1), and its seed.
const sA = attribute('sA', 'vec4'), vSnow = varyingProperty('vec4', 'v_snow');
function speckMaterial(B, deep) {
  return material({
    additive: true,
    vertex: (v) => {
      const t = G.time, s = sA.w, c0 = v.P.xy.toVar();
      const flow = vec3(t.mul(0.04), t.mul(deep ? 0.006 : -0.025), t.mul(0.03)).add(vec3(sin(t.mul(0.31).add(s.mul(61.0))), sin(t.mul(0.23).add(s.mul(47.0))).mul(0.5), cos(t.mul(0.27).add(s.mul(73.0)))).mul(0.25));
      const rel = fract(sA.xyz.mul(B).add(flow).sub(cameraPosition).div(B).add(0.5)).sub(0.5).mul(B).toVar();
      const w = cameraPosition.add(rel).toVar();
      const d = length(rel).toVar();
      const r = deep ? s.mul(0.008).add(0.006) : s.mul(s).mul(s).mul(0.016).add(0.005);
      const rr = max(r, d.mul(U.pix).mul(1.2)).toVar();
      const dim = r.div(rr).mul(r.div(rr));
      const fade = smoothstep(0.35, 1.4, d).mul(float(1.0).sub(smoothstep(B * 0.36, B * 0.47, d))).mul(smoothstep(0.1, 0.6, w.y.negate()));
      let col;
      if (deep) {
        const blink = pow(sin(t.mul(s.mul(0.7).add(0.3)).add(s.mul(91.0))).mul(0.5).add(0.5), 4.0).mul(1.2).add(0.35);
        const hue = mix(vec3(1.0, 0.78, 0.42), vec3(0.3, 0.95, 0.85), step(0.78, fract(s.mul(7.3))));
        col = hue.mul(blink).mul(smoothstep(60.0, 100.0, w.y.negate())).mul(1.4).add(lampAt(w).mul(0.4));
      } else {
        const toward = pow(max(dot(rel.div(d), G.sunDir), 0.0), 4.0).mul(2.5).add(0.3);
        col = sunAt(w.y).mul(causticAt(w).mul(2.2).add(0.12)).mul(toward).add(skyAt(w, UP).mul(0.45)).add(lampAt(w)).add(glowsAt(w)).mul(vec3(0.8, 0.8, 0.74)).mul(0.5);
      }
      vSnow.assign(vec4(col.mul(exp(SIG.mul(d).negate())).mul(dim.mul(fade)), 0.0));
      v.P.assign(w.add(U.right.mul(c0.x).add(U.up.mul(c0.y)).mul(rr.mul(2.0))));
      v.aux.assign(vec4(c0, 0.0, 0.0));
    },
    raw: (f) => {
      const q = f.aux.xy.mul(2.0), r2 = dot(q, q);
      return { color: vSnow.rgb.mul(exp(r2.negate()).mul(float(1.0).sub(smoothstep(2.6, 4.0, r2)))), alpha: float(1.0) };
    },
  });
}

// Bubbles: streams that rise from a source, each bubble wobbling, growing a little and
// drifting with the current; a bright rim and a highlight, the light round it, or the
// lamp's and the vents' glow. bA: the source (x, y, z) and the bubble's seed; bB: how high
// the stream rises, how fast, the bubble's radius, the stream's own phase.
const bA = attribute('bA', 'vec4'), bB = attribute('bB', 'vec4'), vBub = varyingProperty('vec4', 'v_bub');
function bubbleMaterial() {
  return material({
    additive: true,
    vertex: (v) => {
      const t = G.time, s = bA.w, H = bB.x, c0 = v.P.xy.toVar();
      const life = fract(t.mul(bB.y).div(H).add(s)).toVar();
      const h = life.mul(H);
      const wob = vec3(sin(t.mul(2.7).add(s.mul(53.0)).add(h.mul(1.3))), 0.0, cos(t.mul(2.3).add(s.mul(37.0)).add(h.mul(1.1)))).mul(0.03)
        .add(vec3(sin(h.mul(0.21).add(bB.w)), 0.0, cos(h.mul(0.17).add(bB.w.mul(1.7)))).mul(h.mul(0.06)));
      const w = bA.xyz.add(vec3(0.0, h, 0.0)).add(wob).toVar();
      const r = bB.z.mul(life.mul(0.5).add(0.75));
      const d = length(w.sub(cameraPosition)).toVar();
      const rr = max(r, d.mul(U.pix).mul(1.1)).toVar();
      const dim = r.div(rr).mul(r.div(rr));
      const fade = smoothstep(0.0, 0.04, life).mul(float(1.0).sub(smoothstep(0.8, 1.0, life))).mul(float(1.0).sub(smoothstep(-0.6, -0.1, w.y))).mul(smoothstep(0.3, 1.0, d));
      const light = skyAt(w, UP).mul(1.1).add(sunAt(w.y).mul(causticAt(w).mul(1.6).add(0.2))).add(lampAt(w).mul(1.5)).add(glowsAt(w).mul(1.2));
      vBub.assign(vec4(light.mul(exp(SIG.mul(d).negate())).mul(dim.mul(fade)), smoothstep(2.5, 7.0, rr.div(d.mul(U.pix)))));
      v.P.assign(w.add(U.right.mul(c0.x).add(U.up.mul(c0.y)).mul(rr.mul(1.3))));
      v.aux.assign(vec4(c0.mul(1.3), 0.0, 0.0));
    },
    raw: (f) => {
      const q = f.aux.xy, r = length(q);
      const aa = fwidth(r).add(1e-3);
      const disc = float(1.0).sub(smoothstep(float(1.0).sub(aa), aa.add(1.0), r));
      const rim = pow(smoothstep(0.45, 1.0, r), 3.0).mul(disc);
      const hl = float(1.0).sub(smoothstep(0.0, 0.3, length(q.sub(vec2(-0.35, 0.42)))));
      const shape = rim.mul(0.9).add(hl.mul(1.2)).add(disc.mul(0.05));
      const soft = exp(r.mul(r).mul(-2.2)).mul(0.5);
      return { color: vBub.rgb.mul(mix(soft, shape, vBub.w)), alpha: float(1.0) };
    },
  });
}

// ---- where things are -------------------------------------------------------------------------

// The vents' chimneys, as src/rocks.js stands them (z, distance off the centre line,
// height, radius, seed): tube worms and sea sheep live at their feet, bubbles rise from them.
const CHIMNEYS = [[-331, 6.5, 9, 1.5, 53], [-334, 9, 6, 1.2, 54], [-346, -7.5, 12, 1.8, 55], [-349, -10, 7, 1.3, 56], [-359, 8, 8.5, 1.5, 58], [-372, -6.5, 11, 1.7, 59], [-375, -9.5, 6.5, 1.2, 60]];
function chimneys() {
  return CHIMNEYS.map(([z, off, height, radius, seed]) => {
    // (the same draws, in the same order, as rocks.js makes them: seven knobs, then the lean)
    const rng = makeRng(seed);
    for (let i = 0; i < 7; i++) { rng.range(0.1, 0.95); rng(); rng.range(0.45, 0.75); }
    const lean = rng.range(-0.6, 0.6), x = centerX(z) + off, g = groundY(x, z);
    return { x, z, g, height, radius, top: [x + lean, g + height, z - lean * 0.5] };
  });
}
// Where the camera is nearest to a place at the vents: its p.
const ventP = (z) => Math.min(Math.max(6.25 + ((-314 - z) / 69) * 0.75, 6.25), 7.0);

// Where the jellies live: down the drop-off, in front of the camera at each height as it
// goes down (where it looks), some close; and a few where it comes back up.
function jellySpots(rng, n, nUp) {
  const list = [];
  const camAt = (y) => {
    let best = 5.15, bd = 1e9;
    for (let p = 5.15; p <= 6.05; p += 0.01) { pathAt(p, _o); const d = Math.abs(_o[1] - y); if (d < bd) { bd = d; best = p; } }
    return best;
  };
  const clear = (x, y, z, r) => { for (let dy = -6; dy <= 6; dy += 3) if (offTrack(x, z, y + dy) < r) return false; return true; };
  for (let tries = 0; list.length < n && tries < n * 60; tries++) {
    const y = -78 - ((list.length + rng()) / n) * 108, v = view(camAt(y));
    const near = rng() < 0.35, dist = near ? rng.range(3.6, 5.5) : rng.range(5.5, 12);
    const side = rng.range(-0.62, 0.62) * dist, up = (rng.range(-0.3, 0.32) + Math.tan(v.pitch * DEG) * 0.6) * dist;
    const x = v.x + v.fx * dist + v.rx * side, z = v.z + v.fz * dist + v.rz * side, yy = v.y + up;
    if (z > -279 || !clear(x, yy, z, 2.8)) continue;
    list.push([x, yy, z, near]);
  }
  for (let tries = 0, k = 0; k < nUp && tries < nUp * 60; tries++) {
    const y = rng.range(-160, -70), dist = rng.range(4.5, 10), ang = rng.range(-0.7, 0.7);
    const x = -3.7 + Math.sin(ang) * dist, z = -388 - Math.cos(ang) * dist;
    if (!clear(x, y, z, 2.8)) continue;
    list.push([x, y, z, false]);
    k++;
  }
  return list;
}

// ---- the part ----------------------------------------------------------------------------------

export function buildFauna(ctx) {
  const { add, scene, engine, q, camera, wreck = null } = ctx;
  const t0 = performance.now();
  const amt = q.amount, lod = amt >= 1 ? 2 : amt >= 0.5 ? 1 : 0;
  const rng = makeRng(20261116);
  const counts = {};

  // fish
  const fishMat = fishMaterial(), geos = {};
  let fishN = 0;
  for (const [name, { shape, fish }] of populate(rng, amt)) {
    geos[shape] ??= fishShape(FISH[shape], lod);
    add(fishMesh(geos[shape], fish, fishMat), 64);
    counts[name] = fish.length;
    fishN += fish.length;
  }

  // the creatures placed each frame: each one copy, in its slot, with a sphere round where it can be
  const slot = (n, look, seed) => ({ cS: new Float32Array([n, seed, look, 0]) });
  const turtleGeo = turtleShape(lod), turtleMat = turtleMaterial(), octGeo = octopusShape(lod), octMat = octopusMaterial();
  const reefMid = [-5, floorY(-156) + 4.2, -156], endAt = [-3, -2.6, -403];
  add(solid(copies(turtleGeo, 1, slot(0, 0, 0.3), new Sphere(new Vector3(...reefMid), 30)), turtleMat), 110);
  add(solid(copies(turtleGeo, 1, slot(1, 1, 0.7), new Sphere(new Vector3(...endAt), 14)), turtleMat), 90);
  add(solid(copies(octGeo, 1, slot(2, 0, 0.1), new Sphere(new Vector3(...inView(4.72, 3.7, -1.2, 0)), 26)), octMat), 80);
  add(solid(copies(octGeo, 1, slot(3, 0, 0.6), new Sphere(new Vector3(...endAt), 14)), octMat), 80);
  const anglerAt = inView(5.66, 4.0, 0.5, -0.3);
  add(solid(copies(anglerShape(lod), 1, slot(4, 0, 0.5), new Sphere(new Vector3(...anglerAt), 6)), anglerMaterial()), 52);
  add(solid(cards(1, slot(4, 0, 0.5), new Sphere(new Vector3(...anglerAt), 6)), lureGlowMaterial()), 52);

  // jellies
  const spots = jellySpots(rng, Math.max(10, Math.round(24 * Math.sqrt(amt))), Math.max(3, Math.round(5 * Math.sqrt(amt))));
  const BELLS = [[[0.3, 0.82, 0.8], [0.62, 0.36, 0.78], 0], [[0.95, 0.5, 0.62], [0.56, 0.3, 0.7], 1], [[0.55, 0.84, 0.82], [0.93, 0.9, 0.86], 0], [[0.64, 0.4, 0.82], [0.95, 0.55, 0.75], 1]];
  const bellGeo = bellShape(lod), tentGeo = tentacleShape(lod), bellMat = bellMaterial(), tentMat = tentacleMaterial(), haloMat = haloMaterial();
  // (in three groups, the upper and lower drop-off and the way back up, so each is switched off when it is far)
  const nj = spots.length;
  for (const part of [spots.filter((j) => j[2] > -360 && j[1] > -131), spots.filter((j) => j[2] > -360 && j[1] <= -131), spots.filter((j) => j[2] <= -360)]) {
    const n = part.length;
    if (!n) continue;
    const ja = new Float32Array(n * 4), jb = new Float32Array(n * 4), jc = new Float32Array(n * 4), jd = new Float32Array(n * 4), boxes = [];
    part.forEach(([x, y, z, near], i) => {
      const R0 = near ? rng.range(0.3, 0.4) : rng.range(0.36, 0.56), [c1, c2, glow] = rng.pick(BELLS);
      ja.set([x, y, z, R0], i * 4);
      jb.set([rng(), rng.range(0.32, 0.55), rng.range(0.02, 0.05), rng.range(3.2, 5.0)], i * 4);
      jc.set([...c1, rng.range(0.85, 1.2)], i * 4);
      jd.set([...c2, glow], i * 4);
      boxes.push([x - 3, x + 3, y - 18, y + 16, z - 3, z + 3]);
    });
    const sph = sphereOf(boxes), attrs = { jA: new InstancedBufferAttribute(ja, 4), jB: new InstancedBufferAttribute(jb, 4), jC: new InstancedBufferAttribute(jc, 4), jD: new InstancedBufferAttribute(jd, 4) };
    add(solid(copies(bellGeo, n, attrs, sph), bellMat), 46);
    add(solid(copies(tentGeo, n, attrs, sph), tentMat), 46);
    add(solid(cards(n, attrs, sph), haloMat), 46);
  }

  // the siphonophore: across the view on the way down, rising from left to right
  {
    const v = view(5.47), c = inView(5.47, 7.5, 0, 0.6), len = 11;
    const D = new Vector3(v.rx, 0.22, v.rz).normalize(), N2 = new Vector3(v.fx, 0, v.fz).normalize(), N1 = new Vector3().crossVectors(N2, D).normalize();
    const P0 = new Vector3(c[0], c[1], c[2]).addScaledVector(D, -len / 2);
    const sm = new Mesh(true);
    tubes(sm, 1, [700, 1100, 1500][lod], [4, 5, 5][lod], () => 0);
    const geo = sm.build();
    geo.boundingSphere = new Sphere(new Vector3(c[0], c[1] + 0.8, c[2]), len / 2 + 3);
    add(solid(geo, siphonoMaterial(vec3(P0.x, P0.y, P0.z), vec3(D.x, D.y, D.z), vec3(N1.x, N1.y, N1.z), vec3(N2.x, N2.y, N2.z), len)), 56);
  }

  // the vents: clumps of tube worms at the chimneys' feet, on the side the camera passes; sea sheep on the rock
  const chim = chimneys(), worms = [], sheep = [];
  for (const c of chim) {
    pathAt(ventP(c.z), _o);
    const toward = Math.atan2(_o[2] - c.z, _o[0] - c.x);
    for (let clump = 0; clump < 2; clump++) {
      const a = toward + (clump ? 1.1 : -0.7) + rng.range(-0.3, 0.3), dist = c.radius * 1.25 + rng.range(0.5, 1.2);
      const cx = c.x + Math.cos(a) * dist, cz = c.z + Math.sin(a) * dist;
      if (offTrack(cx, cz) < 2.2) continue;
      for (let i = 0, nw = Math.max(3, Math.round(rng.range(5, 8) * Math.sqrt(amt))); i < nw; i++) {
        const x = cx + rng.bell() * 0.45, z = cz + rng.bell() * 0.45;
        worms.push([x, groundY(x, z) - 0.06, z, rng.range(0.45, 1.0), rng.bell() * 0.12, rng.bell() * 0.12, rng(), rng() < 0.72 ? 1 : 0]);
      }
    }
  }
  // and along the camera's way through the vents, where the lamp falls: a clump to one side, then the other
  const clumpAt = (cx, cz, n) => {
    for (let i = 0; i < n; i++) {
      const x = cx + rng.bell() * 0.5, z = cz + rng.bell() * 0.5;
      worms.push([x, groundY(x, z) - 0.06, z, rng.range(0.55, 1.25), rng.bell() * 0.12, rng.bell() * 0.12, rng(), rng() < 0.72 ? 1 : 0]);
    }
  };
  [6.3, 6.42, 6.55, 6.68, 6.8, 6.93].forEach((pv, i) => {
    const at = inView(pv, rng.range(5, 6.5), (i % 2 ? 1 : -1) * rng.range(2.4, 3.2), 0);
    if (offTrack(at[0], at[2]) > 2.2) clumpAt(at[0], at[2], Math.max(4, Math.round(rng.range(6, 9) * Math.sqrt(amt))));
  });
  // sea sheep: on the black sand by the way, facing it
  [6.36, 6.6, 6.86].forEach((pv, i) => {
    const at = inView(pv, rng.range(4.2, 5.2), (i % 2 ? -1 : 1) * rng.range(2.3, 2.8), 0);
    pathAt(pv, _o);
    sheep.push([at[0], groundY(at[0], at[2]) + 0.03, at[2], rng.range(1.5, 1.8), Math.atan2(_o[2] - at[2], _o[0] - at[0]) + rng.range(-0.5, 0.5), 0, rng(), 0]);
  });
  for (const k of [0, 2, 5]) {
    const c = chim[k];
    pathAt(ventP(c.z), _o);
    const toward = Math.atan2(_o[2] - c.z, _o[0] - c.x) + (k % 2 ? 0.5 : -0.5), dist = c.radius * 1.3 + 0.7;
    const x = c.x + Math.cos(toward) * dist, z = c.z + Math.sin(toward) * dist;
    sheep.push([x, groundY(x, z) + 0.03, z, rng.range(1.3, 1.6), Math.atan2(_o[2] - z, _o[0] - x) + rng.range(-0.6, 0.6), 0, rng(), 0]);
  }
  const ventBox = sphereOf([...chim.map((c) => [c.x - 6, c.x + 6, c.g - 1, c.g + 4, c.z - 6, c.z + 6]), ...worms.map((w) => [w[0] - 1, w[0] + 1, w[1] - 1, w[1] + 2, w[2] - 1, w[2] + 1]), ...sheep.map((h) => [h[0] - 1, h[0] + 1, h[1] - 1, h[1] + 1, h[2] - 1, h[2] + 1])]);
  const wa = new Float32Array(worms.length * 4), wb = new Float32Array(worms.length * 4);
  worms.forEach((w, i) => { wa.set(w.slice(0, 4), i * 4); wb.set(w.slice(4, 8), i * 4); });
  add(solid(copies(wormShape(lod), worms.length, { wA: wa, wB: wb }, ventBox), wormMaterial()), 80);
  const ha = new Float32Array(sheep.length * 4), hb = new Float32Array(sheep.length * 4);
  sheep.forEach((h, i) => { ha.set(h.slice(0, 4), i * 4); hb.set([h[4], 0, h[6], 0], i * 4); });
  add(solid(copies(sheepShape(lod), sheep.length, { hA: ha, hB: hb }, ventBox), sheepMaterial()), 70);

  // specks, round the eye wherever it is: pale in the light, gold and teal in the dark
  const far = new Sphere(new Vector3(0, 0, 0), 1e6);
  const speck = (n, B, deep) => {
    const a = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) a[i] = rng();
    const m = solid(cards(n, { sA: a }, far), speckMaterial(B, deep));
    m.frustumCulled = false;
    scene.add(m);
    return m;
  };
  const nSnow = Math.round(7000 * amt), nDust = Math.round(3600 * amt);
  const snow = speck(nSnow, 40, false), dust = speck(nDust, 30, true);

  // bubbles: from the sand in the shallows, among the kelp and the reef, and from the vents
  const bubbleMat = bubbleMaterial();
  const streams = (list, perStream, out) => {
    for (const [x, y, z, H, sp, r0] of list) {
      const n = Math.max(3, Math.round(perStream * amt)), ph = rng() * TAU;
      for (let i = 0; i < n; i++) out.push([x, y, z, (i + rng.range(0, 0.7)) / n, H, sp * rng.range(0.85, 1.15), r0 * rng.range(0.6, 1.3), ph]);
    }
  };
  const bubbleMesh = (b, range) => {
    const n = b.length, ba = new Float32Array(n * 4), bb = new Float32Array(n * 4), boxes = [];
    b.forEach((e, i) => { ba.set(e.slice(0, 4), i * 4); bb.set(e.slice(4, 8), i * 4); boxes.push([e[0] - 3, e[0] + 3, e[1], e[1] + e[4] + 1, e[2] - 3, e[2] + 3]); });
    add(solid(cards(n, { bA: ba, bB: bb }, sphereOf(boxes)), bubbleMat), range);
    return n;
  };
  const vents = [], lit = [[], [], []];
  for (const c of chim) {
    for (let k = 0; k < 2; k++) {
      const a = rng() * TAU, rr = c.radius * 0.42;
      vents.push([c.top[0] + Math.cos(a) * rr, c.top[1] - rng.range(0.3, 1.2), c.top[2] + Math.sin(a) * rr, rng.range(14, 22), rng.range(0.3, 0.42), rng.range(0.008, 0.014)]);
    }
  }
  // in the sunlit stretch, from the floor where the camera will see them rise
  for (const [zone, p0, p1, nSrc] of [[0, 1.3, 2.05, 6], [1, 2.3, 3.0, 5], [2, 3.3, 4.0, 6]]) {
    for (let k = 0, tries = 0; k < nSrc && tries < 200; tries++) {
      const at = inView(lerp(p0, p1, (k + rng()) / nSrc), rng.range(5, 11), rng.sign() * rng.range(1.8, 5), 0);
      const g = groundY(at[0], at[2]);
      if (offTrack(at[0], at[2]) < 2) continue;
      lit[zone].push([at[0], g + 0.02, at[2], -g - 0.1, rng.range(0.24, 0.34), rng.range(0.006, 0.012)]);
      k++;
    }
  }
  const ventB = [], litB = [[], [], []];
  streams(vents, 14, ventB);
  lit.forEach((l, i) => streams(l, 10, litB[i]));
  counts.bubbles = bubbleMesh(ventB, 90) + litB.reduce((n, b) => n + bubbleMesh(b, 70), 0);

  if (DEV) console.log(`fauna: ${fishN} fish ${JSON.stringify(counts)}, ${nj} jellies, ${worms.length} worms, ${sheep.length} sheep, ${nSnow + nDust} specks, ${Math.round(performance.now() - t0)} ms`);

  // ---- each frame: the creatures in their slots
  const F = new Vector3(), Upv = new Vector3(), R = new Vector3(), Y = new Vector3(0, 1, 0), P = new Vector3(), Q = new Vector3(), W = new Vector3();
  const octopus = new Vector3();          // where the octopus with the letter is (for Snap to look at)
  // In the wreck's cabin (when the set gives it): over the desk, the letter in its arms, while
  // the visitor looks in; then out through the hole, and up and away toward the stern.
  let DESK = null, HOLE = null, GONE = null;
  if (wreck) {
    const out = wreck.cabinFacing, bow = new Vector3(out.z, 0, -out.x).normalize();
    // at the desk's end nearer the bow, out from under the lantern, a little toward the hole
    DESK = wreck.envelope.clone().addScaledVector(bow, 0.62).addScaledVector(out, 0.3).add(new Vector3(0, 0.22, 0));
    HOLE = wreck.cabin.clone().addScaledVector(out, 4.2).add(new Vector3(0, 0.2, 0));
    GONE = HOLE.clone().add(new Vector3(0, 3.2, 0)).addScaledVector(new Vector3(-out.z, 0, out.x).normalize(), 3.5);
    if (GONE.z < HOLE.z) GONE.addScaledVector(new Vector3(-out.z, 0, out.x).normalize(), -7);   // (toward the stern, +z)
  }
  const setSlot = (n, pos, fwd, up, size, phase, look) => {
    const a = POSE.array;
    a[n * 3].set(pos.x, pos.y, pos.z, size);
    a[n * 3 + 1].set(fwd.x, fwd.y, fwd.z, phase);
    a[n * 3 + 2].set(up.x, up.y, up.z, look);
  };
  // level, banked by `roll` into a turn
  const frame = (fwd, roll) => {
    R.crossVectors(fwd, Y).normalize();
    Upv.crossVectors(R, fwd).normalize().multiplyScalar(Math.cos(roll)).addScaledVector(R, Math.sin(roll));
  };
  // a loop: centre, radii (across, along), seconds a lap, phase, how far it rises and falls
  const loop = (out, c, ra, rb, period, ph, bob, t) => {
    const th = (TAU * t) / period + ph;
    return out.set(c[0] + ra * Math.cos(th), c[1] + bob * Math.sin(2 * th + ph), c[2] + rb * Math.sin(th));
  };
  // a creature that goes where at(t) says, faces the way it goes, and banks into its turns
  const glide = (n, at, size, phase, look, bank) => (t) => {
    at(t + 0.5, Q); at(t - 0.5, W); at(t, P);
    F.subVectors(Q, W).normalize();
    const lat = ((Q.x + W.x - 2 * P.x) * -F.z + (Q.z + W.z - 2 * P.z) * F.x) / 0.25;
    frame(F, Math.max(-0.4, Math.min(0.4, lat * bank)));
    setSlot(n, P, F, Upv, size, phase, look);
  };
  const reefTurtle = glide(0, (t, o) => { loop(o, reefMid, 1.5, 21, 84, 1.0, 0, t); o.y = floorY(o.z) + 4.2 + 0.4 * Math.sin(t * 0.3); }, 1.35, 0.3, 0, 0.8);
  const turtleEnd = [endAt[0] + 0.6, endAt[1], endAt[2]], octopusEnd = [endAt[0] - 1.8, endAt[1] - 0.9, endAt[2] + 2.5];
  const endTurtle = glide(1, (t, o) => loop(o, turtleEnd, 3.2, 1.2, 46, 0.3, 0.3, t), 0.95, 0.7, 1, 0.6);
  const endOctopus = glide(3, (t, o) => loop(o, octopusEnd, 1.2, 0.8, -38, 2.2, 0.25, t), 0.85, 0.6, 0, 0.2);
  const angler = glide(4, (t, o) => loop(o, anglerAt, 1.2, 0.8, 34, 0, 0.3, t), 1.25, 0.5, 0, 0.3);

  return {
    update(t, dt, p) {
      const e = camera.matrixWorld.elements;
      U.right.value.set(e[0], e[1], e[2]);
      U.up.value.set(e[4], e[5], e[6]);
      U.pix.value = (2 * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(engine.height, 1);
      dust.visible = camera.position.y < -45;
      snow.visible = camera.position.y < 0.5;
      reefTurtle(t); endTurtle(t); endOctopus(t); angler(t);
      // the octopus with the letter: in the cabin when there is one (see DESK), else to the
      // left of the view from p 4.45 to 5, a few metres ahead; bobbing and turned to the camera
      let size = 1.5;
      if (DESK) {
        const out = smooth(4.62, 4.74, p), away = smooth(4.74, 4.98, p);
        P.copy(DESK).lerp(HOLE, out).lerp(GONE, away);
        size = 0.95 + 0.4 * out;
      } else {
        const pv = Math.min(Math.max(p, 4.45), 5.0), away = smooth(4.85, 5.0, pv);
        aheadTo(P, pv, 3.8 + 1.5 * away, -1.2 - 3.6 * away, -0.8 + 1.0 * away);
      }
      P.y += 0.08 * Math.sin(t * 0.8);
      F.set(camera.position.x - P.x, (camera.position.y - P.y) * 0.3, camera.position.z - P.z).normalize();
      frame(F, 0.05 * Math.sin(t * 0.6));
      setSlot(2, P, F, Upv, size, 0.1, 0);
      octopus.copy(P).addScaledVector(Upv, 0.6);
    },
    octopus,
  };
}

// (for dev pages: the pieces, to look at one creature at a time)
export const faunaParts = { FISH, COL, KINDS, fishShape, fishMaterial, fishMesh, turtleShape, turtleMaterial, octopusShape, octopusMaterial, anglerShape, anglerMaterial, copies, solid, POSE };
