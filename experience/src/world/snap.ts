import * as THREE from 'three';
import { media, makeVideo, whenPlayable, loadPicture, type Clip } from '../media';
import { quad, place, videoTexture, imageTexture, type Stage } from './stage';
import type { Hold } from './chain';
import { Rider, type RideOut } from './rider';
import { Sparkles } from './sparkle';
import { clamp } from '../scroll';
import { LOOK, LOOK_GLSL } from './look';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Stacked-alpha video: colour in the top half, the matte in the bottom half.
const CLIP_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uOpacity, uCutX, uFlip;
uniform vec3 uGrade;
varying vec2 vUv;
${LOOK_GLSL}
void main() {
  float x = uFlip > 0.5 ? 1.0 - vUv.x : vUv.x;
  vec3 c = texture2D(uMap, vec2(x, 0.5 + vUv.y * 0.498)).rgb;
  float a = texture2D(uMap, vec2(x, vUv.y * 0.498)).r;
  a *= 1.0 - smoothstep(uCutX - 0.04, uCutX, vUv.x);
  if (a < 0.004) discard;
  gl_FragColor = vec4(applyLook(c * uGrade), a * uOpacity);
}`;

const SPRITE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uOpacity;
uniform vec3 uGrade;
varying vec2 vUv;
${LOOK_GLSL}
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.004) discard;
  gl_FragColor = vec4(applyLook(c.rgb * uGrade), c.a * uOpacity);
}`;

type ClipKey = 'm01' | 'm02' | 'm03' | 'm04' | 'm05';
type State = 'wave' | 'gust' | 'surprised' | 'hop' | 'leap' | 'chain';

export interface SnapCtx {
  /** Scroll from the top of the marina, in viewport heights, and when the beat happens. */
  k: number;
  beat: { gust: number; hop: number; force: number; reset: number };
  /** His feet on the pier and his height there, px. */
  feet: [number, number];
  body: number;
  /** Where his top hold sits on the chain, and his height there, px. */
  hold: [number, number];
  chainBody: number;
  /** The waterline on screen, px, and the viewport width. */
  water: number;
  viewW: number;
  /** Lean from the chain above him, radians. */
  lean: number;
  grade: [number, number, number];
  /** Scroll speed (px per frame), the cursor, and whether the visitor has paused. */
  speed: number;
  mouse: [number, number] | null;
  idle: boolean;
  /**
   * On the reef: sliding down the chain to the sand (land 0 to 1), walking
   * there with the chain in his left claw, then back on the chain (ret 0 to 1)
   * and lowered out of view (drop, px). feet and body place the walk; hold
   * places him on the chain; vel is how fast he walks, px per second.
   */
  reef?: { land: number; ret: number; drop: number; feet: [number, number]; body: number; vel: number; hold: [number, number] };
}

const PRINT_AT = 0.83;
/** When his feet leave the pier in the hop clip, s. */
const TAKEOFF = 1.76;
const LEAP = 0.9;
const VISIT_JUMP = 0.75;
/** The claw tip beside his head in the snap clip, as shares of its frame. */
const CLAW_AT: [number, number] = [0.2, 0.47];
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

function spriteMaterial() {
  const u = { uMap: { value: null as THREE.Texture | null }, uOpacity: { value: 1 }, uGrade: { value: new THREE.Vector3(1, 1, 1) }, ...LOOK };
  return { u, m: new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: SPRITE_FRAG, uniforms: u, transparent: true, depthTest: false, depthWrite: false }) };
}

/** A flight between two points with a spin: Bézier arc, turns, growing or shrinking. */
interface Flight { t0: number; dur: number; from: [number, number]; s0: number; s1: number; turns: number; lift: number }

/** A visit to a card: the leap out, the claw snap on its top edge, the leap back. */
interface Visit { phase: 'out' | 'perch' | 'back'; t0: number; flight: Flight; feet: () => [number, number] | null; clicks: number }

