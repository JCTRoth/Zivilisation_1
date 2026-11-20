#!/usr/bin/env python3
"""Generate the PWA icon set from the existing favicon.

The web app manifest needs a 192x192 and a 512x512 raster icon for the
browser to offer "Install", plus a maskable variant whose artwork stays
inside the safe zone (the outer 20% of the canvas may be cropped by the
launcher).

The icons are committed to `public/icons/` so the production build never
depends on Pillow being installed. Re-run this script after changing the
source artwork:

    python3 tools/pwa/generate_icons.py

Pillow is already a dependency of the tile generator, so nothing new is
pulled into the toolchain.
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "public" / "favicon.png"
OUT_DIR = ROOT / "public" / "icons"

# The theme colour the manifest advertises; the maskable icon uses it as its
# background so the artwork does not need a transparent border.
THEME = (11, 17, 22, 255)

# (filename, size, maskable)
TARGETS = [
    ("icon-192.png", 192, False),
    ("icon-512.png", 512, False),
    ("maskable-512.png", 512, True),
    ("apple-touch-icon-180.png", 180, False),
]


def square_crop(image: Image.Image) -> Image.Image:
    """Crop the source artwork to a centred square."""
    width, height = image.size
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    return image.crop((left, top, left + side, top + side))


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"source artwork not found: {SOURCE}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE).convert("RGBA")
    square = square_crop(source)

    for name, size, maskable in TARGETS:
        target = square.resize((size, size), Image.LANCZOS)
        if maskable:
            # Maskable icons are cropped to a circle on some launchers, so the
            # artwork is scaled into the middle 60% and padded with the theme
            # colour.
            canvas = Image.new("RGBA", (size, size), THEME)
            inner = int(size * 0.6)
            artwork = target.resize((inner, inner), Image.LANCZOS)
            offset = (size - inner) // 2
            canvas.alpha_composite(artwork, (offset, offset))
            target = canvas
        path = OUT_DIR / name
        target.save(path, format="PNG", optimize=True)
        print(f"{os.path.relpath(path, ROOT)}  {size}x{size}  {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
