import * as THREE from 'three';
import { media, url } from '../media';
import { LOOK, LOOK_GLSL } from './look';
import type { Stage } from './stage';

/**
 * Snap in 3D, for his spin round the chain. A Tripo model of the pose-2
 * painting, the one his film starts on, placed so that seen from the front it
 * lies over the sprite, and turned about the stretch of chain in his claw.
 * Lit to match the painting, and graded like every other layer.
 */
export class Spin3D {
  /** At his top hold, leaning with the chain (the rider's transform, without the mirror flip). */
  readonly group = new THREE.Group();
  /** Turns about the chain. */
  private turn = new THREE.Group();
  private model: THREE.Object3D | null = null;
  private readonly u = { uGrade: { value: new THREE.Vector3(1, 1, 1) }, uFade: { value: 1 }, ...LOOK };
  ready = false;
  private loading = false;

  constructor(stage: Stage) {
    // Soft light from above and a key from the upper left, as in the painting.
    // They only reach lit materials, so the flat layers are untouched.
    const hemi = new THREE.HemisphereLight(0xffffff, 0xb8a89a, 2.6);
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(-1, 1.4, 1.6);
    stage.scene.add(hemi, key, key.target);
    this.group.add(this.turn);
    this.group.visible = false;
    stage.scene.add(this.group);
  }

  /** The model ships as base64 text (the preview host serves no .glb). */
  async load() {
    if (this.loading || !media.snap3d) return;
    this.loading = true;
    const res = await fetch(url('snap-3d-glb.txt'));
    if (!res.ok) throw new Error(`snap-3d: ${res.status}`);
    const bin = Uint8Array.from(atob((await res.text()).trim()), (ch) => ch.charCodeAt(0));
    // The loader comes with the model, in its own small chunk.
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await new GLTFLoader().parseAsync(bin.buffer, '');
    const m = gltf.scene;
    const s = media.snap3d;
    m.rotation.y = s.rotY;
    m.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.renderOrder = 5.5;
      mesh.frustumCulled = false;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.transparent = true;
      // Grade and look it like the flat layers, and fade it in and out.
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, this.u);
        sh.fragmentShader = sh.fragmentShader
          .replace('void main() {', `uniform vec3 uGrade;\nuniform float uFade;\n${LOOK_GLSL}\nvoid main() {`)
          .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.rgb = applyLook(gl_FragColor.rgb * uGrade);\n  gl_FragColor.a *= uFade;');
      };
    });
    this.turn.add(m);
    this.model = m;
    this.ready = true;
  }

  /**
   * One frame. hold: his top hold on screen (px, y down); h: his height (px);
   * angle: lean; squash: the landing squash; phi: how far round he is; fade: 0 to 1.
   */
  update(o: { visible: boolean; hold: [number, number]; h: number; angle: number; squash: number; phi: number; fade: number; grade: [number, number, number] }) {
    const m = this.model;
    this.group.visible = o.visible && !!m && o.fade > 0.001;
    if (!this.group.visible || !m) return;
    const s = media.snap3d, h = o.h;
    m.scale.setScalar(s.scale * h);
    m.position.set(s.place[0] * h, s.place[1] * h, s.place[2] * h);
    this.turn.rotation.y = o.phi;
    this.group.position.set(o.hold[0], -o.hold[1], 0);
    this.group.rotation.z = o.angle;
    this.group.scale.set(1 + o.squash * 0.6, 1 - o.squash, 1);
    this.u.uGrade.value.set(...o.grade);
    this.u.uFade.value = o.fade;
  }

  hide() { this.group.visible = false; }

  /** How far the chain in his claws reaches below his top hold, px. */
  chainBelow(h: number) { return -media.snap3d.chain[1] * h; }
}
