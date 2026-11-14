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
 * A barnacled beam from the wreck, lying in the foreground on the way to
 * the ship: it passes close to the camera as the submarine heads there.
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

  /** x: where its middle is across the screen, px (it lies along the bottom edge); t for a slow rock; mouse for a little parallax. */
  update(t: number, o: { x: number; vis: number; w: number; h: number; mouse: [number, number] | null }) {
    const b = media.beam;
    const h = o.h * (this.phone ? 0.34 : 0.46), w = h * (b.w / b.h);
    const reach = Math.hypot(w, h);
    this.mesh.visible = this.ready && o.vis > 0.01 && o.x > -reach && o.x < o.w + reach;
    if (!this.mesh.visible) return;
    const par = o.mouse ? (o.mouse[0] / o.w - 0.5) * -40 : 0;
    this.mesh.position.set(o.x + par, -(o.h * 0.97), 0);
    this.mesh.rotation.z = -(1.25 + Math.sin(t * 0.4) * 0.02);
    this.mesh.scale.set(w, h, 1);
    this.u.uOpacity.value = o.vis;
  }
}
