import type { WorldOut } from './world';
import type { Recipe } from './twilight-ui';

type Lang = 'ts' | 'py' | 'rs';
const SOURCE = 'root:photos/print.jpg';
const CROP_SIZE = { wide: '1200 × 630', square: '760 × 760', whole: '945 × 630' };
const FMT = { auto: 'AVIF', avif: 'AVIF', webp: 'WebP', jxl: 'JPEG XL' };
/** Where the submersible floats, as shares of the master plate (it speaks from just above it). */
const SUB = [0.715, 0.6] as const;

/**
 * The vents in the DOM: the SDK card building the visitor's own URL in
 * TypeScript, Python and Rust (the same URL from all three), the MCP card's
 * tool calls from the little submersible, its speech bubble over the plate,
 * the source tag on the chain once Snap has his print, and the story.
 */
export class VentsUI {
  private tabs = [...document.querySelectorAll<HTMLButtonElement>('.sdk-tabs [role="tab"]')];
  private code = document.getElementById('sdk-code')!;
  private out = document.getElementById('sdk-out')!;
  private mcp = document.getElementById('mcp-log')!;
  private bubble = document.getElementById('sub-bubble')!;
  private card = document.getElementById('card-mcp')!;
  private kind = document.getElementById('kind-print')!;
  private tagsEl = document.getElementById('tags')!;
  private lang: Lang = 'ts';
  private recipe: Recipe | null = null;
  private takenAt = -10;
  private wasTaken = false;

  constructor() {
    for (const b of this.tabs) {
      b.addEventListener('click', () => this.pick(b.dataset.lang as Lang));
      b.addEventListener('keydown', (e) => {
        // arrow keys move between the tabs
        const i = this.tabs.indexOf(b), d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!d) return;
        const next = this.tabs[(i + d + this.tabs.length) % this.tabs.length];
        next.focus();
        this.pick(next.dataset.lang as Lang);
      });
    }
  }

  private pick(l: Lang) {
    this.lang = l;
    this.tabs.forEach((b) => { b.setAttribute('aria-selected', String(b.dataset.lang === l)); b.tabIndex = b.dataset.lang === l ? 0 : -1; });
    this.render();
  }

  setRecipe(r: Recipe) {
    this.recipe = r;
    this.render();
    this.renderMcp();
  }

  private ops() {
    const r = this.recipe!;
    return r.rest.slice(0, r.rest.length - SOURCE.length - 1);
  }

  private render() {
    if (!this.recipe) return;
    const ops = this.ops();
    const call = {
      ts: `// @crabcrop/url\nconst url = buildURL(base, secret,\n  "${ops}",\n  "${SOURCE}");`,
      py: `# crabcrop_url\nurl = build_url(base, secret,\n    "${ops}",\n    "${SOURCE}")`,
      rs: `// crabcrop-url\nlet url = build_url(base, Some(secret),\n    "${ops}",\n    "${SOURCE}", None)?;`,
    }[this.lang];
    this.code.textContent = call;
    this.out.textContent = `→ https://img.example.com/3c1f6c18…/${this.recipe.rest}  (the same from all three)`;
  }

  private renderMcp() {
    const r = this.recipe!;
    const rows: [string, string, string][] = [
      ['agent', 'sign_url', `${this.ops().replace('/filters:', ' · ')} · ${SOURCE}`],
      ['crabcrop', '', `https://img.example.com/3c1f6c18…/${r.rest}`],
      ['agent', 'explain_url', 'is it right?'],
      ['crabcrop', '', `valid · key 1 · ${CROP_SIZE[r.crop]} · ${FMT[r.fmt]}`],
      ['agent', 'fetch_meta', 'what does it show?'],
      ['crabcrop', '', `${CROP_SIZE[r.crop]} · ${FMT[r.fmt].toLowerCase().replace('jpeg xl', 'jxl')} · a sun over two hills, stitched`],
    ];
    this.mcp.replaceChildren(...rows.map(([who, tool, what], i) => {
      const li = document.createElement('li');
      li.className = who === 'agent' ? 'ask' : 'answer';
      li.style.setProperty('--i', String(i));
      const w = document.createElement('span');
      w.className = 'who';
      w.textContent = who;
      li.append(w);
      if (tool) { const c = document.createElement('code'); c.textContent = tool; li.append(c); }
      const t = document.createElement('span');
      t.className = 'what';
      t.textContent = what;
      li.append(t);
      return li;
    }));
  }

  update(out: WorldOut, t: number, wide: boolean) {
    const v = out.vents;
    // The submersible speaks while its card is up.
    const z = v.z6;
    let show = false;
    if (z && v.on > 0.6) {
      const r = this.card.getBoundingClientRect();
      show = r.top < innerHeight * 0.75 && r.bottom > innerHeight * 0.25;
      const [a, b] = wide ? [0, 1] : [0.42, 0.66];
      const x = z.ox + ((SUB[0] - a) / (b - a)) * z.dw, y = z.oy + SUB[1] * z.dh;
      this.bubble.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
    this.bubble.classList.toggle('on', show);
    // His print: the source tag hangs at the end of the chain, and the story shows for a while.
    if (v.taken && !this.wasTaken) this.takenAt = t;
    this.wasTaken = v.taken;
    this.tagsEl.classList.toggle('source', v.taken && v.on > 0.5);
    this.kind.classList.toggle('on', v.taken && t - this.takenAt < 7 && v.on > 0.5);
  }
}
