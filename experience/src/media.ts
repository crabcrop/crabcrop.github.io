import manifest from '../../preview/dive/media/manifest.json';

export type Box = [number, number, number, number];
export interface Clip { w: number; h: number; duration: number; box: Box; boxEnd: Box; crop: [number, number]; print?: number[][] }
export interface Plate { w: number; h: number; widths: number[]; waterline?: number; thumbhash: string }

export const media = manifest as unknown as {
  plates: Record<'z0' | 'z0p' | 'z1' | 'z1p' | 'z2' | 'z2p' | 'z3' | 'z3p', Plate>;
  snapChain: { w: number; h: number; chainX: number; chainTop: number; chainBottom: number; linkLen: number };
  snapStand: { w: number; h: number };
  print: { w: number; h: number };
  fish: { w: number; h: number; rects: Record<string, [number, number, number, number]> };
  seagrass: { w: number; h: number };
  kelp: { w: number; h: number };
  t1: { frames: number; fps: number; d: [number, number]; p: [number, number]; bytes: { d: number; p: number } };
  t2: { frames: number; fps: number; d: [number, number]; p: [number, number]; bytes: { d: number; p: number } };
  clips: Record<'m01' | 'm02' | 'm03', Clip>;
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
