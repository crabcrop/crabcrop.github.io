import * as THREE from 'three';
import { media, makeVideo, whenPlayable, loadPicture, type Clip } from '../media';
import { quad, place, videoTexture, imageTexture, type Stage } from './stage';
import { Rider } from './rider';
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

type ClipKey = 'm01' | 'm02' | 'm03';
type State = 'wave' | 'gust' | 'surprised' | 'hop' | 'leap' | 'dive' | 'homeLeap' | 'home';

export interface SnapCtx {
  /** Scroll from the top of the marina, in viewport heights, and when the beat happens. */
  k: number;
  beat: { gust: number; hop: number; force: number; reset: number };
  /** His feet on the pier and his height there, px. */
  feet: [number, number];
  body: number;
  /**
   * His seat in the submarine's glass bubble: the middle of his feet on its
   * floor and his height there, px, and how far the submarine is tilted
   * (radians, nose down positive). raise: his free claw is up (on the way
   * home, with his print found).
   */
  seat: { feet: [number, number]; h: number; lean: number; raise?: boolean };
  /** The waterline on screen, px, and the viewport width. */
  water: number;
  viewW: number;
  grade: [number, number, number];
  /** The cursor, or the last tap. */
  mouse: [number, number] | null;
  /** Back at the surface: when on, he leaps out of the submarine onto the pier (feet, his height there) and waves with his print. */
  home?: { on: boolean; feet: [number, number]; body: number };
}

const PRINT_AT = 0.83;
/** When his feet leave the pier in the hop clip, s. */
const TAKEOFF = 1.76;
const LEAP = 0.9;
/**
 * In 3D: the gust tears the print from his claw this long after it starts,
 * and he stays startled this long; he crouches this long before he hops.
 */
const GUST_TEAR = 0.3, GUST_LEN = 1.6, CROUCH = 0.38;
/** The print he holds, in his heights. */
const PRINT_H = 0.28;
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function spriteMaterial() {
  const u = { uMap: { value: null as THREE.Texture | null }, uOpacity: { value: 1 }, uGrade: { value: new THREE.Vector3(1, 1, 1) }, ...LOOK };
  return { u, m: new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: SPRITE_FRAG, uniforms: u, transparent: true, depthTest: false, depthWrite: false }) };
}

/** A flight between two points with a spin: Bézier arc, turns, growing or shrinking. */
interface Flight { t0: number; dur: number; from: [number, number]; s0: number; s1: number; turns: number; lift: number; wet?: boolean }

