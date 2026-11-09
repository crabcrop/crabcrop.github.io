import * as THREE from 'three';
import { media } from '../media';
import type { Stage } from './stage';
import { clamp } from '../scroll';
import { LOOK, LOOK_GLSL } from './look';

// Snap hugging the chain (pose 2), brought to life in the shaders: his legs
// dangle and kick, his eye stalks sway, he blinks with his coral lids and his
// eyes follow the cursor. Regions are in the sprite's uv (y up), measured on
// the 640 x 687 sprite: eyes at (0.578, 0.884) and (0.878, 0.758), bead radius
// about 34 px; legs below uv.y 0.26 right of the chain; stalks above uv.y 0.64.
const VERT = /* glsl */ `
uniform float uTime, uKick, uSway;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float stalk = smoothstep(0.32, 0.46, uv.x) * pow(clamp((uv.y - 0.64) / 0.36, 0.0, 1.0), 1.6);
  p.x += stalk * (sin(uTime * 1.25) * 0.02 + uSway);
  p.y += stalk * sin(uTime * 2.1 + 1.0) * 0.006;
  float leg = smoothstep(0.38, 0.5, uv.x) * pow(clamp((0.27 - uv.y) / 0.27, 0.0, 1.0), 1.15);
  float w = uTime * (4.5 + uKick * 7.0) + uv.x * 9.0;
  p.x += leg * sin(w) * (0.012 + uKick * 0.03);
  p.y += leg * cos(w) * (0.005 + uKick * 0.012);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uOpacity, uBlink, uChainHide, uChainX;
uniform vec3 uGrade;
uniform vec2 uSize, uLookA, uLookB;
uniform vec3 uEyeA, uEyeB;
varying vec2 vUv;
${LOOK_GLSL}
// The bead's content slides toward what he looks at, fading out at its rim.
vec2 look(vec2 uv, vec3 e, vec2 dir) {
  vec2 d = (uv - e.xy) * uSize;
  float inside = 1.0 - smoothstep(e.z * 0.7, e.z, length(d));
  return uv - dir * e.z * 0.26 * inside / uSize;
}
// The coral lid comes down over the eye from the top of its cup.
vec4 lid(vec4 c, vec2 uv, vec3 e) {
  vec2 d = (uv - e.xy) * uSize;
  float r = e.z;
  float cup = 1.0 - smoothstep(r * 1.1, r * 1.2, length(d));
  float line = r * 1.2 - uBlink * r * 2.45;
  float cover = cup * smoothstep(line - 1.2, line + 1.2, d.y);
  vec4 yarn = texture2D(uMap, e.xy + vec2(d.x * 0.8, r * 1.55) / uSize);
  vec3 lidc = yarn.a > 0.5 ? yarn.rgb * 0.94 : vec3(0.86, 0.36, 0.27);
  float edge = cup * (1.0 - smoothstep(0.0, 2.4, abs(d.y - line))) * step(0.03, uBlink);
  vec4 o = mix(c, vec4(lidc, 1.0), cover);
  o.rgb *= 1.0 - edge * 0.35;
  return o;
}
void main() {
  vec2 uv = look(look(vUv, uEyeA, uLookA), uEyeB, uLookB);
  vec4 c = texture2D(uMap, uv);
  // In the air he lets go: the stretch of chain painted in his claws turns to yarn.
  if (uChainHide > 0.0) {
    float band = 1.0 - smoothstep(0.05, 0.085, abs(vUv.x - uChainX));
    float iron = smoothstep(0.34, 0.2, c.r - c.g) * smoothstep(0.66, 0.46, c.r);
    c.rgb = mix(c.rgb, vec3(0.84, 0.36, 0.28), band * iron * uChainHide);
  }
  if (uBlink > 0.0) { c = lid(c, vUv, uEyeA); c = lid(c, vUv, uEyeB); }
  if (c.a < 0.004) discard;
  gl_FragColor = vec4(applyLook(c.rgb * uGrade), c.a * uOpacity);
}`;

const EYES = [[0.578, 0.884, 34], [0.878, 0.758, 34]] as const;
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export interface RideOut { top: [number, number]; bottom: [number, number] }

