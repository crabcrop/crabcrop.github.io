// The wreck and its captain's cabin (zone s4), as in the painted dive (experience/src/wreck-ui.ts,
// world/octopus.ts, world/motes.ts), on the 3D cabin the camera looks into through the hole in the
// hull (p 4.5 to 4.63). Things in the scene are projected onto the screen every frame and the
// page's pieces follow them. Its words are in zones/s4.html, its styles in zones/s4.css; the
// cabin's loose things (chest, stamp, wax, lantern, dust) are built in props/cabin.js.
//   the chest     on the Sealed URLs card (a button: a click, Enter or Space, or a drag on its lid)
//                 and in the cabin by the desk (a ring; a click or a drag): shut the lid and the
//                 visitor's own URL scrambles into a sealed token (a real one: content.js seal())
//   the wax seal  on the captain's desk (wide screens): a ring, its tip, a tied cue; a click flips
//                 Choice 5; the stamp presses its wax when the URL is sealed. Put away while the
//                 octopus is busy with its letter (one seal on screen at a time)
//   the letter    the octopus at its desk holds a letter: "Click (Tap) the letter to seal it"; Snap
//                 snaps his claw, red wax is pressed onto it, sparkles, the octopus wiggles, and
//                 Snap's story; sealed by itself 72 % of the way through the cabin
//   the lantern   swings toward the hand and with the scroll, flickering; the dust rises through
//                 its light, glinting warm near it, and swirls away from the hand
//   the cards     the ship's log written from the choices, line by line; the ledger stamped
//   the boarding  Snap's story once he has climbed into the submarine
import { Vector3 } from 'three/webgpu';
import { NAME, OPTIONS, remainder, seal, sign } from '../content.js';
import { clamp, smooth } from '../math.js';
import { buildCabin } from '../props/cabin.js';
import { G } from '../shaders.js';

const CABIN = [4.5, 4.63];                                 // the camera looks in; the octopus sits at its desk
const AUTO = CABIN[0] + 0.72 * (CABIN[1] - CABIN[0]);     // the letter is sealed by itself here
const SEATED = 4.655;                                      // the octopus gets up and leaves (fauna.js)
const RESET = 4.42;                                        // back out before the cabin: the letter waits again
const BOARDS = 4.84, BOARDED = 4.93;                       // Snap climbs into the submarine (cast.js)
const HAPPY = 2.4;                                         // the octopus's happy wiggle, seconds
const LETTER_NOTE = 'A little octopus has a letter only its friend should read. Snap presses his claw to the wax, and now nobody else can open it.';
const BOARD_NOTE = 'Past the wreck the sea floor drops away, far too deep for a crab to walk. The octopus returns the favor: its little submarine is waiting outside, and Snap climbs in.';
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// code breaks only between its parts: after a slash, a colon or a comma
const soft = (t) => esc(t).replace(/([/:,])(?=[^/\s])/g, '$1<wbr>');
// A fixed per-position random number, 0 to 1.
const jitter = (i) => { const x = Math.sin(i * 12.9898 + 4.1) * 43758.5453; return x - Math.floor(x); };
// The readable recipe turning into the token: each character flickers, then settles, left to
// right with some scatter (p: how shut the lid is).
function scramble(a, b, p) {
  const n = Math.max(a.length, b.length);
  let out = '';
  for (let i = 0; i < n; i++) {
    const at = ((i / n) * 0.6 + jitter(i) * 0.4) * 0.88, k = (p - at) / 0.1;
    if (k >= 1) out += b[i] ?? '';
    else if (k <= 0) out += a[i] ?? '';
    else out += i < Math.max(a.length * (1 - k), b.length * k) ? B64URL[(Math.random() * 64) | 0] : '';
  }
  return out;
}

const S = { cabin: null };

