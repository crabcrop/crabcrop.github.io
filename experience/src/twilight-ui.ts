import type { WorldOut } from './world';
import { showTag } from './ui';

/** The visitor's choices, as the twilight zone's demos need them. */
export interface Recipe {
  crop: 'wide' | 'square' | 'whole';
  look: 'crisp' | 'deep' | 'vintage';
  finish: 'none' | 'studio' | 'cutout';
  fmt: 'auto' | 'avif' | 'webp' | 'jxl';
  sealed: boolean;
  /** Operations and source, everything after the signature. */
  rest: string;
  token: string;
}

const CROP_GLOSS = { wide: 'a 1200×630 window, moved to the subject', square: 'a 760×760 window, moved to the subject', whole: 'fit inside 1200×630, nothing cut' };
const CROP_SIZE = { wide: [1200, 630], square: [760, 760], whole: [945, 630] };
const LOOK_GLOSS = { crisp: 'sharpen 1.2, then saturation 1.1', deep: 'duotone, from deep blue to sand', vintage: 'sepia' };
const FINISH_GLOSS = { none: '', studio: 'the product cut out onto a brand backdrop with a soft shadow, padded', cutout: 'the background removed' };
const FMT_NAME = { auto: 'AVIF', avif: 'AVIF', webp: 'WebP', jxl: 'JPEG XL' };
/** A label as alt text writes it. */
const NOUN: Record<string, string> = { jellyfish: 'glowing jellyfish', 'glowing worm': 'a glowing worm', 'message in a bottle': 'a message in a bottle', anglerfish: 'an anglerfish' };

/**
 * The twilight zone in the DOM: CLIP tags that light up next to the
 * creatures the visitor's light finds, the meta answer they add up to, the
 * explain report for the visitor's own URL, and the parts of that URL in the
 * bar explaining themselves, one after another, while the report is up.
 */
export class TwilightUI {
  private tagsList = document.getElementById('glow-tags')!;
  private tags = [...document.querySelectorAll<HTMLLIElement>('#glow-tags li')];
  private found = new Map<HTMLLIElement, number>();
  private seen = new Set<string>();
  private json = document.getElementById('meta-json')!;
  private altLine = document.getElementById('alt-line')!;
  private altText = document.getElementById('alt-text')!;
  private req = document.getElementById('explain-req')!;
  private report = document.getElementById('explain-report')!;
  private kind = document.getElementById('kind-fish')!;
  private chainTags = [...document.querySelectorAll<HTMLElement>('#tags .tag')];
  private saved: string[] | null = null;
  private recipe: Recipe | null = null;

  constructor(private wide: boolean) {
    // Without the moving light (a still page), every creature counts as found.
    if (!document.documentElement.classList.contains('gl')) for (const li of this.tags) this.seen.add(li.dataset.k!);
  }

  /** The visitor's recipe changed: the report, the meta size and format. */
  setRecipe(r: Recipe) {
    this.recipe = r;
    this.renderReport();
    this.renderJson();
  }

  /** What explain says about each part of the URL in the bar, by the part's id. */
  private glosses(r: Recipe): Record<string, string> {
    const inside = 'sealed inside the token';
    if (r.sealed) return { 'tag-sig': 'sealed: explain will not open it', 'tag-crop': inside, 'tag-look': inside, 'tag-finish': inside, 'tag-format': inside };
    return {
      'tag-sig': 'valid · key 1 · never expires',
      'tag-crop': CROP_GLOSS[r.crop],
      'tag-look': LOOK_GLOSS[r.look],
      'tag-finish': FINISH_GLOSS[r.finish] || 'no finish',
      'tag-format': r.fmt === 'auto' ? 'no format named: Accept picks AVIF' : `${FMT_NAME[r.fmt]} out`,
    };
  }

