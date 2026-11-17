// The vents (zone s6), as in the painted dive (experience/src/vents-ui.ts, world/index.ts): the One
// binary card's terminal typed in line by line; the SDK card's tabs (TypeScript, Python, Rust;
// arrow keys move between them) showing the call that builds the visitor's own URL, the URL it
// gives, and the line that installs that library; the MCP card's log of what the other little
// submarine down here, an agent, asks crabcrop about that URL, and the agent itself in the scene
// saying "sign_url ✓" while its card is up; and the pickup: once Snap's submarine has settled by
// the geode it nudges forward, stars burst where the print lay, Snap hops in his seat, the tube
// worms duck, and the print rises out of the geode into the pincer, where it stays for the climb
// (stage.printOnPincer; hidden while the page shows it there itself, stage.printFigure), and
// Snap's story says so.
// Its words are in zones/s6.html, its styles in zones/s6.css; the agent is props/vents.js.
import { Matrix4, Quaternion, Vector3 } from 'three/webgpu';
import { SRC, remainder, sign } from '../content.js';
import { groundY, pathAt } from '../layout.js';
import { smooth } from '../math.js';
import { buildAgent } from '../props/vents.js';

const INSTALL = ['npm install @crabcrop/url', 'pip install crabcrop_url', 'cargo add crabcrop-url'];
const SIZE = ['1200 × 630', '760 × 760', '945 × 630'], FMT = ['AVIF', 'AVIF', 'JPEG XL', 'WebP'];
const PRINT_STORY = 'There it is, in the glow of the geode: Snap’s print. The submarine’s pincer lifts it out. It is the last part of your URL: <code>root:photos/print.jpg</code>, the source.';
// the pickup: the submarine has parked by the geode from p 6.87 (cast.js); the climb starts at 7
const PARKED = 6.87, CLIMB = 7.02;
// the print as the pincer holds it: this much of its size in the geode, hanging below the claw
const HELD = 0.8;

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const soft = (t) => esc(t).replace(/([/:,])(?=[^/\s])/g, '$1<wbr>');
// code as lines that keep their indent when they wrap: each line a block, its continuation hanging
// two characters further in
const codeLines = (text) => text.split('\n').map((l) => { const n = l.length - l.trimStart().length; return '<span class="ln" style="--in: ' + n + '">' + soft(l.trimStart()) + '</span>'; }).join('');

// The camera on its path at p (without the visitor's nudge): where it is, its forward, right, up.
const O6 = [0, 0, 0, 0, 0];
function pathCam(p, c) {
  pathAt(p, O6);
  const y = (O6[3] * Math.PI) / 180, x = (O6[4] * Math.PI) / 180, cy = Math.cos(y), sy = Math.sin(y), cx = Math.cos(x), sx = Math.sin(x);
  c.x = O6[0]; c.y = O6[1]; c.z = O6[2];
  c.F[0] = sy * cx; c.F[1] = sx; c.F[2] = -cy * cx;
  c.R[0] = cy; c.R[1] = 0; c.R[2] = sy;
  c.U[0] = -sx * sy; c.U[1] = cx; c.U[2] = sx * cy;
  return c;
}
const inCam = (c, f, r, u, out) => out.set(c.x + c.F[0] * f + c.R[0] * r + c.U[0] * u, c.y + c.F[1] * f + c.U[1] * u, c.z + c.F[2] * f + c.R[2] * r + c.U[2] * u);

const S = { agent: null };

