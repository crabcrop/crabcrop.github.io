import * as THREE from 'three';
import { media, makeVideo, whenPlayable } from '../media';
import { videoTexture, type Stage } from './stage';
import { clamp, smooth } from '../scroll';
import { Spin3D } from './spin3d';
import { LOOK, LOOK_GLSL } from './look';

// Snap hugging the chain. Riding, he is filmed: three Kling loops (M10 to
// M12) cut from the pose-2 painting, played as stacked-alpha video. In the
// air, and until the video plays, he is the pose-2 sprite brought to life in
// the shaders: his legs dangle and kick, his eye stalks sway, he blinks with
// his coral lids. Either way his eyes follow the cursor. Sprite regions are
// in its uv (y up), measured on the 640 x 687 sprite: eyes at (0.578, 0.884)
// and (0.878, 0.758), bead radius about 34 px; legs below uv.y 0.26 right of
// the chain; stalks above uv.y 0.64.
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

/** His holds on the chain; cover, when set, is how far below the top hold the chain in his claws reaches (the 3D spin's is shorter). */
export interface RideOut { top: [number, number]; bottom: [number, number]; cover?: number }

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
  /** Snap in 3D, for his spins: he turns round the chain for real. */
  readonly spin3d: Spin3D;
  private spinRewound = -1;
  /** True while a spin around the chain is under way. */
  get spinning() { return this.t - this.spinAt < 0.9; }
  private t = 0;

  constructor(stage: Stage) {
    this.spin3d = new Spin3D(stage);
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

  /** The filmed loops: the calm one first, then the two variations. */
  async loadRide() {
    if (this.vids.m10) return;
    const make = (k: RideKey) => {
      const v = makeVideo(`snap-${k}.mp4`, k === 'm10');
      this.vids[k] = { v, tex: videoTexture(v), ready: false };
      return v;
    };
    const m10 = make('m10');
    await whenPlayable(m10);
    this.vids.m10!.ready = true;
    this.spin3d.load().catch(() => {});
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
    this.spin3d.hide();
    this.u.uOpacity.value = 1;
    this.group.visible = o.visible && this.ready;
    const clip = this.film(this.group.visible && !o.air, o.speed);
    if (!this.group.visible) return null;
    const sc = media.snapChain;
    const h = o.h, w = h * (sc.w / sc.h);

    // Life: legs kick harder when the reef rushes by, the stalks lag behind the swing.
    const fast = Math.min(1, Math.abs(o.speed) / 30);
    this.u.uTime.value = t;
    this.u.uKick.value += ((o.air ? 1 : 0.15 + fast * 0.85) - this.u.uKick.value) * clamp(dt * 4);
    this.u.uSway.value = clamp(-this.swingV * 0.05, -0.05, 0.05);

    // Blinks every few seconds, sometimes twice (the film blinks on its own).
    if (t > this.blinkAt + 0.2) this.blinkAt = t + 2.2 + Math.random() * 4 + (Math.random() < 0.2 ? -1.9 : 0);
    const bt = t - this.blinkAt;
    this.u.uBlink.value = clip ? 0 : bt < 0 ? 0 : bt < 0.07 ? bt / 0.07 : bt < 0.11 ? 1 : bt < 0.2 ? 1 - (bt - 0.11) / 0.09 : 0;

    this.u.uChainHide.value = o.air ? 1 : 0;
    if (o.air) {
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
    // With the 3D model he really turns round the chain: the film fades out
    // for the turn and back in at the end, rewound to its first frame, which
    // is the model's pose. Without it, the film flips like a card.
    const real = sp < 1 && this.spin3d.ready;
    const fade3d = real ? smooth(0, 0.08, sp) * (1 - smooth(0.9, 1, sp)) : 0;
    const flip = real ? 1 : Math.cos(phi);
    if (real && sp > 0.8 && this.spinRewound !== this.spinAt) { this.spinRewound = this.spinAt; this.rewind(); }
    this.u.uOpacity.value = 1 - fade3d;

    // Catching the chain: a quick squash and recoil.
    const lt = t - this.landedAt;
    const squash = lt < 0.5 ? Math.sin(lt * 18) * Math.exp(-lt * 7) * 0.14 : 0;

    const bob = Math.sin(t * 1.4) * h * (clip ? 0.006 : 0.012);
    const [hx, hy0] = o.hold;
    const hy = hy0 + bob - hop;
    const angle = o.lean + this.swing + idleSway;
    const sx = flip * (1 + squash * 0.6), sy = 1 - squash;
    this.group.position.set(hx, -hy, 0);
    // He hangs along the chain: turned the same way as the holds below.
    this.group.rotation.z = angle;
    this.group.scale.set(sx, sy, 1);
    const shade = 0.8 + 0.2 * Math.abs(flip);
    this.u.uGrade.value.set(o.grade[0] * shade, o.grade[1] * shade, o.grade[2] * shade);
    this.spin3d.update({ visible: real, hold: [hx, hy], h, angle, squash, phi, fade: fade3d, grade: o.grade });
    const cover = fade3d > 0.5 ? this.spin3d.chainBelow(h) : undefined;
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
      return { top, bottom, cover };
    }

    this.still(sc);
    this.mesh.position.set(-sc.chainX * w, sc.chainTop * h, 0);
    this.mesh.scale.set(w, h, 1);
    this.box = { x: flip >= 0 ? hx - sc.chainX * w * f : hx - (1 - sc.chainX) * w * f, y: hy - sc.chainTop * h, w: w * f, h };
    this.eyes(o.mouse, EYES, (u) => hx + (u - sc.chainX) * w * flip, (v) => hy + (1 - v - sc.chainTop) * h, flip);
    const span = (sc.chainBottom - sc.chainTop) * h;
    return { top: [hx, hy], bottom: screen(0, span), cover };
  }

  /** Back to the calm loop's first frame (the pose the 3D model and the sprite share). */
  private rewind() {
    const m = this.vids.m10;
    if (!m?.ready) return;
    for (const x of Object.values(this.vids)) x!.v.pause();
    this.cur = 'm10';
    m.v.currentTime = 0;
    m.v.play().catch(() => {});
    this.lastTime = 0;
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
