#!/usr/bin/env python3
"""Bake the hand-painted source art in art/textures/ into what the game loads from
public/textures/. Run it after changing a source image:

    python3 tools/bake_textures.py        (needs Pillow and numpy)

The sources are large PNGs and are not shipped. What comes out:

  surface_<name>.webp   1024 x 1024 grey tiles for the paint pass: the brushwork of a kind of
                        surface. Centred on mid-grey (0.5 changes nothing) and brought to a
                        common strength, so the shader treats them all alike. Among them the
                        paper's grain and the pen hatching a drained place is drawn with.
  clouds.webp           2048 x 1024 grey: the cumulus atlas's light (left half) and its
                        coverage (right half), two columns by three rows of clouds each.

  canopy.webp           1536 x 768 grey: two repeating sheets of leaf clusters side by side,
                        broadleaf on the left and conifer sprays on the right, stamped from the
                        painted clusters. A tree's crown is lit, shaded and cut out by them.
  plants.webp           4608 x 768 grey: the meadow's painted plants, three panels side by side:
                        how light each is, how much it covers, and what it is (black leaf and
                        stem, grey petal, white flower centre). Each panel is two rows of four
                        cells: grass tufts above, wildflowers below, each standing on the
                        middle of its cell's foot.

  interiors.webp        1536 x 1024 colour: painted rooms in lamplight, six columns by four rows,
                        seen through windows that are lit at night.

The foliage and plant sources are painted grey (or, the flowers, green and white) on flat
magenta, which is keyed out here. The rest of the source art (the far silhouettes) is kept in
art/textures/ for the work that will use it.
"""
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'art', 'textures')
OUT = os.path.join(ROOT, 'public', 'textures')

# name -> spread (standard deviation, 0..1) the baked tile is brought to
SURFACES = {
    'drybrush': 0.085,
    'plaster': 0.07,
    'stone': 0.075,
    'roof_clay': 0.085,
    'roof_slate': 0.075,
    'paving': 0.08,
    'timber': 0.08,
    # the page a drained place is drawn on: the paper's grain, and a pen's hatching kept as
    # it was drawn (white paper, dark lines; a spread of 0 leaves a tile as it is)
    'paper': 0.05,
    'hatching': 0,
}


def grey(path):
    return np.asarray(Image.open(path).convert('L')).astype(np.float32) / 255


def save_grey(a, path):
    im = Image.fromarray(np.clip(a * 255 + 0.5, 0, 255).astype(np.uint8), 'L')
    im.save(path, 'WEBP', quality=90, method=6)
    return os.path.getsize(path)


def wrap_blur(a):
    """A slight blur that wraps round the tile's edges, so the seam stays shut."""
    for axis in (0, 1):
        a = 0.6 * a + 0.2 * (np.roll(a, 1, axis) + np.roll(a, -1, axis))
    return a


def bake_surface(name, spread):
    a = grey(os.path.join(SRC, name + '.png'))
    # the faintest tiles have only a few dozen grey levels: smooth them before they are
    # stretched, or the steps between levels show
    a = wrap_blur(a)
    if spread:
        a = 0.5 + (a - a.mean()) * (spread / max(float(a.std()), 1e-4))
    return save_grey(a, os.path.join(OUT, f'surface_{name}.webp'))


def bake_clouds():
    im = Image.open(os.path.join(SRC, 'clouds.png')).convert('LA').resize((1024, 1024), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) / 255
    light, cover = a[..., 0], a[..., 1]
    # under no cloud the light is whatever the painter left there: make it the cloud's mid tone,
    # so filtering at a cloud's edge never drags a dark or bright fringe in
    light = np.where(cover > 0.02, light, 0.7)
    return save_grey(np.concatenate([light, cover], axis=1), os.path.join(OUT, 'clouds.webp'))


LUM = np.array([0.3, 0.59, 0.11], dtype=np.float32)
# the size the foliage and plant art was painted at, before it was scaled up without filtering
NATIVE = 1254


def keyed(name):
    """A source painted on flat magenta: its colour with the magenta taken back out (h x w x 3)
    and how much of each pixel it covers (h x w), at the size it was painted."""
    im = Image.open(os.path.join(SRC, name + '.png')).convert('RGB')
    if im.size[0] != NATIVE:
        im = im.resize((NATIVE, NATIVE), Image.NEAREST)
    a = np.asarray(im).astype(np.float32) / 255
    back = np.median(a[:40, :40].reshape(-1, 3), axis=0)
    # magenta is red and blue over green: how far a pixel is towards the background's
    over = np.minimum(a[..., 0] - a[..., 1], a[..., 2] - a[..., 1])
    cover = 1 - np.clip(over / min(back[0] - back[1], back[2] - back[1]), 0, 1)
    colour = np.clip((a - (1 - cover)[..., None] * back) / np.maximum(cover, 1e-3)[..., None], 0, 1)
    cover = np.where(cover < 0.04, 0, cover)
    return colour, cover


def sprites(name):
    """The four pictures of a two by two sheet, each cropped to what is painted: (colour, cover)."""
    colour, cover = keyed(name)
    half = NATIVE // 2
    out = []
    for row in range(2):
        for col in range(2):
            c = cover[row * half:(row + 1) * half, col * half:(col + 1) * half]
            ys, xs = np.where(c > 0.5)
            box = np.s_[row * half + ys.min():row * half + ys.max() + 1, col * half + xs.min():col * half + xs.max() + 1]
            out.append((colour[box], cover[box]))
    return out


