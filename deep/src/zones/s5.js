// The twilight (zone s5), as in the painted dive (experience/src/twilight-ui.ts, world/twilight.ts).
// Down here the light is the visitor's: the submarine's lamp is aimed where the cursor is (where
// a tap was, for 1.4 s, on a touch screen; else it sweeps slowly over the middle of the view), and
// it names what it finds: a glowing tag pinned by each creature ("jellyfish 0.97" ...), lit while
// the light is on it and for 1.6 s after; the Metadata card's JSON fills with the tags found so far
// and a line of alt text built from them (on a wide screen that line floats over the scene too);
// the Explain card reports on the visitor's own URL (or the 403 a sealed one gets); and a tiny
// lost fish, dim until the light finds it, follows the light, and at 72 % of the zone goes home
// with Snap. The dock asks for the light until it has found something (15 s at most).
// Its words are in zones/s5.html, its styles in zones/s5.css; the fish is props/twilight.js.
import { Vector3 } from 'three/webgpu';
import { OPTIONS, remainder, sign } from '../content.js';
import { pathAt } from '../layout.js';
import { smooth } from '../math.js';
import { buildBeam, buildLostFish } from '../props/twilight.js';
import { G } from '../shaders.js';

// the tags, in the painted dive's order: which label, its score (labels: 0 jellyfish, 1 glowing
// worm, 2 message in a bottle, 3 anglerfish); a label's score in the JSON is its best tag's
const TAGS = [[0, 0.97], [0, 0.95], [1, 0.84], [2, 0.96], [3, 0.93], [0, 0.96]];
const LABEL = ['jellyfish', 'glowing worm', 'message in a bottle', 'anglerfish'];
const SCORE = [0.97, 0.84, 0.96, 0.93];
// a label as alt text writes it
const NOUN = ['glowing jellyfish', 'a glowing worm', 'a message in a bottle', 'an anglerfish'];
// the visitor's URL in the words of a meta answer and an explain report
const SIZE = [[1200, 630], [760, 760], [945, 630]];
// (with no format named, a meta request, which asks for JSON, and the explain forecast keep the
// source's: print.jpg is a JPEG; a browser's own request would get AVIF)
const FMT = ['JPEG', 'AVIF', 'JPEG XL', 'WebP'], FMT_JSON = ['jpeg', 'avif', 'jxl', 'webp'];
const CROP_GLOSS = ['a 1200 × 630 window, moved to the subject', 'a 760 × 760 window, moved to the subject', 'fit inside 1200 × 630, nothing cut'];
const LOOK_GLOSS = ['sharpen 1.2, then saturation 1.1', 'duotone, from deep blue to sand', 'sepia'];
const FINISH_GLOSS = ['', 'the product cut out onto a brand backdrop with a soft shadow, padded', 'the background removed'];
// (as it happened: found by the visitor's light, or not)
const FISH_FOUND = 'A tiny fish was lost in the dark. It followed your light all the way to Snap, and now it swims home with him, by his lamp.';
const FISH_MISSED = 'A tiny fish was lost in the dark, below the light. Snap spots it anyway, and now it swims home with him, by his lamp.';

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// code as HTML that breaks only after a slash, a colon or a comma
const soft = (t) => esc(t).replace(/([/:,])(?=[^/\s])/g, '$1<wbr>');
// text as lines that keep their indent when they wrap (a narrow card): each line a block, its
// continuation hanging two characters further in
const lines = (text) => text.split('\n').map((l) => { const n = l.length - l.trimStart().length; return '<span class="ln" style="--in: ' + n + '">' + esc(l.trimStart()) + '</span>'; }).join('');

