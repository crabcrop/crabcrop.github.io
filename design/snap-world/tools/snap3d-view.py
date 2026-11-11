#!/usr/bin/env python3
"""The view that shows Tripo's 3D Snap as in the painting it was made from.

Tripo builds a model upright in its own frame, but the painting looks down on
Snap from above and a little to one side, so seen straight on the model does
not line up with it. This cuts Snap out of the chain-free painting (on the
clip grey, dropping the light halo the edit kept from the old matte) and
finds the turn (yaw, pitch, roll, degrees, after turning the model's +x side
to the viewer), scale and offset at which the model's outline best covers
his, by Nelder-Mead on the outlines' IoU. The model's outline comes from
splatting its raw vertices, which is fast and close enough.

encode-media.py keeps the result as SNAP3D_VIEW.

usage: snap3d-view.py MODEL.glb CHAIN-FREE-PAINTING.png [OUT_DIR]
       (the sources snap-3d-tripo.glb and snap-ride-free.png)
writes: OUT_DIR/snap3d-cutout.png (Snap on transparent), OUT_DIR/snap3d-view.png
        (the outlines overlaid: blue the painting, orange the model, grey both)
needs: numpy, scipy, Pillow, trimesh
"""
import os, sys, json
import numpy as np
import trimesh
from PIL import Image, ImageFilter
from scipy import ndimage, optimize


def cut_out(path):
    """Snap from the edit, on its flat grey, as an RGBA cut-out cropped to him."""
    im = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    bg = np.median(np.concatenate([im[0], im[-1], im[:, 0], im[:, -1]]), axis=0)
    fg = np.sqrt(((im - bg) ** 2).sum(2)) > 25
    lab, n = ndimage.label(fg)
    fg = lab == (1 + int(np.argmax(ndimage.sum(fg, lab, range(1, n + 1)))))
    fg = ndimage.binary_fill_holes(fg)
    fg = ndimage.binary_erosion(fg, iterations=6)          # the halo is about 6 px wide
    fg = ndimage.binary_opening(fg, iterations=2)
    a = np.asarray(Image.fromarray((fg * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32) / 255
    ys, xs = np.nonzero(a > 0.5)
    x0, x1, y0, y1 = xs.min() - 8, xs.max() + 9, ys.min() - 8, ys.max() + 9
    return Image.fromarray(np.dstack([im[y0:y1, x0:x1], a[y0:y1, x0:x1] * 255]).astype(np.uint8), 'RGBA')


def view_matrix(yaw, pitch, roll):
    """As in encode-media.py: +x to the viewer, then yaw (y), pitch (x), roll (z)."""
    def ry(a): c, s = np.cos(a), np.sin(a); return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    def rx(a): c, s = np.cos(a), np.sin(a); return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])
    def rz(a): c, s = np.cos(a), np.sin(a); return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])
    d = np.pi / 180
    return rz(roll * d) @ rx(pitch * d) @ ry(yaw * d) @ ry(-np.pi / 2)


def main():
    model, painting = sys.argv[1], sys.argv[2]
    out = sys.argv[3] if len(sys.argv) > 3 else '.'
    os.makedirs(out, exist_ok=True)
    cut = cut_out(painting)
    cut.save(os.path.join(out, 'snap3d-cutout.png'))
    sa_full = np.asarray(cut)[..., 3] > 128
    H0, W0 = sa_full.shape
    V = trimesh.load(model, force='mesh').vertices[::3].astype(np.float64)

    def setup(R):
        sa = np.asarray(Image.fromarray(sa_full.astype(np.uint8) * 255).resize((round(W0 * R), round(H0 * R)), Image.BILINEAR)) > 128
        H, W = sa.shape
        def outline(p):
            yaw, pitch, roll, k, ox, oy = p
            P = V @ view_matrix(yaw, pitch, roll)[:2].T
            x = np.round(ox * W + P[:, 0] * k * H).astype(int)
            y = np.round(oy * H - P[:, 1] * k * H).astype(int)
            ok = (x >= 0) & (x < W) & (y >= 0) & (y < H)
            m = np.zeros((H, W), bool)
            m[y[ok], x[ok]] = True
            return ndimage.binary_fill_holes(ndimage.binary_closing(m, iterations=2))
        def loss(p):
            m = outline(p)
            return -(m & sa).sum() / max(1, (m | sa).sum())
        return sa, outline, loss

    # Coarse: the best of a grid of turns, each placed by its box; then Nelder-Mead from there.
    sa, outline, loss = setup(300 / H0)
    H, W = sa.shape
    ys, xs = np.nonzero(sa)
    def placed(yaw, pitch):
        P = V @ view_matrix(yaw, pitch, 0)[:2].T
        k = (ys.max() - ys.min()) / np.ptp(P[:, 1]) / H
        ox = ((xs.min() + xs.max()) / 2 - (P[:, 0].min() + P[:, 0].max()) / 2 * k * H) / W
        oy = ((ys.min() + ys.max()) / 2 + (P[:, 1].min() + P[:, 1].max()) / 2 * k * H) / H
        return np.array([yaw, pitch, 0, k, ox, oy])
    starts = sorted((loss(placed(y, p)), y, p) for y in range(-50, 51, 10) for p in range(-20, 61, 10))
    best = None
    for _, y, p in starts[:3]:
        x0 = placed(y, p)
        steps = np.array([6, 6, 4, 0.03 * x0[3], 0.02, 0.02])
        for _ in range(3):
            sim = np.array([x0] + [x0 + np.eye(6)[i] * steps[i] for i in range(6)])
            r = optimize.minimize(loss, x0, method='Nelder-Mead', options={'initial_simplex': sim, 'xatol': 1e-3, 'fatol': 1e-5, 'maxfev': 500})
            x0, steps = r.x, steps * 0.4
        if best is None or r.fun < best[0]:
            best = (r.fun, r.x)
    sa2, outline2, _ = setup(1.0)
    m = outline2(best[1])
    iou = float((m & sa_full).sum() / (m | sa_full).sum())
    vis = np.zeros((H0, W0, 3), np.uint8)
    vis[sa_full] = (90, 90, 255)
    vis[m] = (255, 120, 80)
    vis[sa_full & m] = (230, 230, 230)
    Image.fromarray(vis).save(os.path.join(out, 'snap3d-view.png'))
    yaw, pitch, roll = (round(float(v), 2) for v in best[1][:3])
    print(json.dumps({'SNAP3D_VIEW': [yaw, pitch, roll], 'iou': round(iou, 4)}))


if __name__ == '__main__':
    main()
