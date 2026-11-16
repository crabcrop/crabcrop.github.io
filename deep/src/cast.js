// The cast: Snap and his submarine, where they are at each point of the dive, and the
// visitor's lamp. Snap leads the way down: he swims a few metres ahead of the camera, to
// the right of the words on a wide screen and above them on a phone, and keeps turning to
// look at the visitor (into the wreck's cabin too, where the camera follows him). As they
// leave the wreck the submarine comes for him; from the drop-off on he rides in its glass
// bubble, and its lamp is the visitor's light in the dark.
import { Mesh, PlaneGeometry, Quaternion, Vector3 } from 'three/webgpu';
import { faceDirection, float, select, texture, uv, vec3 } from 'three/tsl';
import { feltPrint } from './feltprint.js';
import { groundY } from './layout.js';
import { clamp, smooth } from './math.js';
import { G, material } from './shaders.js';
import { Snap } from './snap.js';
import { buildSub } from './sub.js';

// Where they sit in the camera's view: metres forward, right, up. A wide window keeps the
// left for the words; a tall one keeps the bottom for them.
const SLOT = {
  wide: { snap: [2.8, 1.05, -0.28], sub: [4.3, 1.3, -0.35] },
  tall: { snap: [3.3, 0.0, 0.55], sub: [4.7, 0.0, 0.7] },
};
// The story's beats along p: Snap rides the anchor chain down from the boat and lets go
// over the shallows; past the wreck the submarine comes; Snap gets in before the drop.
const CHAIN_LEAVES = [1.18, 1.42], SUB_COMES = [4.74, 4.92], SNAP_BOARDS = [4.92, 5.06];
// The opening: he treads water at the waterline in his place, his photo print held up out of
// the water; a gust snatches it, it flies and falls in ahead and sinks, leading the way down;
// he hops and dives after it.
const GUST = [0.035, 0.15], DIVE = [0.075, 0.2], PRINT_GONE = 1.55;

