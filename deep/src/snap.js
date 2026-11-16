// Snap, from his own 3D model: the one thing in the dive that is not made by the page.
// The model is a pack (snap.bin: deflated vertices, normals, uvs, rig bytes, triangles)
// and a texture (snap.avif, or snap.webp where AVIF will not decode), both beside the page.
//
// He comes in his rig frame: x right, y up, z toward the viewer, about one unit tall, from
// a point in his raised claw (where a chain would run). He is brought to life in the vertex
// shader: each limb (two eye stalks, the raised claw, the other claw, seven legs) swings
// about its root, more toward its tip; his legs paddle; his stalks sway and lag; either
// claw waves and the pincer of the raised one snaps; his eyes turn in their stalks toward
// what he watches; coral lids come down when he blinks and half close when he is happy.
import { BufferAttribute, BufferGeometry, Group, Mesh, Quaternion, SRGBColorSpace, Texture, Vector3 } from 'three/webgpu';
import {
  abs, attribute, cameraPosition, cos, cross, dot, float, int, length, max, min, mix, normalize, pow, select, sin, smoothstep, texture,
  uniform, uniformArray, uv, vec3, vec4,
} from 'three/tsl';
import { G, material, sunAt } from './shaders.js';

// What the pack holds (written by the old dive's encode-media.py; see its manifest).
export const META = {
  n: 21258, tris: 35139, bits: 13,
  lo: [-0.13638, -0.68224, -0.57947], hi: [0.73874, 0.30084, 0.30834],
  limbs: [
    { kind: 'stalk', pivot: [0.3641, 0.0841, -0.1064], dir: [0.0556, 0.9548, 0.2921] },
    { kind: 'stalk', pivot: [0.5704, -0.0084, -0.0559], dir: [0.6508, 0.6892, 0.3187] },
    { kind: 'clawL', pivot: [0.1006, -0.0623, -0.1628], dir: [-0.487, 0.2535, 0.8358] },
    { kind: 'clawR', pivot: [0.5529, -0.3346, 0.0101], dir: [-0.2817, -0.0856, 0.9557] },
    { kind: 'leg', pivot: [0.0394, -0.1978, -0.3222], dir: [-0.6238, -0.2276, -0.7478] },
    { kind: 'leg', pivot: [0.0237, -0.3294, -0.271], dir: [-0.58, -0.4417, -0.6845] },
    { kind: 'leg', pivot: [0.0915, -0.44, -0.1934], dir: [-0.8488, -0.5278, 0.0305] },
    { kind: 'leg', pivot: [0.1247, -0.1772, -0.4333], dir: [-0.3701, -0.4028, -0.8371] },
    { kind: 'leg', pivot: [0.3726, -0.5642, -0.1317], dir: [-0.449, -0.8618, 0.2361] },
    { kind: 'leg', pivot: [0.5301, -0.5463, -0.1994], dir: [-0.2537, -0.8042, -0.5376] },
    { kind: 'leg', pivot: [0.5978, -0.4831, -0.2756], dir: [0.314, -0.7736, -0.5504] },
  ],
  eyes: [
    { c: [0.3768, 0.2182, -0.0885], r: 0.0872, look: [0.0364, -0.3552, 0.9341] },
    { c: [0.6554, 0.087, -0.0331], r: 0.0877, look: [-0.5249, -0.1652, 0.835] },
  ],
};
const NL = META.limbs.length, CLAW = 2, FREE = 3;
export const CENTRE = new Vector3((META.lo[0] + META.hi[0]) / 2, (META.lo[1] + META.hi[1]) / 2, (META.lo[2] + META.hi[2]) / 2);

// ---- loading ------------------------------------------------------------------------------

