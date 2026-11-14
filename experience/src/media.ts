import manifest from '../../preview/dive/media/manifest.json';

export type Box = [number, number, number, number];
export interface Clip { w: number; h: number; duration: number; box: Box; boxEnd: Box; crop: [number, number]; print?: number[][] }
/** rect: for a crop of another plate, its box there (u0, v0, u1, v1), so the two can be laid exactly over each other. */
export interface Plate { w: number; h: number; widths: number[]; waterline?: number; thumbhash?: string; rect?: [number, number, number, number] }
export interface Seq { frames: number; fps: number; d: [number, number]; p: [number, number]; bytes: { d: number; p: number }; packs: { d: number[][]; p: number[][] } }

export const media = manifest as unknown as {
  plates: Record<'z0' | 'z0p' | 'z0u' | 'z0up' | 'z1' | 'z1p' | 'z2' | 'z2p' | 'z3' | 'z3p' | 'z3_2' | 'z3_2p' | 'z3_3' | 'z3_3p' | 'z3_4' | 'z3_4p' | 'z3_4c' | 'z3b' | 'z3bp' | 'z4x' | 'z4xp' | 'z4' | 'z4p' | 'z5' | 'z5p' | 'z5lit' | 'z5litp' | 'z6' | 'z6p' | 'z7' | 'z7p', Plate>;
  snapChain: { w: number; h: number; chainX: number; chainTop: number; chainBottom: number; linkLen: number };
  snapStand: { w: number; h: number };
  print: { w: number; h: number };
  fish: { w: number; h: number; rects: Record<string, [number, number, number, number]> };
  seagrass: { w: number; h: number };
  kelp: { w: number; h: number };
  coral: { w: number; h: number };
  /** A pier post, out of focus, for the foreground of the way from under the pier to the shallows. */
  post: { w: number; h: number };
  /** The anchor the chain ends on: its ring (the chain's end) and where it meets the sand, as shares of the sprite. */
  anchor: { w: number; h: number; ring: [number, number]; ground: number };
  /**
   * The submarine (it faces right). As shares of the sprite: the glass
   * bubble he sits in (its middle, and its radius as a share of the width),
   * the lid of its hatch, its lamp, the tips of its near pincer and the hub
   * of its propeller.
   */
  sub: { w: number; h: number; bubble: [number, number, number]; hatch: [number, number]; lamp: [number, number]; claw: [number, number]; prop: [number, number] };
  /** The transitions: frames, their size on desktop (d) and phones (p), and the byte lengths of the frames in each of their packs. */
  t2: Seq; t3: Seq; t4: Seq;
  /** The tube worms of the vents, cut out. */
  worms: { w: number; h: number };
  /** The glowing jellyfish of the twilight zone, on black (it is added to the light). */
  glowJelly: { w: number; h: number };
  /** The barnacled beam (a foreground cutout in the wreck). */
  beam: { w: number; h: number };
  /** The octopus with its letter; seal is where the wax goes on the envelope's flap, envelope its box, as shares of the sprite. */
  octopus: { w: number; h: number; seal: [number, number]; envelope: [number, number, number, number] };
  /** Snap on the pier, filmed: the wave, the gust and the hop, for when the 3D model will not load. */
  clips: Record<'m01' | 'm02' | 'm03', Clip>;
  /**
   * Snap in 3D (snap-3d.txt: base64 of a deflated pack of n vertices'
   * positions over the box lo to hi, normals, uvs and rig bytes, then the
   * triangles; snap3d.ts reads it, encode-media.py writes it), in his rig
   * frame: x right, y up, z toward the viewer, in his heights, from a point
   * in his raised claw. box is his front view's
   * box (x0, y0, x1, y1); limbs are the two eye stalks, the raised claw
   * (clawL), the other claw and the
   * legs, each with the point it swings about, its direction and reach; eyes
   * are the eye balls' centres and radii and the way their beads look.
   */
  snap3d: {
    view: [number, number, number]; n: number; tris: number;
    lo: [number, number, number]; hi: [number, number, number]; box: [number, number, number, number];
    limbs: { kind: 'stalk' | 'clawL' | 'clawR' | 'leg'; pivot: [number, number, number]; dir: [number, number, number]; reach: number }[];
    eyes: { c: [number, number, number]; r: number; look: [number, number, number] }[];
    /** How many bits each position and uv is stored with. */
    bits: number;
    bytes: number; textureBytes: { avif: number; webp: number }; smallTextureBytes: { avif: number; webp: number };
  };
};

const base = new URL('media/', document.baseURI);
export const url = (name: string) => new URL(name, base).href;

// AVIF support, probed once with a 1×1 image.
const AVIF_1PX = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAJQAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAAQAAAAEAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAALW1kYXQSAAoIGAAGiAhoNCAyFxlHh4Yhh5555oAAAJBAyRjbu51tkhGY';
let avif: Promise<boolean> | null = null;
export function avifSupported(): Promise<boolean> {
  avif ??= new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img.width > 0);
    img.onerror = () => res(false);
    img.src = AVIF_1PX;
  });
  return avif;
}

