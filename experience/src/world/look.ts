import * as THREE from 'three';

/**
 * The visitor's look (choice 2), previewed on the whole scene in the kelp
 * forest. Every layer's shader shares these uniforms, so one change grades
 * the plate, Snap, the fish and the kelp together.
 *   mode 0: none, 1: Crisp (sharpen(1.2):saturation(1.1)),
 *   2: Deep sea (duotone(0d202e,ffd88a)), 3: Vintage (sepia)
 */
export const LOOK = {
  uLookMode: { value: 0 } as THREE.IUniform<number>,
  uLookAmt: { value: 0 } as THREE.IUniform<number>,
};

export const LOOKS = { crisp: 1, deep: 2, vintage: 3 } as const;
export type LookName = keyof typeof LOOKS;

/** GLSL: applyLook(colour) for any layer. Sharpening is done by the plate's own shader. */
export const LOOK_GLSL = /* glsl */ `
uniform float uLookMode, uLookAmt;
vec3 applyLook(vec3 c) {
  if (uLookAmt <= 0.0) return c;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec3 g = c;
  if (uLookMode < 1.5) g = mix(vec3(l), c, 1.1);
  else if (uLookMode < 2.5) g = mix(vec3(0.051, 0.125, 0.180), vec3(1.0, 0.847, 0.541), l);
  else g = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
  return mix(c, clamp(g, 0.0, 1.0), uLookAmt);
}`;
