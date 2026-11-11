import { Stage, onPlate, cover, type Cover } from './stage';
import { Backdrop, PANELS, type SourceKey, type Zone } from './backdrop';
import { Chain, type Hold } from './chain';
import { Snap } from './snap';
import { Schools, type Fmt } from './fish';
import { Bubbles } from './bubbles';
import { Splash } from './splash';
import { Kelp } from './kelp';
import { NetFish } from './netfish';
import { Reef, REEF_UNITS, type ReefOut } from './reef';
import { Motes } from './motes';
import { Octopus } from './octopus';
import { Debris } from './debris';
import { Twilight } from './twilight';
import { SPOTS } from './spots';
import { LOOK, LOOKS, type LookName } from './look';
import { media } from '../media';
import { clamp, lerp, smooth, type Scroll } from '../scroll';

interface Layout {
  /** Horizontal focus of the plates; the kelp has its own, to keep its silk curtains clear of the chain, and so do the wreck outside and its cabin. */
  fx: number; fxKelp: number; fxWreck: number; fxCabin: number;
  /** How far the cabin plate is drawn past a cover fit: less than elsewhere on wide screens, so the desk sits clear of Snap. */
  overCabin: number;
  feet: readonly [number, number]; body: number;
  anchor: readonly [number, number]; holdY: number; chainBody: number;
  /** The story beat, as shares of the marina's scroll length. */
  gust: number; hop: number;
  /** Snap's height walking the reef, in viewport heights. */
  reefBody: number;
  /** The octopus in the wreck, in viewport heights. */
  octopus: number;
}

/** Where things sit, in plate coordinates (0 to 1), per layout. */
const LAYOUT: Record<'wide' | 'phone', Layout> = {
  wide: {
    fx: 0.62, fxKelp: 0.5, fxWreck: 0.38, fxCabin: 0.45, overCabin: 1.04,
    feet: [0.795, 0.345], body: 0.125,               // Snap on the right pier
    anchor: [0.655, 0.47],                           // the chain leaves the boat's stern
    holdY: 0.56, chainBody: 0.26,                    // riding: his top hold, his height (viewport heights)
    gust: 0.35, hop: 0.64,
    reefBody: 0.2,
    octopus: 0.13,
  },
  phone: {
    fx: 0.5, fxKelp: 0.5, fxWreck: 0.5, fxCabin: 0.5, overCabin: 1.12,
    feet: [0.37, 0.236], body: 0.085,
    anchor: [0.2, 0.27],
    holdY: 0.66, chainBody: 0.2,
    gust: 0.62, hop: 0.8,                            // after the tall hero card has scrolled away
    reefBody: 0.15,
    octopus: 0.1,
  },
};

/**
 * Where the water's surface is in the plunge's frames (T01), as a share of
 * their height, every third frame from the first: it rises out of the top
 * as the camera dives. Measured on the 72 desktop frames (the phone frames
 * are crops of the same video, so the shares hold).
 */
const T1_SURFACE = [0.615, 0.59, 0.595, 0.51, 0.505, 0.41, 0.37, 0.335, 0.27, 0.245, 0.15, 0.145, 0.04, 0.013, -0.025];
function plungeSurface(frame: number) {
  const f = frame / 3, i = Math.floor(f);
  if (i >= T1_SURFACE.length - 1) return -0.2;
  return T1_SURFACE[i] + (T1_SURFACE[i + 1] - T1_SURFACE[i]) * (f - i);
}

/** Tags hang on links counted from Snap's top hold in the shallows; the chain
 * pays out 20 links on the way to the kelp, so the look rises above him. */
const TAG_LINKS = { sig: -14, fmt: -7, look: 12, crop: 29, finish: 32 };
const DESCENT_LINKS = 20;
/** On the reef he holds the chain's end in his claw, and the whole URL hangs above him. */
const REEF_TAGS: typeof TAG_LINKS = { sig: -34, fmt: -26, look: -17, crop: -10, finish: -4 };
/** In the wreck's cabin he rides again, the URL above him and its finish below. */
const CABIN_TAGS: typeof TAG_LINKS = { sig: -18, fmt: -14, look: -10, crop: -6, finish: 10 };

