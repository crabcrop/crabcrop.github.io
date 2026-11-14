import * as THREE from 'three';
import { media, loadPicture } from '../media';
import { imageTexture, type Stage } from './stage';
import { LOOK, LOOK_GLSL } from './look';
import { clamp } from '../scroll';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// The lost fish: a sprite from the fish sheet, dim until the light finds it.
const FISH_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform vec4 uRect;
uniform float uOpacity, uFlip, uLit;
varying vec2 vUv;
${LOOK_GLSL}
void main() {
  vec2 u = vec2(uFlip > 0.0 ? vUv.x : 1.0 - vUv.x, vUv.y);
  vec4 c = texture2D(uMap, uRect.xy + u * uRect.zw);
  if (c.a < 0.01) discard;
  vec3 col = c.rgb * mix(vec3(0.28, 0.34, 0.5), vec3(1.05, 1.0, 0.92), uLit);
  gl_FragColor = vec4(applyLook(col), c.a * uOpacity);
}`;

// The glowing jellyfish, on black: added to the light behind it, its tentacles swaying.
const JELLY_VERT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float down = 1.0 - uv.y;
  p.x += sin(uTime * 1.1 + uv.y * 7.0) * 0.035 * down * down;
  p.y += sin(uTime * 0.9) * 0.01;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const JELLY_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uA;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uMap, vUv).rgb;
  gl_FragColor = vec4(c * uA, 1.0);
}`;

type FishState = 'lost' | 'follow' | 'home';

export interface TwilightOut {
  /** The lantern: where its light is and its radius, px. */
  light: [number, number, number];
  /** The little fish has gone home with Snap (for the story). */
  homeAt: number;
}

/**
 * The twilight zone's life: the lantern the visitor carries (the cursor, or
 * on phones a slow sweep and wherever they tap), a tiny lost fish that
 * follows its light and then keeps the submarine company, and a glowing
 * jellyfish drifting past.
 */
export class Twilight {
  private light = { x: -1, y: -1 };
  private fish: THREE.Mesh;
  private fu: Record<string, THREE.IUniform>;
  private jelly: THREE.Mesh;
  private ju: Record<string, THREE.IUniform>;
  private ready = false;
  private f = { state: 'lost' as FishState, x: 0, y: 0, vx: 0, lit: 0, since: 0 };
  readonly out: TwilightOut = { light: [-999, -999, 1], homeAt: -10 };

