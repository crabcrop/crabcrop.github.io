import { media } from './media';
import { ReefUI, CROP_SEG, type CropShape } from './reef-ui';
import type { WorldOut, ZoneId } from './world';
import type { Fmt } from './world/fish';
import type { LookName } from './world/look';

type Choice = Fmt | 'auto';
const SEGMENT: Record<string, string> = { auto: '', avif: 'format(avif)', webp: 'format(webp)', jxl: 'format(jxl)' };
const LOOK_SEG: Record<LookName, string> = { crisp: 'sharpen(1.2):saturation(1.1)', deep: 'duotone(0d202e,ffd88a)', vintage: 'sepia' };
const LOOK_NAME: Record<LookName, string> = { crisp: 'Crisp', deep: 'Deep sea', vintage: 'Vintage' };
const CROP_NAME: Record<CropShape, string> = { wide: 'Wide card', square: 'Square', whole: 'Whole picture' };
type Finish = 'none' | 'studio' | 'cutout';
const FINISH_SEG: Record<Finish, string> = { none: '', studio: 'studio(product,bg:brand,shadow:soft,pad:10)', cutout: 'removebg' };
const FINISH_NAME: Record<Finish, string> = { none: 'None', studio: 'Studio', cutout: 'Cut out' };
const ZONES: Record<ZoneId, string> = {
  s0: 'The Marina', t1: 'The plunge', s1: 'The Shallows', s2: 'The Kelp Forest', t2: 'The drop-off',
  s3: 'The Coral Reef', s3b: 'The Clam Studio', next: 'The Coral Reef',
};
/** Which gauge entry is current in each zone. */
const GAUGE: Record<ZoneId, string> = { s0: 's0', t1: 's0', s1: 's1', s2: 's2', t2: 's2', s3: 's3', s3b: 's3', next: 's3' };
const DEPTH: Record<string, number> = { s0: 0, s1: -5, s2: -15, s3: -30, s3b: -30, next: -30 };
const TAG_KEYS = ['sig', 'fmt', 'look', 'crop', 'finish'] as const;

const kb = (n: number) => `${Math.round(n / 1024)} KB`;
const metres = (d: number) => (Math.abs(d) < 0.05 ? '0 m' : `−${Math.abs(d).toFixed(Math.abs(d) < 10 && d % 1 ? 1 : 0)} m`);
const asset = (path: string) => new URL(path, document.baseURI).href;
/** Run once when an element comes within a couple of screens: CSS backgrounds don't load lazily on their own. */
function whenNear(el: Element | null, fn: () => void) {
  if (!el) return;
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); fn(); } }, { rootMargin: '200% 0px' });
  io.observe(el);
}

/** A tag on the chain takes a value, with a little stamp. */
function stamp(tag: HTMLElement, code: string, note: string) {
  tag.classList.remove('blank');
  tag.querySelector('code')!.textContent = code;
  tag.querySelector('span')!.textContent = note;
  tag.classList.remove('stamp');
  void tag.offsetWidth;
  tag.classList.add('stamp');
}

interface Hooks {
  gl: boolean;
  wide: boolean;
  onFormat: (f: Choice) => void;
  onFocus: (f: Fmt | null) => void;
  onRaceView: () => void;
  onLook: (l: LookName) => void;
  onLookPreview: (l: LookName | null) => void;
  onFreeFish: () => void;
  onRemove: (rect: [number, number, number, number]) => void;
  onUpscale: (again: boolean) => void;
  onReefFocus: (station: number) => void;
}

