#!/usr/bin/env python3
"""Turn a Snap clip on grey plus Higgsfield's background-removed copy (Snap on
black, no alpha channel) into a stacked-alpha MP4 for the site: colour in the
top half, the matte as grey in the bottom half, audio stripped. In WebGL, sample
the top half for colour and the bottom half for alpha.

The matte is the remover's silhouette, sealed with a small close, plus any
enclosed hole that is dark or not grey in the original (the black eyes, which
the remover drops because they are black on black), plus a 6 px rescue ring
(at 960 wide) for yarn or print the remover cut into (never the grey floor
shadow), feathered by about a pixel. Edge colours are pulled away from the grey
background so no grey halo shows.

usage: snap-matte.py ORIGINAL.mp4 CUTOUT.mp4 OUT.mp4 [--width 960] [--start S] [--end S]
needs: ffmpeg, numpy, scipy, Pillow
"""
import argparse, subprocess, json
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage


def silhouette(O, C, W):
    """Snap's hard silhouette in one frame, from the grey original O and the
    remover's copy C (both H x W x 3 float32), and the grey it was shot on."""
    sil = C.max(axis=2) > 12
    sil = ndimage.binary_closing(sil, structure=np.ones((3, 3)), iterations=1)
    bgpix = O[~ndimage.binary_dilation(sil, iterations=6)]
    G = np.median(bgpix, axis=0) if len(bgpix) else np.array([140, 149, 156], np.float32)
    D = O - G
    # yarn, print or camera, not grey background or its neutral shadow:
    # clearly lighter than the grey, or clearly coloured
    chroma = O.max(axis=2) - O.min(axis=2)
    notbg = (D.mean(axis=2) > 40) | (chroma > 45)
    # enclosed holes: keep the dark ones (the eyes) and the ones that aren't grey
    lab, k = ndimage.label(~sil)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    if k:
        idx = np.arange(1, k + 1)
        dark = ndimage.mean(O.mean(axis=2), lab, idx) < 100
        other = ndimage.mean(notbg.astype(np.float32), lab, idx) > 0.5
        sil |= np.isin(lab, idx[(dark | other) & ~np.isin(idx, border)])
    # edge rescue: a thin ring outside the silhouette, where the remover cut into the subject
    ring = ndimage.binary_dilation(sil, iterations=max(1, round(6 * W / 960))) & ~sil
    sil |= ring & notbg
    return sil, G


def finish(O, sil, G, W):
    """Feather the silhouette into a matte and pull the edge colours away from the grey."""
    a = np.asarray(Image.fromarray((sil * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(0.8 * W / 960))).astype(np.float32) / 255
    F = O.copy(); e = (a > 0.05) & (a < 0.95)
    F[e] = np.clip((O[e] - (1 - a[e])[:, None] * G) / a[e][:, None], 0, 255)
    F[a <= 0.05] = 0
    return F, a


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('original'); ap.add_argument('cutout'); ap.add_argument('out')
    ap.add_argument('--width', type=int, default=960)
    ap.add_argument('--start', type=float, default=0.0)
    ap.add_argument('--end', type=float, default=None)
    args = ap.parse_args()

    probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,r_frame_rate', '-of', 'json', args.original]))['streams'][0]
    W = args.width - args.width % 2
    H = int(round(probe['height'] * W / probe['width'] / 2)) * 2
    fps = probe['r_frame_rate']

    def reader(path):
        cmd = ['ffmpeg', '-v', 'error', '-ss', str(args.start)]
        if args.end is not None: cmd += ['-to', str(args.end)]
        cmd += ['-i', path, '-vf', f'scale={W}:{H}:flags=lanczos', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']
        return subprocess.Popen(cmd, stdout=subprocess.PIPE)

    ro, rc = reader(args.original), reader(args.cutout)
    enc = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
        '-s', f'{W}x{H * 2}', '-r', fps, '-i', '-', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', args.out], stdin=subprocess.PIPE)

    n = 0; size = W * H * 3
    while True:
        bo, bc = ro.stdout.read(size), rc.stdout.read(size)
        if len(bo) < size or len(bc) < size: break
        O = np.frombuffer(bo, np.uint8).reshape(H, W, 3).astype(np.float32)
        C = np.frombuffer(bc, np.uint8).reshape(H, W, 3).astype(np.float32)
        sil, G = silhouette(O, C, W)
        F, a = finish(O, sil, G, W)
        frame = np.concatenate([F, np.repeat((a * 255)[..., None], 3, axis=2)], axis=0)
        enc.stdin.write(np.clip(frame, 0, 255).astype(np.uint8).tobytes()); n += 1
    enc.stdin.close(); enc.wait(); ro.wait(); rc.wait()
    print(f'{args.out}: {n} frames, {W}x{H} colour over {W}x{H} matte, {fps} fps')


if __name__ == '__main__':
    main()
