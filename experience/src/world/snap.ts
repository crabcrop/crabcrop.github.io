import * as THREE from 'three';
import { media, makeVideo, whenPlayable, loadPicture, type Clip } from '../media';
import { quad, place, videoTexture, imageTexture, type Stage } from './stage';
import type { Hold } from './chain';
import { clamp } from '../scroll';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Stacked-alpha video: colour in the top half, the matte in the bottom half.
const CLIP_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uOpacity, uCutX;
uniform vec3 uGrade;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uMap, vec2(vUv.x, 0.5 + vUv.y * 0.498)).rgb;
  float a = texture2D(uMap, vec2(vUv.x, vUv.y * 0.498)).r;
  a *= 1.0 - smoothstep(uCutX - 0.04, uCutX, vUv.x);
  if (a < 0.004) discard;
  gl_FragColor = vec4(c * uGrade, a * uOpacity);
}`;

const SPRITE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uOpacity;
uniform vec3 uGrade;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.004) discard;
  gl_FragColor = vec4(c.rgb * uGrade, c.a * uOpacity);
}`;

type ClipKey = 'm01' | 'm02' | 'm03';
type State = 'wave' | 'gust' | 'surprised' | 'hop' | 'drop' | 'chain';

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
}

const PRINT_AT = 0.83;
const easeOutBack = (x: number) => 1 + 2.4 * Math.pow(x - 1, 3) + 1.4 * Math.pow(x - 1, 2);

function spriteMaterial() {
  const u = { uMap: { value: null as THREE.Texture | null }, uOpacity: { value: 1 }, uGrade: { value: new THREE.Vector3(1, 1, 1) } };
  return { u, m: new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: SPRITE_FRAG, uniforms: u, transparent: true, depthTest: false, depthWrite: false }) };
}

/** Snap: alpha clips on the pier, then a sprite riding the chain. */
export class Snap {
  state: State = 'wave';
  private since = 0;
  private clips = {} as Record<ClipKey, { v: HTMLVideoElement; tex: THREE.VideoTexture; ready: boolean; meta: Clip }>;
  private cur: ClipKey = 'm01';
  private clipMesh: THREE.Mesh;
  private clipU: Record<string, THREE.IUniform>;
  private chain = new THREE.Group();
  private chainSprite: THREE.Mesh;
  private chainU: Record<string, THREE.IUniform>;
  private printG = new THREE.Group();
  private printSprite: THREE.Mesh;
  private printU: Record<string, THREE.IUniform>;
  private pr = { on: false, x: 0, y: 0, vx: 0, vy: 0, rot: 0, w: 0, h: 0, age: 0, sinking: 0 };
  private loaded = false;
  private clipBox = { left: 0, top: 0, w: 0, h: 0 };
  /** Holds on the chain while he rides it. */
  holds: { top: [number, number]; bottom: [number, number] } | null = null;
  /** True once he has landed on the chain. */
  get riding() { return this.state === 'chain'; }

  constructor(stage: Stage) {
    this.clipU = { uMap: { value: null }, uOpacity: { value: 1 }, uCutX: { value: 2 }, uGrade: { value: new THREE.Vector3(1, 1, 1) } };
    const cm = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: CLIP_FRAG, uniforms: this.clipU, transparent: true, depthTest: false, depthWrite: false });
    this.clipMesh = quad(cm, 5);
    this.clipMesh.visible = false;
    const cs = spriteMaterial();
    this.chainU = cs.u;
    this.chainSprite = quad(cs.m, 5);
    this.chain.add(this.chainSprite);
    this.chain.visible = false;
    const ps = spriteMaterial();
    this.printU = ps.u;
    this.printSprite = quad(ps.m, 3);
    this.printG.add(this.printSprite);
    this.printG.visible = false;
    stage.scene.add(this.clipMesh, this.chain, this.printG);
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
    this.chainU.uMap.value = imageTexture(chainImg);
    this.printU.uMap.value = imageTexture(printImg);
    this.clips.m02.v.preload = this.clips.m03.v.preload = 'auto';
    await Promise.all([this.ready('m02'), this.ready('m03')]);
  }

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
    this.since = t;
  }

  private reset(t: number) {
    for (const c of Object.values(this.clips)) { c.v.pause(); }
    this.pr.on = false;
    this.clipU.uCutX.value = 2;
    this.state = 'wave';
    this.since = t;
    this.use('m01');
  }

  private toChain(t: number, drop: boolean) {
    for (const c of Object.values(this.clips)) c.v.pause();
    this.state = drop ? 'drop' : 'chain';
    this.since = t;
  }

  private placeClip(ctx: SnapCtx, dy = 0) {
    const m = this.clips[this.cur].meta;
    const scale = ctx.body / ((m.box[3] - m.box[1]) * m.h);
    const qw = m.w * scale, qh = m.h * scale;
    const cx = (m.crop[1] / 2 - m.crop[0]) / m.w;
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

  update(dt: number, t: number, ctx: SnapCtx) {
    if (!this.loaded) return;
    const k = ctx.k, { gust: GUST_AT, hop: HOP_AT, force: FORCE_AT, reset: RESET_BELOW } = ctx.beat;
    if (k < RESET_BELOW && this.state !== 'wave') this.reset(t);
    if (k > FORCE_AT && this.state !== 'chain' && this.state !== 'drop') this.toChain(t, false);

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
        if (c.v.ended || c.v.currentTime >= c.meta.duration - 0.04) this.toChain(t, true);
        break;
      case 'drop':
        if (t - this.since > 0.62) this.state = 'chain';
        break;
    }

    const onPier = this.state === 'wave' || this.state === 'gust' || this.state === 'surprised' || this.state === 'hop';
    this.clipMesh.visible = onPier && k < 2.05;
    if (onPier) {
      // The jump: lift him out of the top of the screen as he leaves the frame.
      let dy = 0;
      if (this.state === 'hop') {
        const j = clamp((c.v.currentTime - 1.62) / 0.4);
        dy = -j * j * (ctx.feet[1] + ctx.body * 1.5);
      }
      this.placeClip(ctx, dy);
      this.clipU.uGrade.value.set(...ctx.grade);
    }
    this.stepPrint(dt, t, ctx);

    // On the chain.
    const sc = media.snapChain;
    const h = ctx.chainBody, w = h * (sc.w / sc.h);
    const ride = this.state === 'drop' || this.state === 'chain';
    this.chain.visible = ride && !!this.chainU.uMap.value;
    if (ride) {
      let [hx, hy] = ctx.hold;
      if (this.state === 'drop') {
        const p = clamp((t - this.since) / 0.62);
        hy = -h + (hy + h) * easeOutBack(p);
      }
      const bob = Math.sin(t * 1.4) * h * 0.012;
      this.chain.position.set(hx, -(hy + bob), 0);
      this.chain.rotation.z = -ctx.lean;
      place(this.chainSprite, -sc.chainX * w, -sc.chainTop * h, w, h);
      this.chainU.uGrade.value.set(...ctx.grade);
      const span = (sc.chainBottom - sc.chainTop) * h;
      this.holds = this.state === 'chain'
        ? { top: [hx, hy + bob], bottom: [hx + Math.sin(ctx.lean) * span, hy + bob + Math.cos(ctx.lean) * span] }
        : null;
    } else {
      this.holds = null;
    }
  }

  /** Pause videos when the tab hides; the next update resumes them. */
  pause() { for (const c of Object.values(this.clips)) c.v.pause(); }
}

export type { Hold };