  private renderReport() {
    const r = this.recipe;
    if (!r) return;
    const rows: [string, string][] = [];
    if (r.sealed) {
      this.req.textContent = `GET /explain/s1.${r.token.slice(0, 10)}…/print.jpg`;
      rows.push(['403', 'explain refuses sealed URLs rather than decrypt them.'], ['to debug', 'unseal it locally, then explain the plain form.']);
    } else {
      this.req.textContent = `GET /explain/3c1f6c18…/${r.rest}`;
      const [w, h] = CROP_SIZE[r.crop];
      rows.push(
        ['signature', 'valid · key 1 · never expires'],
        ['source', 'root:photos/print.jpg · image · 2400 × 1600'],
        [r.crop === 'whole' ? 'fit-in' : 'crop', CROP_GLOSS[r.crop]],
        ['filters', [LOOK_GLOSS[r.look], FINISH_GLOSS[r.finish]].filter(Boolean).join(', then ')],
        ['format', r.fmt === 'auto' ? 'none named: the Accept header picks AVIF' : FMT_NAME[r.fmt]],
        ['forecast', `${w} × ${h} · ${FMT_NAME[r.fmt]}`],
      );
    }
    this.report.replaceChildren(...rows.flatMap(([k, v], i) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      dt.style.setProperty('--i', String(i));
      dd.style.setProperty('--i', String(i));
      return [dt, dd];
    }));
  }

  /** The meta answer: the picture's size and format from the recipe, the tags the light has found and their alt text. */
  private renderJson() {
    const r = this.recipe;
    const labels = [...this.seen];
    const scores: Record<string, number> = {};
    for (const li of this.tags) if (this.seen.has(li.dataset.k!)) scores[li.dataset.k!] = Math.max(scores[li.dataset.k!] ?? 0, Number(li.textContent!.trim().split(' ').pop()));
    const tags = labels.sort((a, b) => scores[b] - scores[a]).map((l) => `    { "label": "${l}", "score": ${scores[l].toFixed(2)} }`);
    const alt = this.alt();
    const [w, h] = r ? CROP_SIZE[r.crop] : [1200, 630];
    const fmt = r ? FMT_NAME[r.fmt].toLowerCase().replace('jpeg xl', 'jxl') : 'avif';
    this.json.textContent = `{\n  "width": ${w}, "height": ${h}, "format": "${fmt}",\n  "tags": [${tags.length ? `\n${tags.join(',\n')}\n  ` : ''}],\n  "alt_text": ${alt ? `"${alt}"` : 'null'}\n}`;
    this.altText.textContent = alt ?? '';
  }

  private alt() {
    const parts = [...this.seen].map((l) => NOUN[l] ?? l);
    if (!parts.length) return null;
    const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
    return `${list[0].toUpperCase()}${list.slice(1)} in the dark of the deep sea.`;
  }

  update(out: WorldOut, t: number) {
    const tw = out.twi;
    const on = tw.on > 0.6 && !!tw.z5;
    this.tagsList.classList.toggle('on', on);
    let added = false;
    if (on && tw.z5) {
      const z = tw.z5, [a, b] = tw.win, [lx, ly, lr] = tw.light;
      for (const li of this.tags) {
        const u = (Number(li.dataset.u) - a) / (b - a);
        const x = z.ox + u * z.dw, y = z.oy + Number(li.dataset.v) * z.dh;
        li.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        const lit = Math.hypot(x - lx, y - ly) < lr * 0.8 && u > 0.02 && u < 0.98;
        if (lit) {
          this.found.set(li, t);
          if (!this.seen.has(li.dataset.k!)) { this.seen.add(li.dataset.k!); added = true; }
        }
        // a found tag glows a while after the light moves on
        li.classList.toggle('lit', t - (this.found.get(li) ?? -10) < 1.6);
      }
    }
    if (added) this.renderJson();
    this.altLine.classList.toggle('on', on && this.wide && this.seen.size > 0);
    this.kind.classList.toggle('on', out.fishOn);

    // While the explain card is up, the parts of the URL in the bar explain themselves, one after another.
    const explaining = tw.explain && !!this.recipe;
    if (explaining && !this.saved) {
      this.saved = this.chainTags.map((el) => el.querySelector('span')!.textContent ?? '');
      const g = this.glosses(this.recipe!);
      for (const el of this.chainTags) { if (g[el.id] === undefined) continue; el.querySelector('span')!.textContent = g[el.id]; el.classList.add('explaining'); }
    } else if (!explaining && this.saved) {
      this.chainTags.forEach((el, i) => { el.querySelector('span')!.textContent = this.saved![i]; el.classList.remove('explaining', 'lit'); });
      this.saved = null;
    }
    if (explaining) {
      // (left to right, the way the report reads the URL; the source is still at the bottom of the sea)
      const parts = this.chainTags.filter((el) => el.classList.contains('explaining'));
      const now = parts[Math.floor(t / 1.25) % parts.length];
      for (const el of this.chainTags) {
        const lit = el === now;
        if (lit && !el.classList.contains('lit')) showTag(el);
        el.classList.toggle('lit', lit);
      }
    }
  }
}

