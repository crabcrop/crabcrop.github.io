#!/usr/bin/env python3
"""Encode the dive's media from the Higgsfield sources in .cache/sources
(fetch them first with scripts/fetch-sources.sh) into ../preview/dive/media,
and write media/manifest.json with the numbers the page needs.

usage: python3 scripts/encode-media.py [images] [opening] [sub] [reef] [wreck] [video] [sequence] [wreckseq] [beam] [pack] [twilight] [vents] [surface] [snap] [snappost] [snap3d] [still]
       (no argument runs every step but still, which needs the pictures scripts/snap-still.mjs takes of the page)
needs: ffmpeg, numpy, scipy, Pillow with AVIF support; for snap3d also npx (gltf-transform) and trimesh
"""
import json, os, subprocess, sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, '.cache', 'sources')
OUT = os.path.join(ROOT, '..', 'preview', 'dive', 'media')
MATTE = os.path.join(ROOT, '..', 'design', 'snap-world', 'tools', 'snap-matte.py')
os.makedirs(OUT, exist_ok=True)
MAN_PATH = os.path.join(OUT, 'manifest.json')
man = json.load(open(MAN_PATH)) if os.path.exists(MAN_PATH) else {}


def src(name):
    return os.path.join(SRC, name)


def out(name):
    p = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    return p


def save_pair(im, base, avif_q=52, webp_q=78):
    """Save an image as AVIF and WebP; returns their byte sizes."""
    sizes = {}
    im.save(out(base + '.avif'), quality=avif_q, speed=6)
    im.save(out(base + '.webp'), quality=webp_q, method=6)
    for ext in ('avif', 'webp'):
        sizes[ext] = os.path.getsize(out(f'{base}.{ext}'))
    return sizes


def resize_w(im, w):
    return im.resize((w, round(im.size[1] * w / im.size[0])), Image.LANCZOS)


def feather(mask, r=1.2):
    return np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(r))).astype(np.float32) / 255


def fill_holes_dark_or_coloured(mask, rgb):
    """Fill enclosed holes in mask that are dark or clearly coloured in rgb."""
    lab, k = ndimage.label(~mask)
    if not k:
        return mask
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    idx = np.arange(1, k + 1)
    lum = rgb.mean(axis=2)
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    dark = ndimage.mean(lum, lab, idx) < 110
    col = ndimage.mean(chroma, lab, idx) > 40
    small = ndimage.sum(np.ones_like(lum), lab, idx) < 0.002 * mask.size
    keep = idx[(dark | col | small) & ~np.isin(idx, border)]
    return mask | np.isin(lab, keep)


def rgba(rgb, alpha, bg=None):
    """RGBA from colour and matte. With bg, pull edge colours away from the
    backdrop they were shot on, so no light or grey fringe shows."""
    alpha = np.clip(alpha, 0, 1)
    rgb = rgb.astype(np.float32).copy()
    if bg is not None:
        e = (alpha > 0.03) & (alpha < 0.97)
        rgb[e] = np.clip((rgb[e] - (1 - alpha[e])[:, None] * np.asarray(bg, np.float32)) / alpha[e][:, None], 0, 255)
    return Image.fromarray(np.dstack([rgb.astype(np.uint8), (alpha * 255).astype(np.uint8)]), 'RGBA')


def bbox(alpha, thr=0.5, pad=0):
    ys, xs = np.where(alpha > thr)
    return (max(0, xs.min() - pad), max(0, ys.min() - pad),
            min(alpha.shape[1], xs.max() + 1 + pad), min(alpha.shape[0], ys.max() + 1 + pad))


# ---------------------------------------------------------------- images
# Phone windows of the 21:9 masters, as shares of their width (production-log.md).
PHONE = {'z1': (0.62, 0.86), 'z2': (0.52, 0.76), 'z3': (0.68, 0.92),
         'z3_2': (0.55, 0.79), 'z3_3': (0.22, 0.46), 'z3_4': (0.20, 0.44), 'z3b': (0.55, 0.79),
         'z4x': (0.38, 0.62), 'z4': (0.54, 0.78), 'z5': (0.52, 0.76), 'z6': (0.42, 0.66)}
ICON_BOXES = {'icon-chain': (220, 252, 1368, 1428), 'icon-fish': (1484, 252, 2632, 1428),
              'icon-reel': (2740, 252, 3900, 1428), 'icon-drops': (220, 1520, 1368, 2720),
              'icon-crop': (1484, 1520, 2632, 2716), 'icon-glass': (2740, 1520, 3904, 2720),
              'icon-seal': (220, 2772, 1368, 3996), 'icon-lantern': (1484, 2760, 2632, 3996),
              'icon-gear': (2740, 2760, 3904, 3996)}


def icon(sheet, name):
    """One round patch from the I01b sheet, on its white ground, as a 192 px sprite."""
    c = np.asarray(sheet.crop(ICON_BOXES[name])).astype(np.float32)
    lum = c.mean(axis=2); chroma = c.max(axis=2) - c.min(axis=2)
    m = ~((lum > 222) & (chroma < 14))
    m = ndimage.binary_opening(m, structure=np.ones((7, 7)))
    lab, k = ndimage.label(m)
    m = lab == (1 + int(np.argmax(ndimage.sum(m, lab, range(1, k + 1)))))
    m = ndimage.binary_fill_holes(m)
    a = feather(m, 2)
    bx0, by0, bx1, by1 = bbox(a, pad=4)
    spr = rgba(c, a, bg=(244, 244, 242)).crop((bx0, by0, bx1, by1)).resize((192, 192), Image.LANCZOS)
    return save_pair(spr, name, 62, 84)


def cutout(name, key, h, blur=0):
    """A foreground cutout (already RGBA from Higgsfield), trimmed and scaled to h px tall."""
    im = Image.open(src(name)).convert('RGBA')
    a = np.asarray(im)[..., 3]
    ys, xs = np.where(a > 8)
    im = im.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    im = im.resize((round(im.size[0] * h / im.size[1]), h), Image.LANCZOS)
    if blur:
        im = im.filter(ImageFilter.GaussianBlur(blur))
    man[key] = {'w': im.size[0], 'h': im.size[1], 'bytes': save_pair(im, key, 58, 80)}


def chain_sprite(width=640):
    """Snap hugging the chain: pose 2 of the C03 sheet (top middle cell), on
    white. Returns the sprite (width px wide, or the cell's own size with
    width=None), its chain numbers, and its box in the cell."""
    sheet = Image.open(src('snap-poses.png')).convert('RGB')
    W, H = sheet.size
    cell = np.asarray(sheet.crop((round(W / 3), 0, round(2 * W / 3), round(H / 3)))).astype(np.float32)
    lum = cell.mean(axis=2)
    chroma = cell.max(axis=2) - cell.min(axis=2)
    white = (lum > 228) & (chroma < 18)
    nonbg = ~white
    # The painted chain: a dark rust band around x = 642 (of 1835).
    xc, half = 642, 46
    xs = np.arange(cell.shape[1])[None, :].repeat(cell.shape[0], 0)
    band = np.abs(xs - xc) <= half
    r, g = cell[..., 0], cell[..., 1]
    # Snap's own colours: coral yarn (far redder than the rusty chain) and cream.
    coral = r - g > 85
    snap_px = coral | ((lum > 200) & (chroma < 70) & ~white)
    mask = nonbg & (~band | snap_px)
    # Keep the painted chain only on rows where Snap is on both sides of it
    # (in front of his claw and legs), so the live chain joins it above and below.
    win = 40
    rows = [y for y in range(cell.shape[0])
            if (lambda c: len(c) and c.min() < xc - 8 and c.max() > xc + 8)(
                np.nonzero(coral[y, xc - half - win:xc + half + win + 1])[0] + (xc - half - win))]
    # Over the whole span where the chain crosses in front of him, keep every
    # non-white pixel of the band, so no row of a link goes missing.
    span = slice(min(rows), max(rows) + 1)
    mask[span] |= nonbg[span] & band[span]
    mask = ndimage.binary_opening(mask, structure=np.ones((3, 3)))
    lab, k = ndimage.label(mask)
    sizes = ndimage.sum(mask, lab, range(1, k + 1))
    mask = lab == (1 + int(np.argmax(sizes)))
    mask = fill_holes_dark_or_coloured(mask, cell)
    mask = ndimage.binary_erosion(mask, iterations=1)
    a = feather(mask, 1.4)
    x0, y0, x1, y1 = bbox(a, pad=8)
    iron = mask & band & ~snap_px
    chain_rows = np.nonzero(iron.any(axis=1))[0]
    chain_x = float(np.nonzero(iron)[1].mean())
    spr = rgba(cell, a, bg=(248, 248, 250)).crop((x0, y0, x1, y1))
    if width:
        spr = resize_w(spr, width)
    meta = {'w': spr.size[0], 'h': spr.size[1],
            'chainX': round((chain_x - x0) / (x1 - x0), 4),
            'linkLen': 0.134,
            'chainTop': round((chain_rows.min() - y0) / (y1 - y0), 4),
            'chainBottom': round((chain_rows.max() - y0) / (y1 - y0), 4)}
    return spr, meta, (x0, y0, x1, y1)