/**
 * Where things are in the wreck, as shares of the master plates (the phone
 * plates are windows of them, WRECK_PHONE). The lantern: its hook, the
 * middle of its glass, how far its foot hangs below the hook and its half
 * width (both in plate heights). The chest's top edge, the wax seal stamp
 * and the chest, for the octopus and the desk's hotspots.
 */
const WRECK = {
  hook: [0.6895, 0.1311] as const, glass: [0.6878, 0.3203] as const, len: 0.282, half: 0.0536,
  chestTop: [0.7514, 0.4824] as const,
};
const WRECK_PHONE = { z4x: [0.38, 0.62], z4: [0.54, 0.78], z5: [0.52, 0.76] } as const;
/** In the twilight zone, where the lost fish waits (a share of the master plate). */
const LOST_FISH = [0.6, 0.76] as const;
/** The drop starts this many frames in, where the camera is already moving off the wreck. */
const T4_FROM = 10;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export type ZoneId = 's0' | 't1' | 's1' | 's2' | 't2' | 's3' | 's3b' | 's4' | 't3' | 's4b' | 't4' | 's5' | 'next';

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
  /** The wreck's cabin: its plate on screen, how much it is on, and the octopus waiting with its letter (for its button). */
  z4: Cover | null;
  cabinOn: number;
  octo: { x: number; y: number; s: number; on: boolean; busy: boolean };
  /** The story of the octopus's letter, after Snap has sealed it. */
  sealOn: boolean;
  /**
   * The twilight zone: its plate on screen and the phone window of the
   * master plate it shows, how much it is on, the lantern's light (x, y,
   * radius px), and the lure's light running down the chain.
   */
  twi: { z5: Cover | null; win: readonly [number, number]; on: number; light: [number, number, number]; lure: { x: number; y: number; on: boolean } };
  /** The story of the lost fish, once it has gone home with Snap. */
  fishOn: boolean;
}

/** Zones that own a plate, for checking shared files before dropping one. */
const PLATE_ZONES = new Set<string>(['z0', 'z1', 'z2', 'z3', 'r3c', 'z4x', 'z4', 'z5', ...PANELS]);

export class World {
  readonly stage: Stage;
  private backdrop: Backdrop;
  private chain: Chain;
  readonly snap: Snap;
  private fish: Schools;
  private bubbles: Bubbles;
  private splash: Splash;
  private kelp: Kelp;
  private net: NetFish;
  private reef: Reef;
  private motes: Motes;
  private octopus: Octopus;
  private debris: Debris;
  private twilight: Twilight;
  /** The lantern's swing (radians, foot to the right) and its speed. */
  private lamp = { a: 0, v: 0 };
  /** The visitor asked Snap to seal the letter; when his pincer shuts on it. */
  private sealAsked = false;
  private sealAt = -1;
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
  private enteredSeen = -10;
  private lastVisit = -10;
  private visited = new WeakSet<Element>();
  private visitEl: Element | null = null;
  readonly out: WorldOut;

