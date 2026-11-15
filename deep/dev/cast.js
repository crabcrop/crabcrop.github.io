// Dev entry: the dive with Snap and his submarine (no sets or creatures).
import { startDive } from '../src/app.js';
import { buildCast } from '../src/cast.js';

startDive({ parts: [buildCast] }).catch((e) => console.error('dive: ' + (e && e.stack || e)));
