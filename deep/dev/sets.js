// Dev entry: the dive with only the set pieces (src/sets.js) in it.
import { startDive } from '../src/app.js';
import { buildSets } from '../src/sets.js';

startDive({ parts: [buildSets] }).catch((e) => { console.error('dive: ' + (e && e.stack || e)); });