  constructor(canvas: HTMLCanvasElement, private scroll: Scroll, phone: boolean) {
    this.phone = phone;
    this.L = phone ? LAYOUT.phone : LAYOUT.wide;
    this.stage = new Stage(canvas, 2);
    this.backdrop = new Backdrop(this.stage, phone);
    this.chain = new Chain(this.stage);
    this.snap = new Snap(this.stage);
    this.fish = new Schools(this.stage, phone);
    this.bubbles = new Bubbles(this.stage);
    this.splash = new Splash(this.stage);
    this.kelp = new Kelp(this.stage, phone);
    this.net = new NetFish(this.stage);
    this.reef = new Reef(this.stage, phone);
    this.motes = new Motes(this.stage);
    this.octopus = new Octopus(this.stage);
    this.debris = new Debris(this.stage, phone);
    this.twilight = new Twilight(this.stage, phone);
    const zero = { x: -999, y: -999, a: 0 };
    this.out = {
      tags: { sig: zero, fmt: zero, look: zero, crop: zero, finish: zero }, tagsOn: 0, z1: null, z2: null,
      s1On: 0, s2On: 0, depth: 0, zone: 's0', storyOn: false, kindOn: false,
      fish: { x: -999, y: -999, on: false }, reef: null, perch: null, chainX: (y) => this.chain.xAt(y),
      z4: null, cabinOn: 0, octo: { x: -999, y: -999, s: 0, on: false, busy: false }, sealOn: false,
      twi: { z5: null, win: [0, 1], on: 0, light: [-999, -999, 1], lure: { x: -999, y: -999, on: false } }, fishOn: false,
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
    // The wreck: outside, the cabin and its octopus, the drop, and the twilight zone it ends on.
    if (y > sec.s3b.top) this.want('t3', () => this.backdrop.loadSequence('t3'));
    if (y > sec.s4.top) this.want('octopus', () => this.octopus.load());
    if (y > sec.s3b.top + H) this.want('beam', () => this.debris.load());
    if (y > sec.s4b.top + 0.5 * H) this.want('t4', () => this.backdrop.loadSequence('t4'));
    this.resident('z4x', y > sec.s3b.top && y < sec.s4b.top + 0.5 * H);
    this.resident('z4', y > sec.s4.top && y < sec.t4.top + 0.6 * H);
    this.resident('z5', y > sec.s4b.top + H);
    // The twilight zone: its lit plate for the lantern, the lost fish and the glowing jellyfish.
    if (y > sec.t4.top) this.want('twilight', () => this.twilight.load());
    this.resident('z5lit', y > sec.t4.top + 0.5 * sec.t4.h);
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
  /** The water rings at (x, y) on the surface, with bubbles below it and, for the 3D Snap, a splash of drops. */
  private splashAt(x: number, y: number, size: number, t: number, drops: boolean) {
    this.backdrop.u.uImpact.value.set(x, y, t);
    if (drops) this.splash.burst(x, y, size * 0.9);
    for (let i = 0; i < 8; i++) this.bubbles.emit(x + (Math.random() - 0.5) * size * 0.6, y + size * (0.1 + Math.random() * 0.4), this.stage.h * 0.008, 1, y);
  }
  /** A box marked over the reef's can, in its panel's plate shares. */
  removeRegion(rect: [number, number, number, number]) { this.reef.removeRegion(rect, this.t); }
  upscalePearl(again = false) { this.reef.upscale(this.t, again); }
  /** The "Seal the letter" button: Snap seals the octopus's letter. */
  sealLetter() { this.sealAsked = true; }
  /** Choice 5 was made: sealing the URL, Snap snaps his claw; readable, he waves. */
  sealUrl(sealed: boolean) { if (this.snap.riding && !this.snap.visiting) this.snap.rider.act(this.t, sealed ? 'snap' : 'wave'); }
  /** A click on Snap makes him spin round the chain. */
  snapHit(x: number, y: number) { return this.snap.hit(x, y); }
  pokeSnap() { this.snap.poke(this.t); this.idleFor = 0; }

  /** Pick a card beside him to visit: fully in view, its top edge in the upper middle, not visited yet. */
  private visitTarget(H: number, W: number, holdX: number): Element | null {
    const sec = this.scroll.sec;
    const y = this.scroll.y;
    const upper = y >= sec.s1.top - H * 0.5 && y <= sec.t2.top - H * 0.5;
    const cabin = y >= sec.s4b.top && y <= sec.t4.top - H * 0.8 && (this.octopus.state === 'away' || this.octopus.state === 'gone');
    if (!upper && !cabin) return null;
    let best: Element | null = null, bestD = 1e9;
    for (const el of document.querySelectorAll(upper ? '.s1 .card, .s2 .card' : '.s4b .card')) {
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

  /** A spot on a wreck plate, given as shares of its master: the phone plates are windows of it. */
  private spot(z: keyof typeof WRECK_PHONE, c: Cover, u: number, v: number): [number, number] {
    const [a, b] = this.phone ? WRECK_PHONE[z] : [0, 1];
    return onPlate(c, (u - a) / (b - a), v);
  }

  /**
   * The captain's cabin: the lantern swings toward the cursor (and with the
   * scroll), dust drifts in its light, and the octopus brings its letter.
   */
  private cabin(dt: number, t: number, o: { z4c: Cover | null; cabinOn: number; fC: number; grade: [number, number, number]; ride: boolean; H: number; W: number }) {
    const { z4c, cabinOn, H, W } = o;
    this.out.z4 = z4c;
    this.out.cabinOn = cabinOn;
    let light: [number, number, number] | null = null;
    if (z4c && cabinOn > 0) {
      const hook = this.spot('z4', z4c, WRECK.hook[0], WRECK.hook[1]);
      const glass = this.spot('z4', z4c, WRECK.glass[0], WRECK.glass[1]);
      const len = WRECK.len * z4c.dh, half = WRECK.half * z4c.dh;
      // A damped pendulum: it leans toward the cursor, sways a little on its own and swings with the scroll.
      let target = 0.035 * Math.sin(t * 2.1) * Math.sin(t * 0.37 + 1) + clamp(this.scroll.v * 0.004, -0.05, 0.05);
      if (this.mouse) target += clamp((this.mouse[0] - hook[0]) / (W * 0.2), -1, 1) * 0.1;
      const L = this.lamp;
      L.v += (-(L.a - target) * 14 - L.v * 1.4) * dt;
      L.a = clamp(L.a + L.v * dt, -0.14, 0.14);
      // the shader turns the plate the other way round; the swing eases in with the cabin
      const a = L.a * cabinOn, ang = -a, sn = Math.sin(a), cs = Math.cos(a);
      // a fixed oval, wide enough for the loop's own lantern at the end of its sway, and for this one
      const oval: [number, number, number, number] = [hook[0], hook[1] + len * 0.52, (half + 0.2 * len + 0.02 * z4c.dh) / 0.7, (len * 0.52 + 0.02 * z4c.dh) / 0.7];
      const gx = glass[0] - hook[0], gy = glass[1] - hook[1];
      const lit: [number, number] = [hook[0] + gx * cs + gy * sn, hook[1] - gx * sn + gy * cs];
      const flicker = 0.82 + 0.1 * Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1) + 0.08 * Math.sin(t * 17.9);
      this.backdrop.swing(hook, ang, oval, z4c, [lit[0], lit[1], z4c.dh * 0.32, 0.11 * flicker * cabinOn]);
      light = [lit[0], lit[1], z4c.dh * 0.22];
    }
    this.motes.update(dt, t, { vis: cabinOn, w: W, h: H, light, mouse: this.mouse });

    // The octopus: out from behind the chest a third of the way through, sealed by two thirds if no one asks first.
    const oc = this.octopus;
    if (o.fC < -0.2 && oc.state !== 'away') { oc.reset(); this.sealAsked = false; this.sealAt = -1; }
    const home = z4c ? this.spot('z4', z4c, WRECK.chestTop[0], WRECK.chestTop[1]) : [W * 0.8, H * 0.5] as [number, number];
    const size = this.L.octopus * H;
    const hold = this.snap.holds?.top ?? [W * 0.5, H * 0.5];
    const w = size * (media.octopus.w / media.octopus.h);
    // It brings the letter up to his right side, by his eyes, clear of the cards.
    const body = this.L.chainBody * H;
    const meet: [number, number] = [hold[0] + media.snap3d.hi[0] * body + w * 0.4, hold[1] + body * (this.phone ? 0.3 : 0.12)];
    if (oc.state === 'wait' && this.sealAt < 0 && (this.sealAsked || o.fC > 0.72) && this.snap.riding && !this.snap.visiting) {
      // his pincer shuts on the letter a moment into the snap
      this.snap.rider.act(t, 'snap');
      this.sealAt = t + 0.1;
    }
    if (this.sealAt > 0 && t >= this.sealAt) { oc.stamp(t); this.sealAt = -1; this.snap.burst(oc.at.x, oc.at.y, size * 0.4, 3); }
    oc.update(dt, t, { vis: cabinOn, go: o.fC > 0.36 && o.ride, home, meet, size, grade: o.grade, viewH: H, dpr: this.stage.dpr });
    this.out.octo = { x: oc.at.x, y: oc.at.y, s: size, on: oc.at.on && cabinOn > 0.6, busy: oc.state !== 'away' && oc.state !== 'gone' };
    this.out.sealOn = t < oc.sealedAt + 6 && cabinOn > 0.2;
  }

  /**
   * The twilight zone: the visitor's lantern shows the lit plate, the lost
   * fish follows it, the lure's light runs down the chain while the explain
   * card is up, a jellyfish glows past, and at the end warmth rises from below.
   */
  private dusk(dt: number, t: number, o: { twiOn: number; k5: number; warm: number; cover: Cover | null; H: number; W: number }) {
    const { H, W } = o;
    const hold = this.snap.holds?.top ?? [W * 0.5, H * 0.5];
    if (o.k5 < -0.6) this.twilight.reset();
    let lure = false;
    if (o.twiOn > 0.5) {
      const r = document.getElementById('card-explain')?.getBoundingClientRect();
      lure = !!r && r.top < H * 0.7 && r.bottom > H * 0.3;
    }
    const holdArc = this.chain.holdArc(0) ?? 0;
    const lost: [number, number] = o.cover ? this.spot('z5', o.cover, LOST_FISH[0], LOST_FISH[1]) : [W * 0.6, H * 0.7];
    this.twilight.update(dt, t, {
      vis: o.twiOn, k: o.k5, w: W, h: H, mouse: this.mouse, lost, hold, body: this.L.chainBody * H,
      chainAt: (d) => this.chain.at(holdArc - hold[1] + d), chainLen: hold[1], lure,
    });
    const tw = this.twilight.out;
    if (o.cover) this.backdrop.lantern(o.cover, tw.light, o.twiOn, o.warm);
    this.out.twi = { z5: o.cover, win: this.phone ? WRECK_PHONE.z5 : [0, 1], on: o.twiOn, light: tw.light, lure: tw.lure };
    this.out.fishOn = t < tw.homeAt + 6 && o.twiOn > 0.2;
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
    // Leaving the studio: back up on the chain and down into the dark, toward the wreck.
    const exit = smooth(-0.6, 0.3, (y - sec.s4.top) / H);
    const inReef = y >= sec.s3.top && exit < 1;
    const Lr = y < sec.s3b.top - H ? this.reef.camera(kR, F) : lerp(F[5], this.reef.studioEnd(win), smooth(-1, 1.2, kB));
    this.stream(y, H, inReef ? Lr : F[0]);

    // The wreck: the way down to it, in through the hull, the captain's cabin, and the drop.
    const w0 = sec.s4.top + 0.3 * H;                              // the studio has gone dark
    const inWreck = y >= sec.s3.top && exit >= 1;
    const dW = clamp((y - w0) / Math.max(1, sec.t3.top - w0));   // down to the wreck
    const q3 = clamp((y - sec.t3.top) / sec.t3.h);                // through the hull
    const kC = (y - sec.s4b.top) / H;                             // through the cabin
    const fC = (y - sec.s4b.top) / Math.max(1, sec.t4.top - sec.s4b.top);
    const leaving = smooth(-0.5, 0, (y - sec.t4.top) / H);        // out of the cabin, into the dark
    const q4 = clamp((y - sec.t4.top) / sec.t4.h);                // the drop
    const inT3 = inWreck && y >= sec.t3.top, inT4 = inWreck && y >= sec.t4.top;
    // The twilight zone, from the end of the drop to the warm glow of the vents below.
    const k5 = (y - sec.s5.top) / Math.max(1, sec.next.top - sec.s5.top);
    const twiOn = inT4 ? smooth(0.96, 1, q4) : 0;
    const warm = inT4 ? smooth(0.78, 1.15, k5) : 0;
    const cabinOn = inT3 && !inT4 ? clamp(Math.min(smooth(0.9, 1, q3), 1 - leaving)) : 0;

    // Which plates, frames and blends are on screen.
    const fyS0 = lerp(0.2, 0.5, clamp(k / s0h));
    const fyS1 = lerp(0.5, 1, clamp(kS1 / (sec.s1.h / H + 0.45)));
    const fyS2 = lerp(0, 0.5, clamp((y - d0) / (sec.t2.top - d0)));
    let a: SourceKey = 'z0', b: SourceKey = 'z0', mix = 0, dip = 0;
    if (inWreck) {
      if (inT4) {
        if (this.backdrop.seqReady('t4')) {
          a = b = 't4';
          if (q4 > 0.97) { b = 'z5'; mix = smooth(0.97, 1, q4); }
          if (q4 >= 1) { a = b = 'z5'; mix = 0; }
        } else { a = 'z4'; b = 'z5'; mix = smooth(0.1, 0.4, q4); if (q4 >= 0.4) { a = b = 'z5'; mix = 0; } }
      } else if (inT3) {
        if (this.backdrop.seqReady('t3')) {
          a = b = 't3';
          if (q3 < 0.04) { a = 'z4x'; mix = smooth(0, 0.04, q3); }
          if (q3 > 0.97) { b = 'z4'; mix = smooth(0.97, 1, q3); }
          if (q3 >= 1) { a = b = 'z4'; mix = 0; }
        } else { a = 'z4x'; b = 'z4'; mix = smooth(0.25, 0.75, q3); if (q3 >= 1) { a = b = 'z4'; mix = 0; } }
      } else { a = b = 'z4x'; }
    } else if (inT2) {
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
    let z0c: Cover | null = null, z1c: Cover | null = null, z2c: Cover | null = null, t1c: Cover | null = null, z4c: Cover | null = null, z5c: Cover | null = null;
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
      // Down to the wreck the camera tilts from the light above to the ship; in the cabin it pushes in a little.
      const fyW = lerp(0.04, 0.5, smooth(0, 1, dW));
      // Through the twilight zone it sinks toward the seabed.
      const fyT = lerp(0.5, 0.82, smooth(0, 1.1, k5));
      const fyOf = (x: SourceKey) => (x === 'z0' ? fyS0 : x === 'z1' ? fyS1 : x === 'z2' ? fyS2 : x === 'z4x' ? fyW : x === 'z5' ? fyT : 0.5);
      const fxOf = (x: SourceKey) => (x === 'z2' ? L.fxKelp : x === 't2' ? lerp(L.fxKelp, L.fx, q2)
        : x === 'z4x' ? L.fxWreck : x === 't3' ? lerp(L.fxWreck, L.fxCabin, q3) : x === 'z4' ? L.fxCabin : x === 't4' || x === 'z5' ? 0.5 : L.fx);
      // through the hull the camera settles to the cabin's framing, which then pushes in a little
      const overOf = (x: SourceKey) => (x === 'z4' ? L.overCabin + 0.05 * smooth(0, 3, kC) : x === 't3' ? lerp(1.12, L.overCabin, smooth(0.55, 1, q3)) : 1.12);
      const frames = {
        t1: p1 * (media.t1.frames - 1), t2: q2 * (media.t2.frames - 1), t3: q3 * (media.t3.frames - 1),
        t4: T4_FROM + q4 * (media.t4.frames - 1 - T4_FROM),
      };
      const covers = this.backdrop.update(dt, a, b, mix, frames, fyOf(a), fyOf(b), fxOf(a), fxOf(b), overOf(a), overOf(b));
      const coverOf = (z: SourceKey) => (a === z ? covers.a : b === z ? covers.b : null);
      z0c = coverOf('z0'); z1c = coverOf('z1'); z2c = coverOf('z2'); t1c = coverOf('t1'); z4c = coverOf('z4'); z5c = coverOf('z5');
    }
    this.backdrop.playLoops({ z0: k < s0h + 0.2, z1: kS1 > -1.2 && d12 < 1, z2: d12 > 0 && q2 < 0.1, z4: inT3 && q3 > 0.85 && y < sec.t4.top + 0.2 * H });

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
    // The water's surface for the 3D Snap: the marina's waterline, then, through
    // the plunge, where it rises out of the top of the frames. Below it he takes
    // on the water's colour, less as the deep grade takes over.
    const t1On = a === 't1' || b === 't1';
    if (z0c && (!t1On || mix < 0.5)) this.snap.rider.snap3d.setWater(u.uWaterY.value, 1);
    else if (t1c) this.snap.rider.snap3d.setWater(t1c.oy + plungeSurface(p1 * (media.t1.frames - 1)) * t1c.dh, 1 - under);
    else this.snap.rider.snap3d.setWater(null, 0);
    u.uGlint.value = inReef ? 0.55 * (1 - exit) : inWreck ? 0 : s1On;
    u.uShafts.value = inWreck ? 0 : s2On;
    // Through the dark between zones: out of the studio and down to the wreck, out of the cabin and into the drop.
    const dark = inReef ? exit * 0.85
      : !inWreck ? dip
      : inT4 ? 0.8 * (1 - smooth(0, 0.14, q4))
      : inT3 ? 0.8 * leaving
      : 0.85 * (1 - smooth(0, 0.5, dW));
    u.uTintAmt.value = dark;
    this.chain.setWater(under);
    let grade: [number, number, number] = [1 - 0.1 * under - 0.04 * s2On - 0.16 * exit, 1 + 0.01 * under - 0.06 * exit, 1 + 0.04 * under - 0.02 * exit];
    if (inWreck) {
      // Cool and dim outside the wreck, warm by the lantern in the cabin, deep blue in the drop.
      const from = grade, ext = [0.84, 0.95, 1.03], cab = [1.02, 0.93, 0.85], deep = [0.74, 0.86, 1.02];
      const g = (i: number) => lerp(lerp(lerp(from[i], ext[i], smooth(0, 0.6, dW)), cab[i], cabinOn), deep[i], smooth(0.1, 0.8, q4));
      grade = [g(0), g(1), g(2)];
    }

    // The look, previewed on the whole kelp forest.
    const lookName = this.look.preview ?? this.look.picked;
    LOOK.uLookMode.value = LOOKS[lookName];
    LOOK.uLookAmt.value = s2On;

    // The chain: from the boat at the marina, from above the screen below.
    const z0 = z0c ?? this.lastZ0;
    if (z0c) this.lastZ0 = z0c;
    const boat = z0 ? onPlate(z0, L.anchor[0], L.anchor[1]) : [W * 0.68, H * 0.45];
    // In the wreck's cabin the chain hangs a little further left, clear of the desk.
    const chainX = this.phone ? W * 0.1 : lerp(Math.max(W * 0.53, this.cardsRight + W * 0.05), Math.max(W * 0.47, this.cardsRight + W * 0.05), inWreck ? smooth(0.4, 1, q3) * (1 - smooth(0, 0.5, q4)) : 0);
    const chainBody = L.chainBody * H;
    const linkLen = media.snapChain.linkLen * chainBody;
    const holdX = lerp(boat[0], chainX, smooth(0.2, 0.9, p1));
    const holdY = L.holdY * H;

    // Snap on the reef: down the chain to the sand, the walk, and back up on the chain at the end.
    const sc2 = media.snapChain;
    const reefBody = L.reefBody * H;
    const floorY = rc.oy + SPOTS.floor * rc.dh;
    const feetX = (snapU - Lr) * rc.dw;
    const [gripDx, gripDy] = this.snap.use3d ? this.snap.rider.gripFromFeet(chainBody) : [-reefBody * 0.55, 0];
    const clawX = feetX + gripDx;
    const land = smooth(0.08, 0.42, kR);
    const ret = smooth(0.15, 0.4, exit);
    const rise = smooth(0.45, 1, exit);
    const landHy = this.snap.use3d ? floorY + gripDy : floorY - this.snap.rider.below() * chainBody * 0.92;
    // Back on the chain at the end, he rides up to his usual place on it for the way down to the wreck.
    const reefHold: [number, number] = ret > 0
      ? [lerp(clawX, chainX, rise), lerp(landHy, holdY, rise)]
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
      // The 3D Snap holds the chain in his raised claw; the sprite and film at both ends of the stretch painted into them.
      holds = [{ i: 36, x: ride.top[0], y: ride.top[1] }];
      if (ride.bottom) {
        const span = Math.round((sc2.chainBottom - sc2.chainTop) * chainBody / (linkLen * 0.72));
        holds.push({ i: 36 + Math.max(2, Math.min(8, span)), x: ride.bottom[0], y: ride.bottom[1] });
      }
      if (inReef) ax = ride.top[0];
    }
    const shift = -d12 * DESCENT_LINKS;
    this.chain.slide = (-p1 * 26 + shift - q2 * 20 - dW * 16 - q3 * 10 - q4 * 40) * this.chain.pitch;
    // Near the bottom the anchor touches down and the chain goes slack.
    this.chain.update(dt, t, { ax, ay, len: H * 1.1, tail: walking ? H * 0.08 : H * 0.75, holds, sway: sc.v, mouse: this.mouse, visible: true, linkLen, slack: walking ? 0.985 : lerp(1.002, 0.978, warm) });

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
      reef: inReef ? { land, ret, drop: 0, feet: [feetX, floorY], body: reefBody, vel: this.reef.vel, hold: reefHold } : undefined,
    });
    // He caught the chain: it jolts, and (filmed) at the surface the water rings.
    const water = u.uWaterY.value;
    if (this.snap.caught !== this.caughtSeen) {
      this.caughtSeen = this.snap.caught;
      this.chain.kick(18, 36, (Math.random() - 0.5) * 6, 7);
      if (!this.snap.use3d && k < s0h + 0.5 && water < H) this.splashAt(holdX, water, chainBody, t, false);
    }
    // In 3D the splash is where his leap goes through the surface.
    if (this.snap.entered.t !== this.enteredSeen) {
      this.enteredSeen = this.snap.entered.t;
      if (water < H) this.splashAt(this.snap.entered.x, water, chainBody, t, true);
    }

    // Bubbles: the plunge, the drop into the reef, and Snap on fast scrolls.
    if (((p1 > 0.02 && p1 < 0.6) || (q2 > 0.05 && q2 < 0.5 && !inWreck) || (inT3 && q3 > 0.05 && q3 < 0.6) || (inT4 && q4 > 0.05 && q4 < 0.6)) && Math.random() < 0.9) this.bubbles.emit(W * (0.2 + Math.random() * 0.6), H * (0.75 + Math.random() * 0.35), H * 0.012, 3);
    if (ride && !inReef && (p1 > 0.3 || kS1 > -1) && Math.abs(sc.v) > 6 && Math.random() < 0.6) this.bubbles.emit(ride.top[0] + chainBody * 0.3, ride.top[1], H * 0.008);
    if (walking && Math.abs(this.reef.vel) > 400 && Math.random() < 0.25) this.bubbles.emit(feetX + (Math.random() - 0.5) * reefBody * 0.6, floorY - reefBody * 0.1, H * 0.006);
    this.bubbles.update(dt);
    this.splash.update(dt);

    // Tags hang on the chain from the shallows through the kelp, and above Snap on the reef.
    const hung = cabinOn > 0 || twiOn > 0;
    const tagLinks = walking ? REEF_TAGS : hung ? CABIN_TAGS : TAG_LINKS;
    for (const [key, n] of Object.entries(tagLinks) as [keyof typeof TAG_LINKS, number][]) {
      this.out.tags[key] = this.chain.at(this.chain.linkArc(walking || hung ? n : n + shift));
    }
    this.out.tagsOn = walking
      ? smooth(0.45, 0.7, kR) * (1 - ret) * (1 - 0.85 * (this.phone ? Math.max(...(reefOut?.near.slice(1, 5) ?? [0])) : reefOut?.near[2] ?? 0))
      : ride && cabinOn > 0 ? cabinOn
      : ride && twiOn > 0 ? twiOn
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
    const zone: ZoneId = k < s0h ? 's0' : p1 < 1 ? 't1' : d12 < 0.5 ? 's1' : !inT2 ? 's2' : y < sec.s3.top ? 't2'
      : y < sec.s3b.top - 0.5 * H ? 's3' : y < sec.s4.top - 0.2 * H ? 's3b' : !inT3 ? 's4' : q3 < 1 ? 't3' : !inT4 ? 's4b' : q4 < 1 ? 't4'
      : y < sec.next.top - 0.3 * H ? 's5' : 'next';
    this.out.zone = zone;
    // The gauge spins through the drop, slow at first, then fast, then settling at the twilight zone.
    this.out.depth = k < s0h ? 0 : p1 < 1 ? -5 * p1 : !inT2 ? -5 - 10 * d12 : !inWreck ? -15 - 15 * q2
      : !inT4 ? -30 - 30 * smooth(0, 1, dW) : q4 < 1 ? -60 - 440 * easeInOut(q4) : -500 - 500 * smooth(0, 1, k5);
    this.out.storyOn = this.snap.state === 'gust' || this.snap.state === 'surprised' || this.snap.state === 'hop';
    this.out.z1 = z1c;
    this.out.z2 = z2c;
    this.out.s1On = s1On;
    this.out.s2On = s2On;
    this.out.reef = reefOut;

    this.cabin(dt, t, { z4c, cabinOn, fC, grade, ride: !!ride, H, W });
    this.dusk(dt, t, { twiOn, k5, warm, cover: z5c, H, W });
    // A beam from the wreck drifts up past the camera on the way down to it.
    this.debris.update(t, { k: (dW - 0.08) / 0.55, vis: inWreck && !inT3 ? 1 : 0, w: W, h: H, mouse: this.mouse });
    s.render();
  }
}
