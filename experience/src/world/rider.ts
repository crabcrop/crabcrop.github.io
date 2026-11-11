import * as THREE from 'three';
import { media, makeVideo, whenPlayable } from '../media';
import { videoTexture, type Stage } from './stage';
import { clamp } from '../scroll';
import { Snap3D, type Pose } from './snap3d';
import type { Sparkles } from './sparkle';
import { LOOK, LOOK_GLSL } from './look';

// Snap on the chain. Once it has loaded he is the 3D model (snap3d.ts),
// alive in code: riding, spinning round the chain and flying to and from it.
// Until then, and if it cannot load, he is the pose-2 sprite brought to life
// in the shaders here (his legs dangle and kick, his eye stalks sway, he
// blinks with his coral lids), and riding, the filmed loops M10 to M12 in
// stacked-alpha video, loaded only if the model fails. Either way his eyes
// follow the cursor. Sprite regions are in its uv (y up), measured on the
// 640 x 687 sprite: eyes at (0.578, 0.884) and (0.878, 0.758), bead radius
// about 34 px; legs below uv.y 0.26 right of the chain; stalks above uv.y 0.64.
const VERT = /* glsl */ `
uniform float uTime, uKick, uSway, uVideo;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float still = 1.0 - uVideo;
  float stalk = smoothstep(0.32, 0.46, uv.x) * pow(clamp((uv.y - 0.64) / 0.36, 0.0, 1.0), 1.6) * still;
  p.x += stalk * (sin(uTime * 1.25) * 0.02 + uSway);
  p.y += stalk * sin(uTime * 2.1 + 1.0) * 0.006;
  float leg = smoothstep(0.38, 0.5, uv.x) * pow(clamp((0.27 - uv.y) / 0.27, 0.0, 1.0), 1.15) * still;
  float w = uTime * (4.5 + uKick * 7.0) + uv.x * 9.0;
  p.x += leg * sin(w) * (0.012 + uKick * 0.03);
  p.y += leg * cos(w) * (0.005 + uKick * 0.012);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap, uVid;
uniform float uOpacity, uBlink, uChainHide, uChainX, uVideo;
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
  vec4 c;
  if (uVideo > 0.5) {
    // Stacked alpha: colour in the top half, the matte in the bottom half.
    c = vec4(texture2D(uVid, vec2(uv.x, 0.5 + uv.y * 0.498)).rgb, texture2D(uVid, vec2(uv.x, uv.y * 0.498)).r);
  } else {
    c = texture2D(uMap, uv);
    // In the air he lets go: the stretch of chain painted in his claws turns to yarn.
    if (uChainHide > 0.0) {
      float band = 1.0 - smoothstep(0.05, 0.085, abs(vUv.x - uChainX));
      float iron = smoothstep(0.34, 0.2, c.r - c.g) * smoothstep(0.66, 0.46, c.r);
      c.rgb = mix(c.rgb, vec3(0.84, 0.36, 0.28), band * iron * uChainHide);
    }
    if (uBlink > 0.0) { c = lid(c, vUv, uEyeA); c = lid(c, vUv, uEyeB); }
  }
  if (c.a < 0.004) discard;
  gl_FragColor = vec4(applyLook(c.rgb * uGrade), c.a * uOpacity);
}`;

const EYES = [[0.578, 0.884, 34], [0.878, 0.758, 34]] as const;
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export type RideKey = 'm10' | 'm11' | 'm12';
/** The calm loop, and the two he slips in now and then: a happy wave, and a peek down into the depths. */
const VARIATIONS: RideKey[] = ['m11', 'm12'];

/** His holds on the chain: the 3D Snap holds it at one point, in his raised claw; the sprite and film at the two ends of the stretch painted into them. */
export interface RideOut { top: [number, number]; bottom?: [number, number] }

/**
 * What he does when tapped, by where he is: on the chain he spins round it,
 * waves his free claw, snaps his pincer or wiggles; on the pier he hops or
 * snaps (his free claw holds the print); walking he waves or hops; on a card
 * he snaps or hops. Each goes in turn.
 */
