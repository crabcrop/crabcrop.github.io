import manifest from '../../preview/dive/media/manifest.json';

export type Box = [number, number, number, number];
export interface Clip { w: number; h: number; duration: number; box: Box; boxEnd: Box; crop: [number, number]; print?: number[][]; claw?: number[][]; clicks?: number[] }
export interface Plate { w: number; h: number; widths: number[]; waterline?: number; thumbhash: string }
export interface Seq { frames: number; fps: number; d: [number, number]; p: [number, number]; bytes: { d: number; p: number }; packs: { d: number[][]; p: number[][] } }

export const media = manifest as unknown as {
  plates: Record<'z0' | 'z0p' | 'z1' | 'z1p' | 'z2' | 'z2p' | 'z3' | 'z3p' | 'z3_2' | 'z3_2p' | 'z3_3' | 'z3_3p' | 'z3_4' | 'z3_4p' | 'z3_4c' | 'z3b' | 'z3bp' | 'z4x' | 'z4xp' | 'z4' | 'z4p' | 'z5' | 'z5p' | 'z5lit' | 'z5litp' | 'z6' | 'z6p', Plate>;
  snapChain: { w: number; h: number; chainX: number; chainTop: number; chainBottom: number; linkLen: number };
  snapStand: { w: number; h: number };
  print: { w: number; h: number };
  fish: { w: number; h: number; rects: Record<string, [number, number, number, number]> };
  seagrass: { w: number; h: number };
  kelp: { w: number; h: number };
  coral: { w: number; h: number };
  /** The transitions: frames, their size on desktop (d) and phones (p), and the byte lengths of the frames in each of their packs. */
  t1: Seq; t2: Seq; t3: Seq; t4: Seq;
  /** The tube worms of the vents, cut out. */
  worms: { w: number; h: number };
  /** The glowing jellyfish of the twilight zone, on black (it is added to the light). */
  glowJelly: { w: number; h: number };
  /** The barnacled beam (a foreground cutout in the wreck). */
  beam: { w: number; h: number };
  /** The octopus with its letter; seal is where the wax goes on the envelope's flap, envelope its box, as shares of the sprite. */
  octopus: { w: number; h: number; seal: [number, number]; envelope: [number, number, number, number] };
  clips: Record<'m01' | 'm02' | 'm03' | 'm04' | 'm05', Clip>;
  /**
   * Snap riding the chain, filmed (one crop for all three clips). origin is
   * the pose-2 sprite's chain point in the frame and scale the frame's height
   * in sprite heights, so the two line up; held is the stretch of chain left
   * in the film (top and bottom, shares of the height). Per clip, track rows
   * are [t, x at the top, x at the bottom] of that stretch and eyes rows
   * [t, xA, yA, xB, yB, open], all shares of the frame (y down).
   */
  ride: {
    w: number; h: number; fps: number; origin: [number, number]; scale: number; held: [number, number]; eyeR: number;
    clips: Record<'m10' | 'm11' | 'm12', { duration: number; bytes: number; track: number[][]; eyes: number[][] }>;
  };
  /**
   * Snap in 3D (snap-3d.txt, base64 of n vertices' int16 positions over the
   * box lo to hi, int8 normals, uint16 uvs and rig bytes, then the triangles'
   * uint16 indices), in his rig frame: x right, y up, z toward the viewer, in
   * his heights on the chain, from the point in his raised claw the chain
   * runs through. box is his front view's box (x0, y0, x1, y1); limbs are
   * the two eye stalks, the claw on the chain (clawL), the other claw and the
   * legs, each with the point it swings about, its direction and reach; eyes
   * are the eye balls' centres and radii and the way their beads look.
   */
  snap3d: {
    view: [number, number, number]; n: number; tris: number;
    lo: [number, number, number]; hi: [number, number, number]; box: [number, number, number, number];
    limbs: { kind: 'stalk' | 'clawL' | 'clawR' | 'leg'; pivot: [number, number, number]; dir: [number, number, number]; reach: number }[];
    eyes: { c: [number, number, number]; r: number; look: [number, number, number] }[];
    bytes: number; textureBytes: { avif: number; webp: number };
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

export function whenPlayable(v: HTMLVideoElement): Promise<void> {
  return new Promise((res) => {
    if (v.readyState >= 3) return res();
    v.addEventListener('canplay', () => res(), { once: true });
  });
}
