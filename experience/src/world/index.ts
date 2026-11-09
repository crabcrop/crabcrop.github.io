import { Stage, onPlate, cover, type Cover } from './stage';
import { Backdrop, PANELS, type SourceKey, type Zone } from './backdrop';
import { Chain, type Hold } from './chain';
import { Snap } from './snap';
import { Schools, type Fmt } from './fish';
import { Bubbles } from './bubbles';
import { Kelp } from './kelp';
import { NetFish } from './netfish';
import { Reef, REEF_UNITS, type ReefOut } from './reef';
import { SPOTS } from './spots';
import { LOOK, LOOKS, type LookName } from './look';
import { media } from '../media';
import { clamp, lerp, smooth, type Scroll } from '../scroll';

interface Layout {
  /** Horizontal focus of the plates; the kelp has its own, to keep its silk curtains clear of the chain. */
  fx: number; fxKelp: number; feet: readonly [number, number]; body: number;
  anchor: readonly [number, number]; holdY: number; chainBody: number;
  /** The story beat, as shares of the marina's scroll length. */
  gust: number; hop: number;
  /** Snap's height walking the reef, in viewport heights. */
  reefBody: number;
}

/** Where things sit, in plate coordinates (0 to 1), per layout. */
const LAYOUT: Record<'wide' | 'phone', Layout> = {
  wide: {
    fx: 0.62, fxKelp: 0.5,
    feet: [0.795, 0.345], body: 0.125,               // Snap on the right pier
    anchor: [0.655, 0.47],                           // the chain leaves the boat's stern
    holdY: 0.56, chainBody: 0.26,                    // riding: his top hold, his height (viewport heights)
    gust: 0.35, hop: 0.64,
    reefBody: 0.2,
  },
  phone: {
    fx: 0.5, fxKelp: 0.5,
    feet: [0.37, 0.236], body: 0.085,
    anchor: [0.2, 0.27],
    holdY: 0.66, chainBody: 0.2,
    gust: 0.62, hop: 0.8,                            // after the tall hero card has scrolled away
    reefBody: 0.15,
  },
};

/** Tags hang on links counted from Snap's top hold in the shallows; the chain
 * pays out 20 links on the way to the kelp, so the look rises above him. */
const TAG_LINKS = { sig: -14, fmt: -7, look: 12, crop: 29, finish: 32 };
const DESCENT_LINKS = 20;
/** On the reef he holds the chain's end in his claw, and the whole URL hangs above him. */
const REEF_TAGS: typeof TAG_LINKS = { sig: -34, fmt: -26, look: -17, crop: -10, finish: -4 };

export type ZoneId = 's0' | 't1' | 's1' | 's2' | 't2' | 's3' | 's3b' | 'next';

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
  /** The reef camera and stations, while the reef or the studio is on screen. */
  reef: ReefOut | null;
  /** The card Snap is standing on, and since when. */
  perch: { el: Element; since: number } | null;
  chainX: (y: number) => number | null;
}

/** Zones that own a plate, for checking shared files before dropping one. */
const PLATE_ZONES = new Set<string>(['z0', 'z1', 'z2', 'z3', 'r3c', ...PANELS]);

