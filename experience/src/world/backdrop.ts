import * as THREE from 'three';
import { media, url, loadPicture, loadImage, makeVideo, whenPlayable, avifSupported } from '../media';
import { cover, quad, place, imageTexture, videoTexture, type Cover, type Stage } from './stage';
import { LOOK, LOOK_GLSL } from './look';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uA, uB, uC, uStill, uLit;
uniform vec4 uCoverA, uCoverB, uCoverC, uCoverPix, uStillCover, uLitCover;   // left, top, width, height in px
uniform vec4 uLight;
uniform float uWarm, uShimmer;
uniform float uMix, uTime, uMouseOn, uWaterY, uRipple, uGlint, uShafts, uTintAmt;
uniform float uSplit, uRegionAmt, uCanSide, uPixSize, uLampsOn, uLampR;
uniform vec4 uRegion, uPix, uSwing, uSwingR, uGlow;
uniform vec3 uLamp0, uLamp1, uLamp2, uImpact;
uniform vec2 uRes, uMouse;
uniform vec3 uTint;
varying vec2 vUv;
${LOOK_GLSL}

vec2 coverUv(vec4 c, vec2 px) {
  vec2 uv = (px - c.xy) / c.zw;
  return vec2(clamp(uv.x, 0.0, 1.0), 1.0 - clamp(uv.y, 0.0, 1.0));
}
vec3 both(vec2 px) {
  vec3 a = texture2D(uA, coverUv(uCoverA, px)).rgb;
  vec3 b = texture2D(uB, coverUv(uCoverB, px)).rgb;
  // Object removal: inside the marked box on the can's panel, the clean
  // plate grows in from the box's centre.
  if (uRegionAmt > 0.0) {
    vec2 uv = (px - uCoverC.xy) / uCoverC.zw;
    vec2 c = (uRegion.xy + uRegion.zw) * 0.5, hs = max((uRegion.zw - uRegion.xy) * 0.5, vec2(1e-4));
    vec2 q = abs(uv - c) / hs;
    float inside = 1.0 - smoothstep(0.94, 1.0, max(q.x, q.y));
    float grow = 1.0 - smoothstep(uRegionAmt * 1.7 - 0.35, uRegionAmt * 1.7, length(q));
    vec3 clean = texture2D(uC, coverUv(uCoverC, px)).rgb;
    if (uCanSide < 0.5) a = mix(a, clean, inside * grow); else b = mix(b, clean, inside * grow);
  }
  // Two reef panels side by side meet at uSplit with a soft join; otherwise a crossfade.
  float m = uSplit > -9999.0 ? smoothstep(uSplit - 30.0, uSplit + 30.0, px.x) : uMix;
  return mix(a, b, m);
}
vec3 lamp(vec3 col, vec2 px, vec3 L) {
  vec2 d = px - L.xy;
  float f = exp(-dot(d, d) / (uLampR * uLampR));
  col *= 1.0 - (1.0 - L.z) * 0.45 * f * uLampsOn;
  return col + L.z * uLampsOn * f * 0.26 * vec3(1.0, 0.96, 0.86);
}