def canopy_sheet(name, size, count, widths, turn, rng):
    """A repeating sheet of leaf clusters, light on top and dark underneath, with dark gaps
    between them: each cluster stamped at a random place, size and tilt, wrapping at the edges."""
    sheet = np.full((size, size), 0.14, dtype=np.float32)
    stamps = []
    for colour, cover in sprites(name):
        lum = colour @ LUM
        # the painting's three tones (about 0.33, 0.57, 0.72) spread to shade, body and light
        value = np.clip(0.36 + (lum - 0.33) / 0.39 * 0.44, 0.2, 0.9)
        stamps.append(Image.fromarray(np.dstack([value, cover]).astype(np.float32).__mul__(255).astype(np.uint8), 'LA'))
    for i in range(count):
        stamp = stamps[i % len(stamps)]
        width = int(rng.uniform(*widths) * size)
        stamp = stamp.resize((width, max(1, round(width * stamp.size[1] / stamp.size[0]))), Image.LANCZOS)
        if rng.random() < 0.5:
            stamp = stamp.transpose(Image.FLIP_LEFT_RIGHT)
        stamp = stamp.rotate(rng.uniform(-turn, turn), resample=Image.BICUBIC, expand=True)
        a = np.asarray(stamp).astype(np.float32) / 255
        h, w = a.shape[:2]
        x0, y0 = int(rng.integers(0, size)), int(rng.integers(0, size))
        ys = (np.arange(h) + y0) % size
        xs = (np.arange(w) + x0) % size
        under = sheet[np.ix_(ys, xs)]
        sheet[np.ix_(ys, xs)] = under * (1 - a[..., 1]) + a[..., 0] * a[..., 1]
    return sheet


def bake_canopy():
    rng = np.random.default_rng(0x1eaf)
    size = 768
    broadleaf = canopy_sheet('leaf_broadleaf', size, 46, (0.2, 0.34), 28, rng)
    conifer = canopy_sheet('leaf_conifer', size, 54, (0.2, 0.36), 16, rng)
    return save_grey(np.concatenate([broadleaf, conifer], axis=1), os.path.join(OUT, 'canopy.webp'))


def spread(values, known, rounds=8):
    """Carry painted values out into the empty pixels round them, so that filtering at a
    plant's edge finds its own colour there and not whatever the empty cell held."""
    known = known.copy()
    # (what lies under no paint is only the keyed-out background's noise)
    values = np.where(known, values, 0).astype(np.float32)
    for _ in range(rounds):
        total = np.zeros_like(values)
        seen = np.zeros_like(values)
        for axis, step in ((0, 1), (0, -1), (1, 1), (1, -1)):
            total += np.roll(values * known, step, axis)
            seen += np.roll(known.astype(np.float32), step, axis)
        fill = (~known) & (seen > 0)
        values[fill] = total[fill] / seen[fill]
        known = known | fill
    return values


def bake_plants():
    cell = 384
    value = np.zeros((2 * cell, 4 * cell), dtype=np.float32)
    cover = np.zeros_like(value)
    what = np.zeros_like(value)
    for row, name in enumerate(('grass_tufts', 'flowers')):
        for col, (colour, c) in enumerate(sprites(name)):
            h, w = c.shape
            scale = min((cell - 12) / w, (cell - 8) / h)
            size = (max(1, round(w * scale)), max(1, round(h * scale)))
            lum = colour @ LUM
            top = colour.max(-1)
            sat = (top - colour.min(-1)) / np.maximum(top, 1e-4)
            # a flower's petals are painted white to pale grey, its centre yellow, the rest green
            petal = (sat < 0.2) & (lum > 0.55) if row == 1 else np.zeros_like(c, dtype=bool)
            centre = (colour[..., 0] > colour[..., 2] + 0.25) & (colour[..., 0] > colour[..., 1] + 0.02) & (row == 1)
            if petal.any():
                # the head is the band of rows that are mostly petal: pale or yellowish flecks
                # down the stem are still stem
                rows = petal.sum(axis=1)
                ys = np.where(rows > 0.3 * rows.max())[0]
                head = np.zeros_like(petal)
                head[ys.min():ys.max() + 1] = True
                centre &= head
                petal &= head
            kind = np.where(centre, 1.0, np.where(petal, 0.5, 0.0)).astype(np.float32)
            known = c > 0.5
            layers = []
            # (what a pixel is, is only sure where it is all paint: its edge takes its neighbour's)
            for a in (spread(lum, known), c, spread(kind, c > 0.95, 14)):
                im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8), 'L')
                layers.append(np.asarray(im.resize(size, Image.LANCZOS)).astype(np.float32) / 255)
            # standing on the middle of the cell's foot
            x0 = col * cell + (cell - size[0]) // 2
            y0 = (row + 1) * cell - 2 - size[1]
            box = np.s_[y0:y0 + size[1], x0:x0 + size[0]]
            value[box], cover[box], what[box] = layers
    # (empty cell corners take the plant's mid tone, harmless under no cover)
    value = np.where(cover > 0.01, value, 0.55)
    return save_grey(np.concatenate([value, cover, what], axis=1), os.path.join(OUT, 'plants.webp'))


def bake_interiors():
    im = Image.open(os.path.join(SRC, 'window_interiors.png')).convert('RGB').resize((1536, 1024), Image.LANCZOS)
    path = os.path.join(OUT, 'interiors.webp')
    im.save(path, 'WEBP', quality=82, method=6)
    return os.path.getsize(path)


def main():
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for name, spread_ in SURFACES.items():
        size = bake_surface(name, spread_)
        total += size
        print(f'surface_{name}.webp  {size / 1024:.0f} KB')
    for name, bake in (
        ('clouds', bake_clouds),
        ('canopy', bake_canopy),
        ('plants', bake_plants),
        ('interiors', bake_interiors),
    ):
        size = bake()
        total += size
        print(f'{name}.webp  {size / 1024:.0f} KB')
    print(f'total {total / 1024:.0f} KB')


if __name__ == '__main__':
    sys.exit(main())
