import type { WorldOut } from './world';

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * A stand-in for the sealed token of a recipe: base64url as long as a real
 * one (a 12-byte nonce, the recipe's bytes and a 16-byte tag), the same for
 * the same recipe. A real one is minted with the secret, on the server side.
 */
export function sealToken(rest: string) {
  const n = Math.ceil(((12 + new TextEncoder().encode(rest).length + 16) * 4) / 3);
  let h = 2166136261;
  for (let i = 0; i < rest.length; i++) h = Math.imul(h ^ rest.charCodeAt(i), 16777619) >>> 0;
  h = h || 1;
  let out = '';
  for (let i = 0; i < n; i++) {
    h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0;
    out += B64URL[h & 63];
  }
  return out;
}

/** A fixed per-position random number, 0 to 1. */
const jitter = (i: number) => { const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return x - Math.floor(x); };

/** The readable recipe turning into the token: each character flickers, then settles, left to right with some scatter. */
function scramble(a: string, b: string, p: number) {
  const n = Math.max(a.length, b.length);
  let out = '';
  for (let i = 0; i < n; i++) {
    const at = ((i / n) * 0.6 + jitter(i) * 0.4) * 0.88;
    const k = (p - at) / 0.1;
    if (k >= 1) out += b[i] ?? '';
    else if (k <= 0) out += a[i] ?? '';
    else out += i < Math.max(a.length * (1 - k), b.length * k) ? B64URL[(Math.random() * 64) | 0] : '';
  }
  return out;
}

export interface LogEntry { when: string; what: string }

interface Hooks {
  wide: boolean;
  /** The desk's wax seal was pressed. */
  onStamp: () => void;
  /** The "Seal the letter" button. */
  onSealLetter: () => void;
}

/**
 * The wreck's cabin in the DOM: the chest in the Sealed URLs card (shut the
 * lid and the readable recipe scrambles into a token), the ship's log in the
 * Provenance card, the wax seal on the desk and the octopus's button.
 */
export class WreckUI {
  private chest = document.getElementById('chest') as HTMLButtonElement;
  private chestLabel = document.getElementById('chest-label')!;
  private rest = document.getElementById('sealed-rest')!;
  private log = document.getElementById('ship-log')!;
  private desk = document.getElementById('desk')!;
  private stamp = document.querySelector<HTMLButtonElement>('.stamp-hot')!;
  private stampTip = document.querySelector<HTMLElement>('.stamp-hot + .tip .tip-text')!;
  private letterBtn = document.getElementById('seal-letter') as HTMLButtonElement;
  private kind = document.getElementById('kind-seal')!;
  /** The chest's lid: 1 open (the recipe readable), 0 shut (sealed); where it is heading. */
  private open = 1;
  private target = 1;
  private recipe = '';
  private token = '';
  private raf = 0;
  private last = 0;
  private covered = true;
  private frame = 0;
  /** The last pointer-up ended a drag, so the click that follows is not a toggle. */
  private dragged = false;

  constructor(private o: Hooks) {
    // The chest: a click opens or shuts it; a drag moves the lid with the pointer.
    let drag: { y: number; open: number; moved: boolean; id: number } | null = null;
    this.chest.addEventListener('pointerdown', (e) => {
      drag = { y: e.clientY, open: this.open, moved: false, id: e.pointerId };
      this.chest.setPointerCapture(e.pointerId);
    });
    this.chest.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dy = e.clientY - drag.y;
      if (Math.abs(dy) > 4) drag.moved = true;
      if (!drag.moved) return;
      this.open = Math.min(1, Math.max(0, drag.open - dy / 70));
      this.target = this.open;
      this.render();
    });
    const end = () => {
      if (!drag) return;
      if (drag.moved) { this.go(this.open > 0.5 ? 1 : 0); this.dragged = true; }
      drag = null;
    };
    this.chest.addEventListener('pointerup', end);
    this.chest.addEventListener('pointercancel', end);
    // A click that was not the end of a drag (or Enter and Space) toggles it.
    this.chest.addEventListener('click', () => {
      if (this.dragged) { this.dragged = false; return; }
      this.go(this.target > 0.5 ? 0 : 1);
    });

    this.stamp.addEventListener('click', () => this.o.onStamp());
    this.letterBtn.addEventListener('click', () => { this.o.onSealLetter(); this.letterBtn.classList.remove('on'); });
  }

  /** Animate the lid to open (1) or shut (0). */
  private go(to: number) {
    this.target = to;
    cancelAnimationFrame(this.raf);
    this.last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      const d = this.target - this.open;
      this.open = Math.abs(d) < 0.004 ? this.target : this.open + Math.sign(d) * Math.min(Math.abs(d), dt * 1.6);
      this.render();
      if (this.open !== this.target) this.raf = requestAnimationFrame(step);
      else this.render(true);
    };
    this.raf = requestAnimationFrame(step);
  }

  private render(settled = false) {
    const shut = 1 - this.open;
    this.chest.style.setProperty('--open', this.open.toFixed(3));
    const locked = this.open <= 0.001;
    this.chest.classList.toggle('locked', locked);
    this.chest.setAttribute('aria-pressed', String(locked));
    this.chestLabel.textContent = locked ? 'Open the chest: the URL is sealed' : 'Close the chest to seal the URL';
    const sealed = `s1.${this.token}/print.jpg`;
    this.rest.textContent = settled || shut <= 0 || shut >= 1 ? (shut >= 0.5 ? sealed : this.recipe) : scramble(this.recipe, sealed, shut);
    this.rest.classList.toggle('sealed', shut >= 0.5);
  }

  /** The visitor's recipe so far (operations and source), for the chest and its token. */
  setRecipe(rest: string, token: string) {
    this.recipe = rest;
    this.token = token;
    this.render(true);
  }

  /** The ship's log: what the picture's Content Credentials say about it. */
  setLog(entries: LogEntry[]) {
    this.log.replaceChildren(...entries.map((e, i) => {
      const li = document.createElement('li');
      li.style.setProperty('--i', String(i));
      const when = document.createElement('span');
      when.className = 'when';
      when.textContent = e.when;
      const what = document.createElement('span');
      what.className = 'what';
      what.textContent = e.what;
      li.append(when, what);
      return li;
    }));
  }

  /** The desk's seal shows whether the URL is sealed. */
  setSealed(sealed: boolean) {
    this.stamp.setAttribute('aria-pressed', String(sealed));
    this.stampTip.textContent = sealed ? 'Sealed. Press again to make it readable' : 'Press it to seal your URL';
  }

  update(out: WorldOut) {
    // The wax seal, pinned to the desk in the plate (wide screens).
    const z = out.z4;
    // (put away while the octopus is out, so there is one seal on screen at a time)
    this.desk.classList.toggle('on', this.o.wide && !!z && out.cabinOn > 0.6 && !out.octo.busy);
    if (this.o.wide && z) {
      for (const b of [this.stamp]) {
        const x = z.ox + Number(b.dataset.u) * z.dw, y = z.oy + Number(b.dataset.v) * z.dh;
        b.parentElement!.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      }
    }
    // The octopus's button, unless a card has scrolled over it.
    // To the right of the octopus on wide screens, below it on phones.
    const f = out.octo;
    const lift = f.s * 0.62;
    if (!f.on) this.covered = true;
    else if (this.frame++ % 4 === 0) {
      this.covered = this.hidden(f.x, f.y) || (this.o.wide ? this.hidden(f.x + lift * 0.9 + 80, f.y) : this.hidden(f.x, f.y + 60));
    }
    this.letterBtn.classList.toggle('on', !this.covered);
    if (f.on) {
      this.letterBtn.style.setProperty('--at', `translate(${f.x.toFixed(1)}px, ${f.y.toFixed(1)}px)`);
      this.letterBtn.style.setProperty('--lift', `${lift.toFixed(1)}px`);
    }
    this.kind.classList.toggle('on', out.sealOn);
  }

  private hidden(x: number, y: number) {
    return document.elementsFromPoint(x, y).some((el) => el !== this.letterBtn && !!el.closest('.card, .panel'));
  }
}
