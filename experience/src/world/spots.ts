// Plain data, so the page script can use it without loading Three.js.

/**
 * Where things are on the reef. u is in panels (panel i spans i to i + 1:
 * 0 turtle, 1 fish school, 2 cuttlefish, 3 soda can, 4 the Clam Studio), v
 * is a share of the plate's height. Measured on the 4K plates.
 */
export const SPOTS = {
  turtle: { box: [0.683, 0.095, 0.909, 0.392] as const, head: [0.73, 0.275] as const },
  faces: [[1.664, 0.31], [1.59, 0.4], [1.738, 0.4], [1.65, 0.495], [1.56, 0.565], [1.79, 0.505], [1.713, 0.62]] as const,
  face: [0.038, 0.088] as const,
  cuttle: { c: [2.366, 0.5] as const, r: [0.1, 0.155] as const },
  can: [3.268, 0.262, 3.436, 0.722] as const,
  pearl: { c: [4.678, 0.686] as const, r: [0.036, 0.085] as const },
  lamps: [[4.253, 0.243], [4.324, 0.139], [4.392, 0.181]] as const,
  floor: 0.885,
};