async function inflate(buf) {
  const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function picture(names) {
  for (const n of names) {
    try {
      const r = await fetch(new URL(n, document.baseURI));
      if (!r.ok) continue;
      return await createImageBitmap(await r.blob());
    } catch (e) { /* this format will not decode here: try the next */ }
  }
  throw new Error('snap: no texture decoded');
}

// Read the pack. Every column of the vertices is a stream of differences from the vertex
// before, zigzag, its low bytes and then, for a wide one, its high bytes; a narrow stream
// wraps at 256. Then the triangles: each index is how far back it is from the next unused
// vertex (0 takes that one), a varint.
function decode(raw) {
  const { n, bits, lo, hi } = META, ni = META.tris * 3, top = (1 << bits) - 1;
  let at = 0;
  const stream = (wide) => {
    const out = new Uint16Array(n);
    let v = 0;
    for (let i = 0; i < n; i++) {
      const z = raw[at + i] | (wide ? raw[at + n + i] << 8 : 0);
      v = (v + ((z >>> 1) ^ -(z & 1))) & (wide ? 0xffff : 0xff);
      out[i] = v;
    }
    at += wide ? 2 * n : n;
    return out;
  };
  const pos = new Float32Array(n * 3);
  for (let c = 0; c < 3; c++) { const q = stream(true); for (let i = 0; i < n; i++) pos[i * 3 + c] = lo[c] + (q[i] / top) * (hi[c] - lo[c]); }
  // normals, folded onto a square (octahedral): unfold them
  const nrm = new Float32Array(n * 3);
  const ox = stream(false), oy = stream(false);
  for (let i = 0; i < n; i++) {
    let x = (ox[i] - 127) / 127, y = (oy[i] - 127) / 127;
    const z = 1 - Math.abs(x) - Math.abs(y), t = Math.max(-z, 0);
    x += x >= 0 ? -t : t; y += y >= 0 ? -t : t;
    const k = 1 / Math.hypot(x, y, z);
    nrm[i * 3] = x * k; nrm[i * 3 + 1] = y * k; nrm[i * 3 + 2] = z * k;
  }
  const uvs = new Float32Array(n * 2);
  for (let c = 0; c < 2; c++) { const q = stream(true); for (let i = 0; i < n; i++) uvs[i * 2 + c] = q[i] / top; }
  const rigB = [stream(false), stream(false), stream(false)];
  const index = new Uint16Array(ni);
  for (let i = 0, unused = 0; i < ni; i++) {
    let back = 0, shift = 0, b;
    do { b = raw[at++]; back |= (b & 127) << shift; shift += 7; } while (b & 128);
    index[i] = back ? unused - back : unused++;
  }
  // rig: limb (255 for the body), how far out along it, how much of the eye ball; and
  // the raised claw's pincer: the small ball right of its notch, which swings shut onto
  // the big lobe about the point where the two meet
  const rig = new Float32Array(n * 4);
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const ball = new Vector3();
  let bw = 0;
  const inBall = (i) => rigB[0][i] === CLAW && pos[i * 3] > 0.045 && pos[i * 3 + 1] > -0.03;
  for (let i = 0; i < n; i++) if (inBall(i)) { ball.x += pos[i * 3]; ball.y += pos[i * 3 + 1]; ball.z += pos[i * 3 + 2]; bw++; }
  const thumbPivot = new Vector3();
  let r = 1;
  if (bw) {
    ball.divideScalar(bw);
    const d = [];
    for (let i = 0; i < n; i++) if (inBall(i)) d.push(Math.hypot(pos[i * 3] - ball.x, pos[i * 3 + 1] - ball.y, pos[i * 3 + 2] - ball.z));
    d.sort((a, b) => a - b);
    r = d[d.length >> 1];
    thumbPivot.set(ball.x - r * 0.8, ball.y - r * 0.6, ball.z);
  }
  const eyeW = [0, 0], eyeN = [0, 0];
  for (let i = 0; i < n; i++) {
    const limb = rigB[0][i];
    rig[i * 4] = limb; rig[i * 4 + 1] = rigB[1][i] / 255; rig[i * 4 + 2] = rigB[2][i] / 255;
    rig[i * 4 + 3] = bw && limb === CLAW ? 1 - sm(r * 0.85, r * 1.35, Math.hypot(pos[i * 3] - ball.x, pos[i * 3 + 1] - ball.y, pos[i * 3 + 2] - ball.z)) : 0;
    if (limb < 2 && rigB[2][i] > 240) { eyeW[limb] += rigB[1][i]; eyeN[limb]++; }
  }
  // his feet: the middle of the lowest part of him
  const foot = new Vector3();
  let fw = 0;
  for (let i = 0; i < n; i++) if (pos[i * 3 + 1] < lo[1] + 0.03) { foot.x += pos[i * 3]; foot.z += pos[i * 3 + 2]; fw++; }
  if (fw) foot.set(foot.x / fw, lo[1], foot.z / fw);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('normal', new BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new BufferAttribute(uvs, 2));
  geo.setAttribute('rig', new BufferAttribute(rig, 4));
  geo.setIndex(new BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  return { geo, thumbPivot, foot, eyeW: eyeW.map((w, k) => (eyeN[k] ? w / eyeN[k] / 255 : 0.8)) };
}

// ---- the shader ---------------------------------------------------------------------------

// Rotate v by the rotation vector r (axis times angle). (No branch: at zero it returns v.)
const rotv = (v, r) => {
  const a = length(r);
  const k = r.div(max(a, 1e-5));
  const c = cos(a);
  return v.mul(c).add(cross(k, v).mul(sin(a))).add(k.mul(dot(k, v)).mul(float(1).sub(c)));
};

function snapMaterial(map, U) {
  return material({
    shadow: false,
    vertex: (v) => {
      const rig = attribute('rig', 'vec4');
      const P0 = v.P.toVar(), P = v.P.toVar(), N = v.N.toVar();
      const li = int(rig.x.add(0.5)).toVar();
      // the pincer first, about its own pivot
      const rt = U.thumbRot.mul(rig.w);
      P.assign(U.thumbPivot.add(rotv(P.sub(U.thumbPivot), rt)));
      N.assign(rotv(N, rt));
      // the limb's swing, more toward its tip (the body has no limb: no swing)
      const limb = min(li, int(NL - 1));
      const r = U.rot.element(limb).mul(rig.y).mul(select(rig.x.lessThan(NL - 0.5), float(1), float(0))).toVar();
      const pv = U.pivot.element(limb);
      P.assign(pv.add(rotv(P.sub(pv), r)));
      N.assign(rotv(N, r));
      // the eye balls turn in their stalks, and grow a little in surprise
      const isEye = rig.x.lessThan(1.5).and(rig.z.greaterThan(0.0));
      const ei = min(li, int(1));
      const c = U.eyeC.element(ei), re = U.eyeRot.element(ei).mul(rig.z).toVar();
      const Pe = c.add(rotv(P.sub(c), re).mul(U.eyeGrow.mul(rig.z).add(1.0)));
      P.assign(select(isEye, Pe, P));
      N.assign(select(isEye, rotv(N, re), N));
      // for the lids: where on its ball, at rest, and how much of the ball
      v.aux.assign(select(isEye, vec4(P0.sub(U.eyeRest.element(ei)).div(U.eyeR), rig.z), vec4(0.0)));
      v.P.assign(P);
      v.N.assign(N);
    },
    surface: (s, f) => {
      const col = texture(map, uv()).rgb.toVar();
      // his eyes are glossy black beads
      const dark = float(1).sub(smoothstep(0.03, 0.09, max(col.r, max(col.g, col.b))));
      // a blink: a coral lid comes down over each eye from the top of its ball, with a dark
      // edge; happy, the lower lid comes up too, so each eye is a smiling crescent
      const e = f.aux;
      const top = max(U.blink, U.squint.mul(0.5)), bot = U.squint.mul(0.45);
      const lineT = float(1.05).sub(top.mul(2.2)), lineB = float(-1.05).add(bot.mul(1.5));
      const on = smoothstep(0.5, 0.8, e.w);
      const lid = max(smoothstep(lineT.sub(0.05), lineT.add(0.05), e.y), float(1).sub(smoothstep(lineB.sub(0.05), lineB.add(0.05), e.y))).mul(on).toVar();
      const front = smoothstep(-0.2, 0.3, e.z);
      const edge = float(1).sub(smoothstep(0.0, 0.08, abs(e.y.sub(lineT)))).mul(select(top.greaterThan(0.02), float(1), float(0)))
        .add(float(1).sub(smoothstep(0.0, 0.08, abs(e.y.sub(lineB)))).mul(select(bot.greaterThan(0.02), float(1), float(0)))).mul(on).mul(front);
      const yarn = U.lid.mul(sin(e.x.mul(34.0)).mul(sin(e.y.mul(34.0).add(e.x.mul(9.0)))).mul(0.12).add(0.88));
      col.assign(mix(col, yarn, lid).mul(float(1).sub(min(edge, 1.0).mul(0.45))));
      s.albedo = col.mul(0.92);
      const bead = dark.mul(float(1).sub(lid));
      s.spec = mix(float(0.05), float(1.4), bead); s.gloss = mix(float(10.0), float(90.0), bead);
      s.fluor = float(0.6); s.trans = float(0.12);
      s.caustic = float(0.3);                 // (the caustics' sharp lines would flicker across him)
      // wool catches the light at grazing angles: a soft sheen on his outline; and the
      // cabin light when he sits in the submarine in the dark
      const vv = normalize(cameraPosition.sub(f.w));
      const graze = pow(float(1).sub(abs(dot(f.n, vv))), 3.0);
      s.emis = sunAt(f.w.y).mul(0.05).add(G.amb.mul(0.12)).mul(graze).mul(col).add(col.mul(U.cabin));
    },
  });
}

// ---- Snap ---------------------------------------------------------------------------------

const _q = new Quaternion(), _v = new Vector3(), _rest = new Vector3(), _want = new Vector3(), _axis = new Vector3(), _rs = new Vector3(), _c = new Vector3();

export class Snap {
  constructor() {
    this.group = new Group();          // where he is and which way he faces
    this.mesh = null;
    this.ready = false;
    this.height = 0.6;                 // metres, at scale 1
    this.U = {
      pivot: uniformArray(META.limbs.map((l) => new Vector3(...l.pivot)), 'vec3'),
      rot: uniformArray(META.limbs.map(() => new Vector3()), 'vec3'),
      eyeC: uniformArray([new Vector3(), new Vector3()], 'vec3'),
      eyeRot: uniformArray([new Vector3(), new Vector3()], 'vec3'),
      eyeRest: uniformArray(META.eyes.map((e) => new Vector3(...e.c)), 'vec3'),
      eyeR: uniform(META.eyes[0].r), eyeGrow: uniform(0),
      thumbPivot: uniform(new Vector3()), thumbRot: uniform(new Vector3()),
      blink: uniform(0), squint: uniform(0), lid: uniform(new Vector3(0.6, 0.06, 0.055)), cabin: uniform(0),
    };
    // per limb: two axes across it, for its swing
    this.axes = META.limbs.map((L) => {
      const d = new Vector3(...L.dir);
      const a = new Vector3().crossVectors(d, Math.abs(d.y) > 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)).normalize();
      return { a, b: new Vector3().crossVectors(d, a).normalize() };
    });
    this.eyeW = [0.8, 0.8];
    this.look = [new Vector3(), new Vector3()];
    this.sway = 0;
    this.foot = new Vector3(0.3, META.lo[1], 0);
    // what he is doing: all 0 to 1 unless said
    this.life = { kick: 0.3, walk: -1, planted: 0, hello: 0, wave: 0, hold: 0, snap: 0, surprise: 0, squint: 0, blink: 0, swing: 0 };
    this.target = new Vector3();       // what he looks at, in the world
    this.blinkAt = 2;
  }

  async load(small) {
    const [buf, img] = await Promise.all([
      fetch(new URL('snap.bin', document.baseURI)).then((r) => { if (!r.ok) throw new Error('snap.bin ' + r.status); return r.arrayBuffer(); }),
      picture(small ? ['snap-1024.avif', 'snap-1024.webp'] : ['snap.avif', 'snap.webp']),
    ]);
    const { geo, thumbPivot, foot, eyeW } = decode(await inflate(buf));
    this.U.thumbPivot.value.copy(thumbPivot);
    this.foot.copy(foot);
    this.eyeW = eyeW;
    const map = new Texture(img);
    map.flipY = false;                 // glTF's uv convention
    map.colorSpace = SRGBColorSpace;
    map.anisotropy = 8;
    map.generateMipmaps = true;
    map.needsUpdate = true;
    this.mesh = new Mesh(geo, snapMaterial(map, this.U));
    this.mesh.frustumCulled = false;
    this.mesh.scale.setScalar(this.height);
    this.mesh.position.copy(CENTRE).multiplyScalar(-this.height);     // his middle at the group's origin
    this.group.add(this.mesh);
    this.ready = true;
  }

  // Where the point in his raised claw (his rig's origin, where a chain runs) is in the world.
  gripWorld(out) {
    out.set(0, 0, 0);
    if (!this.mesh) return out.copy(this.group.position);
    this.mesh.updateWorldMatrix(true, false);
    return out.applyMatrix4(this.mesh.matrixWorld);
  }

  // One frame of life: t seconds, dt the frame's length. (mesh: another copy of him that
  // shares his shape and pose, whose eyes should find the target: the photograph's.)
  live(t, dt, mesh = this.mesh) {
    if (!this.ready) return;
    const U = this.U, o = this.life, rot = U.rot.array;
    this.sway += (-o.swing * 0.12 - this.sway) * Math.min(1, dt * 5);
    const surprise = o.surprise, hello = o.hello, wave = o.wave;
    const legW = 4.2 + o.kick * 7;
    // a double snap of the pincer: shut, open, shut, open
    const shut = o.snap ? Math.max(0, Math.sin(o.snap * Math.PI * 4)) : 0;
    let leg = 0;
    for (let i = 0; i < NL; i++) {
      const L = META.limbs[i], { a, b } = this.axes[i], r = rot[i];
      if (L.kind === 'stalk') {
        r.set(Math.sin(t * 2.1 + 1 + i) * 0.05 - surprise * 0.3, 0, Math.sin(t * 1.25 + i * 1.7) * 0.07 + this.sway + (i ? -1 : 1) * surprise * 0.08);
      } else if (L.kind === 'leg') {
        if (o.walk >= 0) {
          // walking sideways: the legs swing across in two alternating sets, each lifting as it swings
          const ph = o.walk + (leg++ % 2) * Math.PI;
          r.set(0, 0, Math.sin(ph) * 0.34).addScaledVector(a, Math.max(0, Math.cos(ph)) * 0.28);
        } else if (o.planted > 0.5) {
          r.copy(b).multiplyScalar(Math.sin(t * 0.9 + leg++ * 1.3) * 0.03);
        } else {
          // paddling: each tip runs round a small ellipse, one leg after the next
          const ph = t * legW - leg++ * 0.95, amp = 0.2 + o.kick * 0.32;
          r.copy(b).multiplyScalar(Math.sin(ph) * amp).addScaledVector(a, Math.cos(ph) * amp * 0.45);
        }
      } else if (i === FREE) {
        r.copy(b).multiplyScalar((Math.sin(t * 1.7) * 0.07 + Math.sin(t * 0.6) * 0.04) * (1 - wave));
        r.x += -0.6 * wave - 0.3 * o.hold;
        r.y += 1.3 * wave + 0.45 * o.hold;
        r.z += Math.sin(t * 13) * 0.4 * wave;
      } else if (i === CLAW) {
        r.set(-0.12 * hello, 0, Math.sin(t * 10.5) * 0.32 * hello + shut * 0.06);
      } else r.set(0, 0, 0);
    }
    U.thumbRot.value.set(0, 0, shut * 0.7);
    U.eyeGrow.value = surprise * 0.16;
    // each eye turns toward what he watches, within a cone, after its stalk's own swing
    mesh.updateWorldMatrix(true, false);
    const q = mesh.getWorldQuaternion(_q).invert();
    for (let k = 0; k < 2; k++) {
      const e = META.eyes[k], piv = U.pivot.array[k], rs = _rs.copy(rot[k]).multiplyScalar(this.eyeW[k]);
      const ang0 = rs.length();
      const c = U.eyeC.array[k].set(e.c[0], e.c[1], e.c[2]);
      _rest.set(e.look[0], e.look[1], e.look[2]);
      if (ang0 > 1e-6) { rs.divideScalar(ang0); c.sub(piv).applyAxisAngle(rs, ang0).add(piv); _rest.applyAxisAngle(rs, ang0); }
      _c.copy(c);
      mesh.localToWorld(_c);
      _want.copy(this.target).sub(_c).normalize().applyQuaternion(q);
      // from the bead's rest direction to the wanted one, at most about 32 degrees
      _axis.crossVectors(_rest, _want);
      const ang = Math.min(0.56, Math.acos(Math.min(1, Math.max(-1, _rest.dot(_want)))));
      if (_axis.lengthSq() > 1e-10) _axis.normalize().multiplyScalar(ang); else _axis.set(0, 0, 0);
      this.look[k].lerp(_axis, Math.min(1, dt * 9));
      U.eyeRot.array[k].copy(this.look[k]);
    }
    // a blink every few seconds, a sixth of a second long
    if (t > this.blinkAt + 0.1 || t < this.blinkAt - 6) this.blinkAt = t + 2.2 + ((t * 7.31) % 3);
    o.blink = Math.max(0, 1 - Math.abs(t - this.blinkAt) / 0.08) * (surprise > 0.3 ? 0 : 1);
    U.blink.value = o.blink;
    U.squint.value += (o.squint - U.squint.value) * Math.min(1, dt * 10);
  }
}
