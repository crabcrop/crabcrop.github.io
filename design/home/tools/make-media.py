#!/usr/bin/env python3
"""Make the home page's own pictures and films: media/.

  python3 design/home/tools/make-media.py            everything
  python3 design/home/tools/make-media.py snap       Snap: the two films with their first frames, and the sleeper
  python3 design/home/tools/make-media.py patches    the eight embroidered patches

Snap was generated on black, in low light, for this page (the prompts and
job IDs are in design/home/README.md; the files are listed in
sources.json and fetched into design/home/.cache/). Each one is finished
here:
  - the wool is turned back onto his studio coral (the low light pulled it
    toward orange); a film takes its turn from its first frame and keeps
    it for every frame;
  - the near-black of the backdrop is taken to true black;
  - the frame is cut to a box around everywhere he goes;
  - a film drops every second frame: the generator draws each pose twice,
    so it is a 12-a-second film already;
  - the picture is laid over a ground two shades under the page colour it
    sits on (ground = max per channel, which is what `mix-blend-mode:
    lighten` does). On the page it is blended with `lighten`, so the page
    shows wherever the picture is ground; where a browser will not blend
    a video, the ground is close enough to the page that no box shows.
A film is written twice, as AV1 and as H.264, both tagged BT.709, with its
first frame as the poster.

The patches are cut from the dive's card-icon sheet (icons.png in
experience/scripts/sources.json; `experience/scripts/fetch-sources.sh`
fetches it): each patch is found on its paper, the circle of its edge is
fitted, and it is saved on a clear ground.

Needs ffmpeg with libsvtav1 and libx264, and the Python packages numpy,
Pillow and scipy. Encoders differ between versions, so a run rewrites the
films with slightly different bytes; the pictures in them are the same.
"""
import colorsys
import json
import os
import subprocess
import sys
import urllib.request

import numpy as np
from PIL import Image

HOME = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(os.path.dirname(HOME))
CACHE = os.path.join(HOME, '.cache')
OUT = os.path.join(ROOT, 'media')
ICONS = os.path.join(ROOT, 'experience', '.cache', 'sources', 'icons.png')

# kind, source (sources.json), output, height, the ground it is laid over, the box (x0, y0, x1, y1 in the source).
# The grounds are the page's --bg (12, 26, 34), --bg-2 (15, 32, 41) and --panel (18, 39, 48), each less 2.
SNAP = [
    ('film', 'snap-point-loop.mp4', 'snap-point', 720, (10, 24, 32), (540, 66, 1730, 962)),
    ('film', 'snap-cheer-loop.mp4', 'snap-cheer', 640, (13, 30, 39), (290, 0, 1638, 1016)),
    ('still', 'snap-asleep.png', 'snap-asleep.webp', 420, (16, 37, 46), None),
]
# name: its box on the icon sheet
PATCHES = {
    'link': (220, 252, 1368, 1428), 'fish': (1484, 252, 2632, 1428), 'reel': (2740, 252, 3900, 1428),
    'drops': (220, 1520, 1368, 2720), 'glass': (2740, 1520, 3904, 2720),
    'seal': (220, 2772, 1368, 3996), 'lantern': (1484, 2760, 2632, 3996), 'gear': (2740, 2760, 3904, 3996),
}

TARGET_HUE, TARGET_SAT = 1.5, 0.66     # the wool of Snap's studio pictures, in degrees and 0..1
FLOOR = 14                             # backdrop values up to here become black


