import type { WorldOut } from './world';
import type { Recipe } from './twilight-ui';

const LOOK_SEG = { crisp: 'sharpen(1.2):saturation(1.1)', deep: 'duotone(0d202e,ffd88a)', vintage: 'sepia' };
const CROP_SEG = { wide: 'crop:1200x630:smart', square: 'crop:760x760:smart', whole: 'fit-in:1200x630' };
const FINISH_SEG = { none: '', studio: 'studio(product,bg:brand,shadow:soft,pad:10)', cutout: 'removebg' };
/**
 * The ascent's steps, in the order the server works through a URL: the
 * crop, the filters as written (the look, then the finish), the format it
 * encodes to, and last the signature. Each goes onto the print at this share
 * of the climb.
 */
const STEPS = [
  { at: 0.14, cls: 's-crop' },
  { at: 0.3, cls: 's-look' },
  { at: 0.46, cls: 's-finish' },
  { at: 0.62, cls: 's-fmt' },
  { at: 0.78, cls: 's-seal' },
] as const;
type Step = (typeof STEPS)[number]['cls'];

/**
 * The way up and the finale in the DOM: the print hanging from the
 * submarine's pincer, which takes on the visitor's choices one by one on the
 * way up while their URL prints under it, a line for each part as it is
 * applied; and at the surface the receipt (that URL whole, a copy button and
 * the picture) and the polaroid that drops in when Snap takes its picture.
 */
export class SurfaceUI {
  private print = document.getElementById('ascent-print')!;
  private frame = document.getElementById('ap-frame')!;
  private lines = document.getElementById('ap-lines')!;
  private images = [...document.querySelectorAll<HTMLElement>('.recipe-img')];
  private polaroid = document.getElementById('polaroid')!;
  private flash = document.getElementById('flash')!;
  private copy = document.getElementById('copy-url') as HTMLButtonElement;
  private recipe: Recipe | null = null;
  private shown = -2;
  private flashSeen = -10;
  private armed = false;

  constructor() {
    // The finished picture: everything applied.
    for (const el of [document.getElementById('receipt-img')!, document.getElementById('pol-img')!]) el.classList.add(...STEPS.map((s) => s.cls));
    this.copy.addEventListener('click', async () => {
      const text = document.getElementById('url-so-far')!.textContent ?? '';
      try { await navigator.clipboard.writeText(text); this.copy.textContent = 'Copied'; this.copy.classList.add('done'); } catch { this.copy.textContent = 'Select it'; }
      setTimeout(() => { this.copy.textContent = 'Copy'; this.copy.classList.remove('done'); }, 1600);
    });
    // Without the moving world the polaroid simply lies there.
    if (!document.documentElement.classList.contains('gl')) this.polaroid.classList.add('drop');
  }

  setRecipe(r: Recipe) {
    this.recipe = r;
    for (const el of this.images) {
      el.dataset.look = r.look; el.dataset.crop = r.crop; el.dataset.finish = r.finish; el.dataset.sealed = String(r.sealed); el.dataset.fmt = r.fmt;
    }
    this.shown = -2;
  }

  /**
   * The URL as far as it has been applied: its lines top to bottom as the URL
   * reads (each path segment starts with a slash, each filter after the first
   * with a colon), the one just added marked. Sealed, at the last step the
   * whole recipe folds into one token.
   */
  private ticket(n: number) {
    const r = this.recipe!;
    const done = (c: Step) => STEPS.findIndex((s) => s.cls === c) <= n;
    const latest = n >= 0 ? STEPS[n].cls : 'source';
    const rows: { text: string; of: string; mute?: boolean }[] = [];
    if (done('s-seal') && r.sealed) return [{ text: `s1.${r.token.slice(0, 12)}…`, of: 's-seal', now: true, mute: false }, { text: '/print.jpg', of: 'source', now: false, mute: false }];
    if (done('s-seal')) rows.push({ text: '3c1f6c18…', of: 's-seal' });
    if (done('s-crop')) rows.push({ text: `/${CROP_SEG[r.crop]}`, of: 's-crop' });
    if (done('s-look')) rows.push({ text: `/filters:${LOOK_SEG[r.look]}`, of: 's-look' });
    if (done('s-finish')) rows.push(FINISH_SEG[r.finish] ? { text: `:${FINISH_SEG[r.finish]}`, of: 's-finish' } : { text: 'no finish', of: 's-finish', mute: true });
    if (done('s-fmt')) rows.push(r.fmt === 'auto' ? { text: 'no format: Accept picks AVIF', of: 's-fmt', mute: true } : { text: `:format(${r.fmt})`, of: 's-fmt' });
    rows.push({ text: '/root:photos/print.jpg', of: 'source' });
    return rows.map((row) => ({ ...row, now: row.of === latest, mute: !!row.mute }));
  }

  update(out: WorldOut) {
    const a = out.ascent;
    // Nearly there: now the print and the polaroid are laid out (and their pictures fetched).
    if (!this.armed && (out.vents.on > 0 || a.on > 0 || out.zone === 't5' || out.zone === 's7')) {
      this.armed = true;
      this.print.classList.add('armed');
      this.polaroid.classList.add('armed');
    }
    const on = a.on > 0.3 && !!this.recipe;
    this.print.classList.toggle('on', on);
    if (on) {
      // It hangs from the submarine's pincer by its top corner, kept on screen.
      // (and its ticket, however long, stays above the bottom edge: on a short screen the print rides a little higher)
      const w = this.print.offsetWidth, right = innerWidth - w - 14;
      const x = Math.min(a.at[0] - 10, right), y = Math.min(a.at[1] - 6, innerHeight - this.print.offsetHeight - 10);
      this.print.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      // the steps done so far go onto the picture, and their lines onto the URL under it
      let n = -1;
      STEPS.forEach((s, i) => { const done = a.q >= s.at; this.frame.classList.toggle(s.cls, done); if (done) n = i; });
      if (n !== this.shown) {
        this.shown = n;
        this.lines.replaceChildren(...this.ticket(n).map((row) => {
          const li = document.createElement('li');
          // (a long line breaks after a colon or a comma, not in the middle of a word)
          const parts = row.text.match(/[^:,]+[:,]?|[:,]/g) ?? [row.text];
          if (parts.length > 1 && parts[0].length === 1) parts.splice(0, 2, parts[0] + parts[1]);
          parts.forEach((part, i) => { if (i) li.append(document.createElement('wbr')); li.append(part); });
          if (row.now) li.className = 'now';
          if (row.mute) li.classList.add('mute');
          if (row.text.startsWith(':')) li.classList.add('more');
          return li;
        }));
      }
    }

    // The finale: his claw clicks, a flash, and the polaroid drops in.
    if (a.flashAt !== this.flashSeen && a.flashAt > 0) {
      this.flashSeen = a.flashAt;
      this.flash.classList.remove('go'); void this.flash.offsetWidth; this.flash.classList.add('go');
      this.polaroid.classList.add('drop');
    }
    if (out.zone !== 's7' && document.documentElement.classList.contains('gl')) this.polaroid.classList.remove('drop');
  }
}
