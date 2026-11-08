import { Stage, onPlate, type Cover } from './stage';
import { Backdrop, type SourceKey } from './backdrop';
import { Chain, type Hold } from './chain';
import { Snap } from './snap';
import { Schools, type Fmt } from './fish';
import { Bubbles } from './bubbles';
import { media } from '../media';
import { clamp, lerp, smooth, type Scroll } from '../scroll';

interface Layout {
  fx: number; feet: readonly [number, number]; body: number;
  anchor: readonly [number, number]; holdY: number; chainBody: number;
  /** The story beat, as shares of the marina's scroll length. */
  gust: number; hop: number;
}

/** Where things sit, in plate coordinates (0 to 1), per layout. */
const LAYOUT: Record<'wide' | 'phone', Layout> = {
  wide: {
    fx: 0.62,
    feet: [0.795, 0.345], body: 0.125,               // Snap on the right pier
    anchor: [0.655, 0.47],                           // the chain leaves the boat's stern
    holdY: 0.56, chainBody: 0.26,                     // riding: his top hold, his height (viewport heights)
    gust: 0.35, hop: 0.64,
  },
  phone: {
    fx: 0.5,
    feet: [0.37, 0.236], body: 0.085,
    anchor: [0.2, 0.27],
    holdY: 0.66, chainBody: 0.2,
    gust: 0.62, hop: 0.8,                             // after the tall hero card has scrolled away
  },
};

const TAG_LINKS = { sig: -14, fmt: -7, look: 9, crop: 12, finish: 15 };

export interface WorldOut {
  /** Tag anchor points on the chain, px, with the chain's angle there. */
  tags: Record<keyof typeof TAG_LINKS, { x: number; y: number; a: number }>;
  tagsOn: number;
  /** The plate cover of the shallows, for the cargo hotspots. */
  z1: Cover | null;
  s1On: number;
  depth: number;
  zone: 's0' | 't1' | 's1' | 'next';
  storyOn: boolean;
  chainX: (y: number) => number | null;
}

export class World {
  readonly stage: Stage;
  private backdrop: Backdrop;
  private chain: Chain;
  readonly snap: Snap;
  private fish: Schools;
  private bubbles: Bubbles;
  readonly phone: boolean;
  private L: Layout;
  mouse: [number, number] | null = null;
  private cardsRight = 0;
  readonly out: WorldOut;

  constructor(canvas: HTMLCanvasElement, private scroll: Scroll, phone: boolean) {
    this.phone = phone;
    this.L = phone ? LAYOUT.phone : LAYOUT.wide;
    this.stage = new Stage(canvas, phone ? 1.5 : 2);
    this.backdrop = new Backdrop(this.stage, phone);
    this.chain = new Chain(this.stage);
    this.snap = new Snap(this.stage);
    this.fish = new Schools(this.stage, phone);
    this.bubbles = new Bubbles(this.stage);
    const zero = { x: -999, y: -999, a: 0 };
    this.out = {
      tags: { sig: zero, fmt: zero, look: zero, crop: zero, finish: zero }, tagsOn: 0, z1: null, s1On: 0,
      depth: 0, zone: 's0', storyOn: false, chainX: (y) => this.chain.xAt(y),
    };
    this.measure();
  }

  measure() {
    const cards = document.querySelector('.cards')?.getBoundingClientRect();
    this.cardsRight = cards ? cards.right : 0;
  }

  resize() { this.stage.resize(); this.measure(); }

  /** The marina first; the plunge and the shallows load as the visitor nears them. */
  async load() {
    await this.backdrop.loadPlate('z0');
    await this.snap.load().catch(() => {});
    this.backdrop.loadLoop('z0').catch(() => {});
    await this.snap.loadRest().catch(() => {});
  }

  private wants = { seq: false, z1: false };
  private stream(k: number) {
    if (!this.wants.seq && k > 0.35) { this.wants.seq = true; this.backdrop.loadSequence().catch(() => {}); }
    if (!this.wants.z1 && k > 0.95) {
      this.wants.z1 = true;
      this.backdrop.loadPlate('z1').then(() => this.backdrop.loadLoop('z1')).catch(() => {});
      this.fish.load().catch(() => {});
    }
  }

