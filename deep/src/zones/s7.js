// The way up and the surface (zone s7): the climb home with the lines that show it (bands of
// every zone's colour sliding down past the window and warm streaks falling: the engine draws
// them), the print hanging from the submarine's pincer taking on the visitor's choices one at
// a time while their URL prints under it a line for each part, the homecoming (cast.js: Snap
// climbs out onto the submarine's back with his print), the flash and the polaroid of the
// picture their URL serves. As in the painted dive (surface-ui.ts, backdrop.ts).
import { Vector3 } from 'three/webgpu';
import { OPTIONS, remainder, seal, sign } from '../content.js';
import { feltPrint } from '../feltprint.js';
import { CLIMB } from '../layout.js';
import { smooth } from '../math.js';

// The climb: from the vents' floor (p 7) to the surface (about p 7.78): layout.js CLIMB.
// The steps, in the order the server works through a URL: the crop, the filters as written
// (the look, then the finish), the format it encodes to, and last the signature or the seal.
// Each goes onto the print at this share of the climb.
const STEPS = [{ at: 0.14, cls: 's-crop' }, { at: 0.3, cls: 's-look' }, { at: 0.46, cls: 's-finish' }, { at: 0.62, cls: 's-fmt' }, { at: 0.78, cls: 's-seal' }];
const CROP = ['wide', 'square', 'whole'], LOOK = ['crisp', 'deep', 'vintage'], FINISH = ['none', 'studio', 'cutout'], FMT = ['auto', 'avif', 'jxl', 'webp'];

