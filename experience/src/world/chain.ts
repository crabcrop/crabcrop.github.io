import * as THREE from 'three';
import type { Stage } from './stage';

const MAX_LINKS = 240;

export interface Hold { i: number; x: number; y: number }

/**
 * The anchor chain: a rope simulated with Verlet integration, drawn as iron
 * links with a coral-orange rust patina. The top end hangs from an anchor
 * point. Snap holds it at two points (the top and bottom of the stretch of
 * chain painted into his sprite), and no links are drawn between them. Links
 * are laid along the rope by arc length, so when the anchor moves away the
 * chain pays out past Snap and he appears to ride it down.
 */
export class Chain {
  readonly n = 72;
  private p = new Float32Array(this.n * 2);
  private q = new Float32Array(this.n * 2);
  private rest = new Float32Array(this.n);
  readonly arc = new Float32Array(this.n);
  readonly mesh: THREE.InstancedMesh;
  private dummy = new THREE.Object3D();
  private light: THREE.DirectionalLight;
  private amb: THREE.HemisphereLight;
  private started = false;
  private holds: Hold[] = [];
  linkLen = 30;
  /** Shifts the links along the rope; driven by the plunge so Snap rides down. */
  slide = 0;

  constructor(stage: Stage) {
    const geo = new THREE.TorusGeometry(1, 0.36, 8, 22);
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, metalness: 0.5 });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_LINKS);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.count = 0;
    const c = new THREE.Color();
    const tones = ['#6b3a28', '#7d4632', '#8a4a2c', '#a2471d', '#5e3426', '#74402c'];
    for (let i = 0; i < MAX_LINKS; i++) {
      c.set(tones[(i * 7 + (i >> 2)) % tones.length]);
      this.mesh.setColorAt(i, c);
    }
    stage.scene.add(this.mesh);
    this.amb = new THREE.HemisphereLight('#fff4e0', '#3a5a60', 1.5);
    this.light = new THREE.DirectionalLight('#fff1dd', 3.2);
    this.light.position.set(-0.55, 0.85, 1);
    stage.scene.add(this.amb, this.light);
  }

  /** Light the iron for the zone: warm at the surface, teal under water. */
  setWater(t: number) {
    this.amb.color.set('#fff4e0').lerp(new THREE.Color('#bfeff0'), t);
    this.light.color.set('#fff1dd').lerp(new THREE.Color('#d8fbf6'), t);
    this.light.intensity = 3.2 - 0.9 * t;
  }

  private init(ax: number, ay: number, len: number) {
    for (let i = 0; i < this.n; i++) {
      this.p[i * 2] = this.q[i * 2] = ax;
      this.p[i * 2 + 1] = this.q[i * 2 + 1] = ay + (len * i) / (this.n - 1);
    }
    this.started = true;
  }

  /** Position and angle on the rope at arc length s from the anchor. */
  at(s: number): { x: number; y: number; a: number } {
    const n = this.n, p = this.p, arc = this.arc;
    s = Math.max(0, Math.min(arc[n - 1], s));
    let i = 1;
    while (i < n - 1 && arc[i] < s) i++;
    const a0 = arc[i - 1], a1 = arc[i];
    const t = a1 > a0 ? (s - a0) / (a1 - a0) : 0;
    const x0 = p[i * 2 - 2], y0 = p[i * 2 - 1], x1 = p[i * 2], y1 = p[i * 2 + 1];
    return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, a: Math.atan2(x1 - x0, y1 - y0) };
  }

  /** Rope x at a screen y, for the threads to the cards. */
  xAt(y: number) {
    for (let i = 1; i < this.n; i++) {
      const y0 = this.p[i * 2 - 1], y1 = this.p[i * 2 + 1];
      if ((y0 - y) * (y1 - y) <= 0 && y0 !== y1) {
        const t = (y - y0) / (y1 - y0);
        return this.p[i * 2 - 2] + (this.p[i * 2] - this.p[i * 2 - 2]) * t;
      }
    }
    return null;
  }

  get pitch() { return this.linkLen * 0.72; }
  /** Give the rope a shove between two points (a catch, a leap away). */
  kick(i0: number, i1: number, dx: number, dy: number) {
    for (let i = Math.max(1, i0); i <= Math.min(this.n - 1, i1); i++) {
      const f = Math.sin(((i - i0) / Math.max(1, i1 - i0)) * Math.PI);
      this.q[i * 2] -= dx * f;
      this.q[i * 2 + 1] -= dy * f;
    }
  }
  holdArc(k: number) { const h = this.holds[k]; return h ? this.arc[h.i] : null; }
  /** Arc length of link k, counted from Snap's top hold (negative is above him). */
  linkArc(k: number) { const h = this.holds[0]; return (h ? this.arc[h.i] : 0) + k * this.pitch; }

  /** Lay the rope out cleanly (no velocity) for the current anchor and holds. */
  private relay(o: { ax: number; ay: number; holds: Hold[] }) {
    const n = this.n, p = this.p, q = this.q, rest = this.rest;
    let x = o.ax, y = o.ay, from = 0;
    for (const h of o.holds) {
      for (let i = from; i <= h.i; i++) {
        const f = (i - from) / Math.max(1, h.i - from);
        p[i * 2] = x + (h.x - x) * f; p[i * 2 + 1] = y + (h.y - y) * f;
      }
      x = h.x; y = h.y; from = h.i;
    }
    for (let i = from + 1; i < n; i++) { p[i * 2] = x; p[i * 2 + 1] = y + rest[i] * (i - from); }
    q.set(p);
  }

  update(dt: number, t: number, o: {
    ax: number; ay: number; len: number; tail: number; holds: Hold[];
    sway: number; mouse: [number, number] | null; visible: boolean; linkLen: number;
    /** Rope length above the top hold, as a share of the straight distance: a little over 1 hangs loose, under 1 pulls taut. */
    slack?: number;
  }) {
    this.mesh.visible = o.visible;
    this.linkLen = o.linkLen;
    const grabbed = this.holds.length !== o.holds.length;
    this.holds = o.holds;
    if (!this.started) this.init(o.ax, o.ay, o.len);
    const n = this.n, p = this.p, q = this.q, rest = this.rest;
    const [h0, h1] = o.holds;
    if (h0) {
      const above = Math.max(Math.hypot(h0.x - o.ax, h0.y - o.ay) * (o.slack ?? 1.002), 30) / h0.i;
      const last = h1 ?? h0;
      const between = h1 ? Math.hypot(h1.x - h0.x, h1.y - h0.y) / (h1.i - h0.i) : 0;
      const below = o.tail / (n - 1 - last.i);
      for (let i = 1; i < n; i++) rest[i] = i <= h0.i ? above : i <= last.i ? between : below;
    } else {
      for (let i = 1; i < n; i++) rest[i] = o.len / (n - 1);
    }
    // Snap just grabbed or let go: re-lay the rope instead of yanking it.
    if (grabbed) this.relay(o);
    const pinned = (i: number) => i === 0 || o.holds.some((h) => h.i === i);
    const step = Math.min(dt, 1 / 30);
    const g = 1500 * step * step;
    for (let i = 1; i < n; i++) {
      if (pinned(i)) continue;
      const x = p[i * 2], y = p[i * 2 + 1];
      let vx = (x - q[i * 2]) * 0.972, vy = (y - q[i * 2 + 1]) * 0.972;
      const sway = Math.max(-40, Math.min(40, o.sway));
      vx += (Math.sin(t * 0.7 + y * 0.004) * 0.04 + sway * 0.0006) * (i / n);
      if (o.mouse) {
        const mx = x - o.mouse[0], my = y - o.mouse[1];
        const d2 = mx * mx + my * my;
        if (d2 < 10000) vx += (mx / Math.sqrt(d2 + 1)) * 0.8;
      }
      q[i * 2] = x; q[i * 2 + 1] = y;
      p[i * 2] = x + vx;
      // Above Snap's hold the rope is weightless: its weight would stretch the
      // long run from the surface and pile the spare length up in a loop just
      // above his claw.
      p[i * 2 + 1] = y + vy + (h0 && i < h0.i ? 0 : g);
    }
    const pin = () => {
      p[0] = o.ax; p[1] = o.ay;
      for (const h of o.holds) { p[h.i * 2] = h.x; p[h.i * 2 + 1] = h.y; q[h.i * 2] = h.x; q[h.i * 2 + 1] = h.y; }
    };
    const link = (i: number) => {
      const pa = pinned(i - 1), pb = pinned(i);
      if (pa && pb) return;
      const dx = p[i * 2] - p[i * 2 - 2], dy = p[i * 2 + 1] - p[i * 2 - 1];
      const d = Math.hypot(dx, dy) || 1e-6;
      const diff = (d - rest[i]) / d;
      const wa = pa ? 0 : pb ? 1 : 0.5, wb = pb ? 0 : pa ? 1 : 0.5;
      p[i * 2 - 2] += dx * diff * wa; p[i * 2 - 1] += dy * diff * wa;
      p[i * 2] -= dx * diff * wb; p[i * 2 + 1] -= dy * diff * wb;
    };
    // A chain does not fold back on itself: points two apart keep at least
    // 1.6 links' length between them (no bend sharper than about 75 degrees),
    // which also undoes a fold left by a sudden jolt at a hold.
    const unfold = (i: number) => {
      const pa = pinned(i - 2), pb = pinned(i);
      if (pa && pb) return;
      const dx = p[i * 2] - p[i * 2 - 4], dy = p[i * 2 + 1] - p[i * 2 - 3];
      const d = Math.hypot(dx, dy) || 1e-6;
      const min = 0.8 * (rest[i] + rest[i - 1]);
      if (d >= min) return;
      const diff = (d - min) / d;
      const wa = pa ? 0 : pb ? 1 : 0.5, wb = pb ? 0 : pa ? 1 : 0.5;
      p[i * 2 - 4] += dx * diff * wa; p[i * 2 - 3] += dy * diff * wa;
      p[i * 2] -= dx * diff * wb; p[i * 2 + 1] -= dy * diff * wb;
    };
    // Sweep down from the anchor and back up from the holds in turn, so
    // corrections reach both ends and a long stretch does not sag under its weight.
    for (let k = 0; k < 24; k++) {
      pin();
      if (k & 1) for (let i = n - 1; i >= 1; i--) link(i);
      else for (let i = 1; i < n; i++) link(i);
      for (let i = 2; i < n; i++) unfold(i);
    }
    pin();
    // Pulled taut (Snap towing it across the reef), the rope above his hold is
    // a straight line with a slow sway, not a sagging simulation.
    if (h0 && (o.slack ?? 1) < 1) {
      for (let i = 1; i < h0.i; i++) {
        const f = i / h0.i;
        const sway = Math.sin(t * 0.9 + f * 3) * 6 * Math.sin(Math.PI * f);
        p[i * 2] = q[i * 2] = o.ax + (h0.x - o.ax) * f + sway;
        p[i * 2 + 1] = q[i * 2 + 1] = o.ay + (h0.y - o.ay) * f;
      }
    }
    this.draw();
  }

  /** Lay links along the rope by arc length, alternating face-on and edge-on. */
  private draw() {
    const n = this.n, p = this.p, arc = this.arc;
    arc[0] = 0;
    for (let i = 1; i < n; i++) arc[i] = arc[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
    const total = arc[n - 1];
    const L = this.linkLen, pitch = this.pitch;
    const sx = (L * 0.6) / 2.72, sy = L / 2.72;
    // Hidden where Snap's film (or sprite) has the chain in his claws. The
    // links nearest each hold still show, half a link into that stretch, so
    // they always reach the ends of the painted chain and leave no gap.
    const [h0, h1] = this.holds;
    const hideA = h0 && h1 ? arc[h0.i] + pitch * 0.5 : 1e9;
    const hideB = h0 && h1 ? arc[h1.i] - pitch * 0.5 : -1e9;
    // Count links from Snap's top hold when there is one, so the links next
    // to him stay put while the chain pays out above.
    const origin = (h0 ? arc[h0.i] : 0) + this.slide;
    const first = origin - Math.floor(origin / pitch) * pitch;
    let count = 0;
    for (let s = first, k = -Math.floor(origin / pitch); s < total && count < MAX_LINKS; s += pitch, k++) {
      if (s > hideA && s < hideB) continue;
      const { x, y, a } = this.at(s);
      const d = this.dummy;
      d.position.set(x, -y, 0);
      d.rotation.set(0, 0, 0);
      d.rotateZ(a);
      if (k & 1) d.rotateY(Math.PI / 2);
      d.scale.set(sx, sy, sx);
      d.updateMatrix();
      this.mesh.setMatrixAt(count++, d.matrix);
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
