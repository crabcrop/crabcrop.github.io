import * as THREE from 'three';
import { media, url, loadPicture } from '../media';
import { LOOK, LOOK_GLSL } from './look';
import type { Stage } from './stage';

/**
 * Snap in 3D: Tripo's model of the pose-2 painting with the chain edited
 * out, seen as in the painting. It comes in his rig frame: x right, y up, z
 * toward the viewer, in his heights on the chain, from the point in his
 * raised claw the chain runs through. So the chain, drawn at z = 0, passes
 * through that claw and hangs in front of his legs, and the depth buffer
 * sorts out which is in front.
 *
 * He is brought to life in the vertex shader. Each limb (two eye stalks,
 * the claw on the chain, the other claw, seven legs) swings about its root,
 * more toward its tip: his legs paddle, his stalks sway and lag behind the
 * swing, the free claw waves a little. His eyes turn in their stalks toward
 * the cursor, and a coral lid comes down over them when he blinks.
 */

const N_LIMBS = 12;
// Scratch values for each frame's eye work.
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _rest = new THREE.Vector3(), _want = new THREE.Vector3(), _axis = new THREE.Vector3(), _rs = new THREE.Vector3();

const VERT_HEAD = /* glsl */ `
attribute vec3 rig;
uniform vec3 uPivot[${N_LIMBS}];
uniform vec3 uRot[${N_LIMBS}];
uniform vec3 uEyeC[2];
uniform vec3 uEyeRot[2];
uniform vec3 uEyeRest[2];
uniform float uEyeR;
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
const VERT_RIG = /* glsl */ `
#include <beginnormal_vertex>
  vec3 rigP = position;
  vEye = vec4(0.0);
  int li = int(rig.x + 0.5);
  if (li < ${N_LIMBS}) {
    vec3 r = uRot[li] * (rig.y / 255.0);
    rigP = uPivot[li] + rotv(rigP - uPivot[li], r);
    objectNormal = rotv(objectNormal, r);
    if (li < 2 && rig.z > 0.0) {
      float e = rig.z / 255.0;
      vec3 c = li == 0 ? uEyeC[0] : uEyeC[1];
      vec3 re = (li == 0 ? uEyeRot[0] : uEyeRot[1]) * e;
      rigP = c + rotv(rigP - c, re);
      objectNormal = rotv(objectNormal, re);
      // Where on its ball, at rest, for the lid.
      vEye = vec4((position - (li == 0 ? uEyeRest[0] : uEyeRest[1])) / uEyeR, e);
    }
  }`;

const FRAG_HEAD = /* glsl */ `
uniform vec3 uGrade, uKeyDir, uLid;
uniform float uFade, uKey, uFill, uUnder, uBlink;
varying vec4 vEye;
${LOOK_GLSL}
void main() {`;

// A blink: a coral lid comes down over each eye from the top of its ball, with a dark edge.
const FRAG_LID = /* glsl */ `
#include <map_fragment>
  if (vEye.w > 0.5 && uBlink > 0.0) {
    float line = 1.05 - uBlink * 2.2;
    float lid = smoothstep(line - 0.05, line + 0.05, vEye.y) * smoothstep(0.5, 0.8, vEye.w);
    float edge = (1.0 - smoothstep(0.0, 0.08, abs(vEye.y - line))) * step(0.02, uBlink);
    diffuseColor.rgb = mix(diffuseColor.rgb, uLid, lid) * (1.0 - 0.45 * edge);
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

/** One frame's life: time, how hard he kicks (0 to 1), the swing's speed, the cursor (screen px), a blink (0 to 1). */
export interface Life { t: number; dt: number; kick: number; swingV: number; mouse: [number, number] | null; blink: number }

/** Where he is: at a screen point (px, y down) with his chain point there, or centred there in the air. */
export interface Pose { at: [number, number]; h: number; roll: number; spin: number; squash: number; air: boolean; tumble?: number }

export class Snap3D {
  /** At his chain point on screen (or his middle in the air), leaning with the chain. */
  readonly group = new THREE.Group();
  /** Turns about the chain (the rig frame's y axis). */
  private turn = new THREE.Group();
  /** In the air, puts his middle at the turn's centre. */
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
    uEyeR: { value: 0.09 },
    uBlink: { value: 0 },
    uLid: { value: new THREE.Color(0.6, 0.06, 0.055) },
    ...LOOK,
  };
  /** Per limb: two axes across it, for its swing. */
  private axes: { a: THREE.Vector3; b: THREE.Vector3 }[] = [];
  /** How far out along its stalk each eye's centre sits (0 to 1). */
  private eyeW = [0.8, 0.8];
  private look = [new THREE.Vector3(), new THREE.Vector3()];
  private sway = 0;
  ready = false;
  private loading: Promise<void> | null = null;

  constructor(stage: Stage, private anisotropy = Math.min(8, stage.renderer.capabilities.getMaxAnisotropy())) {
    this.group.add(this.turn);
    this.turn.add(this.offset);
    this.group.visible = false;
    stage.scene.add(this.group);
  }

  /**
   * The shape ships as base64 text (the preview host serves no binary
   * files) and the texture as its own picture, AVIF or WebP, loaded through
   * an image element like every other picture. A failed load can be tried again.
   */
  load() {
    if (this.ready) return Promise.resolve();
    this.loading ??= this.build().catch((e) => {
      this.loading = null;
      console.warn('dive: 3D Snap did not load', e);
      throw e;
    });
    return this.loading;
  }

  private async build() {
    const s = media.snap3d;
    const [text, img] = await Promise.all([
      fetch(url('snap-3d.txt')).then((r) => { if (!r.ok) throw new Error(`snap-3d: ${r.status}`); return r.text(); }),
      loadPicture('snap-3d'),
    ]);
    const bin = Uint8Array.from(atob(text.trim()), (ch) => ch.charCodeAt(0)).buffer;
    const n = s.n, ni = s.tris * 3;
    let at = 0;
    const take = <T extends ArrayBufferView>(make: (b: ArrayBuffer, o: number) => T): T => {
      const a = make(bin, at);
      at += a.byteLength;
      at += (4 - (at % 4)) % 4;
      return a;
    };
    const qp = take((b, o) => new Int16Array(b, o, n * 3));
    const qn = take((b, o) => new Int8Array(b, o, n * 3));
    const qu = take((b, o) => new Uint16Array(b, o, n * 2));
    const rig = take((b, o) => new Uint8Array(b, o, n * 3));
    const index = take((b, o) => new Uint16Array(b, o, ni));
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) {
      const c = i % 3;
      pos[i] = s.lo[c] + ((qp[i] + 32768) / 65535) * (s.hi[c] - s.lo[c]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(qn, 3, true));
    geo.setAttribute('uv', new THREE.BufferAttribute(qu, 2, true));
    geo.setAttribute('rig', new THREE.BufferAttribute(rig, 3));
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
        .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.rgb = applyLook(gl_FragColor.rgb * uGrade);\n  gl_FragColor.a *= uFade;');
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 5;
    mesh.frustumCulled = false;
    this.offset.add(mesh);
    this.mesh = mesh;

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

  /** His front box on screen when his chain point is at (x, y) and he is h tall. */
  box(x: number, y: number, h: number) {
    const b = media.snap3d.box;
    return { x: x + b[0] * h, y: y - b[3] * h, w: (b[2] - b[0]) * h, h: (b[3] - b[1]) * h };
  }

  /** His middle, from his chain point, px (y down), when he is h tall. */
  static centre(h: number): [number, number] {
    const { lo, hi } = media.snap3d;
    return [((lo[0] + hi[0]) / 2) * h, -((lo[1] + hi[1]) / 2) * h];
  }

  hide() { this.group.visible = false; }

  /**
   * One frame. Riding, his chain point sits at p.at, leaning by p.roll and
   * turned about the chain by p.spin. In the air his middle sits at p.at,
   * tumbling: p.roll about the view axis, p.spin about his own up.
   */
  update(p: Pose, life: Life, grade: [number, number, number], fade = 1) {
    const m = this.mesh;
    this.group.visible = !!m && fade > 0.001;
    if (!this.group.visible || !m) return;
    const { lo, hi } = media.snap3d, h = p.h;
    this.group.position.set(p.at[0], -p.at[1], 0);
    this.group.rotation.set(0, 0, p.roll);
    this.group.scale.set(1 + p.squash * 0.6, 1 - p.squash, 1);
    this.turn.rotation.set(p.tumble ?? 0, p.spin, 0);
    if (p.air) this.offset.position.set((-(lo[0] + hi[0]) / 2) * h, (-(lo[1] + hi[1]) / 2) * h, (-(lo[2] + hi[2]) / 2) * h);
    else this.offset.position.set(0, 0, 0);
    // A slow breath.
    m.scale.setScalar(h * (1 + Math.sin(life.t * 1.6) * 0.008));
    this.u.uGrade.value.set(...grade);
    this.u.uFade.value = fade;
    this.live(life);
  }

  /** The limbs and eyes for this frame. */
  private live(o: Life) {
    const s = media.snap3d, U = this.u, t = o.t;
    const rot = U.uRot.value;
    // The stalks lag behind the swing.
    this.sway += (-o.swingV * 0.12 - this.sway) * Math.min(1, o.dt * 5);
    const legW = 4.2 + o.kick * 7;
    let leg = 0;
    s.limbs.forEach((L, i) => {
      const { a, b } = this.axes[i], r = rot[i];
      if (L.kind === 'stalk') {
        r.set(Math.sin(t * 2.1 + 1 + i) * 0.05, 0, Math.sin(t * 1.25 + i * 1.7) * 0.07 + this.sway);
      } else if (L.kind === 'leg') {
        // Paddling: each tip runs round a small ellipse, one leg after the next.
        const ph = t * legW - leg++ * 0.95;
        const amp = 0.2 + o.kick * 0.32;
        r.copy(b).multiplyScalar(Math.sin(ph) * amp).addScaledVector(a, Math.cos(ph) * amp * 0.45);
      } else if (L.kind === 'clawR') {
        r.copy(b).multiplyScalar(Math.sin(t * 1.7) * 0.07 + Math.sin(t * 0.6) * 0.04);
      } else {
        r.set(0, 0, 0);
      }
    });
    // Each eye turns toward the cursor (or wanders), within a cone, after its stalk's own swing.
    const mesh = this.mesh!;
    mesh.updateWorldMatrix(true, false);
    const q = mesh.getWorldQuaternion(_q).invert();
    const v = _v, rest = _rest, want = _want, axis = _axis;
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
      if (o.mouse) {
        v.copy(c);
        mesh.localToWorld(v);
        const dx = o.mouse[0] - v.x, dy = o.mouse[1] + v.y;      // screen y is down, world y up
        const d = Math.hypot(dx, dy) || 1, f = Math.min(1, d / 260) / d;
        want.set(dx * f * 0.75, -dy * f * 0.75, 1).normalize().applyQuaternion(q);
      } else {
        want.set(Math.sin(t * 0.5 + k) * 0.35, Math.cos(t * 0.37) * 0.18 - 0.1, 1).normalize().applyQuaternion(q);
      }
      // From the bead's rest direction to the wanted one, at most about 32 degrees.
      axis.crossVectors(rest, want);
      const ang = Math.min(0.56, Math.acos(THREE.MathUtils.clamp(rest.dot(want), -1, 1)));
      const target = axis.lengthSq() > 1e-10 ? axis.normalize().multiplyScalar(ang) : axis.set(0, 0, 0);
      this.look[k].lerp(target, Math.min(1, o.dt * 9));
      U.uEyeRot.value[k].copy(this.look[k]);
    });
    U.uBlink.value = o.blink;
  }
}