// The Metadata card: the visitor's picture as a meta answer describes it, with the tags found
// so far (labels, in the order found) and a line of alt text built from them. Also the page's
// (page.js), where every creature counts as found. Returns { html, alt }.
export function metaHTML(c, found) {
  const [w, h] = SIZE[c.crop];
  let alt = null;
  if (found.length) {
    const parts = found.map((l) => NOUN[l]);
    const list = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
    alt = list[0].toUpperCase() + list.slice(1) + ' in the dark of the deep sea.';
  }
  const tags = found.slice().sort((a, b) => SCORE[b] - SCORE[a]).map((l) => '    { "label": "' + LABEL[l] + '", "score": ' + SCORE[l].toFixed(2) + ' }');
  const text = '{\n  "width": ' + w + ', "height": ' + h + ', "format": "' + FMT_JSON[c.format] + '",\n  "tags": [' + (tags.length ? '\n' + tags.join(',\n') + '\n  ' : '') + '],\n  "alt_text": ' + (alt ? '"' + alt + '"' : 'null') + '\n}';
  return { html: lines(text), alt, text };
}
export const ALL_FOUND = [0, 2, 3, 1];
// The Explain card: the request and the report on the visitor's URL (or the 403 a sealed one
// gets; token: its own, shortened). Returns { req, report } as HTML.
export function explainHTML(c, token) {
  const rows = [];
  let req;
  if (c.seal === 1) {
    req = 'GET /explain/' + token + '/print.jpg';
    rows.push(['403', 'explain refuses sealed URLs rather than decrypt them.'], ['to debug', 'unseal it locally, then explain the plain form.']);
  } else {
    const rem = remainder(c), [w, h] = SIZE[c.crop];
    req = 'GET /explain/' + sign(rem).slice(0, 8) + '…/' + rem;
    rows.push(
      ['signature', 'valid · current key · never expires'],
      ['source', 'root:photos/print.jpg · image · 2400 × 1600'],
      [c.crop === 2 ? 'fit-in' : 'crop', CROP_GLOSS[c.crop]],
      ['filters', [LOOK_GLOSS[c.look], FINISH_GLOSS[c.finish]].filter(Boolean).join(', then ')],
      ['format', OPTIONS.format[c.format] ? FMT[c.format] : 'none named: kept from the source, JPEG'],
      ['forecast', w + ' × ' + h + ' · ' + FMT[c.format]],
    );
  }
  return { req: soft(req), report: rows.map(([k, d], i) => '<dt style="--i: ' + i + '">' + esc(k) + '</dt><dd style="--i: ' + i + '">' + esc(d) + '</dd>').join(''), key: req + rows.join('|') };
}

// The camera on its path at p (without the visitor's nudge): where it is, and its forward, right
// and up. out: { x, y, z, F, R, U }.
const O5 = [0, 0, 0, 0, 0];
function pathCam(p, c) {
  pathAt(p, O5);
  const y = (O5[3] * Math.PI) / 180, x = (O5[4] * Math.PI) / 180, cy = Math.cos(y), sy = Math.sin(y), cx = Math.cos(x), sx = Math.sin(x);
  c.x = O5[0]; c.y = O5[1]; c.z = O5[2];
  c.F[0] = sy * cx; c.F[1] = sx; c.F[2] = -cy * cx;
  c.R[0] = cy; c.R[1] = 0; c.R[2] = sy;
  c.U[0] = -sx * sy; c.U[1] = cx; c.U[2] = sx * cy;
  return c;
}

const S = { fish: null, beam: null };
const ZF = new Vector3(0, 0, 1);