const R = new Vector3(), U = new Vector3(), F = new Vector3(), A = new Vector3(), B = new Vector3(), C = new Vector3();
const UP = new Vector3(0, 1, 0), M = new Vector3(), Z = new Vector3(0, 0, 1);
const qa = new Quaternion(), qb = new Quaternion();
const ON = [0, 0, 0, 0, 0, 0], GRIP = new Vector3(), ALONG = new Vector3(), MID = new Vector3();
const HELD = new Vector3(), UP3 = new Vector3(), SNAP_AT = [0, 0, 0];
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
    pos: new Vector3(), last: new Vector3(), subPos: new Vector3(), placed: false,
    aimX: 0, aimY: 0, idle: 0, lastP: -1, wave: 0, poked: -1e9, t: 0, s: -1, flyFrom: false,
  };
  const ndc = new Vector3();
  const slot = (o, out) => out.copy(camera.position).addScaledVector(F, o[0]).addScaledVector(R, o[1]).addScaledVector(U, o[2]);

  // The point of the chain nearest a place: the chain's s (0 at the boat, 1 at the anchor).
  const nearestOnChain = (want) => {
    let best = 0, bd = 1e9;
    for (let i = 0; i <= 40; i++) {
      cast.chainAt(i / 40, ON);
      const d = (ON[0] - want.x) ** 2 + (ON[1] - want.y) ** 2 + (ON[2] - want.z) ** 2;
      if (d < bd) { bd = d; best = i / 40; }
    }
    return [best, Math.sqrt(bd)];
  };

  const cast = {
    snap, sub, loading,
    chainAt: null,                 // set when the chain exists: chainAt(s, out) writes x, y, z and its direction
    // things worth a look on the way: { from, to, at } (p range, a Vector3); he glances at
    // one while the camera passes it, and back at the visitor between glances
    sights: [],
    // the pointer steers the lamp: x and y from -1 to 1
    aim(x, y) { st.aimX = x; st.aimY = y; },
    // a tap or click at (x, y) in -1..1 (y up): if it is on Snap, he reacts. Returns whether it was.
    poke(x, y) {
      if (!snap.ready) return false;
      ndc.copy(snap.group.position).project(camera);
      const d = camera.position.distanceTo(snap.group.position);
      const r = (snap.height * 0.75) / (d * Math.tan((camera.fov * Math.PI) / 360));
      if (ndc.z > 1 || Math.hypot((x - ndc.x) * camera.aspect, y - ndc.y) > r) return false;
      st.poked = st.t;
      return true;
    },
    update(t, dt, p) {
      const e = camera.matrixWorld.elements;
      R.set(e[0], e[1], e[2]); U.set(e[4], e[5], e[6]); F.set(-e[8], -e[9], -e[10]);
      const o = camera.aspect < 1 ? SLOT.tall : SLOT.wide;
      const depth = -camera.position.y;
      const jump = dt <= 0 || !st.placed;
      const follow = (cur, want, rate) => { if (jump || cur.distanceToSquared(want) > 64) cur.copy(want); else cur.lerp(want, 1 - Math.exp(-dt * rate)); };

      // ---- the submarine: comes down from ahead and to the right (away from the wreck, which
      // is on the left), then stays in its place
      const come = smooth(SUB_COMES[0], SUB_COMES[1], p);
      slot(o.sub, A);
      B.copy(A).addScaledVector(F, 3).addScaledVector(R, 7).addScaledVector(UP, 3);
      A.lerp(B, 1 - come);
      A.y += Math.sin(t * 0.9) * 0.06;
      A.y = Math.max(A.y, groundY(A.x, A.z) + 0.95);        // (never in the ground)
      A.y = Math.min(A.y, -1.0);                             // (nor through the surface: it would be cut by it)
      follow(st.subPos, A, 3);
      sub.group.visible = come > 0.001;
      sub.group.position.copy(st.subPos);
      G.subAt.value.set(st.subPos.x, sub.group.visible ? st.subPos.y : -1000, st.subPos.z, 1.3);
      // its nose points across the view, a little toward the visitor, so the bubble shows;
      // level, with a little pitch where the dive goes up or down
      C.copy(R).multiplyScalar(-0.85).addScaledVector(F, -0.5);
      C.y = 0; C.normalize();
      sub.group.quaternion.setFromUnitVectors(Z, C.negate());
      qa.setFromAxisAngle(R, clamp(F.y, -0.6, 0.6) * 0.35 + Math.sin(t * 0.7) * 0.03);
      sub.group.quaternion.premultiply(qa);
      sub.group.updateMatrixWorld(true);
      sub.turn(dt, come);

      // ---- Snap: swimming in his place, then into the bubble. In the wreck's cabin he comes
      // closer to the camera (the room is small: the desk is three metres off)
      const cabin = smooth(4.49, 4.55, p) * (1 - smooth(4.63, 4.69, p));
      M.set(o.snap[0] * (1 - 0.32 * cabin), o.snap[1], o.snap[2]);
      slot(M.toArray(SNAP_AT), A);
      A.y += Math.sin(t * 1.3) * 0.05;
      A.y = Math.max(A.y, groundY(A.x, A.z) + 0.45);
      const board = smooth(SNAP_BOARDS[0], SNAP_BOARDS[1], p);
      if (board > 0) {
        // in through the front of the bubble: first to just before the glass, then into his
        // seat (never over the top, where the hull's rings are)
        B.copy(sub.seat).applyMatrix4(sub.group.matrixWorld);
        HELD.copy(sub.seat); HELD.z -= 0.95; HELD.applyMatrix4(sub.group.matrixWorld);
        const a1 = smooth(0, 0.6, board), a2 = smooth(0.55, 1, board);
        A.lerp(HELD, a1).lerp(B, a2);
      }
      if (board >= 1) A.copy(B);
      // on the chain: he holds it at the point nearest where he would be, and slides along
      // it as the camera goes down; then lets go and swims to his place
      const onChain = cast.chainAt ? 1 - smooth(CHAIN_LEAVES[0], CHAIN_LEAVES[1], p) : 0;
      let hang = false;
      if (onChain > 0) {
        const [s0, gap] = nearestOnChain(A);
        if (gap < 8) {
          st.s = jump || st.s < 0 ? s0 : st.s + (s0 - st.s) * (1 - Math.exp(-dt * 3));
          cast.chainAt(st.s, ON);
          GRIP.set(ON[0], ON[1], ON[2]);
          ALONG.set(ON[3], ON[4], ON[5]).normalize();
          if (ALONG.y < 0) ALONG.negate();            // his up runs up the chain, toward the boat
          // the grip is in his raised claw: his middle hangs below and in front of it
          MID.copy(snap.centreFromGrip ?? Z).multiplyScalar(snap.height);
          hang = onChain > 0.5;
          B.copy(GRIP);
          A.lerp(B, onChain);
        }
      }
      // the opening: treading water, his middle just under the waterline and bobbing with the
      // swell, so the print in his raised claw is out of the water; then a hop and a dive
      const dive = smooth(DIVE[0], DIVE[1], p);
      if (dive < 1) {
        const atTop = -0.04 + Math.sin(t * 1.1) * 0.025 + Math.sin(t * 1.7 + 1) * 0.012;
        A.y = atTop + (A.y - atTop) * dive + Math.sin(dive * Math.PI) * 0.32;
        hang = false;
      }
      st.last.copy(st.pos);
      follow(st.pos, A, board >= 1 || dive < 0.5 ? 30 : dive < 1 ? 12 : hang ? 12 : 4.5);
      snap.group.position.copy(st.pos);
      G.snapAt.value.set(st.pos.x, st.pos.y, st.pos.z, 0.45);
      // how he moves: paddling harder the faster he goes, leaning into it
      const speed = dt > 0 ? M.copy(st.pos).sub(st.last).length() / dt : 0;
      const inSub = board >= 1;
      snap.life.kick = inSub ? 0 : dive < 1 ? 0.15 + 0.85 * Math.sin(dive * Math.PI) : clamp(0.25 + speed * 0.5, 0, 1);
      snap.life.planted = inSub ? 1 : 0;
      snap.life.swing = dt > 0 ? clamp(M.copy(st.pos).sub(st.last).dot(R) / dt, -2, 2) * 0.5 : 0;
      // when the visitor stops scrolling for a while, he waves; at the surface he waves goodbye
      st.idle = Math.abs(p - st.lastP) < 1e-4 ? st.idle + dt : 0;
      st.lastP = p;
      const waveNow = (st.idle > 3 && st.idle < 5.5) || p > 7.85 ? 1 : 0;
      st.wave += (waveNow - st.wave) * Math.min(1, dt * 4);
      // poked: a start, a snap of the pincer, and a wave of the free claw
      st.t = t;
      const since = t - st.poked, pk = since >= 0 && since < 1.6 ? since / 1.6 : 0;
      snap.life.surprise = pk ? Math.max(0, 1 - pk * 3) : 0;
      snap.life.snap = pk ? Math.min(1, pk * 1.6) : 0;
      snap.life.wave = pk ? Math.sin(pk * Math.PI) : 0;
      snap.life.hello = st.wave;
      snap.life.squint = Math.max(st.wave * 0.8, pk > 0.4 ? Math.sin((pk - 0.4) / 0.6 * Math.PI) : 0);
      // the gust: a start as the print goes
      if (p > GUST[0] && p < GUST[0] + 0.08) snap.life.surprise = Math.max(snap.life.surprise, Math.sin(((p - GUST[0]) / 0.08) * Math.PI));
      // he turns to face the visitor, his body a little toward where he goes; on the chain,
      // his up runs along it
      C.copy(camera.position).sub(st.pos);
      C.y *= 0.3; C.normalize();
      qa.setFromUnitVectors(Z, C);
      qb.setFromAxisAngle(UP, -0.35 + snap.life.swing * 0.15);
      snap.group.quaternion.copy(qa).multiply(qb);
      if (hang) {
        qa.setFromUnitVectors(UP, ALONG);
        snap.group.quaternion.premultiply(qa);
        // hold the chain with the raised claw: move him so that claw sits on it
        snap.group.updateMatrixWorld(true);
        snap.gripWorld(B);
        st.pos.sub(B).add(GRIP);
        snap.group.position.copy(st.pos);
        snap.life.kick = 0.12;
      }
      snap.target.copy(camera.position);
      for (let i = 0; i < cast.sights.length; i++) {
        const g = cast.sights[i];
        if (p > g.from && p < g.to && Math.sin(t * 0.7 + i) > -0.2) { snap.target.copy(g.at); break; }
      }
      snap.U.cabin.value = inSub ? 0.16 * smooth(40, 90, depth) : 0;
      snap.live(t, dt);

      // ---- his print: held up in his raised claw; snatched by the gust, it flies up and falls
      // in a few metres beyond him, then sinks ahead of the camera, tumbling, down past the anchor
      print.mesh.visible = snap.ready && p < PRINT_GONE;
      if (print.mesh.visible) {
        snap.gripWorld(HELD);
        HELD.y += 0.13;
        const g = clamp((p - GUST[0]) / (GUST[1] - GUST[0]), 0, 1), sink = clamp((p - GUST[1]) / (PRINT_GONE - GUST[1]), 0, 1);
        if (g <= 0) { print.mesh.position.copy(HELD); FLY[0].copy(HELD); st.flyFrom = true; }
        else {
          // (from where it was snatched; if the dive starts past that, from about there)
          if (!st.flyFrom) { slot(o.snap, FLY[0]); FLY[0].y = 0.3; st.flyFrom = true; }
          FLY[1].copy(FLY[0]).add(UP3.set(-0.7, 1.5, -1.3));
          FLY[2].set(FLY[0].x - 1.3, 0.02, FLY[0].z - 3.4);
          if (sink <= 0) bez(print.mesh.position, FLY[0], FLY[1], FLY[2], g * g * (1.6 - 0.6 * g));
          else {
            // sinking: ahead and down, rocking side to side as paper does
            const u = Math.pow(sink, 0.85);
            print.mesh.position.set(
              FLY[2].x + (4.6 - FLY[2].x) * u + Math.sin(sink * 19) * 0.35 * (1 - u),
              FLY[2].y + (groundY(4.6, -34) + 0.4 - FLY[2].y) * u,
              FLY[2].z + (-34 - FLY[2].z) * u);
          }
        }
        print.mesh.lookAt(camera.position);
        qt.setFromAxisAngle(TUMBLE, g * 8.5 + sink * 14 + (g > 0 ? Math.sin(t * 2.3) * 0.25 : Math.sin(t * 1.4) * 0.08));
        print.mesh.quaternion.multiply(qt);
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