def images():
    plates = {}
    # Desktop plates, 21:9. Waterline as a share of plate height (Z0 only).
    for key, name in (('z0', 'z0-plate.png'), ('z1', 'z1-plate.png'), ('z2', 'z2-plate.png'), ('z3', 'z3-plate.png')):
        im = Image.open(src(name)).convert('RGB')
        files = {}
        for w in (1600, 2400, 3200):
            files[w] = save_pair(resize_w(im, w), f'{key}-{w}')
        resize_w(im, 64).save(out(f'{key}-tiny.png'))  # read by thumbhash.mjs, then deleted
        plates[key] = {'w': im.size[0], 'h': im.size[1], 'widths': [1600, 2400, 3200], 'bytes': files}
        print(key, files)
    # Phone plates, 9:16. Z0 has a native one; Z1 is a crop of its master
    # (62 to 86 percent of the width, see production-log.md).
    def window(name, a, b):
        im = Image.open(src(name)).convert('RGB')
        return im.crop((round(a * im.size[0]), 0, round(b * im.size[0]), im.size[1]))
    phone = {'z0p': Image.open(src('z0-phone.png')).convert('RGB'),
             'z1p': window('z1-plate.png', PHONE['z1'][0], PHONE['z1'][1]),
             'z2p': window('z2-plate.png', PHONE['z2'][0], PHONE['z2'][1]),
             'z3p': window('z3-plate.png', PHONE['z3'][0], PHONE['z3'][1])}
    for key, im in phone.items():
        files = {}
        for w in (720, 1080):
            files[w] = save_pair(resize_w(im, w), f'{key}-{w}')
        resize_w(im, 36).save(out(f'{key}-tiny.png'))  # read by thumbhash.mjs, then deleted
        plates[key] = {'w': im.size[0], 'h': im.size[1], 'widths': [720, 1080], 'bytes': files}
        print(key, files)
    plates['z0']['waterline'] = 0.58
    plates['z0p']['waterline'] = 0.33
    man['plates'] = plates

    # Snap hugging the chain (pose 2), for the ride.
    spr, meta, _ = chain_sprite()
    s = save_pair(spr, 'snap-chain', avif_q=60, webp_q=82)
    man['snapChain'] = {**meta, 'bytes': s}
    print('snap-chain', spr.size, s)

    # The photo print on white.
    pr = np.asarray(Image.open(src('snap-print.png')).convert('RGB')).astype(np.float32)
    lum = pr.mean(axis=2); chroma = pr.max(axis=2) - pr.min(axis=2)
    m = ~((lum > 236) & (chroma < 12))
    m = ndimage.binary_opening(m, structure=np.ones((5, 5)))
    lab, k = ndimage.label(m)
    m = lab == (1 + int(np.argmax(ndimage.sum(m, lab, range(1, k + 1)))))
    m = ndimage.binary_fill_holes(m)
    a = feather(m, 1.5)
    x0, y0, x1, y1 = bbox(a, pad=6)
    spr = resize_w(rgba(pr, a, bg=(250, 250, 250)).crop((x0, y0, x1, y1)), 360)
    man['print'] = {'w': spr.size[0], 'h': spr.size[1], 'bytes': save_pair(spr, 'print', 60, 82)}

    # Format fish, from the F01 sheet on mid-grey. One per school.
    fs = np.asarray(Image.open(src('fish-sheet.png')).convert('RGB')).astype(np.float32)
    G = np.median(fs[:200, :200].reshape(-1, 3), axis=0)
    D = fs - G
    dist = np.abs(D).sum(axis=2)
    chroma = fs.max(axis=2) - fs.min(axis=2)
    shadow = (D.max(axis=2) < 6) & (chroma < 28)          # neutral and darker than the grey
    fish_m = (dist > 55) & ~shadow
    fish_m = ndimage.binary_opening(fish_m, structure=np.ones((5, 5)))
    fish_m = ndimage.binary_closing(fish_m, structure=np.ones((9, 9)))
    # Regions on the sheet (as shares of width and height), see the prompt pack.
    regions = {'avif': (0.05, 0.22, 0.31, 0.43), 'webp': (0.32, 0.22, 0.51, 0.45),
               'jpeg': (0.52, 0.21, 0.71, 0.45), 'jxl': (0.72, 0.23, 0.95, 0.43),
               'png': (0.08, 0.54, 0.30, 0.79), 'gif': (0.33, 0.58, 0.46, 0.75)}
    sprites = {}
    for fmt, (rx0, ry0, rx1, ry1) in regions.items():
        X0, Y0, X1, Y1 = round(rx0 * fs.shape[1]), round(ry0 * fs.shape[0]), round(rx1 * fs.shape[1]), round(ry1 * fs.shape[0])
        sub = fish_m[Y0:Y1, X0:X1]
        lab, k = ndimage.label(sub)
        if fmt == 'gif':     # the fry: keep every sizeable piece
            keep = [i + 1 for i, s in enumerate(ndimage.sum(sub, lab, range(1, k + 1))) if s > 1500]
            sub = np.isin(lab, keep)
        else:
            sub = lab == (1 + int(np.argmax(ndimage.sum(sub, lab, range(1, k + 1)))))
        rgbsub = fs[Y0:Y1, X0:X1]
        sub = ndimage.binary_closing(sub, structure=np.ones((15, 15)))
        sub = ndimage.binary_fill_holes(sub)
        a = feather(sub, 1.3)
        if fmt == 'png':     # glass: let the grey show through, keep the yarn skeleton
            glass = np.clip(np.abs(rgbsub - G).sum(axis=2) / 90, 0.25, 1)
            a = a * glass
        bx0, by0, bx1, by1 = bbox(a, 0.2, 4)
        sprites[fmt] = resize_w(rgba(rgbsub, a, bg=G).crop((bx0, by0, bx1, by1)), 220 if fmt != 'gif' else 180)
    # Pack into one atlas row.
    hmax = max(s.size[1] for s in sprites.values())
    atlas = Image.new('RGBA', (sum(s.size[0] + 4 for s in sprites.values()), hmax), (0, 0, 0, 0))
    x = 0; rects = {}
    for fmt, s in sprites.items():
        atlas.paste(s, (x, 0)); rects[fmt] = [x, 0, s.size[0], s.size[1]]; x += s.size[0] + 4
    man['fish'] = {'w': atlas.size[0], 'h': atlas.size[1], 'rects': rects,
                   'bytes': save_pair(atlas, 'fish', 60, 82)}
    print('fish atlas', atlas.size, man['fish']['bytes'])

    # Card icons: round patches from the I01b sheet (crop-rect boxes in the log).
    ic = Image.open(src('icons.png')).convert('RGB')
    man['icons'] = {}
    for name in ('icon-chain', 'icon-fish', 'icon-reel', 'icon-drops', 'icon-crop', 'icon-gear'):
        man['icons'][name] = icon(ic, name)

    # Foreground cutouts (already RGBA from Higgsfield).
    for name, key, h in (('cut-seagrass.png', 'seagrass', 900), ('cut-rope-buoy.png', 'rope-buoy', 640), ('cut-kelp.png', 'kelp', 1100)):
        cutout(name, key, h)
    print('images done')


