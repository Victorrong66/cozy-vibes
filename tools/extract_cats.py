"""Cut the cat animation frames out of art/cats-sheet.png.

The sheet has a tabby and a black cat, each with five 4-frame animations drawn
facing right: walk, play, attack, jump, sleep. The white background, frame
boxes and soft shadows are removed, and every frame is lined up on the cat's
paws so the animations don't jitter. Left-facing cats are mirrored in the game.

Output per cat, in public/assets/cats/:
  <id>.png   one row per animation, 4 frames each, all cells the same size
  <id>.json  cell size, row names and where the paws are inside a cell

Run from the repo root:  python3 tools/extract_cats.py
"""

import json
import os
import sys
from collections import deque

import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEET = os.path.join(ROOT, 'art', 'cats-sheet.png')
OUT = os.path.join(ROOT, 'public', 'assets', 'cats')

ANIMS = ['walk', 'play', 'attack', 'jump', 'sleep']
FRAMES = 4


def panels(dy, walk_bottom, jump_bottom):
    """Inside of each animation's box, stopping above the frame numbers."""
    top1, top2 = 115 + dy, 333 + dy
    return {
        'walk': (15, top1, 510, walk_bottom),
        'play': (525, top1, 1030, walk_bottom),
        'attack': (1045, top1, 1520, walk_bottom),
        'jump': (15, top2, 812, jump_bottom),
        'sleep': (830, top2, 1520, jump_bottom),
    }


CATS = [
    {'id': 'tabby', 'name': 'Biscuit', 'panels': panels(0, 252, 478)},
    {'id': 'black', 'name': 'Pepper', 'panels': panels(507, 767, 982)},
]


def background_like(rgb):
    """White paper, plus the light grey shadows and swipe trails on it."""
    r, g, b = (rgb[..., i].astype(int) for i in range(3))
    spread = np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)
    lum = (r + g + b) / 3
    return (spread <= 16) & (lum >= 165)


def flood_from_edges(mask):
    h, w = mask.shape
    out = np.zeros_like(mask)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if mask[y, x] and not out[y, x]:
                out[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if mask[y, x] and not out[y, x]:
                out[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not out[ny, nx]:
                out[ny, nx] = True
                q.append((ny, nx))
    return out


def blobs(alpha, min_size):
    """Connected pieces bigger than min_size (drops specks of the box border)."""
    h, w = alpha.shape
    seen = np.zeros_like(alpha)
    found = []
    for sy, sx in zip(*np.nonzero(alpha)):
        if seen[sy, sx]:
            continue
        pts = []
        q = deque([(sy, sx)])
        seen[sy, sx] = True
        while q:
            y, x = q.popleft()
            pts.append((y, x))
            for ny in (y - 1, y, y + 1):
                for nx in (x - 1, x, x + 1):
                    if 0 <= ny < h and 0 <= nx < w and alpha[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
        if len(pts) >= min_size:
            found.append(pts)
    return found


def split_frames(alpha):
    """Group columns into 4 frames, merging the closest pieces (e.g. a yarn ball
    next to its cat) until there are exactly 4."""
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
    while len(spans) > FRAMES:
        gaps = [spans[i + 1][0] - spans[i][1] for i in range(len(spans) - 1)]
        i = int(np.argmin(gaps))
        spans[i] = [spans[i][0], spans[i + 1][1]]
        del spans[i + 1]
    if len(spans) != FRAMES:
        sys.exit(f'expected {FRAMES} frames, found {len(spans)}')
    return spans


def main():
    sheet = np.array(Image.open(SHEET).convert('RGB'))
    os.makedirs(OUT, exist_ok=True)

    for cat in CATS:
        rows = {}
        for anim in ANIMS:
            x0, y0, x1, y1 = cat['panels'][anim]
            region = sheet[y0:y1, x0:x1]
            alpha = ~flood_from_edges(background_like(region))
            keep = np.zeros_like(alpha)
            for pts in blobs(alpha, 60):
                for y, x in pts:
                    keep[y, x] = True
            frames = []
            for a, b in split_frames(keep):
                sub = keep[:, a:b]
                pieces = blobs(sub, 60)
                body = max(pieces, key=len)
                ys = np.array([p[0] for p in body])
                xs = np.array([p[1] for p in body])
                rgba = np.zeros((y1 - y0, b - a, 4), dtype=np.uint8)
                rgba[..., :3] = region[:, a:b]
                rgba[..., 3] = sub * 255
                frames.append({
                    'rgba': rgba,
                    'cx': (xs.min() + xs.max()) / 2,  # middle of the cat itself
                    'top': int(np.nonzero(sub)[0].min()),
                    'bottom': int(ys.max()),
                })
            # Frames in a box share a floor line; keeping their offsets keeps
            # the jump's height.
            floor = max(f['bottom'] for f in frames)
            for f in frames:
                f['floor'] = floor
            rows[anim] = frames

        all_frames = [f for row in rows.values() for f in row]
        half_w = int(np.ceil(max(max(f['cx'], f['rgba'].shape[1] - f['cx']) for f in all_frames))) + 1
        above = int(max(f['floor'] - f['top'] for f in all_frames)) + 2
        cell_w, cell_h = half_w * 2, above + 3
        foot_x, foot_y = half_w, above
        walk_h = int(max(f['floor'] - f['top'] for f in rows['walk']))

        out = Image.new('RGBA', (cell_w * FRAMES, cell_h * len(ANIMS)), (0, 0, 0, 0))
        for r, anim in enumerate(ANIMS):
            for c, f in enumerate(rows[anim]):
                img = Image.fromarray(f['rgba'], 'RGBA')
                ox = int(round(c * cell_w + foot_x - f['cx']))
                oy = int(r * cell_h + foot_y - f['floor'])
                out.alpha_composite(img, (max(0, ox), max(0, oy)), (max(0, -ox), max(0, -oy)))
        out.save(os.path.join(OUT, f"{cat['id']}.png"), optimize=True)

        meta = {
            'id': cat['id'],
            'name': cat['name'],
            'image': f"assets/cats/{cat['id']}.png",
            'cellW': cell_w,
            'cellH': cell_h,
            'footX': foot_x,
            'footY': foot_y,
            'walkH': walk_h,  # height of a walking cat, used to size it in the house
            'rows': ANIMS,
            'frames': FRAMES,
            'facing': 'right',
        }
        with open(os.path.join(OUT, f"{cat['id']}.json"), 'w') as fh:
            json.dump(meta, fh, indent=2)
        print(f"{cat['id']}: cell {cell_w}x{cell_h}, walking height {walk_h}")


if __name__ == '__main__':
    main()