  constructor(stage: Stage, private phone: boolean) {
    this.fu = { uMap: { value: null }, uRect: { value: new THREE.Vector4() }, uOpacity: { value: 0 }, uFlip: { value: 1 }, uLit: { value: 0 }, ...LOOK };
    this.fish = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FISH_FRAG, uniforms: this.fu, transparent: true, depthTest: false, depthWrite: false }));
    this.fish.renderOrder = 6;
    this.ju = { uMap: { value: null }, uA: { value: 0 }, uTime: { value: 0 } };
    this.jelly = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 16), new THREE.ShaderMaterial({ vertexShader: JELLY_VERT, fragmentShader: JELLY_FRAG, uniforms: this.ju, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.jelly.renderOrder = 8;
    for (const m of [this.fish, this.jelly]) { m.visible = false; m.frustumCulled = false; stage.scene.add(m); }
  }

  async load() {
    const [fish, jelly] = await Promise.all([loadPicture('fish'), loadPicture('glow-jelly')]);
    this.fu.uMap.value = imageTexture(fish);
    const [x, y, w, h] = media.fish.rects.webp;
    this.fu.uRect.value.set(x / media.fish.w, 1 - (y + h) / media.fish.h, w / media.fish.w, h / media.fish.h);
    this.ju.uMap.value = imageTexture(jelly);
    this.ready = true;
  }

  reset() { this.f.state = 'lost'; this.f.x = 0; this.out.homeAt = -10; }

  /**
   * vis: how much the zone is on; k: 0 to 1 through it; mouse: the cursor
   * (or a recent tap); lost: where the fish waits, px; side: where it swims
   * once it has gone home with Snap, by the submarine's lamp.
   */
  update(dt: number, t: number, o: {
    vis: number; k: number; w: number; h: number; mouse: [number, number] | null; lost: [number, number]; side: [number, number];
  }) {
    const on = o.vis > 0.01;
    const { w, h } = o;
    // The lantern: where the cursor (or a tap) is, else a slow sweep over the middle of the scene.
    const sweep: [number, number] = [w * (0.55 + 0.3 * Math.sin(t * 0.21)), h * (0.48 + 0.2 * Math.sin(t * 0.33 + 1.3))];
    const target = o.mouse ?? sweep;
    if (this.light.x < 0) { this.light.x = target[0]; this.light.y = target[1]; }
    const ease = 1 - Math.exp(-dt * (o.mouse ? 9 : 2.5));
    this.light.x += (target[0] - this.light.x) * ease;
    this.light.y += (target[1] - this.light.y) * ease;
    const r = h * (this.phone ? 0.22 : 0.3);
    this.out.light = [this.light.x, this.light.y, r];

    this.fish.visible = this.jelly.visible = false;
    if (!on || !this.ready) return;

    // The lost fish: it circles where it is lost, follows the light once found, and goes home with Snap.
    const f = this.f, s = h * 0.03;
    if (!f.x) { f.x = o.lost[0]; f.y = o.lost[1]; }
    const dl = Math.hypot(f.x - this.light.x, f.y - this.light.y);
    if (f.state === 'lost' && dl < r * 0.8 && o.k > 0.05) { f.state = 'follow'; f.since = t; }
    if (f.state !== 'home' && o.k > 0.72) { f.state = 'home'; f.since = t; this.out.homeAt = t; }
    let tx: number, ty: number;
    if (f.state === 'lost') {
      tx = o.lost[0] + Math.cos(t * 1.3) * s * 1.6; ty = o.lost[1] + Math.sin(t * 2.1) * s * 0.8;
    } else if (f.state === 'follow') {
      // just ahead of the light, wiggling round it
      tx = this.light.x + Math.cos(t * 1.7) * r * 0.25; ty = this.light.y + Math.sin(t * 2.3) * r * 0.18;
    } else {
      // keeping the submarine company, swimming small loops by its lamp
      tx = o.side[0] + Math.cos(t * 1.1) * s * 2; ty = o.side[1] + Math.sin(t * 1.6) * s * 1.2;
    }
    const k = 1 - Math.exp(-dt * (f.state === 'lost' ? 3 : 2.2));
    const nx = f.x + (tx - f.x) * k;
    f.vx = (nx - f.x) / Math.max(dt, 1e-3);
    f.x = nx;
    f.y += (ty - f.y) * k;
    f.lit += ((f.state === 'lost' ? clamp(1 - dl / r) : 1) - f.lit) * clamp(dt * 4);
    const fr = media.fish.rects.webp;
    const fw = s * 2.2, fh = fw * (fr[3] / fr[2]);
    this.fish.visible = true;
    this.fish.position.set(f.x, -f.y, 0);
    this.fish.scale.set(fw, fh, 1);
    this.fish.rotation.z = -Math.sin(t * 6) * 0.06;
    if (Math.abs(f.vx) > 8) this.fu.uFlip.value = f.vx > 0 ? 1 : -1;
    this.fu.uLit.value = f.lit;
    this.fu.uOpacity.value = o.vis;

    // A glowing jellyfish drifts up through the right of the frame.
    const jm = media.glowJelly;
    const jh = h * (this.phone ? 0.36 : 0.5), jw = jh * (jm.w / jm.h);
    const jy = h * 1.2 - o.k * h * 1.9;
    this.jelly.visible = jy > -jh && jy < h + jh;
    this.jelly.position.set(w * (this.phone ? 0.86 : 0.9) + Math.sin(t * 0.3) * w * 0.01, -jy, 0);
    this.jelly.scale.set(jw, jh, 1);
    this.ju.uTime.value = t;
    this.ju.uA.value = 0.75 * o.vis;
  }
}
