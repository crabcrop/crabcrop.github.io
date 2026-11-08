import { media } from './media';
import type { WorldOut } from './world';
import type { Fmt } from './world/fish';

type Choice = Fmt | 'auto';
const SEGMENT: Record<string, string> = { auto: '', avif: 'format(avif)', webp: 'format(webp)', jxl: 'format(jxl)' };
const ZONES: Record<WorldOut['zone'], string> = { s0: 'The Marina', t1: 'The plunge', s1: 'The Shallows', next: 'The Kelp Forest' };
const TAG_KEYS = ['sig', 'fmt', 'look', 'crop', 'finish'] as const;

const kb = (n: number) => `${Math.round(n / 1024)} KB`;
const metres = (d: number) => (Math.abs(d) < 0.05 ? '0 m' : `−${Math.abs(d).toFixed(Math.abs(d) < 10 && d % 1 ? 1 : 0)} m`);

/** Everything in the DOM: buttons, the gauge, cards, tags, the choice, the cargo. */
export class UI {
  private depthEl = document.getElementById('depth')!;
  private zoneEl = document.getElementById('zone')!;
  private gaugeLinks = [...document.querySelectorAll<HTMLAnchorElement>('.gauge a[data-zone]')];
  private fill = document.getElementById('gauge-fill')!;
  private story = document.getElementById('story')!;
  private tagsEl = document.getElementById('tags')!;
  private tagEls = [...document.querySelectorAll<HTMLElement>('#tags .tag')];
  private cards = [...document.querySelectorAll<HTMLElement>('.card')];
  private threads = document.getElementById('threads') as unknown as SVGSVGElement;
  private paths: SVGPathElement[] = [];
  private cargo = document.getElementById('cargo')!;
  private hots = [...document.querySelectorAll<HTMLButtonElement>('.hot')];
  private lastZone = '';

  constructor(private o: { gl: boolean; wide: boolean; onFormat: (f: Choice) => void; onFocus: (f: Fmt | null) => void; onRaceView: () => void }) {
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

    // Choice 1: the format.
    const status = document.getElementById('choice-status')!;
    const tag = document.getElementById('tag-format')!;
    for (const input of document.querySelectorAll<HTMLInputElement>('input[name="format"]')) {
      input.addEventListener('change', () => {
        const f = input.value as Choice;
        const seg = SEGMENT[f];
        tag.classList.toggle('blank', false);
        tag.querySelector('code')!.textContent = seg || 'auto';
        tag.querySelector('span')!.textContent = seg ? 'Your format' : 'The Accept header decides';
        tag.classList.remove('stamp');
        void tag.offsetWidth;
        tag.classList.add('stamp');
        document.getElementById('url-so-far')!.textContent = `https://img.example.com/3c1f6c18…/${seg ? `filters:${seg}/` : ''}root:photos/print.jpg`;
        status.textContent = seg ? `Format set: ${seg}.` : 'No format: the Accept header decides.';
        o.onFormat(f);
      });
      const label = input.closest('label')!;
      const focus = () => o.onFocus(input.value === 'auto' ? null : (input.value as Fmt));
      label.addEventListener('pointerenter', focus);
      label.addEventListener('pointerleave', () => o.onFocus(null));
      input.addEventListener('focus', focus);
      input.addEventListener('blur', () => o.onFocus(null));
    }
    // The fish atlas for the school labels.
    const W = media.fish.w, H = media.fish.h;
    for (const el of document.querySelectorAll<HTMLElement>('.school .fish:not(.none)')) {
      const f = [...el.classList].find((c) => c in media.fish.rects)!;
      const [x, , w, h] = media.fish.rects[f];
      const scale = 32 / h;
      el.style.backgroundImage = `url(${new URL('media/fish.webp', document.baseURI).href})`;
      el.style.backgroundSize = `${W * scale}px ${H * scale}px`;
      el.style.backgroundPosition = `${-x * scale}px 0`;
      el.style.width = `${Math.min(54, w * scale)}px`;
    }

    // The cargo: tap or click shows what each source is.
    for (const h of this.hots) {
      h.addEventListener('click', () => {
        const open = !h.classList.contains('open');
        this.hots.forEach((x) => { x.classList.remove('open'); x.setAttribute('aria-expanded', 'false'); });
        h.classList.toggle('open', open);
        h.setAttribute('aria-expanded', String(open));
      });
    }

    if (o.gl) {
      const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add('in')), { threshold: 0.35 });
      this.cards.forEach((c) => io.observe(c));
      const race = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { o.onRaceView(); race.disconnect(); } }), { threshold: 0.6 });
      race.observe(document.getElementById('choice-format')!);
      const ns = 'http://www.w3.org/2000/svg';
      this.paths = this.cards.map(() => { const p = document.createElementNS(ns, 'path'); this.threads.appendChild(p); return p; });
    }
  }

  update(out: WorldOut, t: number, v: number, docProgress: number) {
    // The depth gauge.
    this.depthEl.textContent = metres(out.depth);
    if (out.zone !== this.lastZone) {
      this.zoneEl.textContent = ZONES[out.zone];
      const cur = out.zone === 's0' || out.zone === 't1' ? 's0' : 's1';
      this.gaugeLinks.forEach((a) => (a.dataset.zone === cur ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
      this.lastZone = out.zone;
    }
    this.fill.style.width = `${(docProgress * 100).toFixed(1)}%`;
    this.story.classList.toggle('on', out.storyOn);

    // Tags on the chain.
    this.tagsEl.classList.toggle('on', out.tagsOn > 0.5);
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
      const cx = out.chainX(r.top - 26);
      if (!onScreen || out.s1On < 0.5 || cx === null || cx < r.right) { path.setAttribute('d', ''); return; }
      const x0 = r.right - 22, y0 = r.top + 6, x1 = cx, y1 = r.top - 26;
      const mx = (x0 + x1) / 2, my = Math.max(y0, y1) + 18;
      path.setAttribute('d', `M${x0.toFixed(1)},${y0.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`);
    });

    // The cargo hotspots sit on the sea floor of the shallows.
    if (this.o.wide) {
      const z = out.z1;
      this.cargo.classList.toggle('on', !!z && out.s1On > 0.6);
      if (z) {
        for (const h of this.hots) {
          const li = h.parentElement!;
          const x = z.ox + Number(h.dataset.u) * z.dw, y = z.oy + Number(h.dataset.v) * z.dh;
          li.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
        }
      }
    }
  }
}
