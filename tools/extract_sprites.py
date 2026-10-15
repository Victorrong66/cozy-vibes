"""Cut the character animation frames out of art/characters-sheet.png.

The sheet has two characters side by side (boy on the left, girl on the right),
each with four rows: down, up, left, right. The gray background and the soft
drop shadow are removed, and every frame is lined up on the character's feet so
the walk cycle doesn't jitter.

Output per character, in public/assets/characters/:
  <id>.png   one row per direction, one column per frame, all cells the same size
  <id>.json  cell size, frame counts and where the feet are inside a cell

Run from the repo root:  python3 tools/extract_sprites.py
"""

import json
import os
import sys
from collections import deque

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEET = os.path.join(ROOT, 'art', 'characters-sheet.png')
OUT = os.path.join(ROOT, 'public', 'assets', 'characters')

DIRS = ['down', 'up', 'left', 'right']
# Where each direction's row of sprites sits on the sheet (y ranges skip the
# frame-number labels underneath).
ROWS = [(85, 250), (305, 475), (530, 702), (760, 932)]
CHARACTERS = [
    {'id': 'boy', 'name': 'Boy', 'x': (100, 770), 'frames': 7},
    {'id': 'girl', 'name': 'Girl', 'x': (895, 1515), 'frames': 6},
]


def background_mask(rgb):
    """Pixels that look like the gray backdrop or its shadow (neutral, mid-dark)."""
    r, g, b = (rgb[..., i].astype(int) for i in range(3))
    spread = np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)
    lum = (r + g + b) / 3
    return (spread <= 6) & (lum >= 44) & (lum <= 92)


def flood_from_edges(bgish):
    """Only background-coloured pixels connected to the region's edge are removed,
    so dark clothes inside the outline stay put."""
    h, w = bgish.shape
    out = np.zeros_like(bgish)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if bgish[y, x] and not out[y, x]:
                out[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if bgish[y, x] and not out[y, x]:
                out[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < h and 0 <= nx < w and bgish[ny, nx] and not out[ny, nx]:
                out[ny, nx] = True
                q.append((ny, nx))
    return out


def split_columns(alpha, expected):
    """Split a row into sprites using empty columns between them."""
    cols = alpha.sum(axis=0) > 0
    spans, start = [], None
    for x, filled in enumerate(cols):
        if filled and start is None:
            start = x
        elif not filled and start is not None:
            spans.append([start, x])
            start = None
    if start is not None:
        spans.append([start, len(cols)])
    # Drop specks, then merge pieces that are closer than a sprite is wide.
    spans = [s for s in spans if s[1] - s[0] >= 12 and alpha[:, s[0]:s[1]].sum() > 40]
    merged = []
    for s in spans:
        if merged and s[0] - merged[-1][1] < 6:
            merged[-1][1] = s[1]
        else:
            merged.append(s)
    if len(merged) != expected:
        sys.exit(f'expected {expected} sprites in a row, found {len(merged)}: {merged}')
    return merged


def keep_largest_blob(alpha):
    """Remove stray specks that aren't attached to the character."""
    h, w = alpha.shape
    seen = np.zeros_like(alpha)
    best = None
    for sy in range(h):
        for sx in range(w):
            if alpha[sy, sx] and not seen[sy, sx]:
                blob = []
                q = deque([(sy, sx)])
                seen[sy, sx] = True
                while q:
                    y, x = q.popleft()
                    blob.append((y, x))
                    for ny in (y - 1, y, y + 1):
                        for nx in (x - 1, x, x + 1):
                            if 0 <= ny < h and 0 <= nx < w and alpha[ny, nx] and not seen[ny, nx]:
                                seen[ny, nx] = True
                                q.append((ny, nx))
                if best is None or len(blob) > len(best):
                    best = blob
    out = np.zeros_like(alpha)
    for y, x in best or []:
        out[y, x] = True
    return out


def main():
    sheet = np.array(Image.open(SHEET).convert('RGB'))
    os.makedirs(OUT, exist_ok=True)

    for ch in CHARACTERS:
        x0, x1 = ch['x']
        frames = {}  # dir -> list of (rgba, centerX, feetY) in frame-local coords
        for d, (y0, y1) in zip(DIRS, ROWS):
            region = sheet[y0:y1, x0:x1]
            alpha = ~flood_from_edges(background_mask(region))
            spans = split_columns(alpha, ch['frames'])
            row = []
            for a, b in spans:
                sub_a = keep_largest_blob(alpha[:, a:b])
                ys, xs = np.nonzero(sub_a)
                top, bottom = ys.min(), ys.max()
                # Center on the upper body so swinging legs don't shift the sprite.
                upper = ys < top + (bottom - top) * 0.55
                cx = (xs[upper].min() + xs[upper].max()) / 2
                rgba = np.zeros((y1 - y0, b - a, 4), dtype=np.uint8)
                rgba[..., :3] = region[:, a:b]
                rgba[..., 3] = sub_a * 255
                row.append({'rgba': rgba, 'cx': cx, 'top': top, 'bottom': bottom})
            # Sprites in a row stand on a shared floor line on the sheet, so keep
            # their relative heights (that's the walking bob) and use the lowest
            # foot as the floor.
            feet = max(f['bottom'] for f in row)
            for f in row:
                f['feet'] = feet
            frames[d] = row

        all_frames = [f for row in frames.values() for f in row]
        half_w = int(np.ceil(max(max(f['cx'], f['rgba'].shape[1] - f['cx']) for f in all_frames))) + 1
        above = int(max(f['feet'] - f['top'] for f in all_frames)) + 2
        below = 2
        cell_w, cell_h = half_w * 2, above + below
        foot_x, foot_y = half_w, above

        out = Image.new('RGBA', (cell_w * ch['frames'], cell_h * len(DIRS)), (0, 0, 0, 0))
        for r, d in enumerate(DIRS):
            for c, f in enumerate(frames[d]):
                img = Image.fromarray(f['rgba'], 'RGBA')
                ox = int(round(c * cell_w + foot_x - f['cx']))
                oy = int(r * cell_h + foot_y - f['feet'])
                out.alpha_composite(img, (max(0, ox), max(0, oy)), (max(0, -ox), max(0, -oy)))
        out.save(os.path.join(OUT, f"{ch['id']}.png"), optimize=True)

        meta = {
            'id': ch['id'],
            'name': ch['name'],
            'image': f"assets/characters/{ch['id']}.png",
            'cellW': cell_w,
            'cellH': cell_h,
            'footX': foot_x,
            'footY': foot_y,
            'rows': DIRS,
            'frames': ch['frames'],
        }
        with open(os.path.join(OUT, f"{ch['id']}.json"), 'w') as fh:
            json.dump(meta, fh, indent=2)
        print(f"{ch['id']}: {ch['frames']} frames x {len(DIRS)} dirs, cell {cell_w}x{cell_h}")


if __name__ == '__main__':
    main()