/** Snap on the chain: the living sprite, its swing and its spins, and its flight to and from the chain. */
export class Rider {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  readonly u: Record<string, THREE.IUniform>;
  private swing = 0;
  private swingV = 0;
  private lastSpeed = 0;
  private spinAt = -10;
  private nextIdleSpin = 9;
  private blinkAt = 2;
  private landedAt = -10;
  private box = { x: 0, y: 0, w: 0, h: 0 };
  /** True while a spin around the chain is under way. */
  get spinning() { return this.t - this.spinAt < 0.9; }
  private t = 0;

  constructor(stage: Stage) {
    const sc = media.snapChain;
    this.u = {
      uMap: { value: null }, uOpacity: { value: 1 }, uGrade: { value: new THREE.Vector3(1, 1, 1) }, uChainHide: { value: 0 }, uChainX: { value: sc.chainX },
      uTime: { value: 0 }, uKick: { value: 0 }, uSway: { value: 0 }, uBlink: { value: 0 },
      uSize: { value: new THREE.Vector2(sc.w, sc.h) }, uLookA: { value: new THREE.Vector2() }, uLookB: { value: new THREE.Vector2() },
      uEyeA: { value: new THREE.Vector3(...EYES[0]) }, uEyeB: { value: new THREE.Vector3(...EYES[1]) },
      ...LOOK,
    };
    const geo = new THREE.PlaneGeometry(1, 1, 20, 20);
    geo.translate(0.5, -0.5, 0);
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, transparent: true, depthTest: false, depthWrite: false }));
    this.mesh.renderOrder = 5;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    this.group.visible = false;
    stage.scene.add(this.group);
  }

  setTexture(t: THREE.Texture) { this.u.uMap.value = t; }
  get ready() { return !!this.u.uMap.value; }

  /** A spin around the chain: now, unless he is mid-spin or spun a moment ago. */
  spin(t: number, force = false) {
    if (!force && t - this.spinAt < 3.5) return;
    this.spinAt = t;
  }
  /** He has just caught the chain: a squash, and the chain gets a jolt from the caller. */
  land(t: number) { this.landedAt = t; }

  /** Is a screen point on him (for a click)? */
  hit(x: number, y: number) {
    const b = this.box;
    return this.group.visible && x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h;
  }

  /** Centre of the sprite, relative to the top hold, when he rides at height h. */
  static centre(h: number): [number, number] {
    const sc = media.snapChain, w = h * (sc.w / sc.h);
    return [(0.5 - sc.chainX) * w, (0.5 - sc.chainTop) * h];
  }

  /**
   * One frame. Riding: the top hold sits at hold, leaning with the chain.
   * In the air (air set): his centre at air.x, air.y, turned by air.rot,
   * scaled by air.s. Returns the holds while he rides.
   */
  update(dt: number, t: number, o: {
    visible: boolean; hold: [number, number]; h: number; lean: number; speed: number;
    mouse: [number, number] | null; grade: [number, number, number]; idle: boolean;
    air?: { x: number; y: number; rot: number; s: number };
  }): RideOut | null {
    this.t = t;
    this.group.visible = o.visible && this.ready;
    if (!this.group.visible) return null;
    const sc = media.snapChain;
    const h = o.h, w = h * (sc.w / sc.h);

    // Life: legs kick harder when the reef rushes by, the stalks lag behind the swing.
    const fast = Math.min(1, Math.abs(o.speed) / 30);
    this.u.uTime.value = t;
    this.u.uKick.value += ((o.air ? 1 : 0.15 + fast * 0.85) - this.u.uKick.value) * clamp(dt * 4);
    this.u.uSway.value = clamp(-this.swingV * 0.05, -0.05, 0.05);

    // Blinks every few seconds, sometimes twice.
    if (t > this.blinkAt + 0.2) this.blinkAt = t + 2.2 + Math.random() * 4 + (Math.random() < 0.2 ? -1.9 : 0);
    const bt = t - this.blinkAt;
    this.u.uBlink.value = bt < 0 ? 0 : bt < 0.07 ? bt / 0.07 : bt < 0.11 ? 1 : bt < 0.2 ? 1 - (bt - 0.11) / 0.09 : 0;

    this.u.uChainHide.value = o.air ? 1 : 0;
    if (o.air) {
      this.group.position.set(o.air.x, -o.air.y, 0);
      this.group.rotation.z = -o.air.rot;
      this.group.scale.set(o.air.s, o.air.s, 1);
      this.mesh.position.set(-w / 2, h / 2, 0);
      this.mesh.scale.set(w, h, 1);
      this.u.uGrade.value.set(...o.grade);
      this.box = { x: o.air.x - w / 2, y: o.air.y - h / 2, w, h };
      this.eyes(o.mouse, (u) => o.air!.x + (u - 0.5) * w, (v) => o.air!.y + (0.5 - v) * h, 1);
      return null;
    }

    // A pendulum on the chain, pushed by changes in scroll speed, with a slow idle sway.
    const accel = (o.speed - this.lastSpeed) / Math.max(dt, 1e-3);
    this.lastSpeed = o.speed;
    this.swingV += (-14 * this.swing - 3.2 * this.swingV + clamp(accel * 0.0007, -6, 6)) * dt;
    this.swing = clamp(this.swing + this.swingV * dt, -0.3, 0.3);
    const idleSway = Math.sin(t * 0.7) * 0.025;

    // Spins: on a fast flick, now and then when idle, or when asked.
    if (Math.abs(o.speed) > 45) this.spin(t);
    if (o.idle && t > this.nextIdleSpin) { this.spin(t); this.nextIdleSpin = t + 10 + Math.random() * 6; }
    if (!o.idle) this.nextIdleSpin = Math.max(this.nextIdleSpin, t + 6);
    const sp = clamp((t - this.spinAt) / 0.9);
    const phi = sp < 1 ? ease(sp) * Math.PI * 2 : 0;
    const hop = Math.sin(phi / 2) * h * 0.05;
    const flip = Math.cos(phi);

    // Catching the chain: a quick squash and recoil.
    const lt = t - this.landedAt;
    const squash = lt < 0.5 ? Math.sin(lt * 18) * Math.exp(-lt * 7) * 0.14 : 0;

    const bob = Math.sin(t * 1.4) * h * 0.012;
    const [hx, hy0] = o.hold;
    const hy = hy0 + bob - hop;
    const angle = o.lean + this.swing + idleSway;
    this.group.position.set(hx, -hy, 0);
    this.group.rotation.z = -angle;
    this.group.scale.set(flip * (1 + squash * 0.6), 1 - squash, 1);
    this.mesh.position.set(-sc.chainX * w, sc.chainTop * h, 0);
    this.mesh.scale.set(w, h, 1);
    const shade = 0.8 + 0.2 * Math.abs(flip);
    this.u.uGrade.value.set(o.grade[0] * shade, o.grade[1] * shade, o.grade[2] * shade);
    const f = Math.max(0.3, Math.abs(flip));
    this.box = { x: flip >= 0 ? hx - sc.chainX * w * f : hx - (1 - sc.chainX) * w * f, y: hy - sc.chainTop * h, w: w * f, h };
    this.eyes(o.mouse, (u) => hx + (u - sc.chainX) * w * flip, (v) => hy + (1 - v - sc.chainTop) * h, flip);

    const span = (sc.chainBottom - sc.chainTop) * h * (1 - squash);
    return { top: [hx, hy], bottom: [hx + Math.sin(angle) * span, hy + Math.cos(angle) * span] };
  }

  /** Point both eyes at the cursor, or let them wander. ex and ey place a sprite uv on screen. */
  private eyes(mouse: [number, number] | null, sx: (u: number) => number, sy: (v: number) => number, flip: number) {
    const keys = ['uLookA', 'uLookB'] as const;
    EYES.forEach(([u, v], i) => {
      const ex = sx(u), ey = sy(v);
      let dx: number, dy: number;
      if (mouse) {
        dx = mouse[0] - ex; dy = mouse[1] - ey;
        const d = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, d / 260) / d;
        dx *= k; dy *= k;
      } else {
        dx = Math.sin(this.t * 0.5 + i) * 0.6; dy = Math.cos(this.t * 0.37) * 0.3;
      }
      // Screen y is down; the shader's uv y is up. Mirrored, x turns around too.
      const target = this.u[keys[i]].value as THREE.Vector2;
      const fx = flip < 0 ? -dx : dx;
      target.x += (fx - target.x) * 0.2;
      target.y += (-dy - target.y) * 0.2;
    });
  }
}