/** Everything in the DOM: buttons, the gauge, cards, tags, both choices, the cargo and the curtains. */
export class UI {
  private depthEl = document.getElementById('depth')!;
  private zoneEl = document.getElementById('zone')!;
  private gaugeLinks = [...document.querySelectorAll<HTMLAnchorElement>('.gauge a[data-zone]')];
  private fill = document.getElementById('gauge-fill')!;
  private story = document.getElementById('story')!;
  private kind = document.getElementById('kind')!;
  private tagsEl = document.getElementById('tags')!;
  private tagEls = [...document.querySelectorAll<HTMLElement>('#tags .tag')];
  private lookTag = document.getElementById('tag-look')!;
  private cropTag = document.getElementById('tag-crop')!;
  private cards = [...document.querySelectorAll<HTMLElement>('.card')];
  /** Which zone each card hangs in; the reef's travelling cards have no thread. */
  private cardZone = this.cards.map((c) => (c.closest('.s1') ? 's1' : c.closest('.s2') ? 's2' : c.closest('.s3b') ? 's3b' : 'reef'));
  private reefUI: ReefUI;
  private threads = document.getElementById('threads') as unknown as SVGSVGElement;
  private paths: SVGPathElement[] = [];
  private cargo = document.getElementById('cargo')!;
  private hots = [...document.querySelectorAll<HTMLButtonElement>('.hot')];
  private curtains = document.getElementById('curtains')!;
  private silks = [...document.querySelectorAll<HTMLButtonElement>('.silk')];
  private freeBtn = document.getElementById('free-fish') as HTMLButtonElement;
  private lastZone = '';
  private fmt: Choice = 'auto';
  private look: LookName = 'crisp';
  private lookShown = false;
  private crop: CropShape = 'wide';
  private cropShown = false;
  private finish: Finish = 'none';
  private fishHidden = true;
  private frame = 0;