export default {
  id: 's7',
  mount(stage, world) {
    const doc = document, v = new Vector3(), P = [0, 0, 0];
    const fig = doc.getElementById('ascent-print'), frame = doc.getElementById('ap-frame'), lines = doc.getElementById('ap-lines');
    const polaroid = doc.getElementById('polaroid'), polCanvas = doc.getElementById('pol-canvas'), flash = doc.getElementById('flash');
    // the felt print, as a picture the page's CSS can grade (once)
    const img = frame.querySelector('img');
    try { img.src = feltPrint().image.toDataURL('image/jpeg', 0.9); } catch (e) { /* the frame stays empty */ }
    let token = null, tokenFor = '', shown = -2, recipe = '', flashed = false, on = false, w = 0, h = 0, last = '';
    // (on a phone the print hangs down to the top of the climb's own card, measured with it)
    const climbBeat = doc.querySelector('#s7 .s-climb > *');
    let floor = 0;

    const setRecipe = () => {
      const c = stage.choices;
      const r = CROP[c.crop] + LOOK[c.look] + FINISH[c.finish] + FMT[c.format] + c.seal;
      if (r === recipe) return;
      recipe = r;
      for (const el of [frame, polaroid.querySelector('.pol-img')]) {
        el.dataset.crop = CROP[c.crop]; el.dataset.look = LOOK[c.look]; el.dataset.finish = FINISH[c.finish]; el.dataset.fmt = FMT[c.format]; el.dataset.sealed = String(c.seal === 1);
      }
      shown = -2; w = 0;
      if (c.seal === 1) {
        const rem = remainder(c);
        if (rem !== tokenFor) { tokenFor = rem; token = null; seal(rem).then((t) => { if (tokenFor === rem) { token = t || ''; shown = -2; } }); }
      }
    };
    stage.onChoice(setRecipe);
    setRecipe();

    // The URL as far as it has been applied: its lines top to bottom as the URL reads (each path
    // segment starts with a slash, each filter after the first with a colon), the one just
    // added marked; sealed, at the last step the whole recipe folds into one token.
    const ticket = (n) => {
      const c = stage.choices, done = (i) => i <= n, rows = [];
      if (done(4) && c.seal === 1) return [{ text: 's1.' + (token ? token.slice(3, 15) : '…') + '…', now: true }, { text: '/print.jpg' }];
      if (done(4)) rows.push({ text: sign(remainder(c)).slice(0, 8) + '…', of: 4 });
      if (done(0)) rows.push({ text: '/' + OPTIONS.crop[c.crop], of: 0 });
      if (done(1)) rows.push({ text: '/filters:' + OPTIONS.look[c.look], of: 1 });
      if (done(2)) rows.push(OPTIONS.finish[c.finish] ? { text: ':' + OPTIONS.finish[c.finish], of: 2 } : { text: 'no finish', of: 2, mute: true });
      if (done(3)) rows.push(OPTIONS.format[c.format] ? { text: ':' + OPTIONS.format[c.format], of: 3 } : { text: 'no format: Accept picks AVIF', of: 3, mute: true });
      rows.push({ text: '/root:photos/print.jpg', of: -1 });
      for (const r of rows) r.now = r.of === n;
      return rows;
    };
    const paintTicket = (n) => {
      lines.replaceChildren(...ticket(n).map((row) => {
        const li = doc.createElement('li');
        // (a long line breaks after a colon or a comma, not in the middle of a word)
        const parts = row.text.match(/[^:,]+[:,]?|[:,]/g) || [row.text];
        if (parts.length > 1 && parts[0].length === 1) parts.splice(0, 2, parts[0] + parts[1]);
        parts.forEach((part, i) => { if (i) li.append(doc.createElement('wbr')); li.append(part); });
        if (row.now) li.className = 'fresh';
        if (row.mute) li.classList.add('mute');
        if (row.text.startsWith(':')) li.classList.add('more');
        return li;
      }));
      w = 0;
    };

    this.tick = () => {
      const p = stage.p, q = (p - CLIMB[0]) / (CLIMB[1] - CLIMB[0]);
      // the lines that show the climb: in over the first 6.5 %, out from 84 % to 97 %
      const amount = q > 0 && q < 1 ? smooth(0, 0.065, q) * (1 - smooth(0.84, 0.97, q)) : 0;
      world.engine.ascent(amount, Math.min(Math.max(q, 0), 1));

      // the print on the pincer, with its ticket, while the bands are up
      const show = q > 0.03 && q < 0.93;
      stage.printFigure = show || p > 7.86;      // (the 3D print on the pincer stays hidden meanwhile)
      if (show !== on) { on = show; fig.classList.toggle('on', show); if (show) { w = 0; shown = -2; } }
      if (on) {
        let n = -1;
        for (let i = 0; i < STEPS.length; i++) { const d = q >= STEPS[i].at; frame.classList.toggle(STEPS[i].cls, d); if (d) n = i; }
        if (n !== shown) { shown = n; paintTicket(n); }
        if (!w) {
          w = fig.offsetWidth; h = fig.offsetHeight;
          floor = climbBeat && climbBeat.offsetHeight ? stage.H - (parseFloat(getComputedStyle(climbBeat).bottom) || 8) - climbBeat.offsetHeight : 0;
        }
        // it hangs from the pincer by its top corner, kept on screen (its ticket above the bottom edge)
        world.cast.pincerAt(v);
        stage.project(v, P);
        const right = stage.W - w - (stage.wide ? 64 : 14);
        // (on a phone, above the words' sheet along the bottom: under the pincer, so the cockpit
        // and Snap in it show, where the climb's card leaves room)
        const bottom = stage.wide ? stage.H : floor > stage.H * 0.4 ? floor : stage.H * 0.54;
        const x = Math.max(10, Math.min(P[0] - 10, right)), y = Math.max(stage.wide ? 90 : 112, Math.min(P[1] - 6, bottom - h - 10));
        const key = Math.round(x) + ',' + Math.round(y);
        if (key !== last) { last = key; fig.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)'; }
      }

      // the finale: when he is home and the receipt is up, his claw clicks, a flash, and the
      // polaroid of the picture drops in; leaving the surface lifts it again
      if (!flashed && p > 7.955) {
        flashed = true;
        world.cast.react('snap');
        flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
        const served = doc.getElementById('served');
        if (served && served.width > 1) {
          polCanvas.width = served.width; polCanvas.height = served.height;
          polCanvas.getContext('2d').drawImage(served, 0, 0);
        }
        polaroid.classList.add('drop');
      }
      if (flashed && p < 7.8) { flashed = false; polaroid.classList.remove('drop'); }
    };
  },
  frame(stage) { if (this.tick) this.tick(); },
};
