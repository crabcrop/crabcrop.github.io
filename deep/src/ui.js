// The page around the scene: the words, the URL being built, the depth gauge and the
// controls. Nothing here touches the renderer. The main loop reads ui.pTo (where the
// scroll says the camera should be) and calls ui.frame(p, dt) with where it actually is.
//
// How the dive is laid out (template.html): each zone is a <section> of slots, one slot per
// beat (a heading, a card, a choice). A slot is a stretch of scroll whose height is a share
// of the window's (its --s). Its beat is sticky at the foot of the window while the slot
// passes, rises when the slot ends, and fades as it rises, so one beat reads at a time and
// the next takes its place. Zone i runs from p = i to p = i + 1: it starts when its section's
// top is LEAD of the way down the window (so p reaches i as the zone's first beat rises
// into place), and the last zone ends at the bottom of the page. The last zone has one more
// knot: the climb (p 7 to CLIMB[1]) ends as the finale's slot starts to come into view, so
// "Your image, served" rises at the surface, not halfway up.
// Every length is a share of the window's height, so a beat sits at the same p on any
// screen.
import { CLIMB, P_MAX, ZONES, storyDepth } from './layout.js';
import { BASE, KEYS, NAME, NOTES, OPTIONS, SRC, remainder, seal, sign } from './content.js';

const LEAD = 0.85;
const FADE = 0.2;          // a rising beat is gone after this share of the window's height
const STEPS = 20;          // how finely a beat's fade is set
const HOST = 'https://<wbr>img.example.com/<wbr>';

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// code breaks only between its parts: after a slash, a colon or a comma
const soft = (t) => esc(t).replace(/([/:,])(?=[^/\s])/g, '$1<wbr>');
const smooth01 = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

// How deep the dive is at p, in metres, for the gauge (and the sound): the story's depth
// (storyDepth eases each zone's depth into the next across the zone), except where the
// camera does not move that way. The wreck sits on its ledge at its own depth, and Snap
// boards the submarine there: the drop begins once its canopy is locked (DROP), easing into
// the twilight's depths; the vents hold their depth while the camera is among them; the
// climb back to the surface happens in the last zone, where the camera climbs.
const WRECK = -ZONES[4].depth, VENTS = -ZONES[6].depth;
const DROP = [4.97, 5.3];
export function depthAt(p) {
  if (p < 4 || (p >= DROP[1] && p < 6)) return -storyDepth(p);
  if (p < DROP[0]) return WRECK;
  if (p < DROP[1]) return WRECK + (-storyDepth(DROP[1]) - WRECK) * smooth01((p - DROP[0]) / (DROP[1] - DROP[0]));
  if (p < 7) return VENTS;
  return VENTS * (1 - smooth01((p - 7) / 0.75));
}
// The gauge's words for every depth it can show, made once: whole metres to 100, then
// fives to 1,000, then tens.
const metres = (m) => (m === 0 ? '0 m' : '−' + m.toLocaleString('en-US') + ' m');
const DEPTHS = [];
for (let m = 0; m < 100; m++) DEPTHS.push(metres(m));
for (let m = 100; m < 1000; m += 5) DEPTHS.push(metres(m));
for (let m = 1000; m <= 4000; m += 10) DEPTHS.push(metres(m));
const depthIndex = (d) => Math.min(DEPTHS.length - 1, Math.max(0, d < 99.5 ? Math.round(d) : d < 997.5 ? 100 + Math.round((d - 100) / 5) : 280 + Math.round((d - 1000) / 10)));
const OPACITY = [];
for (let i = 0; i <= STEPS; i++) OPACITY.push(i === STEPS ? '' : String(i / STEPS));