export default {
  id: 's5',
  build(ctx) {
    S.fish = buildLostFish();
    S.beam = buildBeam();
    ctx.scene.add(S.fish.mesh, S.beam.mesh);
  },

  mount(stage, world) {
    const doc = document, cast = world.cast, camera = stage.camera;
    const P = [0, 0, 0], H = [0, 0], L = [-1, -1], v = new Vector3(), ray = new Vector3(), aim = new Vector3();
    const noteEl = doc.getElementById('note');
    const narrowMQ = matchMedia('(max-width: 760px)'), touchMQ = matchMedia('(hover: none)');

    // ---- over the scene: the tags, the alt text ---------------------------------------------------
    const tagsEl = stage.el('ul', 'tw-tags');
    tagsEl.setAttribute('aria-hidden', 'true');
    const tags = TAGS.map(([l, s]) => ({ el: stage.el('li', '', tagsEl, '<b>' + LABEL[l] + '</b> ' + s.toFixed(2)), x: -1e4, y: -1e4, lit: false, at: -10 }));
    const altEl = stage.el('p', 'tw-alt', stage.layer, '<span>alt_text</span> <q></q>');
    altEl.setAttribute('aria-hidden', 'true');
    const altQ = altEl.querySelector('q');
    let tagsOn = false, altOn = false;

    // ---- the cards: the meta answer, the explain report ------------------------------------------
    const jsonEl = doc.getElementById('tw-json'), reqEl = doc.getElementById('tw-req'), reportEl = doc.getElementById('tw-report');
    const found = [];                  // the labels found so far, in the order found (for the alt text)
    let lastJson = '';
    const renderJson = (pop) => {
      const m = metaHTML(stage.choices, found);
      if (m.text === lastJson) return;
      lastJson = m.text;
      jsonEl.innerHTML = m.html;
      altQ.textContent = m.alt || '';
      if (pop) { jsonEl.classList.remove('pop'); void jsonEl.offsetWidth; jsonEl.classList.add('pop'); }
    };
    // (a sealed URL's token is the bar's own: the page mints it once per recipe)
    const tokenText = () => {
      const t = doc.querySelector('#url .p-seal');
      const s = t ? t.textContent : '';
      return s.startsWith('s1.') && s.length > 5 ? s : 's1.…';   // (the bar's own, shortened as it shortens it)
    };
    let lastReport = '';
    const renderReport = () => {
      const r = explainHTML(stage.choices, tokenText());
      if (r.key === lastReport) return;
      lastReport = r.key;
      reqEl.innerHTML = r.req;
      reportEl.innerHTML = r.report;
    };
    stage.onChoice(() => { renderJson(false); renderReport(); });
    renderJson(false); renderReport();
    // (the token arrives a moment after the choice: the bar is painted again then)
    const urlEl = doc.getElementById('url');
    if (urlEl && typeof MutationObserver !== 'undefined') new MutationObserver(() => { if (stage.choices.seal === 1) renderReport(); }).observe(urlEl, { childList: true, subtree: true, characterData: true });
    // each card draws its specimen in once it has come into view
    const cards = doc.querySelectorAll('#s5 .tw-card');
    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) e.target.classList.add('in'); }), { threshold: 0.35 });
      cards.forEach((c) => io.observe(c));
    } else cards.forEach((c) => c.classList.add('in'));

    // the dock's asks: the cursor's, and the tap's
    stage.dock.ask('light', { verb: 'Move', text: 'your light over the creatures' });
    stage.dock.ask('light-tap', { verb: 'Tap', text: 'a creature to light it' });
    let shone = false, askedAt = -1;

    // ---- the lost fish ------------------------------------------------------------------------
    const F = S.fish, fish = { state: 'lost', pos: new Vector3(), face: new Vector3(0, 0, -1), placed: false, lit: 0 };
    const cam = { x: 0, y: 0, z: 0, F: [0, 0, 0], R: [0, 0, 0], U: [0, 0, 0] }, want = new Vector3(), look = new Vector3(), last = new Vector3();
    let focus = 7.5, owned = 0, reachM = 6;
    // where it waits, lost: low in the open water, under the submarine's way (on a phone, right of
    // the submarine and above the words), circling a little; cam is the camera on its path
    const lostAt = (out, t, narrow) => {
      const lf = narrow ? 3.9 : 4.3, lx = (narrow ? 0.8 : 0.1) + Math.cos(t * 1.3) * 0.16, ly = (narrow ? -0.24 : -1.12) + Math.sin(t * 2.1) * 0.07;
      return out.set(cam.x + cam.F[0] * lf + cam.R[0] * lx + cam.U[0] * ly, cam.y + cam.F[1] * lf + cam.U[1] * ly, cam.z + cam.F[2] * lf + cam.R[2] * lx + cam.U[2] * ly);
    };

    this.tick = () => {
      const p = stage.p, t = stage.t, dt = stage.dt, W = stage.W, Hh = stage.H;
      // how much the zone is on, and how bright the lamp is (cast.js lights it as the water darkens)
      const zone = smooth(4.98, 5.06, p) * (1 - smooth(5.94, 6.02, p));
      const lamp = Math.min(1, G.lampCol.value.x / 2.6);
      const on = zone * smooth(0.2, 0.45, lamp);
      const narrow = narrowMQ.matches, tapMode = narrow || touchMQ.matches;
      const live = stage.live();
      // (where the creatures are, kept by fauna.js every frame: { name, score, at, r, on })
      const spots = world.fauna && world.fauna.spots && world.fauna.spots.twilight;

      // ---- the light: where the visitor's hand is, else a slow sweep over the middle of the view
      if (zone > 0.001) {
        if (live) stage.hand(H);
        else {
          H[0] = W * (0.55 + 0.3 * Math.sin(t * 0.21));
          H[1] = Hh * (narrow ? 0.34 + 0.14 * Math.sin(t * 0.33 + 1.3) : 0.48 + 0.2 * Math.sin(t * 0.33 + 1.3));
        }
        const k = dt > 0 ? 1 - Math.exp(-dt * (live ? 9 : 2.5)) : 1;
        if (L[0] < -0.5) { L[0] = H[0]; L[1] = H[1]; } else { L[0] += (H[0] - L[0]) * k; L[1] += (H[1] - L[1]) * k; }
      } else L[0] = L[1] = -1;
      const lr = Hh * (narrow ? 0.22 : 0.3), reach = 0.8 * lr;

      // ---- the tags: each by its creature, lit while the light is on it and a while after
      let nearD = 1e9, aimD = 7.5, added = false;
      for (let i = 0; i < 6; i++) {
        const s = spots && spots[i], g = tags[i];
        let shown = false;
        if (s && s.on !== false && zone > 0.001) {
          stage.project(s.at, P);
          if (P[2] > 0.6 && P[2] < 34 && stage.onScreen(P[0], P[1], -12)) {
            shown = true;
            const R = Math.min(80, (s.r || 0.5) * stage.pxPerMetre(P[2]));
            const x = Math.round(P[0] + R * 0.45), y = Math.round(P[1] - R * 0.5);
            if (x !== g.x || y !== g.y) { g.x = x; g.y = y; g.el.style.transform = 'translate(' + x + 'px,' + y + 'px)'; }
            const d = Math.hypot(P[0] - L[0], P[1] - L[1]);
            if (d < Hh * 0.45 && d < nearD) { nearD = d; aimD = P[2]; }
            if (on > 0.6 && d < reach) {
              g.at = t;
              if (live) shone = true;
              const l = TAGS[i][0];
              if (found.indexOf(l) < 0) { found.push(l); added = true; }
            }
          }
        }
        const lit = shown && t - g.at < 1.6;
        if (lit !== g.lit) { g.lit = lit; g.el.classList.toggle('lit', lit); }
      }
      if (added) renderJson(true);
      const tagsNow = on > 0.6;
      if (tagsNow !== tagsOn) { tagsOn = tagsNow; tagsEl.classList.toggle('on', tagsNow); }
      // (the alt text floats top right on a wide screen, and gives way to Snap's story there)
      const alt = tagsNow && stage.wide && found.length > 0 && !noteEl.classList.contains('on');
      if (alt !== altOn) { altOn = alt; altEl.classList.toggle('on', alt); }

      // ---- the dock: ask for the light until it has found something itself (15 s at most)
      const asking = on > 0.6 && !shone;
      if (asking && askedAt < 0) askedAt = t;
      const ask = asking && t - askedAt < 15 ? (tapMode ? 'light-tap' : 'light') : null;
      if (ask) stage.dock.show(ask);
      else if (stage.dock.current === 'light' || stage.dock.current === 'light-tap') stage.dock.show(null);

      // ---- the lamp: from the submarine to the point the light is on, as far off as what it is
      // nearest to (cast.js has set it from the pointer this frame; the zone takes it over, eased
      // in and out at its ends)
      const own2 = zone * (L[0] >= 0 ? 1 : 0);
      owned += (own2 - owned) * (dt > 0 ? Math.min(1, dt * 4) : 1);
      if (owned > 0.001) {
        const kf = dt > 0 ? 1 - Math.exp(-dt * 3) : 1;
        focus += (Math.min(Math.max(aimD, 3.5), 16) - focus) * kf;
        ray.set((L[0] / W) * 2 - 1, 1 - (L[1] / Hh) * 2, 0.5).unproject(camera).sub(camera.position).normalize();
        // (never back at the eye: on a thing nearer than the lamp, the beam still goes out past
        // it, into the sea, or the water between would glare white with it)
        const past = v.copy(G.lampPos.value).sub(camera.position).dot(ray) + 2.5;
        aim.copy(camera.position).addScaledVector(ray, Math.max(focus, past)).sub(G.lampPos.value);
        reachM = aim.length();
        G.lampDir.value.lerp(aim.normalize(), owned).normalize();
      }
      // the light as it is seen in the water: a soft beam from the lamp toward what it is on
      const B = S.beam;
      if (B) {
        B.mesh.visible = owned > 0.01 && lamp > 0.05;
        if (B.mesh.visible) {
          const len = Math.min(Math.max(reachM + 1.5, 3.5), 13);
          B.mesh.position.copy(G.lampPos.value);
          B.mesh.quaternion.setFromUnitVectors(ZF, G.lampDir.value);
          B.mesh.scale.set(len * 0.3, len * 0.3, len);
          B.on.value = owned * Math.min(1, lamp * 1.4);
        }
      }

      // ---- the lost fish: lost below the light's way, found by it, then with it, then home
      if (p < 4.6) { fish.state = 'lost'; fish.placed = false; }
      // (at 72 % of the zone it goes home with Snap, found or not; the story while the zone is up)
      if (fish.placed && fish.state !== 'home' && p > 5.72) {
        const found = fish.state === 'follow';
        fish.state = 'home';
        if (zone > 0.2) stage.note(found ? FISH_FOUND : FISH_MISSED, 6);
      }
      const show = p > 4.99 && p < 7.02 && (zone > 0.01 || fish.state === 'home') && !!F;
      if (F) F.mesh.visible = show;
      if (!show) return;
      pathCam(Math.min(Math.max(p, 5.0), 5.76), cam);
      if (!fish.placed) { lostAt(fish.pos, t, narrow); fish.placed = true; }
      stage.project(fish.pos, P);
      const dl = P[2] > 0 ? Math.hypot(P[0] - L[0], P[1] - L[1]) : 1e9;
      if (fish.state === 'lost' && p > 5.05 && on > 0.6 && dl < reach) {
        fish.state = 'follow';
        stage.sparkle(fish.pos, 6);
      }
      if (fish.state === 'lost') lostAt(want, t, narrow);
      else if (fish.state === 'follow') {
        // in the beam, a little way out from the lamp toward where the light is, wiggling round it
        const s = Math.min(Math.max(focus * 0.45, 1.6), 3.4);
        want.copy(G.lampPos.value).addScaledVector(G.lampDir.value, s);
        const e = camera.matrixWorld.elements;
        want.x += e[0] * Math.cos(t * 1.7) * 0.3 + e[4] * Math.sin(t * 2.3) * 0.18;
        want.y += e[1] * Math.cos(t * 1.7) * 0.3 + e[5] * Math.sin(t * 2.3) * 0.18;
        want.z += e[2] * Math.cos(t * 1.7) * 0.3 + e[6] * Math.sin(t * 2.3) * 0.18;
      } else if (cast && cast.sub) {
        // home: small loops by the submarine's lamp, keeping it company
        want.set(0.34 + Math.cos(t * 1.1) * 0.22, 0.86 + Math.sin(t * 1.6) * 0.1, -0.7 + Math.sin(t * 1.1) * 0.12).applyMatrix4(cast.sub.group.matrixWorld);
      }
      last.copy(fish.pos);
      if (dt > 0) fish.pos.lerp(want, 1 - Math.exp(-dt * (fish.state === 'lost' ? 3 : 2.2)));
      else fish.pos.copy(want);
      // it faces the way it swims (or across the view while it waits)
      const speed = dt > 0 ? last.distanceTo(fish.pos) / dt : 0;
      if (speed > 0.05) { look.copy(fish.pos).sub(last).normalize(); fish.face.lerp(look, dt > 0 ? Math.min(1, dt * 5) : 1).normalize(); }
      else if (dt <= 0) fish.face.set(-cam.R[0] + cam.F[0] * -0.4, 0, -cam.R[2] + cam.F[2] * -0.4).normalize();
      F.mesh.position.copy(fish.pos);
      v.copy(fish.pos).add(fish.face);
      F.mesh.lookAt(v);
      F.mesh.rotateZ(Math.sin(t * 2.2) * 0.08);
      // dim until the light is on it; once found, its own colours
      const litTo = fish.state === 'lost' ? Math.max(0, 1 - dl / lr) * (on > 0.6 ? 1 : 0) : 1;
      fish.lit += (litTo - fish.lit) * (dt > 0 ? Math.min(1, dt * 4) : 1);
      F.lit.value = fish.lit;
      F.swim.value = Math.min(1, 0.25 + speed * 0.6);
    };
  },
  frame() { if (this.tick) this.tick(); },
};