export class World {
  readonly stage: Stage;
  private backdrop: Backdrop;
  private chain: Chain;
  readonly snap: Snap;
  private fish: Schools;
  private bubbles: Bubbles;
  private kelp: Kelp;
  private net: NetFish;
  private reef: Reef;
  readonly phone: boolean;
  private L: Layout;
  mouse: [number, number] | null = null;
  private cardsRight = 0;
  private lastZ0: Cover | null = null;
  private look: { picked: LookName; preview: LookName | null } = { picked: 'crisp', preview: null };
  private freeAsked = false;
  private kindUntil = 0;
  private t = 0;
  private landed = false;
  private idleFor = 0;
  private caughtSeen = -10;
  private lastVisit = -10;
  private visited = new WeakSet<Element>();
  private visitEl: Element | null = null;
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
    this.reef = new Reef(this.stage, phone);
    const zero = { x: -999, y: -999, a: 0 };
    this.out = {
      tags: { sig: zero, fmt: zero, look: zero, crop: zero, finish: zero }, tagsOn: 0, z1: null, z2: null,
      s1On: 0, s2On: 0, depth: 0, zone: 's0', storyOn: false, kindOn: false,
      fish: { x: -999, y: -999, on: false }, reef: null, perch: null, chainX: (y) => this.chain.xAt(y),
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
    this.wants.add('z0');
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
  /** Keep a plate loaded while it can be on screen soon; free it when it is far away. */
  private resident(z: Zone, need: boolean) {
    if (need) { this.want(z, () => this.backdrop.loadPlate(z).then(() => this.backdrop.loadLoop(z))); return; }
    if (!this.wants.has(z)) return;
    this.wants.delete(z);
    // Two zones can share one file: the turtle plate is both z3 and r0 on wide screens.
    const k = this.backdrop.key(z);
    const shared = [...this.wants].some((w) => PLATE_ZONES.has(w) && this.backdrop.key(w as Zone) === k);
    if (!shared) this.backdrop.drop(z);
  }
  private stream(y: number, H: number, Lr: number) {
    const sec = this.scroll.sec;
    const d0 = sec.s2.top - 1.45 * H;
    if (y > 0.35 * H) this.want('t1', () => this.backdrop.loadSequence('t1'));
    if (y > 0.95 * H) this.want('fish', () => this.fish.load());
    if (y > sec.s1.top + 0.4 * H) {
      this.want('kelp', () => this.kelp.load());
      this.want('net', () => this.net.load());
    }
    if (y > sec.s2.top - 0.2 * H) this.want('t2', () => this.backdrop.loadSequence('t2'));
    const reefSoon = y > sec.t2.top - 0.5 * H;
    if (y > sec.s1.top - H) this.want('m05', () => this.snap.loadClaw());
    if (reefSoon) {
      this.want('m04', () => this.snap.loadReef());
      this.want('coral', () => this.reef.load());
    }
    this.resident('z0', y < sec.t1.top + sec.t1.h + 0.5 * H);
    this.resident('z1', y > 0.95 * H && y < d0 + 1.6 * H);
    this.resident('z2', y > sec.s1.top + 0.4 * H && y < sec.s3.top + 0.5 * H);
    this.resident('z3', y > sec.s2.top + 0.6 * H && y < sec.s3.top + 0.5 * H);
    const inReef = y > sec.s3.top - H;
    this.resident('r0', reefSoon && Lr < 1.4);
    this.resident('r1', y > sec.t2.top + 0.3 * sec.t2.h && Lr < 2.7);
    this.resident('r2', inReef && Lr > 0.5 && Lr < 3.7);
    this.resident('r3', inReef && Lr > 1.5 && Lr < 4.7);
    this.resident('r3c', inReef && Lr > 1.5 && Lr < 4.7);
    this.resident('r4', inReef && Lr > 2.5);
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
  /** A box marked over the reef's can, in its panel's plate shares. */
  removeRegion(rect: [number, number, number, number]) { this.reef.removeRegion(rect, this.t); }
  upscalePearl(again = false) { this.reef.upscale(this.t, again); }
  /** A click on Snap makes him spin round the chain. */
  snapHit(x: number, y: number) { return this.snap.hit(x, y); }
  pokeSnap() { this.snap.poke(this.t); this.idleFor = 0; }

  /** Pick a card beside him to visit: fully in view, its top edge in the upper middle, not visited yet. */
  private visitTarget(H: number, W: number, holdX: number): Element | null {
    const sec = this.scroll.sec;
    const y = this.scroll.y;
    if (y < sec.s1.top - H * 0.5 || y > sec.t2.top - H * 0.5) return null;
    let best: Element | null = null, bestD = 1e9;
    for (const el of document.querySelectorAll('.s1 .card, .s2 .card')) {
      if (this.visited.has(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.top < H * 0.2 || r.top > H * 0.6 || r.bottom > H + r.height * 0.5) continue;
      const d = this.phone ? Math.abs(r.top - H * 0.35) : holdX - r.right;
      if (!this.phone && (d < 0 || d > W * 0.3)) continue;
      if (d < bestD) { bestD = d; best = el; }
    }
    return best;
  }
  /** The page scroll at which a reef station's stop is centred, for keyboard focus. */
  reefStopY(i: number) {
    const sec = this.scroll.sec;
    const pin = Math.max(1, sec.s3.h - this.stage.h);
    return sec.s3.top + (this.reef.stopAt(i) / REEF_UNITS) * pin;
  }

  frame(dt: number, t: number) {
    this.t = t;
    const s = this.stage, H = s.h, W = s.w, L = this.L;
    const sc = this.scroll, sec = sc.sec, y = sc.y;
    const k = y / H;
    const s0h = sec.s0.h / H;

    const p1 = clamp((y - sec.t1.top) / sec.t1.h);               // the plunge
    const kS1 = (y - sec.s1.top) / H;                             // into the shallows
    const d0 = sec.s2.top - 1.45 * H;                             // the shallows' last card has gone
    const d12 = smooth(0, 1, (y - d0) / H);                       // down into the kelp
    const kS2 = (y - sec.s2.top) / H;
    const q2 = clamp((y - sec.t2.top) / sec.t2.h);               // into the reef
    const inT2 = y >= sec.t2.top;

    // The reef: pinned sideways travel, then the studio, then the way out.
    const reefMeta = media.plates.z3;
    const rc = cover(reefMeta.w, reefMeta.h, W, H, 1.12, 0, 0.5);
    const win = W / rc.dw;
    const F = this.reef.framings(win);
    const pin = Math.max(1, sec.s3.h - H);
    const kR = clamp((y - sec.s3.top) / pin) * REEF_UNITS;
    const kB = (y - sec.s3b.top) / H;
    const inReef = y >= sec.s3.top;
    const Lr = y < sec.s3b.top - H ? this.reef.camera(kR, F) : lerp(F[5], this.reef.studioEnd(win), smooth(-1, 1.2, kB));
    const exit = smooth(-0.7, 0.25, (y - sec.next.top) / H);
    this.stream(y, H, inReef ? Lr : F[0]);

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
    let z0c: Cover | null = null, z1c: Cover | null = null, z2c: Cover | null = null;
    // Snap's spot on the reef, in panels: he keeps his place on screen while
    // the camera travels, then walks to his mark in the studio.
    const snapU = lerp(Lr + this.reef.snapAt() * win, this.reef.studioSpot(), smooth(-0.8, 0.6, kB));
    let reefOut: ReefOut | null = null;
    if (inReef) {
      const r = this.reef.update(dt, t, { L: Lr, k: kR, W, H, dw: rc.dw, dh: rc.dh, oy: rc.oy, F, snapU, mouse: this.mouse, on: true });
      this.backdrop.updateReef(r.view);
      reefOut = r.out;
    } else {
      this.reef.hide();
      const fyOf = (x: SourceKey) => (x === 'z0' ? fyS0 : x === 'z1' ? fyS1 : x === 'z2' ? fyS2 : 0.5);
      const fxOf = (x: SourceKey) => (x === 'z2' ? L.fxKelp : x === 't2' ? lerp(L.fxKelp, L.fx, q2) : L.fx);
      const covers = this.backdrop.update(dt, a, b, mix, { t1: p1 * (media.t1.frames - 1), t2: q2 * (media.t2.frames - 1) }, fyOf(a), fyOf(b), fxOf(a), fxOf(b));
      const coverOf = (z: SourceKey) => (a === z ? covers.a : b === z ? covers.b : null);
      z0c = coverOf('z0'); z1c = coverOf('z1'); z2c = coverOf('z2');
    }
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
    u.uRipple.value = !inReef && a === 'z0' && b === 'z0' ? 1 : 0;
    u.uWaterY.value = z0c ? onPlate(z0c, 0, this.backdrop.plateMeta('z0').waterline ?? 0.58)[1] : 1e5;
    u.uGlint.value = inReef ? 0.55 * (1 - exit) : s1On;
    u.uShafts.value = s2On;
    u.uTintAmt.value = inReef ? exit * 0.5 : dip;
    this.chain.setWater(under);
    const grade: [number, number, number] = [1 - 0.1 * under - 0.04 * s2On - 0.12 * exit, 1 + 0.01 * under - 0.04 * exit, 1 + 0.04 * under];

    // The look, previewed on the whole kelp forest.
    const lookName = this.look.preview ?? this.look.picked;
    LOOK.uLookMode.value = LOOKS[lookName];
    LOOK.uLookAmt.value = s2On;

    // The chain: from the boat at the marina, from above the screen below.
    const z0 = z0c ?? this.lastZ0;
    if (z0c) this.lastZ0 = z0c;
    const boat = z0 ? onPlate(z0, L.anchor[0], L.anchor[1]) : [W * 0.68, H * 0.45];
    const chainX = this.phone ? W * 0.1 : Math.max(W * 0.53, this.cardsRight + W * 0.05);
    const chainBody = L.chainBody * H;
    const linkLen = media.snapChain.linkLen * chainBody;
    const holdX = lerp(boat[0], chainX, smooth(0.2, 0.9, p1));
    const holdY = L.holdY * H;

    // Snap on the reef: down the chain to the sand, the walk, and back up on the chain at the end.
    const sc2 = media.snapChain;
    const reefBody = L.reefBody * H;
    const floorY = rc.oy + SPOTS.floor * rc.dh;
    const feetX = (snapU - Lr) * rc.dw;
    const clawX = feetX - reefBody * 0.55;
    const land = smooth(0.08, 0.42, kR);
    const ret = smooth(0.15, 0.4, exit);
    const landHy = floorY - (1 - sc2.chainTop) * chainBody * 0.92;
    const reefHold: [number, number] = ret > 0
      ? [clawX, landHy]
      : [lerp(chainX, clawX, smooth(0, 0.5, land)), lerp(holdY, landHy, land)];
    if (inReef && land >= 1 && !this.landed) {
      // A puff of sand as he lands.
      for (let i = 0; i < 6; i++) this.bubbles.emit(feetX + (Math.random() - 0.5) * reefBody, floorY, H * 0.007);
    }
    this.landed = inReef && land >= 1;

    // Snap's visits to the cards: when the visitor pauses beside one, he leaps onto it.
    this.idleFor = Math.abs(sc.v) < 0.4 ? this.idleFor + dt : 0;
    if (this.snap.visiting && Math.abs(sc.v) > 1.5) this.snap.endVisit(t);
    if (!this.snap.visiting) this.visitEl = null;
    if (!inReef && this.snap.riding && !this.snap.visiting && !this.snap.rider.spinning && this.idleFor > 2.2 && t - this.lastVisit > 9) {
      const el = this.visitTarget(H, W, holdX);
      if (el) {
        const feet = (): [number, number] | null => {
          const r = el.getBoundingClientRect();
          if (r.bottom < 0 || r.top > H || r.top < 30) return null;
          return this.phone ? [r.left + r.width * 0.32, r.top + 4] : [r.right - r.width * 0.24, r.top + 4];
        };
        if (this.snap.visit(t, feet, { chainBody: L.chainBody * H, body: (this.phone ? 0.13 : 0.16) * H })) {
          this.lastVisit = t;
          this.visited.add(el);
          this.visitEl = el;
        }
      }
    }
    this.out.perch = this.snap.perch && this.visitEl ? { el: this.visitEl, since: this.snap.perch.since } : null;

    const ride = this.snap.holds;
    const walking = inReef && !!this.snap.claw;
    let holds: Hold[] = [];
    let ax = lerp(boat[0], chainX, smooth(0.2, 0.9, p1));
    const ay = lerp(boat[1], -0.35 * H, smooth(0.0, 0.65, p1));
    if (walking) {
      const c = this.snap.claw!;
      holds = [{ i: 40, x: c[0], y: c[1] }];
      ax = c[0] - W * 0.015;
    } else if (ride) {
      const span = Math.round((sc2.chainBottom - sc2.chainTop) * chainBody / (linkLen * 0.72));
      holds = [{ i: 36, x: ride.top[0], y: ride.top[1] }, { i: 36 + Math.max(2, Math.min(8, span)), x: ride.bottom[0], y: ride.bottom[1] }];
      if (inReef) ax = ride.top[0];
    }
    const shift = -d12 * DESCENT_LINKS;
    this.chain.slide = (-p1 * 26 + shift - q2 * 20) * this.chain.pitch;
    this.chain.update(dt, t, { ax, ay, len: H * 1.1, tail: walking ? H * 0.08 : H * 0.75, holds, sway: sc.v, mouse: this.mouse, visible: true, linkLen, slack: walking ? 0.985 : 1.002 });

    // Snap.
    const feet = z0 ? onPlate(z0, L.feet[0], L.feet[1]) : [W * 0.88, H * 0.36];
    const body = (z0 ? z0.dh : H * 1.12) * L.body;
    const lean = ride && !inReef ? Math.atan2(ride.top[0] - ax, ride.top[1] - ay) * 0.6 : 0;
    this.snap.update(dt, t, {
      k, beat: { gust: L.gust * s0h, hop: L.hop * s0h, force: 0.94 * s0h, reset: 0.6 * L.gust * s0h },
      feet: [feet[0], feet[1]], body, hold: [holdX, holdY], chainBody,
      water: z0 ? onPlate(z0, 0, this.backdrop.plateMeta('z0').waterline ?? 0.58)[1] : H * 0.6, viewW: W,
      lean: clamp(lean, -0.25, 0.25), grade,
      speed: sc.v, mouse: this.mouse, idle: this.idleFor > 1.5,
      reef: inReef ? { land, ret, drop: smooth(0.4, 1, exit) * H * 0.9, feet: [feetX, floorY], body: reefBody, vel: this.reef.vel, hold: reefHold } : undefined,
    });
    // He caught the chain: it jolts, and at the surface the water rings.
    if (this.snap.caught !== this.caughtSeen) {
      this.caughtSeen = this.snap.caught;
      this.chain.kick(18, 36, (Math.random() - 0.5) * 6, 7);
      const water = u.uWaterY.value;
      if (k < s0h + 0.5 && water < H) {
        u.uImpact.value.set(holdX, water, t);
        for (let i = 0; i < 8; i++) this.bubbles.emit(holdX + (Math.random() - 0.5) * chainBody * 0.6, water + chainBody * (0.1 + Math.random() * 0.4), H * 0.008);
      }
    }

    // Bubbles: the plunge, the drop into the reef, and Snap on fast scrolls.
    if (((p1 > 0.02 && p1 < 0.6) || (q2 > 0.05 && q2 < 0.5)) && Math.random() < 0.9) this.bubbles.emit(W * (0.2 + Math.random() * 0.6), H * (0.75 + Math.random() * 0.35), H * 0.012, 3);
    if (ride && !inReef && (p1 > 0.3 || kS1 > -1) && Math.abs(sc.v) > 6 && Math.random() < 0.6) this.bubbles.emit(ride.top[0] + chainBody * 0.3, ride.top[1], H * 0.008);
    if (walking && Math.abs(this.reef.vel) > 400 && Math.random() < 0.25) this.bubbles.emit(feetX + (Math.random() - 0.5) * reefBody * 0.6, floorY - reefBody * 0.1, H * 0.006);
    this.bubbles.update(dt);

    // Tags hang on the chain from the shallows through the kelp, and above Snap on the reef.
    const tagLinks = walking ? REEF_TAGS : TAG_LINKS;
    for (const [key, n] of Object.entries(tagLinks) as [keyof typeof TAG_LINKS, number][]) {
      this.out.tags[key] = this.chain.at(this.chain.linkArc(walking ? n : n + shift));
    }
    this.out.tagsOn = walking
      ? smooth(0.45, 0.7, kR) * (1 - ret) * (1 - 0.85 * (this.phone ? Math.max(...(reefOut?.near.slice(1, 5) ?? [0])) : reefOut?.near[2] ?? 0))
      : ride && !inReef ? clamp(Math.min(smooth(-0.9, -0.3, kS1), 1 - smooth(0.0, 0.25, q2))) : 0;

    // The format fish in the shallows.
    const tag = this.out.tags.fmt;
    this.fish.update(dt, t, { vis: s1On, w: W, h: H, tag: [tag.x, tag.y], mouse: this.mouse, grade });

    // The kelp forest: foreground stalks, and the little fish in the line.
    this.kelp.update(t, { vis: s2On, w: W, h: H, mouse: this.mouse });
    if (y < d0 && this.net.state !== 'tangled') { this.net.reset(); this.freeAsked = false; }
    const top = ride ? ride.top : [holdX, holdY];
    const wasTangled = this.net.state === 'tangled';
    this.net.update(dt, t, {
      vis: inReef ? 0 : Math.max(s2On, inT2 ? 1 - smooth(0.1, 0.5, q2) : 0), hold: [top[0], top[1]], size: H * 0.034,
      follow: 1, auto: this.freeAsked || kS2 > 0.75,
    });
    if (wasTangled && this.net.state !== 'tangled') this.kindUntil = t + 5;
    this.out.fish = { x: this.net.at.x, y: this.net.at.y, on: this.net.at.on && s2On > 0.6 };
    this.out.kindOn = t < this.kindUntil && s2On > 0.2;

    // Depth gauge.
    const zone: ZoneId = k < s0h ? 's0' : p1 < 1 ? 't1' : d12 < 0.5 ? 's1' : !inT2 ? 's2' : !inReef ? 't2'
      : y < sec.s3b.top - 0.5 * H ? 's3' : y < sec.next.top - 0.5 * H ? 's3b' : 'next';
    this.out.zone = zone;
    this.out.depth = k < s0h ? 0 : p1 < 1 ? -5 * p1 : !inT2 ? -5 - 10 * d12 : -15 - 15 * q2;
    this.out.storyOn = this.snap.state === 'gust' || this.snap.state === 'surprised' || this.snap.state === 'hop';
    this.out.z1 = z1c;
    this.out.z2 = z2c;
    this.out.s1On = s1On;
    this.out.s2On = s2On;
    this.out.reef = reefOut;

    s.render();
  }
}