/** The plate width to load for a cover-fit of the viewport at this pixel ratio. */
export function plateWidth(p: Plate, vw: number, vh: number, dpr: number) {
  const coverW = Math.max(vw, vh * (p.w / p.h)) * dpr * 1.08;
  return p.widths.find((w) => w >= coverW * 0.9) ?? p.widths[p.widths.length - 1];
}

export async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  return img;
}

/** An image in the best supported format: AVIF, else WebP. */
export async function loadPicture(name: string) {
  return loadImage(url(`${name}.${(await avifSupported()) ? 'avif' : 'webp'}`));
}

export function makeVideo(name: string, loop: boolean): HTMLVideoElement {
  const v = document.createElement('video');
  v.muted = true;
  v.defaultMuted = true;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.loop = loop;
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  v.src = url(name);
  return v;
}

/**
 * The ambient loops come in three codecs: AV1 (the smallest), HEVC, and
 * H.264, which everything plays. This is the order to try them in here. On
 * a phone only a codec the chip decodes is worth its smaller file: decoding
 * in software would take the processor and the battery the page needs.
 */
export type LoopCodec = 'av1' | 'hevc' | 'h264';
// What is asked about: the largest loop each kind of screen gets, at the levels the encodes carry.
const LOOP_ASK = {
  wide: { width: 1600, height: 678, av1: 'video/mp4; codecs="av01.0.08M.08"', hevc: 'video/mp4; codecs="hvc1.1.6.L120.B0"' },
  phone: { width: 720, height: 1294, av1: 'video/mp4; codecs="av01.0.05M.08"', hevc: 'video/mp4; codecs="hvc1.1.6.L93.B0"' },
};
const LOOP_FILE: Record<LoopCodec, string> = { av1: '.av1.mp4', hevc: '.hevc.mp4', h264: '.mp4' };
let codecs: Promise<LoopCodec[]> | null = null;
export function loopCodecs(phone: boolean): Promise<LoopCodec[]> {
  codecs ??= (async () => {
    const probe = document.createElement('video');
    const ask = LOOP_ASK[phone ? 'phone' : 'wide'];
    const plays = async (c: 'av1' | 'hevc') => {
      const contentType = ask[c];
      try {
        const info = await navigator.mediaCapabilities.decodingInfo({ type: 'file', video: { contentType, width: ask.width, height: ask.height, bitrate: 800_000, framerate: 24 } });
        return info.supported && info.smooth && (!phone || info.powerEfficient);
      } catch {
        return !phone && probe.canPlayType(contentType) === 'probably';
      }
    };
    const list: LoopCodec[] = [];
    if (await plays('av1')) list.push('av1');
    if (await plays('hevc')) list.push('hevc');
    list.push('h264');
    return list;
  })();
  return codecs;
}

/** A loop in the first of those codecs; if that one fails after all, the next. */
export function makeLoop(base: string, order: LoopCodec[]): HTMLVideoElement {
  let i = 0;
  const v = makeVideo(base + LOOP_FILE[order[0]], true);
  v.addEventListener('error', () => {
    if (++i >= order.length) return;
    v.src = url(base + LOOP_FILE[order[i]]);
    v.load();
  });
  return v;
}

/** The bytes of base64 text: by the browser's own decoder where it has one, else through atob. */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const native = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array<ArrayBuffer> }).fromBase64;
  if (native) return native.call(Uint8Array, text);
  const bin = atob(text), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Whether this browser can decode a picture's bytes straight to a bitmap,
 * off the main thread, and turned upside down as a texture wants it (an
 * upload does not flip a bitmap). Asked once, with a picture of two pixels,
 * red over blue: a browser that takes the option and leaves the picture as
 * it was would show every frame decoded this way upside down.
 */
let flips: Promise<boolean> | null = null;
export function bitmapsFlip(): Promise<boolean> {
  flips ??= (async () => {
    try {
      const png = fromBase64('iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAIAAAAW4yFwAAAAEElEQVR42mP4z8DAwMDwHwAIAAH/72AS3AAAAABJRU5ErkJggg==');
      const bmp = await createImageBitmap(new Blob([png], { type: 'image/png' }), { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      const c = document.createElement('canvas');
      c.width = 1; c.height = 2;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(bmp, 0, 0);
      const top = g.getImageData(0, 0, 1, 1).data;
      bmp.close();
      return top[2] > 200 && top[0] < 50;   // blue came out on top
    } catch {
      return false;
    }
  })();
  return flips;
}

/** Inflate zlib-wrapped bytes: with the browser's own decompressor, or, where there is none, a small one in script. */
export async function inflate(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  if ('DecompressionStream' in self) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return (await import('fflate')).unzlibSync(bytes);
}

/** The visitor has asked their browser to save data: the page then leaves out what it can do without. */
export const saveData = () => !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;

export function whenPlayable(v: HTMLVideoElement): Promise<void> {
  return new Promise((res) => {
    if (v.readyState >= 3) return res();
    v.addEventListener('canplay', () => res(), { once: true });
  });
}
