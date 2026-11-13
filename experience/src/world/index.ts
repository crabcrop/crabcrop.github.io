import { Stage, onPlate, cover, type Cover } from './stage';
import { Backdrop, PANELS, type SourceKey, type Zone } from './backdrop';
import { Chain, type Hold } from './chain';
import { Snap, type SnapCtx } from './snap';
import { Prop } from './props';
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
import { clamp, lerp, smooth, type Scroll } from '../scroll';

interface Layout {
  /** Horizontal focus of the plates; the kelp has its own, to keep its silk curtains clear of Snap and his line, and so do the wreck outside and its cabin. */
  fx: number; fxKelp: number; fxWreck: number; fxCabin: number; fxVents: number;
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
  /** Where Snap lands at the vents: in front of the geode, so it glows behind him (a share of the master plate). */
  ventsFeet: readonly [number, number];
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
  /** His line: how long (viewport heights), and its float's height (viewport heights). */
  line: number; floatH: number;
}

/** Where things sit, in plate coordinates (0 to 1), per layout. */
const LAYOUT: Record<'wide' | 'phone', Layout> = {
  wide: {
    fx: 0.62, fxKelp: 0.5, fxWreck: 0.38, fxCabin: 0.45, overCabin: 1.04, fxVents: 0.36,
    feet: [0.795, 0.345], body: 0.125,               // Snap on the right pier
    anchor: [0.655, 0.47],                           // the chain leaves the boat's stern
    holdY: 0.56, chainBody: 0.26,                    // riding: his top hold, his height (viewport heights)
    gust: 0.35, hop: 0.64,
    reefBody: 0.2,
    octopus: 0.13,
    ventsFeet: [0.53, 0.93],
    under: 2.7, ring: [0.632, 0.873], sand: 0.957, anchorH: 0.26, ringX: 0.62, landDx: -1.2,
    ring7: [0.615, 0.873], sand7: 0.957,
    s1Feet: [0.6, 0.9], s2Feet: [0.56, 0.85],
    line: 0.45, floatH: 0.085,
  },
  phone: {
    fx: 0.5, fxKelp: 0.5, fxWreck: 0.5, fxCabin: 0.5, overCabin: 1.12, fxVents: 0.5,
    feet: [0.37, 0.236], body: 0.085,
    anchor: [0.2, 0.27],
    holdY: 0.66, chainBody: 0.2,
    gust: 0.62, hop: 0.8,                            // after the tall hero card has scrolled away
    reefBody: 0.15,
    octopus: 0.1,
    ventsFeet: [0.53, 0.93],
    under: 2.4, ring: [0.2, 0.845], sand: 0.935, anchorH: 0.24, ringX: 0.36, landDx: 0.92,
    ring7: [0.183, 0.891], sand7: 0.978,
    s1Feet: [0.4, 0.9], s2Feet: [0.44, 0.86],
    line: 0.4, floatH: 0.075,
  },
};

/**
 * The plunge, as shares of its scroll length: the push down the marina's
 * picture to the sand ends at DESC, Snap is off the chain and on the sand a
 * little later, and from WALK he walks to the shallows. Each walk moves the
 * camera TRAVEL viewport widths to the right.
 */
const DESC = 0.5, LAND = 0.09, WALK = 0.62, TRAVEL = 1.2;
/** Where the tags hang on Snap's line, from the float (0) down to his claw (1); the source hangs just below his claw. */
const LINE_TAGS = { sig: 0.07, fmt: 0.24, look: 0.41, crop: 0.58, finish: 0.75, src: 1 };

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
/** The drop starts this many frames in, where the camera is already moving off the wreck. */
const T4_FROM = 10;
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export type ZoneId = 's0' | 't1' | 's1' | 's2' | 't2' | 's3' | 's3b' | 's4' | 't3' | 's4b' | 't4' | 's5' | 's6' | 't5' | 's7';

export interface WorldOut {
  tags: Record<keyof typeof LINE_TAGS, { x: number; y: number; a: number }>;
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
  /** The wreck's cabin: its plate on screen, how much it is on, and the octopus waiting with its letter (for its button). */
  z4: Cover | null;
  cabinOn: number;
  octo: { x: number; y: number; s: number; on: boolean; busy: boolean };
  /** The story of the octopus's letter, after Snap has sealed it. */
  sealOn: boolean;
  /**
   * The twilight zone: its plate on screen and the phone window of the
   * master plate it shows, how much it is on, the lantern's light (x, y,
   * radius px), and the lure's light running down Snap's line.
   */
  twi: { z5: Cover | null; win: readonly [number, number]; on: number; light: [number, number, number]; lure: { x: number; y: number; on: boolean } };
  /** The story of the lost fish, once it has gone home with Snap. */
  fishOn: boolean;
  /** The vents: the plate on screen, how much it is on, and whether Snap has his print (the source tag shows then). */
  vents: { z6: Cover | null; on: number; taken: boolean };
  /**
   * The way up: how much of the ascent is on and how far through it, where
   * Snap's free claw is (the print rides beside it), how far the surface has
   * been revealed, and when he took the finale's picture.
   */
  ascent: { on: number; q: number; claw: [number, number]; reveal: number; flashAt: number };
}