export default {
  id: 's4',
  build(ctx) {
    S.cabin = buildCabin(ctx, ctx.sets && ctx.sets.wreck);
    if (!S.cabin) return null;
    return { update(t, dt, p) { S.cabin.show(p > 4.2 && p < 4.95); } };
  },

  mount(stage, world) {
    const doc = document, cab = S.cabin, cast = world.cast, ui = world.ui;
    const sec = doc.getElementById('s4');
    if (!sec) return;
    sec.classList.add('live');
    const P = [0, 0, 0], Q = [0, 0, 0], H = [0, 0], SN = new Vector3(), GR = new Vector3(), AX = new Vector3();
    const say = (name) => { if (world.audio && world.audio.cue) world.audio.cue(name); };

    // ---- the visitor's URL: its readable form, and sealed (the page's own token when Choice 5 is
    // sealed, so the chest shows the one the bar does; else one minted here)
    let rem = '', sig8 = '', token = '', tokenFor = '', minting = 0, pollUntil = -1;
    const pageToken = () => {
      if (typeof ui.token === 'string' && ui.token.startsWith('s1.')) return ui.token;
      if (!stage.choices.seal) return '';
      const f = doc.getElementById('final-url'), m = f && /\/(s1\.[A-Za-z0-9_-]+)\//.exec(f.textContent);
      return m ? m[1] : '';
    };
    // (once a choice is made: the recipe, its signature, and a token minted for it)
    const refresh = () => {
      const r = remainder(stage.choices);
      if (r === rem) return;
      rem = r; sig8 = sign(r).slice(0, 8);
      tokenFor = rem; token = '';
      const n = ++minting;
      seal(rem).then((tk) => { if (n === minting && !token) { token = tk || ''; chestText(true); } });
      pollUntil = stage.t + 4;
    };

    // ---- the chest: open 1, shut 0; where the lid is heading
    const chestBtn = doc.getElementById('chest'), chestLabel = doc.getElementById('chest-label'), restEl = doc.getElementById('sealed-rest'), verbEl = doc.getElementById('chest-verb');
    const ch = { open: 1, target: 1, drag: null, dragged: false, locked: false, thunkAt: -1e9, poked: -1e9, text: '', sealedShown: null, openShown: '', tip: '' };
    const LABEL = ['Close the chest to seal the URL', 'Open the chest: the URL is sealed'];
    // (the place on the chest that takes the pointer, under its ring)
    const hit = stage.el('div', 'chest-hit'); hit.setAttribute('aria-hidden', 'true');
    const chestRing = stage.ring({ label: LABEL[0] });
    const chestTip = stage.el('div', 'tip s4-tip'); chestTip.setAttribute('aria-hidden', 'true');
    chestTip.innerHTML = '<code></code><span></span>';
    const tipCode = chestTip.firstChild, tipWords = chestTip.lastChild;
    let overChest = false;
    const go = (to) => { ch.target = to; ch.poked = stage.t; };
    // the card's chest and the one in the cabin: a click (or Enter, Space) opens or shuts it; a
    // drag moves the lid with the pointer (down shuts it, up opens it, 70 px for the whole way)
    const dragOn = (el, touchDrags) => {
      el.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch' && !touchDrags) return;
        ch.drag = { y: e.clientY, open: ch.open, moved: false, id: e.pointerId };
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* (a pointer that is gone) */ }
      });
      el.addEventListener('pointermove', (e) => {
        const d = ch.drag;
        if (!d || e.pointerId !== d.id) return;
        const dy = e.clientY - d.y;
        if (Math.abs(dy) > 4) d.moved = true;
        if (d.moved) { ch.open = clamp(d.open - dy / 70, 0, 1); ch.target = ch.open; ch.poked = stage.t; }
      });
      const end = () => { const d = ch.drag; if (!d) return; ch.drag = null; if (d.moved) { go(ch.open > 0.5 ? 1 : 0); ch.dragged = true; } };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('click', () => { if (ch.dragged) { ch.dragged = false; return; } go(ch.target > 0.5 ? 0 : 1); });
    };
    dragOn(chestBtn, true);
    dragOn(hit, false);
    chestRing.el.addEventListener('click', () => go(ch.target > 0.5 ? 0 : 1));
    for (const el of [hit, chestRing.el]) {
      el.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') overChest = true; });
      el.addEventListener('pointerleave', () => { overChest = false; });
    }
    chestRing.el.addEventListener('focus', () => { overChest = true; });
    chestRing.el.addEventListener('blur', () => { overChest = false; });
    // the URL beside the card's chest: readable while it is open, sealed once it is shut, and
    // scrambling from one to the other as the lid moves
    const chestText = (settled) => {
      const shut = 1 - ch.open, readable = sig8 + '…/' + rem, sealed = (token || 's1.…') + '/' + NAME;
      const text = settled || shut <= 0 || shut >= 1 ? (shut >= 0.5 ? sealed : readable) : scramble(readable, sealed, shut);
      if (text !== ch.text) { ch.text = text; restEl.innerHTML = soft(text); }
      const isSealed = shut >= 0.5;
      if (isSealed !== ch.sealedShown) { ch.sealedShown = isSealed; restEl.classList.toggle('sealed', isSealed); }
      // (and the tip by the chest in the cabin: the same, shortened as the bar shortens it)
      const short = settled || shut <= 0 || shut >= 1 ? (isSealed ? (token ? token.slice(0, 14) + '…' : 's1.…') + '/' + NAME : readable) : scramble(readable, (token ? token.slice(0, 14) + '…' : 's1.…') + '/' + NAME, shut);
      if (short !== ch.tip) { ch.tip = short; tipCode.textContent = short; tipCode.classList.toggle('sealed', isSealed); tipWords.textContent = isSealed ? LABEL[1] : LABEL[0]; tipW = 0; }
    };
    const chestState = () => {
      const o = ch.open.toFixed(3);
      if (o !== ch.openShown) { ch.openShown = o; chestBtn.style.setProperty('--open', o); }
      const locked = ch.open <= 0.001;
      if (locked !== ch.locked) {
        ch.locked = locked;
        chestBtn.classList.toggle('locked', locked);
        chestBtn.setAttribute('aria-pressed', String(locked));
        chestLabel.textContent = LABEL[locked ? 1 : 0];
        chestRing.el.setAttribute('aria-label', LABEL[locked ? 1 : 0]);
        if (locked) { ch.thunkAt = stage.t; say('lock'); }
      }
    };
    let tipW = 0, tipH = 0, sealW = 0, ringTab = { chest: -2, seal: -2 };
    refresh();
    chestText(true);

    // ---- the wax seal on the desk: its ring, its tip, its tied cue (wide screens)
    const sealRing = stage.ring({ label: 'Wax seal: seal your URL' });
    const sealTip = stage.el('div', 'tip s4-tip', stage.layer, '<b>Wax seal</b><code>s1.&lt;token&gt;</code><span>Click it to seal your URL</span>');
    sealTip.setAttribute('aria-hidden', 'true');
    const sealTipWords = sealTip.lastChild;
    const sealCue = stage.cue({ verb: 'Click', text: 'the wax seal to seal your URL', done: { text: 'Sealed', more: '· your whole URL is one opaque token now' }, tie: true, knot: 46, yarn: 24 });
    let overSeal = false, sealSeen = !!stage.choices.seal, sealWords = '';
    sealRing.el.addEventListener('click', () => stage.choose('seal', stage.choices.seal ? 0 : 1));
    sealRing.el.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') overSeal = true; });
    sealRing.el.addEventListener('pointerleave', () => { overSeal = false; });
    sealRing.el.addEventListener('focus', () => { overSeal = true; });
    sealRing.el.addEventListener('blur', () => { overSeal = false; });
    // the stamp presses its wax when the URL is sealed; the wax goes when it is readable again
    const desk = { sealAt: -1e9, unsealAt: -1e9, k: stage.choices.seal ? 1 : 0 };

    // ---- the octopus's letter: its button (wide: hung under the letter; narrow: in the dock)
    const letter = { state: 'wait', pressAt: -1, sealedAt: -1e9 };
    const letterCue = stage.cue({ verb: 'Click', text: 'the letter to seal it', button: true, under: true, cls: 'letter-cue', knot: 44, yarn: 26 });
    letterCue.el.style.setProperty('--yarn', '26px');
    const dockLetter = stage.dock.ask('letter', { verb: 'Tap', text: 'the letter to seal it', button: true });
    const sealLetter = () => {
      if (letter.state !== 'wait') return;
      // his pincer shuts on the letter a moment into the snap
      letter.state = 'pressing'; letter.pressAt = stage.t + 0.1;
      if (cast) cast.react('snap');
    };
    letterCue.el.addEventListener('click', sealLetter);
    dockLetter.el.addEventListener('click', sealLetter);

    // ---- the choices: Snap answers Choice 5 (a snap of his claw for sealed, a wave for
    // readable); the stamp; the chest's URL and the ship's log follow every choice
    const logEl = doc.getElementById('ship-log');
    let logHTML = '';
    const writeLog = () => {
      const c = stage.choices, rows = [['Ingredient', 'root:photos/print.jpg, its hash recorded'], ['Transformed', OPTIONS.crop[c.crop] + ' · ' + OPTIONS.look[c.look]]];
      if (c.finish) rows.push(['AI edit', OPTIONS.finish[c.finish] + ', marked as made with a trained model']);
      rows.push(c.format === 2 ? ['Unsigned', 'JPEG XL outputs are served unsigned in this version'] : ['Signed', 'as served, with your certificate']);
      const html = rows.map(([w, x], i) => '<li style="--i:' + i + '"><span class="when">' + w + '</span><span class="what">' + esc(x) + '</span></li>').join('');
      if (html !== logHTML) { logHTML = html; logEl.innerHTML = html; }
    };
    writeLog();
    stage.onChoice((key, i) => {
      if (key === 'seal') {
        if (i) { desk.sealAt = stage.t; sealSeen = true; } else desk.unsealAt = stage.t;
        if (cast && stage.p > 4.3 && stage.p < 5) cast.react(i ? 'snap' : 'wave');
      }
      refresh();
      chestText(true);
      writeLog();
      if (key === 'seal' && i) pollUntil = stage.t + 4;
    });

    // ---- the cards' specimens come alive as each comes into view
    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.35 });
      for (const id of ['card-provenance', 'card-private']) { const c = doc.getElementById(id); if (c) io.observe(c); }
    } else for (const id of ['card-provenance', 'card-private']) { const c = doc.getElementById(id); if (c) c.classList.add('in'); }

    // ---- what is in front of what on the screen
    // Snap, nearer than the desk and the chest: his body and his raised claw (px, once a frame)
    const snapOn = { x: 0, y: 0, r: 0, cx: 0, cy: 0, cr: 0, d: 1e9 };
    const behindSnap = (x, y, d) => d > snapOn.d && (Math.hypot(x - snapOn.x, y - snapOn.y) < snapOn.r || Math.hypot(x - snapOn.cx, y - snapOn.cy) < snapOn.cr);
    // the words, the bar, the gauge or a note over a point (checked every few frames)
    const covered = (x, y) => { const e = doc.elementFromPoint(x, y); return !!(e && e.closest('.beat, .bar, .gauge, .note, .dock')); };
    const cover = { chest: false, seal: false, letter: false };

    // ---- the lantern: a damped pendulum about its hook
    const lamp = { a: 0, v: 0, lastP: -1, rest: true };
    const restGlow = () => { G.glowPos.array[0].set(cab ? cab.at.lantern.x : 0, cab ? cab.at.lantern.y : -1000, cab ? cab.at.lantern.z : 0, 6.5); G.glowCol.array[0].set(1.6, 0.8, 0.3, 0); };
    let wasBoarding = false, boardedAt = -1, lastP = stage.p, verbWide = null, frameNo = 0;

    const css = (e, x, y, w, h) => { e.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)'; e.style.width = Math.round(w) + 'px'; e.style.height = Math.round(h) + 'px'; };
    let lastHit = '', lastChestTip = '', lastSealTip = '';

    let wasHere = true;
    this.tick = () => {
      const p = stage.p, t = stage.t, dt = Math.min(stage.dt || 0, 0.05), W = stage.W, Hh = stage.H, wide = stage.wide;
      frameNo++;
      if (wide !== verbWide) { verbWide = wide; verbEl.textContent = wide ? 'Click' : 'Tap'; }
      if (p < RESET && letter.state !== 'wait') { letter.state = 'wait'; letter.sealedAt = -1e9; }
      // (away from the wreck: nothing of it on the screen, the lantern's light at rest)
      if (p < 4.15 || p > 5.05) {
        if (wasHere) {
          wasHere = false;
          chestRing.show(false); hit.classList.remove('on'); chestTip.classList.remove('on'); sealRing.show(false); sealTip.classList.remove('on'); sealCue.show(false); letterCue.show(false);
          if (stage.dock.current === 'letter') stage.dock.show(null);
          lamp.rest = true; lamp.a = lamp.v = 0; lamp.lastP = -1;
          if (cab && cab.own) cab.setLantern(0, AX.set(0, 0, 1), 1);
          restGlow();
        }
        if (p < BOARDS) wasBoarding = false;
        lastP = p;
        return;
      }
      wasHere = true;
      const live = stage.live(), hand = stage.hand(H);
      // how much the camera is looking into the cabin
      const inCabin = smooth(4.47, 4.52, p) * (1 - smooth(4.66, 4.71, p));

      // ---- the chest's lid
      if (!ch.drag && ch.open !== ch.target) {
        const d = ch.target - ch.open;
        ch.open = Math.abs(d) < 0.004 ? ch.target : ch.open + Math.sign(d) * Math.min(Math.abs(d), (dt || 0.016) * 1.6);
        chestText(ch.open === ch.target);
      } else if (ch.drag) chestText(false);
      chestState();
      const thunk = t - ch.thunkAt < 0.3 ? Math.sin(((t - ch.thunkAt) / 0.3) * Math.PI) : 0;
      if (cab) cab.setLid(ch.open, thunk);

      // where Snap is on the screen
      snapOn.d = 1e9;
      if (cast && cast.snap && cast.snap.ready && cast.snap.group.visible) {
        stage.project(cast.snapAt(SN), P);
        stage.project(cast.gripAt(GR), Q);
        if (P[2] > 0.1) {
          snapOn.x = P[0]; snapOn.y = P[1]; snapOn.d = P[2]; snapOn.r = 0.33 * stage.pxPerMetre(P[2]);
          snapOn.cx = Q[0]; snapOn.cy = Q[1]; snapOn.cr = 0.13 * stage.pxPerMetre(Math.max(Q[2], 0.1));
        }
      }
      const check = frameNo % 4 === 0;

      // ---- the chest in the cabin: its ring, the place that takes the pointer, its tip
      let chestOn = false;
      if (cab && cab.own && inCabin > 0.5) {
        stage.project(cab.at.lock, P);
        const rx = P[0], ry = P[1] - 0.2 * stage.pxPerMetre(Math.max(P[2], 0.1)), d = P[2];
        if (d > 0.3 && stage.onScreen(rx, ry, -24)) {
          if (check) cover.chest = covered(rx, ry);
          chestOn = !cover.chest && !behindSnap(rx, ry, d);
          if (chestOn) {
            chestRing.at(rx, ry);
            // (the box on the screen, shut and with the lid up)
            let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
            const box = cab.at.box, n = ch.open > 0.3 ? box.length : 8;
            for (let i = 0; i < n; i++) { stage.project(box[i], Q); x0 = Math.min(x0, Q[0]); y0 = Math.min(y0, Q[1]); x1 = Math.max(x1, Q[0]); y1 = Math.max(y1, Q[1]); }
            const key = Math.round(x0) + ',' + Math.round(y0) + ',' + Math.round(x1 - x0) + ',' + Math.round(y1 - y0);
            if (key !== lastHit) { lastHit = key; css(hit, x0, y0, x1 - x0, y1 - y0); }
            // the tip: while the hand is on it, and for a moment after it moved
            const showTip = wide && (overChest || t - ch.poked < 2.5);
            if (showTip) {
              if (!tipW) { tipW = chestTip.offsetWidth || 220; tipH = chestTip.offsetHeight || 60; lastChestTip = ''; }
              const tx = Math.min(Math.max(12, x0 + (x1 - x0) / 2 - tipW / 2), W - 64 - tipW), ty = Math.max(74, y0 - tipH - 10);
              const k2 = Math.round(tx) + ',' + Math.round(ty);
              if (k2 !== lastChestTip) { lastChestTip = k2; chestTip.style.transform = 'translate(' + Math.round(tx) + 'px,' + Math.round(ty) + 'px)'; }
            }
            chestTip.classList.toggle('on', showTip);
          }
        }
      }
      chestRing.show(chestOn).done(ch.open <= 0.001);
      hit.classList.toggle('on', chestOn);
      if (!chestOn) { chestTip.classList.remove('on'); if (!ch.drag) overChest = false; }
      if (ringTab.chest !== +chestOn) { ringTab.chest = +chestOn; chestRing.el.tabIndex = chestOn ? 0 : -1; }

      // ---- the octopus's letter
      if (letter.state === 'wait' && p >= AUTO && p < 4.72) sealLetter();
      if (letter.state === 'pressing' && t >= letter.pressAt) {
        letter.state = 'sealed'; letter.sealedAt = t;
        if (cab) stage.sparkle(cab.at.letter, 6);
        if (world.fauna && typeof world.fauna.octopusWiggle === 'function') world.fauna.octopusWiggle();
        stage.note(LETTER_NOTE, 6);
        say('choice');
      }
      const sa = t - letter.sealedAt, press = clamp(sa / 0.18, 0, 1);
      const letterK = letter.state === 'sealed' ? (1 + (1 - press) * 0.9) * (1 + 0.12 * Math.sin(clamp(sa / 0.5, 0, 1) * Math.PI) * press) : 0;
      const waiting = letter.state === 'wait' && p >= CABIN[0] && p < SEATED;
      let letterOn = false;
      if (cab && waiting && inCabin > 0.6) {
        stage.project(cab.at.letter, P);
        if (P[2] > 0.3 && stage.onScreen(P[0], P[1], -30)) {
          if (check) cover.letter = covered(P[0], P[1]);
          letterOn = !cover.letter && !behindSnap(P[0], P[1], P[2]);
          if (letterOn && wide) letterCue.at(P[0], P[1] + 6);
        }
      }
      letterCue.show(letterOn && wide);
      if (!wide) {
        if (waiting && inCabin > 0.6) stage.dock.show('letter');
        else if (stage.dock.current === 'letter') stage.dock.show(null);
      } else if (stage.dock.current === 'letter') stage.dock.show(null);
      // (the octopus is busy with its letter until it has wiggled with joy)
      const busy = (waiting && inCabin > 0.6) || letter.state === 'pressing' || (letter.state === 'sealed' && sa < HAPPY);

      // ---- the wax seal on the desk, and its stamp
      const ds = t - desk.sealAt, du = t - desk.unsealAt;
      let pressK = 0, lift = 0;
      if (stage.choices.seal && ds < 1.0) {
        // up and over to the wax, down onto it, up, and back
        pressK = smooth(0, 0.3, ds) * (1 - smooth(0.7, 1.0, ds));
        lift = 0.075 * smooth(0, 0.14, ds) * (1 - smooth(0.3, 0.42, ds)) + 0.075 * smooth(0.55, 0.68, ds) * (1 - smooth(0.85, 1.0, ds)) + 0.012 * smooth(0.3, 0.42, ds) * (1 - smooth(0.55, 0.68, ds));
        const pk = clamp((ds - 0.4) / 0.18, 0, 1);
        desk.k = ds < 0.4 ? 0 : (1 + (1 - pk) * 0.9) * (1 + 0.1 * Math.sin(clamp((ds - 0.4) / 0.5, 0, 1) * Math.PI) * pk);
      } else if (stage.choices.seal) desk.k = 1;
      else { desk.k = du < 0.25 ? Math.min(desk.k, 1 - smooth(0, 0.25, du)) : 0; lift = du < 0.3 ? 0.03 * Math.sin((du / 0.3) * Math.PI) : 0; }
      if (cab) { cab.setStamp(pressK, lift); cab.setWax(letterK, desk.k); }
      let sealOn = false;
      if (cab && wide && inCabin > 0.6 && !busy) {
        stage.project(cab.at.stamp, P);
        if (P[2] > 0.3 && stage.onScreen(P[0], P[1], -30)) {
          if (check) cover.seal = covered(P[0], P[1]);
          sealOn = !cover.seal && !behindSnap(P[0], P[1], P[2]);
          if (sealOn) {
            sealRing.at(P[0], P[1]);
            sealCue.at(P[0], P[1] - 25);
            const flip = P[0] + 30 + 264 > W - 8;
            const k2 = Math.round(P[0]) + ',' + Math.round(P[1]) + (flip ? 'f' : '');
            if (k2 !== lastSealTip) { lastSealTip = k2; if (!sealW) sealW = sealTip.offsetWidth || 220; sealTip.style.transform = 'translate(' + Math.round(flip ? P[0] - 30 - sealW : P[0] + 30) + 'px,' + Math.round(P[1] - 24) + 'px)'; }
          }
        }
      }
      const sealed = !!stage.choices.seal;
      if (sealed) sealSeen = true;
      const words = sealed ? 'Sealed. Click again to make it readable' : 'Click it to seal your URL';
      if (words !== sealWords) { sealWords = words; sealW = 0; lastSealTip = ''; sealTipWords.textContent = words; sealRing.el.setAttribute('aria-label', sealed ? 'Wax seal: make your URL readable again' : 'Wax seal: seal your URL'); }
      sealRing.show(sealOn).done(sealed);
      if (ringTab.seal !== +sealOn) { ringTab.seal = +sealOn; sealRing.el.tabIndex = sealOn ? 0 : -1; }
      sealTip.classList.toggle('on', sealOn && overSeal);
      sealCue.show(sealOn).done(sealSeen).gone(sealSeen);
      if (!sealOn) overSeal = false;

      // ---- the lantern: it leans toward the hand (across the view, from its hook), sways a
      // little on its own and swings with the scroll; its light flickers
      const near = p > 4.2 && p < 4.95;
      if (near) {
        lamp.rest = false;
        let target = 0.035 * Math.sin(t * 2.1) * Math.sin(t * 0.37 + 1);
        // (the scroll's speed as the painted dive read it: pixels a frame)
        if (dt > 0 && lamp.lastP >= 0) target += clamp((((p - lamp.lastP) / dt) * 8.4 * Hh) / 60 * 0.004, -0.05, 0.05);
        if (cab && live) { stage.project(cab.at.hook, P); if (P[2] > 0.1) target += clamp((hand[0] - P[0]) / (W * 0.2), -1, 1) * 0.1; }
        if (dt > 0) {
          lamp.v += (-(lamp.a - target) * 14 - lamp.v * 1.4) * dt;
          lamp.a = clamp(lamp.a + lamp.v * dt, -0.14, 0.14);
        }
        const flicker = 0.82 + 0.1 * Math.sin(t * 7.3) * Math.sin(t * 3.1 + 1) + 0.08 * Math.sin(t * 17.9);
        const e = stage.camera.matrixWorld.elements;
        AX.set(e[8], 0, e[10]);
        if (AX.lengthSq() < 1e-6) AX.set(0, 0, 1);
        AX.normalize();
        const fl = flicker / 0.9;
        if (cab && cab.own) {
          const at = cab.setLantern(lamp.a * inCabin, AX, fl);
          G.glowPos.array[0].set(at.x, at.y, at.z, 6.5);
        }
        G.glowCol.array[0].set(1.6 * fl, 0.8 * fl, 0.3 * fl, 0);
      } else if (!lamp.rest) { lamp.rest = true; lamp.a = lamp.v = 0; if (cab && cab.own) cab.setLantern(0, AX.set(0, 0, 1), 1); restGlow(); }
      lamp.lastP = p;

      // ---- the dust in the cabin's air
      if (cab && cab.dustStep) {
        const vis = smooth(4.44, 4.52, p) * (1 - smooth(4.66, 4.74, p));
        cab.dustStep(dt, t, vis, hand[0], hand[1], live && vis > 0.01, W, Hh);
      }

      // ---- Snap's story, once he has climbed into the submarine (not on a jump past it)
      if (p < BOARDS) wasBoarding = false;
      if (lastP >= BOARDS && lastP < BOARDED && p >= BOARDED && p < 5.3 && !wasBoarding && Math.abs(p - lastP) < 0.25) { wasBoarding = true; boardedAt = t; stage.note(BOARD_NOTE, 7); }
      lastP = p;

      // ---- the page's token, once it has one for this recipe (sealed by Choice 5): the chest shows
      // the same one as the bar (looked for a few seconds after a choice)
      if (check && stage.choices.seal && t < pollUntil) {
        const pt = pageToken();
        if (pt && pt !== token && tokenFor === rem) { token = pt; minting++; pollUntil = -1; chestText(ch.open === ch.target); }
      }
    };
    restGlow();
  },
  frame() { if (this.tick) this.tick(); },
};
