import { Stage, onPlate, type Cover } from './stage';
import { Backdrop, type SourceKey, type Zone } from './backdrop';
import { Chain, type Hold } from './chain';
import { Snap } from './snap';
import { Schools, type Fmt } from './fish';
import { Bubbles } from './bubbles';
import { Kelp } from './kelp';
import { NetFish } from './netfish';
import { LOOK, LOOKS, type LookName } from './look';
import { media } from '../media';
import { clamp, lerp, smooth, type Scroll } from '../scroll';

interface Layout {
  /** Horizontal focus of the plates; the kelp has its own, to keep its silk curtains clear of the chain. */
  fx: number; fxKelp: number; feet: readonly [number, number]; body: number;
  anchor: readonly [number, number]; holdY: number; chainBody: number;
  /** The story beat, as shares of the marina's scroll length. */
  gust: number; hop: number;
}

/** Where things sit, in plate coordinates (0 to 1), per layout. */
const LAYOUT: Record<'wide' | 'phone', Layout> = {
  wide: {
    fx: 0.62, fxKelp: 0.5,
    feet: [0.795, 0.345], body: 0.125,               // Snap on the right pier
    anchor: [0.655, 0.47],                           // the chain leaves the boat's stern
    holdY: 0.56, chainBody: 0.26,                    // riding: his top hold, his height (viewport heights)
    gust: 0.35, hop: 0.64,
  },
  phone: {
    fx: 0.5, fxKelp: 0.5,
    feet: [0.37, 0.236], body: 0.085,
    anchor: [0.2, 0.27],
    holdY: 0.66, chainBody: 0.2,
    gust: 0.62, hop: 0.8,                            // after the tall hero card has scrolled away
  },
};

/** Tags hang on links counted from Snap's top hold in the shallows; the chain
 * pays out 20 links on the way to the kelp, so the look rises above him. */
const TAG_LINKS = { sig: -14, fmt: -7, look: 12, crop: 29, finish: 32 };
const DESCENT_LINKS = 20;

export type ZoneId = 's0' | 't1' | 's1' | 's2' | 't2' | 'next';

export interface WorldOut {
  tags: Record<keyof typeof TAG_LINKS, { x: number; y: number; a: number }>;
  tagsOn: number;
  z1: Cover | null;
  z2: Cover | null;
  s1On: number;
  s2On: number;
  depth: number;
  zone: ZoneId;
  storyOn: boolean;
  kindOn: boolean;
  fish: { x: number; y: number; on: boolean };
  chainX: (y: number) => number | null;
}

