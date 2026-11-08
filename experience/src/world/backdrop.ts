import * as THREE from 'three';
import { media, url, loadPicture, loadImage, makeVideo, whenPlayable, avifSupported } from '../media';
import { cover, quad, place, imageTexture, videoTexture, type Cover, type Stage } from './stage';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uA, uB;
uniform vec4 uCoverA, uCoverB;   // left, top, width, height in px
uniform float uMix, uTime, uMouseOn, uWaterY, uRipple, uGlint, uTintAmt, uDim;
uniform vec2 uRes, uMouse;
uniform vec3 uTint;
varying vec2 vUv;

vec3 sampleCover(sampler2D t, vec4 c, vec2 px) {
  vec2 uv = (px - c.xy) / c.zw;
  return texture2D(t, vec2(clamp(uv.x, 0.0, 1.0), 1.0 - clamp(uv.y, 0.0, 1.0))).rgb;
}

void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  vec2 d = px - uMouse;
  float r = length(d);
  // Ripples spread on the water under the cursor (the marina only).
  float below = smoothstep(uWaterY - 6.0, uWaterY + 40.0, px.y);
  float ring = sin(r * 0.075 - uTime * 3.6) * exp(-r * 0.011) * uRipple * uMouseOn * below;
  px += normalize(d + 1e-4) * ring * 7.0;
  vec3 a = sampleCover(uA, uCoverA, px);
  vec3 b = sampleCover(uB, uCoverB, px);
  vec3 col = mix(a, b, uMix);
  // A sun glint on the sand under the cursor (the shallows).
  float g = exp(-r * r / (2.0 * 150.0 * 150.0)) * uGlint * uMouseOn;
  float c1 = sin(px.x * 0.045 + uTime * 1.3 + sin(px.y * 0.05 + uTime));
  float c2 = sin(px.y * 0.04 - uTime * 1.1 + sin(px.x * 0.03 - uTime * 0.7));
  float caustic = pow(0.5 + 0.5 * c1 * c2, 3.0);
  col += g * (0.08 + 0.42 * caustic) * vec3(1.0, 0.96, 0.82);
  col = mix(col, uTint, uTintAmt) * uDim;
  gl_FragColor = vec4(col, 1.0);
}`;

export type SourceKey = 'z0' | 'z1' | 'seq';
interface Src { tex: THREE.Texture | null; w: number; h: number }

/** The world behind everything: plates, their loops, and the plunge frames. */
export class Backdrop {
  readonly mesh: THREE.Mesh;
  readonly u: Record<string, THREE.IUniform>;
  private plate: Record<'z0' | 'z1', Src> = { z0: { tex: null, w: 1, h: 1 }, z1: { tex: null, w: 1, h: 1 } };
  private loop: Partial<Record<'z0' | 'z1', { v: HTMLVideoElement; tex: THREE.VideoTexture; ready: boolean; fade: number }>> = {};
  private seq: (HTMLImageElement | null)[] = [];
  private seqTex: THREE.Texture | null = null;
  private seqShown = -1;
  private seqStarted = false;
  readonly seqSize: [number, number];
  private readonly keys: { z0: 'z0' | 'z0p'; z1: 'z1' | 'z1p' };

  constructor(private stage: Stage, readonly phone: boolean) {
    this.keys = phone ? { z0: 'z0p', z1: 'z1p' } : { z0: 'z0', z1: 'z1' };
    this.seqSize = phone ? media.t1.p : media.t1.d;
    const blank = new THREE.DataTexture(new Uint8Array([207, 232, 238, 255]), 1, 1);
    blank.needsUpdate = true;
    this.u = {
      uA: { value: blank }, uB: { value: blank }, uCoverA: { value: new THREE.Vector4() }, uCoverB: { value: new THREE.Vector4() },
      uMix: { value: 0 }, uTime: { value: 0 }, uMouseOn: { value: 0 }, uWaterY: { value: 1e5 }, uRipple: { value: 0 },
      uGlint: { value: 0 }, uTintAmt: { value: 0 }, uDim: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) },
      uMouse: { value: new THREE.Vector2(-1e4, -1e4) }, uTint: { value: new THREE.Vector3(0.05, 0.23, 0.24) },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, depthTest: false, depthWrite: false });
    this.mesh = quad(mat, 0);
    this.mesh.visible = false;
    stage.scene.add(this.mesh);
  }

  plateMeta(z: 'z0' | 'z1') { return media.plates[this.keys[z]]; }

  /** True once any plunge frame has loaded. */
  get seqReady() { return this.seq.some(Boolean); }

  /** Pick the plate width for this screen; the first one also feeds the placeholder. */
  async loadPlate(z: 'z0' | 'z1') {
    const meta = this.plateMeta(z);
    const s = this.stage;
    const coverW = Math.max(s.w, s.h * (meta.w / meta.h)) * s.dpr * 1.12;
    const w = meta.widths.find((x) => x >= coverW * 0.85) ?? meta.widths[meta.widths.length - 1];
    const img = await loadPicture(`${this.keys[z]}-${w}`);
    this.plate[z] = { tex: imageTexture(img), w: meta.w, h: meta.h };
    this.mesh.visible = true;
  }

  async loadLoop(z: 'z0' | 'z1') {
    const name = `${this.keys[z]}-loop.mp4`;
    const v = makeVideo(name, true);
    const entry = { v, tex: videoTexture(v), ready: false, fade: 0 };
    this.loop[z] = entry;
    v.load();
    await whenPlayable(v);
    entry.ready = true;
  }

  /** The plunge, as a scrubbed image sequence, loaded a few frames at a time. */
  async loadSequence() {
    if (this.seqStarted) return;
    this.seqStarted = true;
    const n = media.t1.frames;
    this.seq = new Array(n).fill(null);
    const prefix = this.phone ? 'p' : 'd';
    const ext = (await avifSupported()) ? 'avif' : null;
    if (!ext) return; // no AVIF: the plunge falls back to a crossfade
    let next = 0;
    const worker = async () => {
      while (next < n) {
        const i = next++;
        try { this.seq[i] = await loadImage(url(`t1/${prefix}-${String(i).padStart(3, '0')}.${ext}`)); } catch { /* skip a frame */ }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }

  private source(k: SourceKey, frame: number): Src | null {
    if (k === 'seq') {
      if (!this.seq.length) return null;
      let i = Math.round(frame), best = -1;
      for (let d = 0; d < this.seq.length; d++) {
        if (this.seq[i - d]) { best = i - d; break; }
        if (this.seq[i + d]) { best = i + d; break; }
      }
      if (best < 0) return null;
      if (best !== this.seqShown) {
        const img = this.seq[best]!;
        if (!this.seqTex) this.seqTex = imageTexture(img);
        else { this.seqTex.image = img; this.seqTex.needsUpdate = true; }
        this.seqShown = best;
      }
      return { tex: this.seqTex, w: this.seqSize[0], h: this.seqSize[1] };
    }
    const p = this.plate[k];
    if (!p.tex) return null;
    const l = this.loop[k];
    if (l?.ready && l.fade >= 1) return { tex: l.tex, w: p.w, h: p.h };
    return p;
  }

  /** Play only the loop whose zone is on screen. */
  playLoops(z0: boolean, z1: boolean) {
    for (const [k, on] of [['z0', z0], ['z1', z1]] as const) {
      const l = this.loop[k];
      if (!l?.ready) continue;
      if (on && l.v.paused) l.v.play().catch(() => {});
      if (!on && !l.v.paused) l.v.pause();
    }
  }

  /**
   * Draw a blend of two sources. `fy` pans each plate inside its overscan.
   * Returns the cover used for each, so layers can sit on the plates.
   */
  update(dt: number, a: SourceKey, b: SourceKey, mix: number, frame: number, fyA: number, fyB: number, fx: number): { a: Cover; b: Cover } {
    const s = this.stage;
    // Fade a loop in over its plate once it can play.
    for (const k of ['z0', 'z1'] as const) {
      const l = this.loop[k];
      if (l?.ready && l.fade < 1) l.fade = Math.min(1, l.fade + dt / 0.8);
    }
    let A = this.source(a, frame) ?? this.source(b, frame);
    let B = this.source(b, frame) ?? A;
    if (!A || !B) return { a: cover(1, 1, s.w, s.h), b: cover(1, 1, s.w, s.h) };
    let m = mix;
    // A loop mid-fade on a single source: blend its plate and the video.
    if (a === b && a !== 'seq') {
      const l = this.loop[a];
      if (l?.ready && l.fade < 1) { A = this.plate[a]; B = { tex: l.tex, w: A.w, h: A.h }; m = l.fade; }
    }
    const ca = cover(A.w, A.h, s.w, s.h, 1.12, fx, fyA);
    const cb = cover(B.w, B.h, s.w, s.h, 1.12, fx, fyB);
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