  constructor(private o: Hooks) {
    // Copy the install command.
    for (const b of document.querySelectorAll<HTMLButtonElement>('.copybtn')) {
      b.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(b.dataset.copy ?? ''); b.textContent = 'Copied'; b.classList.add('done'); } catch { b.textContent = 'Select it'; }
        setTimeout(() => { b.textContent = 'Copy'; b.classList.remove('done'); }, 1600);
      });
    }

    // The format card's specimen: the real sizes of this page's marina.
    const z0 = media.plates.z0 as unknown as { bytes: Record<string, { avif: number; webp: number }> };
    const big = z0.bytes?.['3200'];
    if (big) document.getElementById('spec-fmt')!.innerHTML = `<span>This page's marina, 3200 px wide:</span> <b>AVIF ${kb(big.avif)}</b> · <b>WebP ${kb(big.webp)}</b>`;

    this.reefUI = new ReefUI({ wide: o.wide, onRemove: o.onRemove, onUpscale: o.onUpscale, onReefFocus: o.onReefFocus });
    this.formatChoice();
    this.lookChoice();
    this.cropChoice();
    this.finishChoice();
    this.url();

    // The fish atlas for the school labels.
    const W = media.fish.w, H = media.fish.h;
    for (const el of document.querySelectorAll<HTMLElement>('.school .fish:not(.none)')) {
      const f = [...el.classList].find((c) => c in media.fish.rects)!;
      const [x, , w, h] = media.fish.rects[f];
      const scale = 32 / h;
      el.style.backgroundSize = `${W * scale}px ${H * scale}px`;
      el.style.backgroundPosition = `${-x * scale}px 0`;
      el.style.width = `${Math.min(54, w * scale)}px`;
    }
    whenNear(document.getElementById('choice-format'), () => {
      for (const el of document.querySelectorAll<HTMLElement>('.school .fish:not(.none)')) el.style.backgroundImage = `url(${asset('media/fish.webp')})`;
    });

    // The cargo: tap or click shows what each source is.
    for (const h of this.hots) {
      h.addEventListener('click', () => {
        const open = !h.classList.contains('open');
        this.hots.forEach((x) => { x.classList.remove('open'); x.setAttribute('aria-expanded', 'false'); });
        h.classList.toggle('open', open);
        h.setAttribute('aria-expanded', String(open));
      });
    }

    // Snap snips the fishing line when asked.
    this.freeBtn.addEventListener('click', () => { o.onFreeFish(); this.freeBtn.classList.remove('on'); });

    if (o.gl) {
      const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add('in')), { threshold: 0.35 });
      this.cards.forEach((c) => io.observe(c));
      const race = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { o.onRaceView(); race.disconnect(); } }), { threshold: 0.6 });
      race.observe(document.getElementById('choice-format')!);
      const ns = 'http://www.w3.org/2000/svg';
      this.paths = this.cards.map(() => { const p = document.createElementNS(ns, 'path'); this.threads.appendChild(p); return p; });
    } else {
      this.staticGauge();
    }
  }

  /** Choice 1: the format. */
  private formatChoice() {
    const status = document.getElementById('choice-status')!;
    const tag = document.getElementById('tag-format')!;
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input[name="format"]')];
    this.fmt = (inputs.find((i) => i.checked)?.value as Choice) ?? 'auto';
    for (const input of inputs) {
      input.addEventListener('change', () => {
        const f = input.value as Choice;
        const seg = SEGMENT[f];
        this.fmt = f;
        stamp(tag, seg || 'auto', seg ? 'Your format' : 'The Accept header decides');
        status.textContent = seg ? `Format set: ${seg}.` : 'No format: the Accept header decides.';
        this.url();
        this.o.onFormat(f);
      });
      const label = input.closest('label')!;
      const focus = () => this.o.onFocus(input.value === 'auto' ? null : (input.value as Fmt));
      label.addEventListener('pointerenter', focus);
      label.addEventListener('pointerleave', () => this.o.onFocus(null));
      input.addEventListener('focus', focus);
      input.addEventListener('blur', () => this.o.onFocus(null));
    }
  }

  /** Choice 2: the look. Hovering a look or a silk curtain previews it on the whole forest. */
  private lookChoice() {
    const status = document.getElementById('look-status')!;
    const chain = document.getElementById('look-chain')!;
    const demo = document.querySelector<HTMLElement>('.look-demo');
    const s2 = document.getElementById('s2')!;
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input[name="look"]')];
    this.look = (inputs.find((i) => i.checked)?.value as LookName) ?? 'crisp';

    whenNear(document.getElementById('choice-look'), () => {
      for (const el of document.querySelectorAll<HTMLElement>('.swatch')) el.style.backgroundImage = `url(${asset('media/print.webp')})`;
    });

    // What the card and (without WebGL) the forest show.
    const show = (l: LookName) => {
      if (demo) demo.dataset.look = l;
      chain.textContent = `filters:${LOOK_SEG[l]}`;
      s2.dataset.look = l;
    };
    const preview = (l: LookName | null) => { this.o.onLookPreview(l); show(l ?? this.look); };
    const choose = (l: LookName) => {
      this.look = l;
      this.lookShown = true;
      stamp(this.lookTag, LOOK_SEG[l], 'Your look');
      show(l);
      status.textContent = `Look set: ${LOOK_NAME[l]}, ${LOOK_SEG[l]}.`;
      this.silks.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.look === l)));
      this.url();
      this.o.onLook(l);
    };
    show(this.look);

    for (const input of inputs) {
      const l = input.value as LookName;
      input.addEventListener('change', () => { if (input.checked) choose(l); });
      const label = input.closest('label')!;
      label.addEventListener('pointerenter', () => preview(l));
      label.addEventListener('pointerleave', () => preview(null));
      input.addEventListener('focus', () => preview(l));
      input.addEventListener('blur', () => preview(null));
    }
    for (const b of this.silks) {
      const l = b.dataset.look as LookName;
      b.addEventListener('pointerenter', () => preview(l));
      b.addEventListener('pointerleave', () => preview(null));
      b.addEventListener('focus', () => preview(l));
      b.addEventListener('blur', () => preview(null));
      b.addEventListener('click', () => {
        const input = inputs.find((i) => i.value === l);
        if (input) input.checked = true;
        choose(l);
      });
    }
  }

  /** Choice 3: the crop. The reef's frame takes the shape. */
  private cropChoice() {
    const status = document.getElementById('crop-status')!;
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input[name="crop"]')];
    this.crop = (inputs.find((i) => i.checked)?.value as CropShape) ?? 'wide';
    this.reefUI.setCrop(this.crop);
    for (const input of inputs) {
      const c = input.value as CropShape;
      input.addEventListener('change', () => {
        if (!input.checked) return;
        this.crop = c;
        this.cropShown = true;
        stamp(this.cropTag, CROP_SEG[c], 'Your crop');
        status.textContent = `Crop set: ${CROP_NAME[c]}, ${CROP_SEG[c]}.`;
        this.reefUI.setCrop(c);
        this.url();
      });
      const label = input.closest('label')!;
      label.addEventListener('pointerenter', () => this.reefUI.previewCrop(c));
      label.addEventListener('pointerleave', () => this.reefUI.previewCrop(null));
      input.addEventListener('focus', () => this.reefUI.previewCrop(c));
      input.addEventListener('blur', () => this.reefUI.previewCrop(null));
    }
  }

  /** Choice 4: the finish, shown on Snap in the studio's swatches. */
  private finishChoice() {
    const status = document.getElementById('finish-status')!;
    const tag = document.getElementById('tag-finish')!;
    whenNear(document.getElementById('s3b'), () => {
      const snapImg = `url(${asset('media/snap-stand.webp')})`;
      for (const el of document.querySelectorAll<HTMLElement>('.finish .mini')) el.style.setProperty('--snap', snapImg);
      const photo = `url(${asset('media/z0-1600.webp')})`;
      for (const el of document.querySelectorAll<HTMLElement>('.finish .mini.none, .compare-before')) el.style.setProperty('--photo', photo);
    });
    for (const input of document.querySelectorAll<HTMLInputElement>('input[name="finish"]')) {
      input.addEventListener('change', () => {
        if (!input.checked) return;
        const f = input.value as Finish;
        this.finish = f;
        stamp(tag, FINISH_SEG[f] || 'none', f === 'none' ? 'No finish' : 'Your finish');
        status.textContent = f === 'none' ? 'No finish: the picture leaves as photographed.' : `Finish set: ${FINISH_NAME[f]}, ${FINISH_SEG[f]}.`;
        this.url();
      });
    }
  }

  /** The URL so far, from every choice. */
  private url() {
    const f = [LOOK_SEG[this.look], FINISH_SEG[this.finish], SEGMENT[this.fmt]].filter(Boolean).join(':');
    // Line breaks go after slashes, not inside a filter.
    document.getElementById('url-so-far')!.innerHTML = `https://img.example.com/3c1f6c18…/${CROP_SEG[this.crop]}/${f ? `filters:${f}/` : ''}root:photos/print.jpg`.replace(/\/(?!\/)/g, '/<wbr>');
  }

  private setCurrent(id: string) {
    this.gaugeLinks.forEach((a) => (a.dataset.zone === id ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
  }

  /** Without WebGL there is no frame loop: the gauge follows the sections instead. */
  private staticGauge() {
    const io = new IntersectionObserver((es) => {
      for (const e of es) {
        if (!e.isIntersecting) continue;
        const id = e.target.id as ZoneId;
        this.depthEl.textContent = metres(DEPTH[id] ?? 0);
        this.zoneEl.textContent = ZONES[id];
        this.setCurrent(GAUGE[id]);
      }
    }, { rootMargin: '-45% 0px -54% 0px' });
    for (const id of Object.keys(DEPTH)) { const el = document.getElementById(id); if (el) io.observe(el); }
    const fill = () => {
      const doc = document.documentElement.scrollHeight - innerHeight;
      this.fill.style.width = `${doc > 0 ? ((scrollY / doc) * 100).toFixed(1) : 0}%`;
    };
    addEventListener('scroll', fill, { passive: true });
    fill();
  }

  update(out: WorldOut, t: number, v: number, docProgress: number, dt = 0.016, mouse: [number, number] | null = null) {
    // The depth gauge.
    this.depthEl.textContent = metres(out.depth);
    if (out.zone !== this.lastZone) {
      this.zoneEl.textContent = ZONES[out.zone];
      this.setCurrent(GAUGE[out.zone]);
      this.lastZone = out.zone;
    }
    this.fill.style.width = `${(docProgress * 100).toFixed(1)}%`;
    this.story.classList.toggle('on', out.storyOn);
    this.kind.classList.toggle('on', out.kindOn);

    // Tags on the chain. Reaching the kelp, the look tag shows the look already on.
    this.tagsEl.classList.toggle('on', out.tagsOn > 0.5);
    if (!this.lookShown && out.s2On > 0.6) {
      this.lookShown = true;
      stamp(this.lookTag, LOOK_SEG[this.look], `${LOOK_NAME[this.look]} for now`);
    }
    if (!this.cropShown && out.reef && out.reef.near[1] > 0.6) {
      this.cropShown = true;
      stamp(this.cropTag, CROP_SEG[this.crop], `${CROP_NAME[this.crop]} for now`);
    }
    if (out.tagsOn > 0.01) {
      TAG_KEYS.forEach((k, i) => {
        const p = out.tags[k];
        const el = this.tagEls[i];
        if (!el) return;
        const dangle = -p.a * 0.6 + Math.sin(t * 1.3 + i * 1.7) * 0.05;
        el.style.setProperty('--pos', `translate(${(p.x + 9).toFixed(1)}px, ${(p.y - 11).toFixed(1)}px) rotate(${dangle.toFixed(3)}rad)`);
      });
    }

    // Cards sway on their threads; the threads run to the chain.
    const H = innerHeight;
    this.cards.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const onScreen = r.bottom > 0 && r.top < H;
      const sway = Math.sin(t * 0.8 + i * 1.9) * 0.55 + Math.max(-1.5, Math.min(1.5, v * 0.04));
      if (onScreen) c.style.transform = `rotate(${sway.toFixed(2)}deg)`;
      const path = this.paths[i];
      if (!path) return;
      const z = this.cardZone[i];
      const zoneOn = z === 's1' ? out.s1On : z === 's2' ? out.s2On : z === 's3b' && out.zone === 's3b' ? 1 : 0;
      const cx = out.chainX(r.top - 26);
      if (!onScreen || zoneOn < 0.5 || cx === null || cx < r.right) { path.setAttribute('d', ''); return; }
      const x0 = r.right - 22, y0 = r.top + 6, x1 = cx, y1 = r.top - 26;
      const mx = (x0 + x1) / 2, my = Math.max(y0, y1) + 18;
      path.setAttribute('d', `M${x0.toFixed(1)},${y0.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`);
    });

    // Hotspots pinned to the plates: the cargo on the sea floor, the silk curtains in the kelp.
    if (this.o.wide) {
      const pin = (list: HTMLElement[], z: WorldOut['z1']) => {
        if (!z) return;
        for (const b of list) {
          const x = z.ox + Number(b.dataset.u) * z.dw, y = z.oy + Number(b.dataset.v) * z.dh;
          b.parentElement!.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        }
      };
      this.cargo.classList.toggle('on', !!out.z1 && out.s1On > 0.6);
      pin(this.hots, out.z1);
      this.curtains.classList.toggle('on', !!out.z2 && out.s2On > 0.6);
      pin(this.silks, out.z2);
    }

    this.reefUI.update(out, t, dt, mouse);

    // The button on the tangled fish, unless a card has scrolled over the fish or the button.
    const f = out.fish;
    if (!f.on) this.fishHidden = true;
    else if (this.frame++ % 4 === 0) {
      const bx = this.o.wide ? f.x + 110 : f.x, by = this.o.wide ? f.y : f.y + 52;
      this.fishHidden = this.covered(f.x, f.y) || this.covered(bx, by);
    }
    this.freeBtn.classList.toggle('on', !this.fishHidden);
    if (f.on) this.freeBtn.style.setProperty('--at', `translate(${f.x.toFixed(1)}px, ${f.y.toFixed(1)}px)`);
  }

  private covered(x: number, y: number) {
    return document.elementsFromPoint(x, y).some((el) => el !== this.freeBtn && !!el.closest('.card, .panel'));
  }
}
