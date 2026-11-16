// The water itself: what is behind everything (open water in every direction), and the
// surface seen from underneath, with the bright window straight overhead through which
// the sky and the sun show, and all around it the mirror that shows the water below.
import { BackSide, DoubleSide, Mesh, PlaneGeometry, SphereGeometry } from 'three/webgpu';
import { cameraPosition, clamp, dot, float, length, max, mix, normalize, pow, reflect, refract, select, smoothstep, sqrt, texture, vec3 } from 'three/tsl';
import { G, inWater, material, scatter, scatterFrom, skyColor } from './shaders.js';

export function buildSea(scene) {
  const back = new Mesh(new SphereGeometry(400, 24, 16), material({
    side: BackSide, depthWrite: false, depthTest: false,
    // open water all round; from the waterline, the evening sky above it
    raw: (f) => {
      const rd = normalize(f.w.sub(cameraPosition)).toVar();
      return select(cameraPosition.y.greaterThan(-0.05).and(rd.y.greaterThan(0.0)), skyColor(rd), scatter(rd, float(300.0)));
    },
  }));
  back.renderOrder = -10;
  back.frustumCulled = false;
  scene.add(back);

  // One flat sheet at y = 0. All of its shape is in the slope read from the water texture.
  const surface = new Mesh(new PlaneGeometry(1600, 1600, 1, 1).rotateX(-Math.PI / 2), material({
    side: DoubleSide,
    raw: (f) => {
      const toP = f.w.sub(cameraPosition);
      const d = length(toP);
      const v = toP.div(d).toVar();
      // (small waves fade with distance: far away they would only shimmer)
      const fl = float(1).sub(smoothstep(60.0, 260.0, d));
      const sl = texture(G.waterTex, f.w.xz.div(13.0)).ba.sub(0.5)
        .add(texture(G.waterTex, f.w.zx.div(4.7).add(0.2)).ba.sub(0.5).mul(0.7))
        .add(texture(G.waterTex, f.w.xz.div(37.0).add(0.6)).ba.sub(0.5).mul(0.8)).mul(fl.mul(2.0)).toVar();
      const n = normalize(vec3(sl.x.mul(-0.8), -1.0, sl.y.mul(-0.8))).toVar();        // facing down, at us
      const ci = clamp(dot(v, n.negate()), 0.0, 1.0);
      const k = float(1).sub(float(1.769).mul(float(1).sub(ci.mul(ci)))).toVar();      // below zero, light cannot leave the water
      const win = smoothstep(0.0, 0.22, k);
      const sd = max(dot(refract(v, n, 1.333), G.sunDir), 0.0).toVar();
      const fres = pow(float(1).sub(sqrt(max(k, 0.0))), 5.0);
      const glit = texture(G.waterTex, f.w.xz.div(2.9).add(0.13)).r.mul(2.2).add(0.25);
      // the window: the sky, brighter and darker with the slope of each wave, and the sun's glitter
      const sky = vec3(0.30, 0.78, 1.0).mul(1.05).mul(clamp(sl.x.mul(0.6).sub(sl.y.mul(0.8)).mul(2.4).add(1.0), 0.4, 2.1))
        .add(vec3(1.0, 0.95, 0.85).mul(pow(sd, 24.0).mul(0.8).add(pow(sd, 120.0).mul(2.4).add(pow(sd, 700.0).mul(9.0)).mul(glit))))
        .mul(fres.oneMinus()).mul(G.light.x);
      // the mirror: the water below, along the reflected ray
      const refl = scatterFrom(float(0.0), float(1.0), reflect(v, n), float(300.0)).mul(1.15);
      return inWater(mix(refl, sky, win), f.w);
    },
  }));
  surface.frustumCulled = false;
  scene.add(surface);
  return {
    follow(cam) {
      back.position.copy(cam.position);
      back.updateMatrixWorld();
      surface.position.set(cam.position.x, 0, cam.position.z);
      surface.updateMatrixWorld();
    },
  };
}
