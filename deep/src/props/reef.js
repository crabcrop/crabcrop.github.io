// The Clam Studio's own pieces (zone s3): the pearl that its upscale rebuilds.
//
// The pearl is a sphere traced pixel by pixel on a card that is kept parallel to the screen,
// just in front of it (an impostor): seen through the card, a square of the card is a square
// of the screen. While it is a mosaic, the card is cut into square blocks and each block takes
// the colour the pearl has along the ray through the block's middle, so the pearl is a few flat
// tiles with a stepped edge; as the blocks shrink to a pixel the same sum is the round, glossy
// pearl, with nothing to swap. It is lit as everything else is (shaders.js: the sun, its
// shadow, the sky, the clam's lamps, the water between it and the eye), with the clam's own
// pearl's surface (sets.js).
import { Mesh, PlaneGeometry, Vector3 } from 'three/webgpu';
import { abs, cameraPosition, clamp, dot, float, floor, max, mix, normalize, pow, select, sqrt, uniform, uv, vec3 } from 'three/tsl';
import { G, inWater, material, shadeLit, shadow4 } from '../shaders.js';

const F = new Vector3(), Rv = new Vector3(), Uv = new Vector3(), D = new Vector3();

// A pearl of radius r at `at` (a Vector3). Returns { mesh, set(camera, blockPx, ppm), at, r }:
// set() places the card for this frame; blockPx is the mosaic's block in CSS pixels (0: whole),
// ppm(depth) how many CSS pixels a metre is at a depth.
export function buildPearl(scene, at, r) {
  const U = {
    c: uniform(new Vector3().copy(at)), r: uniform(r),
    q: uniform(new Vector3()), qr: uniform(new Vector3()), qu: uniform(new Vector3()),
    n: uniform(1e4), cov: uniform(r), aa: uniform(0.01),
  };
  const mat = material({
    transparent: true, depthWrite: false, shadow: false,
    raw: () => {
      // the block this pixel is in, and the ray from the eye through the block's middle
      const b = floor(uv().mul(U.n)).add(0.5).div(U.n);
      const Q = U.q.add(U.qr.mul(b.x.mul(2.0).sub(1.0))).add(U.qu.mul(b.y.mul(2.0).sub(1.0)));
      const d = normalize(Q.sub(cameraPosition)).toVar();
      const oc = cameraPosition.sub(U.c).toVar();
      const bb = dot(oc, d).toVar();
      const dd = max(dot(oc, oc).sub(bb.mul(bb)), 0.0).toVar();       // the ray's distance from the middle, squared
      const h = U.r.mul(U.r).sub(dd).toVar();
      // where it meets the pearl; a block whose ray just misses takes the nearest point of the rim
      const hit = cameraPosition.add(d.mul(bb.negate().sub(sqrt(max(h, 0.0)))));
      const rim = U.c.add(normalize(cameraPosition.add(d.mul(bb.negate())).sub(U.c)).mul(U.r));
      const P = select(h.greaterThan(0.0), hit, rim).toVar();
      const n = normalize(P.sub(U.c)).toVar();
      // the clam's pearl (sets.js): white and glossy, its sheen pink face on and lilac at the rim
      const fres = pow(float(1.0).sub(abs(dot(n, normalize(cameraPosition.sub(P))))), 2.0);
      const emis = mix(vec3(0.78, 0.6, 0.62), vec3(0.8, 0.72, 0.92), fres).mul(fres.mul(0.3).add(0.36));
      const albedo = vec3(0.956, 0.852, 0.852);
      const sh = shadow4(P.add(n.mul(0.14)).add(G.sunDir.mul(0.05)));
      const col = inWater(shadeLit(albedo, n, float(0.9), float(70.0), float(0.0), float(0.8), emis, float(1.0), sh, P, float(1.0)), P);
      // its edge: over about a pixel when it is whole, on the blocks' grid when it is a mosaic
      const alpha = clamp(U.cov.sub(sqrt(dd)).div(U.aa).add(0.5), 0.0, 1.0);
      return { color: col, alpha };
    },
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.visible = false;
  scene.add(mesh);
  return {
    mesh, at: U.c.value, r,
    // Place the card for this frame: square to the camera's line of sight, just in front of
    // the pearl, as large as the pearl looks from here (a little more toward the screen's edge,
    // where a sphere is drawn longer), and the blocks
    set(camera, blockPx, ppm) {
      const e = camera.matrixWorld.elements;
      Rv.set(e[0], e[1], e[2]); Uv.set(e[4], e[5], e[6]); F.set(-e[8], -e[9], -e[10]);
      const c = U.c.value;
      D.copy(c).sub(camera.position);
      const zc = D.dot(F);
      if (zc < r * 1.2) { mesh.visible = false; return false; }
      const cos = Math.min(1, zc / D.length());
      const zq = zc - r * 1.02;
      const pxC = ppm(zc), blockW = blockPx > 1.5 ? blockPx / pxC : 0;
      const half = (r * 1.12) / (cos * cos) + 1.5 * blockW;
      mesh.position.copy(c).addScaledVector(F, -r * 1.02);
      mesh.quaternion.copy(camera.quaternion);
      mesh.scale.set(half, half, 1);
      U.q.value.copy(mesh.position);
      U.qr.value.copy(Rv).multiplyScalar(half);
      U.qu.value.copy(Uv).multiplyScalar(half);
      // (blocks across the card; a whole pearl is traced per pixel)
      U.n.value = blockW > 0 ? Math.max(1, (2 * half * ppm(zq)) / blockPx) : 1e4;
      U.cov.value = r + 0.7 * blockW;
      U.aa.value = blockW > 0 ? 1e-4 : 1.1 / pxC;
      return true;
    },
  };
}