def reef():
    """The reef panorama (four stations and the clean can plate), the Clam
    Studio, their phone crops for the still page, the foreground coral that
    hides the joins between panels, and the reef's card icons."""
    plates = man['plates']
    for key, name in (('z3_2', 'z3-2-plate.png'), ('z3_3', 'z3-3-plate.png'), ('z3_4', 'z3-4-plate.png'),
                      ('z3_4c', 'z3-4-clean.png'), ('z3b', 'z3b-plate.png')):
        im = Image.open(src(name)).convert('RGB')
        files = {}
        for w in (1600, 2400, 3200):
            files[w] = save_pair(resize_w(im, w), f'{key}-{w}')
        resize_w(im, 64).save(out(f'{key}-tiny.png'))  # read by thumbhash.mjs, then deleted
        plates[key] = {'w': im.size[0], 'h': im.size[1], 'widths': [1600, 2400, 3200], 'bytes': files}
        print(key, files)
        if key in PHONE:
            a, b = PHONE[key]
            ph = im.crop((round(a * im.size[0]), 0, round(b * im.size[0]), im.size[1]))
            pfiles = {1080: save_pair(resize_w(ph, 1080), f'{key}p-1080')}
            resize_w(ph, 36).save(out(f'{key}p-tiny.png'))
            plates[key + 'p'] = {'w': ph.size[0], 'h': ph.size[1], 'widths': [1080], 'bytes': pfiles}
            print(key + 'p', pfiles)
    cutout('cut-coral.png', 'coral', 900, blur=1.6)
    ic = Image.open(src('icons.png')).convert('RGB')
    for name in ('icon-glass', 'icon-seal', 'icon-lantern'):
        man['icons'][name] = icon(ic, name)
    print('reef done')


def wreck():
    """The shipwreck: outside (z4x) and the captain's cabin (z4), the twilight
    zone that the drop ends on (z5), their phone windows, the cabin's loop and
    the barnacled beam."""
    plates = man['plates']
    for key, name in (('z4x', 'z4-ext-plate.png'), ('z4', 'z4-plate.png'), ('z5', 'z5-plate.png')):
        im = Image.open(src(name)).convert('RGB')
        files = {}
        for w in (1600, 2400, 3200):
            files[w] = save_pair(resize_w(im, w), f'{key}-{w}')
        resize_w(im, 64).save(out(f'{key}-tiny.png'))  # read by thumbhash.mjs, then deleted
        plates[key] = {'w': im.size[0], 'h': im.size[1], 'widths': [1600, 2400, 3200], 'bytes': files}
        a, b = PHONE[key]
        ph = im.crop((round(a * im.size[0]), 0, round(b * im.size[0]), im.size[1]))
        pfiles = {w: save_pair(resize_w(ph, w), f'{key}p-{w}') for w in (720, 1080)}
        resize_w(ph, 36).save(out(f'{key}p-tiny.png'))
        plates[key + 'p'] = {'w': ph.size[0], 'h': ph.size[1], 'widths': [720, 1080], 'bytes': pfiles}
        print(key, files, pfiles)
    enc = ['-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-maxrate', '2.4M',
           '-bufsize', '4.8M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-g', '48']
    ff('-i', src('z4-loop.mp4'), '-vf', 'scale=1600:-2:flags=lanczos', *enc, out('z4-loop.mp4'))
    ff('-i', src('z4-loop.mp4'), '-vf', f"crop=528:936:{round(PHONE['z4'][0] * 2212)}:0", *enc, out('z4p-loop.mp4'))
    for n in ('z4-loop', 'z4p-loop'):
        man['loops'][n] = os.path.getsize(out(n + '.mp4'))
    cutout('cut-beam.png', 'beam', 700, blur=3.5)
    octopus()
    print('wreck done', man['loops'], man['beam'], man['octopus'])


def octopus():
    """The little octopus with its letter (Snap's kindness in the wreck), and
    where the wax seal goes on the envelope's flap, as shares of the sprite."""
    cutout('octopus.png', 'octopus', 520)
    im = np.asarray(Image.open(out('octopus.webp')).convert('RGBA')).astype(np.float32)
    rgb, a = im[..., :3], im[..., 3]
    lum = rgb.mean(axis=2); chroma = rgb.max(axis=2) - rgb.min(axis=2)
    paper = (a > 200) & (lum > 185) & (chroma < 40)
    lab, k = ndimage.label(paper)
    paper = lab == (1 + int(np.argmax(ndimage.sum(paper, lab, range(1, k + 1)))))
    ys, xs = np.where(paper)
    h, w = a.shape
    # the flap's point sits just below the middle of the envelope
    man['octopus']['seal'] = [round(float(xs.mean()) / w, 4), round(float(ys.min() + 0.6 * (ys.max() - ys.min())) / h, 4)]
    man['octopus']['envelope'] = [round(xs.min() / w, 4), round(ys.min() / h, 4), round(xs.max() / w, 4), round(ys.max() / h, 4)]



def twilight():
    """The twilight zone lit by the lantern (z5lit, revealed round the cursor
    over z5, same windows on phones) and a glowing jellyfish kept on black
    for additive light."""
    plates = man['plates']
    im = Image.open(src('z5-lit-plate.png')).convert('RGB')
    files = {w: save_pair(resize_w(im, w), f'z5lit-{w}') for w in (1600, 2400, 3200)}
    plates['z5lit'] = {'w': im.size[0], 'h': im.size[1], 'widths': [1600, 2400, 3200], 'bytes': files, 'thumbhash': plates['z5']['thumbhash']}
    a, b = PHONE['z5']
    ph = im.crop((round(a * im.size[0]), 0, round(b * im.size[0]), im.size[1]))
    pfiles = {w: save_pair(resize_w(ph, w), f'z5litp-{w}') for w in (720, 1080)}
    plates['z5litp'] = {'w': ph.size[0], 'h': ph.size[1], 'widths': [720, 1080], 'bytes': pfiles, 'thumbhash': plates['z5p']['thumbhash']}
    jelly = Image.open(src('cut-glow-jelly.png')).convert('RGB')
    g = np.asarray(jelly).astype(np.float32)
    ys, xs = np.where(g.max(axis=2) > 40)
    jelly = jelly.crop((max(0, xs.min() - 20), max(0, ys.min() - 20), min(jelly.size[0], xs.max() + 20), min(jelly.size[1], ys.max() + 20)))
    jelly = jelly.resize((round(jelly.size[0] * 640 / jelly.size[1]), 640), Image.LANCZOS)
    man['glowJelly'] = {'w': jelly.size[0], 'h': jelly.size[1], 'bytes': save_pair(jelly, 'glow-jelly', 56, 80)}
    print('twilight', files, pfiles, man['glowJelly'])



