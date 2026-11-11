import * as THREE from 'three';
import { media, loadPicture } from '../media';
import { imageTexture, quad, place, type Stage } from './stage';
import type { ReefView } from './backdrop';
import { LOOK, LOOK_GLSL } from './look';
import { clamp, lerp, smooth } from '../scroll';
import { SPOTS } from './spots';

export { SPOTS };

/** Subjects the camera stops for, in panels: turtle, fish, cuttlefish, can. */
const SUBJECT = [0.796, 1.68, 2.366, 3.352];

/**
 * The pinned reef in scroll units (viewport heights): Snap slides down the
 * chain, then the camera travels to each station and lingers there.
 * Each key is [scroll, framing]: 0 is where the glide into the reef ended,
 * 1 to 4 the stations, 5 the arrival at the Clam Studio.
 */
const KEYS: [number, number][] = [[0, 0], [0.45, 0], [0.85, 1], [1.85, 1], [2.55, 2], [3.25, 2], [3.95, 3], [4.65, 3], [5.35, 4], [6.25, 4], [7, 5]];
export const REEF_UNITS = 7;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uOpacity, uFlip;
varying vec2 vUv;
${LOOK_GLSL}
void main() {
  vec4 c = texture2D(uMap, vec2(uFlip > 0.5 ? 1.0 - vUv.x : vUv.x, vUv.y));
  if (c.a < 0.01) discard;
  // Nearer the camera, so a little darker and bluer through the water.
  vec3 col = mix(c.rgb * 0.82, vec3(0.06, 0.24, 0.3), 0.14);
  gl_FragColor = vec4(applyLook(col), c.a * uOpacity);
}`;
const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export interface ReefOut {
  on: boolean;
  L: number;
  win: number;
  dw: number;
  dh: number;
  oy: number;
  /** The camera at each framing: start, the four stations, the Clam Studio. */
  F: number[];
  /** How close the camera is to each station (1 to 4) and the studio (5), 0 to 1. */
  near: number[];
  /** True once the can has been removed. */
  removed: boolean;
  /** Which stops' cards are on screen: a slides out to the left as b slides in, p from 0 to 1. */
  cards: { a: number; b: number; p: number };
}

/** The reef director: camera path, station effects and the foreground coral at the joins. */
export class Reef {
  private corals: THREE.Mesh[] = [];
  private cu: Record<string, THREE.IUniform>[] = [];
  private ready = false;
  private region: { rect: [number, number, number, number]; t0: number } | null = null;
  private shyUntil = 0;
  private shyArmed = true;
  private pearlAt = -1;
  private lampsAt = -1;
  private lastU = NaN;
  vel = 0;

  constructor(stage: Stage, private phone: boolean) {
    for (let i = 0; i < 4; i++) {
      const u = { uMap: { value: null as THREE.Texture | null }, uOpacity: { value: 1 }, uFlip: { value: i % 2 }, ...LOOK };
      const m = quad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: u, transparent: true, depthTest: false, depthWrite: false }), 9);
      m.visible = false;
      stage.scene.add(m);
      this.corals.push(m);
      this.cu.push(u);
    }
  }

  async load() {
    const tex = imageTexture(await loadPicture('coral'));
    this.cu.forEach((u) => (u.uMap.value = tex));
    this.ready = true;
  }

  /** The camera's left edge at each framing, for this viewport (win = view width in panels). */
  framings(win: number) {
    const sx = this.phone ? 0.55 : 0.76;
    const start = this.phone ? 0.8 - win / 2 : 0.62 * (1 - win);
    const studio = this.phone ? 4.32 - win / 2 : 4.09;
    const F = [start, ...SUBJECT.map((u) => u - sx * win), studio].map((L) => clamp(L, 0, 5 - win));
    F[1] = Math.max(F[1], F[0]); // on phones the glide already ends on the turtle
    return F;
  }
  /** Where the camera settles in the studio, with the pearl clear of the cards. */
  studioEnd(win: number) { return clamp(this.phone ? 4.678 - 0.7 * win : 4.678 - 0.74 * win, 0, 5 - win); }
  /** Where Snap stands in the studio, in panels. */
  studioSpot() { return this.phone ? 4.585 : 4.56; }
  /** Snap's place across the screen while the camera travels. */
  snapAt() { return this.phone ? 0.3 : 0.53; }

  /** Camera position for a scroll position k in [0, REEF_UNITS]. */
  camera(k: number, F: number[]) {
    const D = 0;
    for (let i = 0; i < KEYS.length - 1; i++) {
      const [ka, fa] = KEYS[i], [kb, fb] = KEYS[i + 1];
      if (k > kb && i < KEYS.length - 2) continue;
      if (fa === fb) return fa === 0 ? F[0] : F[fa] + D * (2 * clamp((k - ka) / (kb - ka)) - 1);
      const from = fa === 0 ? F[0] : F[fa] + D, to = fb === 5 ? F[5] : F[fb] - D;
      return lerp(from, to, smooth(ka, kb, k));
    }
    return F[5];
  }

  /** The stops whose cards are on screen at scroll position k. */
  cards(k: number) {
    for (let i = 0; i < KEYS.length - 1; i++) {
      const [ka, fa] = KEYS[i], [kb, fb] = KEYS[i + 1];
      if (k > kb && i < KEYS.length - 2) continue;
      if (fa === fb) return { a: fa, b: fa + 1, p: 0 };
      return { a: fa, b: fb, p: smooth(ka, kb, k) };
    }
    return { a: 5, b: 6, p: 0 };
  }

  /** The scroll position (in reef units) of the middle of a station's stop. */
  stopAt(i: number) {
    const a = KEYS.findIndex(([, f]) => f === i);
    return a < 0 ? 0 : (KEYS[a][0] + KEYS[Math.min(KEYS.length - 1, a + 1)][0]) / 2;
  }

  removeRegion(rect: [number, number, number, number], t: number) { this.region = { rect, t0: t }; }
  upscale(t: number, again: boolean) {
    if (again) this.pearlAt = t + 0.5;
    else if (this.pearlAt < 0) this.pearlAt = t;
  }

  /**
   * One frame. L is the camera (left edge, in panels); mouse is the cursor
   * or the last tap. Returns what the backdrop draws and Snap's walking speed.
   */
  update(dt: number, t: number, o: { L: number; k: number; W: number; H: number; dw: number; dh: number; oy: number; F: number[]; snapU: number; mouse: [number, number] | null; on: boolean }): { view: ReefView; out: ReefOut } {
    const { L, W, H, dw, dh, oy, F } = o;
    const win = W / dw;
    const near = F.map((f) => 1 - smooth(0.08, 0.4, Math.abs(L - f) / win));
    const sx = (u: number) => (u - L) * dw, sy = (v: number) => oy + v * dh;

    // Snap's walking speed, from how far his spot on the reef moved.
    const du = Number.isNaN(this.lastU) ? 0 : o.snapU - this.lastU;
    this.lastU = o.snapU;
    const v = dt > 0 ? (du * dw) / dt : 0;
    this.vel += (v - this.vel) * clamp(dt * 10);

    // Leaving a station backwards puts it back as it was.
    if (L < F[4] - 0.45) this.region = null;
    if (L < F[5] - 0.5) { this.lampsAt = -1; this.pearlAt = -1; }

    // The shy cuttlefish: mosaic when the cursor comes near, and once on arrival.
    let pix: ReefView['pix'] = null;
    if (Math.abs(L - F[3]) < 1) {
      const [cu, cv] = SPOTS.cuttle.c;
      const m = o.mouse;
      const dist = m ? Math.hypot(m[0] - sx(cu), m[1] - sy(cv)) : 1e9;
      const close = 1 - smooth(dh * 0.12, dh * 0.32, dist);
      if (near[3] > 0.9 && this.shyArmed) { this.shyUntil = t + 2; this.shyArmed = false; }
      if (near[3] < 0.3) this.shyArmed = true;
      const shy = t < this.shyUntil ? (t < this.shyUntil - 0.7 ? smooth(this.shyUntil - 2, this.shyUntil - 1.75, t) : smooth(this.shyUntil, this.shyUntil - 0.7, t)) : 0;
      const a = Math.max(close, shy);
      pix = { panel: 2, cu: cu - 2, cv, ru: SPOTS.cuttle.r[0], rv: SPOTS.cuttle.r[1], size: a * Math.max(10, dh * 0.026) };
    }
    // The pearl starts as a mosaic and is rebuilt by its upscale.
    if (L > 3.2) {
      const full = Math.max(8, dh * 0.02);
      const s = this.pearlAt < 0 || t < this.pearlAt ? full : full * (1 - smooth(0, 1.4, t - this.pearlAt));
      pix = { panel: 4, cu: SPOTS.pearl.c[0] - 4, cv: SPOTS.pearl.c[1], ru: SPOTS.pearl.r[0], rv: SPOTS.pearl.r[1], size: s };
    }

    // The jellyfish softboxes flicker on, one after another, as Snap arrives.
    let lamps: ReefView['lamps'] = null;
    if (L > 3.4) {
      if (near[5] > 0.6 && this.lampsAt < 0) this.lampsAt = t + 0.3;
      lamps = SPOTS.lamps.map(([u, lv], i) => {
        const tau = this.lampsAt < 0 ? -1 : t - this.lampsAt - 0.45 * i;
        let on = 0;
        if (tau >= 0) on = tau < 0.5 ? (tau < 0.07 || (tau > 0.15 && tau < 0.21) || tau > 0.32 ? 1 : 0.2) : 0.94 + 0.06 * Math.sin(t * 1.7 + i);
        return [u - 4, lv, on] as [number, number, number];
      });
    }

    const region = this.region ? { rect: this.region.rect, amt: clamp((t - this.region.t0) / 0.9) } : null;

    // Foreground coral passes in front of each join between panels.
    const ch = this.phone ? H * 0.52 : H * 0.8;
    const cw = ch * (media.coral.w / media.coral.h);
    this.corals.forEach((m, i) => {
      const seam = sx(i + 1);
      const x = W / 2 + (seam - W / 2) * 1.15;
      const on = o.on && this.ready && x > -cw && x < W + cw;
      m.visible = on;
      if (on) place(m, x - cw / 2, H * 1.06 - ch, cw, ch);
    });

    return {
      view: { L, fy: 0.5, region, pix, lamps },
      out: { on: o.on, L, win, dw, dh, oy, F, near, removed: !!region, cards: this.cards(o.k) },
    };
  }

  hide() { this.corals.forEach((m) => (m.visible = false)); }
}
