import * as THREE from 'three';
import { loadPicture } from '../media';
import { imageTexture, quad, place, type Stage } from './stage';
import { LOOK, LOOK_GLSL } from './look';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uMap;
uniform float uOpacity, uFlip, uHaze;
uniform vec3 uGrade, uWater;
varying vec2 vUv;
${LOOK_GLSL}
void main() {
  vec4 c = texture2D(uMap, vec2(uFlip > 0.5 ? 1.0 - vUv.x : vUv.x, vUv.y));
  if (c.a < 0.01) discard;
  // seen through water: graded, and hazed toward the water's colour
  vec3 col = mix(c.rgb * uGrade, uWater, uHaze);
  gl_FragColor = vec4(applyLook(col), c.a * uOpacity);
}`;

/**
 * A cutout set into the world: the anchor on the sand, the float on Snap's
 * line, a pier post passing close to the camera. grade tints it, haze mixes
 * it toward the water's colour (how far away it sits in the water).
 */
export class Prop {
  readonly mesh: THREE.Mesh;
  private u: Record<string, THREE.IUniform>;
  ready = false;

  constructor(stage: Stage, private name: string, order: number, o: { grade?: [number, number, number]; haze?: number; water?: [number, number, number] } = {}) {
    this.u = {
      uMap: { value: null }, uOpacity: { value: 1 }, uFlip: { value: 0 }, uHaze: { value: o.haze ?? 0 },
      uGrade: { value: new THREE.Vector3(...(o.grade ?? [1, 1, 1])) }, uWater: { value: new THREE.Vector3(...(o.water ?? [0.2, 0.62, 0.66])) }, ...LOOK,
    };
    this.mesh = quad(new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: this.u, transparent: true, depthTest: false, depthWrite: false }), order);
    this.mesh.visible = false;
    stage.scene.add(this.mesh);
  }

  async load() {
    this.u.uMap.value = imageTexture(await loadPicture(this.name));
    this.ready = true;
  }

  /** Draw it with its top-left corner at (x, y), w by h px, turned by rot about that corner's quad; opacity 0 hides it. */
  put(x: number, y: number, w: number, h: number, opacity = 1, flip = false, rot = 0) {
    const on = this.ready && opacity > 0.01;
    this.mesh.visible = on;
    if (!on) return;
    place(this.mesh, x, y, w, h, rot);
    this.u.uOpacity.value = opacity;
    this.u.uFlip.value = flip ? 1 : 0;
  }

  grade(r: number, g: number, b: number) { this.u.uGrade.value.set(r, g, b); }
  /** How much of the water's colour it takes on, and that colour. */
  haze(amount: number, water?: [number, number, number]) { this.u.uHaze.value = amount; if (water) this.u.uWater.value.set(...water); }
  hide() { this.mesh.visible = false; }
}
