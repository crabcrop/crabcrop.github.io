import * as THREE from 'three';
import { media, url, loadPicture, inflate, fromBase64 } from '../media';
import { LOOK, LOOK_GLSL } from './look';
import type { Stage } from './stage';
import { SNAP_SHARP } from '../first-view';

/**
 * Snap in 3D: Tripo's model of the pose-2 painting with the chain edited
 * out, seen as in the painting. It comes in his rig frame: x right, y up, z
 * toward the viewer, in his heights on the chain, from the point in his
 * raised claw the chain runs through. So the chain, drawn at z = 0, passes
 * through that claw and hangs in front of his legs, and the depth buffer
 * sorts out which is in front.
 *
 * He hangs from that point on the chain, flies centred on his middle, or
 * stands with his feet on the pier, a card or the sand. He is brought to
 * life in the vertex shader. Each limb (two eye stalks, the raised claw, the
 * other claw, seven legs) swings about its root, more toward its tip: his
 * legs paddle or walk, his stalks sway and lag behind the swing, either claw
 * waves, and the pincer of the raised claw snaps shut. His eyes turn in their
 * stalks toward the cursor (or whatever he watches), coral lids come down
 * when he blinks and half close when he is happy. Below the
 * water's surface he takes on the water's colour, with a line of foam where
 * it meets him.
 */

const N_LIMBS = 12;
/** The raised claw (it holds the chain) and the other one, in media.snap3d.limbs. */
const CLAW = 2, FREE = 3;
// Scratch values for each frame's eye work.
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _rest = new THREE.Vector3(), _want = new THREE.Vector3(), _axis = new THREE.Vector3(), _rs = new THREE.Vector3();

const VERT_HEAD = /* glsl */ `
attribute vec3 rig;
attribute float thumb;
uniform vec3 uPivot[${N_LIMBS}];
uniform vec3 uRot[${N_LIMBS}];
uniform vec3 uEyeC[2];
uniform vec3 uEyeRot[2];
uniform vec3 uEyeRest[2];
uniform float uEyeR, uEyeGrow;
uniform vec3 uThumbPivot, uThumbRot;
varying vec4 vEye;
// Rotate v by the rotation vector r (axis times angle).
vec3 rotv(vec3 v, vec3 r) {
  float a = length(r);
  if (a < 1e-5) return v;
  vec3 k = r / a;
  float c = cos(a), s = sin(a);
  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);
}
void main() {`;

// rig: limb (255 for the body), how far out along it (0 to 255), how much of the eye ball (0 to 255).
// thumb: how much of the raised claw's pincer, which closes on its own pivot first.
const VERT_RIG = /* glsl */ `
#include <beginnormal_vertex>
  vec3 rigP = position;
  vEye = vec4(0.0);
  int li = int(rig.x + 0.5);
  if (li < ${N_LIMBS}) {
    if (li == ${CLAW} && thumb > 0.0) {
      vec3 rt = uThumbRot * thumb;
      rigP = uThumbPivot + rotv(rigP - uThumbPivot, rt);
      objectNormal = rotv(objectNormal, rt);
    }
    vec3 r = uRot[li] * (rig.y / 255.0);
    rigP = uPivot[li] + rotv(rigP - uPivot[li], r);
    objectNormal = rotv(objectNormal, r);
    if (li < 2 && rig.z > 0.0) {
      float e = rig.z / 255.0;
      vec3 c = li == 0 ? uEyeC[0] : uEyeC[1];
      vec3 re = (li == 0 ? uEyeRot[0] : uEyeRot[1]) * e;
      rigP = c + rotv(rigP - c, re) * (1.0 + uEyeGrow * e);
      objectNormal = rotv(objectNormal, re);
      // Where on its ball, at rest, for the lids.
      vEye = vec4((position - (li == 0 ? uEyeRest[0] : uEyeRest[1])) / uEyeR, e);
    }
  }`;

