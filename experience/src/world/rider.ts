import * as THREE from 'three';
import { media } from '../media';
import type { Stage } from './stage';
import { clamp } from '../scroll';
import { Snap3D, type Pose } from './snap3d';
import type { Sparkles } from './sparkle';
import { LOOK, LOOK_GLSL } from './look';

// Snap's body. Once it has loaded he is the 3D model (snap3d.ts), alive in
// code: on his feet (on the pier, in the submarine's bubble) and in the air
// between the two. If it cannot load, he is the pose-2 sprite brought to
// life in the shaders here: his legs dangle and kick, his eye stalks sway,
// he blinks with his coral lids. Either way his eyes follow the cursor.
// Sprite regions are in its uv (y up), measured on the 640 x 687 sprite:
// eyes at (0.578, 0.884) and (0.878, 0.758), bead radius about 34 px; legs
// below uv.y 0.26; stalks above uv.y 0.64.
const VERT = /* glsl */ `
uniform float uTime, uKick;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float stalk = smoothstep(0.32, 0.46, uv.x) * pow(clamp((uv.y - 0.64) / 0.36, 0.0, 1.0), 1.6);
  p.x += stalk * sin(uTime * 1.25) * 0.02;
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
uniform float uOpacity, uBlink, uChainX;
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
  // The sprite was painted holding a stretch of chain: that turns to yarn.
  float band = 1.0 - smoothstep(0.05, 0.085, abs(vUv.x - uChainX));
  float iron = smoothstep(0.34, 0.2, c.r - c.g) * smoothstep(0.66, 0.46, c.r);
  c.rgb = mix(c.rgb, vec3(0.84, 0.36, 0.28), band * iron);
  if (uBlink > 0.0) { c = lid(c, vUv, uEyeA); c = lid(c, vUv, uEyeB); }
  if (c.a < 0.004) discard;
  gl_FragColor = vec4(applyLook(c.rgb * uGrade), c.a * uOpacity);
}`;

const EYES = [[0.578, 0.884, 34], [0.878, 0.758, 34]] as const;

/**
 * What he does when tapped, by where he is: on the pier he hops or snaps
 * (his free claw holds the print); in the submarine he waves, snaps his
 * pincer, hops or wiggles. Each goes in turn.
 */
type Act = 'wave' | 'snap' | 'wiggle' | 'hop';
const ACT_LEN: Record<Act, number> = { wave: 1.7, snap: 0.75, wiggle: 0.9, hop: 0.6 };
export type Where = 'pier' | 'sub';
const MENU: Record<Where, Act[]> = { pier: ['hop', 'snap'], sub: ['wave', 'snap', 'hop', 'wiggle'] };
const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** Snap's body: the 3D model or the living sprite, on his feet or in the air, and his little reactions. */
export class Rider {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  readonly u: Record<string, THREE.IUniform>;
  private blinkAt = 2;
  private box = { x: 0, y: 0, w: 0, h: 0 };
  /** Snap in 3D. */
  readonly snap3d: Snap3D;
  private kick = 0.15;
  private actNow: { kind: Act; t0: number; sparks: number } | null = null;
  private acts: Record<Where, number> = { pier: 0, sub: 0 };
  private hello = 0;
  private holdUp = 0;
  private t = 0;

