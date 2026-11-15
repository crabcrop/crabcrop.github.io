// Only a probe, not part of the dive: does three.js's WebGPU renderer draw in this
// sandbox, and on which backend? A lit sea floor, a hundred instanced stalks moved by a
// compute pass, a TSL-shaded fog. Sets window.__done = { backend, ms } when drawn.
import { Mesh, PerspectiveCamera, PlaneGeometry, Scene, CylinderGeometry, WebGPURenderer, MeshStandardNodeMaterial, DirectionalLight, HemisphereLight, Color } from 'three/webgpu';
import { Fn, instancedArray, instanceIndex, positionLocal, vec3, float, sin, time, mix, color, positionWorld, cameraPosition, length, exp, uniform, hash } from 'three/tsl';

const forceWebGL = new URLSearchParams(location.search).has('webgl');
const renderer = new WebGPURenderer({ antialias: true, forceWebGL });
renderer.setSize(innerWidth, innerHeight);
document.body.style.margin = '0';
document.body.appendChild(renderer.domElement);
const scene = new Scene();
scene.background = new Color(0x0b3a52);
const cam = new PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);
cam.position.set(0, 3, 9); cam.lookAt(0, 1, 0);
scene.add(new HemisphereLight(0x7fd6ff, 0x203040, 1.2));
const sun = new DirectionalLight(0xfff2d0, 2.4); sun.position.set(3, 10, 4); scene.add(sun);

// fog by distance, in TSL: the same node graph compiles to WGSL or GLSL
const water = color(0x0b3a52), sigma = uniform(0.09);
const fogged = (base) => mix(water, base, exp(length(positionWorld.sub(cameraPosition)).mul(sigma).negate()));

const ground = new MeshStandardNodeMaterial({ roughness: 0.9 });
ground.colorNode = fogged(color(0xc8b48a).mul(float(0.85).add(sin(positionWorld.x.mul(3.0).add(positionWorld.z.mul(1.3))).mul(0.08))));
const floor = new Mesh(new PlaneGeometry(60, 60, 1, 1).rotateX(-Math.PI / 2), ground);
scene.add(floor);

// a hundred stalks whose sway comes from a compute pass writing one offset each
const N = 100;
const offsets = instancedArray(N, 'vec3');
const step = Fn(() => {
  const i = float(instanceIndex);
  offsets.element(instanceIndex).assign(vec3(sin(time.add(i.mul(0.37))).mul(0.25), 0, sin(time.mul(0.8).add(i)).mul(0.2)));
})().compute(N);
const stalkMat = new MeshStandardNodeMaterial({ roughness: 0.6 });
const off = offsets.toAttribute();
const k = positionLocal.y.add(1.5).div(3.0);
const ix = float(instanceIndex);
stalkMat.positionNode = positionLocal.add(off.mul(k.mul(k))).add(vec3(ix.mod(10).sub(4.5).mul(1.1), 1.5, ix.div(10).floor().sub(4.5).mul(-1.1)));
stalkMat.colorNode = fogged(mix(color(0x4a5a12), color(0xb8a030), hash(instanceIndex)));
const stalks = new Mesh(new CylinderGeometry(0.06, 0.1, 3, 6, 6), stalkMat);
stalks.count = N;
scene.add(stalks);

(async () => {
  const t0 = performance.now();
  await renderer.init();
  await renderer.computeAsync(step);
  await renderer.renderAsync(scene, cam);
  const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
  console.log('backend ' + backend);
  window.__done = { backend, ms: Math.round(performance.now() - t0) };
})();
