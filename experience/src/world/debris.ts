import * as THREE from 'three';
import { media, loadPicture } from '../media';
import { imageTexture, type Stage } from './stage';
import { LOOK, LOOK_GLSL } from './look';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uOpacity;
varying vec2 vUv;
${LOOK_GLSL}
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.01) discard;
  // Near the camera in the deep water: darker, bluer.
  vec3 col = mix(c.rgb * 0.48, vec3(0.02, 0.13, 0.16), 0.4);
  gl_FragColor = vec4(applyLook(col), c.a * uOpacity);
}`;

/**
 * A barnacled beam from the wreck, drifting up past the camera in the
 * foreground on the way down to the ship: it gives the descent depth.
 */
export class Debris {
  private mesh: THREE.Mesh;
  private u: Record<string, THREE.IUniform>;
  private ready = false;

  constructor(stage: Stage, private phone: boolean) {
    this.u = { uMap: { value: null }, uOpacity: { value: 0 }, ...LOOK };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, transparent: true, depthTest: false, depthWrite: false }));
    this.mesh.renderOrder = 8;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    stage.scene.add(this.mesh);
  }

  async load() {
    this.u.uMap.value = imageTexture(await loadPicture('beam'));
    this.ready = true;
  }

  /** k: 0 to 1 through its pass (below the screen to above it); t for a slow turn; mouse for a little parallax. */
  update(t: number, o: { k: number; vis: number; w: number; h: number; mouse: [number, number] | null }) {
    this.mesh.visible = this.ready && o.vis > 0.01 && o.k > 0 && o.k < 1;
    if (!this.mesh.visible) return;
    const b = media.beam;
    const h = o.h * (this.phone ? 0.4 : 0.52), w = h * (b.w / b.h);
    const par = o.mouse ? (o.mouse[0] / o.w - 0.5) * -40 : 0;
    const x = o.w * (this.phone ? 0.96 : 1.0) + par;
    const y = o.h * 1.2 - o.k * o.h * 1.8;
    this.mesh.position.set(x, -y, 0);
    this.mesh.rotation.z = -(0.5 + o.k * 0.35 + Math.sin(t * 0.4) * 0.03);
    this.mesh.scale.set(w, h, 1);
    this.u.uOpacity.value = o.vis;
  }
}