/** Snap: alpha clips on the pier, the leap onto the chain, riding it, and his visits to the cards. */
export class Snap {
  state: State = 'wave';
  private clips = {} as Record<ClipKey, { v: HTMLVideoElement; tex: THREE.VideoTexture; ready: boolean; meta: Clip }>;
  private cur: ClipKey = 'm01';
  private clipMesh: THREE.Mesh;
  private clipU: Record<string, THREE.IUniform>;
  readonly rider: Rider;
  private sparkles: Sparkles;
  private printG = new THREE.Group();
  private printSprite: THREE.Mesh;
  private printU: Record<string, THREE.IUniform>;
  private pr = { on: false, x: 0, y: 0, vx: 0, vy: 0, rot: 0, w: 0, h: 0, age: 0, sinking: 0 };
  private loaded = false;
  private clipBox = { left: 0, top: 0, w: 0, h: 0 };
  private leap: Flight | null = null;
  private visitNow: Visit | null = null;
  /** Holds on the chain while he rides it. */
  holds: RideOut | null = null;
  /** His left claw on screen while he walks the reef: the chain hangs from it. */
  claw: [number, number] | null = null;
  /** The moment he last caught the chain, for the jolt and the splash. */
  caught = -10;
  /** The card he is standing on, and since when. */
  perch: { feet: [number, number]; since: number } | null = null;
  private flip = true;
  private landedAt = -1;
  /** True once he has landed on the chain. */
  get riding() { return this.state === 'chain'; }
  get visiting() { return !!this.visitNow; }

