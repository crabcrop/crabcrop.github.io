// The cast: Snap and his submarine, where they are at each point of the dive, and the
// visitor's lamp. Snap leads the way down: he swims a few metres ahead of the camera, to
// the right of the words on a wide screen and above them on a phone, and keeps turning to
// look at the visitor (into the wreck's cabin too, where the camera follows him). As they
// leave the wreck the submarine comes for him; from the drop-off on he rides in its glass
// bubble, and its lamp is the visitor's light in the dark.
import { Mesh, PlaneGeometry, Quaternion, Vector3 } from 'three/webgpu';
import { faceDirection, float, select, texture, uv, vec3 } from 'three/tsl';
import { feltPrint } from './feltprint.js';
import { RIDE, SLOTS, groundY, rideU } from './layout.js';
import { clamp, smooth } from './math.js';
import { G, material } from './shaders.js';
import { Snap } from './snap.js';
import { buildSub } from './sub.js';

// Where they sit in the camera's view: metres forward, right, up. A wide window keeps the
// left for the words; a tall one keeps the bottom for them. (layout.js: the camera rides
// down the mooring's chain keeping Snap in his.)
const SLOT = SLOTS;
// (on a wide screen his place drifts a little from scene to scene, so he is not pinned to
// one spot: low over the sand in the shallows, up among the kelp, low and further over the
// reef. [from p, to p, forward, right, up] added to his place, eased in and out)
const DRIFT = [[1.45, 2.05, 0.25, 0.25, -0.3], [2.1, 2.95, -0.15, -0.1, 0.2], [3.05, 3.7, 0.12, 0.2, -0.15], [3.68, 3.95, -0.2, -0.75, 0.12]];
// the submarine's place in the deep, beat by beat (wide screens): small, dropping past the
// cliff; close among the jellies; back, so the anglerfish can come close; small and high
// among the chimneys. [from p, to p, forward, right, up] added to its place.
// (consecutive beats overlap by their easing, so it moves from one place to the next without
// dropping back to its usual place in between; fauna.js times the anglerfish by these)
export const SUB_DRIFT = [[5.08, 5.38, 2.2, 0.7, -0.45], [5.32, 5.63, 0.5, 0.0, 0.15], [5.57, 5.79, 1.7, 0.6, 0.65], [6.12, 6.82, 1.7, 0.3, 0.95]];
const subDriftAt = (p, out) => {
  out[0] = out[1] = out[2] = 0;
  for (let i = 0; i < SUB_DRIFT.length; i++) {
    const d = SUB_DRIFT[i], k = smooth(d[0], d[0] + 0.06, p) * (1 - smooth(d[1] - 0.06, d[1], p));
    out[0] += d[2] * k; out[1] += d[3] * k; out[2] += d[4] * k;
  }
  return out;
};
const driftAt = (p, out) => {
  out[0] = out[1] = out[2] = 0;
  for (let i = 0; i < DRIFT.length; i++) {
    const d = DRIFT[i], k = smooth(d[0], d[0] + 0.12, p) * (1 - smooth(d[1] - 0.12, d[1], p));
    out[0] += d[2] * k; out[1] += d[3] * k; out[2] += d[4] * k;
  }
  return out;
};
// The story's beats along p: Snap dives onto the mooring's chain just under its buoy, rides
// it down to the anchor's ring (RIDE in layout.js) and lets go there; past the wreck the
// submarine comes and turns its cockpit to him, its canopy lifting (OPENS); he climbs in and
// sits (SNAP_BOARDS); the canopy shuts (SHUTS) and its latch locks (LOCKS: the lights go green,
// a clunk); and away they go, over the drop.
const CHAIN_LEAVES = [RIDE[2], RIDE[2] + 0.18], SUB_COMES = [4.68, 4.82], OPENS = [4.76, 4.84], SNAP_BOARDS = [4.84, 4.93];
const SHUTS = [4.935, 4.97];
export const LOCKS = [4.975, 4.992];
// The homecoming: at the surface the submarine comes up, its tower and the top of its hull out
// of the water (SURFACES), its canopy lifts and Snap climbs out onto its back (CLIMBS_OUT),
// holding up his print and waving, as he began; the canopy shuts behind him (EMPTY_SHUT).
export const SURFACES = [7.74, 7.86], CLIMBS_OUT = [7.85, 7.91];
const EMPTY_SHUT = [7.91, 7.95];
// how far along the chain his grip is at p (0 at the buoy, 1 at the anchor's ring)
const chainS = (p) => rideU(p);
// The opening: he treads water at the waterline in his place, his photo print held up out of
// the water; a gust snatches it, it flies and falls in ahead and sinks, leading the way down;
// he hops and dives after it.
const GUST = [0.035, 0.15], DIVE = [0.075, 0.2], PRINT_GONE = 1.55;

