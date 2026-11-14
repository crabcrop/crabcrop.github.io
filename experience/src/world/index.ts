import { Stage, onPlate, cover, type Cover } from './stage';
import { Backdrop, PANELS, type SourceKey, type Zone } from './backdrop';
import { Chain, type Hold } from './chain';
import { Snap, type SnapCtx } from './snap';
import { Prop, Glow } from './props';
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
import { Vents } from './vents';
import { SPOTS } from './spots';
import { LOOK, LOOKS, type LookName } from './look';
import { media } from '../media';
import { MAX_DPR, SNAP_TALL } from '../first-view';
import { clamp, lerp, smooth, type Scroll } from '../scroll';

interface Layout {
  /** Horizontal focus of the plates; the kelp has its own, to keep its silk curtains clear of Snap, and so do the wreck outside and its cabin. */
  fx: number; fxKelp: number; fxWreck: number; fxCabin: number; fxVents: number;
  /** How far the cabin plate is drawn past a cover fit: less than elsewhere on wide screens, so the desk sits clear of Snap. */
  overCabin: number;
  feet: readonly [number, number]; body: number;
  anchor: readonly [number, number]; holdY: number; chainBody: number;
  /** The story beat, as shares of the marina's scroll length. */
  gust: number; hop: number;
  /** The octopus in the wreck, in viewport heights. */
  octopus: number;
  /**
   * The plunge pushes in on the marina until its plate is this many viewports
   * tall, down to the sand at the foot of the pier. There the chain ends: the
   * anchor's ring and the sand under it (shares of the marina plate), the
   * anchor's height (viewport heights), where its ring ends up across the
   * screen, and how far to its right Snap lands (in his heights; to its left when negative).
   */
  under: number; ring: readonly [number, number]; sand: number; anchorH: number; ringX: number; landDx: number;
  /** The anchor in the sunset marina's plate, clear of the friends gathered there: its ring and the sand under it. */
  ring7: readonly [number, number]; sand7: number;
  /** Where Snap stands in the shallows and in the kelp forest (shares of their plates). */
  s1Feet: readonly [number, number]; s2Feet: readonly [number, number];
  /**
   * Outside the wreck: where he stands across the screen (to the right of
   * the hole in the hull, so it shows) and the sand there (a share of the
   * plate's height). In the cabin: his spot on the floor, by the desk
   * (shares of the master plate).
   */
  wreckX: number; wreckFloor: number; cabinFeet: readonly [number, number];
  /**
   * The submarine: its length (viewport heights); where its glass bubble
   * sits on screen (shares of the viewport; on wide screens its tail also
   * keeps clear of the cards) moored by the wreck, going down the drop and
   * on the way up, and how low it may come over the geode at the vents; and
   * where it comes up at the pier (its bubble across the sunset marina's plate).
   */
  sub: number;
  at: Record<'wreck' | 'deep' | 'up', readonly [number, number]> & { vents: number };
  moor7: number;
}

/** Where things sit, in plate coordinates (0 to 1), per layout. */
const LAYOUT: Record<'wide' | 'phone', Layout> = {
  wide: {
    fx: 0.62, fxKelp: 0.5, fxWreck: 0.38, fxCabin: 0.45, overCabin: 1.04, fxVents: 0.36,
    feet: [0.795, 0.345], body: 0.125,               // Snap on the right pier
    anchor: [0.655, 0.47],                           // the chain leaves the boat's stern
    holdY: 0.56, chainBody: SNAP_TALL.wide,                    // riding: his top hold, his height (viewport heights)
    gust: 0.35, hop: 0.64,
    octopus: 0.13,
    under: 2.7, ring: [0.632, 0.873], sand: 0.957, anchorH: 0.26, ringX: 0.62, landDx: -1.2,
    ring7: [0.615, 0.873], sand7: 0.957,
    s1Feet: [0.6, 0.9], s2Feet: [0.56, 0.85],
    wreckX: 0.83, wreckFloor: 0.9, cabinFeet: [0.47, 0.9],
    sub: 0.41, at: { wreck: [0.86, 0.35], deep: [0.75, 0.5], up: [0.5, 0.38], vents: 0.56 }, moor7: 0.762,
  },
  phone: {
    fx: 0.5, fxKelp: 0.5, fxWreck: 0.5, fxCabin: 0.5, overCabin: 1.12, fxVents: 0.5,
    feet: [0.37, 0.236], body: 0.085,
    anchor: [0.2, 0.27],
    holdY: 0.66, chainBody: SNAP_TALL.phone,
    gust: 0.62, hop: 0.8,                            // after the tall hero card has scrolled away
    octopus: 0.1,
    under: 2.4, ring: [0.2, 0.845], sand: 0.935, anchorH: 0.24, ringX: 0.36, landDx: 0.92,
    ring7: [0.183, 0.891], sand7: 0.978,
    s1Feet: [0.4, 0.9], s2Feet: [0.44, 0.86],
    wreckX: 0.3, wreckFloor: 0.9, cabinFeet: [0.61, 0.9],
    sub: 0.3, at: { wreck: [0.675, 0.42], deep: [0.675, 0.62], up: [0.6, 0.4], vents: 0.56 }, moor7: 0.66,
  },
};

/**
 * The plunge, as shares of its scroll length: the push down the marina's
 * picture to the sand ends at DESC, Snap is off the chain and on the sand a
 * little later, and from WALK he walks to the shallows. Each walk moves the
 * camera TRAVEL viewport widths to the right.
 */
const DESC = 0.5, LAND = 0.09, WALK = 0.62, TRAVEL = 1.2;
/** The colour of the water under the sunset marina, darker and bluer than the morning's: Snap and the submarine take it on below the surface. */
const SEA_DUSK: [number, number, number] = [0.1, 0.34, 0.42];

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
const WRECK_PHONE = { z4x: [0.38, 0.62], z4: [0.54, 0.78], z5: [0.52, 0.76], z6: [0.42, 0.66] } as const;
/** At the vents: the geode's middle and height (shares of the master plate). */
const VENTS = { geode: [0.5, 0.775] as const, geodeH: 0.29 };
/** In the twilight zone, where the lost fish waits (a share of the master plate). */
const LOST_FISH = [0.6, 0.76] as const;
/**
 * The way out of the cabin, as shares of its scroll length: first the hull
 * film again, backwards (out through the hole, to the wreck seen from
 * outside), for OUT of it; a pause on that view while Snap gets into the
 * submarine, until DROP; then the drop, from its first frames, which are
 * that same view.
 */
const OUT = 0.3, DROP = 0.42, T4_FROM = 1;
/** How far out through the hull (0 to 1) Snap sets off for the submarine. */
const BOARD = 0.8;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
/** The larger of a and b, rounded off where they cross (over w either side). */
const softMax = (a: number, b: number, w: number) => {
  const d = b - a;
  return w < 1e-3 ? Math.max(a, b) : a + (d > w ? d : d < -w ? 0 : ((d + w) * (d + w)) / (4 * w));
};

export type ZoneId = 's0' | 't1' | 's1' | 's2' | 't2' | 's3' | 's3b' | 's4' | 't3' | 's4b' | 't4' | 's5' | 's6' | 't5' | 's7';

export interface WorldOut {
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
  /** The wreck's cabin: its plate on screen, how much it is on, and the octopus waiting with its letter (for its button). */
  z4: Cover | null;
  cabinOn: number;
  octo: { x: number; y: number; s: number; on: boolean; busy: boolean };
  /** The story of the octopus's letter, after Snap has sealed it. */
  sealOn: boolean;
  /**
   * The twilight zone: its plate on screen and the phone window of the
   * master plate it shows, how much it is on, and the lantern's light (x, y,
   * radius px).
   */
  twi: { z5: Cover | null; win: readonly [number, number]; on: number; light: [number, number, number] };
  /** The story of the lost fish, once it has gone home with Snap. */
  fishOn: boolean;
  /** The story of the submarine, for a while after Snap has got in. */
  boardOn: boolean;
  /** The vents: the plate on screen, how much it is on, and whether Snap has his print. */
  vents: { z6: Cover | null; on: number; taken: boolean };
  /**
   * The way up: how much of the ascent is on and how far through it, where
   * the submarine's pincer is (the print hangs from it), how far the surface
   * has been revealed, and when Snap took the finale's picture.
   */
  ascent: { on: number; q: number; at: [number, number]; reveal: number; flashAt: number };
}

/** Zones that own a plate, for checking shared files before dropping one. */
const PLATE_ZONES = new Set<string>(['z0', 'z1', 'z2', 'z3', 'r3c', 'z4x', 'z4', 'z5', ...PANELS]);