const FRAG_HEAD = /* glsl */ `
uniform vec3 uGrade, uKeyDir, uLid, uDeep, uSea;
uniform float uFade, uKey, uFill, uUnder, uBlink, uSquint, uWater, uSub, uTime, uDpr;
varying vec4 vEye;
${LOOK_GLSL}
void main() {`;

// A blink: a coral lid comes down over each eye from the top of its ball, with
// a dark edge. Happy, the lower lid comes up too, highest in the middle, so
// what shows of each eye is a smiling crescent.
const FRAG_LID = /* glsl */ `
#include <map_fragment>
  if (vEye.w > 0.5) {
    float top = max(uBlink, uSquint * 0.5);
    float bot = uSquint * 0.45;
    if (top > 0.0 || bot > 0.0) {
      float lineT = 1.05 - top * 2.2;
      float lineB = -1.05 + bot * 1.5;
      float on = smoothstep(0.5, 0.8, vEye.w);
      float lid = max(smoothstep(lineT - 0.05, lineT + 0.05, vEye.y), 1.0 - smoothstep(lineB - 0.05, lineB + 0.05, vEye.y)) * on;
      float front = smoothstep(-0.2, 0.3, vEye.z);
      float edge = ((1.0 - smoothstep(0.0, 0.08, abs(vEye.y - lineT))) * step(0.02, top) + (1.0 - smoothstep(0.0, 0.08, abs(vEye.y - lineB))) * step(0.02, bot)) * on * front;
      // the lids are yarn too: a little stitch pattern
      vec3 yarn = uLid * (0.88 + 0.12 * sin(vEye.x * 34.0) * sin(vEye.y * 34.0 + vEye.x * 9.0));
      diffuseColor.rgb = mix(diffuseColor.rgb, yarn, lid) * (1.0 - 0.45 * min(edge, 1.0));
    }
  }`;

// His own soft light, the painting's, whatever the zone (the zone's tint comes
// from uGrade, as for every flat layer): a key from the upper left and a broad
// fill from above. His texture already holds the painting's shading, so the
// fill does most of the work. The scene's lights still give his bead eyes their
// glints. The camera is unrotated, so view space is world space.
const FRAG_LIGHT = /* glsl */ `
#include <lights_fragment_end>
  {
    vec3 nv = normalize(normal);
    float key = max(dot(nv, uKeyDir), 0.0);
    float fill = mix(uUnder, 1.0, 0.5 + 0.5 * nv.y);
    reflectedLight.directDiffuse = material.diffuseColor * uKey * key;
    reflectedLight.indirectDiffuse = material.diffuseColor * uFill * fill;
  }`;

/** The colour of the water at the morning marina, which he takes on below its surface. */
export const SEA = [0.36, 0.76, 0.79] as const;

// The zone's grade and look; under the water's surface (uWater, device px from
// the bottom, with a ripple), the water's colour, and foam along the line.
const FRAG_OUT = /* glsl */ `
#include <dithering_fragment>
  gl_FragColor.rgb = applyLook(gl_FragColor.rgb * uGrade);
  if (uSub > 0.0) {
    float wy = uWater + sin(gl_FragCoord.x / uDpr * 0.045 + uTime * 2.2) * 1.8 * uDpr;
    float below = 1.0 - smoothstep(wy - uDpr, wy + uDpr, gl_FragCoord.y);
    vec3 deep = mix(gl_FragColor.rgb, uSea, 0.3) * uDeep;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, deep, below * uSub);
    float foam = (1.0 - smoothstep(0.0, 2.4 * uDpr, abs(gl_FragCoord.y - wy))) * uSub;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.93, 0.98, 1.0), foam * 0.6);
  }
  gl_FragColor.a *= uFade;`;

/**
 * One frame's life. kick: how hard his legs paddle (0 to 1); swingV: the
 * swing's speed; mouse: the cursor; look: something to watch instead of it
 * (screen px); blink and squint (happy eyes), 0 to 1. walk: the walk cycle's
 * phase while he walks; planted: standing, so his legs stay still; hello:
 * waving the raised claw; wave: waving the other one; hold: the other one
 * lifted, with something in it; snap: how far through a double snap of his
 * pincer (0 for none); surprise: stalks thrown back, eyes wide. All 0 to 1
 * unless said.
 */