void main() {
  vec2 px = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  // The wreck's lantern swings on its hook. Inside a soft oval round it the
  // cabin is the still plate (the loop sways the lantern on its own), turned
  // about the hook, less toward the oval's edge so it meets the loop unmoved.
  vec2 pxS = px;
  float wS = 0.0;
  if (uSwing.w > 0.0) {
    vec2 q = px - uSwing.xy;
    wS = (1.0 - smoothstep(0.7, 1.0, length((px - uSwingR.xy) / uSwingR.zw))) * smoothstep(-4.0, 18.0, q.y);
    float th = uSwing.z * wS, c = cos(th), s = sin(th);
    pxS = uSwing.xy + vec2(c * q.x + s * q.y, -s * q.x + c * q.y);
  }
  // Heat shimmer at the vents: the water wavers round the cursor.
  if (uShimmer > 0.0 && uMouseOn > 0.5) {
    vec2 dm = px - uMouse;
    float f = exp(-dot(dm, dm) / (2.0 * 140.0 * 140.0)) * uShimmer;
    px += vec2(sin(px.y * 0.09 + uTime * 7.0), cos(px.x * 0.08 - uTime * 6.0)) * 3.5 * f;
  }
  vec2 d = px - uMouse;
  float r = length(d);
  // Ripples spread on the water under the cursor (the marina).
  float below = smoothstep(uWaterY - 6.0, uWaterY + 40.0, px.y);
  float ring = sin(r * 0.075 - uTime * 3.6) * exp(-r * 0.011) * uRipple * uMouseOn * below;
  px += normalize(d + 1e-4) * ring * 7.0;
  // A splash: rings spread on the water where Snap catches the chain.
  float it = uTime - uImpact.z;
  if (it > 0.0 && it < 3.0) {
    vec2 di = px - uImpact.xy;
    float ri = length(di * vec2(1.0, 2.6));
    float wave = sin(ri * 0.06 - it * 7.0) * exp(-ri * 0.008) * exp(-it * 1.4) * smoothstep(0.0, 0.15, it) * below;
    px += normalize(di + 1e-4) * wave * 9.0;
  }
  vec3 col = both(px);
  if (wS > 0.0) col = mix(col, texture2D(uStill, coverUv(uStillCover, pxS)).rgb, wS);
  // A shy subject goes to mosaic: the cuttlefish, or the pearl before its upscale.
  if (uPixSize > 1.0) {
    vec2 uv = (px - uCoverPix.xy) / uCoverPix.zw;
    float e = 1.0 - smoothstep(0.8, 1.0, length((uv - uPix.xy) / uPix.zw));
    if (e > 0.0) col = mix(col, both((floor(px / uPixSize) + 0.5) * uPixSize), e);
  }
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
  // The Clam Studio's jellyfish softboxes: dim until they switch on, then glowing.
  if (uLampsOn > 0.0) { col = lamp(col, px, uLamp0); col = lamp(col, px, uLamp1); col = lamp(col, px, uLamp2); }
  // The twilight zone: the visitor's lantern shows the lit plate in a soft
  // circle, and the glowing creatures shine brighter in it.
  vec2 sp = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  if (uLight.w > 0.0) {
    float k = (1.0 - smoothstep(0.3, 1.0, length(sp - uLight.xy) / uLight.z)) * uLight.w;
    // the dark beyond the light a little darker, so the light reads as the visitor's own
    col *= 1.0 - 0.18 * uLight.w * (1.0 - k);
    if (k > 0.0) {
      vec3 lit = texture2D(uLit, coverUv(uLitCover, px)).rgb;
      col = mix(col, lit * 1.25, k);
      col += max(col - vec3(0.42), vec3(0.0)) * 0.7 * k + vec3(1.0, 0.78, 0.48) * 0.13 * k * k;
    }
  }
  // A warm glow rising from below: the vents ahead.
  if (uWarm > 0.0) col += vec3(1.0, 0.48, 0.16) * uWarm * pow(smoothstep(0.3, 1.0, sp.y / uRes.y), 2.0) * 0.45;
  // The lantern's warm light, where it hangs now, flickering.
  if (uGlow.w > 0.0) {
    vec2 g2 = (vec2(vUv.x, 1.0 - vUv.y) * uRes - uGlow.xy) / uGlow.z;
    float r2 = dot(g2, g2);
    col += uGlow.w * (exp(-r2 * 18.0) * 0.55 + exp(-r2 * 2.2) * 0.22) * vec3(1.0, 0.68, 0.32);
  }
  col = applyLook(mix(col, uTint, uTintAmt));
  gl_FragColor = vec4(col, 1.0);
}`;

/** z0 to z3 are the vertical zones; r0 to r4 are the reef panorama's panels, left to right, and r3c is r3 with the can removed; z4x is the wreck outside, z4 its cabin and z5 the twilight zone. */
export type Zone = 'z0' | 'z1' | 'z2' | 'z3' | 'r0' | 'r1' | 'r2' | 'r3' | 'r3c' | 'r4' | 'z4x' | 'z4' | 'z5' | 'z5lit' | 'z6';
export type SeqKey = 't1' | 't2' | 't3' | 't4';
const SEQ_KEYS: SeqKey[] = ['t1', 't2', 't3', 't4'];
const isSeq = (k: SourceKey): k is SeqKey => (SEQ_KEYS as string[]).includes(k);
export type SourceKey = Zone | SeqKey;
type PlateKey = keyof typeof media.plates;
interface Src { tex: THREE.Texture | null; w: number; h: number }
interface Seq { frames: (HTMLImageElement | null)[]; tex: THREE.Texture | null; shown: number; started: boolean }

/** The file behind each zone, on wide screens and on phones. The reef pans across whole plates on phones too. */
const PLATE: Record<Zone, [PlateKey, PlateKey]> = {
  z0: ['z0', 'z0p'], z1: ['z1', 'z1p'], z2: ['z2', 'z2p'], z3: ['z3', 'z3p'],
  r0: ['z3', 'z3'], r1: ['z3_2', 'z3_2'], r2: ['z3_3', 'z3_3'], r3: ['z3_4', 'z3_4'], r3c: ['z3_4c', 'z3_4c'], r4: ['z3b', 'z3b'],
  z4x: ['z4x', 'z4xp'], z4: ['z4', 'z4p'], z5: ['z5', 'z5p'], z5lit: ['z5lit', 'z5litp'], z6: ['z6', 'z6p'],
};
const LOOPS: Partial<Record<Zone, true>> = { z0: true, z1: true, z2: true, z4: true, z6: true };
export const PANELS: Zone[] = ['r0', 'r1', 'r2', 'r3', 'r4'];

/** What the reef asks of the backdrop: where the camera is, and the effects on its panels. */
export interface ReefView {
  /** Left edge of the view, in panels (panel i spans i to i + 1). */
  L: number;
  fy: number;
  /** The box marked over the can, in r3's plate shares, and how far the coral has grown in. */
  region: { rect: [number, number, number, number]; amt: number } | null;
  /** A mosaic ellipse on one panel, in its plate shares, and the block size in px. */
  pix: { panel: number; cu: number; cv: number; ru: number; rv: number; size: number } | null;
  /** The three lamps on r4, in its plate shares, with how far each is switched on. */
  lamps: [number, number, number][] | null;
}

/** The world behind everything: plates, their loops, the transition frames and the reef panorama. */
export class Backdrop {
  readonly mesh: THREE.Mesh;
  readonly u: Record<string, THREE.IUniform>;
  private plate: Partial<Record<PlateKey, Src & { loading?: Promise<void> }>> = {};
  private loop: Partial<Record<Zone, { v: HTMLVideoElement; tex: THREE.VideoTexture; ready: boolean; fade: number }>> = {};
  private seqs: Record<SeqKey, Seq> = {
    t1: { frames: [], tex: null, shown: -1, started: false },
    t2: { frames: [], tex: null, shown: -1, started: false },
    t3: { frames: [], tex: null, shown: -1, started: false },
    t4: { frames: [], tex: null, shown: -1, started: false },
  };
  readonly seqSize: [number, number];
  private blank: THREE.DataTexture;

  constructor(private stage: Stage, readonly phone: boolean) {
    this.seqSize = phone ? media.t1.p : media.t1.d;
    this.blank = new THREE.DataTexture(new Uint8Array([207, 232, 238, 255]), 1, 1);
    this.blank.needsUpdate = true;
    const v3 = () => ({ value: new THREE.Vector3() });
    this.u = {
      uA: { value: this.blank }, uB: { value: this.blank }, uC: { value: this.blank }, uStill: { value: this.blank }, uStillCover: { value: new THREE.Vector4(0, 0, 1, 1) },
      uCoverA: { value: new THREE.Vector4() }, uCoverB: { value: new THREE.Vector4() }, uCoverC: { value: new THREE.Vector4(0, 0, 1, 1) }, uCoverPix: { value: new THREE.Vector4(0, 0, 1, 1) },
      uMix: { value: 0 }, uTime: { value: 0 }, uMouseOn: { value: 0 }, uWaterY: { value: 1e5 }, uRipple: { value: 0 },
      uGlint: { value: 0 }, uShafts: { value: 0 }, uTintAmt: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      uMouse: { value: new THREE.Vector2(-1e4, -1e4) }, uTint: { value: new THREE.Vector3(0.05, 0.23, 0.24) },
      uSplit: { value: -1e5 }, uRegionAmt: { value: 0 }, uCanSide: { value: 0 }, uRegion: { value: new THREE.Vector4() },
      uPixSize: { value: 0 }, uPix: { value: new THREE.Vector4(0, 0, 1, 1) },
      uLampsOn: { value: 0 }, uLampR: { value: 100 }, uLamp0: v3(), uLamp1: v3(), uLamp2: v3(), uImpact: { value: new THREE.Vector3(0, 0, -10) },
      uLit: { value: this.blank }, uLitCover: { value: new THREE.Vector4(0, 0, 1, 1) }, uLight: { value: new THREE.Vector4() }, uWarm: { value: 0 }, uShimmer: { value: 0 },
      uSwing: { value: new THREE.Vector4() }, uSwingR: { value: new THREE.Vector4(0, 0, 1, 1) }, uGlow: { value: new THREE.Vector4(0, 0, 1, 0) },
      ...LOOK,
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, depthTest: false, depthWrite: false });
    this.mesh = quad(mat, 0);
    this.mesh.visible = false;
    stage.scene.add(this.mesh);
  }

  key(z: Zone): PlateKey { return PLATE[z][this.phone ? 1 : 0]; }
  plateMeta(z: Zone) { return media.plates[this.key(z)]; }
  seqReady(k: SeqKey) { return this.seqs[k].frames.some(Boolean); }
  has(z: Zone) { return !!this.plate[this.key(z)]?.tex; }

  async loadPlate(z: Zone) {
    const k = this.key(z);
    const cur = this.plate[k];
    if (cur?.tex) return;
    if (cur?.loading) return cur.loading;
    const meta = media.plates[k];
    const s = this.stage;
    const coverW = Math.max(s.w, s.h * (meta.w / meta.h)) * s.dpr * 1.12;
    const w = meta.widths.find((x) => x >= coverW * 0.85) ?? meta.widths[meta.widths.length - 1];
    const entry: Src & { loading?: Promise<void> } = { tex: null, w: meta.w, h: meta.h };
    entry.loading = loadPicture(`${k}-${w}`).then((img) => {
      if (this.plate[k] !== entry) return; // dropped while loading
      entry.tex = imageTexture(img);
      entry.loading = undefined;
      this.mesh.visible = true;
    });
    this.plate[k] = entry;
    return entry.loading;
  }

  /** Free a plate's texture; it loads again if it is wanted later. */
  drop(z: Zone) {
    const k = this.key(z);
    const p = this.plate[k];
    if (!p) return;
    p.tex?.dispose();
    delete this.plate[k];
  }

  async loadLoop(z: Zone) {
    if (!LOOPS[z] || this.loop[z]) return;
    const v = makeVideo(`${this.key(z)}-loop.mp4`, true);
    const entry = { v, tex: videoTexture(v), ready: false, fade: 0 };
    this.loop[z] = entry;
    v.load();
    await whenPlayable(v);
    entry.ready = true;
  }

  /**
   * A transition as a scrubbed image sequence. Its frames come in four packs
   * (frame i in pack i % 4, each pack its frames' AVIF files end to end), so
   * the first pack to arrive already covers the whole move and the others
   * fill in between.
   */
  async loadSequence(k: SeqKey) {
    const s = this.seqs[k];
    if (s.started) return;
    s.started = true;
    const n = media[k].frames;
    s.frames = new Array(n).fill(null);
    if (!(await avifSupported())) return; // without AVIF the transition is a crossfade
    const dev = this.phone ? 'p' : 'd';
    const packs = media[k].packs[dev];
    await Promise.all(packs.map(async (lens, j) => {
      let buf: ArrayBuffer;
      try { buf = await (await fetch(url(`${k}/${dev}-pack${j}.avif`))).arrayBuffer(); } catch { return; /* its neighbours stand in */ }
      let at = 0;
      for (let m = 0; m < lens.length; m++) {
        const frame = new Blob([buf.slice(at, at + lens[m])], { type: 'image/avif' });
        at += lens[m];
        try { s.frames[j + m * packs.length] = await loadImage(URL.createObjectURL(frame)); } catch { /* skip a frame */ }
      }
    }));
  }

  private source(k: SourceKey, frame: number): Src | null {
    if (isSeq(k)) {
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
    const p = this.plate[this.key(k)];
    if (!p?.tex) return null;
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

  private noEffects() {
    this.u.uLight.value.w = 0;
    this.u.uWarm.value = 0;
    this.u.uSwing.value.w = 0;
    this.u.uGlow.value.w = 0;
    this.u.uSplit.value = -1e5;
    this.u.uRegionAmt.value = 0;
    this.u.uPixSize.value = 0;
    this.u.uLampsOn.value = 0;
  }

  /**
   * The lantern in the wreck's cabin: it hangs from pivot (px) and has turned
   * by angle (radians); oval is the soft area drawn from the still plate and
   * turned with it (centre and radii, px), cabin the cabin plate's cover;
   * glow is its light (centre, radius px, strength).
   */
  swing(pivot: [number, number], angle: number, oval: [number, number, number, number], cabin: Cover, glow: [number, number, number, number]) {
    const still = this.plate[this.key('z4')]?.tex;
    if (!still) return;
    this.u.uStill.value = still;
    this.u.uStillCover.value.set(cabin.ox, cabin.oy, cabin.dw, cabin.dh);
    this.u.uSwing.value.set(pivot[0], pivot[1], angle, 1);
    this.u.uSwingR.value.set(...oval);
    this.u.uGlow.value.set(...glow);
  }

  /** The twilight zone's lantern: the lit plate shows through round light (x, y, radius px); warm glows from below. */
  lantern(cover: Cover, light: [number, number, number], amount: number, warm: number) {
    const lit = this.plate[this.key('z5lit')]?.tex;
    if (lit && amount > 0) {
      this.u.uLit.value = lit;
      this.u.uLitCover.value.set(cover.ox, cover.oy, cover.dw, cover.dh);
      this.u.uLight.value.set(light[0], light[1], light[2], amount);
    }
    this.u.uWarm.value = warm;
  }

  /** Draw a blend of two sources; returns the cover used for each. overA and overB zoom each one past a cover fit. */
  update(dt: number, a: SourceKey, b: SourceKey, mix: number, frames: Partial<Record<SeqKey, number>>, fyA: number, fyB: number, fxA: number, fxB: number, overA = 1.12, overB = 1.12): { a: Cover; b: Cover } {
    const s = this.stage;
    this.noEffects();
    for (const l of Object.values(this.loop)) if (l?.ready && l.fade < 1) l.fade = Math.min(1, l.fade + dt / 0.8);
    const frameOf = (k: SourceKey) => (isSeq(k) ? frames[k] ?? 0 : 0);
    let A = this.source(a, frameOf(a)) ?? this.source(b, frameOf(b));
    let B = this.source(b, frameOf(b)) ?? A;
    if (!A || !B) return { a: cover(1, 1, s.w, s.h), b: cover(1, 1, s.w, s.h) };
    let m = mix;
    // A loop mid-fade on a single plate: blend the plate and the video.
    if (a === b && !isSeq(a)) {
      const l = this.loop[a];
      const p = this.plate[this.key(a)];
      if (l?.ready && l.fade < 1 && p?.tex) { A = p; B = { tex: l.tex, w: A.w, h: A.h }; m = l.fade; }
    }
    const ca = cover(A.w, A.h, s.w, s.h, overA, fxA, fyA);
    const cb = cover(B.w, B.h, s.w, s.h, overB, fxB, fyB);
    this.u.uA.value = A.tex;
    this.u.uB.value = B.tex;
    this.u.uMix.value = m;
    this.u.uCoverA.value.set(ca.ox, ca.oy, ca.dw, ca.dh);
    this.u.uCoverB.value.set(cb.ox, cb.oy, cb.dw, cb.dh);
    this.u.uRes.value.set(s.w, s.h);
    place(this.mesh, 0, 0, s.w, s.h);
    return { a: ca, b: cb };
  }

  /** The reef: the two panels in view side by side, with the station effects. Returns the cover of panel 0's size (dw, dh, oy). */
  updateReef(view: ReefView): Cover {
    const s = this.stage;
    this.noEffects();
    const meta = media.plates.z3;
    const base = cover(meta.w, meta.h, s.w, s.h, 1.12, 0, view.fy);
    const n = PANELS.length;
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(view.L)));
    const i1 = Math.min(n - 1, i0 + 1);
    const ox = (i: number) => (i - view.L) * base.dw;
    const src = (i: number) => (i >= 0 && i < n ? this.plate[this.key(PANELS[i])]?.tex ?? null : null);
    // Stand in with a neighbour if a panel has not arrived yet.
    const nearest = (i: number) => src(i) ?? src(i - 1) ?? src(i + 1) ?? src(i - 2) ?? src(i + 2) ?? this.blank;
    const split = i1 !== i0 && ox(i1) < s.w;
    this.u.uA.value = nearest(i0);
    this.u.uB.value = split ? nearest(i1) : this.u.uA.value;
    this.u.uCoverA.value.set(ox(i0), base.oy, base.dw, base.dh);
    this.u.uCoverB.value.set(split ? ox(i1) : ox(i0), base.oy, base.dw, base.dh);
    this.u.uSplit.value = split ? ox(i1) : -1e5;
    this.u.uMix.value = 0;
    // The can (r3) and its clean twin.
    const can = PANELS.indexOf('r3');
    const clean = this.plate[this.key('r3c')]?.tex;
    if (view.region && clean && (i0 === can || (split && i1 === can))) {
      this.u.uC.value = clean;
      this.u.uCoverC.value.set(ox(can), base.oy, base.dw, base.dh);
      this.u.uRegion.value.set(...view.region.rect);
      this.u.uRegionAmt.value = view.region.amt;
      this.u.uCanSide.value = i0 === can ? 0 : 1;
    }
    if (view.pix && view.pix.size > 1 && (view.pix.panel === i0 || (split && view.pix.panel === i1))) {
      this.u.uCoverPix.value.set(ox(view.pix.panel), base.oy, base.dw, base.dh);
      this.u.uPix.value.set(view.pix.cu, view.pix.cv, view.pix.ru, view.pix.rv);
      this.u.uPixSize.value = view.pix.size;
    }
    const studio = PANELS.indexOf('r4');
    if (view.lamps && (i0 === studio || (split && i1 === studio))) {
      const L = [this.u.uLamp0, this.u.uLamp1, this.u.uLamp2];
      view.lamps.forEach(([u, v, on], i) => L[i].value.set(ox(studio) + u * base.dw, base.oy + v * base.dh, on));
      this.u.uLampR.value = base.dh * 0.12;
      this.u.uLampsOn.value = 1;
    }
    this.u.uRes.value.set(s.w, s.h);
    place(this.mesh, 0, 0, s.w, s.h);
    this.mesh.visible = true;
    return base;
  }
}