def vents():
    """The vents (z6) and its phone window, its loop, and the tube worms that
    stand in the foreground and pull their plumes in from the cursor."""
    plates = man['plates']
    im = Image.open(src('z6-plate.png')).convert('RGB')
    files = {w: save_pair(resize_w(im, w), f'z6-{w}') for w in (1600, 2400, 3200)}
    resize_w(im, 64).save(out('z6-tiny.png'))
    plates['z6'] = {'w': im.size[0], 'h': im.size[1], 'widths': [1600, 2400, 3200], 'bytes': files}
    a, b = PHONE['z6']
    ph = im.crop((round(a * im.size[0]), 0, round(b * im.size[0]), im.size[1]))
    pfiles = {w: save_pair(resize_w(ph, w), f'z6p-{w}') for w in (720, 1080)}
    resize_w(ph, 36).save(out('z6p-tiny.png'))
    plates['z6p'] = {'w': ph.size[0], 'h': ph.size[1], 'widths': [720, 1080], 'bytes': pfiles}
    enc = ['-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-maxrate', '2.4M',
           '-bufsize', '4.8M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-g', '48']
    ff('-i', src('z6-loop.mp4'), '-vf', 'scale=1600:-2:flags=lanczos', *enc, out('z6-loop.mp4'))
    ff('-i', src('z6-loop.mp4'), '-vf', f"crop=528:936:{round(PHONE['z6'][0] * 2212)}:0", *enc, out('z6p-loop.mp4'))
    for n in ('z6-loop', 'z6p-loop'):
        man['loops'][n] = os.path.getsize(out(n + '.mp4'))
    cutout('cut-tube-worms.png', 'worms', 760, blur=2.2)
    print('vents', files, pfiles, man['worms'])



def surface():
    """Back at the surface at sunset (z7, and its own 9:16 plate for phones,
    both with their waterlines as at the marina), and their loops."""
    plates = man['plates']
    for key, name, widths in (('z7', 'z7-plate.png', (1600, 2400, 3200)), ('z7p', 'z7-phone.png', (720, 1080))):
        im = Image.open(src(name)).convert('RGB')
        files = {w: save_pair(resize_w(im, w), f'{key}-{w}') for w in widths}
        resize_w(im, 64 if key == 'z7' else 36).save(out(f'{key}-tiny.png'))
        plates[key] = {'w': im.size[0], 'h': im.size[1], 'widths': list(widths), 'bytes': files}
        print(key, files)
    plates['z7']['waterline'] = 0.58
    plates['z7p']['waterline'] = 0.33
    enc = ['-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-maxrate', '2.4M',
           '-bufsize', '4.8M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-g', '48']
    ff('-i', src('z7-loop.mp4'), '-vf', 'scale=1600:-2:flags=lanczos', *enc, out('z7-loop.mp4'))
    ff('-i', src('z7-phone-loop.mp4'), '-vf', 'scale=720:-2:flags=lanczos', *enc, out('z7p-loop.mp4'))
    for n in ('z7-loop', 'z7p-loop'):
        man['loops'][n] = os.path.getsize(out(n + '.mp4'))
    print('surface', man['loops'])


def grey_matte(name, lum_w=0.35, lo=7.0, hi=16.0):
    """A prop shot on a plain mid-grey ground (the float, the anchor): the
    ground is fitted as a smooth field and the prop keyed by how far its
    colour is from it. lum_w weighs lightness: low keeps a soft shadow on the
    ground out of the matte. Returns RGBA, trimmed."""
    rgb = np.asarray(Image.open(src(name)).convert('RGB')).astype(np.float32)
    h, w = rgb.shape[:2]

    def opp(c):
        r, g, b = c[..., 0], c[..., 1], c[..., 2]
        return np.dstack([(r + g + b) / 3, r - g, (r + g) / 2 - b])
    yy, xx = np.mgrid[0:h, 0:w]
    x = (xx / w - 0.5).astype(np.float32); y = (yy / h - 0.5).astype(np.float32)
    A = np.dstack([np.ones_like(x), x, y, x * x, x * y, y * y])
    ground = np.zeros((h, w), bool); m = int(0.06 * min(h, w))
    ground[:m] = ground[-m:] = True; ground[:, :m] = ground[:, -m:] = True
    for _ in range(3):
        sel = ground[::7, ::7]
        field = np.dstack([A @ np.linalg.lstsq(A[::7, ::7][sel], rgb[::7, ::7, c][sel], rcond=None)[0] for c in range(3)])
        d = opp(rgb) - opp(field)
        dist = np.sqrt((lum_w * d[..., 0]) ** 2 + d[..., 1] ** 2 + d[..., 2] ** 2)
        ground = dist < lo * 0.8
    a = np.clip((dist - lo) / (hi - lo), 0, 1)
    a = a * a * (3 - 2 * a)
    # only the prop and what touches it: stray specks on the ground go
    solid = ndimage.binary_opening(a > 0.5, structure=np.ones((5, 5)))
    lab, k = ndimage.label(solid)
    if k > 1:
        sizes = ndimage.sum(solid, lab, range(1, k + 1))
        keep = np.isin(lab, 1 + np.where(sizes > 0.002 * sizes.max())[0])
        a = np.where(ndimage.binary_dilation(keep, iterations=6), a, 0)
    # choked a little, so no grey rim is left
    a = np.clip((feather(a, 1.0) - 0.2) / 0.8, 0, 1)
    im = rgba(rgb, a, bg=None)
    e = (a > 0.03) & (a < 0.97)
    px = np.asarray(im).copy()
    px[e, :3] = np.clip((rgb[e] - (1 - a[e])[:, None] * field[e]) / a[e][:, None], 0, 255).astype(np.uint8)
    im = Image.fromarray(px, 'RGBA')
    return im.crop(bbox(a, 0.03))


# The marina's underwater half, as shares of its plates: what the plunge pushes in on.
UNDER = {'z0u': ('z0-plate.png', (0.30, 0.50, 1.0, 1.0), (2400, 3200, 4096)),
         'z0up': ('z0-phone.png', (0.12, 0.45, 0.88, 1.0), (1080, 1620, 2160))}


def opening():
    """The new opening: sharper crops of the marina's underwater half for the
    plunge (one continuous picture, down to the sand at the foot of the pier);
    a pier post for the foreground of the way to the shallows; and the anchor
    the chain ends on."""
    plates = man['plates']
    for key, (name, (u0, v0, u1, v1), widths) in UNDER.items():
        im = Image.open(src(name)).convert('RGB')
        W, H = im.size
        c = im.crop((round(u0 * W), round(v0 * H), round(u1 * W), round(v1 * H)))
        files = {w: save_pair(resize_w(c, w), f'{key}-{w}', 50, 78) for w in widths}
        plates[key] = {'w': c.size[0], 'h': c.size[1], 'widths': list(widths), 'bytes': files, 'rect': [u0, v0, u1, v1]}
        print(key, c.size, files)
    # A pier post, close to the camera and out of focus: the front right one, under water.
    im = Image.open(src('z0-plate.png')).convert('RGB')
    W, H = im.size
    post = im.crop((round(0.7345 * W), round(0.63 * H), round(0.7685 * W), H))
    post = post.resize((round(post.size[0] * 900 / post.size[1]), 900), Image.LANCZOS).filter(ImageFilter.GaussianBlur(5))
    a = np.ones((post.size[1], post.size[0]), np.float32)
    edge = np.minimum(np.arange(post.size[0]), post.size[0] - 1 - np.arange(post.size[0])) / 9.0
    a *= np.clip(edge, 0, 1)[None, :]
    post = Image.fromarray(np.dstack([np.asarray(post), (a * 255).astype(np.uint8)]), 'RGBA')
    man['post'] = {'w': post.size[0], 'h': post.size[1], 'bytes': save_pair(post, 'post', 50, 76)}
    print('post', post.size, man['post']['bytes'])
    # The anchor in its mound of sand.
    an = grey_matte('anchor-src.png', lum_w=0.12)
    # its own bit of chain is cut off just above the ring: the page's chain ends there
    an = an.crop((0, round(0.215 * an.size[1]), an.size[0], an.size[1]))
    an = an.resize((round(an.size[0] * 620 / an.size[1]), 620), Image.LANCZOS)
    # ring: where the chain ends; ground: where it meets the sand
    man['anchor'] = {'w': an.size[0], 'h': an.size[1], 'ring': [0.855, 0.04], 'ground': 0.925, 'bytes': save_pair(an, 'anchor', 58, 80)}
    print('anchor', an.size, man['anchor']['bytes'])


