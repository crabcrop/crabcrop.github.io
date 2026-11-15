// The page's entry: the dive with everything in it.
import { startDive } from './app.js';

startDive({ parts: [] }).catch((e) => { console.error('dive: ' + (e && e.stack || e)); });
