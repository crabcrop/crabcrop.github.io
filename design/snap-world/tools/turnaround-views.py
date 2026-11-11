#!/usr/bin/env python3
"""Cut the four views out of Snap's C02 turnaround sheet (front, three-quarter,
left side, back, on white) into square 1536 px images with the same margin, for
Tripo's multiview-to-model. Each view is found as its own blob on the white
sweep, so neighbouring claws never leak into a crop. Tripo takes front, left,
back and right; the three-quarter view is saved for reference only.

usage: turnaround-views.py C02.png OUT_DIR
then:  tripo make OUT_DIR/front.jpg OUT_DIR/left.jpg OUT_DIR/back.jpg \
         --model tripo-v3.1 -p texture_quality=detailed -p geometry_quality=detailed
needs: numpy, scipy, Pillow
"""
import os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
rgb = np.asarray(Image.open(src).convert('RGB')).astype(np.float32)
lum = rgb.mean(axis=2)
chroma = rgb.max(axis=2) - rgb.min(axis=2)
fg = ndimage.binary_opening(~((lum > 232) & (chroma < 16)), iterations=2)
lab, n = ndimage.label(fg)
sizes = ndimage.sum(fg, lab, range(1, n + 1))
objs = ndimage.find_objects(lab)
big = [i + 1 for i in np.argsort(-sizes)[:8] if sizes[i] > 0.01 * fg.size]
views = sorted(big, key=lambda k: objs[k - 1][1].start)            # left to right on the sheet
for k, name in zip(views, ('front', 'threequarter', 'left', 'back')):
    sl = objs[k - 1]
    keep = ndimage.binary_dilation(lab == k, iterations=12).astype(np.float32)   # its soft edge and shadow
    y0, y1 = max(0, sl[0].start - 12), min(fg.shape[0], sl[0].stop + 12)
    x0, x1 = max(0, sl[1].start - 12), min(fg.shape[1], sl[1].stop + 12)
    side = max(y1 - y0, x1 - x0) + 2 * int(0.12 * max(y1 - y0, x1 - x0))
    canvas = np.full((side, side, 3), 255, np.float32)
    m = keep[y0:y1, x0:x1][..., None]
    oy, ox = (side - (y1 - y0)) // 2, (side - (x1 - x0)) // 2
    canvas[oy:oy + y1 - y0, ox:ox + x1 - x0] = rgb[y0:y1, x0:x1] * m + 255 * (1 - m)
    Image.fromarray(canvas.astype(np.uint8)).resize((1536, 1536), Image.LANCZOS).save(os.path.join(out, name + '.jpg'), quality=92)
    print(name, (x0, y0, x1, y1))