const REACTIONS = ['poke', 'hop', 'snap', 'wave', 'spin'];
const R = new Vector3(), U = new Vector3(), F = new Vector3(), A = new Vector3(), B = new Vector3(), C = new Vector3();
const UP = new Vector3(0, 1, 0), M = new Vector3(), Z = new Vector3(0, 0, 1);
const qa = new Quaternion(), qb = new Quaternion();
const ON = [0, 0, 0, 0, 0, 0], GRIP = new Vector3(), ALONG = new Vector3(), D = new Vector3();
const HELD = new Vector3(), UP3 = new Vector3(), SNAP_AT = [0, 0, 0], DRIFT_AT = [0, 0, 0], SUB_AT = [0, 0, 0];
const FLY = [new Vector3(), new Vector3(), new Vector3()], TUMBLE = new Vector3(0.35, 1, 0.5).normalize(), qt = new Quaternion();
const bez = (out, a, b, c, u) => out.copy(a).multiplyScalar((1 - u) * (1 - u)).addScaledVector(b, 2 * (1 - u) * u).addScaledVector(c, u * u);

// Snap's photo print: the felt picture (feltprint.js) on the front, plain felt on the back.
// 0.3 by 0.21 m.
const PRINT_W = 0.3, PRINT_H = 0.21;
function buildPrint() {
  const pic = texture(feltPrint());
  const mat = material({
    twoSided: true, shadow: false,
    surface(s) {
      const img = pic.sample(uv()).rgb;
      s.albedo = select(faceDirection.greaterThan(0.0), img, vec3(0.86, 0.80, 0.68));
      s.spec = float(0.05); s.gloss = float(8.0); s.fluor = float(0.2);
      s.emis = s.albedo.mul(0.3);                 // (pale felt catches the light from all round)
    },
  });
  const mesh = new Mesh(new PlaneGeometry(PRINT_W, PRINT_H), mat);
  mesh.visible = false;
  return { mesh };
}

