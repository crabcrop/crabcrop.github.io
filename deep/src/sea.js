// The water itself: what is behind everything (open water in every direction), and the
// surface seen from underneath, with the bright window straight overhead through which
// the sky and the sun show, and all around it the mirror that shows the water below.
import { BackSide, DoubleSide, Mesh, PlaneGeometry, SphereGeometry } from 'three';
import { material } from './shaders.js';

export function buildSea(scene) {
  const back = new Mesh(new SphereGeometry(400, 24, 16), material({
    raw: true, side: BackSide, depthWrite: false, depthTest: false,
    surf: /* glsl */ `gl_FragColor = vec4(scatter(normalize(vW - cameraPosition), 300.0), 1.0);`,
  }));
  back.renderOrder = -10;
  back.frustumCulled = false;
  scene.add(back);

  // One flat sheet at y = 0. All of its shape is in the slope read from the water texture.
  const surface = new Mesh(new PlaneGeometry(1600, 1600, 1, 1).rotateX(-Math.PI / 2), material({
    raw: true, side: DoubleSide,
    surf: /* glsl */ `
    vec3 toP = vW - cameraPosition;
    float d = length(toP);
    vec3 v = toP / d;
    // (small waves fade with distance: far away they would only shimmer)
    float fl = 1.0 - smoothstep(60.0, 260.0, d);
    vec2 sl = ((texture2D(tWater, vW.xz / 13.0).ba - 0.5) + (texture2D(tWater, vW.zx / 4.7 + 0.2).ba - 0.5) * 0.7 + (texture2D(tWater, vW.xz / 37.0 + 0.6).ba - 0.5) * 0.8) * 2.0 * fl;
    vec3 n = normalize(vec3(-sl.x * 0.8, -1.0, -sl.y * 0.8));          // facing down, at us
    float ci = clamp(dot(v, -n), 0.0, 1.0);
    float k = 1.0 - 1.769 * (1.0 - ci * ci);                           // below zero, light cannot leave the water
    float win = smoothstep(0.0, 0.22, k);
    vec3 rr = refract(v, n, 1.333);
    float sd = max(dot(rr, uSunDir), 0.0);
    float fres = pow(1.0 - sqrt(max(k, 0.0)), 5.0);
    // the window: the sky, brighter and darker with the slope of each wave, and the sun's glitter
    vec3 sky = (vec3(0.30, 0.78, 1.0) * 1.3 * clamp(1.0 + 3.8 * (sl.x * 0.6 - sl.y * 0.8), 0.25, 3.0) + vec3(1.0, 0.95, 0.85) * (pow(sd, 24.0) * 0.8 + (pow(sd, 120.0) * 2.4 + pow(sd, 700.0) * 9.0) * (0.25 + 2.2 * texture2D(tWater, vW.xz / 2.9 + 0.13).r))) * (1.0 - fres) * uLight.x;
    // the mirror: the water below, along the reflected ray
    vec3 refl = scatterFrom(0.0, 1.0, reflect(v, n), 300.0) * 1.15;
    gl_FragColor = vec4(inWater(mix(refl, sky, win), vW), 1.0);
    `,
  }));
  surface.frustumCulled = false;
  scene.add(surface);
  return {
    follow(cam) {
      back.position.copy(cam.position);
      surface.position.set(cam.position.x, 0, cam.position.z);
    },
  };
}
