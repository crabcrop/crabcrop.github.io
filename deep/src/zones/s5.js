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
import * as faunaModule from '../fauna.js';
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
const FMT = ['AVIF', 'AVIF', 'JPEG XL', 'WebP'], FMT_JSON = ['avif', 'avif', 'jxl', 'webp'];
const CROP_GLOSS = ['a 1200 × 630 window, moved to the subject', 'a 760 × 760 window, moved to the subject', 'fit inside 1200 × 630, nothing cut'];
const LOOK_GLOSS = ['sharpen 1.2, then saturation 1.1', 'duotone, from deep blue to sand', 'sepia'];
const FINISH_GLOSS = ['', 'the product cut out onto a brand backdrop with a soft shadow, padded', 'the background removed'];
const FISH_STORY = 'A tiny fish was lost in the dark. It followed your light all the way to Snap, and now he is taking it home.';

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// code as HTML that breaks only after a slash, a colon or a comma
const soft = (t) => esc(t).replace(/([/:,])(?=[^/\s])/g, '$1<wbr>');

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

// Where the six creatures are, until fauna.js says so itself (fauna.spots.twilight): the jellies
// from their own instance data (three of them: the ones largest in the view at the moments the
// visitor stops at), the siphonophore (the glowing worm), the bottle and the anglerfish from where
// fauna.js puts them each frame (faunaParts).
function stand(world, wideView, fov, aspect) {
  const parts = faunaModule.faunaParts || {};
  const list = TAGS.map(([l, s]) => ({ name: LABEL[l], score: s, at: new Vector3(0, -1000, 0), r: 0.6, on: false }));
  const homes = [], seenAttr = new Set();
  world.scene.traverse((o) => {
    const a = o.geometry && o.geometry.getAttribute && o.geometry.getAttribute('jA');
    if (!a || seenAttr.has(a)) return;
    seenAttr.add(a);
    for (let i = 0; i < a.count; i++) homes.push([a.getX(i), a.getY(i), a.getZ(i), a.getW(i)]);
  });
  const c = { x: 0, y: 0, z: 0, F: [0, 0, 0], R: [0, 0, 0], U: [0, 0, 0] }, tanV = Math.tan((fov * Math.PI) / 360);
  const best = homes.map(() => 0);
  for (let pb = 5.15; pb <= 5.9; pb += 0.025) {
    pathCam(pb, c);
    homes.forEach((h, i) => {
      const dx = h[0] - c.x, dy = h[1] - c.y, dz = h[2] - c.z;
      const f = dx * c.F[0] + dy * c.F[1] + dz * c.F[2];
      if (f < 3 || f > 18) return;
      const nx = (dx * c.R[0] + dz * c.R[2]) / (f * tanV * aspect), ny = (dx * c.U[0] + dy * c.U[1] + dz * c.U[2]) / (f * tanV);
      // (whole in the view, and clear of the words: right of them on a wide screen, above them on a phone)
      const ok = wideView ? nx > -0.24 && nx < 0.88 && ny > -0.78 && ny < 0.8 : nx > -0.82 && nx < 0.82 && ny > -0.05 && ny < 0.72;
      if (ok) best[i] = Math.max(best[i], h[3] / f);
    });
  }
  const order = homes.map((h, i) => i).filter((i) => best[i] > 0).sort((a, b) => best[b] - best[a]);
  if (DEV) console.log('s5: ' + homes.length + ' jellies; tagged ' + order.slice(0, 3).map((i) => '#' + i + ' ' + best[i].toFixed(3)).join(', '));
  const jellies = [0, 1, 5];
  jellies.forEach((k, n) => { const h = homes[order[n]]; if (h) { list[k].at.set(h[0], h[1], h[2]); list[k].r = h[3]; list[k].on = true; } });
  const POSE = parts.POSE && parts.POSE.array, SI = parts.SI;
  return {
    list,
    // (each frame: where fauna.js has put the others)
    update(p) {
      if (SI && SI.c) { list[2].at.copy(SI.c.value); list[2].r = 1.1; list[2].on = p > 5.1 && p < 5.9; }
      if (POSE && POSE[20]) { const b = POSE[20]; list[3].at.set(b.x, b.y, b.z); list[3].r = 0.3; list[3].on = p > 5.32 && p < 5.84; }
      if (POSE && POSE[16]) { const a = POSE[16]; list[4].at.set(a.x, a.y, a.z); list[4].r = Math.max(0.4, a.w * 0.36); list[4].on = p > 5.5 && p < 5.82; }
    },
  };
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
    const altText = () => {
      if (!found.length) return null;
      const parts = found.map((l) => NOUN[l]);
      const list = parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
      return list[0].toUpperCase() + list.slice(1) + ' in the dark of the deep sea.';
    };
    let lastJson = '';
    const renderJson = (pop) => {
      const c = stage.choices, [w, h] = SIZE[c.crop], alt = altText();
      const tags = found.slice().sort((a, b) => SCORE[b] - SCORE[a]).map((l) => '    { "label": "' + LABEL[l] + '", "score": ' + SCORE[l].toFixed(2) + ' }');
      const text = '{\n  "width": ' + w + ', "height": ' + h + ', "format": "' + FMT_JSON[c.format] + '",\n  "tags": [' + (tags.length ? '\n' + tags.join(',\n') + '\n  ' : '') + '],\n  "alt_text": ' + (alt ? '"' + alt + '"' : 'null') + '\n}';
      if (text === lastJson) return;
      lastJson = text;
      jsonEl.textContent = text;
      altQ.textContent = alt || '';
      if (pop) { jsonEl.classList.remove('pop'); void jsonEl.offsetWidth; jsonEl.classList.add('pop'); }
    };
    // (a sealed URL's token is the bar's own: the page mints it once per recipe)
    const tokenText = () => {
      const t = doc.querySelector('#url .p-seal');
      const s = t ? t.textContent : '';
      return s.startsWith('s1.') && s.length > 5 ? s.slice(0, 13) + '…' : 's1.…';
    };
    let lastReport = '';
    const renderReport = () => {
      const c = stage.choices, rows = [];
      let req;
      if (c.seal === 1) {
        req = 'GET /explain/' + tokenText() + '/print.jpg';
        rows.push(['403', 'explain refuses sealed URLs rather than decrypt them.'], ['to debug', 'unseal it locally, then explain the plain form.']);
      } else {
        const rem = remainder(c), [w, h] = SIZE[c.crop];
        req = 'GET /explain/' + sign(rem).slice(0, 8) + '…/' + rem;
        rows.push(
          ['signature', 'valid · key 1 · never expires'],
          ['source', 'root:photos/print.jpg · image · 2400 × 1600'],
          [c.crop === 2 ? 'fit-in' : 'crop', CROP_GLOSS[c.crop]],
          ['filters', [LOOK_GLOSS[c.look], FINISH_GLOSS[c.finish]].filter(Boolean).join(', then ')],
          ['format', OPTIONS.format[c.format] ? FMT[c.format] : 'none named: the Accept header picks AVIF'],
          ['forecast', w + ' × ' + h + ' · ' + FMT[c.format]],
        );
      }
      const key = req + rows.join('|');
      if (key === lastReport) return;
      lastReport = key;
      reqEl.innerHTML = soft(req);
      reportEl.innerHTML = rows.map(([k, d], i) => '<dt style="--i: ' + i + '">' + esc(k) + '</dt><dd style="--i: ' + i + '">' + esc(d) + '</dd>').join('');
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

    // where the creatures are: fauna.js's own spots when it has them, else found here
    const own = stand(world, stage.wide, camera.fov || 58, stage.W / Math.max(stage.H, 1));

    // ---- the lost fish ------------------------------------------------------------------------
    const F = S.fish, fish = { state: 'lost', pos: new Vector3(), face: new Vector3(0, 0, -1), placed: false, lit: 0, glowAt: -10 };
    const cam = { x: 0, y: 0, z: 0, F: [0, 0, 0], R: [0, 0, 0], U: [0, 0, 0] }, want = new Vector3(), look = new Vector3(), last = new Vector3();
    let focus = 7.5, owned = 0, reachM = 6;

    this.tick = () => {
      const p = stage.p, t = stage.t, dt = stage.dt, W = stage.W, Hh = stage.H;
      // how much the zone is on, and how bright the lamp is (cast.js lights it as the water darkens)
      const zone = smooth(4.98, 5.06, p) * (1 - smooth(5.94, 6.02, p));
      const lamp = Math.min(1, G.lampCol.value.x / 2.6);
      const on = zone * smooth(0.2, 0.45, lamp);
      const narrow = narrowMQ.matches, tapMode = narrow || touchMQ.matches;
      const live = stage.live();
      const spots = (world.fauna && world.fauna.spots && world.fauna.spots.twilight && world.fauna.spots.twilight.length === 6) ? world.fauna.spots.twilight : (own.update(p), own.list);

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
        const s = spots[i], g = tags[i];
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
        aim.copy(camera.position).addScaledVector(ray, focus).sub(G.lampPos.value);
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
        fish.state = 'home';
        if (zone > 0.2) stage.note(FISH_STORY, 6);
      }
      const show = p > 4.99 && p < 7.02 && (zone > 0.01 || fish.state === 'home') && !!F;
      if (F) F.mesh.visible = show;
      if (!show) return;
      // where it waits, lost: low in the open water, under the submarine's way (above the words on a phone)
      pathCam(Math.min(Math.max(p, 5.0), 5.76), cam);
      const lf = narrow ? 3.9 : 4.3, lx = narrow ? 0.55 : 0.1, ly = narrow ? 0.12 : -1.12;
      const tx = Math.cos(t * 1.3) * 0.16, ty = Math.sin(t * 2.1) * 0.07;
      const lost = (out) => out.set(cam.x + cam.F[0] * lf + cam.R[0] * (lx + tx) + cam.U[0] * (ly + ty), cam.y + cam.F[1] * lf + cam.U[1] * (ly + ty), cam.z + cam.F[2] * lf + cam.R[2] * (lx + tx) + cam.U[2] * (ly + ty));
      if (!fish.placed) { lost(fish.pos); fish.placed = true; }
      stage.project(fish.pos, P);
      const dl = P[2] > 0 ? Math.hypot(P[0] - L[0], P[1] - L[1]) : 1e9;
      if (fish.state === 'lost' && p > 5.05 && on > 0.6 && dl < reach) {
        fish.state = 'follow';
        stage.sparkle(fish.pos, 6);
      }
      if (fish.state === 'lost') lost(want);
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