def source(name):
    """The path of a generated original, fetched once."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        listed = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sources.json'), encoding='utf-8'))
        print('get ', name)
        urllib.request.urlretrieve(listed['base'] + listed['files'][name]['file'], path + '.part')
        os.rename(path + '.part', path)
    return path


def wool(a):
    """Mean colour of the wool in an RGB array (0..255): hue in degrees (-180..180) and saturation."""
    sel = (a[..., 0] > 150) & (a[..., 0] - a[..., 1] > 60) & (a[..., 0] - a[..., 2] > 60)
    m = a[sel].mean(axis=0)
    h, s, _ = colorsys.rgb_to_hsv(*(m / 255))
    h = h * 360
    return (h - 360 if h > 180 else h), s


def turn(a, deg, sat):
    """Rotate hue (in YIQ) and scale saturation. a: 0..255 floats."""
    x = a / 255
    y = x @ np.array([0.299, 0.587, 0.114], np.float32)
    i = x @ np.array([0.595716, -0.274453, -0.321263], np.float32)
    q = x @ np.array([0.211456, -0.522591, 0.311135], np.float32)
    t = np.deg2rad(deg)
    i2 = (i * np.cos(t) - q * np.sin(t)) * sat
    q2 = (i * np.sin(t) + q * np.cos(t)) * sat
    out = np.stack([y + 0.9563 * i2 + 0.6210 * q2, y - 0.2721 * i2 - 0.6474 * q2, y - 1.1070 * i2 + 1.7046 * q2], axis=-1)
    return np.clip(out, 0, 1) * 255


def correction(a):
    """The hue turn and saturation scale that put this picture's wool on the target."""
    best = None
    for deg in np.arange(-4, 16.5, 0.5):
        h, s = wool(turn(a, deg, 1.0))
        if best is None or abs(h - TARGET_HUE) < best[0]:
            best = (abs(h - TARGET_HUE), deg, s)
    _, deg, s = best
    return float(deg), float(min(1.15, max(0.9, TARGET_SAT / s)))


def finish(a, deg, sat, ground):
    """One frame, 0..255 floats: wool onto coral, backdrop to black, laid over the ground."""
    b = np.clip((turn(a, deg, sat) - FLOOR) * 255 / (255 - FLOOR), 0, 255)
    return np.maximum(b, np.array(ground, np.float32))


def still(src, out, tall, ground, box=None):
    im = Image.open(src).convert('RGB')
    a = np.asarray(im).astype(np.float32)
    deg, sat = correction(a)
    if box is None:     # where he is, with a margin
        ys, xs = np.where(a.max(axis=2) > 44)
        box = (max(int(xs.min()) - 36, 0), max(int(ys.min()) - 36, 0), min(int(xs.max()) + 36, im.width), min(int(ys.max()) + 36, im.height))
    x0, y0, x1, y1 = box
    res = Image.fromarray(finish(a[y0:y1, x0:x1], deg, sat, ground).round().astype(np.uint8))
    res = res.resize((round(res.width * tall / res.height), tall), Image.LANCZOS)
    res.save(out, quality=90, method=6)
    h, s = wool(np.asarray(res).astype(np.float32))
    print(f'{os.path.basename(out)}: {res.width}x{res.height}, {os.path.getsize(out) // 1024} KB, box {box}, hue turn {deg:+.1f}, sat x{sat:.2f} -> wool hue {h:.1f}, sat {s:.2f}')


