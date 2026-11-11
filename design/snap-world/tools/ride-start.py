#!/usr/bin/env python3
"""The start frame for Snap's ride loops (M10 to M12): pose 2 of the C03 pose
sheet (Snap hugging the chain, top middle cell, on white), moved onto the clip
grey #8C959C with the chain extended to the top and bottom edges, so his legs
have room to kick and the chain reads as one continuous chain.

The cell's white is keyed out (the background and the gaps inside the links),
edge colours are pulled away from the white, and the cell is placed at
(203, 96) on a 2276 x 1280 canvas. The chain repeats every 182 px (a pair of
links); above the cell it continues that period upward, and below it carries
on from where the cell's clean bottom stretch matches its top stretch. The
last 12 rows of the cell are the sheet's gutter and are dropped.

encode-media.py (step ride) relies on that placement: keep RIDE_CELL_AT and
RIDE_CANVAS there in step with CELL_AT and the canvas size here.

usage: ride-start.py C03-SHEET.png OUT.png
needs: numpy, scipy, Pillow
"""
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

CELL_AT = (203, 96)          # where the cell sits on the canvas
UP, DOWN = 96, 172           # chain added above and below the cell, px
PERIOD = 182                 # a pair of links, px
BAND = (596, 724)            # the chain's columns in the cell
GREY = np.array([140, 149, 156], np.float32)

sheet = Image.open(sys.argv[1]).convert('RGB')
SW, SH = sheet.size
c = np.asarray(sheet.crop((round(SW / 3), 0, round(2 * SW / 3), round(SH / 3)))).astype(np.float32)[:1012]
H, W = c.shape[:2]
lum = c.mean(axis=2)
chroma = c.max(axis=2) - c.min(axis=2)
BG = np.median(np.concatenate([c[0], c[-1], c[:, 0], c[:, -1]]), axis=0)

# The white: everything joined to the edges, plus the gaps inside the links.
white = (lum > 226) & (chroma < 20)
lab, k = ndimage.label(white)
edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
gaps = [i for i, sl in enumerate(ndimage.find_objects(lab), 1)
        if sl is not None and sl[1].start >= BAND[0] and sl[1].stop <= BAND[1]]
fg = ~(np.isin(lab, np.concatenate([edge, gaps])) & (lab > 0))
fg = ndimage.binary_opening(fg, structure=np.ones((3, 3)))
lab2, k2 = ndimage.label(fg)
fg = lab2 == (1 + int(np.argmax(ndimage.sum(fg, lab2, range(1, k2 + 1)))))
a = np.asarray(Image.fromarray((fg * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.9))).astype(np.float32) / 255
rgb = c.copy()
e = (a > 0.03) & (a < 0.97)
rgb[e] = np.clip((rgb[e] - (1 - a[e])[:, None] * BG) / a[e][:, None], 0, 255)

# Where the clean stretch below Snap sits in the chain's period (and how far it is shifted sideways).
x0, x1 = BAND
bot = c[860:H, x0:x1]
best = min(((np.abs(c[o:o + bot.shape[0], x0 - dx:x1 - dx] - bot).mean(), o, dx)
            for o in range(0, 250 - bot.shape[0]) for dx in range(-12, 4)), key=lambda b: b[0])
_, o, dx = best

CH = H + UP + DOWN
CW = int(round(CH * 16 / 9))
ox, oy = CELL_AT
assert oy == UP and CW == 2276 and CH == 1280
A = np.zeros((CH, CW), np.float32)
RGB = np.zeros((CH, CW, 3), np.float32)
RGB[oy:oy + H, ox:ox + W] = rgb
A[oy:oy + H, ox:ox + W] = a
for y in range(UP):
    r = (y - UP) % PERIOD
    RGB[y, ox + x0:ox + x1] = rgb[r, x0:x1]
    A[y, ox + x0:ox + x1] = a[r, x0:x1]
for i in range(DOWN):
    r = (o + bot.shape[0] + i) % PERIOD
    RGB[oy + H + i, ox + x0 + dx:ox + x1 + dx] = rgb[r, x0:x1]
    A[oy + H + i, ox + x0 + dx:ox + x1 + dx] = a[r, x0:x1]
out = RGB * A[..., None] + GREY * (1 - A[..., None])
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(sys.argv[2])
print(f'{sys.argv[2]}: {CW} x {CH}, cell at {CELL_AT}')