export function buildCast(ctx) {
  const { scene, camera, q } = ctx;
  const snap = new Snap(), sub = buildSub(q), print = buildPrint();
  scene.add(snap.group, sub.group, print.mesh);
  const loading = snap.load(Math.max(innerWidth, innerHeight) * (devicePixelRatio || 1) < 1400).catch((e) => console.warn('dive: Snap did not load: ' + e.message));
  const st = {
    pos: new Vector3(), last: new Vector3(), subPos: new Vector3(), rel: new Vector3(), subRel: new Vector3(), placed: false,
    aimX: 0, aimY: 0, idle: 0, lastP: -1, wave: 0, poked: -1e9, react: 'poke', nPoke: 0, t: 0, flyFrom: false,
    free: false, visiting: false, visitFrom: -1e9, visitAt: new Vector3(), visitK: 0,
  };
  const ndc = new Vector3();
  const slot = (o, out) => out.copy(camera.position).addScaledVector(F, o[0]).addScaledVector(R, o[1]).addScaledVector(U, o[2]);

  const cast = {
    snap, sub, loading,
    chainAt: null,                 // set when the chain exists: chainAt(s, out) writes x, y, z and its direction
    geodeAt: null,                 // the geode's position (a Vector3), if the set has one: the submarine parks by it
    // things worth a look on the way: { from, to, at } (p range, a Vector3); he glances at
    // one while the camera passes it, and back at the visitor between glances
    sights: [],
    // the pointer steers the lamp: x and y from -1 to 1
    aim(x, y) { st.aimX = x; st.aimY = y; },
    // A card visit: where he should stand (a Vector3: on the top edge of the card on screen, as
    // far off as he is), or null to come back. He leaps there, snaps his pincer twice on it, and
    // leaps back once the visitor scrolls on. Returns whether he can visit now (free, swimming).
    visit(at) {
      if (at) { if (!st.free) return false; if (!st.visiting) { st.visitFrom = st.t; st.react = 'snap'; st.poked = st.t + 0.55; } st.visiting = true; st.visitAt.copy(at); }
      else if (st.visiting) { st.visiting = false; st.visitFrom = st.t; }
      return true;
    },
    get idle() { return st.idle; },
    // whether (x, y) in -1..1 (y up) is on Snap
    hits(x, y) {
      if (!snap.ready || !snap.group.visible) return false;
      ndc.copy(snap.group.position).project(camera);
      const d = camera.position.distanceTo(snap.group.position);
      const r = (snap.height * 0.75) / (d * Math.tan((camera.fov * Math.PI) / 360));
      return ndc.z <= 1 && Math.hypot((x - ndc.x) * camera.aspect, y - ndc.y) <= r;
    },
    // a tap or click at (x, y): if it is on Snap, he answers, each time the next of his
    // reactions (a start, a hop, a snap, a wave, a spin). Returns whether it was on him.
    poke(x, y) {
      if (!cast.hits(x, y)) return false;
      st.poked = st.t; st.react = REACTIONS[st.nPoke++ % REACTIONS.length];
      return true;
    },
    // Snap answers something the visitor did: 'snap' (two snaps of his pincer: he cut it, sealed
    // it, took it), 'wave', 'hop' (a little jump of joy), 'poke' (a start, a snap and a wave)
    react(kind = 'snap') { st.poked = st.t; st.react = kind; },
    // where his middle is, and the point in his raised claw (world space)
    snapAt(out) { return out.copy(snap.group.position); },
    gripAt(out) { return snap.gripWorld(out); },
    // the tip of the submarine's pincer (world space)
    pincerAt(out) { return out.copy(sub.pincer).applyMatrix4(sub.group.matrixWorld); },
    update(t, dt, p) {
      const e = camera.matrixWorld.elements;
      R.set(e[0], e[1], e[2]); U.set(e[4], e[5], e[6]); F.set(-e[8], -e[9], -e[10]);
      const o = camera.aspect < 1 ? SLOT.tall : SLOT.wide;
      const depth = -camera.position.y;
      const jump = dt <= 0 || !st.placed;
      // (each follows its place as the camera sees it: where the camera goes they go at once,
      // and only a change of place within the view is eased, so a fast scroll never leaves them
      // behind; rel is where each was from the camera)
      // (a place that is fixed in the world, as where the submarine parks, is followed there)
      const follow = (cur, rel, want, rate, fixed = false) => {
        if (fixed && !jump) {
          cur.lerp(want, 1 - Math.exp(-dt * rate));
          rel.copy(cur).sub(camera.position);
          return;
        }
        D.copy(want).sub(camera.position);
        if (jump || rel.distanceToSquared(D) > 64) rel.copy(D); else rel.lerp(D, 1 - Math.exp(-dt * rate));
        cur.copy(camera.position).add(rel);
      };

      // ---- the submarine: comes down from ahead and a little to the right (away from the
      // wreck, which is on the left), where it can be seen coming, then stays in its place
      const come = smooth(SUB_COMES[0], SUB_COMES[1], p);
      // (while he gets in, it turns its cockpit toward the visitor, so the canopy and he show)
      const home = smooth(SURFACES[0], SURFACES[1], p);
      const facing = Math.max(smooth(OPENS[0], OPENS[1], p) * (1 - smooth(LOCKS[1], LOCKS[1] + 0.1, p)), home * 0.35);
      // (at the geode it moves aside, so the geode shows: up on a phone, right on a wide screen)
      const geode = smooth(6.8, 6.87, p) * (1 - smooth(7.04, 7.1, p));
      if (o === SLOT.wide) {
        subDriftAt(p, DRIFT_AT);
        SUB_AT[0] = o.sub[0] + DRIFT_AT[0]; SUB_AT[1] = o.sub[1] + 0.75 * geode + DRIFT_AT[1]; SUB_AT[2] = o.sub[2] + 0.1 * geode + DRIFT_AT[2];
      } else SUB_AT[0] = o.sub[0] + 0.5 * geode, SUB_AT[1] = o.sub[1], SUB_AT[2] = o.sub[2] + 1.05 * geode;
      slot(SUB_AT, A);
      B.copy(A).addScaledVector(F, 6).addScaledVector(R, 2.2).addScaledVector(UP, 2.4);
      A.lerp(B, 1 - come);
      A.y += Math.sin(t * 0.9) * 0.06;
      // at the geode (when the set gives it) it settles on the sand beside it, to its right,
      // nose toward it, as if to reach in for the print
      const park = cast.geodeAt ? geode : 0;
      if (park > 0) {
        const g = cast.geodeAt;
        B.copy(g).addScaledVector(R, o === SLOT.wide ? 2.6 : 1.7).addScaledVector(F, o === SLOT.wide ? 0.4 : 0.9);
        B.y = groundY(B.x, B.z) + 0.85 + (o === SLOT.wide ? 0 : 1.1);
        A.lerp(B, park);
      }
      A.y = Math.max(A.y, groundY(A.x, A.z) + 0.85);        // (never in the ground)
      A.y = Math.min(A.y, -1.0 + 0.78 * home);               // (nor through the surface, until it comes home)
      follow(st.subPos, st.subRel, A, 3, park > 0.5);
      sub.group.visible = come > 0.001;
      sub.group.position.copy(st.subPos);
      G.subAt.value.set(st.subPos.x, sub.group.visible ? st.subPos.y : -1000, st.subPos.z, 1.3);
      // its nose points across the view, a little toward the visitor, so the bubble shows;
      // level, with a little pitch where the dive goes up or down
      C.copy(R).multiplyScalar(-0.85).addScaledVector(F, -0.5);
      if (facing > 0) C.lerp(M.copy(R).multiplyScalar(-0.42).addScaledVector(F, -0.9), facing);
      if (park > 0) { M.copy(cast.geodeAt).sub(st.subPos); M.y = 0; M.normalize(); C.lerp(M, park); }
      C.y = 0; C.normalize();
      sub.group.quaternion.setFromUnitVectors(Z, C.negate());
      qa.setFromAxisAngle(R, clamp(F.y, -0.6, 0.6) * 0.35 + Math.sin(t * 0.7) * 0.03);
      sub.group.quaternion.premultiply(qa);
      // the canopy lifts as it arrives, shuts once he is in (with a little bounce), and locks
      const shut = smooth(SHUTS[0], SHUTS[1], p), bounce = Math.sin(clamp((p - SHUTS[1]) / 0.02, 0, 1) * Math.PI) * 0.05;
      sub.open(Math.max(smooth(OPENS[0], OPENS[1], p) * (1 - shut) + bounce, smooth(CLIMBS_OUT[0] - 0.03, CLIMBS_OUT[0], p) * (1 - smooth(EMPTY_SHUT[0], EMPTY_SHUT[1], p))));
      const locked = smooth(LOCKS[0], LOCKS[1], p);
      sub.lock(locked);
      sub.group.updateMatrixWorld(true);
      // (the propeller idles while it waits, and drives once the canopy is locked)
      sub.turn(dt, come * (0.25 + 0.75 * locked));

      // ---- Snap: swimming in his place, then into the bubble. In the wreck's cabin he comes
      // closer to the camera (the room is small: the desk is three metres off)
      const cabin = smooth(4.49, 4.55, p) * (1 - smooth(4.63, 4.69, p));
      if (o === SLOT.wide) driftAt(p, DRIFT_AT); else { DRIFT_AT[0] = DRIFT_AT[1] = 0; DRIFT_AT[2] = -0.75 * cabin; }
      M.set(o.snap[0] * (1 - 0.1 * cabin) + DRIFT_AT[0], o.snap[1] * (1 - 0.25 * cabin) + DRIFT_AT[1], o.snap[2] + DRIFT_AT[2]);
      slot(M.toArray(SNAP_AT), A);
      A.y += Math.sin(t * 1.3) * 0.05;
      A.y = Math.max(A.y, groundY(A.x, A.z) + 0.45);
      const board = smooth(SNAP_BOARDS[0], SNAP_BOARDS[1], p);
      if (board > 0) {
        // in at the front of the open cockpit: first to just before it, then up over its lip
        // and down into his seat
        B.copy(sub.seat).applyMatrix4(sub.group.matrixWorld);
        HELD.copy(sub.door).applyMatrix4(sub.group.matrixWorld);
        const a1 = smooth(0, 0.55, board), a2 = smooth(0.45, 1, board);
        A.lerp(HELD, a1).lerp(B, a2);
        A.y += Math.sin(a2 * Math.PI) * 0.16;
      }
      if (board >= 1) A.copy(B);
      // and home: out over the cockpit's lip and up onto the submarine's back, in front of its
      // tower, where he stands with his print held up
      const out = smooth(CLIMBS_OUT[0], CLIMBS_OUT[1], p);
      if (out > 0) {
        HELD.copy(sub.perch).applyMatrix4(sub.group.matrixWorld);
        A.lerp(HELD, out);
        A.y += Math.sin(out * Math.PI) * 0.28;
      }
      // on the chain: his dive ends on the mooring's chain just under its buoy, and from there
      // his raised claw holds it all the way down to the anchor (where the ride has him, as the
      // camera has him: he never lets go on the way); then he lets go and swims to his place
      const dive = smooth(DIVE[0], DIVE[1], p);
      const onChain = cast.chainAt && p > DIVE[0] ? 1 - smooth(CHAIN_LEAVES[0], CHAIN_LEAVES[1], p) : 0;
      let grip = 0;
      if (onChain > 0) {
        cast.chainAt(chainS(Math.max(p, RIDE[0])), ON);
        GRIP.set(ON[0], ON[1], ON[2]);
        ALONG.set(ON[3], ON[4], ON[5]).normalize();
        if (ALONG.y < 0) ALONG.negate();            // his up runs up the chain, toward the buoy
        ALONG.y += 0.9; ALONG.normalize();          // (more upright than the chain: he hangs from it)
        // (his middle hangs a little below his grip; the dive carries him there)
        B.copy(GRIP); B.y -= 0.12;
        A.lerp(B, onChain * dive);
        // the claw closes on the chain as the dive ends, and lets go as he leaves it
        grip = smooth(DIVE[1] - 0.025, DIVE[1] + 0.01, p) * smooth(0.5, 0.75, onChain);
      }
      const hang = grip > 0.5;
      // (free to visit a card: swimming in his place, not on the chain, in the cabin or aboard)
      st.free = grip <= 0 && board <= 0 && cabin <= 0 && p > RIDE[2] + 0.2 && p < 4.4;
      const vk = st.visiting && st.free ? smooth(0, 0.6, st.t - st.visitFrom) : st.visitK > 0 && st.free ? 1 - smooth(0, 0.5, st.t - st.visitFrom) : 0;
      if (st.visiting || vk <= 0) st.visitK = vk; else st.visitK = Math.min(st.visitK, vk);
      if (st.visitK > 0) { A.lerp(st.visitAt, st.visitK); A.y += Math.sin(st.visitK * Math.PI) * 0.35; }
      // the opening: treading water, his middle just under the waterline and bobbing with the
      // swell, so the print in his raised claw is out of the water; then a hop and a dive
      if (dive < 1) {
        const atTop = -0.04 + Math.sin(t * 1.1) * 0.025 + Math.sin(t * 1.7 + 1) * 0.012;
        A.y = atTop + (A.y - atTop) * dive + Math.sin(dive * Math.PI) * 0.32;
      }
      st.last.copy(st.pos);
      follow(st.pos, st.rel, A, board >= 1 || dive < 0.5 ? 30 : dive < 1 ? 12 : grip > 0 ? 14 : 4.5);
      snap.group.position.copy(st.pos);
      G.snapAt.value.set(st.pos.x, st.pos.y, st.pos.z, 0.45);
      // how he moves: paddling harder the faster he goes, leaning into it
      const speed = dt > 0 ? M.copy(st.pos).sub(st.last).length() / dt : 0;
      const inSub = board >= 1 && out < 0.5;
      snap.life.kick = inSub ? 0 : dive < 1 ? 0.15 + 0.85 * Math.sin(dive * Math.PI) : clamp(0.25 + speed * 0.5, 0, 1);
      snap.life.planted = inSub || out >= 1 ? 1 : 0;
      snap.life.swing = dt > 0 ? clamp(M.copy(st.pos).sub(st.last).dot(R) / dt, -2, 2) * 0.5 : 0;
      // when the visitor stops scrolling for a while, he waves; at the surface he waves goodbye
      st.idle = Math.abs(p - st.lastP) < 1e-4 ? st.idle + dt : 0;
      st.lastP = p;
      const waveNow = (st.idle > 3 && st.idle < 5.5) || p > 7.85 ? 1 : 0;
      st.wave += (waveNow - st.wave) * Math.min(1, dt * 4);
      // poked: a start, a snap of the pincer, and a wave of the free claw (or one of them, when
      // he answers something the visitor did)
      st.t = t;
      const since = t - st.poked, pk = since >= 0 && since < 1.6 ? since / 1.6 : 0, rk = st.react;
      snap.life.surprise = pk && rk === 'poke' ? Math.max(0, 1 - pk * 3) : 0;
      snap.life.snap = pk && (rk === 'poke' || rk === 'snap') ? Math.min(1, pk * 1.6) : 0;
      snap.life.wave = pk && (rk === 'poke' || rk === 'wave') ? Math.sin(pk * Math.PI) : 0;
      if (pk && rk === 'hop' && grip < 0.5 && !inSub) { st.pos.y += Math.sin(Math.min(pk * 2, 1) * Math.PI) * 0.18; snap.group.position.copy(st.pos); }
      snap.life.hello = st.wave;
      snap.life.squint = Math.max(st.wave * 0.8, pk > 0.4 ? Math.sin((pk - 0.4) / 0.6 * Math.PI) : 0);
      // the gust: a start as the print goes
      if (p > GUST[0] && p < GUST[0] + 0.08) snap.life.surprise = Math.max(snap.life.surprise, Math.sin(((p - GUST[0]) / 0.08) * Math.PI));
      // and he reaches after it with his free claw; and reaches for the submarine as it comes
      snap.life.hold = p > GUST[0] && p < DIVE[1] ? Math.sin(((p - GUST[0]) / (DIVE[1] - GUST[0])) * Math.PI) * 2.2
        : p > SUB_COMES[0] && p < SNAP_BOARDS[0] + 0.04 ? Math.sin(((p - SUB_COMES[0]) / (SNAP_BOARDS[0] + 0.04 - SUB_COMES[0])) * Math.PI) * 2.0 : 0;
      // he turns to face the visitor, his body a little toward where he goes; on the chain,
      // his up runs along it
      C.copy(camera.position).sub(st.pos);
      C.y *= 0.3; C.normalize();
      qa.setFromUnitVectors(Z, C);
      // (now and then, swimming, he turns his body toward where he goes, his eyes still on
      // the visitor; on the chain, in the cabin and in the submarine he faces them)
      const turnAway = hang || inSub || cabin > 0.5 || p < DIVE[1] ? 0 : smooth(0.55, 0.95, Math.sin(t * 0.37 + 1.3)) * 0.75;
      const spin = pk && rk === 'spin' ? smooth(0, 0.7, pk) * Math.PI * 2 : 0;
      qb.setFromAxisAngle(UP, -0.35 - turnAway + snap.life.swing * 0.15 + spin);
      snap.group.quaternion.copy(qa).multiply(qb);
      // head-first as he dives after the print, and a forward lean when he swims hard
      const plunge = smooth(0.075, 0.15, p) * (1 - smooth(0.36, 0.62, p));
      const swims = hang || inSub || cabin > 0.5 || p < 0.62 ? 0 : 0.28 + clamp(speed * 0.08, 0, 0.2);
      const pitchDown = (Math.max(Math.sin(dive * Math.PI) * 1.05, plunge * 0.95) + swims) * (1 - grip);
      if (pitchDown > 0.001) { qa.setFromAxisAngle(R, -pitchDown); snap.group.quaternion.premultiply(qa); }
      if (grip > 0) {
        // his up along the chain, and his raised claw on it: he is moved so that the claw sits
        // exactly on the chain (as the claw closes, from where the dive brought him)
        qa.setFromUnitVectors(UP, ALONG);
        qb.identity().slerp(qa, grip);
        snap.group.quaternion.premultiply(qb);
        snap.group.updateMatrixWorld(true);
        snap.gripWorld(B);
        st.pos.addScaledVector(D.copy(GRIP).sub(B), grip);
        st.rel.copy(st.pos).sub(camera.position);
        snap.group.position.copy(st.pos);
        snap.life.kick = 0.12 + (1 - grip) * snap.life.kick;
      }
      snap.target.copy(camera.position);
      for (let i = 0; i < cast.sights.length; i++) {
        const g = cast.sights[i];
        if (p > g.from && p < g.to && Math.sin(t * 0.7 + i) > -0.2) { snap.target.copy(g.at); break; }
      }
      // (while the visitor's hand moves over the scene his eyes follow it: the point under it, as
      // far off as he is)
      const hand = G.hand.value;
      if (hand.z > 0.5) {
        const d = camera.position.distanceTo(st.pos), th = Math.tan((camera.fov * Math.PI) / 360);
        snap.target.copy(camera.position).addScaledVector(F, d).addScaledVector(R, hand.x * d * th * camera.aspect).addScaledVector(U, hand.y * d * th);
      }
      // (in the submarine a warm light inside keeps him red in the dark)
      snap.U.cabin.value = inSub ? 0.1 + 0.3 * smooth(40, 90, depth) : 0.22 * cabin;   // (and the lantern's glow on him in the wreck's cabin)
      snap.live(t, dt);

      // ---- his print: held up in his raised claw; snatched by the gust, it flies up and falls
      // in a few metres beyond him, then sinks ahead of the camera, tumbling, down past the anchor
      // (and home again at the end, held up as at the start, once he is out on the submarine's back)
      const homeHeld = p > CLIMBS_OUT[1] - 0.012;
      print.mesh.visible = snap.ready && (p < PRINT_GONE || homeHeld);
      if (print.mesh.visible && homeHeld) {
        snap.gripWorld(HELD);
        print.mesh.position.copy(HELD); print.mesh.position.y += 0.13;
        print.mesh.lookAt(camera.position);
        qt.setFromAxisAngle(TUMBLE, Math.sin(t * 1.4) * 0.08);
        print.mesh.quaternion.multiply(qt);
        print.mesh.scale.setScalar(1);
      } else if (print.mesh.visible) {
        snap.gripWorld(HELD);
        HELD.y += 0.13;
        const g = clamp((p - GUST[0]) / (GUST[1] - GUST[0]), 0, 1), sink = clamp((p - GUST[1]) / (PRINT_GONE - GUST[1]), 0, 1);
        if (g <= 0) { print.mesh.position.copy(HELD); FLY[0].copy(HELD); st.flyFrom = true; }
        else {
          // (from where it was snatched; if the dive starts past that, from about there)
          if (!st.flyFrom) { slot(o.snap, FLY[0]); FLY[0].y = 0.3; st.flyFrom = true; }
          // (up and to the left, through the open sky between the boats, and down ahead)
          FLY[1].copy(FLY[0]).add(UP3.set(-1.6, 1.25, -1.6));
          FLY[2].set(FLY[0].x - 2.3, 0.02, FLY[0].z - 3.6);
          if (sink <= 0) bez(print.mesh.position, FLY[0], FLY[1], FLY[2], g * g * (1.6 - 0.6 * g));
          else {
            // sinking: it settles in just ahead of Snap and a little to his left, seesawing down
            // through the light as paper does, leading the way; past the anchor it drifts on
            // ahead, down the slope and out of sight
            const lead = smooth(0, 0.18, sink), on = smooth(0.62, 1.0, sink);
            HELD.copy(camera.position).addScaledVector(F, 3.3 + 9 * on).addScaledVector(R, 0.35 - 0.4 * on).addScaledVector(U, -0.65 - 1.4 * on);
            HELD.x += Math.sin(t * 1.3) * 0.22; HELD.y += Math.sin(t * 2.6) * 0.06;
            print.mesh.position.copy(FLY[2]).lerp(HELD, lead);
          }
        }
        print.mesh.lookAt(camera.position);
        // (two whole turns in the air, so it lands face up and sinks with its picture toward
        // the visitor, rocking as it goes)
        qt.setFromAxisAngle(TUMBLE, g * 4 * Math.PI + (sink > 0 ? Math.sin(t * 1.3) * 0.45 : 0) + (g > 0 && sink <= 0 ? Math.sin(t * 2.3) * 0.25 : g > 0 ? 0 : Math.sin(t * 1.4) * 0.08));
        print.mesh.quaternion.multiply(qt);
        print.mesh.scale.setScalar(sink > 0 ? 1.25 : 1);
      } else st.flyFrom = false;

      // ---- the lamp: on as the light goes, aimed where the visitor points
      const on = smooth(45, 95, depth) * come;
      B.copy(sub.lampAt).applyMatrix4(sub.group.matrixWorld);
      G.lampPos.value.copy(B);
      G.lampDir.value.copy(F).addScaledVector(R, st.aimX * 0.45).addScaledVector(U, st.aimY * 0.35).normalize();
      G.lampCol.value.set(1.0 * 2.6 * on, 0.92 * 2.6 * on, 0.78 * 2.6 * on, 0.8);
      sub.lamp.value = on;
      st.placed = true;
    },
  };
  return cast;
}