def sub():
    """Snap's submarine, shot on grey: brass, with a glass bubble for a cockpit that he sits in. Brass and steel
    are solid; the bubble is a thin film of glass (its highlights and a faint rim), so Snap, drawn behind the
    sprite, shows through it. The source faces left; the sprite is mirrored to face right, the way the dive goes.
    The manifest gets the bubble's circle and the points the page hangs things on."""
    rgb = np.asarray(Image.open(src('sub-src.png')).convert('RGB')).astype(np.float32)
    h, w = rgb.shape[:2]
    # In the source, by eye: the bubble (centre x as a share of the width, y of the height, radius of the width),
    # and in px the hatch's lid, the lamp's lens, the tips of the near pincer and the propeller's hub.
    GUESS = (0.3228, 0.5012, 0.1622)
    POINTS = {'hatch': (1510, 444), 'lamp': (1234, 410), 'claw': (810, 1344), 'prop': (2210, 840)}

    def opp(c):
        r, g, b = c[..., 0], c[..., 1], c[..., 2]
        return np.dstack([(r + g + b) / 3, r - g, (r + g) / 2 - b])
    yy, xx = np.mgrid[0:h, 0:w]
    x = (xx / w - 0.5).astype(np.float32); y = (yy / h - 0.5).astype(np.float32)
    A = np.dstack([np.ones_like(x), x, y, x * x, x * y, y * y, x ** 3, y ** 3, x * x * y, x * y * y])
    ground = np.zeros((h, w), bool); m = int(0.07 * min(h, w))
    ground[:m] = ground[-m:] = True; ground[:, :m] = ground[:, -m:] = True
    for _ in range(4):
        sel = ground[::7, ::7]
        field = np.dstack([A @ np.linalg.lstsq(A[::7, ::7][sel], rgb[::7, ::7, c][sel], rcond=None)[0] for c in range(3)])
        d = opp(rgb) - opp(field)
        dist = np.sqrt((0.5 * d[..., 0]) ** 2 + d[..., 1] ** 2 + d[..., 2] ** 2)
        ground = dist < 5
    chroma = np.sqrt(d[..., 1] ** 2 + d[..., 2] ** 2)          # brass is far from grey in colour
    rough = ndimage.binary_opening(dist > 6, structure=np.ones((3, 3)))
    lab, k = ndimage.label(rough)
    sizes = ndimage.sum(rough, lab, range(1, k + 1))
    rough = np.isin(lab, 1 + np.where(sizes > 0.01 * sizes.max())[0])
    sil = ndimage.binary_fill_holes(ndimage.binary_closing(rough, structure=np.ones((25, 25))))
    sil = ndimage.binary_erosion(sil, iterations=2)

    # The bubble's outline is too faint to close by itself: settle on the circle near the guess with the most
    # edge along its outer arc (the part away from the brass ring that holds it).
    lum = ndimage.gaussian_filter(rgb.mean(axis=2), 1.5)
    gm = np.hypot(ndimage.sobel(lum, 0), ndimage.sobel(lum, 1))
    th = np.radians(np.arange(75, 286, 1.0))
    best = (-1.0, 0.0, 0.0, 0.0)
    for R_ in np.arange(GUESS[2] * w - 36, GUESS[2] * w + 37, 3):
        for cx_ in np.arange(GUESS[0] * w - 36, GUESS[0] * w + 37, 3):
            for cy_ in np.arange(GUESS[1] * h - 36, GUESS[1] * h + 37, 3):
                px = np.clip((cx_ + R_ * np.cos(th)).astype(int), 0, w - 1); py = np.clip((cy_ - R_ * np.sin(th)).astype(int), 0, h - 1)
                sc = float(gm[py, px].mean())
                if sc > best[0]:
                    best = (sc, cx_, cy_, R_)
    _, cx, cy, R = best
    rr = np.hypot(xx - cx, yy - cy)
    disc = rr < R + 1
    # brass: by its colour, and only the pieces of any size (warm glints on the glass are not brass)
    brass = ndimage.binary_opening(chroma > 14, structure=np.ones((5, 5)))
    bl, bk = ndimage.label(brass)
    bs = ndimage.sum(brass, bl, range(1, bk + 1))
    brass = np.isin(bl, 1 + np.where(bs > 0.02 * bs.max())[0])
    # (on the glass, only what is as wide as the ring: thin warm streaks beside it are reflections)
    brass = ndimage.binary_dilation((brass & ~disc) | ndimage.binary_opening(brass & disc, structure=np.ones((13, 13))), iterations=2)
    body = sil & ~disc
    pl, pk = ndimage.label(body)                               # (what the sphere leaves outside the circle is stray highlight)
    ps = ndimage.sum(body, pl, range(1, pk + 1))
    body = np.isin(pl, 1 + np.where(ps > 0.02 * ps.max())[0])
    # (and what filling the outline closed up between the arms, the tank and the bubble is still the grey ground)
    gap = ndimage.binary_opening(body & (dist < 4.5), structure=np.ones((5, 5)))
    gl, gk = ndimage.label(gap)
    gs = ndimage.sum(gap, gl, range(1, gk + 1))
    body &= ~ndimage.binary_dilation(np.isin(gl, 1 + np.where(gs > 0.0003 * gap.size)[0]), iterations=3)
    glass = disc & ~(brass & sil)
    sil = body | disc
    solid_a = feather((sil & ~glass).astype(np.float32), 1.0)
    # glass: next to nothing where it is clear, more where it catches the light, and a faint rim
    key = np.clip((dist - 5) / 22, 0, 1)
    rim = np.exp(-((rr - R * 0.985) / (R * 0.012)) ** 2)
    glass_a = np.clip(0.05 + 0.34 * key ** 1.3 + 0.2 * rim, 0, 0.5) * feather(sil.astype(np.float32), 1.5)
    a = np.clip(np.where(glass, np.maximum(glass_a, solid_a * (1 - feather(glass.astype(np.float32), 1.5))), solid_a), 0, 1)
    out_rgb = rgb.copy()
    e = (a > 0.02) & (a < 0.985)                                # the colour without the grey that shows through
    out_rgb[e] = np.clip((rgb[e] - (1 - a[e])[:, None] * field[e]) / a[e][:, None], 0, 255)
    im = Image.fromarray(np.dstack([out_rgb.astype(np.uint8), (a * 255).astype(np.uint8)]), 'RGBA')
    ays, axs = np.where(a > 0.03)
    bx0, bx1, by0, by1 = int(axs.min()), int(axs.max()) + 1, int(ays.min()), int(ays.max()) + 1
    im = im.crop((bx0, by0, bx1, by1)).transpose(Image.FLIP_LEFT_RIGHT)
    W, H = im.size

    def share(px, py):                                          # a point of the source, on the mirrored sprite
        return [round(1 - (px - bx0) / W, 4), round((py - by0) / H, 4)]
    meta = {k: share(*v) for k, v in POINTS.items()}
    meta['bubble'] = [*share(cx, cy), round(float(R) / W, 4)]
    im = im.resize((960, round(H * 960 / W)), Image.LANCZOS)
    meta['bubble'] = [float(v) for v in meta['bubble']]
    man['sub'] = {'w': im.size[0], 'h': im.size[1], **meta, 'bytes': save_pair(im, 'sub', 58, 82)}
    print('sub', im.size, man['sub'])


