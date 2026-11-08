import Lenis from 'lenis';

export type SectionId = 's0' | 't1' | 's1' | 's2' | 't2' | 'next';
const IDS: SectionId[] = ['s0', 't1', 's1', 's2', 't2', 'next'];

/** Native scroll, smoothed by Lenis when motion is allowed. */
export class Scroll {
  readonly lenis: Lenis | null;
  y = 0;
  v = 0;
  readonly sec = {} as Record<SectionId, { top: number; h: number }>;

  constructor(smooth: boolean) {
    this.lenis = smooth ? new Lenis({ autoRaf: false, lerp: 0.11, anchors: { offset: 0 } }) : null;
    this.measure();
    this.y = scrollY;
  }

  measure() {
    for (const id of IDS) {
      const el = document.getElementById(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      this.sec[id] = { top: r.top + scrollY, h: r.height };
    }
  }

  update(time: number) {
    if (this.lenis) {
      this.lenis.raf(time);
      this.y = this.lenis.animatedScroll;
      this.v = this.lenis.velocity;
    } else {
      const y = scrollY;
      this.v = y - this.y;
      this.y = y;
    }
  }

  /** Scroll relative to a section's top, in viewport heights. */
  at(id: SectionId, vh: number) {
    return (this.y - this.sec[id].top) / vh;
  }

  /** 0 when the section's top reaches the viewport top, 1 when its bottom does. */
  p(id: SectionId) {
    const s = this.sec[id];
    return (this.y - s.top) / s.h;
  }

  to(target: string | number) {
    if (this.lenis) this.lenis.scrollTo(target as string);
    else if (typeof target === 'number') scrollTo({ top: target });
    else document.querySelector(target)?.scrollIntoView();
  }
}

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
