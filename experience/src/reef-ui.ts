import type { WorldOut } from './world';
import { SPOTS } from './world/spots';

export type CropShape = 'wide' | 'square' | 'whole';
export const CROP_SEG: Record<CropShape, string> = { wide: 'crop:1200x630:smart', square: 'crop:760x760:smart', whole: 'fit-in:1200x630' };
const ASPECT: Record<CropShape, number> = { wide: 1200 / 630, square: 1, whole: 0 };

interface Hooks {
  wide: boolean;
  onRemove: (rect: [number, number, number, number]) => void;
  onUpscale: (again: boolean) => void;
  onReefFocus: (station: number) => void;
}

type Rect = { x: number; y: number; w: number; h: number };
const mixRect = (a: Rect, b: Rect, k: number): Rect => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k });

/** The reef in the DOM: stations that travel with the camera, the crop frame, face boxes, the can, the studio's demos. */
export class ReefUI {
  private stations = [...document.querySelectorAll<HTMLElement>('.station[data-st]')];
  private frameEl = document.getElementById('crop-frame')!;
  private labelEl = document.getElementById('crop-label')!;
  private facesEl = document.getElementById('faces')!;
  private faceEls: HTMLElement[] = [];
  private drag = document.getElementById('reef-drag')!;
  private dragRect = document.getElementById('drag-rect')!;
  private chip = document.getElementById('remove-chip')!;
  private fx = document.getElementById('reef-fx')!;
  private crop: CropShape = 'wide';
  private preview: CropShape | null = null;
  private rect: Rect = { x: -999, y: -999, w: 10, h: 10 };
  private arrived = [-1, -1, -1, -1, -1, -1];
  private start: [number, number] | null = null;
  private view: NonNullable<WorldOut['reef']> | null = null;
  private lastMouse: [number, number] | null = null;
  private movedAt = -10;
  private removed = false;

