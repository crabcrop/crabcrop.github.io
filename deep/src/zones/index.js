// The zones' hands-on pieces, in the order of the dive (see src/stage.js for what a zone
// module is). Each file is its zone's: s0 the marina, s1 the shallows, s2 the kelp forest,
// s3 the reef and the Clam Studio, s4 the wreck and its cabin, s5 the twilight, s6 the vents,
// s7 the ascent, the surface and the way back to the start.
import s0 from './s0.js';
import s1 from './s1.js';
import s2 from './s2.js';
import s3 from './s3.js';
import s4 from './s4.js';
import s5 from './s5.js';
import s6 from './s6.js';
import s7 from './s7.js';

export const ZONE_MODULES = [s0, s1, s2, s3, s4, s5, s6, s7];
