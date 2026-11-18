// The page as plain words (no WebGPU or WebGL 2, reduced motion, ?page): the zones' modules do
// not run, so the cards' specimens that follow the visitor's choices are kept up here, with the
// same words the dive gives them (zones/s4.js, s5.js, s6.js): the Sealed URLs card's URL and its
// chest, the ship's log, the meta answer (every creature counted as found), the explain report,
// the SDK call (TypeScript, the tabs stay shut) and the agent's log. And the finale shows the
// visitor's picture: the photo (photo.js), framed, graded and finished by the page's own styles,
// as the climb's print is in the dive.
import { NAME, remainder, seal } from './content.js';
import { PHOTO, cutoutURL, photoFile, photoReady } from './photo.js';
import { readableURL, shipLogHTML } from './zones/s4.js';
import { ALL_FOUND, explainHTML, metaHTML } from './zones/s5.js';
import { mcpHTML, sdkHTML } from './zones/s6.js';

const CROP = ['wide', 'square', 'whole'], LOOK = ['crisp', 'deep', 'vintage'], FINISH = ['none', 'studio', 'cutout'], FMT = ['auto', 'avif', 'jxl', 'webp'];
const soft = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([/:,])(?=[^/\s])/g, '$1<wbr>');

export function startPage(ui) {
  const doc = document, $ = (id) => doc.getElementById(id);
  const set = (el, html) => { if (el && el.innerHTML !== html) el.innerHTML = html; };

  // ---- the Sealed URLs card: its URL, readable or sealed by its chest
  const chest = $('chest'), chestLabel = $('chest-label'), rest = $('sealed-rest');
  let sealed = false, token = '', tokenFor = '', minting = 0;
  const chestText = () => {
    if (!rest) return;
    set(rest, soft(sealed ? (token || 's1.…') + '/' + NAME : readableURL(ui.choices)));
    rest.classList.toggle('sealed', sealed);
  };
  const mint = () => {
    const rem = remainder(ui.choices);
    if (rem === tokenFor) return;
    tokenFor = rem; token = '';
    const n = ++minting;
    seal(rem).then((t) => { if (n === minting) { token = t || ''; chestText(); } });
  };
  if (chest) {
    chest.addEventListener('click', () => {
      sealed = !sealed;
      chest.setAttribute('aria-pressed', String(sealed));
      chest.style.setProperty('--open', sealed ? '0' : '1');
      if (chestLabel) chestLabel.textContent = sealed ? 'Open the chest: the URL is sealed' : 'Close the chest to seal the URL';
      chestText();
    });
  }

  // ---- the finale's picture: the photo, through the visitor's choices
  let pic = null, img = null;
  const cut = [null, null, null];
  const fig = doc.querySelector('.fin .served');
  if (fig) {
    pic = doc.createElement('span');
    pic.className = 'recipe-img served-pic s-crop s-look s-finish s-fmt s-seal';
    pic.setAttribute('role', 'img');
    pic.setAttribute('aria-label', 'The picture your URL serves: Snap at a skate park, with the crop, look and finish you chose');
    img = doc.createElement('img');
    img.alt = '';
    img.style.objectPosition = Math.round(PHOTO.mid[0] * 100) + '% ' + Math.round(PHOTO.mid[1] * 100) + '%';
    pic.append(img);
    const canvas = fig.querySelector('canvas');
    if (canvas) canvas.hidden = true;
    fig.append(pic);
    photoReady().then((ok) => {
      if (!ok) return;
      fig.hidden = false;
      cutoutURL(true).then((u) => { cut[1] = u; render(); });
      cutoutURL(false).then((u) => { cut[2] = u; render(); });
      render();
    });
  }

  // ---- everything that follows the choices
  const render = () => {
    const c = ui.choices;
    mint();
    chestText();
    set($('ship-log'), shipLogHTML(c));
    set($('tw-json'), metaHTML(c, ALL_FOUND).html);
    const t = typeof ui.token === 'string' && ui.token.startsWith('s1.') ? ui.token.slice(0, 14) + '…' : 's1.…';
    const r = explainHTML(c, t);
    set($('tw-req'), r.req);
    set($('tw-report'), r.report);
    const s = sdkHTML(c, 0);
    set($('vt-code'), s.code);
    set($('vt-out'), s.out);
    set($('vt-log'), mcpHTML(c));
    if (pic && photoFile()) {
      Object.assign(pic.dataset, { crop: CROP[c.crop], look: LOOK[c.look], finish: FINISH[c.finish], fmt: FMT[c.format], sealed: String(c.seal === 1) });
      const want = cut[c.finish] || photoFile();
      if (img.getAttribute('src') !== want) img.src = want;
    }
  };
  ui.onChoice.push(render);
  render();
  // (a sealed URL's token comes a moment after the choice: the explain card shows it then)
  const bar = $('url');
  if (bar && typeof MutationObserver !== 'undefined') new MutationObserver(() => { if (ui.choices.seal === 1) render(); }).observe(bar, { childList: true, subtree: true, characterData: true });
}
