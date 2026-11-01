"""Remplace les coins noirs arrondis de design/sac-source.jpg par le bleu
du fond (diffusion depuis les pixels voisins), pour obtenir une image pleine
page utilisable comme icône iPhone / Android.
Usage : python3 tools/fill-corners.py"""
import numpy as np
from PIL import Image
from pathlib import Path

d = Path(__file__).resolve().parent.parent / "design"
im = np.asarray(Image.open(d / "sac-source.jpg").convert("RGB")).astype(np.float64)
n = im.shape[0]
R, PAD = 236, 270            # rayon des coins (mesuré ≈ 222) + marge
yy, xx = np.mgrid[0:n, 0:n]
cx = np.clip(xx, R, n - 1 - R); cy = np.clip(yy, R, n - 1 - R)
mask = np.hypot(xx - cx, yy - cy) > R - 0.5          # hors du carré arrondi
# + liseré sombre de l'arrondi d'origine (pixels nettement plus foncés que le fond)
dark = im.sum(axis=2) < 172
near = np.hypot(xx - cx, yy - cy) > R - 40
mask |= dark & near
for _ in range(3):                                     # élargit le masque de 3 px
    m2 = mask.copy()
    m2[1:] |= mask[:-1]; m2[:-1] |= mask[1:]; m2[:, 1:] |= mask[:, :-1]; m2[:, :-1] |= mask[:, 1:]
    mask = m2 & near | mask
for (y0, x0) in [(0, 0), (0, n - PAD), (n - PAD, 0), (n - PAD, n - PAD)]:
    sl = (slice(y0, y0 + PAD), slice(x0, x0 + PAD))
    img, m = im[sl].copy(), mask[sl]
    img[m] = img[~m].mean(axis=0)
    for _ in range(1500):                              # diffusion (Laplace)
        p = np.pad(img, ((1, 1), (1, 1), (0, 0)), mode="edge")
        avg = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) / 4
        img[m] = avg[m]
    im[sl] = img
Image.fromarray(np.clip(im, 0, 255).astype(np.uint8)).save(d / "sac-plein.png")
print("sac-plein.png")