def still():
    """Snap on his feet and Snap in the submarine, for the page without
    motion: the pictures scripts/snap-still.mjs takes of the page's own world
    (.cache/snap-walk.png and .cache/snap-sub.png), each cropped to what is
    in it."""
    for src_name, name, key, width in (('snap-walk.png', 'snap-walk.webp', 'snapWalk', 440), ('snap-sub.png', 'snap-sub.webp', 'snapSub', 760)):
        im = Image.open(os.path.join(ROOT, '.cache', src_name)).convert('RGBA')
        a = np.asarray(im)[:, :, 3].astype(np.float32) / 255
        x0, y0, x1, y1 = bbox(a, 0.02, 6)
        im = resize_w(im.crop((x0, y0, x1, y1)), width)
        # (WebP only: the still page shows them in plain image elements, as it does Snap on the pier)
        im.save(out(name), quality=84, method=6)
        man[key] = {'w': im.size[0], 'h': im.size[1], 'bytes': {'webp': os.path.getsize(out(name))}}
        print('still', name, im.size, man[key]['bytes'])


def wreckseq():
    sequence(('t3', 't4'))


def beam():
    cutout('cut-beam.png', 'beam', 700, blur=3.5)


# ---------------------------------------------------------------- video
def ff(*args):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', *args], check=True)


def video():
    enc = ['-an', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-maxrate', '2.4M',
           '-bufsize', '4.8M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-g', '48']
    loops = {}
    ff('-i', src('z0-loop.mp4'), '-vf', 'scale=1600:-2:flags=lanczos', *enc, out('z0-loop.mp4'))
    ff('-i', src('z0-phone-loop.mp4'), '-vf', 'scale=720:-2:flags=lanczos', *enc, out('z0p-loop.mp4'))
    ff('-i', src('z1-loop.mp4'), '-vf', 'scale=1600:-2:flags=lanczos', *enc, out('z1-loop.mp4'))
    # Z1 phone: the same 62 to 86 percent window as the phone plate.
    ff('-i', src('z1-loop.mp4'), '-vf', f"crop=528:936:{round(PHONE['z1'][0] * 2212)}:0", *enc, out('z1p-loop.mp4'))
    ff('-i', src('z2-loop.mp4'), '-vf', 'scale=1600:-2:flags=lanczos', *enc, out('z2-loop.mp4'))
    ff('-i', src('z2-loop.mp4'), '-vf', f"crop=528:936:{round(PHONE['z2'][0] * 2212)}:0", *enc, out('z2p-loop.mp4'))
    for n in ('z0-loop', 'z0p-loop', 'z1-loop', 'z1p-loop', 'z2-loop', 'z2p-loop'):
        loops[n] = os.path.getsize(out(n + '.mp4'))
    man['loops'] = loops
    print('loops', loops)


SEQS = {'t2': ('t2-into-reef.mp4', sum(PHONE['z2']) / 2, sum(PHONE['z3']) / 2),
        't3': ('t3-into-wreck.mp4', sum(PHONE['z4x']) / 2, sum(PHONE['z4']) / 2),
        't4': ('t4-the-drop.mp4', sum(PHONE['z4x']) / 2, sum(PHONE['z5']) / 2)}


def sequence(keys=('t2',)):
    """The transitions as image sequences for scrubbing: 72 frames each (9 per
    second of the 8 s clip), for desktop and for phones. The phone window pans
    across the frame so it starts and ends where the neighbouring phone plates
    are cropped."""
    for key in keys:
        name, c0, c1 = SEQS[key]
        tmp = os.path.join(ROOT, '.cache', f'{key}-frames')
        os.makedirs(tmp, exist_ok=True)
        for f in os.listdir(tmp):
            os.remove(os.path.join(tmp, f))
        for old in os.listdir(os.path.join(OUT, key)) if os.path.isdir(os.path.join(OUT, key)) else []:
            os.remove(os.path.join(OUT, key, old))
        ff('-i', src(name), '-vf', 'fps=9', os.path.join(tmp, '%03d.png'))
        frames = sorted(f for f in os.listdir(tmp) if f.endswith('.png'))[:72]
        total = {'d': 0, 'p': 0}
        for i, f in enumerate(frames):
            im = Image.open(os.path.join(tmp, f)).convert('RGB')
            d = resize_w(im, 1600)
            d.save(out(f'{key}/d-{i:03d}.avif'), quality=48, speed=6)
            c = c0 + (c1 - c0) * i / max(1, len(frames) - 1)
            x0 = int(min(max(0, round(c * im.size[0] - 264)), im.size[0] - 528))
            p = im.crop((x0, 0, x0 + 528, im.size[1]))
            p.save(out(f'{key}/p-{i:03d}.avif'), quality=50, speed=6)
            total['d'] += os.path.getsize(out(f'{key}/d-{i:03d}.avif'))
            total['p'] += os.path.getsize(out(f'{key}/p-{i:03d}.avif'))
        man[key] = {'frames': len(frames), 'fps': 9, 'd': [1600, 677], 'p': [528, 936], 'bytes': total}
        pack_frames(key)
        print(key, man[key])


PACKS = 4


def pack_frames(key):
    """Pack a transition's frames into PACKS files per device, frame i in
    pack i % PACKS: the first pack to arrive already scrubs the whole move,
    coarsely, and the rest fill in between. Each pack is the frames' AVIF
    files end to end (it opens as its first frame, so it is still served as
    an image); the manifest has their lengths, in order."""
    n = man[key]['frames']
    lens = {}
    for dev in ('d', 'p'):
        lens[dev] = []
        for j in range(PACKS):
            blobs = [open(out(f'{key}/{dev}-{i:03d}.avif'), 'rb').read() for i in range(j, n, PACKS)]
            open(out(f'{key}/{dev}-pack{j}.avif'), 'wb').write(b''.join(blobs))
            lens[dev].append([len(b) for b in blobs])
        for i in range(n):
            os.remove(out(f'{key}/{dev}-{i:03d}.avif'))
    man[key]['packs'] = lens


def pack():
    """Pack transitions encoded before packing existed (their frames still on disk)."""
    for key in SEQS:
        if os.path.exists(out(f'{key}/d-000.avif')):
            pack_frames(key)
            print('packed', key)


def snap():
    """Snap's clips as stacked-alpha MP4s, plus where he stands in frame 0."""
    clips = {'m01': ('m01-wave', 0.0, None), 'm02': ('m02-gust', 1.2, None), 'm03': ('m03-hop', 3.0, None)}
    man['clips'] = {}
    for key, (name, start, end) in clips.items():
        o = out(f'snap-{key}.mp4')
        cmd = ['python3', MATTE, src(name + '.mp4'), src(name + '-cut.mp4'), o,
               '--width', '960', '--start', str(start)]
        if end is not None:
            cmd += ['--end', str(end)]
        subprocess.run(cmd, check=True)
        # Frame-0 matte bounding box, as shares of the frame.
        tmp = os.path.join(ROOT, '.cache', f'{key}-f0.png')
        ff('-i', o, '-frames:v', '1', tmp)
        s = np.asarray(Image.open(tmp).convert('L')).astype(np.float32) / 255
        h = s.shape[0] // 2
        a = s[h:]
        x0, y0, x1, y1 = bbox(a, 0.5)
        dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                             '-of', 'default=nw=1:nk=1', o]))
        man['clips'][key] = {'w': s.shape[1], 'h': h, 'duration': round(dur, 3),
                             'box': [round(x0 / s.shape[1], 4), round(y0 / h, 4),
                                     round(x1 / s.shape[1], 4), round(y1 / h, 4)],
                             'bytes': os.path.getsize(o)}
        print(key, man['clips'][key])


