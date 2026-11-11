import * as THREE from 'three';
import { media, loadPicture } from '../media';
import { imageTexture, type Stage } from './stage';
import { LOOK, LOOK_GLSL } from './look';
import { clamp } from '../scroll';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// The octopus: its curled tentacle tips wave; it is hidden below uClipY (behind the chest it peeks over).
const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uOpacity, uTime, uWave, uClipY;
uniform vec3 uGrade;
varying vec2 vUv;
${LOOK_GLSL}
void main() {
  if (gl_FragCoord.y < uClipY) discard;
  vec2 uv = vUv;
  float tips = 1.0 - smoothstep(0.08, 0.24, uv.y);
  uv.x += sin(uv.y * 26.0 - uTime * 4.2 + uv.x * 9.0) * 0.012 * tips * uWave;
  vec4 c = texture2D(uMap, uv);
  if (c.a < 0.01) discard;
  gl_FragColor = vec4(applyLook(c.rgb * uGrade), c.a * uOpacity);
}`;

// A blob of red sealing wax pressed with a crab: a wobbly rim, a sunken ring, a gloss.
const SEAL_FRAG = /* glsl */ `
precision highp float;
uniform float uA, uSeed;
uniform vec3 uGrade;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float ang = atan(p.y, p.x), r = length(p);
  float rim = 0.86 + 0.05 * sin(ang * 5.0 + uSeed) + 0.03 * sin(ang * 9.0 - uSeed * 2.0) + 0.025 * sin(ang * 14.0 + uSeed);
  float body = 1.0 - smoothstep(rim - 0.04, rim, r);
  if (body <= 0.0) discard;
  vec3 wax = vec3(0.70, 0.11, 0.09);
  // the stamp's face: a sunken disc with a raised ring and a little crab of three bumps
  float face = smoothstep(0.62, 0.58, r);
  float ring = smoothstep(0.5, 0.54, r) * smoothstep(0.62, 0.58, r);
  float crab = smoothstep(0.24, 0.2, length(p - vec2(0.0, -0.05))) + smoothstep(0.1, 0.07, length(p - vec2(-0.2, 0.2))) + smoothstep(0.1, 0.07, length(p - vec2(0.2, 0.2)));
  vec3 col = wax * (1.0 - 0.28 * face) + wax * 0.35 * (ring + clamp(crab, 0.0, 1.0)) * face;
  // light from the top left: gloss on the rim, shade at the bottom right
  float lit = dot(normalize(vec3(p * (r / rim), 0.6)), normalize(vec3(-0.5, 0.6, 0.6)));
  col *= 0.75 + 0.35 * lit;
  col += vec3(1.0, 0.8, 0.7) * 0.35 * smoothstep(0.75, 0.97, lit) * smoothstep(rim - 0.25, rim - 0.08, r);
  gl_FragColor = vec4(col * uGrade, body * uA);
}`;

type State = 'away' | 'peek' | 'swim' | 'wait' | 'sealed' | 'leave' | 'gone';

const PEEK = 1.1, SWIM = 1.5, HAPPY = 2.4, LEAVE = 2.2;
const easeInOut = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

/**
 * Snap's kindness in the wreck: a little octopus has a letter only its friend
 * should read. It climbs out from behind the captain's chest, brings the
 * letter to Snap, he snaps his claw and the wax seal goes on, and it swims
 * off happy.
 */
export class Octopus {
  state: State = 'away';
  private since = 0;
  private mesh: THREE.Mesh;
  private u: Record<string, THREE.IUniform>;
  private seal: THREE.Mesh;
  private su: Record<string, THREE.IUniform>;
  private ready = false;
  private p = { x: 0, y: 0, from: [0, 0] as [number, number], rot: 0 };
  /** The envelope's seal point on screen while it waits, for the "Seal the letter" button. */
  readonly at = { x: -999, y: -999, on: false };
  /** When the seal went on (the world shows the story then). */
  sealedAt = -10;

  constructor(stage: Stage) {
    this.u = { uMap: { value: null }, uOpacity: { value: 1 }, uTime: { value: 0 }, uWave: { value: 1 }, uClipY: { value: -1e5 }, uGrade: { value: new THREE.Vector3(1, 1, 1) }, ...LOOK };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, transparent: true, depthTest: false, depthWrite: false }));
    this.mesh.renderOrder = 6;
    this.su = { uA: { value: 0 }, uSeed: { value: Math.random() * 6 }, uGrade: { value: new THREE.Vector3(1, 1, 1) } };
    this.seal = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: SEAL_FRAG, uniforms: this.su, transparent: true, depthTest: false, depthWrite: false }));
    this.seal.renderOrder = 6;
    for (const m of [this.mesh, this.seal]) { m.visible = false; m.frustumCulled = false; stage.scene.add(m); }
  }

  async load() {
    this.u.uMap.value = imageTexture(await loadPicture('octopus'));
    this.ready = true;
  }

  /** Snap's pincer has shut on the letter. */
  stamp(t: number) {
    if (this.state !== 'wait') return;
    this.state = 'sealed';
    this.since = t;
    this.sealedAt = t;
  }

  reset() { this.state = 'away'; this.sealedAt = -10; }

  /**
   * vis: the cabin's visibility; go: time to come out; home: the chest's top
   * edge (centre x, y px), which it climbs over; meet: where the envelope's
   * seal should be, by Snap's pincer; size: its height, px. dpr turns the
   * chest's edge into the canvas pixels the clip works in.
   */
  update(dt: number, t: number, o: { vis: number; go: boolean; home: [number, number]; meet: [number, number]; size: number; grade: [number, number, number]; viewH: number; dpr: number }) {
    const on = this.ready && o.vis > 0.01 && this.state !== 'away' && this.state !== 'gone';
    if (this.ready && o.go && this.state === 'away') { this.state = 'peek'; this.since = t; }
    this.mesh.visible = on;
    this.seal.visible = on && (this.state === 'sealed' || this.state === 'leave');
    this.at.on = on && this.state === 'wait';
    if (!on) return;
    const h = o.size, w = h * (media.octopus.w / media.octopus.h);
    const [su, sv] = media.octopus.seal;
    // where its top-left goes so the seal point lands on a spot
    const placeFor = (sx: number, sy: number): [number, number] => [sx - su * w, sy - sv * h];
    const age = t - this.since;
    const p = this.p;
    let clip = -1e5, squash = 0, alpha = 1, wave = 1;
    const meet = placeFor(o.meet[0], o.meet[1]);
    if (this.state === 'peek') {
      // up from behind the chest, a little shy: a pause with only its eyes over the edge
      const k = clamp(age / PEEK);
      const rise = k < 0.45 ? easeInOut(k / 0.45) * 0.55 : 0.55 + easeInOut(clamp((k - 0.65) / 0.35)) * 0.45;
      p.x = o.home[0] - w / 2;
      p.y = o.home[1] - h * 0.95 * rise + h * 0.05;
      clip = (o.viewH - o.home[1]) * o.dpr;
      p.from = [p.x, p.y];
      if (k >= 1) { this.state = 'swim'; this.since = t; }
    } else if (this.state === 'swim') {
      // over to Snap in pulses, the way octopuses swim
      const k = clamp(age / SWIM);
      const e = easeInOut(k);
      const arc = Math.sin(Math.PI * e) * h * 0.6;
      p.x = p.from[0] + (meet[0] - p.from[0]) * e;
      p.y = p.from[1] + (meet[1] - p.from[1]) * e - arc;
      squash = Math.sin(age * 9) * 0.06 * (1 - k);
      if (k >= 1) { this.state = 'wait'; this.since = t; }
    } else if (this.state === 'wait') {
      p.x = meet[0] + Math.sin(t * 1.4) * h * 0.02;
      p.y = meet[1] + Math.sin(t * 2.1) * h * 0.03;
      squash = Math.sin(t * 2.1) * 0.02;
    } else if (this.state === 'sealed') {
      // a happy wiggle
      p.x = meet[0];
      p.y = meet[1] - Math.abs(Math.sin(age * 7)) * h * 0.06 * clamp(1 - age / HAPPY);
      p.rot = Math.sin(age * 10) * 0.07 * clamp(1 - age / HAPPY);
      wave = 2.2;
      if (age >= HAPPY) { this.state = 'leave'; this.since = t; p.from = [p.x, p.y]; }
    } else if (this.state === 'leave') {
      // off up and away into the dark, letter held tight
      const k = clamp(age / LEAVE);
      p.x = p.from[0] + k * k * h * 2.2;
      p.y = p.from[1] - easeInOut(k) * h * 2.6;
      p.rot = -0.15 * k;
      squash = Math.sin(age * 9) * 0.06;
      alpha = 1 - clamp((k - 0.55) / 0.45);
      if (k >= 1) { this.state = 'gone'; this.mesh.visible = this.seal.visible = false; this.at.on = false; return; }
    }
    const sw = w * (1 - squash), sh = h * (1 + squash);
    this.mesh.position.set(p.x + w / 2, -(p.y + h / 2), 0);
    this.mesh.scale.set(sw, sh, 1);
    this.mesh.rotation.z = -p.rot;
    this.u.uTime.value = t;
    this.u.uWave.value = wave;
    this.u.uClipY.value = clip;
    this.u.uOpacity.value = o.vis * alpha;
    this.u.uGrade.value.set(...o.grade);
    this.at.x = p.x + su * w;
    this.at.y = p.y + sv * h;

    // The seal: pressed on with a thump, then it rides on the envelope.
    if (this.seal.visible) {
      const sa = this.state === 'sealed' ? age : HAPPY;
      const press = clamp(sa / 0.18);
      const s = h * 0.15 * (1 + (1 - press) * 0.9) * (1 + 0.12 * Math.sin(clamp(sa / 0.5) * Math.PI) * press);
      // the seal point turns with the octopus
      const cx = p.x + w / 2, cy = p.y + h / 2;
      const dx = su * w - w / 2, dy = sv * h - h / 2;
      const c = Math.cos(p.rot), s2 = Math.sin(p.rot);
      this.seal.position.set(cx + dx * c - dy * s2, -(cy + dx * s2 + dy * c), 0);
      this.seal.scale.set(s, s, 1);
      this.seal.rotation.z = -p.rot - 0.2;
      this.su.uA.value = press * o.vis * alpha;
      this.su.uGrade.value.set(...o.grade);
    }
  }
}