/** Zones that own a plate, for checking shared files before dropping one. */
const PLATE_ZONES = new Set<string>(['z0', 'z1', 'z2', 'z3', 'r3c', 'z4x', 'z4', 'z5', ...PANELS]);

export class World {
  readonly stage: Stage;
  private backdrop: Backdrop;
  /** The anchor chain, from the boat's stern to the anchor on the sand. */
  private chain: Chain;
  /** Snap's line: a lighter chain held up by a float, with the URL's tags on it. */
  private line: Chain;
  private anchor: Prop;
  private float: Prop;
  private post: Prop;
  /** How far the line is Snap's (0 tied to the anchor, 1 in his claw), and how far its float leans to the side of its foot (px), with its speed. */
  private own = 0;
  private buoy = { x: 0, vx: 0, set: false };
  /** How much of the line shows (it fades), and where its foot last was. */
  private lineVis = 0;
  private lineAt: [number, number] = [0, 0];
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
  /** When Snap landed at the vents (to pick up his print a moment later), and whether he has it. */
  private ventsLanded = -1;
  private printTaken = false;
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
    this.stage = new Stage(canvas, 2);
    this.backdrop = new Backdrop(this.stage, phone);
    this.chain = new Chain(this.stage);
    this.chain.fixed = true;
    this.line = new Chain(this.stage, ['#8a5a3a', '#9a6238', '#a8683a', '#b5642c', '#7d4f36', '#94603c']);
    this.anchor = new Prop(this.stage, 'anchor', 4, { grade: [0.86, 0.96, 0.98], haze: 0.16 });
    this.float = new Prop(this.stage, 'float', 4, { grade: [0.94, 1, 1], haze: 0.05 });
    this.post = new Prop(this.stage, 'post', 9, { grade: [0.72, 0.84, 0.86], haze: 0.1, water: [0.05, 0.25, 0.3] });
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
    const zero = { x: -999, y: -999, a: 0 };
    this.out = {
      tags: { sig: zero, fmt: zero, look: zero, crop: zero, finish: zero, src: zero }, tagsOn: 0, z1: null, z2: null,
      s1On: 0, s2On: 0, depth: 0, zone: 's0', storyOn: false, kindOn: false,
      fish: { x: -999, y: -999, on: false }, reef: null, perch: null,
      z4: null, cabinOn: 0, octo: { x: -999, y: -999, s: 0, on: false, busy: false }, sealOn: false,
      twi: { z5: null, win: [0, 1], on: 0, light: [-999, -999, 1], lure: { x: -999, y: -999, on: false } }, fishOn: false,
      vents: { z6: null, on: 0, taken: false },
      ascent: { on: 0, q: 0, claw: [-999, -999], reveal: 0, flashAt: -10 },
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
    // what waits at the foot of the pier: the anchor, the float on its line, the plate's sharper underwater half
    for (const p of [this.anchor, this.float, this.post]) p.load().catch(() => {});
    this.want('z0u', () => this.backdrop.loadPlate('z0u'));
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
    if (y > 0.95 * H) this.want('fish', () => this.fish.load());
    if (y > sec.s1.top + 0.4 * H) {
      this.want('kelp', () => this.kelp.load());
      this.want('net', () => this.net.load());
    }
    if (y > sec.s2.top - 0.2 * H) this.want('t2', () => this.backdrop.loadSequence('t2'));
    const reefSoon = y > sec.t2.top - 0.5 * H;
    if (y > sec.s1.top - H) this.want('m05', () => this.snap.loadClaw());
    // the sideways walk (the film, if the 3D Snap could not load): he walks from the foot of the pier on
    if (y > 0.95 * H) this.want('m04', () => this.snap.loadReef());
    if (reefSoon) this.want('coral', () => this.reef.load());
    this.resident('z0', y < sec.t1.top + sec.t1.h + 0.5 * H);
    this.resident('z0u', y < sec.t1.top + sec.t1.h + 0.5 * H);
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
   * fish follows it, the lure's light runs down Snap's line while the explain
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
    const holdArc = this.line.holdArc(0) ?? 0;
    const lost: [number, number] = o.cover ? this.spot('z5', o.cover, LOST_FISH[0], LOST_FISH[1]) : [W * 0.6, H * 0.7];
    this.twilight.update(dt, t, {
      vis: o.twiOn, k: o.k5, w: W, h: H, mouse: this.mouse, lost, hold, body: this.L.chainBody * H,
      chainAt: (d) => this.line.at(d), chainLen: holdArc, lure,
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

    // The reef: pinned sideways travel, then the studio, then the way out.
    const reefMeta = media.plates.z3;
    const rc = cover(reefMeta.w, reefMeta.h, W, H, 1.12, 0, 0.5);
    const win = W / rc.dw;
    const F = this.reef.framings(win);
    const pin = Math.max(1, sec.s3.h - H);
    const kR = clamp((y - sec.s3.top) / pin) * REEF_UNITS;
    const kB = (y - sec.s3b.top) / H;
    // Leaving the studio: up off the sand and down into the dark, toward the wreck.
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
    const k5 = (y - sec.s5.top) / Math.max(1, sec.s6.top - sec.s5.top);
    // The vents: through a warm dark out of the twilight, then down to the floor by the geode.
    const u6 = (y - sec.s6.top) / H;
    // The way up: off the floor at the vents; the express ascent; and home at the surface, revealed as the camera pulls back.
    const u5 = (y - sec.t5.top) / H;
    const q5 = clamp((y - sec.t5.top) / sec.t5.h);
    const winch = inT4 ? smooth(-0.55, 0.05, u5) : 0;
    const inAscent = inT4 && y >= sec.t5.top && q5 >= 0.07;
    const bands = inT4 && y >= sec.t5.top ? smooth(0, 0.065, q5) * (1 - smooth(0.84, 0.97, q5)) : 0;
    const k7 = (y - sec.s7.top) / H;
    const reveal = inAscent ? smooth(-0.3, 1.0, k7) : 0;
    const inVents = inT4 && u6 >= -0.4 && !inAscent;
    const ventsOn = inVents ? smooth(-0.4, -0.15, u6) : 0;
    const twiOn = inT4 ? smooth(0.96, 1, q4) * (1 - smooth(-0.6, -0.4, u6)) : 0;
    const warm = inT4 && !inVents ? smooth(0.78, 1.15, k5) : 0;
    const cabinOn = inT3 && !inT4 ? clamp(Math.min(smooth(0.9, 1, q3), 1 - leaving)) : 0;

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
        else if (this.backdrop.seqReady('t4')) {
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
    } else if (d12 >= 1) { a = b = 'z2'; }
    else if (p1 >= 1) { a = b = 'z1'; }
    let z0c: Cover | null = null, z1c: Cover | null = null, z2c: Cover | null = null, z4c: Cover | null = null, z5c: Cover | null = null, z6c: Cover | null = null, z7c: Cover | null = null;
    // Where the two places meet across the screen while the camera travels between them, else null.
    let seam: number | null = null;
    // Snap's spot on the reef, in panels: he keeps his place on screen while
    // the camera travels, then walks to his mark in the studio.
    const snapU = lerp(Lr + this.reef.snapAt() * win, this.reef.studioSpot(), smooth(-0.8, 0.6, kB));
    let reefOut: ReefOut | null = null;
    if (inReef) {
      const r = this.reef.update(dt, t, { L: Lr, k: kR, W, H, dw: rc.dw, dh: rc.dh, oy: rc.oy, F, snapU, mouse: this.mouse, on: true });
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
      // Down to the wreck the camera tilts from the light above to the ship; in the cabin it pushes in a little.
      const fyW = lerp(0.04, 0.5, smooth(0, 1, dW));
      // Through the twilight zone it sinks toward the seabed.
      const fyT = lerp(0.5, 0.82, smooth(0, 1.1, k5));
      // At the vents it sinks to the floor and the geode.
      const fyV = lerp(0.22, 0.62, smooth(-0.4, 1.3, u6));
      const fyOf = (x: SourceKey) => (x === 'z0' ? fyS0 : x === 'z1' ? fyS1 : x === 'z2' ? fyS2 : x === 'z4x' ? fyW : x === 'z5' ? fyT : x === 'z6' ? fyV : x === 'z7' ? lerp(0.97, 0.22, reveal) : 0.5);
      const fxOf = (x: SourceKey) => (x === 'z2' ? L.fxKelp : x === 't2' ? lerp(L.fxKelp, L.fx, q2)
        : x === 'z4x' ? L.fxWreck : x === 't3' ? lerp(L.fxWreck, L.fxCabin, q3) : x === 'z4' ? L.fxCabin : x === 't4' || x === 'z5' ? 0.5 : x === 'z6' ? L.fxVents : x === 'z7' ? lerp(0.62, L.fx, reveal) : L.fx);
      // through the hull the camera settles to the cabin's framing, which then pushes in a little
      const overOf = (x: SourceKey) => (x === 'z4' ? L.overCabin + 0.05 * smooth(0, 3, kC) : x === 't3' ? lerp(1.12, L.overCabin, smooth(0.55, 1, q3)) : x === 'z7' ? lerp(2.3, 1.12, reveal) : 1.12);
      const frames = {
        t2: q2 * (media.t2.frames - 1), t3: q3 * (media.t3.frames - 1),
        t4: T4_FROM + q4 * (media.t4.frames - 1 - T4_FROM),
      };
      const covers = this.backdrop.update(dt, a, b, mix, frames, fyOf(a), fyOf(b), fxOf(a), fxOf(b), overOf(a), overOf(b));
      const coverOf = (z: SourceKey) => (a === z ? covers.a : b === z ? covers.b : null);
      z0c = coverOf('z0'); z1c = coverOf('z1'); z2c = coverOf('z2'); z4c = coverOf('z4'); z5c = coverOf('z5'); z6c = coverOf('z6'); z7c = coverOf('z7');
    }
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
    if (z0c) this.snap.rider.snap3d.setWater(u.uWaterY.value, 1 - under);
    else if (z7c && reveal > 0.5) this.snap.rider.snap3d.setWater(u.uWaterY.value, 1);
    else this.snap.rider.snap3d.setWater(null, 0);
    u.uGlint.value = inReef ? 0.55 * (1 - exit) : inWreck ? 0 : s1On;
    u.uShafts.value = inWreck ? 0 : s2On;
    // Through the dark between zones: out of the studio and down to the wreck, out of the cabin and into the drop.
    const dark = inReef ? exit * 0.85
      : !inWreck ? 0
      : inAscent ? 0
      : inT4 && q4 >= 1 ? (inVents ? 0.9 * (1 - smooth(-0.4, 0.35, u6)) : 0.9 * smooth(-1.1, -0.4, u6))
      : inT4 ? 0.8 * (1 - smooth(0, 0.14, q4))
      : inT3 ? 0.8 * leaving
      : 0.85 * (1 - smooth(0, 0.5, dW));
    u.uTintAmt.value = dark;
    // the dark between zones is wreck teal, except on the way into the vents, where it is ember
    if (inT4 && q4 >= 1 && u6 > -1.3) u.uTint.value.set(0.1, 0.035, 0.015); else u.uTint.value.set(0.05, 0.23, 0.24);
    u.uShimmer.value = ventsOn;
    this.backdrop.ascent(bands, q5);
    this.chain.setWater(under);
    let grade: [number, number, number] = [1 - 0.1 * under - 0.04 * s2On - 0.16 * exit, 1 + 0.01 * under - 0.06 * exit, 1 + 0.04 * under - 0.02 * exit];
    if (inWreck) {
      // Cool and dim outside the wreck, warm by the lantern in the cabin, deep blue in the drop.
      const from = grade, ext = [0.84, 0.95, 1.03], cab = [1.02, 0.93, 0.85], deep = [0.74, 0.86, 1.02];
      const g = (i: number) => lerp(lerp(lerp(from[i], ext[i], smooth(0, 0.6, dW)), cab[i], cabinOn), deep[i], smooth(0.1, 0.8, q4));
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
    // Past the opening he swims here with his line; in the wreck's cabin a little further left, clear of the desk.
    const chainX = this.phone ? W * 0.1 : lerp(Math.max(W * 0.53, this.cardsRight + W * 0.05), Math.max(W * 0.47, this.cardsRight + W * 0.05), inWreck ? smooth(0.4, 1, q3) * (1 - smooth(0, 0.5, q4)) : 0);
    const chainBody = L.chainBody * H;
    const linkLen = media.snapChain.linkLen * chainBody;
    const holdY = L.holdY * H;
    // On the anchor chain he is where it crosses his height on screen; the camera goes down it with him.
    const onMarina = opening && p1 < 1;
    const holdX = onMarina ? lerp(stern[0], ring[0], clamp((holdY - stern[1]) / Math.max(1, ring[1] - stern[1]))) : chainX;

    // Snap on the reef: down to the sand, the walk, and up off it at the end.
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
    // Up off the sand at the end, he swims to his usual place for the way down to the wreck.
    const reefHold: [number, number] = ret > 0
      ? [lerp(clawX, chainX, rise), lerp(landHy, holdY, rise)]
      : [lerp(chainX, clawX, smooth(0, 0.5, land)), lerp(holdY, landHy, land)];

    // Snap at the vents: down to the floor beside the geode, where his print lies; he takes it a moment after landing.
    const vFeet: [number, number] = z6c ? this.spot('z6', z6c, L.ventsFeet[0], L.ventsFeet[1]) : [W * 0.62, H * 0.9];
    const land6 = inVents ? smooth(0.2, 0.8, u6) : 0;
    const vLandHy = this.snap.use3d ? vFeet[1] + gripDy : vFeet[1] - this.snap.rider.below() * chainBody * 0.92;
    const ret6 = smooth(0, 0.35, winch), rise6 = smooth(0.35, 1, winch);
    const ventsHold: [number, number] = ret6 > 0
      ? [lerp(vFeet[0] + gripDx, chainX, rise6), lerp(vLandHy, holdY, rise6)]
      : [lerp(chainX, vFeet[0] + gripDx, smooth(0, 0.5, land6)), lerp(holdY, vLandHy, land6)];
    if (land6 >= 1 && this.ventsLanded < 0) this.ventsLanded = t;
    if (land6 < 1) this.ventsLanded = -1;
    const taken = this.ventsLanded > 0 && t - this.ventsLanded > 0.8;
    if (taken && !this.printTaken) {
      // he takes his print: stars where it lay and in his claw, and a little hop
      this.snap.burst(this.vents.at.x, this.vents.at.y, this.vents.at.h * 1.2, 3);
      this.snap.rider.act(t, 'hop');
    }
    this.printTaken = taken;

    // Snap on the ground in the opening: off the chain onto the sand by the
    // anchor, the walk to the shallows, the shallows, the walk into the kelp,
    // the forest floor, and up off it for the glide to the reef.
    const cam = (p1 >= 1 ? TRAVEL * W : shift1) + shift2;
    const camV = Number.isNaN(this.lastCam) || dt <= 0 ? 0 : (cam - this.lastCam) / dt;
    this.lastCam = cam;
    this.walkVel += (camV - this.walkVel) * clamp(dt * 10);
    const gripAt = (f: readonly number[]): [number, number] => [f[0] + gripDx, this.snap.use3d ? f[1] + gripDy : f[1] - this.snap.rider.below() * chainBody * 0.92];
    // On wide screens his raised claw keeps clear of the cards' column, wherever the plate would put him.
    const clearX = this.phone ? -1e9 : this.cardsRight + W * 0.05 - gripDx;
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
      ground = { land: landK, lift: 0, feet, body: reefBody, vel: this.walkVel, hold: [lerp(holdX, g[0], smooth(0, 0.6, landK)), lerp(holdY, g[1], landK)] };
    } else if (inT2 && !inReef && !inWreck) {
      const feet = spotOn(c2, L.s2Feet), g = gripAt(feet);
      const lift = smooth(0.02, 0.24, q2);
      ground = { land: 1, lift, feet, body: reefBody, vel: 0, hold: [lerp(g[0], chainX, lift), lerp(g[1], holdY, lift)] };
    } else if (inReef) ground = { land, lift: ret, feet: [feetX, floorY], body: reefBody, vel: this.reef.vel, hold: reefHold };
    else if (inVents) ground = { land: land6, lift: ret6, feet: vFeet, body: reefBody, vel: 0, hold: ventsHold, print: taken && ret6 <= 0 };

    // Snap's visits to the cards: when the visitor pauses beside one, he leaps onto it.
    this.idleFor = Math.abs(sc.v) < 0.4 ? this.idleFor + dt : 0;
    if (this.snap.visiting && Math.abs(sc.v) > 1.5) this.snap.endVisit(t);
    if (!this.snap.visiting) this.visitEl = null;
    const still = !ground || (ground.land >= 1 && ground.lift <= 0 && Math.abs(ground.vel) < 20);
    if (!inReef && !inVents && still && this.snap.riding && !this.snap.visiting && !this.snap.rider.spinning && this.idleFor > 2.2 && t - this.lastVisit > 9) {
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
      // the sprite and film (his fallbacks) hold it at both ends of the stretch painted into them
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
    const zoom = z0.dh / dhE;                       // how far the plunge has pushed in: the anchor and the float are of the marina's world
    const ah = L.anchorH * H * zoom, aw = ah * (am.w / am.h);
    const ax0 = ring[0] - am.ring[0] * aw, ay0 = sandY - am.ground * ah;
    if (atSunset) {
      const h7 = L.anchorH * H * (z7c!.dh / dhE), w7 = h7 * (am.w / am.h);
      this.anchor.put(rx - am.ring[0] * w7, onPlate(z7c!, 0, L.sand7)[1] - am.ground * h7, w7, h7, anchorVis);
    } else this.anchor.put(ax0, ay0, aw, ah, anchorVis);

    // Snap.
    const feet = onPlate(z0, L.feet[0], L.feet[1]);
    const body = z0.dh * L.body;
    const lean = ride && onChain ? Math.atan2(ride.top[0] - ax, ride.top[1] - ay) * 0.6 : 0;
    this.snap.update(dt, t, {
      k, beat: { gust: L.gust * s0h, hop: L.hop * s0h, force: 0.94 * s0h, reset: 0.6 * L.gust * s0h },
      feet: [feet[0], feet[1]], body, hold: [holdX, holdY], chainBody,
      water: onPlate(z0, 0, this.backdrop.plateMeta('z0').waterline ?? 0.58)[1], viewW: W,
      lean: clamp(lean, -0.25, 0.25), grade,
      speed: sc.v, mouse: this.mouse, idle: this.idleFor > 1.5,
      ground,
      home: inAscent && z7c ? { on: reveal > 0.85, feet: onPlate(z7c, L.feet[0], L.feet[1]), body: z7c.dh * L.body } : undefined,
    });
    // He caught the chain (or is back with his line after a card): it jolts, and (filmed) at the surface the water rings.
    const water = u.uWaterY.value;
    if (this.snap.caught !== this.caughtSeen) {
      this.caughtSeen = this.snap.caught;
      (onMarina ? this.chain : this.line).kick(18, 36, (Math.random() - 0.5) * 6, 7);
      if (!this.snap.use3d && k < s0h + 0.5 && water < H) this.splashAt(holdX, water, chainBody, t, false);
    }
    // In 3D the splash is where his leap goes through the surface.
    if (this.snap.entered.t !== this.enteredSeen) {
      this.enteredSeen = this.snap.entered.t;
      if (water < H) this.splashAt(this.snap.entered.x, water, chainBody, t, true);
    }
    // A puff of sand where he comes down on the ground: off the chain, onto the reef, by the geode, back from a card.
    const down = !!this.snap.claw && !!ground;
    if ((down && !this.onSand) || this.snap.touched !== this.touchedSeen) {
      this.touchedSeen = this.snap.touched;
      const f = ground?.feet ?? [holdX, holdY];
      for (let i = 0; i < 6; i++) this.bubbles.emit(f[0] + (Math.random() - 0.5) * reefBody, f[1], H * 0.007);
    }
    this.onSand = down;

    // His line: made fast to the anchor until he lands beside it, then in his
    // raised claw for the rest of the dive, a float holding it up and the URL's
    // tags along it. It is his until he is home on the pier.
    const lm = media.float;
    const took = y > sec.t1.top + (DESC + LAND) * sec.t1.h;
    // While he is off on a card it waits where he stood, held up by its float.
    const rest: [number, number] = ground ? (ground.land >= 1 && ground.lift <= 0 ? gripAt(ground.feet) : ground.hold) : [holdX, holdY];
    const grip = this.snap.visiting ? rest : this.snap.grip;
    this.own += ((took && grip ? 1 : 0) - this.own) * clamp(dt * 8);
    const home = this.snap.state === 'home' || this.snap.state === 'homeLeap';
    const at = am.ties[L.landDx < 0 ? 0 : 1];        // the end of the stock on the side he lands
    const tie: [number, number] = [ax0 + at[0] * aw, ay0 + at[1] * ah];
    const lz = lerp(zoom, 1, this.own);              // its size: the marina's until he takes it
    const lineOn = !home && (this.own > 0.002 ? !!grip : !!z0c);
    // it fades out when he leaps home (and in again if the visitor scrolls back down), from where it last was
    this.lineVis += ((lineOn ? 1 : 0) - this.lineVis) * clamp(dt * 7);
    if (lineOn) this.lineAt = grip && this.own > 0.002 ? [lerp(tie[0], grip[0], this.own), lerp(tie[1], grip[1], this.own)] : tie;
    const base = this.lineAt;
    const fh = L.floatH * H * lz, fw = fh * (lm.w / lm.h);
    // The float rides above the line's foot: it trails behind a little when he walks or the page scrolls fast, and bobs.
    // Its sway is worked out from the foot (not on screen), so the camera's own travel does not drag it about.
    const topBar = (this.phone ? 0.075 : 0.085) * H;
    const len = Math.max(H * 0.12, Math.min(L.line * H * lz, base[1] - topBar - fh));
    const bu = this.buoy;
    const tx = -clamp(this.walkVel * 0.09, -H * 0.1, H * 0.1) * this.own - clamp(sc.v * 0.5, -14, 14) * this.own + Math.sin(t * 0.8) * H * 0.006
      - (1 - this.own) * len * 0.1 * Math.sign(-L.landDx);   // waiting on the anchor, it drifts off to Snap's side of the chain
    if (!bu.set) { bu.x = tx; bu.vx = 0; bu.set = true; }
    const st = Math.min(dt, 1 / 30);
    bu.vx += ((tx - bu.x) * 30 - bu.vx * 6.5) * st;
    bu.x += bu.vx * st;
    // the line does not stretch: the float is always its length from the foot
    const tilt = clamp(bu.x / len, -0.6, 0.6);
    const fx0 = base[0] + tilt * len, fy0 = base[1] - Math.sqrt(1 - tilt * tilt) * len + Math.sin(t * 1.5) * H * 0.004;
    const lineLink = linkLen * 0.6 * lz;
    this.line.update(dt, t, { ax: fx0, ay: fy0, len, tail: lineLink * 0.72 * 2.4, holds: [{ i: 40, x: base[0], y: base[1] }], sway: sc.v, mouse: this.mouse, visible: this.lineVis > 0.01, opacity: this.lineVis, linkLen: lineLink, slack: 0.985 });
    this.float.grade(grade[0] * 0.94, grade[1], grade[2]);
    this.float.put(fx0 - lm.ring[0] * fw, fy0 - lm.ring[1] * fh, fw, fh, this.lineVis);

    // A pier post passes close to the camera on the walk to the shallows, where the two places meet.
    const pm = media.post;
    const ph = H * 1.7, pw = Math.min(ph * (pm.w / pm.h) * 1.5, W * (this.phone ? 0.46 : 0.3));
    this.post.put(seam !== null && inPlunge ? W / 2 + (seam - W / 2) * 1.22 - pw / 2 : -9999, -H * 0.3, pw, ph, seam !== null && inPlunge ? 1 : 0);

    // Bubbles: the plunge, the glide into the reef and the wreck, and Snap on fast scrolls.
    if (((p1 > 0.01 && p1 < DESC * 0.7) || (q2 > 0.05 && q2 < 0.5 && !inWreck) || (inT3 && q3 > 0.05 && q3 < 0.6) || (inT4 && q4 > 0.05 && q4 < 0.6)) && Math.random() < 0.9) this.bubbles.emit(W * (0.2 + Math.random() * 0.6), H * (0.75 + Math.random() * 0.35), H * 0.012, 3);
    if (ride && !inReef && p1 > 0.15 && Math.abs(sc.v) > 6 && Math.random() < 0.6) this.bubbles.emit(ride.top[0] + chainBody * 0.3, ride.top[1], H * 0.008);
    if (walking && Math.abs(ground?.vel ?? 0) > 400 && Math.random() < 0.25) this.bubbles.emit((ground?.feet[0] ?? 0) + (Math.random() - 0.5) * reefBody * 0.6, (ground?.feet[1] ?? 0) - reefBody * 0.1, H * 0.006);
    this.bubbles.update(dt);
    this.splash.update(dt);

    // The tags hang along his line, from the float down to his claw, and the source just below it.
    const lineArc = this.line.holdArc(0) ?? len;
    for (const [key, f] of Object.entries(LINE_TAGS) as [keyof typeof LINE_TAGS, number][]) {
      this.out.tags[key] = this.line.at(key === 'src' ? lineArc + this.line.pitch * 1.7 : f * lineArc);
    }
    // The tags show once he has reached the shallows with it: on the way there the line swings about and a pier post passes in front.
    const carried = smooth(0.6, 0.95, this.own) * (p1 < 1 ? smooth(0.8, 0.98, wk) : 1);
    this.out.tagsOn = !lineOn ? 0
      : inVents ? (walking ? smooth(0.9, 1, land6) : 0)
      : inReef ? (walking ? smooth(0.45, 0.7, kR) * (1 - ret) * (1 - 0.85 * (this.phone ? Math.max(...(reefOut?.near.slice(1, 5) ?? [0])) : reefOut?.near[2] ?? 0)) : 0)
      : cabinOn > 0 ? cabinOn
      : twiOn > 0 ? twiOn
      : inAscent ? 1 - smooth(0.3, 0.8, reveal)
      : opening ? carried
      : inT2 ? 1 - smooth(0.0, 0.25, q2) : 0;

    // The format fish in the shallows.
    const tag = this.out.tags.fmt;
    this.fish.update(dt, t, { vis: s1On, w: W, h: H, tag: [tag.x, tag.y], mouse: this.mouse, grade });

    // The kelp forest: foreground stalks, and the little fish in the line.
    // the forest's edge passes close to the camera on the walk in, where the two places meet
    this.kelp.update(t, { vis: s2On, w: W, h: H, mouse: this.mouse, edge: inJoin && seam !== null ? W / 2 + (seam - W / 2) * 1.2 : null });
    if (y < d0 && this.net.state !== 'tangled') { this.net.reset(); this.freeAsked = false; }
    const top = rest;
    const wasTangled = this.net.state === 'tangled';
    this.net.update(dt, t, {
      vis: inReef ? 0 : Math.max(s2On, inT2 ? 1 - smooth(0.1, 0.5, q2) : 0), hold: [top[0], top[1]], size: H * 0.034,
      follow: 1, auto: this.freeAsked || kS2 > 0.75,
    });
    if (wasTangled && this.net.state !== 'tangled') this.kindUntil = t + 5;
    this.out.fish = { x: this.net.at.x, y: this.net.at.y, on: this.net.at.on && s2On > 0.6 };
    this.out.kindOn = t < this.kindUntil && s2On > 0.2;

    // Depth gauge.
    const zone: ZoneId = k < s0h ? 's0' : p1 < WALK ? 't1' : d12 < 0.5 ? 's1' : !inT2 ? 's2' : y < sec.s3.top ? 't2'
      : y < sec.s3b.top - 0.5 * H ? 's3' : y < sec.s4.top - 0.2 * H ? 's3b' : !inT3 ? 's4' : q3 < 1 ? 't3' : !inT4 ? 's4b' : q4 < 1 ? 't4'
      : !inVents && !inAscent ? 's5' : inVents ? 's6' : reveal < 0.9 ? 't5' : 's7';
    this.out.zone = zone;
    // The gauge spins through the drop, slow at first, then fast, then settling at the twilight zone.
    this.out.depth = k < s0h ? 0 : p1 < 1 ? -5 * desc : !inT2 ? -5 - 10 * d12 : !inWreck ? -15 - 15 * q2
      : !inT4 ? -30 - 30 * smooth(0, 1, dW) : q4 < 1 ? -60 - 440 * easeInOut(q4)
      : u6 < -0.8 ? -500 - 500 * smooth(0, 1, k5) : !inAscent ? -1000 - 1500 * smooth(-0.8, 1.1, u6)
      : -2500 * (1 - easeInOut(clamp((q5 - 0.07) / 0.85)));
    this.out.storyOn = this.snap.state === 'gust' || this.snap.state === 'surprised' || this.snap.state === 'hop';
    this.out.z1 = z1c;
    this.out.z2 = z2c;
    this.out.s1On = s1On;
    this.out.s2On = s2On;
    this.out.reef = reefOut;

    this.cabin(dt, t, { z4c, cabinOn, fC, grade, ride: !!ride, H, W });
    this.dusk(dt, t, { twiOn, k5, warm, cover: z5c, H, W });
    const geode: [number, number, number] = z6c ? [...this.spot('z6', z6c, VENTS.geode[0], VENTS.geode[1]), VENTS.geodeH * z6c.dh] : [W * 0.5, H * 0.8, H * 0.3];
    this.vents.update(dt, t, { vis: ventsOn, geode, taken, w: W, h: H, mouse: this.mouse, startle: this.ventsLanded > 0 && t - this.ventsLanded < 1.4 });
    this.out.vents = { z6: z6c, on: ventsOn, taken };
    // The way up: the print rides beside Snap's free claw; at the surface, once he is home and the receipt is up, he takes its picture.
    const claw: [number, number] = this.snap.use3d && this.snap.riding ? this.snap.rider.snap3d.freeClaw() : [holdX + chainBody * 0.55, holdY + chainBody * 0.35];
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
    this.out.ascent = { on: inT4 && y >= sec.t5.top - 0.2 * H ? clamp(Math.max(winch, bands)) * (1 - smooth(0.88, 0.98, q5)) : 0, q: q5, claw, reveal, flashAt: this.out.ascent.flashAt };
    // A beam from the wreck drifts up past the camera on the way down to it.
    this.debris.update(t, { k: (dW - 0.08) / 0.55, vis: inWreck && !inT3 ? 1 : 0, w: W, h: H, mouse: this.mouse });
    s.render();
  }
}