  constructor(stage: Stage, private sparkles: Sparkles) {
    this.snap3d = new Snap3D(stage);
    const sc = media.snapChain;
    this.u = {
      uMap: { value: null },
      uOpacity: { value: 1 }, uGrade: { value: new THREE.Vector3(1, 1, 1) }, uChainX: { value: sc.chainX },
      uTime: { value: 0 }, uKick: { value: 0 }, uBlink: { value: 0 },
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

  /** The sprite, for when the 3D model will not load. */
  setTexture(t: THREE.Texture) { this.u.uMap.value = t; }
  get ready() { return !!this.u.uMap.value; }

  /** Start a reaction now. */
  act(t: number, kind: Act) { this.actNow = { kind, t0: t, sparks: 0 }; }

  /** Tapped: a reaction that suits where he is, unless one is still going. */
  react(t: number, where: Where) {
    if (this.actNow && t - this.actNow.t0 < ACT_LEN[this.actNow.kind]) return;
    const menu = MENU[where];
    this.actNow = { kind: menu[this.acts[where]++ % menu.length], t0: t, sparks: 0 };
  }

  /** What the reaction under way does this frame (h is his height, px). */
  private acting(t: number, h: number) {
    const out = { wave: 0, snap: 0, squint: 0, roll: 0, lift: 0, squash: 0, spark: false };
    const a = this.actNow;
    if (!a) return out;
    const age = t - a.t0, len = ACT_LEN[a.kind];
    if (age > len) { this.actNow = null; return out; }
    const env = smoothstep(0, 0.15, age) * (1 - smoothstep(len - 0.25, len, age));
    if (a.kind === 'wave') { out.wave = env; out.squint = env * 0.9; }
    if (a.kind === 'snap') {
      out.snap = age / len;
      out.squint = env * 0.4;
      // a little burst of stars each time the pincer shuts
      if (a.sparks < 2 && out.snap >= 0.125 + a.sparks * 0.5) { a.sparks++; out.spark = true; }
    }
    if (a.kind === 'wiggle') { out.roll = Math.sin(age * 24) * 0.13 * (1 - age / len); out.squint = env; }
    if (a.kind === 'hop') {
      const u = age / len;
      out.lift = u > 0.15 && u < 0.85 ? Math.sin(((u - 0.15) / 0.7) * Math.PI) * h * 0.18 : 0;
      out.squash = u < 0.15 ? Math.sin((u / 0.15) * Math.PI) * 0.12 : u > 0.85 ? Math.sin(((u - 0.85) / 0.15) * Math.PI) * 0.1 : -0.05;
      out.squint = env;
    }
    return out;
  }
  private spark(h: number) {
    const [x, y] = this.snap3d.pincer();
    this.sparkles.burst(x, y, h * 0.24, 2);
  }

  /** Blinks every few seconds, sometimes twice. */
  private blinking(t: number) {
    if (t > this.blinkAt + 0.2) this.blinkAt = t + 2.2 + Math.random() * 4 + (Math.random() < 0.2 ? -1.9 : 0);
    const bt = t - this.blinkAt;
    return bt < 0 ? 0 : bt < 0.07 ? bt / 0.07 : bt < 0.11 ? 1 : bt < 0.2 ? 1 - (bt - 0.11) / 0.09 : 0;
  }

  /** His middle, from the middle of his feet, px (y down), standing h tall in 3D. */
  standCentre(h: number) { return this.snap3d.standCentre(h); }

  /**
   * Snap in 3D on his feet: on the pier or in the submarine's bubble, the
   * middle of his feet at feet, h tall. hello: waving the raised claw; hold:
   * the free claw lifted (with the print in it); look: what he watches
   * instead of the cursor; surprise and crouch (before a hop), 0 to 1; lean,
   * radians; headroom: how high a hop may lift him, px (the bubble's roof).
   */
  stand(dt: number, t: number, o: {
    feet: [number, number]; h: number; grade: [number, number, number]; mouse: [number, number] | null;
    look?: [number, number] | null; hello?: number; hold?: number; surprise?: number; crouch?: number; lean?: number; headroom?: number;
  }) {
    this.t = t;
    this.group.visible = false;
    const s3 = this.snap3d, h = o.h;
    const blink = this.blinking(t);
    const act = this.acting(t, h);
    // The wave and the raised claw ease in and out as the story moves on.
    this.hello += ((o.hello ?? 0) - this.hello) * clamp(dt * 6);
    this.holdUp += ((o.hold ?? 0) - this.holdUp) * clamp(dt * 6);
    const lift = Math.min(act.lift, o.headroom ?? Infinity);
    const pose: Pose = { at: [o.feet[0], o.feet[1] - lift], h, roll: act.roll + (o.lean ?? 0), spin: 0, squash: (o.crouch ?? 0) * 0.2 + act.squash, mode: 'stand' };
    s3.update(pose, {
      t, dt, kick: 0, mouse: o.mouse, blink, look: o.look ?? null, planted: true,
      squint: act.squint, hello: this.hello, hold: this.holdUp,
      wave: act.wave, snap: act.snap, surprise: o.surprise ?? 0,
    }, o.grade);
    this.box = s3.box(pose);
    if (act.spark) this.spark(h);
  }

  /** Is a screen point on him (for a click)? */
  hit(x: number, y: number) {
    const b = this.box;
    return (this.group.visible || this.snap3d.group.visible) && x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h;
  }

  /** Out of the picture. */
  hide() { this.group.visible = false; this.snap3d.hide(); }

  /**
   * One frame off his feet: in the air on a leap, his middle at air.x,
   * air.y, turned by air.rot and scaled by air.s. (The sprite, which cannot
   * stand, is drawn this way in its seat too.)
   */
  fly(dt: number, t: number, o: { h: number; mouse: [number, number] | null; grade: [number, number, number]; air: { x: number; y: number; rot: number; s: number }; legs?: number }) {
    this.t = t;
    const real = this.snap3d.ready;
    this.group.visible = !real && this.ready;
    if (!real && !this.ready) { this.snap3d.hide(); return; }
    const h = o.h, air = o.air;
    // His legs kick as he flies.
    this.kick += ((o.legs ?? 1) - this.kick) * clamp(dt * 4);
    const blink = this.blinking(t);
    const act = this.acting(t, h);
    if (real) {
      // A tumble: once round his own up as he flies, rolling into the arc and back out.
      const pose: Pose = { at: [air.x, air.y], h: h * air.s, roll: -Math.sin(air.rot / 2) * 0.35, spin: air.rot, squash: 0, mode: 'air' };
      this.snap3d.update(pose, { t, dt, kick: this.kick, mouse: o.mouse, blink, squint: act.squint, wave: act.wave, snap: act.snap }, o.grade);
      this.box = this.snap3d.box(pose);
      if (act.spark) this.spark(h);
      return;
    }
    const sc = media.snapChain, w = h * (sc.w / sc.h);
    this.u.uTime.value = t;
    this.u.uKick.value = this.kick;
    this.u.uBlink.value = blink;
    this.group.position.set(air.x, -air.y, 0);
    this.group.rotation.z = -air.rot;
    this.group.scale.set(air.s, air.s, 1);
    this.mesh.position.set(-w / 2, h / 2, 0);
    this.mesh.scale.set(w, h, 1);
    this.u.uGrade.value.set(...o.grade);
    this.box = { x: air.x - w / 2, y: air.y - h / 2, w, h };
    this.eyes(o.mouse, (u) => air.x + (u - 0.5) * w, (v) => air.y + (0.5 - v) * h);
  }

  /** The sprite: point both eyes at the cursor, or let them wander. sx and sy place a uv (y up) on screen. */
  private eyes(mouse: [number, number] | null, sx: (u: number) => number, sy: (v: number) => number) {
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
      // Screen y is down; the shader's uv y is up.
      const target = this.u[keys[i]].value as THREE.Vector2;
      target.x += (dx - target.x) * 0.2;
      target.y += (-dy - target.y) * 0.2;
    });
  }
}