/**
 * Snap: on the pier, the leap into his submarine, the dive inside its glass
 * bubble, and the leap back out onto the pier at the end. He is the 3D model
 * throughout once it has loaded (Rider and Snap3D bring him to life); if it
 * cannot load, he is the alpha clips M01 to M03 on the pier and the sprite
 * in the bubble.
 */
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
  /** Snap is the 3D model (else the films and sprite). */
  use3d = false;
  /** In 3D: the print is still in his claw; when the gust came and when he crouched to hop. */
  private printHeld = true;
  private gustAt = -10;
  private hopAt = -10;
  /** He is inside the bubble (the world draws its glass over him), from the end of his leap in to the start of his leap out. */
  inside = false;
  /** The moment he last dropped into his seat, for the submarine's bob. */
  caught = -10;
  /** In 3D: when and where his leap went into the water, for the splash. */
  entered = { t: -10, x: 0 };
  /** True once he is in the submarine. */
  get riding() { return this.state === 'dive'; }

  constructor(stage: Stage) {
    this.clipU = { uMap: { value: null }, uOpacity: { value: 1 }, uCutX: { value: 2 }, uFlip: { value: 0 }, uGrade: { value: new THREE.Vector3(1, 1, 1) }, ...LOOK };
    const cm = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: CLIP_FRAG, uniforms: this.clipU, transparent: true, depthTest: false, depthWrite: false });
    this.clipMesh = quad(cm, 5);
    this.clipMesh.visible = false;
    this.sparkles = new Sparkles(stage);
    this.rider = new Rider(stage, this.sparkles);
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

  /** The hero: Snap in 3D with the print in his claw, or the wave clip if the model will not load. */
  async load() {
    const print = loadPicture('print').then((img) => { this.printU.uMap.value = imageTexture(img); }).catch(() => {});
    if (await this.rider.snap3d.load().then(() => true, () => false)) {
      this.use3d = true;
      await print;
      this.loaded = true;
      return;
    }
    for (const k of ['m01', 'm02', 'm03'] as ClipKey[]) {
      const v = makeVideo(`snap-${k}.mp4`, k === 'm01');
      v.preload = k === 'm01' ? 'auto' : 'none';
      this.clips[k] = { v, tex: videoTexture(v), ready: false, meta: media.clips[k] };
    }
    await this.ready('m01');
    this.loaded = true;
  }

  /** Everything for the story beat and the dive (in 3D, all there already). */
  async loadRest() {
    if (this.use3d) return;
    const chainImg = await loadPicture('snap-chain');
    this.rider.setTexture(imageTexture(chainImg));
    this.clips.m02.v.preload = this.clips.m03.v.preload = 'auto';
    await Promise.all([this.ready('m02'), this.ready('m03')]);
  }

  private use(k: ClipKey) {
    if (this.cur !== k) {
      this.clips[this.cur]?.v.pause();
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
    this.clipU.uCutX.value = 2;
    this.state = 'wave';
    this.printHeld = true;
    if (!this.use3d) this.use('m01');
  }

  /** Off the pier: a leap with a spin from where he stands on screen now into the submarine, or straight into it if he is out of view. */
  private takeOff(t: number, ctx: SnapCtx) {
    for (const c of Object.values(this.clips)) c.v.pause();
    let from: [number, number] | null = null;
    if (this.use3d) {
      // Whatever he still held flies off with the gust.
      if (this.printHeld) this.tearPrint(ctx);
      if (ctx.feet[1] > 0 && ctx.k < 2.05) {
        const [cx, cy] = this.rider.standCentre(ctx.body);
        from = [ctx.feet[0] + cx, ctx.feet[1] + cy];
      }
    } else {
      const b = this.clipBox;
      const m = this.clips[this.cur]?.meta;
      if (this.clipMesh.visible && b.w > 0 && b.top + b.h > 0 && m) from = [b.left + ((m.box[0] + m.box[2]) / 2) * b.w, b.top + 0.66 * b.h];
    }
    if (from) {
      this.leap = { t0: t, dur: LEAP, from, s0: ctx.body / ctx.seat.h, s1: 1, turns: -1, lift: Math.max(ctx.seat.h * 1.3, ctx.viewW * 0.06) };
      this.state = 'leap';
    } else {
      this.state = 'dive';
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

  /** In 3D: the gust tears the print out of his free claw and away to the side. */
  private tearPrint(ctx: SnapCtx) {
    this.printHeld = false;
    const [x, y] = this.rider.snap3d.freeClaw();
    const h = ctx.body * PRINT_H, aspect = media.print.w / media.print.h;
    Object.assign(this.pr, { on: true, x: x + h * aspect * 0.32, y: y - h * 0.4, w: h * aspect, h, age: 0, sinking: 0, rot: 0.1, vx: ctx.body * 2.6, vy: -ctx.body * 2.4 });
  }

  /** In 3D, before the gust: the print in his free claw. */
  private holdPrint(t: number, ctx: SnapCtx) {
    if (!this.printU.uMap.value) return;
    const [x, y] = this.rider.snap3d.freeClaw();
    const h = ctx.body * PRINT_H, w = h * (media.print.w / media.print.h);
    this.printG.visible = true;
    this.printSprite.renderOrder = 6;
    // held up beside him, its lower corner in the claw
    this.printG.position.set(x + w * 0.32, -(y - h * 0.4), 0);
    this.printG.rotation.z = 0.14 + Math.sin(t * 1.3) * 0.03;
    place(this.printSprite, -w / 2, -h / 2, w, h);
    this.printU.uOpacity.value = 1;
    this.printU.uGrade.value.set(...ctx.grade);
  }

  private stepPrint(dt: number, t: number, ctx: SnapCtx) {
    const p = this.pr;
    // It belongs to the marina: gone once the dive is under way.
    if (ctx.k > ctx.beat.force + 0.25) p.on = false;
    this.printG.visible = p.on && !!this.printU.uMap.value;
    this.printSprite.renderOrder = 3;
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

  /** Tapped or clicked: he waves, snaps his pincer, hops or wiggles, wherever he is (the sprite, in its bubble, just bobs). */
  poke(t: number) {
    if (!this.use3d) return;
    if (this.riding) this.rider.react(t, 'sub');
    else if (this.state === 'wave' || this.state === 'surprised' || this.state === 'home') this.rider.react(t, 'pier');
  }
  /** Is a screen point on him? */
  hit(x: number, y: number) {
    if (this.use3d) return this.state !== 'leap' && this.state !== 'homeLeap' && this.rider.hit(x, y);
    return this.riding && this.rider.hit(x, y);
  }

  /** The story beat on the pier, in 3D: the gust takes the print, he is startled, he crouches and hops. */
  private beat3d(t: number, ctx: SnapCtx) {
    const { gust: GUST_AT, hop: HOP_AT } = ctx.beat;
    switch (this.state) {
      case 'wave':
        if (ctx.k >= GUST_AT) { this.state = 'gust'; this.gustAt = t; }
        break;
      case 'gust':
        if (this.printHeld && t - this.gustAt >= GUST_TEAR) this.tearPrint(ctx);
        if (t - this.gustAt >= GUST_LEN) this.state = 'surprised';
        break;
      case 'surprised':
        if (ctx.k >= HOP_AT) { this.state = 'hop'; this.hopAt = t; }
        break;
      case 'hop':
        if (t - this.hopAt >= CROUCH) this.takeOff(t, ctx);
        break;
    }
  }

  /** The story beat on the pier, filmed. */
  private beatFilm(t: number, ctx: SnapCtx) {
    const k = ctx.k, { gust: GUST_AT, hop: HOP_AT } = ctx.beat;
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
  }

  update(dt: number, t: number, ctx: SnapCtx) {
    this.sparkles.update(t);
    if (!this.loaded) return;
    const k = ctx.k, { force: FORCE_AT, reset: RESET_BELOW } = ctx.beat;
    if (k < RESET_BELOW && this.state !== 'wave') this.reset(t);
    const onPier = this.state === 'wave' || this.state === 'gust' || this.state === 'surprised' || this.state === 'hop';
    if (k > FORCE_AT && onPier) this.takeOff(t, ctx);
    if (this.use3d) this.beat3d(t, ctx);
    else this.beatFilm(t, ctx);

    const stillOnPier = this.state === 'wave' || this.state === 'gust' || this.state === 'surprised' || this.state === 'hop';
    this.clipMesh.visible = !this.use3d && stillOnPier && k < 2.05;
    if (this.clipMesh.visible) {
      this.placeClip(ctx);
      this.clipU.uFlip.value = 0;
      this.clipU.uGrade.value.set(...ctx.grade);
    }
    this.stepPrint(dt, t, ctx);

    // His seat: the middle of him, as he stands in the bubble.
    const seat = ctx.seat;
    const [sx, sy] = this.use3d ? this.rider.standCentre(seat.h) : [0, -seat.h * 0.5];
    const mid: [number, number] = [seat.feet[0] + sx, seat.feet[1] + sy];
    const body = { h: seat.h, mouse: ctx.mouse, grade: ctx.grade };
    this.inside = this.state === 'dive';

    // The leap: a spinning arc from the pier, over the submarine and down into its bubble.
    if (this.state === 'leap' && this.leap) {
      const { p, air } = this.fly(this.leap, t, mid);
      this.rider.fly(dt, t, { ...body, air });
      this.inside = p > 0.8;
      // Through the surface (the bubble's top is under it): the splash is where he goes in.
      if (this.use3d && !this.leap.wet && air.y > ctx.water) { this.leap.wet = true; this.entered = { t, x: air.x }; }
      if (p >= 1) {
        this.state = 'dive';
        this.leap = null;
        this.caught = t;
        this.rider.act(t, 'hop');
        this.sparkles.burst(mid[0], mid[1] - seat.h * 0.5, seat.h * 0.5, 3);
      }
      return;
    }
    // Home at the surface: out of the submarine onto the pier, waving, his print held up (and back inside if the visitor scrolls up).
    if (ctx.home) {
      if (ctx.home.on && this.state === 'dive') {
        this.leap = { t0: t, dur: LEAP, from: mid, s0: 1, s1: ctx.home.body / seat.h, turns: 1, lift: Math.max(seat.h * 1.5, ctx.viewW * 0.06) };
        this.state = 'homeLeap';
      }
      if (!ctx.home.on && (this.state === 'homeLeap' || this.state === 'home')) {
        this.state = 'dive';
        this.leap = null;
        this.caught = t;
      }
    }
    if (this.state === 'homeLeap' && this.leap && ctx.home) {
      const [hx, hy] = this.rider.standCentre(ctx.home.body);
      const { p, air } = this.fly(this.leap, t, [ctx.home.feet[0] + hx, ctx.home.feet[1] + hy]);
      this.rider.fly(dt, t, { ...body, air });
      this.inside = p < 0.12;
      if (p >= 1) {
        this.state = 'home';
        this.leap = null;
        this.sparkles.burst(ctx.home.feet[0], ctx.home.feet[1] - ctx.home.body * 0.4, ctx.home.body * 0.6, 3);
      }
      return;
    }
    if (this.state === 'home' && ctx.home) {
      if (this.use3d) {
        this.rider.stand(dt, t, { feet: ctx.home.feet, h: ctx.home.body, grade: ctx.grade, mouse: ctx.mouse, hello: 1, hold: 1 });
        this.holdPrint(t, { ...ctx, body: ctx.home.body });
      } else this.rider.hide();
      return;
    }
    if (this.state !== 'dive') {
      if (this.use3d && stillOnPier && k < 2.05) this.pier3d(dt, t, ctx);
      else this.rider.hide();
      return;
    }

    // In his seat: on his feet in the bubble, looking about, tilting with the submarine.
    this.clipMesh.visible = false;
    if (this.use3d) this.rider.stand(dt, t, { feet: seat.feet, h: seat.h, grade: ctx.grade, mouse: ctx.mouse, lean: seat.lean, hold: seat.raise ? 1 : 0, headroom: seat.h * 0.07 });
    else this.rider.fly(dt, t, { ...body, air: { x: mid[0], y: mid[1], rot: seat.lean, s: 1 }, legs: 0.15 });
  }

  /** On the pier in 3D: waving hello with the print in his other claw, startled by the gust, crouching to hop. */
  private pier3d(dt: number, t: number, ctx: SnapCtx) {
    const g = t - this.gustAt;
    const gust = this.state === 'gust';
    const surprise = gust ? smooth(GUST_TEAR - 0.12, GUST_TEAR + 0.08, g) * (1 - 0.5 * smooth(0.8, GUST_LEN, g)) : this.state === 'surprised' || this.state === 'hop' ? 0.5 : 0;
    this.rider.stand(dt, t, {
      feet: ctx.feet, h: ctx.body, grade: ctx.grade, mouse: ctx.mouse,
      // his eyes follow the print once it flies
      look: this.pr.on ? [this.pr.x, this.pr.y] : null,
      hello: this.state === 'wave' ? 1 : 0, hold: this.printHeld ? 1 : 0, surprise,
      crouch: this.state === 'hop' ? smooth(0, CROUCH, t - this.hopAt) : 0,
      lean: gust ? Math.sin(clamp(g / 0.6) * Math.PI) * 0.12 : 0,
    });
    if (this.printHeld) this.holdPrint(t, ctx);
  }

  /**
   * His print, carried outside him: in the submarine's pincer once it is
   * found. x, y is its middle, h its height, px. Call after update, each
   * frame it should show.
   */
  carryPrint(x: number, y: number, h: number, rot: number, grade: [number, number, number], opacity = 1) {
    if (!this.printU.uMap.value || opacity <= 0.01) return;
    const w = h * (media.print.w / media.print.h);
    this.printG.visible = true;
    this.printSprite.renderOrder = 6;
    this.printG.position.set(x, -y, 0);
    this.printG.rotation.z = -rot;
    place(this.printSprite, -w / 2, -h / 2, w, h);
    this.printU.uOpacity.value = opacity;
    this.printU.uGrade.value.set(...grade);
  }

  /** A little burst of stars at a point (the wax going on the octopus's letter). */
  burst(x: number, y: number, size: number, n = 2) { this.sparkles.burst(x, y, size, n); }

  /** Pause videos when the tab hides; the next update resumes them. */
  pause() { for (const c of Object.values(this.clips)) c.v.pause(); }
}

