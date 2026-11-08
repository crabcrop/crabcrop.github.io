import * as THREE from 'three';
import { media, url, loadPicture, loadImage, makeVideo, whenPlayable, avifSupported } from '../media';
import { cover, quad, place, imageTexture, videoTexture, type Cover, type Stage } from './stage';
import { LOOK, LOOK_GLSL } from './look';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uA, uB;
uniform vec4 uCoverA, uCoverB;   // left, top, width, height in px
uniform float uMix, uTime, uMouseOn, uWaterY, uRipple, uGlint, uShafts, uTintAmt;
uniform vec2 uRes, uMouse;
uniform vec3 uTint;
varying vec2 vUv;
${LOOK_GLSL}

vec2 coverUv(vec4 c, vec2 px) {
  vec2 uv = (px - c.xy) / c.zw;
  return vec2(clamp(uv.x, 0.0, 1.0), 1.0 - clamp(uv.y, 0.0, 1.0));
}
vec3 both(vec2 px) {
  return mix(texture2D(uA, coverUv(uCoverA, px)).rgb, texture2D(uB, coverUv(uCoverB, px)).rgb, uMix);
}

void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 d = px - uMouse;
  float r = length(d);
  // Ripples spread on the water under the cursor (the marina).
  float below = smoothstep(uWaterY - 6.0, uWaterY + 40.0, px.y);
  float ring = sin(r * 0.075 - uTime * 3.6) * exp(-r * 0.011) * uRipple * uMouseOn * below;
  px += normalize(d + 1e-4) * ring * 7.0;
  vec3 col = both(px);
  // Crisp sharpens: an unsharp mask on the plate.
  if (uLookAmt > 0.0 && uLookMode < 1.5) {
    vec3 blur = (both(px + vec2(1.5, 0.0)) + both(px - vec2(1.5, 0.0)) + both(px + vec2(0.0, 1.5)) + both(px - vec2(0.0, 1.5))) * 0.25;
    col += (col - blur) * 1.2 * uLookAmt;
  }
  // A sun glint on the sand under the cursor (the shallows).
  float g = exp(-r * r / (2.0 * 150.0 * 150.0)) * uGlint * uMouseOn;
  float c1 = sin(px.x * 0.045 + uTime * 1.3 + sin(px.y * 0.05 + uTime));
  float c2 = sin(px.y * 0.04 - uTime * 1.1 + sin(px.x * 0.03 - uTime * 0.7));
  col += g * (0.08 + 0.42 * pow(0.5 + 0.5 * c1 * c2, 3.0)) * vec3(1.0, 0.96, 0.82);
  // Light shafts through the kelp canopy, leaning with the cursor.
  if (uShafts > 0.0) {
    float lean = (uMouseOn > 0.5 ? (uMouse.x / uRes.x - 0.5) : 0.0) * 0.35;
    float x = px.x / uRes.x - 0.5 - (px.y / uRes.y) * (0.18 + lean);
    float beams = pow(0.5 + 0.5 * sin(x * 38.0 + sin(uTime * 0.4) * 1.5), 6.0) * 0.6 + pow(0.5 + 0.5 * sin(x * 17.0 - uTime * 0.25), 8.0) * 0.4;
    float fall = smoothstep(1.0, 0.0, px.y / uRes.y) * smoothstep(0.55, 0.05, abs(x));
    col += beams * fall * uShafts * 0.16 * vec3(1.0, 0.97, 0.8);
  }
  col = applyLook(mix(col, uTint, uTintAmt));
  gl_FragColor = vec4(col, 1.0);
}`;

export type Zone = 'z0' | 'z1' | 'z2' | 'z3';
export type SeqKey = 't1' | 't2';
export type SourceKey = Zone | SeqKey;
interface Src { tex: THREE.Texture | null; w: number; h: number }
interface Seq { frames: (HTMLImageElement | null)[]; tex: THREE.Texture | null; shown: number; started: boolean }

const PLATE: Record<Zone, [string, string]> = { z0: ['z0', 'z0p'], z1: ['z1', 'z1p'], z2: ['z2', 'z2p'], z3: ['z3', 'z3p'] };

/** The world behind everything: plates, their loops, and the transition frames. */
export class Backdrop {
  readonly mesh: THREE.Mesh;
  readonly u: Record<string, THREE.IUniform>;
  private plate = {} as Record<Zone, Src>;
  private loop: Partial<Record<Zone, { v: HTMLVideoElement; tex: THREE.VideoTexture; ready: boolean; fade: number }>> = {};
  private seqs: Record<SeqKey, Seq> = {
    t1: { frames: [], tex: null, shown: -1, started: false },
    t2: { frames: [], tex: null, shown: -1, started: false },
  };
  readonly seqSize: [number, number];

  constructor(private stage: Stage, readonly phone: boolean) {
    this.seqSize = phone ? media.t1.p : media.t1.d;
    for (const z of Object.keys(PLATE) as Zone[]) this.plate[z] = { tex: null, w: 1, h: 1 };
    const blank = new THREE.DataTexture(new Uint8Array([207, 232, 238, 255]), 1, 1);
    blank.needsUpdate = true;
    this.u = {
      uA: { value: blank }, uB: { value: blank }, uCoverA: { value: new THREE.Vector4() }, uCoverB: { value: new THREE.Vector4() },
      uMix: { value: 0 }, uTime: { value: 0 }, uMouseOn: { value: 0 }, uWaterY: { value: 1e5 }, uRipple: { value: 0 },
      uGlint: { value: 0 }, uShafts: { value: 0 }, uTintAmt: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      uMouse: { value: new THREE.Vector2(-1e4, -1e4) }, uTint: { value: new THREE.Vector3(0.05, 0.23, 0.24) },
      ...LOOK,
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, depthTest: false, depthWrite: false });
    this.mesh = quad(mat, 0);
    this.mesh.visible = false;
    stage.scene.add(this.mesh);
  }

  key(z: Zone) { return PLATE[z][this.phone ? 1 : 0] as keyof typeof media.plates; }
  plateMeta(z: Zone) { return media.plates[this.key(z)]; }
  seqReady(k: SeqKey) { return this.seqs[k].frames.some(Boolean); }

  async loadPlate(z: Zone) {
    if (this.plate[z].tex) return;
    const meta = this.plateMeta(z);
    const s = this.stage;
    const coverW = Math.max(s.w, s.h * (meta.w / meta.h)) * s.dpr * 1.12;
    const w = meta.widths.find((x) => x >= coverW * 0.85) ?? meta.widths[meta.widths.length - 1];
    const img = await loadPicture(`${this.key(z)}-${w}`);
    this.plate[z] = { tex: imageTexture(img), w: meta.w, h: meta.h };
    this.mesh.visible = true;
  }

  async loadLoop(z: Zone) {
    if (this.loop[z]) return;
    const v = makeVideo(`${this.key(z)}-loop.mp4`, true);
    const entry = { v, tex: videoTexture(v), ready: false, fade: 0 };
    this.loop[z] = entry;
    v.load();
    await whenPlayable(v);
    entry.ready = true;
  }

  /** A transition as a scrubbed image sequence, loaded a few frames at a time. */
  async loadSequence(k: SeqKey) {
    const s = this.seqs[k];
    if (s.started) return;
    s.started = true;
    const n = media[k].frames;
    s.frames = new Array(n).fill(null);
    if (!(await avifSupported())) return; // without AVIF the transition is a crossfade
    const prefix = this.phone ? 'p' : 'd';
    let next = 0;
    const worker = async () => {
      while (next < n) {
        const i = next++;
        try { s.frames[i] = await loadImage(url(`${k}/${prefix}-${String(i).padStart(3, '0')}.avif`)); } catch { /* skip a frame */ }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  private source(k: SourceKey, frame: number): Src | null {
    if (k === 't1' || k === 't2') {
      const s = this.seqs[k];
      if (!s.frames.length) return null;
      const i = Math.round(frame);
      let best = -1;
      for (let d = 0; d < s.frames.length; d++) {
        if (s.frames[i - d]) { best = i - d; break; }
        if (s.frames[i + d]) { best = i + d; break; }
      }
      if (best < 0) return null;
      if (best !== s.shown) {
        const img = s.frames[best]!;
        if (!s.tex) s.tex = imageTexture(img);
        else { s.tex.image = img; s.tex.needsUpdate = true; }
        s.shown = best;
      }
      return { tex: s.tex, w: this.seqSize[0], h: this.seqSize[1] };
    }
    const p = this.plate[k];
    if (!p.tex) return null;
    const l = this.loop[k];
    if (l?.ready && l.fade >= 1) return { tex: l.tex, w: p.w, h: p.h };
    return p;
  }

  /** Play only the loops whose zone is on screen. */
  playLoops(on: Partial<Record<Zone, boolean>>) {
    for (const [k, l] of Object.entries(this.loop) as [Zone, NonNullable<Backdrop['loop'][Zone]>][]) {
      if (!l.ready) continue;
      if (on[k] && l.v.paused) l.v.play().catch(() => {});
      if (!on[k] && !l.v.paused) l.v.pause();
    }
  }

  /** Draw a blend of two sources; returns the cover used for each. */
  update(dt: number, a: SourceKey, b: SourceKey, mix: number, frames: Record<SeqKey, number>, fyA: number, fyB: number, fxA: number, fxB: number): { a: Cover; b: Cover } {
    const s = this.stage;
    for (const l of Object.values(this.loop)) if (l?.ready && l.fade < 1) l.fade = Math.min(1, l.fade + dt / 0.8);
    const frameOf = (k: SourceKey) => (k === 't1' || k === 't2' ? frames[k] : 0);
    let A = this.source(a, frameOf(a)) ?? this.source(b, frameOf(b));
    let B = this.source(b, frameOf(b)) ?? A;
    if (!A || !B) return { a: cover(1, 1, s.w, s.h), b: cover(1, 1, s.w, s.h) };
    let m = mix;
    // A loop mid-fade on a single plate: blend the plate and the video.
    if (a === b && a !== 't1' && a !== 't2') {
      const l = this.loop[a];
      if (l?.ready && l.fade < 1) { A = this.plate[a]; B = { tex: l.tex, w: A.w, h: A.h }; m = l.fade; }
    }
    const ca = cover(A.w, A.h, s.w, s.h, 1.12, fxA, fyA);
    const cb = cover(B.w, B.h, s.w, s.h, 1.12, fxB, fyB);
    this.u.uA.value = A.tex;
    this.u.uB.value = B.tex;
    this.u.uMix.value = m;
    this.u.uCoverA.value.set(ca.ox, ca.oy, ca.dw, ca.dh);
    this.u.uCoverB.value.set(cb.ox, cb.oy, cb.dw, cb.dh);
    this.u.uRes.value.set(s.w, s.h);
    place(this.mesh, 0, 0, s.w, s.h);
    return { a: ca, b: cb };
  }
}
