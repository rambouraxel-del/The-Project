#!/usr/bin/env python3
"""Transforme art_raw/*.png en ressources web optimisées dans public/assets/."""
import os, glob
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), "..")
RAW = os.path.join(ROOT, "art_raw")
OUT = os.path.join(ROOT, "public", "assets")
for d in ("tex", "spr", "tok"):
    os.makedirs(os.path.join(OUT, d), exist_ok=True)

def seamless(img, size=1024):
    """Rend une texture tileable : fusionne l'image avec sa version décalée d'un demi-côté."""
    im = img.convert("RGB").resize((size, size), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32)
    b = np.roll(a, (size // 2, size // 2), axis=(0, 1))
    t = np.linspace(0, 1, size, dtype=np.float32)
    w1 = np.sin(np.pi * t) ** 2  # 0 aux bords, 1 au centre
    w = np.outer(w1, w1)[..., None]
    # pondération douce : le centre garde l'original, les bords prennent le décalé
    w = np.clip(w * 1.6, 0, 1)
    out = a * w + b * (1 - w)
    # corrige la dérive de luminosité (moyenne locale) pour limiter la répétition visible
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))

def crop_alpha(img, pad=0.04):
    img = img.convert("RGBA")
    a = np.asarray(img)[..., 3]
    ys, xs = np.where(a > 12)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    w, h = x1 - x0, y1 - y0
    p = int(max(w, h) * pad)
    img = img.crop((x0, y0, x1, y1))
    canvas = Image.new("RGBA", (w + 2 * p, h + 2 * p), (0, 0, 0, 0))
    canvas.paste(img, (p, p))
    return canvas

for f in sorted(glob.glob(os.path.join(RAW, "tex_*.png"))):
    n = os.path.basename(f)[:-4]
    seamless(Image.open(f)).save(os.path.join(OUT, "tex", n[4:] + ".jpg"), quality=88)
    print("tex", n)

for f in sorted(glob.glob(os.path.join(RAW, "spr_*.png"))):
    n = os.path.basename(f)[:-4]
    im = crop_alpha(Image.open(f))
    im.thumbnail((640, 640), Image.LANCZOS)
    im.save(os.path.join(OUT, "spr", n[4:] + ".webp"), quality=86, method=6)
    print("spr", n, im.size)

for f in sorted(glob.glob(os.path.join(RAW, "tok_*.png"))):
    n = os.path.basename(f)[:-4]
    im = crop_alpha(Image.open(f), pad=0.0)
    w, h = im.size
    s = 340 / max(w, h)
    im = im.resize((round(w * s), round(h * s)), Image.LANCZOS)
    canvas = Image.new("RGBA", (360, 360), (0, 0, 0, 0))
    # centre le jeton ; la base (épaisseur) tombe un peu plus bas que le centre visuel
    canvas.paste(im, ((360 - im.size[0]) // 2, (360 - im.size[1]) // 2), im)
    canvas.save(os.path.join(OUT, "tok", n[4:] + ".webp"), quality=90, method=6)
    print("tok", n, im.size)
