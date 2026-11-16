import { startDive } from '../src/app.js';
import { buildSets } from '../src/sets.js';
startDive({ parts: [buildSets] }).then((r) => { window.__dive = r; }).catch((e) => { console.error('dive: ' + (e && e.stack || e)); });