export class World {
  readonly stage: Stage;
  private backdrop: Backdrop;
  /** The anchor chain, from the boat's stern to the anchor on the sand: Snap rides it down. */
  private chain: Chain;
  private anchor: Prop;
  private post: Prop;
  /** The submarine moored by the wreck: Snap gets in there and rides inside its glass bubble, down to the vents and up to the pier. */
  private sub: Prop;
  /** Its lamp's light, where the water is dark. */
  private beam: Glow;
  /** Its tilt (radians, nose down positive), eased; when it last nudged forward (to pick up the print). */
  private pitch = 0;
  private lungeAt = -10;
  /** Once Snap is home on the pier it sinks away (0 to 1); since when he has been home. */
  private subSunk = 0;
  private homeAt = -1;
  private boardedSeen = -10;
  private boardUntil = 0;
  private wasAboard = false;
  /** How fast Snap walks between places (px a second), from the camera's travel. */
  private walkVel = 0;
  private lastCam = NaN;
  private onSand = false;
  private touchedSeen = -10;
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
  private vents: Vents;
  /** When the submarine settled over the geode (it picks up the print a moment later), whether Snap has it, and since when. */
  private ventsLanded = -1;
  private printTaken = false;
  private takenAt = -10;
  /** The finale's picture has been taken (once per visit to the surface). */
  private flashed = false;
  /** The lantern's swing (radians, foot to the right) and its speed. */
  private lamp = { a: 0, v: 0 };
  /** The visitor asked Snap to seal the letter; when his pincer shuts on it. */
  private sealAsked = false;
  private sealAt = -1;
  readonly phone: boolean;
  private L: Layout;
  mouse: [number, number] | null = null;
  private cardsRight = 0;
  private look: { picked: LookName; preview: LookName | null } = { picked: 'crisp', preview: null };
  private freeAsked = false;
  private kindUntil = 0;
  private t = 0;
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
    this.stage = new Stage(canvas, MAX_DPR);
    this.backdrop = new Backdrop(this.stage, phone);
    this.chain = new Chain(this.stage);
    this.chain.fixed = true;
    this.anchor = new Prop(this.stage, 'anchor', 4, { grade: [0.86, 0.96, 0.98], haze: 0.16 });
    this.post = new Prop(this.stage, 'post', 9, { grade: [0.72, 0.84, 0.86], haze: 0.1, water: [0.05, 0.25, 0.3] });
    this.sub = new Prop(this.stage, 'sub', 4.5, { water: [0.05, 0.25, 0.3] });
    this.beam = new Glow(this.stage, 5.6);
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
    this.vents = new Vents(this.stage, phone);
    this.out = {
      z1: null, z2: null,
      s1On: 0, s2On: 0, depth: 0, zone: 's0', storyOn: false, kindOn: false,
      fish: { x: -999, y: -999, on: false }, reef: null, perch: null,
      z4: null, cabinOn: 0, octo: { x: -999, y: -999, s: 0, on: false, busy: false }, sealOn: false,
      twi: { z5: null, win: [0, 1], on: 0, light: [-999, -999, 1] }, fishOn: false, boardOn: false,
      vents: { z6: null, on: 0, taken: false },
      ascent: { on: 0, q: 0, at: [-999, -999], reveal: 0, flashAt: -10 },
    };
    this.measure();
  }

  measure() {
    const cards = document.querySelector('.s1 .cards')?.getBoundingClientRect();
    this.cardsRight = cards ? cards.right : 0;
  }

  resize() { this.stage.resize(); this.measure(); }

  /** The page is hidden: what plays stops (the loops start again with the next frame drawn). */
  rest() { this.snap.pause(); this.backdrop.playLoops({}); }

  /** The marina first; everything else loads as the visitor nears it. */
  async load() {
    this.wants.add('z0');
    await this.backdrop.loadPlate('z0');
    await this.snap.load(this.L.chainBody * this.stage.h * this.stage.dpr).catch(() => {});
    // The first view is up: now the shaders of every layer further down, before the visitor gets there.
    this.stage.warm();
    this.backdrop.loadLoop('z0').catch(() => {});
    await this.snap.loadRest().catch(() => {});
    // what waits at the foot of the pier: the anchor, a pier post, the plate's sharper underwater half
    for (const p of [this.anchor, this.post]) p.load().catch(() => {});
    this.heroUp = true;
  }

  /** The first view (the marina's plate and Snap) is loaded: what the plunge needs may load now. */
  private heroUp = false;

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
  /** A stretch of scroll (from, to) that scrubs a transition from frame first to frame last: within reach of either end, that end's frames are made ready. */
  private soon(k: 't2' | 't3' | 't4', y: number, H: number, from: number, to: number, first: number, last: number) {
    const reach = 0.6 * H, up = last > first ? 1 : -1;
    if (y < from && y > from - reach) this.backdrop.prime(k, first, up);
    else if (y > to && y < to + reach) this.backdrop.prime(k, last, up > 0 ? -1 : 1);
  }
  private stream(y: number, H: number, Lr: number) {
    const sec = this.scroll.sec;
    const d0 = sec.s2.top - 1.45 * H;
    if (y > 0.95 * H) this.want('fish', () => this.fish.load());
    if (y > sec.s1.top + 0.4 * H) {
      this.want('kelp', () => this.kelp.load());
      this.want('net', () => this.net.load());
    }
    if (y > sec.s2.top - 0.2 * H) this.want('t2', () => this.backdrop.loadSequence('t2'));
    const reefSoon = y > sec.t2.top - 0.5 * H;
    if (reefSoon) this.want('coral', () => this.reef.load());
    this.resident('z0', y < sec.t1.top + sec.t1.h + 0.5 * H);
    // (the sharper underwater half is for the plunge: it waits for the first view, unless the visitor is already on the way down)
    this.resident('z0u', (this.heroUp || y > 0.3 * H) && y < sec.t1.top + sec.t1.h + 0.5 * H);
    this.resident('z1', y > 0.95 * H && y < d0 + 1.6 * H);
    this.resident('z2', y > sec.s1.top + 0.4 * H && y < sec.s3.top + 0.5 * H);
    this.resident('z3', y > sec.s2.top + 0.6 * H && y < sec.s3.top + 0.5 * H);
    const inReef = y > sec.s3.top - H;
    this.resident('r0', reefSoon && Lr < 1.4);
    this.resident('r1', y > sec.t2.top + 0.3 * sec.t2.h && Lr < 2.7);
    this.resident('r2', inReef && Lr > 0.5 && Lr < 3.7);
    this.resident('r3', inReef && Lr > 1.5 && Lr < 4.7);
    this.resident('r3c', inReef && Lr > 1.5 && Lr < 4.7);
    const walkW = y > sec.s3b.top && y < sec.t3.top + H;             // the walk from the studio to the wreck is near
    this.resident('r4', (inReef && Lr > 2.5) || walkW);
    this.resident('r5', walkW);
    // The wreck: outside, the cabin and its octopus, the drop, and the twilight zone it ends on.
    if (y > sec.s3b.top) this.want('t3', () => this.backdrop.loadSequence('t3'));
    if (y > sec.s3b.top) this.want('sub', () => this.sub.load());
    if (y > sec.s4.top) this.want('octopus', () => this.octopus.load());
    if (y > sec.s3b.top + H) this.want('beam', () => this.debris.load());
    if (y > sec.s4b.top + 0.5 * H) this.want('t4', () => this.backdrop.loadSequence('t4'));
    // A transition the scroll is about to reach has the frames it will want
    // first decoded before it gets there: each stretch of scroll that scrubs
    // one, with the frames it starts and ends on.
    const t4 = sec.t4.top, n2 = media.t2.frames - 1, n3 = media.t3.frames - 1, n4 = media.t4.frames - 1;
    this.soon('t2', y, H, sec.t2.top, sec.t2.top + sec.t2.h, 0, n2);
    this.soon('t3', y, H, sec.t3.top, sec.t3.top + sec.t3.h, 0, n3);
    this.soon('t3', y, H, t4, t4 + OUT * sec.t4.h, n3, 0);
    this.soon('t4', y, H, t4 + DROP * sec.t4.h, t4 + sec.t4.h, 0, n4);
    this.resident('z4x', y > sec.s3b.top && y < sec.s4b.top + 0.5 * H);
    this.resident('z4', y > sec.s4.top && y < sec.t4.top + 0.6 * H);
    this.resident('z5', y > sec.s4b.top + H);
    // The twilight zone: its lit plate for the lantern, the lost fish and the glowing jellyfish.
    if (y > sec.t4.top) this.want('twilight', () => this.twilight.load());
    this.resident('z5lit', y > sec.t4.top + 0.5 * sec.t4.h && y < sec.s6.top + H);
    // The vents: the plate and its loop, the print and the tube worms.
    if (y > sec.s5.top + H) this.want('vents', () => this.vents.load());
    this.resident('z6', y > sec.s6.top - 2 * H && y < sec.s7.top);
    // The surface at sunset.
    this.resident('z7', y > sec.t5.top - H);
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
  /** Choices 1 to 4: the visitor picked a part of their URL, and Snap clicks his claw at it, if he is on his own. */
  noteChoice() { if (this.snap.riding && !this.snap.visiting && !this.snap.rider.spinning) this.snap.rider.act(this.t, 'snap'); }
  /** Choice 5 was made: sealing the URL, Snap snaps his claw; readable, he waves. */
  sealUrl(sealed: boolean) { if (this.snap.riding && !this.snap.visiting) this.snap.rider.act(this.t, sealed ? 'snap' : 'wave'); }
  /** Is a screen point on Snap (for a click or tap)? */
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
    const hold = this.snap.grip ?? [W * 0.5, H * 0.5];
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
   * fish follows it and then keeps the submarine company, a jellyfish glows
   * past, and at the end warmth rises from below.
   */
  private dusk(dt: number, t: number, o: { twiOn: number; k5: number; warm: number; cover: Cover | null; side: [number, number]; H: number; W: number }) {
    const { H, W } = o;
    if (o.k5 < -0.6) this.twilight.reset();
    const lost: [number, number] = o.cover ? this.spot('z5', o.cover, LOST_FISH[0], LOST_FISH[1]) : [W * 0.6, H * 0.7];
    this.twilight.update(dt, t, { vis: o.twiOn, k: o.k5, w: W, h: H, mouse: this.mouse, lost, side: o.side });
    const tw = this.twilight.out;
    if (o.cover) this.backdrop.lantern(o.cover, tw.light, o.twiOn, o.warm);
    this.out.twi = { z5: o.cover, win: this.phone ? WRECK_PHONE.z5 : [0, 1], on: o.twiOn, light: tw.light };
    this.out.fishOn = t < tw.homeAt + 6 && o.twiOn > 0.2;
  }

  frame(dt: number, t: number) {
    this.t = t;
    const s = this.stage, H = s.h, W = s.w, L = this.L;
    const sc = this.scroll, sec = sc.sec, y = sc.y;
    const k = y / H;
    const s0h = sec.s0.h / H;

    // The plunge: the push down the marina's picture (desc), off the chain onto the sand (landK), the walk to the shallows (wk).
    const p1 = clamp((y - sec.t1.top) / sec.t1.h);
    const desc = easeInOut(clamp(p1 / DESC));
    const landK = smooth(DESC, DESC + LAND, p1);
    const wk = smooth(WALK, 1, p1);
    const kS1 = (y - sec.s1.top) / H;                             // into the shallows
    const d0 = sec.s2.top - 1.45 * H;                             // the shallows' last card has gone
    const d12 = smooth(0, 1, (y - d0) / H);                       // the walk into the kelp
    const kS2 = (y - sec.s2.top) / H;
    const q2 = clamp((y - sec.t2.top) / sec.t2.h);               // into the reef
    const inT2 = y >= sec.t2.top;

    // The reef: pinned sideways travel, then the studio, then the walk on to the wreck.
    const reefMeta = media.plates.z3;
    const rc = cover(reefMeta.w, reefMeta.h, W, H, 1.12, 0, 0.5);
    const win = W / rc.dw;
    const F = this.reef.framings(win);
    const pin = Math.max(1, sec.s3.h - H);
    const kR = clamp((y - sec.s3.top) / pin) * REEF_UNITS;
    const kB = (y - sec.s3b.top) / H;
    // Past the studio the camera travels on, by the last coral, to the wreck:
    // its plate is the panorama's last panel, and the walk ends framed as that
    // plate is when it is on its own.
    const wW = smooth(-0.35, 0.6, (y - sec.s4.top) / H);
    const inReef = y >= sec.s3.top && wW < 1;
    const wreckL = this.phone ? 5.5 - win / 2 : 5 + (1 - win) * L.fxWreck;
    const Lstudio = y < sec.s3b.top - H ? this.reef.camera(kR, F) : lerp(F[5], this.reef.studioEnd(win), smooth(-1, 1.2, kB));
    const Lr = lerp(Lstudio, wreckL, wW);
    this.stream(y, H, inReef ? Lr : F[0]);

    // The wreck: in through the hull, the captain's cabin, and the drop.
    const inWreck = y >= sec.s3.top && wW >= 1;
    const q3 = clamp((y - sec.t3.top) / sec.t3.h);                // through the hull
    const kC = (y - sec.s4b.top) / H;                             // through the cabin
    const fC = (y - sec.s4b.top) / Math.max(1, sec.t4.top - sec.s4b.top);
    const p4 = clamp((y - sec.t4.top) / sec.t4.h);                // the way out of the cabin, all of it
    const out3 = clamp(p4 / OUT);                                 // back out through the hull
    const q4 = clamp((p4 - DROP) / (1 - DROP));                   // the drop
    // (how near the drop is, from the moment he sets off for the submarine: he is in his seat before it starts, however fast the scroll)
    const hurry = clamp((p4 - OUT * BOARD) / (DROP - 0.03 - OUT * BOARD));
    const inT3 = inWreck && y >= sec.t3.top, inT4 = inWreck && y >= sec.t4.top;
    // How far into the hull film the view is: 0 outside the wreck, 1 in the cabin (it plays backwards on the way out).
    const f3 = inT4 ? 1 - easeInOut(out3) : q3;
    // The twilight zone, from the end of the drop to the warm glow of the vents below.
    const k5 = (y - sec.s5.top) / Math.max(1, sec.s6.top - sec.s5.top);
    // The vents: through a warm dark out of the twilight, then down to the floor by the geode.
    const u6 = (y - sec.s6.top) / H;
    // The way up: off the floor at the vents; the express ascent; and home at the surface, revealed as the camera pulls back.
    const u5 = (y - sec.t5.top) / H;
    const q5 = clamp((y - sec.t5.top) / sec.t5.h);
    const pushOff = inT4 ? smooth(-0.55, 0.05, u5) : 0;
    const inAscent = inT4 && y >= sec.t5.top && q5 >= 0.07;
    const bands = inT4 && y >= sec.t5.top ? smooth(0, 0.065, q5) * (1 - smooth(0.84, 0.97, q5)) : 0;
    const k7 = (y - sec.s7.top) / H;
    const reveal = inAscent ? smooth(-0.3, 1.0, k7) : 0;
    const inVents = inT4 && u6 >= -0.4 && !inAscent;
    const ventsOn = inVents ? smooth(-0.4, -0.15, u6) : 0;
    const twiOn = inT4 ? smooth(0.96, 1, q4) * (1 - smooth(-0.6, -0.4, u6)) : 0;
    const warm = inT4 && !inVents ? smooth(0.78, 1.15, k5) : 0;
    const cabinOn = !inT3 ? 0 : !inT4 ? smooth(0.9, 1, q3) : 1 - smooth(0, 0.06, out3);

    // Snap's size riding, walking and swimming, and from the middle of his feet to his raised claw.
    const chainBody = L.chainBody * H;
    const [gripDx, gripDy] = this.snap.use3d ? this.snap.rider.gripFromFeet(chainBody) : [-chainBody * 0.42, 0];
    // On wide screens his raised claw keeps clear of the cards' column, wherever the plate would put him.
    const clearX = this.phone ? -1e9 : this.cardsRight + W * 0.05 - gripDx;

    // Which plates, frames and blends are on screen.
    const fyS0 = lerp(0.2, 0.5, clamp(k / s0h));
    const fyS1 = lerp(0.5, 1, clamp(kS1 / (sec.s1.h / H + 0.45)));
    const fyS2 = lerp(0, 0.5, clamp((y - d0) / (sec.t2.top - d0)));
    // The opening: the marina, the plunge down its picture to the sand at the
    // foot of the pier, and two walks, the camera travelling sideways from one
    // plate to the next (to the shallows, then into the kelp).
    const opening = !inReef && !inWreck && !inT2;
    const inPlunge = opening && k >= s0h && p1 < 1;
    const inJoin = opening && p1 >= 1 && d12 > 0 && d12 < 1;
    const m0 = this.backdrop.plateMeta('z0'), m1 = this.backdrop.plateMeta('z1'), m2 = this.backdrop.plateMeta('z2');
    const c1 = cover(m1.w, m1.h, W, H, 1.12, L.fx, fyS1), c2 = cover(m2.w, m2.h, W, H, 1.12, L.fxKelp, fyS2);
    // The marina's plate: the hero's framing, pushed in on and down until the anchor's ring is where the chain will hang.
    const fit0 = Math.max(W / m0.w, H / m0.h);
    const c0s = cover(m0.w, m0.h, W, H, 1.12, L.fx, fyS0);
    const dwE = m0.w * fit0 * L.under, dhE = m0.h * fit0 * L.under;
    const ringAt = this.phone ? L.ringX * W : Math.max(L.ringX * W, this.cardsRight + W * 0.07);
    const over0 = 1.12 * Math.pow(L.under / 1.12, desc);
    const dw0 = m0.w * fit0 * over0, dh0 = m0.h * fit0 * over0;
    const cu0 = lerp((W / 2 - c0s.ox) / c0s.dw, L.ring[0] - (ringAt - W / 2) / dwE, desc);
    const cv0 = lerp((H / 2 - c0s.oy) / c0s.dh, 1 - H / 2 / dhE, desc);
    const shift1 = wk * TRAVEL * W, shift2 = d12 * TRAVEL * W;     // how far the camera has travelled on each walk, px
    const c0: Cover = { ox: clamp(W / 2 - cu0 * dw0, W - dw0, 0) - shift1, oy: clamp(H / 2 - cv0 * dh0, H - dh0, 0), dw: dw0, dh: dh0 };
    let a: SourceKey = 'z0', b: SourceKey = 'z0', mix = 0;
    if (inWreck) {
      if (inT4) {
        if (inAscent) { a = b = 'z7'; }
        else if (inVents) { a = b = 'z6'; }
        else if (out3 < 1 && this.backdrop.seqReady('t3')) {
          // back out through the hull: from the cabin's plate into the film, and at its first frame on into the drop
          a = b = 't3';
          if (out3 < 0.06) { a = 'z4'; mix = smooth(0, 0.06, out3); }
          if (out3 > 0.94 && this.backdrop.seqReady('t4')) { b = 't4'; mix = smooth(0.94, 1, out3); }
        } else if (this.backdrop.seqReady('t4')) {
          a = b = 't4';
          if (out3 < 1) { a = 'z4'; mix = smooth(0.2, 0.8, out3); }   // without the hull film: a dissolve
          if (q4 > 0.97) { b = 'z5'; mix = smooth(0.97, 1, q4); }
          if (q4 >= 1) { a = b = 'z5'; mix = 0; }
        } else { a = 'z4'; b = 'z5'; mix = smooth(0.2, 0.8, p4); if (p4 >= 0.8) { a = b = 'z5'; mix = 0; } }
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
    } else if (d12 >= 1) { a = b = 'z2'; }
    else if (p1 >= 1) { a = b = 'z1'; }
    let z0c: Cover | null = null, z1c: Cover | null = null, z2c: Cover | null = null, z4c: Cover | null = null, z5c: Cover | null = null, z6c: Cover | null = null, z7c: Cover | null = null;
    // Where the two places meet across the screen while the camera travels between them, else null.
    let seam: number | null = null;
    // Snap's spot on the reef, in panels: he keeps his place on screen while
    // the camera travels, walks to his mark in the studio, and on the way to
    // the wreck keeps a steady way across the screen to where he stands there.
    const snapU0 = lerp(Lstudio + this.reef.snapAt() * win, this.reef.studioSpot(), smooth(-0.8, 0.6, kB));
    const xWreck = this.phone ? L.wreckX * W : Math.max(L.wreckX * W, clearX);
    const snapU = Lr + lerp((snapU0 - Lstudio) * rc.dw, xWreck, wW) / rc.dw;
    let reefOut: ReefOut | null = null;
    if (inReef) {
      // the water is murky where the reef ends: thickest as the join crosses the screen, gone at both ends of the walk
      const haze = 0.78 * smooth(0, 0.25, wW) * (1 - smooth(0.75, 1, wW));
      const r = this.reef.update(dt, t, { L: Lr, k: kR, W, H, dw: rc.dw, dh: rc.dh, oy: rc.oy, F, snapU, mouse: this.mouse, on: true, haze, dim: smooth(0.15, 0.6, wW) });
      this.backdrop.updateReef(r.view);
      reefOut = r.out;
    } else if (inPlunge) {
      this.reef.hide();
      z0c = c0;
      // The plate's underwater half again, sharper, laid exactly over it: it takes over once the view is inside it.
      const [ru0, rv0, ru1, rv1] = this.backdrop.plateMeta('z0u').rect ?? [0, 0, 1, 1];
      const cu: Cover = { ox: c0.ox + ru0 * c0.dw, oy: c0.oy + rv0 * c0.dh, dw: (ru1 - ru0) * c0.dw, dh: (rv1 - rv0) * c0.dh };
      const sharp = this.backdrop.has('z0u');
      if (wk <= 0) {
        const inside = Math.min(ru0 > 0 ? -cu.ox : 1e9, rv0 > 0 ? -cu.oy : 1e9, ru1 < 1 ? cu.ox + cu.dw - W : 1e9, rv1 < 1 ? cu.oy + cu.dh - H : 1e9);
        this.backdrop.drawPair(dt, 'z0', 'z0u', c0, cu, sharp ? smooth(0, H * 0.06, inside) : 0, null);
      } else {
        // The walk to the shallows: the foot of the pier slides off to the left and the shallows come in from the right.
        seam = W * 1.1 - shift1;
        z1c = { ...c1, ox: c1.ox + TRAVEL * W - shift1 };
        this.backdrop.drawPair(dt, sharp ? 'z0u' : 'z0', 'z1', sharp ? cu : c0, z1c, 0, seam);
      }
    } else if (inJoin) {
      // The walk into the kelp: the shallows slide off to the left, the forest comes in from the right.
      this.reef.hide();
      seam = W * 1.1 - shift2;
      z1c = { ...c1, ox: c1.ox - shift2 };
      z2c = { ...c2, ox: c2.ox + TRAVEL * W - shift2 };
      this.backdrop.drawPair(dt, 'z1', 'z2', z1c, z2c, 0, seam);
    } else {
      this.reef.hide();
      // The wreck from outside is framed as the walk there left it.
      const fyW = 0.5;
      // Through the twilight zone it sinks toward the seabed.
      const fyT = lerp(0.5, 0.82, smooth(0, 1.1, k5));
      // At the vents it sinks to the floor and the geode.
      const fyV = lerp(0.22, 0.62, smooth(-0.4, 1.3, u6));
      const fyOf = (x: SourceKey) => (x === 'z0' ? fyS0 : x === 'z1' ? fyS1 : x === 'z2' ? fyS2 : x === 'z4x' ? fyW : x === 'z5' ? fyT : x === 'z6' ? fyV : x === 'z7' ? lerp(0.97, 0.22, reveal) : 0.5);
      // through the hull the camera settles to the cabin's framing, which then pushes in a little; on the way out
      // the film ends where the drop begins, in the middle
      const overCabin = L.overCabin + 0.05 * smooth(0, 3, kC);
      const fxOf = (x: SourceKey) => (x === 'z2' ? L.fxKelp : x === 't2' ? lerp(L.fxKelp, L.fx, q2)
        : x === 'z4x' ? L.fxWreck : x === 't3' ? lerp(inT4 ? 0.5 : L.fxWreck, L.fxCabin, f3) : x === 'z4' ? L.fxCabin : x === 't4' || x === 'z5' ? 0.5 : x === 'z6' ? L.fxVents : x === 'z7' ? lerp(0.62, L.fx, reveal) : L.fx);
      const overOf = (x: SourceKey) => (x === 'z4' ? overCabin : x === 't3' ? lerp(1.12, overCabin, smooth(0.55, 1, f3)) : x === 'z7' ? lerp(2.3, 1.12, reveal) : 1.12);
      const frames = {
        t2: q2 * (media.t2.frames - 1), t3: f3 * (media.t3.frames - 1),
        t4: T4_FROM + q4 * (media.t4.frames - 1 - T4_FROM),
      };
      const covers = this.backdrop.update(dt, a, b, mix, frames, fyOf(a), fyOf(b), fxOf(a), fxOf(b), overOf(a), overOf(b));
      const coverOf = (z: SourceKey) => (a === z ? covers.a : b === z ? covers.b : null);
      z0c = coverOf('z0'); z1c = coverOf('z1'); z2c = coverOf('z2'); z4c = coverOf('z4'); z5c = coverOf('z5'); z6c = coverOf('z6'); z7c = coverOf('z7');
    }
    this.backdrop.tidy();
    this.backdrop.playLoops({ z0: k < s0h + 0.2, z1: p1 > WALK - 0.05 && d12 < 1, z2: d12 > 0 && q2 < 0.1, z4: inT3 && q3 > 0.85 && y < sec.t4.top + 0.2 * H, z6: inVents, z7: inAscent && q5 > 0.8 });

    // Visibility of each zone's layers.
    // The shallows' layers come on as the walk there ends and go as the next one starts; the kelp's once the forest fills the view.
    const s1On = clamp(Math.min(smooth(0.6, 0.97, wk), 1 - smooth(0.02, 0.5, d12)));
    const s2On = clamp(Math.min(smooth(0.72, 1, d12), 1 - smooth(0.02, 0.35, q2)));

    // Effects by zone.
    const under = smooth(0.04, 0.34, p1);
    const u = this.backdrop.u;
    u.uTime.value = t;
    u.uMouseOn.value = this.mouse ? 1 : 0;
    if (this.mouse) u.uMouse.value.set(this.mouse[0], this.mouse[1]);
    u.uRipple.value = (opening && k < s0h) || (a === 'z7' && b === 'z7' && reveal > 0.95) ? 1 : 0;
    u.uWaterY.value = z0c ? onPlate(z0c, 0, this.backdrop.plateMeta('z0').waterline ?? 0.58)[1]
      : z7c && reveal > 0.5 ? onPlate(z7c, 0, this.backdrop.plateMeta('z7').waterline ?? 0.58)[1] : 1e5;
    // The water's surface for the 3D Snap: the marina's waterline, which
    // rises out of the top of the view through the plunge. Below it he takes
    // on the water's colour, less as the deep grade takes over.
    // Back at the surface it is the sunset marina's, coming into view as the camera pulls back.
    const wl7 = z7c ? onPlate(z7c, 0, this.backdrop.plateMeta('z7').waterline ?? 0.58)[1] : null;
    const sea = wl7 === null ? 0 : smooth(0.3, 0.6, reveal);
    // (inside the submarine's bubble he takes on less of it: he should stay his own red behind the glass)
    if (z0c) this.snap.rider.snap3d.setWater(u.uWaterY.value, 1 - under);
    else if (wl7 !== null && sea > 0) this.snap.rider.snap3d.setWater(wl7, sea * (this.snap.inside ? 0.45 : 1), SEA_DUSK);
    else this.snap.rider.snap3d.setWater(null, 0);
    u.uGlint.value = inReef ? 0.55 * (1 - wW) : inWreck ? 0 : s1On;
    u.uShafts.value = inWreck ? 0 : s2On;
    // Through the dark between zones: out of the twilight and down to the vents.
    const dark = !inWreck || inAscent ? 0
      : inT4 && q4 >= 1 ? (inVents ? 0.9 * (1 - smooth(-0.4, 0.35, u6)) : 0.9 * smooth(-1.1, -0.4, u6))
      : 0;
    u.uTintAmt.value = dark;
    // the dark between zones is wreck teal, except on the way into the vents, where it is ember
    if (inT4 && q4 >= 1 && u6 > -1.3) u.uTint.value.set(0.1, 0.035, 0.015); else u.uTint.value.set(0.05, 0.23, 0.24);
    u.uShimmer.value = ventsOn;
    this.backdrop.ascent(bands, q5);
    this.chain.setWater(under);
    let grade: [number, number, number] = [1 - 0.1 * under - 0.04 * s2On, 1 + 0.01 * under, 1 + 0.04 * under];
    if (inReef || inWreck) {
      // Cooler and dimmer on the way to the wreck and outside it, warm by the lantern in the cabin, deep blue in the drop.
      const from = grade, ext = [0.84, 0.95, 1.03], cab = [1.02, 0.93, 0.85], deep = [0.74, 0.86, 1.02];
      const g = (i: number) => lerp(lerp(lerp(from[i], ext[i], wW), cab[i], cabinOn), deep[i], smooth(0.1, 0.8, q4));
      // warm by the vents' fires
      const vent = [1.08, 0.95, 0.85];
      grade = [lerp(g(0), vent[0], ventsOn), lerp(g(1), vent[1], ventsOn), lerp(g(2), vent[2], ventsOn)];
      // and at the surface, the sunset's
      if (inAscent) { const sun = [1.05, 0.97, 0.93], f = smooth(0.7, 1, q5); grade = [lerp(grade[0], sun[0], f), lerp(grade[1], sun[1], f), lerp(grade[2], sun[2], f)]; }
    }

    // The look, previewed on the whole kelp forest.
    const lookName = this.look.preview ?? this.look.picked;
    LOOK.uLookMode.value = LOOKS[lookName];
    LOOK.uLookAmt.value = s2On;

    // The anchor chain: from the boat's stern down to the anchor on the sand at the foot of the pier.
    const z0 = z0c ?? c0;
    const stern = onPlate(z0, L.anchor[0], L.anchor[1]), ring = onPlate(z0, L.ring[0], L.ring[1]);
    const sandY = onPlate(z0, 0, L.sand)[1];
    // Past the opening, where he swims (with a film that glides into a place), he swims here.
    const chainX = this.phone ? W * 0.1 : Math.max(W * 0.53, this.cardsRight + W * 0.05);
    const linkLen = media.snapChain.linkLen * chainBody;
    const holdY = L.holdY * H;
    // On the anchor chain he is where it crosses his height on screen; the camera goes down it with him.
    const onMarina = opening && p1 < 1;
    const holdX = onMarina ? lerp(stern[0], ring[0], clamp((holdY - stern[1]) / Math.max(1, ring[1] - stern[1]))) : chainX;

    // Snap on the reef: down to the sand, the walk along it, and on by the studio to the wreck.
    const sc2 = media.snapChain;
    const floorY = rc.oy + lerp(SPOTS.floor, L.wreckFloor, wW) * rc.dh;
    const feetX = (snapU - Lr) * rc.dw;
    const clawX = feetX + gripDx;
    const land = smooth(0.08, 0.42, kR);
    const landHy = this.snap.use3d ? floorY + gripDy : floorY - this.snap.rider.below() * chainBody * 0.92;
    const reefHold: [number, number] = [lerp(chainX, clawX, smooth(0, 0.5, land)), lerp(holdY, landHy, land)];

    // From the way out of the wreck on he is in the submarine: the sea floor ends there.
    const aboard = inT4 && out3 >= BOARD;

    // Snap on the ground: off the chain onto the sand by the anchor, the walk
    // to the shallows, the shallows, the walk into the kelp, the forest floor,
    // and up off it for the glide to the reef; the reef; by the wreck and in
    // its cabin.
    const cam = (p1 >= 1 ? TRAVEL * W : shift1) + shift2;
    const camV = Number.isNaN(this.lastCam) || dt <= 0 ? 0 : (cam - this.lastCam) / dt;
    this.lastCam = cam;
    this.walkVel += (camV - this.walkVel) * clamp(dt * 10);
    const gripAt = (f: readonly number[]): [number, number] => [f[0] + gripDx, this.snap.use3d ? f[1] + gripDy : f[1] - this.snap.rider.below() * chainBody * 0.92];
    const spotOn = (c: Cover, f: readonly [number, number]): [number, number] => { const q = onPlate(c, f[0], f[1]); return [Math.max(q[0], clearX), q[1]]; };
    let ground: SnapCtx['ground'];
    if (opening && k >= s0h && p1 >= DESC) {
      // On a walk he keeps his way across the screen, from one standing spot to the next, while the sea floor travels under him.
      const at1 = spotOn(c1, L.s1Feet);
      let feet: [number, number];
      if (p1 < 1) {
        const from: [number, number] = [ring[0] + shift1 + chainBody * L.landDx, sandY];
        feet = [lerp(from[0], at1[0], wk), lerp(from[1], at1[1], wk)];
      } else if (d12 < 1) {
        const at2 = spotOn(c2, L.s2Feet);
        feet = [lerp(at1[0], at2[0], d12), lerp(at1[1], at2[1], d12)];
      } else feet = spotOn(c2, L.s2Feet);
      const g = gripAt(feet);
      ground = { land: landK, lift: 0, feet, vel: this.walkVel, hold: [lerp(holdX, g[0], smooth(0, 0.6, landK)), lerp(holdY, g[1], landK)] };
    } else if (inT2 && !inReef && !inWreck) {
      const feet = spotOn(c2, L.s2Feet), g = gripAt(feet);
      const lift = smooth(0.02, 0.24, q2);
      ground = { land: 1, lift, feet, vel: 0, hold: [lerp(g[0], chainX, lift), lerp(g[1], holdY, lift)] };
    } else if (inReef) ground = { land, lift: 0, feet: [feetX, floorY], vel: this.reef.vel, hold: reefHold };
    else if (inWreck && (!inT4 || out3 < 0.5)) {
      // Outside the wreck he stands on the sand, to the right of the hole in its hull. With the film he pushes off
      // and swims in through it, and inside he comes down on the cabin's floor, by the desk. On the way out he
      // pushes off again and swims back out with the camera, to the submarine.
      if (q3 < 0.5) {
        const m4x = this.backdrop.plateMeta('z4x'), c4x = cover(m4x.w, m4x.h, W, H, 1.12, L.fxWreck, 0.5);
        const feet: [number, number] = [xWreck, c4x.oy + L.wreckFloor * c4x.dh], g = gripAt(feet);
        const lift = smooth(0.0, 0.22, q3);
        // (every so often he glances up at the submarine waiting over the wreck)
        const look: [number, number] | undefined = Math.sin(t * 0.8) > 0.6 ? [L.at.wreck[0] * W, L.at.wreck[1] * H] : undefined;
        ground = { land: 1, lift, feet, vel: 0, hold: [lerp(g[0], chainX, lift), lerp(g[1], holdY, lift)], look };
      } else {
        const m4 = this.backdrop.plateMeta('z4'), c4 = cover(m4.w, m4.h, W, H, L.overCabin + 0.05 * smooth(0, 3, kC), L.fxCabin, 0.5);
        const at = this.spot('z4', c4, L.cabinFeet[0], L.cabinFeet[1]);
        const feet: [number, number] = [Math.max(at[0], clearX), at[1]], g = gripAt(feet);
        const landC = smooth(0.72, 0.98, q3), lift = inT4 ? smooth(0, 0.3, out3) : 0;
        ground = lift > 0 ? { land: 1, lift, feet, vel: 0, hold: [lerp(g[0], chainX, lift), lerp(g[1], holdY, lift)] }
          : { land: landC, lift: 0, feet, vel: 0, hold: [lerp(chainX, g[0], smooth(0, 0.6, landC)), lerp(holdY, g[1], landC)] };
      }
    }
    // Where his raised claw is while he is on his own and not off on a card.
    const rest: [number, number] = ground ? (ground.land >= 1 && ground.lift <= 0 ? gripAt(ground.feet) : ground.hold) : [holdX, holdY];

    // Snap's visits to the cards: when the visitor pauses beside one, he leaps onto it.
    this.idleFor = Math.abs(sc.v) < 0.4 ? this.idleFor + dt : 0;
    if (this.snap.visiting && Math.abs(sc.v) > 1.5) this.snap.endVisit(t);
    if (!this.snap.visiting) this.visitEl = null;
    const still = !ground || (ground.land >= 1 && ground.lift <= 0 && Math.abs(ground.vel) < 20);
    if (!inReef && !aboard && still && this.snap.riding && !this.snap.visiting && !this.snap.rider.spinning && this.idleFor > 2.2 && t - this.lastVisit > 9) {
      const el = this.visitTarget(H, W, this.snap.grip?.[0] ?? holdX);
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
    // In his seat, left alone for a while, he does something: a wave, a snap of his pincer, a little hop.
    if (this.snap.aboard && this.idleFor > 7) { this.snap.poke(t); this.idleFor = -5; }

    // The anchor chain is there with the marina (and again at the surface): made fast at the stern, its end in the anchor's ring.
    // While Snap rides it he holds it in his raised claw, and it runs on through to the ring.
    const ride = this.snap.holds;
    const walking = !!this.snap.claw;
    // Back at the surface it shows again as the camera pulls back to the whole marina.
    const atSunset = inAscent && !!z7c;
    const anchorVis = z0c ? 1 : atSunset ? smooth(0.78, 1, reveal) : 0;
    let ax = stern[0], ay = stern[1], rx = ring[0], ry = ring[1];
    if (atSunset) {
      [ax, ay] = onPlate(z7c!, L.anchor[0], L.anchor[1]);
      [rx, ry] = onPlate(z7c!, L.ring7[0], L.ring7[1]);
    }
    const onChain = !!z0c && !!ride && !ground;
    const holds: Hold[] = [];
    if (onChain) {
      holds.push({ i: 36, x: ride.top[0], y: ride.top[1] });
      // the sprite (his fallback) holds it at both ends of the stretch painted into it
      if (ride.bottom) {
        const span = Math.round((sc2.chainBottom - sc2.chainTop) * chainBody / (linkLen * 0.72));
        holds.push({ i: 36 + Math.max(2, Math.min(8, span)), x: ride.bottom[0], y: ride.bottom[1] });
      }
    }
    holds.push({ i: 70, x: rx, y: ry });
    this.chain.update(dt, t, { ax, ay, len: Math.hypot(rx - ax, ry - ay), tail: linkLen * 0.72, holds, sway: sc.v, mouse: this.mouse, visible: anchorVis > 0.01, opacity: anchorVis, linkLen, slack: 0.998 });
    // once he is off it, it hangs behind him: he walks past in front of it
    this.chain.mesh.position.z = onChain ? 0 : -500;
    // The anchor itself, in its mound of sand, its ring where the chain ends.
    const am = media.anchor;
    const zoom = z0.dh / dhE;                       // how far the plunge has pushed in: the anchor is of the marina's world
    const ah = L.anchorH * H * zoom, aw = ah * (am.w / am.h);
    if (atSunset) {
      const h7 = L.anchorH * H * (z7c!.dh / dhE), w7 = h7 * (am.w / am.h);
      this.anchor.put(rx - am.ring[0] * w7, onPlate(z7c!, 0, L.sand7)[1] - am.ground * h7, w7, h7, anchorVis);
    } else this.anchor.put(ring[0] - am.ring[0] * aw, sandY - am.ground * ah, aw, ah, anchorVis);

    // The submarine. It is moored by the wreck, a little way off: it comes into view with the wreck as the camera
    // travels there from the studio, is left outside while the camera goes in through the hull, and is there again
    // on the way out. Snap gets in, and from there it is where he is: down the drop, through the twilight zone,
    // over the geode at the vents, and up to the pier, where he gets out and it sinks away.
    const sm = media.sub;
    const subW = L.sub * H, subH = subW * (sm.h / sm.w);
    const [bu, bv, br] = sm.bubble;
    const R = br * subW;                                          // the bubble's radius on screen
    const seatH = R * 1.62;                                       // Snap's height inside it
    // On wide screens its tail keeps clear of the cards.
    const minX = this.phone ? 0 : this.cardsRight + W * 0.03 + bu * subW;
    const spot = (q: readonly [number, number]): [number, number] => [Math.max(q[0] * W, minX), q[1] * H];
    const mixp = (a0: [number, number], b0: [number, number], f: number): [number, number] => [lerp(a0[0], b0[0], f), lerp(a0[1], b0[1], f)];
    // At the vents it hovers over the geode, its pincer above the print.
    const geode: [number, number, number] = z6c ? [...this.spot('z6', z6c, VENTS.geode[0], VENTS.geode[1]), VENTS.geodeH * z6c.dh] : [W * 0.5, H * 0.8, H * 0.3];
    const overGeode: [number, number] = [Math.max(geode[0] - (sm.claw[0] - bu) * subW, minX), Math.min(geode[1] - geode[2] * 0.4 - (sm.claw[1] - bv) * subH, H * L.at.vents)];
    // (the wreck is still this far to the right of where the camera will frame it; and how far the camera is into the hull)
    const far = inReef ? (wreckL - Lr) * rc.dw : 0;
    const inHull = inWreck ? f3 : 0;
    const moored = spot(L.at.wreck);
    let at: [number, number] = [moored[0] + far + inHull * W * 0.6, moored[1] - inHull * H * 0.2];
    at = mixp(at, spot(L.at.deep), inT4 && out3 >= 1 ? smooth(0, 0.45, q4) : 0);      // down the drop
    at = mixp(at, overGeode, inT4 && q4 >= 1 ? smooth(-0.3, 0.75, u6) : 0);           // to the vents
    at = mixp(at, spot(L.at.up), inT4 && y >= sec.t5.top ? smooth(0, 0.3, q5) : 0);   // the way up
    // Back at the surface it comes up at the pier, and stops there: as the camera pulls back and the waterline
    // comes down the screen, the submarine stays in the water under it (eased, so it does not jolt).
    const surfaced = wl7 === null ? 0 : smooth(0.5, 0.82, reveal);
    if (z7c && wl7 !== null) {
      at = mixp(at, [onPlate(z7c, L.moor7, 0)[0], wl7 + R * 0.34], surfaced);
      at[1] = softMax(at[1], wl7 + R * 0.34, R * 0.9 * (1 - surfaced));
    }
    // Once Snap is home on the pier it waits a moment, then sinks away (and is back at once if the visitor scrolls back down).
    const isHome = this.snap.state === 'home';
    if (!isHome) this.homeAt = -1; else if (this.homeAt < 0) this.homeAt = t;
    this.subSunk = isHome && t - this.homeAt > 1.6 ? Math.min(1, this.subSunk + dt / 1.8) : Math.max(0, this.subSunk - dt * 6);
    const sink = this.subSunk * this.subSunk;
    const subOn = (inReef ? (wW > 0 ? 1 : 0) : inWreck ? 1 - smooth(0.08, 0.45, inHull) : 0) * (1 - smooth(0.45, 1, this.subSunk));
    // Afloat it rides the swell; under water it bobs a little; it dips when Snap drops in, and nudges forward to use its pincer.
    const afloat = surfaced * (1 - sink);
    const bob = Math.sin(t * 1.5) * H * 0.005 + afloat * Math.sin(t * 1.1 + 1) * H * 0.004;
    const since = t - this.snap.boarded;
    const dip = since >= 0 && since < 1.4 ? Math.sin(since * 7) * Math.exp(-since * 3) * H * 0.016 : 0;
    const lungeAge = t - this.lungeAt;
    const lunge = lungeAge >= 0 && lungeAge < 0.5 ? Math.sin((Math.PI * lungeAge) / 0.5) * R * 0.24 : 0;
    // Its nose goes down on the drop and up on the climb, follows the scroll a little once he is in, and goes down again as it sinks away.
    const nose = (inT4 && out3 >= 1 ? Math.sin(Math.PI * q4) * 0.5 : 0)
      + (inT4 && q4 >= 1 && !inAscent ? 0.12 * smooth(0, 0.15, k5) * (1 - smooth(0.2, 0.8, u6)) : 0)
      - (inT4 && y >= sec.t5.top ? 0.42 * smooth(0, 0.2, q5) * (1 - smooth(0.25, 0.7, reveal)) : 0)
      + (aboard ? clamp(sc.v * 0.003, -0.06, 0.06) : 0) + afloat * Math.sin(t * 0.9) * 0.035 + sink * 0.45;
    this.pitch += (nose - this.pitch) * clamp(dt * 5);
    const pitch = this.pitch;
    const cock: [number, number] = [at[0] + lunge * Math.cos(pitch), at[1] + bob + dip + lunge * Math.sin(pitch) + sink * H * 0.45];
    // Snap's seat: on his feet on the bubble's floor, tilting with it
    // (a little forward of the bubble's middle, clear of the brass collar behind him).
    const seatFeet: [number, number] = [cock[0] + Math.cos(pitch) * R * 0.14 - Math.sin(pitch) * R * 0.8, cock[1] + Math.sin(pitch) * R * 0.14 + Math.cos(pitch) * R * 0.8];
    // The top of the hatch on its tower, where he gets in and out (as the cutout is about to be pinned).
    const hx = (sm.hatch[0] - bu) * subW, hy = (sm.hatch[1] - bv) * subH;
    const hatchTop: [number, number] = [cock[0] + hx * Math.cos(pitch) - hy * Math.sin(pitch), cock[1] + hx * Math.sin(pitch) + hy * Math.cos(pitch)];

    // Snap.
    const feet = onPlate(z0, L.feet[0], L.feet[1]);
    const body = z0.dh * L.body;
    const lean = ride && onChain ? Math.atan2(ride.top[0] - ax, ride.top[1] - ay) * 0.6 : 0;
    const water0 = onPlate(z0, 0, this.backdrop.plateMeta('z0').waterline ?? 0.58)[1];
    this.snap.update(dt, t, {
      k, beat: { gust: L.gust * s0h, hop: L.hop * s0h, force: 0.94 * s0h, reset: 0.6 * L.gust * s0h },
      feet: [feet[0], feet[1]], body, hold: [holdX, holdY], chainBody, onChain: onMarina,
      water: water0, viewW: W,
      lean: clamp(lean, -0.25, 0.25), grade,
      speed: sc.v, mouse: this.mouse, idle: this.idleFor > 1.5,
      ground,
      seat: { feet: seatFeet, h: seatH, lean: -pitch, hatch: hatchTop, raise: inAscent && q5 > 0.16 && reveal < 0.8 },
      aboard, hurry: inT4 ? hurry : 0,
      home: inAscent && z7c ? { on: reveal > 0.85, feet: onPlate(z7c, L.feet[0], L.feet[1]), body: z7c.dh * L.body } : undefined,
    });
    // He caught the chain: it jolts, and (filmed) at the surface the water rings.
    const water = u.uWaterY.value;
    if (this.snap.caught !== this.caughtSeen) {
      this.caughtSeen = this.snap.caught;
      if (onMarina) this.chain.kick(18, 36, (Math.random() - 0.5) * 6, 7);
      if (!this.snap.use3d && k < s0h + 0.5 && water < H) this.splashAt(holdX, water, chainBody, t, false);
    }
    // In 3D the splash is where his leap goes through the surface.
    if (this.snap.entered.t !== this.enteredSeen) {
      this.enteredSeen = this.snap.entered.t;
      if (water < H) this.splashAt(this.snap.entered.x, water, chainBody, t, true);
    }
    // A puff of sand where he comes down on the ground: off the chain, onto the reef, in the cabin, back from a card.
    const down = !!this.snap.claw && !!ground;
    if ((down && !this.onSand) || this.snap.touched !== this.touchedSeen) {
      this.touchedSeen = this.snap.touched;
      const f = ground?.feet ?? [holdX, holdY];
      for (let i = 0; i < 6; i++) this.bubbles.emit(f[0] + (Math.random() - 0.5) * chainBody * 0.8, f[1], H * 0.007);
    }
    this.onSand = down;
    // He dropped into his seat (or is back in it): bubbles round the bubble, and at the surface the water rings round the submarine.
    if (this.snap.boarded !== this.boardedSeen) {
      this.boardedSeen = this.snap.boarded;
      for (let i = 0; i < 7; i++) this.bubbles.emit(cock[0] + (Math.random() - 0.5) * R * 1.6, cock[1] - R * (0.6 + Math.random() * 0.5), H * 0.007);
      if (wl7 !== null && Math.abs(cock[1] - wl7) < R * 1.6) this.splashAt(cock[0], wl7, seatH * 1.4, t, true);
    }
    // The story of the submarine shows as he sets off for it, and for a while down the drop.
    if (aboard && !this.wasAboard && !inAscent && q4 < 0.5) this.boardUntil = t + 7;
    this.wasAboard = aboard;
    this.out.boardOn = t < this.boardUntil && aboard && q4 < 0.6;

    // The submarine itself: its glass is drawn over Snap once he is inside. Moored it sits a little way off, hazed by
    // the wreck's water; with him in it, it is the subject. At the surface it takes on the sunset water's colour below
    // the waterline, as he does.
    const away = inT4 ? 1 - smooth(BOARD, 1, out3) : 1;
    this.sub.mesh.renderOrder = this.snap.inside ? 5.5 : 4.5;
    this.sub.grade(grade[0], grade[1], grade[2]);
    this.sub.haze(0.2 * away);
    if (wl7 !== null && sea > 0) this.sub.sea(wl7, sea, SEA_DUSK, t);
    else this.sub.sea(null, 0);
    this.sub.pin(cock[0], cock[1], bu, bv, subW, subH, pitch, subOn);
    const claw = this.sub.at(sm.claw[0], sm.claw[1]), prop = this.sub.at(sm.prop[0], sm.prop[1]), hatch = this.sub.at(sm.hatch[0], sm.hatch[1]);
    // Its lamp glows where the water is dark: by the wreck, down the drop, through the twilight zone and at the vents.
    const gloom = !inWreck ? 0.3 * wW : !inT4 ? 0.32 : inAscent ? 0.8 * (1 - smooth(0.1, 0.45, q5)) : inVents ? 0.6 : lerp(0.32, 0.9, smooth(0.2, 0.9, q4));
    const lampAt = this.sub.at(sm.lamp[0], sm.lamp[1]);
    this.beam.put(lampAt[0] + R * 0.3 * Math.cos(pitch), lampAt[1] + R * 0.3 * Math.sin(pitch), R * (3 + 0.12 * Math.sin(t * 9)), 0.5 * gloom * subOn);

    // The vents: the submarine settles over the geode, and a moment later its pincer has the print.
    const land6 = inVents ? smooth(0.2, 0.8, u6) : 0;
    if (land6 >= 1 && this.ventsLanded < 0) this.ventsLanded = t;
    // (on the way up he keeps it: if the visitor scrolls back down he arrives with his print, not at one lying in the geode again)
    if (land6 < 1 && !inAscent) this.ventsLanded = -1;
    const taken = this.ventsLanded > 0 && t - this.ventsLanded > 0.8;
    if (taken && !this.printTaken) {
      // it nudges down for it: stars where the print lay, and Snap hops in his seat
      this.takenAt = t;
      this.lungeAt = t;
      this.snap.burst(this.vents.at.x, this.vents.at.y, this.vents.at.h * 1.2, 3);
      if (this.snap.aboard) this.snap.rider.act(t, 'hop');
    }
    this.printTaken = taken;
    // (as the way up begins, the page's own print takes over from the one in the pincer)
    if (inVents && taken) {
      // up out of the geode into the pincer, and held there by its corner
      const g = smooth(0, 0.7, t - this.takenAt);
      const ph = lerp(this.vents.at.h, seatH * 0.56, g), pw = ph * (media.print.w / media.print.h);
      const px = lerp(this.vents.at.x, claw[0] + pw * 0.42, g), py = lerp(this.vents.at.y, claw[1] + ph * 0.46, g) - Math.sin(Math.PI * g) * ph * 0.35;
      this.snap.carryPrint(px, py, ph, lerp(0.12, -0.08, g) + Math.sin(t * 1.3) * 0.03 * g, grade, 1 - smooth(0.3, 0.6, pushOff));
    }

    // A pier post passes close to the camera on the walk to the shallows, where the two places meet.
    const pm = media.post;
    const ph0 = H * 1.7, pw0 = Math.min(ph0 * (pm.w / pm.h) * 1.5, W * (this.phone ? 0.46 : 0.3));
    this.post.put(seam !== null && inPlunge ? W / 2 + (seam - W / 2) * 1.22 - pw0 / 2 : -9999, -H * 0.3, pw0, ph0, seam !== null && inPlunge ? 1 : 0);

    // Bubbles: the plunge and the films; Snap on fast scrolls and fast walks; the propeller's wash when the submarine
    // is under way, and a few from its hatch on fast scrolls.
    const filming = (p1 > 0.01 && p1 < DESC * 0.7) || (q2 > 0.05 && q2 < 0.5 && !inWreck) || (inT3 && q3 > 0.05 && q3 < 0.6) || (inT4 && q4 > 0.05 && q4 < 0.6);
    if (filming && Math.random() < 0.9) this.bubbles.emit(W * (0.2 + Math.random() * 0.6), H * (0.75 + Math.random() * 0.35), H * 0.012, 3);
    if (ride && !inReef && p1 > 0.15 && Math.abs(sc.v) > 6 && Math.random() < 0.6) this.bubbles.emit(ride.top[0] + chainBody * 0.3, ride.top[1], H * 0.008);
    if (walking && Math.abs(ground?.vel ?? 0) > 400 && Math.random() < 0.25) this.bubbles.emit((ground?.feet[0] ?? 0) + (Math.random() - 0.5) * chainBody * 0.5, (ground?.feet[1] ?? 0) - chainBody * 0.08, H * 0.006);
    const inSeat = this.snap.aboard && afloat < 0.5;
    const underWay = (inT4 && q4 > 0.02 && q4 < 1) || Math.abs(sc.v) > 3 || (inAscent && reveal < 0.5);
    if (inSeat && underWay && Math.random() < 0.55) this.bubbles.emit(prop[0] - R * 0.15, prop[1] + (Math.random() - 0.5) * R * 0.4, H * 0.006);
    if (inSeat && Math.abs(sc.v) > 6 && Math.random() < 0.3) this.bubbles.emit(hatch[0], hatch[1] - R * 0.1, H * 0.007);
    if (sink > 0.02 && sink < 0.9 && Math.random() < 0.6) this.bubbles.emit(cock[0] + (Math.random() - 0.5) * subW * 0.6, cock[1] - R * 0.6, H * 0.008);
    this.bubbles.update(dt);
    this.splash.update(dt);

    // The format fish in the shallows: the school that is picked gathers by Snap's raised claw.
    this.fish.update(dt, t, { vis: s1On, w: W, h: H, tag: [rest[0] + chainBody * 0.42, rest[1] - chainBody * 0.34], mouse: this.mouse, grade });

    // The kelp forest: foreground stalks, and the little fish caught in an old line by Snap's claw.
    // the forest's edge passes close to the camera on the walk in, where the two places meet
    this.kelp.update(t, { vis: s2On, w: W, h: H, mouse: this.mouse, edge: inJoin && seam !== null ? W / 2 + (seam - W / 2) * 1.2 : null });
    if (y < d0 && this.net.state !== 'tangled') { this.net.reset(); this.freeAsked = false; }
    const wasTangled = this.net.state === 'tangled';
    this.net.update(dt, t, {
      vis: inReef ? 0 : Math.max(s2On, inT2 ? 1 - smooth(0.1, 0.5, q2) : 0), hold: [rest[0], rest[1]], size: H * 0.034,
      follow: 1, auto: this.freeAsked || kS2 > 0.75,
    });
    if (wasTangled && this.net.state !== 'tangled') {
      // his pincer snips the line
      this.kindUntil = t + 5;
      if (this.snap.riding && !this.snap.visiting) this.snap.rider.act(t, 'snap');
    }
    this.out.fish = { x: this.net.at.x, y: this.net.at.y, on: this.net.at.on && s2On > 0.6 };
    this.out.kindOn = t < this.kindUntil && s2On > 0.2;

    // Depth gauge.
    const zone: ZoneId = k < s0h ? 's0' : p1 < WALK ? 't1' : d12 < 0.5 ? 's1' : !inT2 ? 's2' : y < sec.s3.top ? 't2'
      : y < sec.s3b.top - 0.5 * H ? 's3' : y < sec.s4.top - 0.2 * H ? 's3b' : !inT3 ? 's4' : q3 < 1 ? 't3' : !inT4 || out3 < 1 ? 's4b' : q4 < 1 ? 't4'
      : !inVents && !inAscent ? 's5' : inVents ? 's6' : reveal < 0.9 ? 't5' : 's7';
    this.out.zone = zone;
    // The gauge spins through the drop, slow at first, then fast, then settling at the twilight zone.
    this.out.depth = k < s0h ? 0 : p1 < 1 ? -5 * desc : !inT2 ? -5 - 10 * d12 : !inWreck ? -15 - 15 * q2 - 30 * wW
      : !inT4 ? -60 : q4 < 1 ? -60 - 440 * easeInOut(q4)
      : u6 < -0.8 ? -500 - 500 * smooth(0, 1, k5) : !inAscent ? -1000 - 1500 * smooth(-0.8, 1.1, u6)
      : -2500 * (1 - easeInOut(clamp((q5 - 0.07) / 0.85)));
    this.out.storyOn = this.snap.state === 'gust' || this.snap.state === 'surprised' || this.snap.state === 'hop';
    this.out.z1 = z1c;
    this.out.z2 = z2c;
    this.out.s1On = s1On;
    this.out.s2On = s2On;
    this.out.reef = reefOut;

    // (the octopus comes out once he is standing in the cabin)
    this.cabin(dt, t, { z4c, cabinOn, fC, grade, ride: walking && !this.snap.visiting, H, W });
    // (the lost fish, found, swims along by the submarine's lamp)
    this.dusk(dt, t, { twiOn, k5, warm, cover: z5c, side: [cock[0] + R * 1.2, cock[1] - R * 0.5], H, W });
    this.vents.update(dt, t, { vis: ventsOn, geode, taken, w: W, h: H, mouse: this.mouse, startle: this.ventsLanded > 0 && t - this.ventsLanded < 1.4 });
    this.out.vents = { z6: z6c, on: ventsOn, taken };
    // The way up: the print hangs from the submarine's pincer; at the surface, once Snap is home and the receipt is up, he takes its picture.
    if (k7 < 0.5) this.flashed = false;
    if (!this.flashed && this.snap.state === 'home') {
      const r = document.getElementById('receipt')?.getBoundingClientRect();
      // on phones the polaroid lands on the receipt's top edge, so that has to be in view
      if (r && r.top < H * 0.55 && r.bottom > H * 0.35 && (!this.phone || r.top > H * 0.12)) {
        this.flashed = true;
        this.snap.rider.act(t, 'snap');
        this.out.ascent.flashAt = t;
      }
    }
    this.out.ascent = { on: inT4 && y >= sec.t5.top - 0.2 * H ? clamp(Math.max(pushOff, bands)) * (1 - smooth(0.88, 0.98, q5)) : 0, q: q5, at: claw, reveal, flashAt: this.out.ascent.flashAt };
    // A beam from the wreck lies on the way there: it passes close to the camera a little after the last coral.
    this.debris.update(t, { x: W / 2 + ((5 - Lr) * rc.dw + W * 0.2 - W / 2) * 1.35, vis: (inReef && wW > 0) || (inWreck && !inT3) ? 1 : 0, w: W, h: H, mouse: this.mouse });
    s.render();
  }
}
