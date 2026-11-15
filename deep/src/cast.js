// The cast: Snap and his submarine, where they are at each point of the dive, and the
// visitor's lamp. Snap leads the way down: he swims a few metres ahead of the camera, to
// the right of the words on a wide screen and above them on a phone, and keeps turning to
// look at the visitor. At the reef's end the submarine comes for him; from the wreck on he
// rides in its glass bubble, and its lamp is the visitor's light in the dark.
import { Quaternion, Vector3 } from 'three/webgpu';
import { clamp, smooth } from './math.js';
import { G } from './shaders.js';
import { Snap } from './snap.js';
import { buildSub } from './sub.js';

// Where they sit in the camera's view: metres forward, right, up. A wide window keeps the
// left for the words; a tall one keeps the bottom for them.
const SLOT = {
  wide: { snap: [2.8, 1.05, -0.28], sub: [4.3, 1.3, -0.35] },
  tall: { snap: [3.3, 0.0, 0.55], sub: [4.7, 0.0, 0.7] },
};
// The story's beats along p: the submarine comes, Snap gets in.
const SUB_COMES = [3.82, 4.08], SNAP_BOARDS = [4.08, 4.26];

const R = new Vector3(), U = new Vector3(), F = new Vector3(), A = new Vector3(), B = new Vector3(), C = new Vector3();
const UP = new Vector3(0, 1, 0), M = new Vector3(), Z = new Vector3(0, 0, 1);
const qa = new Quaternion(), qb = new Quaternion();

export function buildCast(ctx) {
  const { scene, camera, q } = ctx;
  const snap = new Snap(), sub = buildSub(q);
  scene.add(snap.group, sub.group);
  const loading = snap.load(Math.max(innerWidth, innerHeight) * (devicePixelRatio || 1) < 1400).catch((e) => console.warn('dive: Snap did not load: ' + e.message));
  const st = {
    pos: new Vector3(), last: new Vector3(), subPos: new Vector3(), placed: false,
    aimX: 0, aimY: 0, idle: 0, lastP: -1, wave: 0, poked: -1e9, t: 0,
  };
  const ndc = new Vector3();
  const slot = (o, out) => out.copy(camera.position).addScaledVector(F, o[0]).addScaledVector(R, o[1]).addScaledVector(U, o[2]);

  const cast = {
    snap, sub, loading,
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

      // ---- the submarine: comes in from ahead and to the side, then stays in its place
      const come = smooth(SUB_COMES[0], SUB_COMES[1], p);
      slot(o.sub, A);
      B.copy(A).addScaledVector(F, 9).addScaledVector(R, -4).addScaledVector(UP, 1.5);
      A.lerp(B, 1 - come);
      A.y += Math.sin(t * 0.9) * 0.06;
      follow(st.subPos, A, 3);
      sub.group.visible = come > 0.001;
      sub.group.position.copy(st.subPos);
      // its nose points across the view, a little toward the visitor, so the bubble shows;
      // level, with a little pitch where the dive goes up or down
      C.copy(R).multiplyScalar(-0.85).addScaledVector(F, -0.5);
      C.y = 0; C.normalize();
      sub.group.quaternion.setFromUnitVectors(Z, C.negate());
      qa.setFromAxisAngle(R, clamp(F.y, -0.6, 0.6) * 0.35 + Math.sin(t * 0.7) * 0.03);
      sub.group.quaternion.premultiply(qa);
      sub.group.updateMatrixWorld(true);
      sub.turn(dt, come);

      // ---- Snap: swimming in his place, then into the bubble
      slot(o.snap, A);
      A.y += Math.sin(t * 1.3) * 0.05;
      const board = smooth(SNAP_BOARDS[0], SNAP_BOARDS[1], p);
      if (board > 0) {
        B.copy(sub.seat).applyMatrix4(sub.group.matrixWorld);
        A.lerp(B, board);
        A.y += Math.sin(board * Math.PI) * 0.35;           // a little hop up and in
      }
      if (board >= 1) A.copy(B);
      st.last.copy(st.pos);
      follow(st.pos, A, board >= 1 ? 30 : 4.5);
      snap.group.position.copy(st.pos);
      // how he moves: paddling harder the faster he goes, leaning into it
      const speed = dt > 0 ? M.copy(st.pos).sub(st.last).length() / dt : 0;
      const inSub = board >= 1;
      snap.life.kick = inSub ? 0 : clamp(0.25 + speed * 0.5, 0, 1);
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
      // he turns to face the visitor, his body a little toward where he goes
      C.copy(camera.position).sub(st.pos);
      C.y *= 0.3; C.normalize();
      qa.setFromUnitVectors(Z, C);
      qb.setFromAxisAngle(UP, -0.35 + snap.life.swing * 0.15);
      snap.group.quaternion.copy(qa).multiply(qb);
      snap.target.copy(camera.position);
      snap.U.cabin.value = inSub ? 0.16 * smooth(40, 90, depth) : 0;
      snap.live(t, dt);

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