def film(src, stem, tall, ground, box):
    info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', src]))['streams'][0]
    w, h = info['width'], info['height']
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', src, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    fr = np.frombuffer(raw, np.uint8).reshape(-1, h, w, 3)
    x0, y0, x1, y1 = box
    outside = np.ones((h, w), bool)
    outside[y0:y1, x0:x1] = False
    spill = int((fr.max(axis=3)[:, outside] > 44).sum())     # anything of him outside the box, anywhere in the film
    deg, sat = correction(fr[0].astype(np.float32))
    keep = fr[::2, y0:y1, x0:x1]                              # each pose once
    ow = round((x1 - x0) * tall / (y1 - y0))
    ow += ow % 2
    done = np.empty((len(keep), tall, ow, 3), np.uint8)
    for i, f in enumerate(keep):
        b = finish(f.astype(np.float32), deg, sat, ground)
        done[i] = np.asarray(Image.fromarray(b.round().astype(np.uint8)).resize((ow, tall), Image.LANCZOS))
    Image.fromarray(done[0]).save(stem + '.webp', quality=90, method=6)
    feed = ['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{ow}x{tall}', '-r', '12', '-i', '-', '-an',
            '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
            '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart']
    for name, enc in (('.av1.mp4', ['-c:v', 'libsvtav1', '-preset', '4', '-crf', '32', '-g', '250', '-svtav1-params', 'tune=0:scd=0:film-grain=0']),
                      ('.mp4', ['-c:v', 'libx264', '-preset', 'veryslow', '-profile:v', 'high', '-crf', '21', '-x264-params', 'keyint=250:min-keyint=250:scenecut=0:ref=5'])):
        subprocess.run(feed + enc + [stem + name], input=done.tobytes(), check=True, stderr=subprocess.DEVNULL)
    hh, ss = wool(done[0].astype(np.float32))
    seam = float(np.abs(done[-1].astype(np.float32) - done[0].astype(np.float32)).mean())
    print(f'{os.path.basename(stem)}: {len(done)} frames at 12 a second ({len(done) / 12:.2f} s), {ow}x{tall} from box {box} of {w}x{h}')
    print(f'  hue turn {deg:+.1f}, sat x{sat:.2f} -> wool hue {hh:.1f}, sat {ss:.2f} | last frame against first: {seam:.2f} | pixels of him outside the box: {spill}')
    for name in ('.av1.mp4', '.mp4', '.webp'):
        print(f'  {os.path.basename(stem) + name}: {os.path.getsize(stem + name) // 1024} KB')


def patch(sheet, box, out, size=384):
    from scipy import ndimage
    c = np.asarray(sheet.crop(box)).astype(np.float32)
    lum = c.mean(axis=2)
    chroma = c.max(axis=2) - c.min(axis=2)
    # the patch with its shadow, then the circle its upper left edge lies on (the shadow falls to the lower right)
    m = ~((lum > 222) & (chroma < 14))
    m = ndimage.binary_opening(m, structure=np.ones((7, 7)))
    lab, k = ndimage.label(m)
    m = lab == (1 + int(np.argmax(ndimage.sum(m, lab, range(1, k + 1)))))
    m = ndimage.binary_fill_holes(m)
    edge = m & ~ndimage.binary_erosion(m)
    ys, xs = np.where(edge)
    cy, cx = ys.mean(), xs.mean()
    keep = (-(xs - cx) - (ys - cy)) > 0.25 * np.hypot(xs - cx, ys - cy)
    X, Y = xs[keep].astype(np.float64), ys[keep].astype(np.float64)
    sol, *_ = np.linalg.lstsq(np.c_[2 * X, 2 * Y, np.ones_like(X)], X ** 2 + Y ** 2, rcond=None)
    ox, oy = sol[0], sol[1]
    r = np.sqrt(sol[2] + ox ** 2 + oy ** 2)
    gy, gx = np.mgrid[0:c.shape[0], 0:c.shape[1]]
    a = np.clip(ndimage.gaussian_filter((np.hypot(gx - ox, gy - oy) < r - 3).astype(np.float32), 2.0), 0, 1)
    ys, xs = np.where(a > 0.02)
    im = Image.fromarray(np.dstack([c, a * 255]).astype(np.uint8), 'RGBA').crop((xs.min() - 4, ys.min() - 4, xs.max() + 5, ys.max() + 5))
    side = max(im.size)
    sq = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    sq.resize((size, size), Image.LANCZOS).save(out, quality=88, method=6)
    print(f'{os.path.basename(out)}: {size}x{size}, {os.path.getsize(out) // 1024} KB')


def main():
    what = sys.argv[1:] or ['snap', 'patches']
    os.makedirs(OUT, exist_ok=True)
    if 'snap' in what:
        for kind, src, out, tall, ground, box in SNAP:
            (film if kind == 'film' else still)(source(src), os.path.join(OUT, out), tall, ground, box)
    if 'patches' in what:
        if not os.path.exists(ICONS):
            sys.exit(f'missing {os.path.relpath(ICONS, ROOT)}: run experience/scripts/fetch-sources.sh first')
        sheet = Image.open(ICONS).convert('RGB')
        for name, box in PATCHES.items():
            patch(sheet, box, os.path.join(OUT, f'patch-{name}.webp'))


main()