  constructor(private o: Hooks) {
    for (let i = 0; i < SPOTS.faces.length; i++) {
      const b = document.createElement('span');
      b.className = 'face-box';
      b.innerHTML = `<span>face ${(0.97 - i * 0.01).toFixed(2)}</span>`;
      this.facesEl.appendChild(b);
      this.faceEls.push(b);
    }

    // Keyboard focus on a station that is off screen scrolls the reef to it.
    this.stations.forEach((el) => el.addEventListener('focusin', () => o.onReefFocus(Number(el.dataset.st))));

    // Drag a box over the can (a tap or click on it works too).
    this.drag.addEventListener('pointerdown', (e) => {
      if (!this.view) return;
      this.start = [e.clientX, e.clientY];
      if (e.pointerType !== 'touch') this.drag.setPointerCapture(e.pointerId);
    });
    this.drag.addEventListener('pointermove', (e) => {
      if (!this.start || e.pointerType === 'touch') return;
      const r = this.norm(this.start, [e.clientX, e.clientY]);
      Object.assign(this.dragRect.style, { transform: `translate(${r.x}px, ${r.y}px)`, width: `${r.w}px`, height: `${r.h}px` });
      this.dragRect.classList.toggle('on', r.w > 6 || r.h > 6);
    });
    const end = (e: PointerEvent) => {
      if (!this.start || !this.view) { this.start = null; return; }
      const r = this.norm(this.start, [e.clientX, e.clientY]);
      this.start = null;
      this.dragRect.classList.remove('on');
      const small = r.w < 10 && r.h < 10;
      if (small) {
        if (this.onCan(r.x, r.y)) this.removeCan();
        return;
      }
      if (e.pointerType === 'touch') return;
      const v = this.view;
      const u0 = (r.x / v.dw + v.L) - 3, u1 = ((r.x + r.w) / v.dw + v.L) - 3;
      const v0 = (r.y - v.oy) / v.dh, v1 = (r.y + r.h - v.oy) / v.dh;
      this.send([Math.max(0, u0), Math.max(0, v0), Math.min(1, u1), Math.min(1, v1)]);
    };
    this.drag.addEventListener('pointerup', end);
    this.drag.addEventListener('pointercancel', () => { this.start = null; this.dragRect.classList.remove('on'); });
    document.getElementById('remove-can')!.addEventListener('click', () => this.removeCan());

    // The studio: before and after, and the pearl's upscale.
    const compare = document.getElementById('compare')!;
    const range = compare.querySelector<HTMLInputElement>('.compare-range')!;
    range.addEventListener('input', () => compare.style.setProperty('--cut', `${range.value}%`));
    document.getElementById('upscale-again')!.addEventListener('click', () => o.onUpscale(true));
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { o.onUpscale(false); io.disconnect(); } }), { threshold: 0.6 });
    io.observe(document.getElementById('card-upscale')!);
  }

  setCrop(c: CropShape) { this.crop = c; }
  previewCrop(c: CropShape | null) { this.preview = c; }

  private norm(a: [number, number], b: [number, number]): Rect {
    return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(a[0] - b[0]), h: Math.abs(a[1] - b[1]) };
  }
  private onCan(x: number, y: number) {
    const v = this.view;
    if (!v) return false;
    const [u0, v0, u1, v1] = SPOTS.can;
    return x > (u0 - v.L) * v.dw - 20 && x < (u1 - v.L) * v.dw + 20 && y > v.oy + v0 * v.dh - 20 && y < v.oy + v1 * v.dh + 20;
  }
  private removeCan() {
    const [u0, v0, u1, v1] = SPOTS.can;
    this.send([u0 - 3 - 0.01, v0 - 0.015, u1 - 3 + 0.01, v1 + 0.015]);
  }
  private send(r: [number, number, number, number]) {
    this.o.onRemove(r);
    const [u0, v0, u1, v1] = r;
    this.chip.textContent = `filters:remove_region(${Math.round(u0 * 1600)},${Math.round(v0 * 679)},${Math.round((u1 - u0) * 1600)},${Math.round((v1 - v0) * 679)})`;
    this.chip.classList.remove('stamp');
    void this.chip.offsetWidth;
    this.chip.classList.add('stamp');
  }

  update(out: WorldOut, t: number, dt: number, mouse: [number, number] | null) {
    const v = out.reef;
    this.view = v;
    this.fx.classList.toggle('on', !!v);
    const W = innerWidth, H = innerHeight;
    // Stations: between two stops the one behind slides out to the left as the
    // next slides in from the right, keeping pace with the reef on long trips.
    const { a, b, p } = v ? v.cards : { a: 0, b: 1, p: 0 };
    const travel = v && v.F[b] !== undefined ? Math.max(W * 1.1, Math.abs(v.F[b] - v.F[a]) * v.dw) : W * 1.1;
    this.stations.forEach((el) => {
      const i = Number(el.dataset.st);
      const tx = i === a ? -p * travel : i === b ? (1 - p) * travel : i < a ? -2 * W : 2 * W;
      el.style.transform = `translate3d(${tx.toFixed(1)}px, 0, 0)`;
      el.style.visibility = Math.abs(tx) < W * 1.05 ? 'visible' : 'hidden';
    });
    if (!v) return;
    const sx = (u: number) => (u - v.L) * v.dw, sy = (y: number) => v.oy + y * v.dh;

    for (let i = 1; i <= 5; i++) {
      if (v.near[i] > 0.85 && this.arrived[i] < 0) this.arrived[i] = t;
      if (v.near[i] < 0.2) this.arrived[i] = -1;
    }

    // Station 1: the crop frame hunts for the turtle and snaps around it.
    const shape = this.preview ?? this.crop;
    const [bu0, bv0, bu1, bv1] = SPOTS.turtle.box;
    const tb: Rect = { x: sx(bu0), y: sy(bv0), w: (bu1 - bu0) * v.dw, h: (bv1 - bv0) * v.dh };
    const tc = [tb.x + tb.w / 2, tb.y + tb.h / 2];
    let target: Rect;
    let snapped = true;
    if (shape === 'whole') {
      target = { x: 8, y: 8, w: W - 16, h: H - 16 };
    } else {
      const a = ASPECT[shape];
      const fw = Math.max(tb.w, tb.h * a) * 1.14, fh = fw / a;
      const snap: Rect = { x: tc[0] - fw / 2, y: tc[1] - fh / 2, w: fw, h: fh };
      if (mouse && (!this.lastMouse || mouse[0] !== this.lastMouse[0] || mouse[1] !== this.lastMouse[1])) this.movedAt = t;
      this.lastMouse = mouse;
      const lively = !!mouse && t - this.movedAt < 2.5 && Math.hypot(mouse[0] - tc[0], mouse[1] - tc[1]) < W * 0.4;
      const overStage = lively && !document.elementFromPoint(mouse![0], mouse![1])?.closest('.card, .panel, .gauge, .top');
      const hunt = (cx: number, cy: number): Rect => ({ x: cx - fw * 0.4, y: cy - fh * 0.4, w: fw * 0.8, h: fh * 0.8 });
      if (mouse && overStage && this.o.wide) {
        const d = Math.hypot(mouse[0] - tc[0], mouse[1] - tc[1]);
        snapped = d < Math.max(fw, fh) * 0.75;
        target = snapped ? snap : hunt(mouse[0], mouse[1]);
      } else {
        // No cursor: wander for a moment, then find it again.
        const ph = (t % 4.2) / 4.2;
        snapped = ph > 0.38;
        target = snapped ? snap : hunt(tc[0] - fw * 0.9 + Math.sin(t * 2.1) * fw * 0.5, tc[1] + Math.cos(t * 1.7) * fh * 0.6);
      }
    }
    if (this.rect.x < -900) this.rect = target;
    this.rect = mixRect(this.rect, target, 1 - Math.exp(-dt * (snapped ? 11 : 7)));
    const r = this.rect;
    const on1 = v.near[1];
    Object.assign(this.frameEl.style, { transform: `translate(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px)`, width: `${r.w.toFixed(1)}px`, height: `${r.h.toFixed(1)}px`, opacity: String(on1) });
    this.frameEl.classList.toggle('whole', shape === 'whole');
    this.frameEl.classList.toggle('snapped', snapped);
    this.labelEl.textContent = CROP_SEG[shape] + (shape === 'whole' ? ' · nothing cut' : snapped ? ' · subject found' : '');

    // Station 2: stitched boxes on the fish faces near the cursor (all of them, one by one, on arrival or on touch screens).
    const [fw, fh] = SPOTS.face;
    const on2 = v.near[2];
    const since = this.arrived[2] < 0 ? -1 : t - this.arrived[2];
    this.faceEls.forEach((b, i) => {
      const [u, y] = SPOTS.faces[i];
      const x = sx(u), yy = sy(y), w = fw * v.dw, h = fh * v.dh;
      const intro = since >= 0 && (since < 3 || !mouse || !this.o.wide) ? (since > i * 0.18 ? 1 : 0) : 0;
      const near = mouse ? 1 - Math.min(1, Math.max(0, (Math.hypot(mouse[0] - x, mouse[1] - yy) - H * 0.18) / (H * 0.12))) : 0;
      const a = Math.max(intro, near) * on2;
      b.style.transform = `translate(${(x - w / 2).toFixed(1)}px, ${(yy - h / 2).toFixed(1)}px)`;
      b.style.width = `${w.toFixed(1)}px`;
      b.style.height = `${h.toFixed(1)}px`;
      b.style.opacity = a.toFixed(2);
      b.classList.toggle('on', a > 0.5);
    });

    // Station 4: the drag layer is live while the can is in view.
    this.removed = v.removed;
    const live = v.near[4] > 0.8;
    this.drag.classList.toggle('live', live);
    this.drag.classList.toggle('done', this.removed);
    if (!this.removed && v.near[4] < 0.3) this.chip.textContent = 'filters:remove_region(40,120,300,200)';
  }
}
