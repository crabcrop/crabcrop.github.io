#!/usr/bin/env python3
"""Encode the dive's media from the Higgsfield sources in .cache/sources
(fetch them first with scripts/fetch-sources.sh) into ../preview/dive/media,
and write media/manifest.json with the numbers the page needs.

usage: python3 scripts/encode-media.py [images] [reef] [video] [sequence] [snap] [snappost] [scuttle] [claw]
       (no argument runs every step)
needs: ffmpeg, numpy, scipy, Pillow with AVIF support
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
         'z3_2': (0.55, 0.79), 'z3_3': (0.22, 0.46), 'z3_4': (0.20, 0.44), 'z3b': (0.55, 0.79)}
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

    # Snap hugging the chain: pose 2 of the C03 sheet (top middle cell), on white.
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
    spr = resize_w(spr, 640)
    s = save_pair(spr, 'snap-chain', avif_q=60, webp_q=82)
    man['snapChain'] = {'w': spr.size[0], 'h': spr.size[1],
                        'chainX': round((chain_x - x0) / (x1 - x0), 4),
                        'linkLen': 0.134,
                        'chainTop': round((chain_rows.min() - y0) / (y1 - y0), 4),
                        'chainBottom': round((chain_rows.max() - y0) / (y1 - y0), 4), 'bytes': s}
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


def sequence():
    """The transitions as image sequences for scrubbing: 72 frames each (9 per
    second of the 8 s clip), for desktop and for phones. The phone window pans
    across the frame so it starts and ends where the neighbouring phone plates
    are cropped."""
    seqs = {'t1': ('t1-plunge.mp4', 0.5, sum(PHONE['z1']) / 2),
            't2': ('t2-into-reef.mp4', sum(PHONE['z2']) / 2, sum(PHONE['z3']) / 2)}
    for key, (name, c0, c1) in seqs.items():
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
        print(key, man[key])


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


def snappost(only=None):
    """Crop each Snap clip sideways to the area he uses, record his box in the
    first and last frame (as shares of the cropped frame), and save a still of
    the first wave frame for reduced motion."""
    for key, c in man['clips'].items():
        if only and key not in only:
            continue
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


def scuttle():
    """M04, Snap's sideways walk on the spot, for the reef. Only this clip is
    touched, so the other clips' entries (and M02's print track) stay as they are."""
    o = out('snap-m04.mp4')
    subprocess.run(['python3', MATTE, src('m04-scuttle.mp4'), src('m04-scuttle-cut.mp4'), o,
                    '--width', '960', '--start', '0'], check=True)
    dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                         '-of', 'default=nw=1:nk=1', o]))
    man['clips']['m04'] = {'duration': round(dur, 3)}
    snappost(only={'m04'})
    # His right claw through the cycle (rightmost matte column between 50 and
    # 80 percent of the height), as shares of the cropped frame: the reef chain
    # hangs from it.
    c = man['clips']['m04']
    tmp = os.path.join(ROOT, '.cache', 'm04-track')
    os.makedirs(tmp, exist_ok=True)
    for f in os.listdir(tmp):
        os.remove(os.path.join(tmp, f))
    ff('-i', o, '-vf', 'fps=12', os.path.join(tmp, '%03d.png'))
    track = []
    for i, fn in enumerate(sorted(os.listdir(tmp))):
        s = np.asarray(Image.open(os.path.join(tmp, fn)).convert('L')).astype(np.float32) / 255
        a = s[c['h']:2 * c['h']]
        band = a[int(0.5 * c['h']):int(0.8 * c['h'])]
        x1 = int(np.nonzero((band > 0.5).any(axis=0))[0].max())
        rows = np.nonzero(band[:, max(0, x1 - 30):x1 + 1].max(axis=1) > 0.5)[0]
        track.append([round(i / 12, 3), round((x1 - 14) / c['w'], 4), round(float(rows.mean() / c['h'] + 0.5), 4)])
    c['claw'] = track


def claw():
    """M05, Snap's claw snap (three clicks beside his head), for his visits to
    the cards. Only this clip is touched. Its sparkles are lost in the matte, so
    the page draws them at the clicks."""
    o = out('snap-m05.mp4')
    subprocess.run(['python3', MATTE, src('m05-snap.mp4'), src('m05-snap-cut.mp4'), o,
                    '--width', '960', '--start', '0'], check=True)
    dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                         '-of', 'default=nw=1:nk=1', o]))
    man['clips']['m05'] = {'duration': round(dur, 3), 'clicks': [1.5, 2.0, 2.5, 3.0]}
    snappost(only={'m05'})


steps = sys.argv[1:] or ['images', 'reef', 'video', 'sequence', 'snap', 'snappost', 'scuttle', 'claw']
for st in steps:
    globals()[st]()
    json.dump(man, open(MAN_PATH, 'w'), indent=1)
print('wrote', os.path.relpath(MAN_PATH))