export function createUI(opts = {}) {
  const doc = document, root = doc.documentElement;
  const $ = (id) => doc.getElementById(id);
  const params = new URLSearchParams(location.search);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canDraw = typeof WebGL2RenderingContext !== 'undefined' || !!navigator.gpu;
  const why = params.has('page') ? 'asked' : reduced ? 'motion' : !canDraw ? 'gl' : '';

  const ui = {
    mode: why ? 'page' : 'dive',
    pTo: 0,
    choices: { format: 0, look: 0, crop: 0, finish: 0, seal: 0 },
    // the sealed token minted for the recipe while Choice 5 is sealed (null while it is being
    // minted, '' where this page cannot seal): the cabin's chest shows the same one as the bar
    get token() { return token; },
    statsOn: false,
    loading, ready, failed, frame, stats,
    // pick option i of a choice from elsewhere (a curtain in the forest, the wax seal): its
    // radio is checked as if clicked
    choose(key, i) {
      const input = words.querySelectorAll('fieldset[data-choice="' + key + '"] input[type="radio"]')[i];
      if (!input || input.checked) return;
      input.checked = true;
      choose(key, i);
    },
    // the parts of the page that answer a choice (a zone's live specimens) register here
    onChoice: [], onPreview: [],
  };

  const bar = $('bar'), urlEl = $('url'), finalEl = $('final-url'), finalNote = $('final-note');
  const words = $('words'), gauge = $('gauge'), gaugeList = gauge.querySelector('ol'), mark = $('mark');
  const depthEl = $('depth'), zoneEl = $('zone'), statsEl = $('stats'), sayEl = $('say');
  const soundBtn = $('sound'), gear = $('gear'), settings = $('settings');
  const sections = ZONES.map((z) => $(z.id));
  const links = [...gauge.querySelectorAll('a')];
  const NAMES = ZONES.map((z) => z.name);
  const slots = [...words.querySelectorAll('.slot')];
  const beats = slots.map((s) => s.firstElementChild);
  const N = beats.length;
  const first = sections.map((s) => slots.indexOf(s.querySelector('.slot')));   // each zone's first beat
  const finJ = slots.indexOf(doc.querySelector('#s7 .s-fin'));                    // the finale's slot
  const status = {};
  for (const k of KEYS) status[k] = $('st-' + k);

  // ---- which page this is ----------------------------------------------------------------

  if (ui.mode === 'dive' && !matchMedia('(scripting: enabled)').matches) {
    // A browser that does not know the `scripting` media feature skips the dive's block of
    // rules: open it, now that a script is plainly running.
    try {
      for (const r of doc.styleSheets[0].cssRules) {
        if (r.media && r.cssRules[0] && /^:root:not\(\.page\)/.test(r.cssRules[0].selectorText)) r.media.mediaText = 'all';
      }
    } catch (e) { /* the page still reads */ }
  }
  root.classList.add(ui.mode);

  let paged = false;
  function toPage(reason, detail) {
    ui.mode = 'page';
    // (the cards that follow the choices are kept up by page.js from here: once, after this
    // page's own set-up has finished)
    if (!paged && opts.onPage) { paged = true; setTimeout(() => opts.onPage(), 0); }
    root.classList.remove('dive', 'ready');
    root.classList.add('page');
    const note = $('mode-note'), link = $('page-link');
    note.textContent = reason === 'asked' ? 'Here is the dive as a page: the same words, without the scene.'
      : reason === 'motion' ? 'Your device asks for less motion, so here is the dive as a page: the same words, without the scene.'
      : reason === 'gl' ? 'This browser cannot draw the scene (it has no WebGL 2), so here is the dive as a page: the same words.'
      : 'The scene could not start' + (detail ? ' (' + detail + ')' : '') + ', so here is the dive as a page: the same words.';
    note.hidden = false;
    if (reason === 'asked' && canDraw && !reduced) {
      const a = link.querySelector('a');
      a.textContent = 'See the dive instead';
      a.href = location.pathname + location.hash;
    } else link.hidden = true;
    $('again-label').textContent = 'Back to the top';
    for (const b of beats) { b.style.opacity = ''; b.classList.remove('gone'); }
    settings.hidden = true;
    gear.setAttribute('aria-expanded', 'false');
    statsEl.hidden = true;
    ui.statsOn = false;
    for (const k of PARTS) lit.add(k);
    paint();
  }

  // ---- the URL ---------------------------------------------------------------------------

  // The parts of the URL that are lit: in the dive each lights when the visitor reaches the
  // beat that names it (or makes its choice); as a page they all are.
  const PARTS = ['sig', 'crop', 'look', 'finish', 'format', 'seal', 'src'];
  const lit = new Set();
  let fresh = '';          // the part just chosen: it glows once
  let full = '';           // the whole URL, for copying
  let token = null, tokenFor = '', sealing = 0;

  for (const fs of words.querySelectorAll('fieldset[data-choice]')) {
    const key = fs.dataset.choice;
    fs.querySelectorAll('input[type="radio"]').forEach((input, i) => {
      if (input.checked) ui.choices[key] = i;       // (a browser may have kept a choice across a reload)
      input.addEventListener('change', () => { if (input.checked) choose(key, i); });
      // hovering or focusing an option shows it in the scene for as long as it lasts
      const opt = input.closest('.opt') || input;
      opt.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') preview(key, i); });
      opt.addEventListener('pointerleave', () => preview(key, null));
      input.addEventListener('focus', () => { if (input.matches(':focus-visible')) preview(key, i); });
      input.addEventListener('blur', () => preview(key, null));
    });
    if (ui.choices[key]) status[key].textContent = NOTES[key][ui.choices[key]];
  }

  // Each choice's panel: "Your turn · Choice N of 5" with five dots (the ones before filled),
  // and under its options the URL as far as that choice, the part it chose marked (a later
  // panel shows more of it; the last shows it whole, or sealed). As in the painted dive.
  const farEls = {};
  KEYS.forEach((key, n) => {
    const fs = words.querySelector('fieldset[data-choice="' + key + '"]');
    if (!fs) return;
    const turn = fs.querySelector('legend .turn');
    if (turn) turn.innerHTML = '<span class="yt">Your turn</span> <span class="of">Choice ' + (n + 1) + ' of 5</span><span class="dots" aria-hidden="true">' + [0, 1, 2, 3, 4].map((d) => '<i' + (d < n ? ' class="on"' : d === n ? ' class="now"' : '') + '></i>').join('') + '</span>';
    const far = doc.createElement('p');
    far.className = 'so-far js-only';
    fs.after(far);
    farEls[key] = far;
  });
  let changedKey = '';
  function soFar() {
    const c = ui.choices, fmt = OPTIONS.format[c.format], look = OPTIONS.look[c.look], crop = OPTIONS.crop[c.crop], fin = OPTIONS.finish[c.finish];
    const src = '/root:photos/print.jpg', tail = (fmt ? ':' + fmt : '') + src, rem = remainder(c);
    const dim = (t) => '<span class="dim">' + soft(t) + '</span>', mark = (t) => '<mark>' + soft(t) + '</mark>';
    const lines = {
      format: dim('…/') + (fmt ? dim('filters:') + mark(fmt) : '') + dim(fmt ? src : src.slice(1)),
      look: dim('…/filters:') + mark(look) + dim(tail),
      crop: dim('…/') + mark(crop) + dim('/filters:' + look + tail),
      finish: dim('…/' + crop + '/filters:' + look) + (fin ? dim(':') + mark(fin) : '') + dim(tail),
      seal: c.seal && token !== '' ? dim(BASE) + mark(token ? token.slice(0, 14) + '…' : 's1.…') + dim('/' + NAME) : dim(BASE + sign(rem).slice(0, 8) + '…/') + soft(rem),
    };
    for (const k of KEYS) {
      const el = farEls[k];
      if (!el) continue;
      const html = '<span class="lab">Your URL so far</span><code>' + lines[k] + '</code>';
      if (el.innerHTML !== html) el.innerHTML = html;
      if (k === changedKey) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
    }
    changedKey = '';
  }

  function choose(key, i) {
    changedKey = key;
    ui.choices[key] = i;
    status[key].textContent = NOTES[key][i];
    fresh = key === 'seal' ? (i ? 'seal' : 'sig') : key;
    lit.add(fresh);
    render();
    if (opts.onChoice) opts.onChoice(key, i);
    for (const f of ui.onChoice) f(key, i);
  }
  function preview(key, i) { for (const f of ui.onPreview) f(key, i); }

  function render() {
    const c = ui.choices;
    if (c.seal) {
      const rem = remainder(c);
      if (tokenFor !== rem) {
        // a sealed token is minted afresh (a new nonce) whenever the recipe changes
        token = null;
        tokenFor = rem;
        const n = ++sealing;
        seal(rem).then((t) => { if (n !== sealing) return; token = t || ''; paint(); });
      }
    }
    paint();
  }

  const part = (k, html, title) => '<span class="part p-' + k + (lit.has(k) ? ' lit' : '') + (fresh === k ? ' new' : '') + '"' + (title ? ' title="' + title + '"' : '') + '>' + html + '</span>';

  function paint() {
    const c = ui.choices, rem = remainder(c), sig = sign(rem);
    const readable = BASE + sig + '/' + rem;
    let html;
    if (c.seal && token !== '') {
      // sealed: the token takes the signature's place and carries everything up to the name
      html = HOST + part('seal', token ? esc(token.slice(0, 14)) + '…' : 's1.…', 'The sealed token, shortened here') + '/<wbr>' + part('src', NAME);
      full = token ? BASE + token + '/' + NAME : '';
      finalEl.innerHTML = token ? soft(full) : 'Sealing…';
      finalNote.innerHTML = 'Sealed in your browser with the sample secret <code>demo-secret</code> and a fresh nonce, on a stand-in host. Seal the same recipe with your own secret, on a server with a <code>photos</code> source root, and it opens and serves it.';
    } else {
      const f = OPTIONS.finish[c.finish], fm = OPTIONS.format[c.format];
      html = HOST + part('sig', sig.slice(0, 8) + '…', 'The signature, shortened here') + '/<wbr>' + part('crop', soft(OPTIONS.crop[c.crop])) + '/<wbr>filters:<wbr>' + part('look', soft(OPTIONS.look[c.look]))
        + (f ? ':<wbr>' + part('finish', soft(f)) : '') + (fm ? ':<wbr>' + part('format', soft(fm)) : '') + '/<wbr>' + part('src', soft(SRC));
      full = readable;
      finalEl.innerHTML = soft(full);
      finalNote.innerHTML = c.seal
        ? 'This page cannot seal here (it needs a secure page), so this is the readable URL. Seal the recipe with <code>crabcrop seal</code> and your own secret.'
        : 'Signed in your browser with the sample secret <code>demo-secret</code>, on a stand-in host. Sign the same path with your own secret, on a server with a <code>photos</code> source root (and a background-removal model for a finish), and it serves the picture.';
    }
    urlEl.innerHTML = html;
    soFar();
    if (!(c.seal && token === null)) fresh = '';   // (a token on its way keeps the glow for when it lands)
  }

  // A part comes into view in the dive: light it, without redrawing the rest.
  function light(k) {
    if (lit.has(k)) return;
    lit.add(k);
    const el = urlEl.querySelector('.p-' + k);
    if (el) el.classList.add('lit', 'new');
  }

  // ---- copying, sound, settings, keys ----------------------------------------------------

  let sayTimer = 0;
  function say(text) {
    sayEl.textContent = '';
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { sayEl.textContent = text; }, 60);
  }
  function flash(btn, text) {
    const label = btn.querySelector('span') || btn;
    if (!btn.dataset.label) btn.dataset.label = label.textContent;
    label.textContent = text;
    clearTimeout(btn._t);
    btn._t = setTimeout(() => { label.textContent = btn.dataset.label; }, 1600);
  }
  async function copy(btn, text) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
      try {
        const ta = doc.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.className = 'sr';
        doc.body.append(ta);
        ta.select();
        ok = doc.execCommand('copy');
        ta.remove();
      } catch (e2) { /* nothing more to try */ }
    }
    flash(btn, ok ? 'Copied' : 'Not copied');
    say(ok ? 'Copied.' : 'Could not copy. Select the text to copy it.');
  }
  $('copy-url').addEventListener('click', (e) => copy(e.currentTarget, full));
  $('copy-final').addEventListener('click', (e) => copy(e.currentTarget, full));
  $('copy-install').addEventListener('click', (e) => copy(e.currentTarget, $('install-cmd').textContent));
  if ($('copy-hero')) $('copy-hero').addEventListener('click', (e) => copy(e.currentTarget, $('hero-cmd').textContent));

  let soundOn = false;
  function setSound(on) {
    soundOn = on;
    soundBtn.setAttribute('aria-pressed', String(on));
    if (opts.onSound) opts.onSound(on);
  }
  soundBtn.addEventListener('click', () => setSound(!soundOn));

  function openSettings(open) {
    settings.hidden = !open;
    gear.setAttribute('aria-expanded', String(open));
  }
  gear.addEventListener('click', () => openSettings(settings.hidden));
  doc.addEventListener('pointerdown', (e) => { if (!settings.hidden && !settings.contains(e.target) && !gear.contains(e.target)) openSettings(false); });
  const level = opts.level || 'auto';
  for (const input of settings.querySelectorAll('input[name="level"]')) {
    input.checked = input.value === level;
    input.addEventListener('change', () => { if (input.checked && opts.onLevel) opts.onLevel(input.value); });
  }

  addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target;
    if (t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type !== 'radio' && t.type !== 'checkbox'))) return;
    if (e.key === 'Escape' && !settings.hidden) { openSettings(false); gear.focus(); return; }
    if (ui.mode !== 'dive') return;
    if (e.key === 'm' || e.key === 'M') { setSound(!soundOn); say(soundOn ? 'Sound on' : 'Sound off'); }
    else if (e.key === 'h' || e.key === 'H') { ui.statsOn = !ui.statsOn; statsEl.hidden = !ui.statsOn; }
  });

  // ---- moving through the dive -----------------------------------------------------------

  const top8 = new Float64Array(8), K = new Float64Array(9);
  const slotTop = new Float64Array(N), slotBot = new Float64Array(N), beatH = new Float64Array(N);
  const shown = new Int8Array(N).fill(STEPS), gone = new Uint8Array(N);
  const lightBeats = [], lightParts = [], lightY = [];
  beats.forEach((b, j) => { if (b.dataset.lights) { lightBeats.push(j); lightParts.push(b.dataset.lights); lightY.push(0); } });
  let vh = innerHeight, low = 0, maxY = 1, barBottom = -1, gaugeOn = false, gaugeH = 0, MARK = [], KS = 0;   // KS: where the climb ends (the scroll)
  let shownG = -1, shownD = -1, shownZ = -1, shownWay = null, shownNight = null, quiet = false, measured = false;

  // Where zone i's first beat has settled in place: the scroll a jump to that zone goes to.
  const zoneStart = (i) => (i <= 0 ? 0 : Math.min(maxY, Math.max(0, slotTop[first[i]] - vh + low + beatH[first[i]] + 2)));

  function measure() {
    if (ui.mode !== 'dive') return;
    vh = innerHeight;
    const y0 = scrollY;
    for (let i = 0; i < 8; i++) top8[i] = sections[i].getBoundingClientRect().top + y0;
    for (let j = 0; j < N; j++) {
      const r = slots[j].getBoundingClientRect();
      slotTop[j] = r.top + y0;
      slotBot[j] = r.bottom + y0;
      beatH[j] = beats[j].offsetHeight;
    }
    low = parseFloat(getComputedStyle(beats[1]).bottom) || 0;
    maxY = Math.max(1, root.scrollHeight - vh);
    K[0] = 0;
    for (let i = 1; i < 8; i++) K[i] = Math.min(maxY - (8 - i), Math.max(K[i - 1] + 1, top8[i] - LEAD * vh));
    K[8] = Math.max(maxY, K[7] + 1);
    KS = finJ < 0 ? 0 : Math.min(K[8] - 1, Math.max(K[7] + 1, slotTop[finJ] - vh));
    for (let k = 0; k < lightBeats.length; k++) { const j = lightBeats[k]; lightY[k] = slotTop[j] - vh + low + beatH[j]; }
    // the bar's foot, for what sits under it
    const b = bar.getBoundingClientRect().bottom;
    if (Math.abs(b - barBottom) > 0.5) { barBottom = b; root.style.setProperty('--top', Math.round(b) + 'px'); }
    // the gauge: a line on wide screens (its marker's positions made once per size), a label on narrow ones
    gaugeOn = getComputedStyle(gaugeList).display !== 'none';
    const h = gaugeOn ? Math.round(gaugeList.offsetHeight) : 0;
    if (h !== gaugeH) {
      gaugeH = h;
      MARK = [];
      for (let i = 0; i <= h; i++) MARK.push('translateY(' + i + 'px)');
      shownG = -1;
    }
    measured = true;
    update();
  }

  // On scroll: where the camera should be, which beats are rising away, and which parts of
  // the URL have come into view.
  function update() {
    if (ui.mode !== 'dive' || !measured) return;
    const y = scrollY;
    let i = 0;
    while (i < 8 && y >= K[i + 1]) i++;
    if (i === 7 && KS) {
      const up = CLIMB[1] - 7;
      ui.pTo = y < KS ? 7 + (up * (y - K[7])) / (KS - K[7]) : Math.min(P_MAX, 7 + up + ((1 - up) * (y - KS)) / (K[8] - KS));
    } else ui.pTo = i >= 8 ? P_MAX : Math.max(0, i + (y - K[i]) / (K[i + 1] - K[i]));
    const fade = FADE * vh;
    for (let j = 0; j < N; j++) {
      const risen = y + vh - low - slotBot[j];
      const o = risen <= 0 ? STEPS : Math.max(0, STEPS - Math.round((STEPS * risen) / fade));
      if (o === shown[j]) continue;
      shown[j] = o;
      beats[j].style.opacity = OPACITY[o];
      const g = o === 0 ? 1 : 0;
      if (g !== gone[j]) { gone[j] = g; beats[j].classList.toggle('gone', g === 1); }
    }
    for (let k = 0; k < lightBeats.length; k++) if (y >= lightY[k]) light(lightParts[k]);
  }
  // The card that is in its place now (risen into view and not yet rising away), or null: Snap
  // visits it when the visitor pauses.
  ui.cardInPlace = () => {
    if (ui.mode !== 'dive' || !measured) return null;
    const y = scrollY;
    for (let j = N - 1; j >= 0; j--) {
      if (gone[j] || shown[j] !== STEPS) continue;
      if (y >= slotTop[j] - vh + low + beatH[j] && y + vh - low <= slotBot[j]) return beats[j];
    }
    return null;
  };

  let pending = false;
  const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(() => { pending = false; measure(); }); } };

  function go(i, smooth) {
    const h = sections[i].querySelector('h1, h2') || $('h7');
    quiet = true;
    try { h.focus({ preventScroll: true }); } finally { quiet = false; }
    scrollTo({ top: zoneStart(i), behavior: smooth ? 'smooth' : 'auto' });
  }

  $('start').addEventListener('click', (e) => {
    if (ui.mode !== 'dive') return;            // as a page, the link goes to the shallows
    e.preventDefault();
    go(1, true);
    if (opts.onStart) opts.onStart();
  });
  // Dive again, and the foot of the page: the view fades to the next morning while the page
  // goes back to the top, every choice kept (so the URL in the bar is the whole one), and fades
  // back in on Snap at the start with his print again. (As a page, a plain jump.)
  let looping = false, lastY = scrollY;
  const dawn = $('dawn');
  function loop() {
    if (looping) return;
    if (ui.mode !== 'dive' || !dawn) { go(0, false); return; }
    looping = true;
    dawn.classList.add('on');
    setTimeout(() => {
      quiet = true;
      try { $('h0').focus({ preventScroll: true }); } finally { quiet = false; }
      scrollTo({ top: 0, behavior: 'instant' });
      lastY = 0;
      setTimeout(() => { dawn.classList.remove('on'); setTimeout(() => { looping = false; }, 500); }, 650);
    }, 480);
  }
  ui.loop = loop;
  $('again').addEventListener('click', (e) => {
    e.preventDefault();
    loop();
  });
  // (scrolling on down past the finale: once the very foot of the page is reached going down)
  addEventListener('scroll', () => {
    const y = scrollY;
    if (ui.mode === 'dive' && measured && !looping && y > lastY && y >= maxY - 2 && maxY > vh) loop();
    lastY = y;
  }, { passive: true });
  links.forEach((a, i) => a.addEventListener('click', (e) => {
    if (ui.mode !== 'dive') return;
    e.preventDefault();
    go(i, false);
  }));

  // A keyboard visitor tabbing into a beat that is not in its place (still rising into view,
  // or already rising away) is taken to where it rests.
  words.addEventListener('focusin', (e) => {
    if (ui.mode !== 'dive' || quiet || !measured) return;
    let t = e.target;
    try { if (!t.matches(':focus-visible')) return; } catch (err) { /* old browsers: go on */ }
    const beat = t.closest('.beat');
    const j = beats.indexOf(beat);
    if (j < 0) return;
    const a = slotTop[j] - vh + low + beatH[j], b = slotBot[j] - vh + low, y = scrollY;
    if (y < a || y > b) scrollTo({ top: Math.min(Math.max(y, a + 1), b - 1), behavior: 'auto' });
  });

  // ---- start ----------------------------------------------------------------------------

  if (ui.mode === 'page') toPage(why);
  else render();
  if (ui.mode === 'dive') {
    addEventListener('scroll', update, { passive: true });
    addEventListener('resize', schedule);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(schedule);
      ro.observe(words);
      ro.observe(bar);
      for (const b of beats) ro.observe(b);
    }
    measure();
    // arriving at a zone's address (#s3) lands on that zone's first beat
    const atHash = () => { const i = ZONES.findIndex((z) => '#' + z.id === location.hash); if (i > 0) scrollTo({ top: zoneStart(i), behavior: 'auto' }); };
    atHash();
    addEventListener('hashchange', atHash);
    // (the browser's own jump to the fragment can come after this script, so once more at load)
    addEventListener('load', () => { if (scrollY < 2 || ZONES.some((z) => '#' + z.id === location.hash)) atHash(); }, { once: true });
  }

  // ---- what the main loop calls ----------------------------------------------------------

  let shownLoad = -1, shownLabel = '';
  function loading(fraction, label) {
    const v = Math.round(Math.max(0, Math.min(1, fraction || 0)) * 100);
    if (v !== shownLoad) {
      shownLoad = v;
      $('load-fill').style.transform = 'scaleX(' + v / 100 + ')';
      $('load-track').setAttribute('aria-valuenow', String(v));
      $('load-pc').textContent = v + '%';
    }
    if (label && label !== shownLabel) { shownLabel = label; $('load-label').textContent = label; }
  }

  function ready() {
    if (ui.mode !== 'dive') return;
    loading(1);
    root.classList.add('ready');
  }

  function failed(reason) {
    if (ui.mode === 'page') return;
    const z = Math.min(7, Math.max(0, Math.floor(ui.pTo)));
    toPage('failed', reason);
    if (z > 0) sections[z].scrollIntoView();
    else scrollTo(0, 0);
  }

  // Once per animation frame, with where the camera is. Allocates nothing; writes to the
  // page only when what it shows changes.
  function frame(p, dt) {
    if (ui.mode !== 'dive') return;
    if (!(p >= 0)) p = 0; else if (p > P_MAX) p = P_MAX;
    if (gaugeOn) {
      const g = Math.round((p / P_MAX) * gaugeH);
      if (g !== shownG) { shownG = g; mark.style.transform = MARK[g]; }
    }
    const d = depthIndex(depthAt(p));
    if (d !== shownD) { shownD = d; depthEl.textContent = DEPTHS[d]; }
    const z = p >= 7 ? 7 : Math.floor(p);
    // (between the places, the readout names the way: as in the painted dive)
    const way = p > 0.22 && p < 1.05 ? 'The plunge' : p > 2.88 && p < 3.06 ? 'To the reef' : p > 4.36 && p < 4.5 ? 'Into the wreck' : p > 5.0 && p < 5.32 ? 'The drop' : p > 7.02 && p < 7.74 ? 'The ascent' : '';
    if (way !== shownWay) { shownWay = way; zoneEl.textContent = way || NAMES[z]; }
    // below the wreck what floats over the scene turns to night colours
    const night = depthAt(p) < -140;
    if (night !== shownNight) { shownNight = night; root.classList.toggle('night', night); }
    if (z !== shownZ) {
      if (shownZ >= 0) links[shownZ].removeAttribute('aria-current');
      else for (const a of links) a.removeAttribute('aria-current');
      links[z].setAttribute('aria-current', 'step');
      if (!way) zoneEl.textContent = NAMES[z];
      shownZ = z;
    }
  }

  let shownStats = '';
  function stats(text) {
    if (!ui.statsOn || text === shownStats) return;
    shownStats = text;
    statsEl.textContent = text;
  }

  return ui;
}
