// Add ThumbHash placeholders for the plates to media/manifest.json, from the
// tiny PNGs that encode-media.py writes. Python hands over raw RGBA because
// Node has no PNG decoder without extra packages.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { rgbaToThumbHash } from 'thumbhash';

const media = new URL('../../preview/dive/media/', import.meta.url);
const manPath = new URL('manifest.json', media);
const man = JSON.parse(readFileSync(manPath, 'utf8'));
for (const key of ['z0', 'z0p', 'z1', 'z1p']) {
  const png = new URL(`${key}-tiny.png`, media).pathname;
  const raw = execFileSync('python3', ['-c',
    'import sys,json,base64;from PIL import Image;im=Image.open(sys.argv[1]).convert("RGBA");im.thumbnail((100,100));' +
    'print(json.dumps({"w":im.size[0],"h":im.size[1],"d":base64.b64encode(im.tobytes()).decode()}))', png]);
  const { w, h, d } = JSON.parse(raw.toString());
  const hash = rgbaToThumbHash(w, h, Buffer.from(d, 'base64'));
  man.plates[key].thumbhash = Buffer.from(hash).toString('base64');
  console.log(key, man.plates[key].thumbhash);
}
writeFileSync(manPath, JSON.stringify(man, null, 1));
