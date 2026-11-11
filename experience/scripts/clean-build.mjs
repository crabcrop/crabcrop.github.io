// Remove the previous build's code from ../preview/dive, keeping media/.
import { rmSync } from 'node:fs';
const dive = new URL('../../preview/dive/', import.meta.url);
for (const p of ['assets', 'index.html']) rmSync(new URL(p, dive), { recursive: true, force: true });
