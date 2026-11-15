// What is in the world, and what of it is worth drawing from where the camera is. Under
// water nothing is seen from far: each thing is switched off beyond the distance at which
// the water has taken it anyway, which is most of the world most of the time.
import { Sphere, Vector3 } from 'three';

const things = [];      // { o, x, y, z, r, range }
const sphere = new Sphere(), centre = new Vector3();

export function makeWorld(scene) {
  // Put an object in the world. `range` is how far away it can still be seen, in metres,
  // measured from its bounding sphere.
  return function add(o, range = 110) {
    o.updateMatrixWorld(true);
    if (o.isMesh) {
      if (o.isInstancedMesh) { o.computeBoundingSphere(); sphere.copy(o.boundingSphere); }
      else { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); sphere.copy(o.geometry.boundingSphere); }
      sphere.applyMatrix4(o.matrixWorld);
    } else {
      // a group: the sphere its caller gave it
      sphere.center.copy(o.userData.centre || centre.setFromMatrixPosition(o.matrixWorld)); sphere.radius = o.userData.radius || 10;
    }
    scene.add(o);
    things.push({ o, x: sphere.center.x, y: sphere.center.y, z: sphere.center.z, r: sphere.radius, range });
    return o;
  };
}

// Once a frame: switch each thing on or off by how far it is.
export function cull(cam) {
  const cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
  for (let i = 0; i < things.length; i++) {
    const t = things[i], dx = t.x - cx, dy = t.y - cy, dz = t.z - cz, lim = t.range + t.r;
    t.o.visible = dx * dx + dy * dy + dz * dz < lim * lim;
  }
}
export const worldSize = () => things.length;
