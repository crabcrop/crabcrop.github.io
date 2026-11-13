import * as THREE from 'three';
import { media, loadPicture } from '../media';
import { imageTexture, type Stage } from './stage';
import { LOOK, LOOK_GLSL } from './look';

const VERT = /* glsl */ `
uniform float uTime, uPhase, uMouseOn;
uniform vec2 uMouse;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  float h = uv.y;                                   // 0 at the root, 1 at the tip
  w.x += sin(uTime * 0.55 + uPhase + h * 1.7) * 26.0 * h * h;
  // Bend away from the cursor, more towards the tip.
  float dx = w.x - uMouse.x, dy = -w.y - uMouse.y;
  float near = exp(-(dx * dx + dy * dy) / (2.0 * 240.0 * 240.0)) * uMouseOn;
  w.x += sign(dx) * near * 110.0 * h * h;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uOpacity;
varying vec2 vUv;
${LOOK_GLSL}
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.01) discard;
  // Foreground: a touch darker and bluer, like it is nearer the camera in the water.
  vec3 col = mix(c.rgb * 0.78, vec3(0.05, 0.2, 0.2), 0.18);
  gl_FragColor = vec4(applyLook(col), c.a * uOpacity);
}`;

/** Knitted kelp stalks in the foreground of the forest, and a clump of them at its edge that passes the camera on the way in. */
export class Kelp {
  private stalks: THREE.Mesh[] = [];
  private edge: THREE.Mesh[] = [];
  private eu: Record<string, THREE.IUniform>;
  private u: Record<string, THREE.IUniform>;
  private ready = false;

  constructor(stage: Stage, private phone: boolean) {
    this.u = {
      uMap: { value: null }, uOpacity: { value: 0 }, uTime: { value: 0 }, uPhase: { value: 0 },
      uMouseOn: { value: 0 }, uMouse: { value: new THREE.Vector2(-1e4, -1e4) }, ...LOOK,
    };
    const geo = new THREE.PlaneGeometry(1, 1, 1, 24);
    geo.translate(0, 0.5, 0);
    for (let i = 0; i < (phone ? 1 : 2); i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false,
        uniforms: { ...this.u, uPhase: { value: i * 2.1 } },
      });
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 8;
      m.frustumCulled = false;
      m.visible = false;
      this.stalks.push(m);
      stage.scene.add(m);
    }
    // The forest's edge: always fully there while it passes, whatever the forest's own layers are doing.
    this.eu = { ...this.u, uOpacity: { value: 1 } };
    for (let i = 0; i < (phone ? 2 : 3); i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false,
        uniforms: { ...this.eu, uPhase: { value: 0.9 + i * 1.7 } },
      });
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 9;
      m.frustumCulled = false;
      m.visible = false;
      this.edge.push(m);
      stage.scene.add(m);
    }
  }

  async load() {
    this.u.uMap.value = imageTexture(await loadPicture('kelp'));
    this.ready = true;
  }

  /** edge: where the forest's edge is across the screen (px) while the camera passes it, else null. */
  update(t: number, o: { vis: number; w: number; h: number; mouse: [number, number] | null; edge?: number | null }) {
    const on = this.ready && o.vis > 0.01;
    this.u.uOpacity.value = o.vis;
    this.u.uTime.value = t;
    this.u.uMouseOn.value = o.mouse ? 1 : 0;
    if (o.mouse) this.u.uMouse.value.set(o.mouse[0], o.mouse[1]);
    const k = media.kelp;
    const h = o.h * (this.phone ? 1.05 : 1.3), w = h * (k.w / k.h);
    const par = o.mouse ? (o.mouse[0] / o.w - 0.5) * -26 : 0;
    this.stalks.forEach((m, i) => {
      m.visible = on;
      const right = this.phone || i === 1;
      const x = right ? o.w + w * 0.08 + par : -w * 0.08 + par;
      m.position.set(x, -(o.h * 1.12), 0);
      m.scale.set(right ? -w : w, h, 1);
    });
    // The edge of the forest: stalks side by side, wide enough to hide where the two places meet.
    const ex = o.edge ?? null;
    const spread = this.phone ? [-0.13, 0.16] : [-0.11, 0.02, 0.13];
    const tall = this.phone ? [1.2, 1.32] : [1.42, 1.6, 1.36];
    this.edge.forEach((m, i) => {
      const x = ex === null ? 0 : ex + spread[i] * (this.phone ? o.w * 1.6 : o.w);
      const eh = o.h * tall[i], ew = eh * (k.w / k.h);
      m.visible = this.ready && ex !== null && x > -ew && x < o.w + ew;
      if (!m.visible) return;
      m.position.set(x, -(o.h * 1.14), 0);
      m.scale.set(i % 2 ? -ew : ew, eh, 1);
    });
  }
}