  setFormat(f: Fmt | 'auto', t: number) {
    this.fish.picked = f === 'auto' ? null : f;
    if (f === 'auto') this.fish.race(t);
  }
  focusFormat(f: Fmt | null) { this.fish.focus = f; }
  raceOnce(t: number) { this.fish.race(t); }

  frame(dt: number, t: number) {
    const s = this.stage, H = s.h, W = s.w, L = this.L;
    const sc = this.scroll;
    const k = sc.y / H;                              // viewport heights from the top
    const s0h = sc.sec.s0.h / H;
    const p1 = clamp(sc.at('t1', H) / (sc.sec.t1.h / H));   // the plunge
    const kS1 = sc.at('s1', H);                       // into the shallows
    const kNext = sc.at('next', H);
    this.stream(k);

    // Backdrop: the marina, the plunge frames, the shallows.
    const fyS0 = lerp(0.2, 0.5, clamp(k / s0h));
    const fyS1 = lerp(0.5, 0.85, clamp(kS1 / 2.2));
    let a: SourceKey = 'z0', b: SourceKey = 'z0', mix = 0;
    if (k >= s0h && !this.backdrop.seqReady) {
      // No plunge frames (no AVIF, or still loading): blend the two plates.
      a = 'z0'; b = 'z1'; mix = smooth(0.25, 0.75, p1);
      if (p1 >= 1) { a = 'z1'; mix = 0; }
    } else if (k >= s0h) {
      a = 'seq'; b = 'seq';
      const fadeIn = this.phone ? 0.14 : 0.04;
      if (p1 < fadeIn) { a = 'z0'; mix = smooth(0, fadeIn, p1); }
      if (p1 > 0.97) { a = 'seq'; b = 'z1'; mix = smooth(0.97, 1, p1); }
      if (p1 >= 1) { a = 'z1'; b = 'z1'; mix = 0; }
    }
    const frameIdx = p1 * (media.t1.frames - 1);
    const fyOf = (x: SourceKey) => (x === 'z1' ? fyS1 : x === 'z0' ? fyS0 : 0.5);
    const covers = this.backdrop.update(dt, a, b, mix, frameIdx, fyOf(a), fyOf(b), L.fx);
    const z0c = a === 'z0' ? covers.a : null;
    const z1c = a === 'z1' ? covers.a : b === 'z1' ? covers.b : null;
    this.backdrop.playLoops(k < s0h + 0.2, kS1 > -1.2 && kNext < 1);

    // Effects by zone.
    const under = smooth(0.1, 0.6, p1);
    const u = this.backdrop.u;
    u.uTime.value = t;
    u.uMouseOn.value = this.mouse ? 1 : 0;
    if (this.mouse) u.uMouse.value.set(this.mouse[0], this.mouse[1]);
    u.uRipple.value = a === 'z0' ? 1 : 0;
    u.uWaterY.value = z0c ? onPlate(z0c, 0, media.plates[this.phone ? 'z0p' : 'z0'].waterline ?? 0.58)[1] : 1e5;
    u.uGlint.value = z1c ? 1 : 0;
    u.uTintAmt.value = 0.42 * smooth(-0.6, 0.6, kNext);
    u.uDim.value = 1;
    this.chain.setWater(under);
    const grade: [number, number, number] = [1 - 0.1 * under, 1 + 0.01 * under, 1 + 0.04 * under];

    // The chain: from the boat at the marina, from above the screen below.
    const z0 = z0c ?? this.lastZ0;
    if (z0c) this.lastZ0 = z0c;
    const boat = z0 ? onPlate(z0, L.anchor[0], L.anchor[1]) : [W * 0.68, H * 0.45];
    const chainS1 = this.phone ? W * 0.1 : Math.max(W * 0.53, this.cardsRight + W * 0.05);
    const out = smooth(0.0, 0.65, p1);
    const ax = lerp(boat[0], chainS1, smooth(0.2, 0.9, p1));
    const ay = lerp(boat[1], -0.35 * H, out);
    const ride = this.snap.holds;
    const chainBody = L.chainBody * H;
    const linkLen = media.snapChain.linkLen * chainBody;
    // Snap's top hold: straight under the anchor at the marina, then over the shallows.
    const holdX = lerp(boat[0], chainS1, smooth(0.2, 0.9, p1));
    const holdY = L.holdY * H;
    let holds: Hold[] = [];
    if (ride) {
      const span = Math.round((media.snapChain.chainBottom - media.snapChain.chainTop) * chainBody / (linkLen * 0.72));
      holds = [{ i: 36, x: ride.top[0], y: ride.top[1] }, { i: 36 + Math.max(2, Math.min(8, span)), x: ride.bottom[0], y: ride.bottom[1] }];
    }
    this.chain.slide = -p1 * 26 * this.chain.pitch;
    this.chain.update(dt, t, {
      ax, ay, len: H * 1.1, tail: H * 0.75, holds, sway: sc.v, mouse: this.mouse, visible: true, linkLen,
    });

    // Snap.
    const feet = z0 ? onPlate(z0, L.feet[0], L.feet[1]) : [W * 0.88, H * 0.36];
    const body = (z0 ? z0.dh : H * 1.12) * L.body;
    const lean = ride ? Math.atan2(ride.top[0] - ax, ride.top[1] - ay) * 0.6 : 0;
    this.snap.update(dt, t, {
      k, beat: { gust: L.gust * s0h, hop: L.hop * s0h, force: 0.94 * s0h, reset: 0.6 * L.gust * s0h },
      feet: [feet[0], feet[1]], body, hold: [holdX, holdY], chainBody,
      water: z0 ? onPlate(z0, 0, media.plates[this.phone ? 'z0p' : 'z0'].waterline ?? 0.58)[1] : H * 0.6, viewW: W,
      lean: clamp(lean, -0.25, 0.25), grade,
    });

    // Bubbles: a burst through the plunge, a stream from Snap on fast scrolls.
    if (p1 > 0.02 && p1 < 0.6 && Math.random() < 0.9) this.bubbles.emit(W * (0.2 + Math.random() * 0.6), H * (0.75 + Math.random() * 0.35), H * 0.012, 3);
    if (ride && (p1 > 0.3 || kS1 > -1) && Math.abs(sc.v) > 6 && Math.random() < 0.6) this.bubbles.emit(ride.top[0] + chainBody * 0.3, ride.top[1], H * 0.008);
    this.bubbles.update(dt);

    // Tags hang on the chain in the shallows.
    for (const [key, n] of Object.entries(TAG_LINKS) as [keyof typeof TAG_LINKS, number][]) {
      this.out.tags[key] = this.chain.at(this.chain.linkArc(n));
    }
    const s1On = clamp(Math.min(smooth(-0.9, -0.3, kS1), 1 - smooth(-0.2, 0.4, kNext)));
    this.out.tagsOn = ride ? s1On : 0;
    this.out.s1On = s1On;
    this.out.z1 = z1c;

    // Fish in the shallows, gathering at the format tag on request.
    const tag = this.out.tags.fmt;
    this.fish.update(dt, t, { vis: s1On, w: W, h: H, tag: [tag.x, tag.y], mouse: this.mouse, grade });

    // Depth gauge.
    this.out.zone = k < s0h ? 's0' : p1 < 1 ? 't1' : kNext < -0.3 ? 's1' : 'next';
    this.out.depth = k < s0h ? 0 : p1 < 1 ? -5 * p1 : kNext < -0.3 ? -5 : -5 - 10 * smooth(-0.3, 0.6, kNext);
    this.out.storyOn = this.snap.state === 'gust' || this.snap.state === 'surprised' || this.snap.state === 'hop';

    s.render();
  }

  private lastZ0: Cover | null = null;
}
