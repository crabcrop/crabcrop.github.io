/**
 * Room for the cues. A cue sits by the thing it is about, and near the right edge of a narrow window its label
 * would run out of the view. So the label gives way and the yarn stays on the thing. A label's width is measured
 * once and kept: nothing here reads the layout while the page scrolls.
 */
const EDGE = 12;
interface Fit { w: number; knot: number; last: number }
const fits = new Map<HTMLElement, Fit>();
const fitOf = (el: HTMLElement, knot: () => number) => {
  let f = fits.get(el);
  if (!f) fits.set(el, (f = { w: 0, knot: knot(), last: NaN }));
  if (!f.w) f.w = el.offsetWidth;
  return f;
};

/** A cue tied above or below its thing: the label slides back along its yarn. x: where the thing is across the screen, px. */
export function keepIn(el: HTMLElement, x: number) {
  const f = fitOf(el, () => parseFloat(getComputedStyle(el).getPropertyValue('--knot')) || 0);
  // (never further than the yarn can follow: it stays on the label's edge, clear of the round corner)
  const slide = Math.round(Math.max(0, Math.min(x - f.knot + f.w - (innerWidth - EDGE), f.w - f.knot - 26)));
  if (slide === f.last) return;
  f.last = slide;
  el.style.setProperty('--slide', `${slide}px`);
}

/**
 * A cue that is a button beside its thing: to the right of it while there is room, else under it, as far along as
 * the view allows. x: the thing; reach: how far to its right the button starts. Returns whether it went under.
 */
export function beside(el: HTMLElement, x: number, reach: number) {
  const f = fitOf(el, () => 0);
  const under = x + reach + f.w > innerWidth - EDGE;
  const knot = under ? Math.round(Math.max(26, Math.min(f.w - 26, x + f.w - (innerWidth - EDGE)))) : -1;
  if (knot !== f.last) {
    f.last = knot;
    el.classList.toggle('under', under);
    if (under) el.style.setProperty('--knot', `${knot}px`);
  }
  return under;
}

/** A label's width changes with its words (asked, then done), with the fonts and with the window: measure it again. */
export function remeasure(el?: HTMLElement) {
  if (el) { const f = fits.get(el); if (f) f.w = 0; } else fits.forEach((f) => (f.w = 0));
}