  constructor(stage: Stage) {
    this.clipU = { uMap: { value: null }, uOpacity: { value: 1 }, uCutX: { value: 2 }, uFlip: { value: 0 }, uGrade: { value: new THREE.Vector3(1, 1, 1) }, ...LOOK };
    const cm = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: CLIP_FRAG, uniforms: this.clipU, transparent: true, depthTest: false, depthWrite: false });
    this.clipMesh = quad(cm, 5);
    this.clipMesh.visible = false;
    this.rider = new Rider(stage);
    this.sparkles = new Sparkles(stage);
    const ps = spriteMaterial();
    this.printU = ps.u;
    this.printSprite = quad(ps.m, 3);
    this.printG.add(this.printSprite);
    this.printG.visible = false;
    stage.scene.add(this.clipMesh, this.printG);
  }

  private async ready(k: ClipKey) {
    this.clips[k].v.load();
    await whenPlayable(this.clips[k].v);
    this.clips[k].ready = true;
  }

  /** The wave, for the hero. */
  async load() {
    for (const k of ['m01', 'm02', 'm03'] as ClipKey[]) {
      const v = makeVideo(`snap-${k}.mp4`, k === 'm01');
      v.preload = k === 'm01' ? 'auto' : 'none';
      this.clips[k] = { v, tex: videoTexture(v), ready: false, meta: media.clips[k] };
    }
    await this.ready('m01');
    this.loaded = true;
  }

  /** Everything for the story beat and the ride. */
  async loadRest() {
    const [chainImg, printImg] = await Promise.all([loadPicture('snap-chain'), loadPicture('print')]);
    this.rider.setTexture(imageTexture(chainImg));
    this.printU.uMap.value = imageTexture(printImg);
    this.clips.m02.v.preload = this.clips.m03.v.preload = 'auto';
    await Promise.all([this.ready('m02'), this.ready('m03')]);
    // Snap in 3D for the chain (or the filmed ride if that fails); the sprite stands in until then.
    this.rider.loadRide().catch(() => {});
  }

  private async loadClip(k: 'm04' | 'm05', loop: boolean) {
    if (this.clips[k]) return;
    const v = makeVideo(`snap-${k}.mp4`, loop);
    this.clips[k] = { v, tex: videoTexture(v), ready: false, meta: media.clips[k] };
    await this.ready(k);
  }
  /** The sideways walk, for the reef. */
  loadReef() { return this.loadClip('m04', true); }
  /** The claw snap, for his visits to the cards. */
  loadClaw() { return this.loadClip('m05', false); }

  private use(k: ClipKey) {
    if (this.cur !== k) {
      this.clips[this.cur].v.pause();
      this.cur = k;
    }
    this.clipU.uMap.value = this.clips[k].tex;
  }

  private start(k: ClipKey, t: number, state: State) {
    const c = this.clips[k];
    this.use(k);
    c.v.currentTime = 0;
    c.v.play().catch(() => {});
    this.state = state;
  }

  private reset(t: number) {
    for (const c of Object.values(this.clips)) { c.v.pause(); }
    this.pr.on = false;
    this.leap = null;
    this.visitNow = null;
    this.perch = null;
    this.clipU.uCutX.value = 2;
    this.state = 'wave';
    this.use('m01');
  }

  /** Off the pier: a leap with a spin from where he stands on screen now, or straight onto the chain if he is out of view. */
  private takeOff(t: number, ctx: SnapCtx) {
    for (const c of Object.values(this.clips)) c.v.pause();
    const b = this.clipBox;
    const m = this.clips[this.cur]?.meta;
    const onScreen = this.clipMesh.visible && b.w > 0 && b.top + b.h > 0;
    if (onScreen && m) {
      const cx = b.left + ((m.box[0] + m.box[2]) / 2) * b.w, cy = b.top + 0.66 * b.h;
      this.leap = { t0: t, dur: LEAP, from: [cx, cy], s0: ctx.body / ctx.chainBody, s1: 1, turns: -1, lift: Math.max(ctx.chainBody * 0.7, ctx.viewW * 0.06) };
      this.state = 'leap';
    } else {
      this.state = 'chain';
      this.rider.land(t);
      this.caught = t;
    }
  }

  /** Where a flight is now, given where it is going. */
  private fly(f: Flight, t: number, to: [number, number]) {
    const p = clamp((t - f.t0) / f.dur);
    const e = easeInOut(p);
    const [x0, y0] = f.from;
    const mx = (x0 + to[0]) / 2, my = Math.min(y0, to[1]) - f.lift;
    const x = (1 - e) * (1 - e) * x0 + 2 * (1 - e) * e * mx + e * e * to[0];
    const y = (1 - e) * (1 - e) * y0 + 2 * (1 - e) * e * my + e * e * to[1];
    return { p, air: { x, y, rot: f.turns * Math.PI * 2 * easeOut(p), s: f.s0 + (f.s1 - f.s0) * easeOut(p) } };
  }

  /** Visit a card: leap onto its top edge (feet gives where, each frame), snap the claw, come back. */
  visit(t: number, feet: () => [number, number] | null, ctx: { chainBody: number; body: number }) {
    if (!this.riding || this.visitNow || !this.clips.m05?.ready || !this.holds) return false;
    const [cx, cy] = this.rider.centre(ctx.chainBody);
    const from: [number, number] = [this.holds.top[0] + cx, this.holds.top[1] + cy];
    const f = feet();
    if (!f) return false;
    this.visitNow = {
      phase: 'out', t0: t, feet, clicks: 0,
      flight: { t0: t, dur: VISIT_JUMP, from, s0: 1, s1: ctx.body / ctx.chainBody, turns: f[0] < from[0] ? -1 : 1, lift: ctx.chainBody * 0.45 },
    };
    return true;
  }
  /** Cut a visit short: back to the chain now. */
  endVisit(t: number) {
    const v = this.visitNow;
    if (!v || v.phase === 'back') return;
    this.goBack(t, v);
  }
  private goBack(t: number, v: Visit) {
    const b = this.clipBox;
    const perched = v.phase === 'perch';
    const from: [number, number] = perched ? [b.left + b.w / 2, b.top + b.h * 0.6] : [this.lastAir.x, this.lastAir.y];
    v.flight = { t0: t, dur: VISIT_JUMP, from, s0: perched ? v.flight.s1 : this.lastAir.s, s1: 1, turns: -v.flight.turns, lift: v.flight.lift };
    v.phase = 'back';
    v.t0 = t;
    this.perch = null;
    this.clipMesh.visible = false;
    this.clips.m05?.v.pause();
  }
  private lastAir = { x: 0, y: 0, rot: 0, s: 0.7 };

  private placeClip(ctx: { feet: [number, number]; body: number }, dy = 0, flip = false) {
    const m = this.clips[this.cur].meta;
    const scale = ctx.body / ((m.box[3] - m.box[1]) * m.h);
    const qw = m.w * scale, qh = m.h * scale;
    const cx0 = (m.crop[1] / 2 - m.crop[0]) / m.w;
    const cx = flip ? 1 - cx0 : cx0;
    const left = ctx.feet[0] - cx * qw, top = ctx.feet[1] - m.box[3] * qh + dy;
    place(this.clipMesh, left, top, qw, qh);
    this.clipBox = { left, top, w: qw, h: qh };
  }

  private launchPrint() {
    const track = this.clips.m02.meta.print ?? [];
    if (track.length < 2) return;
    const i = Math.max(1, track.findIndex((e) => e[0] >= PRINT_AT));
    const [t1, cx1, cy1, , h1] = track[i];
    const [t0, cx0, cy0] = track[i - 1];
    const b = this.clipBox;
    const h = h1 * b.h * 0.95;
    const aspect = media.print.w / media.print.h;
    Object.assign(this.pr, {
      on: true, x: b.left + cx1 * b.w, y: b.top + cy1 * b.h, w: h * aspect, h, age: 0, sinking: 0, rot: -0.35,
      vx: ((cx1 - cx0) * b.w) / Math.max(0.02, t1 - t0) * 0.5,
      vy: ((cy1 - cy0) * b.h) / Math.max(0.02, t1 - t0) * 0.5,
    });
    this.clipU.uCutX.value = 0.8;
  }

  private stepPrint(dt: number, t: number, ctx: SnapCtx) {
    const p = this.pr;
    this.printG.visible = p.on && !!this.printU.uMap.value;
    if (!p.on) return;
    p.age += dt;
    if (p.y < ctx.water - p.h * 0.2) {
      // Fluttering in the air: the gust eases, then the breeze carries it back
      // over the water so it lands in view.
      const breeze = p.age > 0.3 ? -ctx.body * 0.9 : p.vx;
      p.vx += (breeze - p.vx) * (1 - Math.pow(0.12, dt));
      if (p.x > ctx.viewW * 0.94) p.vx = Math.min(p.vx, -ctx.body * 2);
      p.vy += (ctx.body * 1.1) * dt;
      p.vy *= Math.pow(0.6, dt);
      p.x += (p.vx + Math.sin(p.age * 5.2) * ctx.body * 0.35) * dt;
      p.y += p.vy * dt;
      p.rot = Math.sin(p.age * 4.1) * 0.5;
    } else {
      // In the water: it sinks slowly, tipping, and fades into the blue.
      p.sinking += dt;
      p.vx *= Math.pow(0.02, dt);
      p.x += (p.vx + Math.sin(p.age * 1.7) * ctx.body * 0.12) * dt;
      p.y += ctx.body * 0.22 * dt;
      p.rot = Math.sin(p.age * 1.3) * 0.35;
    }
    const fade = clamp(1 - p.sinking / 3.2);
    this.printU.uOpacity.value = fade;
    const sink = clamp(p.sinking / 1.5);
    this.printU.uGrade.value.set(1 - 0.25 * sink, 1 - 0.05 * sink, 1 + 0.02 * sink);
    if (fade <= 0) p.on = false;
    this.printG.position.set(p.x, -p.y, 0);
    this.printG.rotation.z = -p.rot;
    place(this.printSprite, -p.w / 2, -p.h / 2, p.w, p.h);
  }

  /** Spin around the chain, when clicked. */
  poke(t: number) { if (this.riding && !this.visitNow) this.rider.spin(t, true); }
  /** Is a screen point on him? */
  hit(x: number, y: number) { return this.riding && !this.visitNow && this.rider.hit(x, y); }

  update(dt: number, t: number, ctx: SnapCtx) {
    this.sparkles.update(t);
    if (!this.loaded) return;
    const k = ctx.k, { gust: GUST_AT, hop: HOP_AT, force: FORCE_AT, reset: RESET_BELOW } = ctx.beat;
    if (k < RESET_BELOW && this.state !== 'wave') this.reset(t);
    const onPier = this.state === 'wave' || this.state === 'gust' || this.state === 'surprised' || this.state === 'hop';
    if (k > FORCE_AT && onPier) this.takeOff(t, ctx);

    const c = this.clips[this.cur];
    switch (this.state) {
      case 'wave':
        this.use('m01');
        if (k < 2 && this.clips.m01.v.paused) this.clips.m01.v.play().catch(() => {});
        if (k >= GUST_AT && this.clips.m02.ready) this.start('m02', t, 'gust');
        break;
      case 'gust':
        if (!this.pr.on && c.v.currentTime >= PRINT_AT && this.clipU.uCutX.value > 1) this.launchPrint();
        if (c.v.ended || c.v.currentTime >= c.meta.duration - 0.06) { c.v.pause(); this.state = 'surprised'; }
        break;
      case 'surprised':
        if (k >= HOP_AT && this.clips.m03.ready) this.start('m03', t, 'hop');
        break;
      case 'hop':
        // He crouches, then springs: from the moment his feet leave the pier, he flies.
        if (c.v.currentTime >= TAKEOFF || c.v.ended) this.takeOff(t, ctx);
        break;
    }

    const stillOnPier = this.state === 'wave' || this.state === 'gust' || this.state === 'surprised' || this.state === 'hop';
    this.clipMesh.visible = stillOnPier && k < 2.05;
    if (stillOnPier) {
      this.placeClip(ctx);
      this.clipU.uFlip.value = 0;
      this.clipU.uGrade.value.set(...ctx.grade);
    }
    this.stepPrint(dt, t, ctx);

    this.claw = null;
    this.holds = null;
    const [cxo, cyo] = this.rider.centre(ctx.chainBody);
    const riderCtx = { visible: true, h: ctx.chainBody, speed: ctx.speed, mouse: ctx.mouse, grade: ctx.grade, idle: ctx.idle };

    // The leap: a spinning arc from the pier to his hold on the chain.
    if (this.state === 'leap' && this.leap) {
      const to: [number, number] = [ctx.hold[0] + cxo, ctx.hold[1] + cyo];
      const { p, air } = this.fly(this.leap, t, to);
      this.rider.update(dt, t, { ...riderCtx, hold: ctx.hold, lean: 0, air });
      if (p >= 1) {
        this.state = 'chain';
        this.leap = null;
        this.rider.land(t);
        this.caught = t;
        this.sparkles.burst(ctx.hold[0] + ctx.chainBody * 0.05, ctx.hold[1] + ctx.chainBody * 0.05, ctx.chainBody * 0.35, 3);
      }
      return;
    }
    if (this.state !== 'chain') { this.rider.update(dt, t, { ...riderCtx, visible: false, hold: ctx.hold, lean: 0 }); return; }

    if (ctx.reef) { this.reef(dt, t, ctx, ctx.reef, riderCtx); return; }
    if (this.visitNow) { this.visiting_(dt, t, ctx, riderCtx); return; }

    this.clipMesh.visible = false;
    const r = this.rider.update(dt, t, { ...riderCtx, hold: ctx.hold, lean: ctx.lean });
    this.holds = r;
  }

  /** A visit to a card: out, perched with the claw snap, and back. */
  private visiting_(dt: number, t: number, ctx: SnapCtx, riderCtx: { visible: boolean; h: number; speed: number; mouse: [number, number] | null; grade: [number, number, number]; idle: boolean }) {
    const v = this.visitNow!;
    const [cxo, cyo] = this.rider.centre(ctx.chainBody);
    const body = ctx.chainBody * v.flight.s1;
    const feet = v.feet();
    if (v.phase === 'out') {
      if (!feet) { this.goBack(t, v); return; }
      const to: [number, number] = [feet[0], feet[1] - body * 0.55];
      const { p, air } = this.fly(v.flight, t, to);
      this.lastAir = air;
      this.rider.update(dt, t, { ...riderCtx, hold: ctx.hold, lean: 0, air });
      this.clipMesh.visible = false;
      if (p >= 1) {
        v.phase = 'perch';
        v.t0 = t;
        this.rider.update(dt, t, { ...riderCtx, visible: false, hold: ctx.hold, lean: 0 });
        this.start('m05', t, 'chain');
        this.perch = { feet, since: t };
      }
      return;
    }
    if (v.phase === 'perch') {
      const c = this.clips.m05;
      if (!feet || c.v.ended || c.v.currentTime >= c.meta.duration - 0.08) { this.goBack(t, v); return; }
      this.use('m05');
      this.rider.update(dt, t, { ...riderCtx, visible: false, hold: ctx.hold, lean: 0 });
      this.placeClip({ feet, body });
      this.clipMesh.visible = true;
      this.clipU.uFlip.value = 0;
      this.clipU.uCutX.value = 2;
      this.clipU.uGrade.value.set(...ctx.grade);
      this.perch = { feet, since: this.perch?.since ?? t };
      // His sparkles at each click of the claw.
      const clicks = c.meta.clicks ?? [];
      if (v.clicks < clicks.length && c.v.currentTime >= clicks[v.clicks]) {
        const b = this.clipBox;
        this.sparkles.burst(b.left + CLAW_AT[0] * b.w, b.top + CLAW_AT[1] * b.h, body * 0.32, 2);
        v.clicks++;
      }
      return;
    }
    // Back to the chain.
    const to: [number, number] = [ctx.hold[0] + cxo, ctx.hold[1] + cyo];
    const { p, air } = this.fly(v.flight, t, to);
    this.rider.update(dt, t, { ...riderCtx, hold: ctx.hold, lean: 0, air });
    this.clipMesh.visible = false;
    if (p >= 1) {
      this.visitNow = null;
      this.rider.land(t);
      this.caught = t;
      this.sparkles.burst(ctx.hold[0], ctx.hold[1], ctx.chainBody * 0.3, 2);
    }
  }

  /** The reef: down the chain to the sand, the sideways walk, and back. */
  private reef(dt: number, t: number, ctx: SnapCtx, r: NonNullable<SnapCtx['reef']>, riderCtx: { visible: boolean; h: number; speed: number; mouse: [number, number] | null; grade: [number, number, number]; idle: boolean }) {
    const m04 = this.clips.m04;
    const walking = r.land >= 1 && r.ret <= 0 && !!m04?.ready;
    if (!walking) {
      // On the chain: sliding down to the sand, or back up on it at the end.
      this.landedAt = -1;
      if (m04 && !m04.v.paused) m04.v.pause();
      this.clipMesh.visible = false;
      this.holds = this.rider.update(dt, t, { ...riderCtx, hold: [r.hold[0], r.hold[1] + r.drop], lean: 0 });
      return;
    }
    // Walking, mirrored so the tracked claw is his left one on screen when he heads right.
    this.rider.update(dt, t, { ...riderCtx, visible: false, hold: r.hold, lean: 0 });
    if (this.landedAt < 0) this.landedAt = t;
    this.use('m04');
    const c = m04!;
    const speed = Math.abs(r.vel);
    if (speed > 30) {
      c.v.playbackRate = clamp(speed / 240, 0.7, 2.4);
      if (c.v.paused) c.v.play().catch(() => {});
      this.flip = r.vel > 0;
    } else if (!c.v.paused) {
      c.v.pause();
    }
    const b = clamp((t - this.landedAt) / 0.4);
    const bounce = -Math.sin(b * Math.PI) * r.body * 0.08 * (1 - b);
    this.placeClip(r, bounce, this.flip);
    this.clipMesh.visible = true;
    this.clipU.uFlip.value = this.flip ? 1 : 0;
    this.clipU.uCutX.value = 2;
    this.clipU.uGrade.value.set(...ctx.grade);
    // His left claw: the tracked right claw, mirrored when the clip is.
    const track = c.meta.claw ?? [];
    if (track.length) {
      const dur = c.meta.duration || 4;
      const tt = (c.v.currentTime % dur);
      const i = Math.min(track.length - 1, Math.floor((tt / dur) * track.length));
      const [, xr, yr] = track[i];
      const centre = (c.meta.box[0] + c.meta.box[2]) / 2;
      const xq = this.flip ? 1 - xr : 2 * centre - xr;
      const bx = this.clipBox;
      this.claw = [bx.left + xq * bx.w, bx.top + yr * bx.h];
    }
  }

  /** Pause videos when the tab hides; the next update resumes them. */
  pause() { for (const c of Object.values(this.clips)) c.v.pause(); this.rider.pause(); }
}

export type { Hold };
