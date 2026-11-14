import type { WorldOut } from './world';
import type { Recipe } from './twilight-ui';

const LOOK_SEG = { crisp: 'sharpen(1.2):saturation(1.1)', deep: 'duotone(0d202e,ffd88a)', vintage: 'sepia' };
const CROP_SEG = { wide: 'crop:1200x630:smart', square: 'crop:760x760:smart', whole: 'fit-in:1200x630' };
const FINISH_SEG = { none: '', studio: 'studio(product,bg:brand,shadow:soft,pad:10)', cutout: 'removebg' };
/** The ascent's steps: where in the climb each choice goes on, and the tag on his line that lights up for it. */
const STEPS = [
  { at: 0.14, cls: 's-fmt', tag: 1 },
  { at: 0.3, cls: 's-look', tag: 2 },
  { at: 0.46, cls: 's-crop', tag: 3 },
  { at: 0.62, cls: 's-finish', tag: 4 },
  { at: 0.78, cls: 's-seal', tag: 0 },
] as const;

/**
 * The way up and the finale in the DOM: the print riding beside Snap that
 * takes on the visitor's choices one by one as the submarine carries him up
 * (its tag on his line lighting up), and at the surface the receipt (the URL,
 * a copy button and the picture) and the polaroid that drops in when Snap
 * takes its picture.
 */
export class SurfaceUI {
  private print = document.getElementById('ascent-print')!;
  private frame = document.getElementById('ap-frame')!;
  private step = document.getElementById('ap-step')!;
  private images = [...document.querySelectorAll<HTMLElement>('.recipe-img')];
  private chainTags = [...document.querySelectorAll<HTMLElement>('#tags .tag')];
  private polaroid = document.getElementById('polaroid')!;
  private flash = document.getElementById('flash')!;
  private copy = document.getElementById('copy-url') as HTMLButtonElement;
  private recipe: Recipe | null = null;
  private shown = -1;
  private flashSeen = -10;

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
    this.shown = -1;
  }

  private caption(i: number) {
    const r = this.recipe!;
    switch (STEPS[i].cls) {
      case 's-fmt': return r.fmt === 'auto' ? 'format: Accept picks AVIF' : `format(${r.fmt})`;
      case 's-look': return `filters:${LOOK_SEG[r.look]}`;
      case 's-crop': return CROP_SEG[r.crop];
      case 's-finish': return FINISH_SEG[r.finish] || 'no finish';
      default: return r.sealed ? `sealed: s1.${r.token.slice(0, 8)}…` : 'readable, signed';
    }
  }

  update(out: WorldOut, t: number, wide: boolean) {
    const a = out.ascent;
    const on = a.on > 0.3 && !!this.recipe;
    this.print.classList.toggle('on', on);
    if (on) {
      // On wide screens held up beside his free claw: clear of his eyes, and its lower edge above the submarine
      // under him (it stays there as the picture changes size). On phones at the right, clear of the tags on his line.
      const w = this.print.offsetWidth, right = innerWidth - w - 14;
      const x = wide ? Math.min(a.claw[0] + 60, right) : right;
      const y = wide ? a.claw[1] + 70 - this.frame.offsetHeight : a.claw[1] - 30;
      this.print.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      // the steps done so far, the latest named under the picture and lit on his line
      let n = -1;
      STEPS.forEach((s, i) => { const done = a.q >= s.at; this.frame.classList.toggle(s.cls, done); if (done) n = i; });
      if (n !== this.shown) {
        this.shown = n;
        this.step.textContent = n >= 0 ? this.caption(n) : 'root:photos/print.jpg';
        this.step.classList.remove('pop'); void this.step.offsetWidth; this.step.classList.add('pop');
      }
      this.chainTags.forEach((el, i) => el.classList.toggle('lit', n >= 0 && STEPS[n].tag === i));
    } else if (this.shown !== -2) {
      this.shown = -2;
      this.chainTags.forEach((el) => el.classList.remove('lit'));
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