export class World {
  readonly stage: Stage;
  private backdrop: Backdrop;
  private chain: Chain;
  readonly snap: Snap;
  private fish: Schools;
  private bubbles: Bubbles;
  private kelp: Kelp;
  private net: NetFish;
  readonly phone: boolean;
  private L: Layout;
  mouse: [number, number] | null = null;
  private cardsRight = 0;
  private lastZ0: Cover | null = null;
  private look: { picked: LookName; preview: LookName | null } = { picked: 'crisp', preview: null };
  private freeAsked = false;
  private kindUntil = 0;
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
    this.kelp = new Kelp(this.stage, phone);
    this.net = new NetFish(this.stage);
    const zero = { x: -999, y: -999, a: 0 };
    this.out = {
      tags: { sig: zero, fmt: zero, look: zero, crop: zero, finish: zero }, tagsOn: 0, z1: null, z2: null,
      s1On: 0, s2On: 0, depth: 0, zone: 's0', storyOn: false, kindOn: false,
      fish: { x: -999, y: -999, on: false }, chainX: (y) => this.chain.xAt(y),
    };
    this.measure();
  }

  measure() {
    const cards = document.querySelector('.s1 .cards')?.getBoundingClientRect();
    this.cardsRight = cards ? cards.right : 0;
  }

  resize() { this.stage.resize(); this.measure(); }

  /** The marina first; everything else loads as the visitor nears it. */
  async load() {
    await this.backdrop.loadPlate('z0');
    await this.snap.load().catch(() => {});
    this.backdrop.loadLoop('z0').catch(() => {});
    await this.snap.loadRest().catch(() => {});
  }

  private wants = new Set<string>();
  private want(key: string, go: () => Promise<unknown>) {
    if (this.wants.has(key)) return;
    this.wants.add(key);
    go().catch(() => {});
  }
  private stream(y: number, H: number) {
    const sec = this.scroll.sec;
    const plate = (z: Zone) => () => this.backdrop.loadPlate(z).then(() => this.backdrop.loadLoop(z));
    if (y > 0.35 * H) this.want('t1', () => this.backdrop.loadSequence('t1'));
    if (y > 0.95 * H) { this.want('z1', plate('z1')); this.want('fish', () => this.fish.load()); }
    if (y > sec.s1.top + 0.4 * H) {
      this.want('z2', plate('z2'));
      this.want('kelp', () => this.kelp.load());
      this.want('net', () => this.net.load());
    }
    if (y > sec.s2.top - 0.2 * H) this.want('t2', () => this.backdrop.loadSequence('t2'));
    if (y > sec.s2.top + 0.6 * H) this.want('z3', () => this.backdrop.loadPlate('z3'));
  }

  setFormat(f: Fmt | 'auto', t: number) {
    this.fish.picked = f === 'auto' ? null : f;
    if (f === 'auto') this.fish.race(t);
  }
  focusFormat(f: Fmt | null) { this.fish.focus = f; }
  raceOnce(t: number) { this.fish.race(t); }
  setLook(l: LookName) { this.look.picked = l; }
  previewLook(l: LookName | null) { this.look.preview = l; }
  freeFish() { this.freeAsked = true; }

  frame(dt: number, t: number) {
    const s = this.stage, H = s.h, W = s.w, L = this.L;
    const sc = this.scroll, sec = sc.sec, y = sc.y;
    const k = y / H;
    const s0h = sec.s0.h / H;
    this.stream(y, H);

    const p1 = clamp((y - sec.t1.top) / sec.t1.h);               // the plunge
    const kS1 = (y - sec.s1.top) / H;                             // into the shallows
    const d0 = sec.s2.top - 1.45 * H;                             // the shallows' last card has gone
    const d12 = smooth(0, 1, (y - d0) / H);                       // down into the kelp
    const kS2 = (y - sec.s2.top) / H;
    const q2 = clamp((y - sec.t2.top) / sec.t2.h);               // into the reef
    const inT2 = y >= sec.t2.top;

    // Which plates, frames and blends are on screen.
    const fyS0 = lerp(0.2, 0.5, clamp(k / s0h));
    const fyS1 = lerp(0.5, 1, clamp(kS1 / (sec.s1.h / H + 0.45)));
    const fyS2 = lerp(0, 0.5, clamp((y - d0) / (sec.t2.top - d0)));
    let a: SourceKey = 'z0', b: SourceKey = 'z0', mix = 0, dip = 0;
    if (inT2) {
      if (this.backdrop.seqReady('t2')) {
        a = 't2'; b = 't2';
        if (q2 < 0.04) { a = 'z2'; mix = smooth(0, 0.04, q2); }
        if (q2 > 0.97) { b = 'z3'; mix = smooth(0.97, 1, q2); }
        if (q2 >= 1) { a = b = 'z3'; mix = 0; }
      } else { a = 'z2'; b = 'z3'; mix = smooth(0.25, 0.75, q2); }
    } else if (d12 > 0) {
      a = 'z1'; b = 'z2'; mix = d12; dip = Math.sin(Math.PI * d12) * 0.38;
      if (d12 >= 1) { a = b = 'z2'; mix = 0; }
    } else if (k >= s0h) {
      if (this.backdrop.seqReady('t1')) {
        a = 't1'; b = 't1';
        const fadeIn = this.phone ? 0.14 : 0.04;
        if (p1 < fadeIn) { a = 'z0'; mix = smooth(0, fadeIn, p1); }
        if (p1 > 0.97) { b = 'z1'; mix = smooth(0.97, 1, p1); }
        if (p1 >= 1) { a = b = 'z1'; mix = 0; }
      } else { a = 'z0'; b = 'z1'; mix = smooth(0.25, 0.75, p1); if (p1 >= 1) { a = b = 'z1'; mix = 0; } }
    }
    const fyOf = (x: SourceKey) => (x === 'z0' ? fyS0 : x === 'z1' ? fyS1 : x === 'z2' ? fyS2 : 0.5);
    const fxOf = (x: SourceKey) => (x === 'z2' ? L.fxKelp : x === 't2' ? lerp(L.fxKelp, L.fx, q2) : L.fx);
    const covers = this.backdrop.update(dt, a, b, mix, { t1: p1 * (media.t1.frames - 1), t2: q2 * (media.t2.frames - 1) }, fyOf(a), fyOf(b), fxOf(a), fxOf(b));
    const coverOf = (z: SourceKey) => (a === z ? covers.a : b === z ? covers.b : null);
    const z0c = coverOf('z0'), z1c = coverOf('z1'), z2c = coverOf('z2');
    this.backdrop.playLoops({ z0: k < s0h + 0.2, z1: kS1 > -1.2 && d12 < 1, z2: d12 > 0 && q2 < 0.1 });

    // Visibility of each zone's layers.
    const s1On = clamp(Math.min(smooth(-0.9, -0.3, kS1), 1 - d12));
    const s2On = clamp(Math.min(smooth(0.35, 0.9, d12), 1 - smooth(0.02, 0.35, q2)));

    // Effects by zone.
    const under = smooth(0.1, 0.6, p1);
    const u = this.backdrop.u;
    u.uTime.value = t;
    u.uMouseOn.value = this.mouse ? 1 : 0;
    if (this.mouse) u.uMouse.value.set(this.mouse[0], this.mouse[1]);
    u.uRipple.value = a === 'z0' && b === 'z0' ? 1 : 0;
    u.uWaterY.value = z0c ? onPlate(z0c, 0, this.backdrop.plateMeta('z0').waterline ?? 0.58)[1] : 1e5;
    u.uGlint.value = s1On;
    u.uShafts.value = s2On;
    u.uTintAmt.value = dip;
    this.chain.setWater(under);
    const grade: [number, number, number] = [1 - 0.1 * under - 0.04 * s2On, 1 + 0.01 * under, 1 + 0.04 * under];

    // The look, previewed on the whole kelp forest.
    const lookName = this.look.preview ?? this.look.picked;
    LOOK.uLookMode.value = LOOKS[lookName];
    LOOK.uLookAmt.value = s2On;

    // The chain: from the boat at the marina, from above the screen below.
    const z0 = z0c ?? this.lastZ0;
    if (z0c) this.lastZ0 = z0c;
    const boat = z0 ? onPlate(z0, L.anchor[0], L.anchor[1]) : [W * 0.68, H * 0.45];
    const chainX = this.phone ? W * 0.1 : Math.max(W * 0.53, this.cardsRight + W * 0.05);
    const ax = lerp(boat[0], chainX, smooth(0.2, 0.9, p1));
    const ay = lerp(boat[1], -0.35 * H, smooth(0.0, 0.65, p1));
    const ride = this.snap.holds;
    const chainBody = L.chainBody * H;
    const linkLen = media.snapChain.linkLen * chainBody;
    const holdX = lerp(boat[0], chainX, smooth(0.2, 0.9, p1));
    const holdY = L.holdY * H;
    let holds: Hold[] = [];
    if (ride) {
      const span = Math.round((media.snapChain.chainBottom - media.snapChain.chainTop) * chainBody / (linkLen * 0.72));
      holds = [{ i: 36, x: ride.top[0], y: ride.top[1] }, { i: 36 + Math.max(2, Math.min(8, span)), x: ride.bottom[0], y: ride.bottom[1] }];
    }
    const shift = -d12 * DESCENT_LINKS;
    this.chain.slide = (-p1 * 26 + shift - q2 * 20) * this.chain.pitch;
    this.chain.update(dt, t, { ax, ay, len: H * 1.1, tail: H * 0.75, holds, sway: sc.v, mouse: this.mouse, visible: true, linkLen });

    // Snap.
    const feet = z0 ? onPlate(z0, L.feet[0], L.feet[1]) : [W * 0.88, H * 0.36];
    const body = (z0 ? z0.dh : H * 1.12) * L.body;
    const lean = ride ? Math.atan2(ride.top[0] - ax, ride.top[1] - ay) * 0.6 : 0;
    this.snap.update(dt, t, {
      k, beat: { gust: L.gust * s0h, hop: L.hop * s0h, force: 0.94 * s0h, reset: 0.6 * L.gust * s0h },
      feet: [feet[0], feet[1]], body, hold: [holdX, holdY], chainBody,
      water: z0 ? onPlate(z0, 0, this.backdrop.plateMeta('z0').waterline ?? 0.58)[1] : H * 0.6, viewW: W,
      lean: clamp(lean, -0.25, 0.25), grade,
    });

    // Bubbles: the plunge, the drop into the reef, and Snap on fast scrolls.
    if (((p1 > 0.02 && p1 < 0.6) || (q2 > 0.05 && q2 < 0.5)) && Math.random() < 0.9) this.bubbles.emit(W * (0.2 + Math.random() * 0.6), H * (0.75 + Math.random() * 0.35), H * 0.012, 3);
    if (ride && (p1 > 0.3 || kS1 > -1) && Math.abs(sc.v) > 6 && Math.random() < 0.6) this.bubbles.emit(ride.top[0] + chainBody * 0.3, ride.top[1], H * 0.008);
    this.bubbles.update(dt);

    // Tags hang on the chain from the shallows through the kelp.
    for (const [key, n] of Object.entries(TAG_LINKS) as [keyof typeof TAG_LINKS, number][]) {
      this.out.tags[key] = this.chain.at(this.chain.linkArc(n + shift));
    }
    this.out.tagsOn = ride ? clamp(Math.min(smooth(-0.9, -0.3, kS1), 1 - smooth(0.0, 0.25, q2))) : 0;

    // The format fish in the shallows.
    const tag = this.out.tags.fmt;
    this.fish.update(dt, t, { vis: s1On, w: W, h: H, tag: [tag.x, tag.y], mouse: this.mouse, grade });

    // The kelp forest: foreground stalks, and the little fish in the line.
    this.kelp.update(t, { vis: s2On, w: W, h: H, mouse: this.mouse });
    if (y < d0 && this.net.state !== 'tangled') { this.net.reset(); this.freeAsked = false; }
    const top = ride ? ride.top : [holdX, holdY];
    const wasTangled = this.net.state === 'tangled';
    this.net.update(dt, t, {
      vis: Math.max(s2On, inT2 ? 1 - smooth(0.1, 0.5, q2) : 0), hold: [top[0], top[1]], size: H * 0.034,
      follow: 1, auto: this.freeAsked || kS2 > 0.75,
    });
    if (wasTangled && this.net.state !== 'tangled') this.kindUntil = t + 5;
    this.out.fish = { x: this.net.at.x, y: this.net.at.y, on: this.net.at.on && s2On > 0.6 };
    this.out.kindOn = t < this.kindUntil;

    // Depth gauge.
    const zone: ZoneId = k < s0h ? 's0' : p1 < 1 ? 't1' : d12 < 0.5 ? 's1' : !inT2 ? 's2' : q2 < 1 ? 't2' : 'next';
    this.out.zone = zone;
    this.out.depth = k < s0h ? 0 : p1 < 1 ? -5 * p1 : !inT2 ? -5 - 10 * d12 : -15 - 15 * q2;
    this.out.storyOn = this.snap.state === 'gust' || this.snap.state === 'surprised' || this.snap.state === 'hop';
    this.out.z1 = z1c;
    this.out.z2 = z2c;
    this.out.s1On = s1On;
    this.out.s2On = s2On;

    s.render();
  }
}