export default {
  id: 's6',
  build(ctx) {
    S.agent = buildAgent();
    ctx.scene.add(S.agent.group);
  },

  mount(stage, world) {
    const doc = document, cast = world.cast, camera = stage.camera;
    const P = [0, 0, 0], v = new Vector3();
    const noteEl = doc.getElementById('note');
    const narrowMQ = matchMedia('(max-width: 760px)');

    // ---- the terminal: typed in, a line a second, once its card is in view --------------------
    // (each character waits its turn; a screen reader is given each line whole)
    doc.querySelectorAll('#vt-binary .vt-line').forEach((line, i) => {
      const text = line.textContent, n = Math.max(text.length, 1), start = 0.3 + i * 1.0;
      const typed = doc.createElement('span');
      typed.setAttribute('aria-hidden', 'true');
      let k = 0;
      const delay = () => (start + (k++ / n) * 0.95).toFixed(3) + 's';
      for (const node of [...line.childNodes]) {
        if (node.nodeType === 3) for (const c of node.data) { const s = doc.createElement('span'); s.className = 'vt-ch'; s.textContent = c; s.style.setProperty('--d', delay()); typed.append(s); }
        else if (node.nodeName === 'WBR') typed.append(doc.createElement('wbr'));
        else { const c = node.cloneNode(true); c.classList.add('vt-ch'); c.style.setProperty('--d', delay()); k += c.textContent.length - 1; typed.append(c); }
      }
      const sr = doc.createElement('span');
      sr.className = 'sr'; sr.textContent = text;
      line.replaceChildren(sr, typed);
    });

    // ---- the SDKs: tabs (a roving tabindex; arrows, Home and End move between them) ------------
    const tabs = [...doc.querySelectorAll('#vt-sdks [role="tab"]')], tablist = tabs[0] && tabs[0].parentElement;
    const panel = doc.getElementById('vt-panel'), codeEl = doc.getElementById('vt-code'), outEl = doc.getElementById('vt-out'), installEl = doc.getElementById('vt-install');
    let lang = 0;
    const renderSdk = () => {
      const rem = remainder(stage.choices), ops = rem.slice(0, rem.length - SRC.length - 1);
      const call = [
        '// @crabcrop/url\nconst url = buildURL(base, secret,\n  "' + ops + '",\n  "' + SRC + '");',
        '# crabcrop_url\nurl = build_url(base, secret,\n    "' + ops + '",\n    "' + SRC + '")',
        '// crabcrop-url\nlet url = build_url(base, Some(secret),\n    "' + ops + '",\n    "' + SRC + '", None)?;',
      ][lang];
      codeEl.innerHTML = codeLines(call);
      outEl.innerHTML = soft('→ https://img.example.com/' + sign(rem).slice(0, 8) + '…/' + rem) + ' <span class="vt-same">(the same from all three)</span>';
      if (installEl.textContent !== INSTALL[lang]) {
        installEl.textContent = INSTALL[lang];
        installEl.classList.remove('swap'); void installEl.offsetWidth; installEl.classList.add('swap');
      }
    };
    const pick = (i, focus) => {
      lang = i;
      tabs.forEach((b, j) => { b.setAttribute('aria-selected', String(j === i)); b.tabIndex = j === i ? 0 : -1; });
      panel.setAttribute('aria-labelledby', tabs[i].id);
      if (focus) tabs[i].focus();
      renderSdk();
    };
    if (tablist) {
      tablist.hidden = false;
      panel.setAttribute('role', 'tabpanel');
      panel.tabIndex = 0;
      tabs.forEach((b, i) => {
        b.addEventListener('click', () => pick(i, false));
        b.addEventListener('keydown', (e) => {
          const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
          if (d) { e.preventDefault(); pick((i + d + tabs.length) % tabs.length, true); }
          else if (e.key === 'Home') { e.preventDefault(); pick(0, true); }
          else if (e.key === 'End') { e.preventDefault(); pick(tabs.length - 1, true); }
        });
      });
    }

    // ---- the agent's tool calls about the visitor's URL -----------------------------------------
    const logEl = doc.getElementById('vt-log');
    const renderLog = () => {
      const c = stage.choices, rem = remainder(c), ops = rem.slice(0, rem.length - SRC.length - 1);
      const size = SIZE[c.crop], fmt = FMT[c.format];
      const rows = [
        ['agent', 'sign_url', ops.replace('/filters:', ' · ') + ' · ' + SRC],
        ['crabcrop', '', 'https://img.example.com/' + sign(rem).slice(0, 8) + '…/' + rem],
        ['agent', 'explain_url', 'is it right?'],
        ['crabcrop', '', 'valid · key 1 · ' + size + ' · ' + fmt],
        ['agent', 'fetch_meta', 'what does it show?'],
        ['crabcrop', '', size + ' · ' + fmt + ' · a sun over two hills, stitched'],
      ];
      logEl.innerHTML = rows.map(([who, tool, what], i) => '<li class="' + (who === 'agent' ? 'ask' : 'answer') + '" style="--i: ' + i + '"><span class="who">' + who + '</span>' + (tool ? '<code>' + tool + '</code>' : '') + '<span class="what">' + soft(what) + '</span></li>').join('');
      talkFrom = stage.t;
    };
    let talkFrom = -10;
    stage.onChoice(() => { renderSdk(); renderLog(); });
    renderSdk(); renderLog();
    talkFrom = -10;

    // each card plays its specimen once it has come into view; the agent's card, while it is in
    // the middle of the view, lets the agent speak
    const mcpCard = doc.getElementById('vt-mcp');
    let mid = false;
    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver((es) => es.forEach((e) => {
        if (!e.isIntersecting || e.target.classList.contains('in')) return;
        e.target.classList.add('in');
        if (e.target === mcpCard) talkFrom = stage.t;
      }), { threshold: 0.35 });
      doc.querySelectorAll('#s6 .vt-card').forEach((c) => io.observe(c));
      new IntersectionObserver((es) => es.forEach((e) => { mid = e.isIntersecting; }), { rootMargin: '-25% 0px -25% 0px' }).observe(mcpCard);
    } else doc.querySelectorAll('#s6 .vt-card').forEach((c) => c.classList.add('in'));
    const bubble = stage.el('p', 'vt-bubble', stage.layer, '<code>sign_url</code> <b>✓</b>');
    bubble.setAttribute('aria-hidden', 'true');
    let bubbleOn = false, bx = -1e4, by = -1e4;

    // ---- the agent's submarine: comes in from the right as its card comes up, waits low on the
    // right of the view (above the words on a phone), and goes off into the dark after it
    const A = S.agent, ag = { pos: new Vector3(), rel: new Vector3(), placed: false }, cam = { x: 0, y: 0, z: 0, F: [0, 0, 0], R: [0, 0, 0], U: [0, 0, 0] };
    const want = new Vector3(), face = new Vector3(), Z = new Vector3(0, 0, 1), q1 = new Quaternion(), q2 = new Quaternion(), X = new Vector3(1, 0, 0);

    // ---- the pickup -----------------------------------------------------------------------------
    const gp = world.geodePrint;
    const home = gp ? { pos: gp.position.clone(), quat: gp.quaternion.clone(), scale: gp.scale.clone() } : null;
    const pk = { taken: false, at: -10, settledAt: -1, lastSub: new Vector3(), noteAt: -10 };
    const pin = new Vector3(), hold = new Vector3(), holdQ = new Quaternion(), up = new Vector3(), lift = new Vector3(), look = new Matrix4();
    stage.printOnPincer = false;

    this.tick = () => {
      const p = stage.p, t = stage.t, dt = stage.dt, W = stage.W, Hh = stage.H, narrow = narrowMQ.matches;

      // ---- the agent
      const agentOn = p > 6.32 && p < 6.91 && !!A;
      if (A) A.group.visible = agentOn;
      if (agentOn) {
        pathCam(Math.min(Math.max(p, 6.4), 6.88), cam);
        const come = smooth(6.32, 6.5, p), go = smooth(6.79, 6.9, p);
        // (on a phone Snap's submarine fills the middle of the view: the agent waits further off,
        // up in the band between the bar and the submarine)
        const f = narrow ? 7.0 : 5.0, r = narrow ? 1.0 : 2.15, u = narrow ? 2.9 : -1.0;
        inCam(cam, f + 3.5 * (1 - come) + 5 * go, r + 3.2 * (1 - come) + 1.8 * go, u + 0.6 * (1 - come) + 1.6 * go, want);
        want.y += Math.sin(t * 1.1) * 0.05;
        // (it eases toward its place in the view, not in the water, so a camera on the move never
        // leaves it behind)
        want.x -= cam.x; want.y -= cam.y; want.z -= cam.z;
        if (!ag.placed || dt <= 0) { ag.rel.copy(want); ag.placed = true; } else ag.rel.lerp(want, 1 - Math.exp(-dt * 2.5));
        ag.pos.set(cam.x, cam.y, cam.z).add(ag.rel);
        A.group.position.copy(ag.pos);
        // side on to the visitor wherever it is in the view, its nose to the left (as in the painted
        // dive), a touch toward them; rocking gently
        face.set(ag.rel.x, 0, ag.rel.z).normalize();
        face.set(face.z - face.x * 0.18, 0, -face.x - face.z * 0.18).normalize();
        q1.setFromUnitVectors(Z, face.negate());
        q2.setFromAxisAngle(X, Math.sin(t * 0.8) * 0.05);
        A.group.quaternion.copy(q1).multiply(q2);
        A.group.updateMatrixWorld(true);
        // it thinks as it calls a tool: its light brightens with each of its calls in the log
        let talk = 0.12 + 0.08 * Math.sin(t * 2.3);
        for (let j = 0; j < 6; j += 2) { const s = t - (talkFrom + 0.3 + j * 0.5); if (s > 0 && s < 0.8) talk = Math.max(talk, Math.sin((s / 0.8) * Math.PI)); }
        A.talk.value = talk;
      } else ag.placed = false;
      // it speaks while its card is in the middle of the view
      let speak = false;
      if (agentOn && mid && !mcpCard.classList.contains('gone')) {
        v.copy(A.dome).applyMatrix4(A.group.matrixWorld);
        stage.project(v, P);
        if (P[2] > 0.5 && stage.onScreen(P[0], P[1], -20)) {
          speak = true;
          const x = Math.round(Math.min(Math.max(P[0], 150), W - (stage.wide ? 70 : 10))), y = Math.round(Math.max(P[1], (narrow ? 178 : 110)));
          if (x !== bx || y !== by) { bx = x; by = y; bubble.style.transform = 'translate(' + x + 'px,' + y + 'px) translateX(-100%)'; }
        }
      }
      if (speak !== bubbleOn) { bubbleOn = speak; bubble.classList.toggle('on', speak); }

      // ---- the pickup
      if (!gp || !cast || !cast.sub) return;
      const sub = cast.sub.group;
      // (scrolling back up before the geode puts the print back; on the way up he keeps it)
      if (p < 6.78) { pk.taken = false; pk.settledAt = -1; }
      const speed = dt > 0 ? pk.lastSub.distanceTo(sub.position) / dt : 0;
      pk.lastSub.copy(sub.position);
      if (!pk.taken && pk.settledAt < 0 && p >= PARKED && p < 7.06 && speed < 0.3) pk.settledAt = t;
      if (!pk.taken && p >= CLIMB) { pk.taken = true; pk.at = t - 10; }            // (arrived from above the vents: held already)
      if (!pk.taken && ((pk.settledAt >= 0 && t - pk.settledAt > 0.8) || p > 6.97)) {
        // it nudges forward for it: stars where the print lay, Snap hops in his seat, the
        // print rises into the pincer; the story says so
        pk.taken = true; pk.at = t;
        stage.sparkle(home.pos, 12);
        cast.react('hop');
        if (world.fauna && world.fauna.wormsDuck) world.fauna.wormsDuck();
        cast.lunge();
        stage.note(PRINT_STORY, 7);
        pk.noteAt = t;
      }
      stage.printOnPincer = pk.taken;
      const age = t - pk.at;
      // (the story goes when the visitor leaves the vents)
      if (pk.noteAt > 0 && (p > CLIMB + 0.1 || p < 6.6) && t - pk.noteAt < 7) {
        const np = noteEl.querySelector('p');
        if (np && np.textContent.startsWith('There it is')) noteEl.classList.remove('on');
        pk.noteAt = -10;
      }
      // the print: in the geode, or rising into the pincer and held there, facing the visitor,
      // swinging a little; hidden while the page shows it on the pincer itself
      if (!pk.taken) {
        gp.position.copy(home.pos); gp.quaternion.copy(home.quat); gp.scale.copy(home.scale);
        gp.visible = true;
        return;
      }
      gp.visible = !stage.printFigure;
      if (!gp.visible) return;
      cast.pincerAt(pin);
      const e = camera.matrixWorld.elements;
      up.set(e[4], e[5], e[6]);
      const ph = gp.geometry.parameters ? gp.geometry.parameters.height : 0.5;
      hold.copy(pin).addScaledVector(up, -ph * HELD * 0.5 - 0.03);
      // (parked on the sand, the claw is low: the print is held up clear of it)
      const floor = groundY(hold.x, hold.z) + 0.05 + ph * HELD * 0.5;
      if (hold.y < floor) hold.y = floor;
      // (facing the visitor, upright in the view, swinging a little from the claw)
      look.lookAt(camera.position, hold, up);
      q1.setFromRotationMatrix(look);
      q2.setFromAxisAngle(Z, Math.sin(t * 1.3) * 0.06 - 0.08);
      holdQ.copy(q1).multiply(q2);
      const g = smooth(0, 0.7, age), arc = Math.sin(g * Math.PI) * 0.35;
      lift.copy(home.pos).lerp(hold, g);
      lift.y += arc;
      gp.position.copy(lift);
      gp.quaternion.copy(home.quat).slerp(holdQ, g);
      gp.scale.copy(home.scale).multiplyScalar(1 + (HELD - 1) * g);
    };
  },
  frame() { if (this.tick) this.tick(); },
};