def snappost():
    """Crop each Snap clip sideways to the area he uses, record his box in the
    first and last frame (as shares of the cropped frame), and save a still of
    the first wave frame for reduced motion."""
    for key, c in man['clips'].items():
        o = out(f'snap-{key}.mp4')
        tmp = os.path.join(ROOT, '.cache', f'{key}-frames')
        os.makedirs(tmp, exist_ok=True)
        for f in os.listdir(tmp):
            os.remove(os.path.join(tmp, f))
        ff('-i', o, '-vf', 'fps=8', os.path.join(tmp, '%03d.png'))
        fr = sorted(os.listdir(tmp))
        W, H2 = Image.open(os.path.join(tmp, fr[0])).size
        H = H2 // 2
        def matte(fn):
            s = np.asarray(Image.open(os.path.join(tmp, fn)).convert('L')).astype(np.float32) / 255
            return s[H:2 * H]
        xs0, xs1 = W, 0
        for fn in fr:
            a = matte(fn)
            cols = np.nonzero((a > 0.1).any(axis=0))[0]
            if len(cols):
                xs0, xs1 = min(xs0, cols.min()), max(xs1, cols.max())
        x0 = int(max(0, xs0 - 24) // 2 * 2)
        x1 = int(min(W, xs1 + 25))
        w = int((x1 - x0) // 2 * 2)
        if w < 0.85 * W:
            ff('-i', o, '-vf', f'crop={w}:{2 * H}:{x0}:0', '-an', '-c:v', 'libx264', '-preset', 'slow',
               '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', o + '.tmp.mp4')
            os.replace(o + '.tmp.mp4', o)
        else:
            x0, w = 0, W
        def box(a):
            bx0, by0, bx1, by1 = (int(v) for v in bbox(a, 0.5))
            return [round((bx0 - x0) / w, 4), round(by0 / H, 4), round((bx1 - x0) / w, 4), round(by1 / H, 4)]
        c.update({'w': w, 'h': int(H), 'crop': [x0, int(W)], 'box': box(matte(fr[0])), 'boxEnd': box(matte(fr[-1])),
                  'bytes': os.path.getsize(o)})
        print(key, c)
        if key == 'm01':
            s = np.asarray(Image.open(os.path.join(tmp, fr[0])).convert('RGB')).astype(np.float32)
            rgb, a = s[:H, x0:x0 + w], s[H:2 * H, x0:x0 + w, 0] / 255
            st = rgba(rgb, a)
            bx0, by0, bx1, by1 = bbox(a, 0.05, 2)
            st = st.crop((bx0, by0, bx1, by1))
            man['snapStand'] = {'w': st.size[0], 'h': st.size[1], 'bytes': save_pair(st, 'snap-stand', 62, 84)}


def read_glb(path):
    """The one textured mesh of a GLB: positions and normals (with its node's
    transform applied), uvs, triangle indices, and its image's bytes."""
    import struct
    b = open(path, 'rb').read()
    jlen = struct.unpack_from('<I', b, 12)[0]
    gj = json.loads(b[20:20 + jlen])
    blen = struct.unpack_from('<I', b, 20 + jlen)[0]
    bin_ = b[28 + jlen:28 + jlen + blen]
    types = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    def acc(i):
        a = gj['accessors'][i]
        v = gj['bufferViews'][a['bufferView']]
        dt = np.dtype(types[a['componentType']])
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        off = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = v.get('byteStride', dt.itemsize * n)
        rows = np.frombuffer(bin_, np.uint8, count=stride * (a['count'] - 1) + dt.itemsize * n, offset=off)
        rows = np.lib.stride_tricks.as_strided(rows, shape=(a['count'], dt.itemsize * n), strides=(stride, 1)).copy()
        arr = rows.view(dt).reshape(a['count'], n)
        if a.get('normalized'):
            arr = np.maximum(arr.astype(np.float32) / np.iinfo(dt).max, -1)
        return arr
    def local(node):
        if 'matrix' in node:
            return np.array(node['matrix'], np.float64).reshape(4, 4).T
        t = np.eye(4)
        x, y, z, w = node.get('rotation', [0, 0, 0, 1])
        t[:3, :3] = [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]]
        t[:3, :3] *= np.array(node.get('scale', [1, 1, 1]))[None, :]
        t[:3, 3] = node.get('translation', [0, 0, 0])
        return t
    world = None
    def walk(i, parent):
        nonlocal world
        m = parent @ local(gj['nodes'][i])
        if gj['nodes'][i].get('mesh') is not None:
            assert world is None, 'expected one mesh node'
            world = m
        for c in gj['nodes'][i].get('children', []):
            walk(c, m)
    for r in gj['scenes'][gj.get('scene', 0)]['nodes']:
        walk(r, np.eye(4))
    prims = gj['meshes'][0]['primitives']
    assert len(gj['meshes']) == 1 and len(prims) == 1, 'expected one mesh with one primitive'
    at = prims[0]['attributes']
    P = acc(at['POSITION']).astype(np.float64) @ world[:3, :3].T + world[:3, 3]
    N = acc(at['NORMAL']).astype(np.float64) @ np.linalg.inv(world[:3, :3])
    N /= np.linalg.norm(N, axis=1, keepdims=True)
    iv = gj['bufferViews'][gj['images'][0]['bufferView']]
    image = bin_[iv.get('byteOffset', 0):iv.get('byteOffset', 0) + iv['byteLength']]
    return P, N, acc(at['TEXCOORD_0']).astype(np.float64), acc(prims[0]['indices']).ravel().astype(np.int64), image


def view_matrix(yaw, pitch, roll):
    """Turn a Tripo model's front (+x) to the viewer (+z), then yaw about y,
    pitch about x and roll about z (degrees): x right, y up, z to the viewer."""
    def ry(a): c, s = np.cos(a), np.sin(a); return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    def rx(a): c, s = np.cos(a), np.sin(a); return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    def rz(a): c, s = np.cos(a), np.sin(a); return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
    d = np.pi / 180
    return rz(roll * d) @ rx(pitch * d) @ ry(yaw * d) @ ry(-np.pi / 2)


def limbs_of(P, I, pitch=0.008, r_open=14, reach0=0.012):
    """Split a toy into its body and its limbs: the body is what survives a
    voxel opening that erodes away everything thinner than a limb; each limb
    is a connected piece of what is left (the mesh welded across its texture
    seams). Returns each vertex's limb label (-1: body) and its distance from
    the body, in model units."""
    import trimesh
    from scipy import sparse
    from scipy.sparse.csgraph import connected_components
    F = I.reshape(-1, 3)
    _, weld = np.unique(np.round(P / 1e-5).astype(np.int64), axis=0, return_inverse=True)
    weld = weld.ravel()
    vox = trimesh.Trimesh(P, F, process=False).voxelized(pitch).fill()
    grid = vox.matrix
    z, y, x = np.ogrid[-r_open:r_open + 1, -r_open:r_open + 1, -r_open:r_open + 1]
    ball = x * x + y * y + z * z <= r_open * r_open
    body = ndimage.binary_erosion(grid, ball)
    lab, n = ndimage.label(body)
    body = lab == (1 + int(np.argmax(ndimage.sum(body, lab, range(1, n + 1)))))
    body = ndimage.binary_dilation(body, ball) & grid
    dist = ndimage.distance_transform_edt(~body) * pitch
    ijk = np.round((np.c_[P, np.ones(len(P))] @ np.linalg.inv(vox.transform).T)[:, :3]).astype(int)
    ijk = np.clip(ijk, 0, np.array(grid.shape) - 1)
    d = dist[ijk[:, 0], ijk[:, 1], ijk[:, 2]]
    out = d > reach0
    nw = weld.max() + 1
    lw = np.zeros(nw, bool)
    lw[weld[out]] = True
    E = weld[np.r_[F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]]
    E = E[lw[E[:, 0]] & lw[E[:, 1]]]
    _, labw = connected_components(sparse.coo_matrix((np.ones(len(E)), (E[:, 0], E[:, 1])), shape=(nw, nw)), directed=False)
    lab = np.where(out, labw[weld], -1)
    for k in np.unique(lab[lab >= 0]):
        if (lab == k).sum() < 60:                  # a stray tuft of yarn, not a limb
            lab[lab == k] = -1
    return lab, d


# The view that shows Tripo's model as in the painting it was made from
# (yaw, pitch, roll, degrees; see view_matrix), fitted to the painting's
# outline by design/snap-world/tools/snap3d-view.py (IoU 0.92).
SNAP3D_VIEW = (-16.41, 45.82, 4.67)


def snap3d():
    """Snap in 3D on the chain: Tripo's model of the pose-2 painting with the
    chain edited out, seen as in the painting. Cut down for the web (about 35k
    triangles, a 2048 px texture) and shipped as one small binary, base64
    text since the preview host serves no binary files: quantized positions,
    normals and uvs, each vertex's limb and how far out along it it sits, and
    the triangles. All in his rig frame: x right, y up, z toward the viewer,
    in his heights on the chain (the pose-2 sprite's height), from the point
    in his raised claw the chain runs through. The manifest has the rest: the
    limbs (two eye stalks, the claw holding the chain, the other claw, the
    legs) with the points they swing about, and the eyes."""
    import base64
    tmp = os.path.join(ROOT, '.cache', 'snap-3d')
    os.makedirs(tmp, exist_ok=True)
    flat = os.path.join(tmp, 'flat.glb')
    subprocess.run(['npx', '--yes', '@gltf-transform/cli@4', 'optimize', src('snap-3d-tripo.glb'), flat,
                    '--compress', 'false', '--texture-compress', 'false',
                    '--simplify-ratio', '0.018', '--simplify-error', '0.01'], check=True, capture_output=True)
    P, N, UV, I, _ = read_glb(flat)
    image = read_glb(src('snap-3d-tripo.glb'))[4]           # the full 4096 px texture
    M = view_matrix(*SNAP3D_VIEW)
    P, N = P @ M.T, N @ M.T
    lab, d = limbs_of(P, I)
    tex = Image.open(__import__('io').BytesIO(image)).convert('RGB')
    tw, th = tex.size
    texel = np.asarray(tex)[np.clip((UV[:, 1] * th).astype(int), 0, th - 1), np.clip((UV[:, 0] * tw).astype(int), 0, tw - 1)].astype(np.float32)
    dark = texel.mean(1) < 45                                      # the black beads of his eyes
    # Name the limbs: the stalks carry the eyes, the claw up and left holds the
    # chain, the one out in front is the other claw; the rest are legs.
    limbs = []
    for k in np.unique(lab[lab >= 0]):
        ii = np.nonzero(lab == k)[0]
        c = P[ii].mean(0)
        kind = 'stalk' if dark[ii].sum() > 20 else 'clawL' if (c[0] < -0.2 and c[1] > 0.1) else 'clawR' if (c[2] > 0.25 and c[0] > 0.1) else 'leg'
        limbs.append({'k': int(k), 'kind': kind, 'ii': ii, 'c': c})
    order = {'stalk': 0, 'clawL': 1, 'clawR': 2, 'leg': 3}
    limbs.sort(key=lambda L: (order[L['kind']], L['c'][0]))
    kinds = [L['kind'] for L in limbs]
    assert kinds.count('stalk') == 2 and kinds.count('clawL') == 1 and kinds.count('clawR') == 1, kinds
    # The chain's way through the raised claw: the middle of the claw, side to
    # side, then the middle of its depth and height along that line.
    claw = P[limbs[kinds.index('clawL')]['ii']]
    gx = (claw[:, 0].min() + claw[:, 0].max()) / 2
    col = claw[np.abs(claw[:, 0] - gx) < 0.012]
    grip = np.array([gx, (col[:, 1].min() + col[:, 1].max()) / 2, (col[:, 2].min() + col[:, 2].max()) / 2])
    hm = (P[:, 1].max() - P[:, 1].min()) / (1 - 16 / 946)        # his height: the sprite's, whose frame pads him by 8 of 946 px
    R = (P - grip) / hm
    rig = np.full((len(P), 3), [255, 0, 0], np.uint8)
    out_limbs, eyes = [], []
    for j, L in enumerate(limbs):
        ii = L['ii']
        reach = float(d[ii].max())
        root = R[ii[d[ii] < 0.03]].mean(0)
        tip = R[ii[np.argmax(d[ii])]]
        rig[ii, 0] = j
        rig[ii, 1] = np.round(np.clip(d[ii] / reach, 0, 1) * 255)
        out_limbs.append({'kind': L['kind'], 'pivot': [round(float(v), 4) for v in root],
                          'dir': [round(float(v), 4) for v in (tip - root) / np.linalg.norm(tip - root)], 'reach': round(reach / hm, 4)})
        if L['kind'] == 'stalk':
            # The eye: a ball at the stalk's end (a sphere through its outer part), the bead on its front.
            X = R[ii[d[ii] > 0.55 * reach]]
            A = np.c_[2 * X, np.ones(len(X))]
            sol, *_ = np.linalg.lstsq(A, (X ** 2).sum(1), rcond=None)
            c, r = sol[:3], float(np.sqrt(sol[3] + sol[:3] @ sol[:3]))
            bead = R[ii[dark[ii]]].mean(0) - c
            dist = np.linalg.norm(R[ii] - c, axis=1)
            rig[ii, 2] = np.round(np.clip((r * 1.35 - dist) / (r * 0.35), 0, 1) * 255)
            eyes.append({'c': [round(float(v), 4) for v in c], 'r': round(r, 4), 'look': [round(float(v), 4) for v in bead / np.linalg.norm(bead)]})
    # Pack: int16 positions over their box, int8 normals, uint16 uvs, the rig bytes, uint16 triangles; each part 4-byte aligned.
    n = len(R)
    assert n < 65536
    lo, hi = R.min(0), R.max(0)
    qp = np.round((R - lo) / (hi - lo) * 65535 - 32768).astype(np.int16)
    qn = np.round(np.clip(N, -1, 1) * 127).astype(np.int8)
    qu = np.round(np.clip(UV, 0, 1) * 65535).astype(np.uint16)
    blob = bytearray()
    for part in (qp, qn, qu, rig, I.astype(np.uint16)):
        blob += part.tobytes()
        blob += b'\0' * (-len(blob) % 4)
    b64 = base64.b64encode(bytes(blob))
    open(out('snap-3d.txt'), 'wb').write(b64)
    for old in ('snap-3d-glb.txt',):
        if os.path.exists(out(old)):
            os.remove(out(old))
    tex_sizes = save_pair(tex.resize((2048, 2048), Image.LANCZOS), 'snap-3d', avif_q=60, webp_q=88)
    front = R[:, :2]
    man['snap3d'] = {
        'view': list(SNAP3D_VIEW), 'n': n, 'tris': len(I) // 3,
        'lo': [round(float(v), 5) for v in lo], 'hi': [round(float(v), 5) for v in hi],
        'box': [round(float(v), 4) for v in (front[:, 0].min(), front[:, 1].min(), front[:, 0].max(), front[:, 1].max())],
        'limbs': out_limbs, 'eyes': eyes,
        'bytes': len(b64), 'textureBytes': tex_sizes,
    }
    print('snap3d', {k: v for k, v in man['snap3d'].items() if k not in ('limbs', 'eyes')}, kinds)


steps = sys.argv[1:] or ['images', 'opening', 'sub', 'reef', 'wreck', 'twilight', 'vents', 'surface', 'video', 'sequence', 'wreckseq', 'snap', 'snappost', 'snap3d']
for st in steps:
    globals()[st]()
    json.dump(man, open(MAN_PATH + '.tmp', 'w'), indent=1)   # written whole or not at all
    os.replace(MAN_PATH + '.tmp', MAN_PATH)
print('wrote', os.path.relpath(MAN_PATH))