export interface Life {
  t: number; dt: number; kick: number; swingV: number; mouse: [number, number] | null; blink: number;
  look?: [number, number] | null; squint?: number; walk?: number; planted?: boolean;
  hello?: number; wave?: number; hold?: number; snap?: number; surprise?: number;
}

/**
 * Where he is, as a screen point (px, y down): his chain point when he hangs,
 * his middle when he flies, the middle of his feet when he stands; h is his
 * height. roll turns him in the picture, spin about his up (the chain when he
 * hangs), tumble head over heels; squash flattens him (negative stretches).
 */
export interface Pose { at: [number, number]; h: number; roll: number; spin: number; squash: number; mode: 'hang' | 'air' | 'stand'; tumble?: number }

export class Snap3D {
  readonly group = new THREE.Group();
  /** Turns about his up (through the chain when he hangs). */
  private turn = new THREE.Group();
  /** Puts his chain point, middle or feet at the turn's centre. */
  private offset = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private readonly u = {
    uGrade: { value: new THREE.Vector3(1, 1, 1) }, uFade: { value: 1 },
    uKeyDir: { value: new THREE.Vector3(-0.55, 0.85, 1).normalize() },
    uKey: { value: 0.5 }, uFill: { value: 0.906 }, uUnder: { value: 0.7 },
    uPivot: { value: Array.from({ length: N_LIMBS }, () => new THREE.Vector3()) },
    uRot: { value: Array.from({ length: N_LIMBS }, () => new THREE.Vector3()) },
    uEyeC: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    uEyeRot: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    uEyeRest: { value: [new THREE.Vector3(), new THREE.Vector3()] },
    uEyeR: { value: 0.09 }, uEyeGrow: { value: 0 },
    uThumbPivot: { value: new THREE.Vector3() }, uThumbRot: { value: new THREE.Vector3() },
    uBlink: { value: 0 }, uSquint: { value: 0 },
    uLid: { value: new THREE.Color(0.6, 0.06, 0.055) },
    uWater: { value: -1e5 }, uSub: { value: 0 }, uTime: { value: 0 }, uDpr: { value: 1 },
    uDeep: { value: new THREE.Vector3(0.92, 1.0, 1.0) }, uSea: { value: new THREE.Vector3(...SEA) },
    ...LOOK,
  };
  /** Per limb: two axes across it, for its swing, and its tip. */
  private axes: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];
  private tips: THREE.Vector3[] = [];
  /** How far out along its stalk each eye's centre sits (0 to 1). */
  private eyeW = [0.8, 0.8];
  private look = [new THREE.Vector3(), new THREE.Vector3()];
  private sway = 0;
  /** The middle of his feet, in his rig frame. */
  readonly foot = new THREE.Vector3(0.3, -0.68, 0);
  private water: { y: number; sub: number; sea: readonly [number, number, number] } = { y: 1e5, sub: 0, sea: SEA };
  ready = false;
  private loading: Promise<void> | null = null;

  constructor(private stage: Stage, private anisotropy = Math.min(8, stage.renderer.capabilities.getMaxAnisotropy())) {
    this.group.add(this.turn);
    this.turn.add(this.offset);
    this.group.visible = false;
    stage.scene.add(this.group);
  }

  /**
   * The shape ships as base64 text (the preview host serves no binary
   * files) and the texture as its own picture, AVIF or WebP, loaded through
   * an image element like every other picture: the 1024 px one where he is
   * drawn small enough that it shows all there is to see (tall is his
   * greatest height on screen, in device pixels). A failed load can be
   * tried again.
   */
  load(tall = 0) {
    if (this.ready) return Promise.resolve();
    this.loading ??= this.build(tall).catch((e) => {
      this.loading = null;
      console.warn('dive: 3D Snap did not load', e);
      throw e;
    });
    return this.loading;
  }

  private async build(tall: number) {
    const s = media.snap3d;
    const [text, img] = await Promise.all([
      fetch(url('snap-3d.txt')).then((r) => { if (!r.ok) throw new Error(`snap-3d: ${r.status}`); return r.text(); }),
      loadPicture(tall > SNAP_SHARP ? 'snap-3d' : 'snap-3d-1024'),
    ]);
    // The pack (encode-media.py writes it): every column of the vertices is a
    // stream of differences from the vertex before, zigzag, its low bytes and
    // then, for a wide one, its high bytes; a narrow stream wraps at 256.
    const raw = await inflate(fromBase64(text.trim()));
    const n = s.n, ni = s.tris * 3, top = (1 << s.bits) - 1;
    let at = 0;
    const stream = (wide: boolean) => {
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
    // Positions over his box.
    const pos = new Float32Array(n * 3);
    for (let c = 0; c < 3; c++) {
      const q = stream(true);
      for (let i = 0; i < n; i++) pos[i * 3 + c] = s.lo[c] + (q[i] / top) * (s.hi[c] - s.lo[c]);
    }
    // Normals, folded onto a square (octahedral): unfold them.
    const qn = new Int8Array(n * 3);
    const ox = stream(false), oy = stream(false);
    for (let i = 0; i < n; i++) {
      let x = (ox[i] - 127) / 127, y = (oy[i] - 127) / 127;
      const z = 1 - Math.abs(x) - Math.abs(y), t = Math.max(-z, 0);
      x += x >= 0 ? -t : t;
      y += y >= 0 ? -t : t;
      const k = 127 / Math.hypot(x, y, z);
      qn[i * 3] = Math.round(x * k); qn[i * 3 + 1] = Math.round(y * k); qn[i * 3 + 2] = Math.round(z * k);
    }
    const qu = new Uint16Array(n * 2);
    for (let c = 0; c < 2; c++) {
      const q = stream(true);
      for (let i = 0; i < n; i++) qu[i * 2 + c] = Math.round((q[i] / top) * 65535);
    }
    const rig = new Uint8Array(n * 3);
    for (let c = 0; c < 3; c++) {
      const q = stream(false);
      for (let i = 0; i < n; i++) rig[i * 3 + c] = q[i];
    }
    // The triangles: each index is how far back it is from the next unused vertex (0 takes that one), a varint.
    const index = new Uint16Array(ni);
    for (let i = 0, unused = 0; i < ni; i++) {
      let back = 0, shift = 0, b;
      do { b = raw[at++]; back |= (b & 127) << shift; shift += 7; } while (b & 128);
      index[i] = back ? unused - back : unused++;
    }
    // The raised claw's pincer: the small ball right of its notch, which swings shut onto the
    // big lobe about the point where the two meet.
    const thumb = new Float32Array(n);
    const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const ball = new THREE.Vector3();
    let bw = 0;
    for (let i = 0; i < n; i++) {
      if (rig[i * 3] === CLAW && pos[i * 3] > 0.045 && pos[i * 3 + 1] > -0.03) { ball.x += pos[i * 3]; ball.y += pos[i * 3 + 1]; ball.z += pos[i * 3 + 2]; bw++; }
    }
    if (bw) {
      ball.divideScalar(bw);
      const d = [];
      for (let i = 0; i < n; i++) if (rig[i * 3] === CLAW && pos[i * 3] > 0.045 && pos[i * 3 + 1] > -0.03) d.push(Math.hypot(pos[i * 3] - ball.x, pos[i * 3 + 1] - ball.y, pos[i * 3 + 2] - ball.z));
      d.sort((a, b) => a - b);
      const r = d[d.length >> 1];
      for (let i = 0; i < n; i++) {
        if (rig[i * 3] !== CLAW) continue;
        thumb[i] = 1 - sm(r * 0.85, r * 1.35, Math.hypot(pos[i * 3] - ball.x, pos[i * 3 + 1] - ball.y, pos[i * 3 + 2] - ball.z));
      }
      this.u.uThumbPivot.value.set(ball.x - r * 0.8, ball.y - r * 0.6, ball.z);
    }
    // His feet: the lowest part of him.
    const f = new THREE.Vector3();
    let fw = 0;
    for (let i = 0; i < n; i++) {
      if (pos[i * 3 + 1] < s.lo[1] + 0.03) { f.x += pos[i * 3]; f.z += pos[i * 3 + 2]; fw++; }
    }
    if (fw) this.foot.set(f.x / fw, s.lo[1], f.z / fw);
    // Each limb's tip: its farthest-out vertex.
    const best = s.limbs.map(() => -1), tip = s.limbs.map(() => new THREE.Vector3());
    for (let i = 0; i < n; i++) {
      const k = rig[i * 3];
      if (k < s.limbs.length && rig[i * 3 + 1] > best[k]) { best[k] = rig[i * 3 + 1]; tip[k].set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); }
    }
    this.tips = tip;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(qn, 3, true));
    geo.setAttribute('uv', new THREE.BufferAttribute(qu, 2, true));
    geo.setAttribute('rig', new THREE.BufferAttribute(rig, 3));
    geo.setAttribute('thumb', new THREE.BufferAttribute(thumb, 1));
    geo.setIndex(new THREE.BufferAttribute(index, 1));

    const map = new THREE.Texture(img);
    map.flipY = false;                                  // glTF's uv convention
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = this.anisotropy;
    map.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({ map, roughness: 0.9, metalness: 0, transparent: true });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.u);
      sh.vertexShader = sh.vertexShader
        .replace('void main() {', VERT_HEAD)
        .replace('#include <beginnormal_vertex>', VERT_RIG)
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed = rigP;');
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', FRAG_HEAD)
        .replace('#include <map_fragment>', FRAG_LID)
        // His eyes are glossy black beads.
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, 0.22, 1.0 - smoothstep(0.03, 0.09, max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b)));')
        .replace('#include <lights_fragment_end>', FRAG_LIGHT)
        .replace('#include <dithering_fragment>', FRAG_OUT);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 5;
    mesh.frustumCulled = false;
    this.offset.add(mesh);
    this.mesh = mesh;
    // (his shader is ready before he first shows)
    await this.stage.warm(mesh);

    // The limbs' pivots and swing axes, and where each eye's centre sits along its stalk.
    const up = new THREE.Vector3(0, 1, 0), z = new THREE.Vector3(0, 0, 1);
    s.limbs.forEach((L, i) => {
      this.u.uPivot.value[i].set(...L.pivot);
      const d = new THREE.Vector3(...L.dir);
      const a = new THREE.Vector3().crossVectors(d, Math.abs(d.y) > 0.9 ? z : up).normalize();
      const b = new THREE.Vector3().crossVectors(d, a).normalize();
      this.axes.push({ a, b });
    });
    s.eyes.forEach((e, k) => { this.u.uEyeRest.value[k].set(...e.c); this.u.uEyeR.value = e.r; });
    for (const k of [0, 1]) {
      let sum = 0, cnt = 0;
      for (let i = 0; i < n; i++) if (rig[i * 3] === k && rig[i * 3 + 2] > 240) { sum += rig[i * 3 + 1]; cnt++; }
      if (cnt) this.eyeW[k] = sum / cnt / 255;
    }
    this.ready = true;
  }

  /** His chain point on screen, for a pose (ignoring its roll and spin). */
  grip(p: Pose): [number, number] {
    const h = p.h;
    if (p.mode === 'hang') return [p.at[0], p.at[1]];
    if (p.mode === 'stand') return [p.at[0] - this.foot.x * h, p.at[1] + this.foot.y * h];
    const [cx, cy] = Snap3D.centre(h);
    return [p.at[0] - cx, p.at[1] - cy];
  }

  /** His front box on screen in a pose. */
  box(p: Pose) {
    const b = media.snap3d.box, [x, y] = this.grip(p), h = p.h;
    return { x: x + b[0] * h, y: y - b[3] * h, w: (b[2] - b[0]) * h, h: (b[3] - b[1]) * h };
  }

  /** His middle, from his chain point, px (y down), when he is h tall. */
  static centre(h: number): [number, number] {
    const { lo, hi } = media.snap3d;
    return [((lo[0] + hi[0]) / 2) * h, -((lo[1] + hi[1]) / 2) * h];
  }

  /** His middle, from the middle of his feet, px (y down), when he is h tall. */
  standCentre(h: number): [number, number] {
    const [cx, cy] = Snap3D.centre(h);
    return [cx - this.foot.x * h, cy + this.foot.y * h];
  }

  /** Where a point of his (rig frame, at rest) is on screen this frame. */
  screenOf(v: THREE.Vector3): [number, number] {
    const m = this.mesh;
    if (!m) return [0, 0];
    m.updateWorldMatrix(true, false);
    _v.copy(v).applyMatrix4(m.matrixWorld);
    return [_v.x, -_v.y];
  }
  /** The tip of the free claw, and of the raised one, on screen. */
  freeClaw() { return this.screenOf(this.tips[FREE] ?? new THREE.Vector3()); }
  pincer() { return this.screenOf(this.tips[CLAW] ?? new THREE.Vector3()); }

  /** The water's surface on screen (px from the top), how much of the water's colour he takes below it (0 to 1), and that colour (the morning marina's unless given). */
  setWater(y: number | null, sub: number, sea: readonly [number, number, number] = SEA) { this.water = { y: y ?? -1e5, sub: y == null ? 0 : sub, sea }; }

  hide() { this.group.visible = false; }

  /** One frame: his pose, his life, the zone's grade. */
  update(p: Pose, life: Life, grade: [number, number, number], fade = 1) {
    const m = this.mesh;
    this.group.visible = !!m && fade > 0.001;
    if (!this.group.visible || !m) return;
    const { lo, hi } = media.snap3d, h = p.h;
    this.group.position.set(p.at[0], -p.at[1], 0);
    this.group.rotation.set(0, 0, p.roll);
    this.group.scale.set(1 + p.squash * 0.6, 1 - p.squash, 1);
    this.turn.rotation.set(p.tumble ?? 0, p.spin, 0);
    if (p.mode === 'air') this.offset.position.set((-(lo[0] + hi[0]) / 2) * h, (-(lo[1] + hi[1]) / 2) * h, (-(lo[2] + hi[2]) / 2) * h);
    else if (p.mode === 'stand') this.offset.position.set(-this.foot.x * h, -this.foot.y * h, -this.foot.z * h);
    else this.offset.position.set(0, 0, 0);
    // A slow breath.
    m.scale.setScalar(h * (1 + Math.sin(life.t * 1.6) * 0.008));
    this.u.uGrade.value.set(...grade);
    this.u.uFade.value = fade;
    const dpr = this.stage.dpr;
    this.u.uDpr.value = dpr;
    this.u.uTime.value = life.t;
    this.u.uWater.value = (this.stage.h - this.water.y) * dpr;
    this.u.uSub.value = this.water.sub;
    this.u.uSea.value.set(...this.water.sea);
    this.live(life);
  }

  /** The limbs and eyes for this frame. */
  private live(o: Life) {
    const s = media.snap3d, U = this.u, t = o.t;
    const rot = U.uRot.value;
    // The stalks lag behind the swing.
    this.sway += (-o.swingV * 0.12 - this.sway) * Math.min(1, o.dt * 5);
    const surprise = o.surprise ?? 0, hello = o.hello ?? 0, wave = o.wave ?? 0;
    const walking = o.walk != null;
    const legW = 4.2 + o.kick * 7;
    // A double snap of the pincer: shut, open, shut, open.
    const shut = o.snap ? Math.max(0, Math.sin(o.snap * Math.PI * 4)) : 0;
    let leg = 0;
    s.limbs.forEach((L, i) => {
      const { a, b } = this.axes[i], r = rot[i];
      if (L.kind === 'stalk') {
        r.set(Math.sin(t * 2.1 + 1 + i) * 0.05 - surprise * 0.3, 0, Math.sin(t * 1.25 + i * 1.7) * 0.07 + this.sway + (i ? -1 : 1) * surprise * 0.08);
      } else if (L.kind === 'leg') {
        if (walking) {
          // Walking sideways: the legs swing across in two alternating sets, each lifting as it swings.
          const ph = o.walk! + (leg++ % 2) * Math.PI;
          r.set(0, 0, Math.sin(ph) * 0.34).addScaledVector(a, Math.max(0, Math.cos(ph)) * 0.28);
        } else if (o.planted) {
          // Standing: only the slightest shift of weight.
          r.copy(b).multiplyScalar(Math.sin(t * 0.9 + leg++ * 1.3) * 0.03);
        } else {
          // Paddling: each tip runs round a small ellipse, one leg after the next.
          const ph = t * legW - leg++ * 0.95;
          const amp = 0.2 + o.kick * 0.32;
          r.copy(b).multiplyScalar(Math.sin(ph) * amp).addScaledVector(a, Math.cos(ph) * amp * 0.45);
        }
      } else if (i === FREE) {
        // At rest it shifts a little; waving, it swings out from his side and to and fro.
        r.copy(b).multiplyScalar((Math.sin(t * 1.7) * 0.07 + Math.sin(t * 0.6) * 0.04) * (1 - wave));
        r.x += -0.6 * wave - 0.3 * (o.hold ?? 0);
        r.y += 1.3 * wave + 0.45 * (o.hold ?? 0);
        r.z += Math.sin(t * 13) * 0.4 * wave;
      } else if (i === CLAW) {
        // Waving hello, and a twitch with each snap.
        r.set(-0.12 * hello, 0, Math.sin(t * 10.5) * 0.32 * hello + shut * 0.06);
      } else {
        r.set(0, 0, 0);
      }
    });
    U.uThumbRot.value.set(0, 0, shut * 0.7);
    U.uEyeGrow.value = surprise * 0.16;
    // Each eye turns toward what he looks at, within a cone, after its stalk's own swing.
    const mesh = this.mesh!;
    mesh.updateWorldMatrix(true, false);
    const q = mesh.getWorldQuaternion(_q).invert();
    const v = _v, rest = _rest, want = _want, axis = _axis;
    const target = o.look ?? o.mouse;
    s.eyes.forEach((e, k) => {
      // The eye's centre and its bead's direction, carried by the stalk's swing.
      const piv = U.uPivot.value[k], rs = _rs.copy(rot[k]).multiplyScalar(this.eyeW[k]);
      const ang0 = rs.length();
      const c = U.uEyeC.value[k].set(...e.c);
      rest.set(...e.look);
      if (ang0 > 1e-6) {
        rs.divideScalar(ang0);
        c.sub(piv).applyAxisAngle(rs, ang0).add(piv);
        rest.applyAxisAngle(rs, ang0);
      }
      if (target) {
        v.copy(c);
        mesh.localToWorld(v);
        const dx = target[0] - v.x, dy = target[1] + v.y;      // screen y is down, world y up
        const d = Math.hypot(dx, dy) || 1, f = Math.min(1, d / 260) / d;
        want.set(dx * f * 0.75, -dy * f * 0.75, 1).normalize().applyQuaternion(q);
      } else {
        want.set(Math.sin(t * 0.5 + k) * 0.35, Math.cos(t * 0.37) * 0.18 - 0.1, 1).normalize().applyQuaternion(q);
      }
      // From the bead's rest direction to the wanted one, at most about 32 degrees.
      axis.crossVectors(rest, want);
      const ang = Math.min(0.56, Math.acos(THREE.MathUtils.clamp(rest.dot(want), -1, 1)));
      const turnTo = axis.lengthSq() > 1e-10 ? axis.normalize().multiplyScalar(ang) : axis.set(0, 0, 0);
      this.look[k].lerp(turnTo, Math.min(1, o.dt * 9));
      U.uEyeRot.value[k].copy(this.look[k]);
    });
    U.uBlink.value = surprise > 0.3 ? 0 : o.blink;
    U.uSquint.value += ((o.squint ?? 0) - U.uSquint.value) * Math.min(1, o.dt * 10);
  }
}