type Act = 'spin' | 'wave' | 'snap' | 'wiggle' | 'hop';
const ACT_LEN: Record<Act, number> = { spin: 0.9, wave: 1.7, snap: 0.75, wiggle: 0.9, hop: 0.6 };
export type Where = 'chain' | 'pier' | 'walk' | 'perch';
const MENU: Record<Where, Act[]> = { chain: ['spin', 'wave', 'snap', 'wiggle'], pier: ['hop', 'snap'], walk: ['wave', 'hop'], perch: ['snap', 'hop'] };
const ORIGIN = new THREE.Vector3();
const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** A value from a track of [t, ...values] rows at the clip time tt, interpolated. */
function sample(track: number[][], tt: number, col: number) {
  if (!track.length) return 0;
  let i = 0;
  while (i < track.length - 1 && track[i + 1][0] <= tt) i++;
  const a = track[i], b = track[Math.min(i + 1, track.length - 1)];
  const f = b[0] > a[0] ? clamp((tt - a[0]) / (b[0] - a[0])) : 0;
  return a[col] + (b[col] - a[col]) * f;
}

/** Snap on the chain: the filmed loops and the living sprite, his swing and spins, and his flight to and from the chain. */
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
  private vids: Partial<Record<RideKey, { v: HTMLVideoElement; tex: THREE.VideoTexture; ready: boolean }>> = {};
  private cur: RideKey = 'm10';
  private shown: RideKey | null = null;
  private loopsSinceVariation = 0;
  private nextVariation = 0;
  private lastTime = 0;
  private wasRiding = false;
  private rate = 1;
  /** Snap in 3D: on the chain, round it and in the air. */
  readonly snap3d: Snap3D;
  private rideAsked = false;
  private kick = 0.15;
  private actNow: { kind: Act; t0: number; sparks: number } | null = null;
  private acts: Record<Where, number> = { chain: 0, pier: 0, walk: 0, perch: 0 };
  private dip = false;
  private walkPh = 0;
  private face = 0;
  private hello = 0;
  private holdUp = 0;
  /** True while a spin around the chain is under way. */
  get spinning() { return this.t - this.spinAt < 0.9; }
  private t = 0;

  constructor(stage: Stage, private sparkles: Sparkles) {
    this.snap3d = new Snap3D(stage);
    const sc = media.snapChain;
    this.u = {
      uMap: { value: null }, uVid: { value: null }, uVideo: { value: 0 },
      uOpacity: { value: 1 }, uGrade: { value: new THREE.Vector3(1, 1, 1) }, uChainHide: { value: 0 }, uChainX: { value: sc.chainX },
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

  /**
   * Snap for the chain: the 3D model, or if it will not load, the filmed
   * loops (the calm one first, then the two variations).
   */
  async loadRide() {
    if (this.rideAsked) return;
    this.rideAsked = true;
    try {
      await this.snap3d.load();
      return;
    } catch {
      // The film instead.
    }
    const make = (k: RideKey) => {
      const v = makeVideo(`snap-${k}.mp4`, k === 'm10');
      this.vids[k] = { v, tex: videoTexture(v), ready: false };
      return v;
    };
    const m10 = make('m10');
    await whenPlayable(m10);
    this.vids.m10!.ready = true;
    for (const k of VARIATIONS) {
      const v = make(k);
      whenPlayable(v).then(() => { this.vids[k]!.ready = true; });
    }
  }

  /** Pause the film (the tab is hidden); riding resumes it. */
  pause() { for (const c of Object.values(this.vids)) c?.v.pause(); }

  /** A spin around the chain: now, unless he is mid-spin or spun a moment ago. */
  spin(t: number, force = false) {
    if (!force && t - this.spinAt < 3.5) return;
    this.spinAt = t;
  }
  /** He has just caught the chain: a squash (and a dip into the water when he lands in it); the chain gets a jolt from the caller. */
  land(t: number, dip = false) { this.landedAt = t; this.dip = dip; }

  /** Start a reaction now (a card visit's snaps). */
  act(t: number, kind: Act) { this.actNow = { kind, t0: t, sparks: 0 }; }

  /** Tapped: a reaction that suits where he is, unless one is still going. */
  react(t: number, where: Where) {
    if (this.actNow && t - this.actNow.t0 < ACT_LEN[this.actNow.kind]) return;
    const menu = MENU[where];
    const kind = menu[this.acts[where]++ % menu.length];
    if (kind === 'spin') this.spin(t, true);
    this.actNow = { kind, t0: t, sparks: 0 };
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

  /** From the middle of his feet to his chain point, px (y down), standing h tall in 3D. */
  gripFromFeet(h: number): [number, number] { const f = this.snap3d.foot; return [-f.x * h, f.y * h]; }
  /** His middle, from the middle of his feet, px (y down), standing h tall in 3D. */
  standCentre(h: number) { return this.snap3d.standCentre(h); }

  /**
   * Snap in 3D on his feet: on the pier, a card or the sand, the middle of
   * his feet at feet, h tall. hello: waving the raised claw; hold: the free
   * claw lifted (with the print in it); vel: walking sideways, px a second
   * (0 stands); look: what he watches instead of the cursor; surprise and
   * crouch (before a hop), 0 to 1; lean, radians. Returns his chain point on screen.
   */
  stand(dt: number, t: number, o: {
    feet: [number, number]; h: number; grade: [number, number, number]; mouse: [number, number] | null;
    look?: [number, number] | null; hello?: number; hold?: number; vel?: number; surprise?: number; crouch?: number; lean?: number;
  }): [number, number] {
    this.t = t;
    this.group.visible = false;
    this.film(false, 0);
    const s3 = this.snap3d, h = o.h;
    const blink = this.blinking(t);
    const act = this.acting(t, h);
    // The wave and the raised claw ease in and out as the story moves on.
    this.hello += ((o.hello ?? 0) - this.hello) * clamp(dt * 6);
    this.holdUp += ((o.hold ?? 0) - this.holdUp) * clamp(dt * 6);
    // Walking sideways: two steps a stride, his body bobbing and rocking with them; he turns a little toward where he goes.
    const vel = o.vel ?? 0, speed = Math.abs(vel), walking = speed > 20;
    this.walkPh += dt * Math.PI * 2 * Math.min(3.2, speed / (h * 0.55));
    this.face += ((walking ? Math.sign(vel) * 0.25 * Math.min(1, speed / 220) : 0) - this.face) * clamp(dt * 4);
    const bob = walking ? Math.abs(Math.sin(this.walkPh)) * h * 0.02 : 0;
    const rock = walking ? Math.sin(this.walkPh) * 0.035 : 0;
    const pose: Pose = { at: [o.feet[0], o.feet[1] - bob - act.lift], h, roll: rock + act.roll + (o.lean ?? 0), spin: this.face, squash: (o.crouch ?? 0) * 0.2 + act.squash, mode: 'stand' };
    s3.update(pose, {
      t, dt, kick: 0, swingV: 0, mouse: o.mouse, blink, look: o.look ?? null, planted: true,
      squint: act.squint, walk: walking ? this.walkPh : undefined, hello: this.hello, hold: this.holdUp,
      wave: act.wave, snap: act.snap, surprise: o.surprise ?? 0,
    }, o.grade);
    this.box = s3.box(pose);
    if (act.spark) this.spark(h);
    return s3.screenOf(ORIGIN);
  }

  /** Is a screen point on him (for a click)? */
  hit(x: number, y: number) {
    const b = this.box;
    return (this.group.visible || this.snap3d.group.visible) && x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h;
  }

  /** How far below the top hold his feet reach, in his heights. */
  below() { return this.snap3d.ready ? -media.snap3d.lo[1] : 1 - media.snapChain.chainTop; }

  /** His middle, relative to the top hold, when he rides at height h. */
  centre(h: number): [number, number] {
    if (this.snap3d.ready) return Snap3D.centre(h);
    const sc = media.snapChain, w = h * (sc.w / sc.h);
    return [(0.5 - sc.chainX) * w, (0.5 - sc.chainTop) * h];
  }

  /**
   * Keep the film rolling while he rides: the calm loop, with a variation
   * slipped in every few loops. All three start and end on the same frame,
   * so they cut into each other there. Returns the clip on screen, or null
   * while none is playing yet.
   */
  private film(riding: boolean, speed: number): RideKey | null {
    if (!riding || !this.vids.m10?.ready) {
      if (this.wasRiding) this.pause();
      this.wasRiding = false;
      this.shown = null;
      return null;
    }
    const start = (k: RideKey) => {
      const v = this.vids[k]!.v;
      v.currentTime = 0;
      v.play().catch(() => {});
      this.cur = k;
      this.lastTime = 0;
    };
    if (!this.wasRiding) {
      // Back on the chain: from the first frame, which matches the sprite.
      this.wasRiding = true;
      for (const x of Object.values(this.vids)) x!.v.pause();
      start('m10');
    }
    const v = this.vids[this.cur]!.v;
    if (v.paused && !v.ended) v.play().catch(() => {});
    // His legs paddle faster when the sea rushes by.
    const rate = Math.round((1 + Math.min(1, Math.abs(speed) / 30) * 0.6) * 10) / 10;
    if (rate !== this.rate) { this.rate = rate; for (const x of Object.values(this.vids)) if (x) x.v.playbackRate = rate; }
    if (this.cur === 'm10') {
      // The calm loop came round: every few loops, a variation instead.
      if (v.currentTime < this.lastTime - 1) {
        this.loopsSinceVariation++;
        const k = VARIATIONS[this.nextVariation];
        if (this.loopsSinceVariation >= 2 && Math.random() < 0.5 && this.vids[k]?.ready) {
          v.pause();
          this.nextVariation = (this.nextVariation + 1) % VARIATIONS.length;
          this.loopsSinceVariation = 0;
          start(k);
        }
      }
    } else if (v.ended || v.currentTime >= media.ride.clips[this.cur].duration - 0.05) {
      v.pause();
      start('m10');
    }
    const now = this.vids[this.cur]!.v;
    this.lastTime = now.currentTime;
    // Keep showing the clip before (or the sprite) until this one is really under way:
    // the last frame of one is the first frame of the next.
    if (!now.seeking && now.readyState >= 2 && now.currentTime > 0.02) this.shown = this.cur;
    return this.shown;
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
    const real = this.snap3d.ready;
    this.u.uOpacity.value = 1;
    this.group.visible = o.visible && !real && this.ready;
    const clip = this.film(this.group.visible && !o.air, o.speed);
    if (!o.visible || (!real && !this.ready)) { this.snap3d.hide(); return null; }
    const sc = media.snapChain;
    const h = o.h, w = h * (sc.w / sc.h);

    // Life: legs kick harder when the reef rushes by, the stalks lag behind the swing.
    const fast = Math.min(1, Math.abs(o.speed) / 30);
    this.kick += ((o.air ? 1 : 0.15 + fast * 0.85) - this.kick) * clamp(dt * 4);
    this.u.uTime.value = t;
    this.u.uKick.value = this.kick;
    this.u.uSway.value = clamp(-this.swingV * 0.05, -0.05, 0.05);

    // Blinks every few seconds, sometimes twice (the film blinks on its own).
    const blink = this.blinking(t);
    this.u.uBlink.value = clip ? 0 : blink;
    const act = this.acting(t, h);
    const life = { t, dt, kick: this.kick, swingV: this.swingV, mouse: o.mouse, blink, squint: act.squint, wave: act.wave, snap: act.snap };

    this.u.uChainHide.value = o.air ? 1 : 0;
    if (o.air) {
      if (real) {
        // A tumble: once round his own up as he flies, rolling into the arc and back out.
        const pose: Pose = { at: [o.air.x, o.air.y], h: h * o.air.s, roll: -Math.sin(o.air.rot / 2) * 0.35, spin: o.air.rot, squash: 0, mode: 'air' };
        this.snap3d.update(pose, life, o.grade);
        this.box = this.snap3d.box(pose);
        if (act.spark) this.spark(h);
        return null;
      }
      this.still(sc);
      this.group.position.set(o.air.x, -o.air.y, 0);
      this.group.rotation.z = -o.air.rot;
      this.group.scale.set(o.air.s, o.air.s, 1);
      this.mesh.position.set(-w / 2, h / 2, 0);
      this.mesh.scale.set(w, h, 1);
      this.u.uGrade.value.set(...o.grade);
      this.box = { x: o.air.x - w / 2, y: o.air.y - h / 2, w, h };
      this.eyes(o.mouse, EYES, (u) => o.air!.x + (u - 0.5) * w, (v) => o.air!.y + (0.5 - v) * h, 1);
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

    // Catching the chain: a quick squash and recoil.
    const lt = t - this.landedAt;
    const squash = lt < 0.5 ? Math.sin(lt * 18) * Math.exp(-lt * 7) * 0.14 : 0;

    const bob = Math.sin(t * 1.4) * h * (real ? 0.008 : clip ? 0.006 : 0.012);
    const [hx, hy0] = o.hold;
    const hy = hy0 + bob - hop;
    const angle = o.lean + this.swing + idleSway;

    if (real) {
      // In 3D he turns round the chain for real, and holds it at one point in his raised claw.
      // Landing in the water, he dips under and bobs back up.
      const dip = this.dip && lt < 1.2 ? Math.sin(lt * 6.5) * Math.exp(-lt * 3.2) * h * 0.09 : 0;
      const pose: Pose = { at: [hx, hy + dip], h, roll: angle + act.roll, spin: phi, squash, mode: 'hang' };
      this.snap3d.update(pose, life, o.grade);
      this.box = this.snap3d.box(pose);
      if (act.spark) this.spark(h);
      return { top: [hx, hy + dip] };
    }

    // The sprite and the film flip like a card for a spin.
    const flip = Math.cos(phi);
    const sx = flip * (1 + squash * 0.6), sy = 1 - squash;
    this.group.position.set(hx, -hy, 0);
    // He hangs along the chain: turned the same way as the holds below.
    this.group.rotation.z = angle;
    this.group.scale.set(sx, sy, 1);
    const shade = 0.8 + 0.2 * Math.abs(flip);
    this.u.uGrade.value.set(o.grade[0] * shade, o.grade[1] * shade, o.grade[2] * shade);
    const f = Math.max(0.3, Math.abs(flip));
    const cos = Math.cos(angle), sin = Math.sin(angle);
    // A point given relative to the top hold (px, y down, before the spin and squash) on screen.
    const screen = (lx: number, ly: number): [number, number] => {
      const x = lx * sx, y = ly * sy;
      return [hx + x * cos + y * sin, hy - x * sin + y * cos];
    };

    if (clip) {
      // The film: placed so the sprite's chain point stays on the hold, so
      // swapping between the two does not move him.
      const R = media.ride, c = R.clips[clip];
      const hv = h * R.scale, wv = hv * (R.w / R.h);
      this.u.uVideo.value = 1;
      this.u.uVid.value = this.vids[clip]!.tex;
      this.u.uSize.value.set(R.w, R.h);
      this.mesh.position.set(-R.origin[0] * wv, R.origin[1] * hv, 0);
      this.mesh.scale.set(wv, hv, 1);
      const tt = this.vids[clip]!.v.currentTime;
      this.box = { x: flip >= 0 ? hx - R.origin[0] * wv * f : hx - (1 - R.origin[0]) * wv * f, y: hy - R.origin[1] * hv, w: wv * f, h: hv };
      // His eyes, where the film has them; the look fades while they are shut.
      const open = sample(c.eyes, tt, 5);
      const eyes = [[sample(c.eyes, tt, 1), 1 - sample(c.eyes, tt, 2), R.eyeR * R.w], [sample(c.eyes, tt, 3), 1 - sample(c.eyes, tt, 4), R.eyeR * R.w]] as const;
      (this.u.uEyeA.value as THREE.Vector3).set(...eyes[0]);
      (this.u.uEyeB.value as THREE.Vector3).set(...eyes[1]);
      this.eyes(o.mouse, eyes, (u) => hx + (u - R.origin[0]) * wv * flip, (v) => hy + (1 - v - R.origin[1]) * hv, flip, open);
      // The stretch of chain in the film ends here; the page's chain takes over above and below.
      const top = screen((sample(c.track, tt, 1) - R.origin[0]) * wv, (R.held[0] - R.origin[1]) * hv);
      const bottom = screen((sample(c.track, tt, 2) - R.origin[0]) * wv, (R.held[1] - R.origin[1]) * hv);
      return { top, bottom };
    }

    this.still(sc);
    this.mesh.position.set(-sc.chainX * w, sc.chainTop * h, 0);
    this.mesh.scale.set(w, h, 1);
    this.box = { x: flip >= 0 ? hx - sc.chainX * w * f : hx - (1 - sc.chainX) * w * f, y: hy - sc.chainTop * h, w: w * f, h };
    this.eyes(o.mouse, EYES, (u) => hx + (u - sc.chainX) * w * flip, (v) => hy + (1 - v - sc.chainTop) * h, flip);
    const span = (sc.chainBottom - sc.chainTop) * h;
    return { top: [hx, hy], bottom: screen(0, span) };
  }

  /** Back to the painted sprite. */
  private still(sc: typeof media.snapChain) {
    if (this.u.uVideo.value === 0) return;
    this.u.uVideo.value = 0;
    this.u.uSize.value.set(sc.w, sc.h);
    (this.u.uEyeA.value as THREE.Vector3).set(...EYES[0]);
    (this.u.uEyeB.value as THREE.Vector3).set(...EYES[1]);
  }

  /** Point both eyes at the cursor, or let them wander. sx and sy place a uv (y up) on screen. */
  private eyes(mouse: [number, number] | null, at: readonly (readonly [number, number, number])[], sx: (u: number) => number, sy: (v: number) => number, flip: number, open = 1) {
    const keys = ['uLookA', 'uLookB'] as const;
    at.forEach(([u, v], i) => {
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
      const fx = (flip < 0 ? -dx : dx) * open;
      target.x += (fx - target.x) * 0.2;
      target.y += (-dy * open - target.y) * 0.2;
    });
  }
}
