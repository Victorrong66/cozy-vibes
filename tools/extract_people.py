"""Cut character frames out of sheets laid out like art/girl-sheet.png:
8-frame walks for down, up, left and right, plus 4-frame play, attack, jump
and sleep animations. The white background and shadows are removed and every
frame is lined up on the feet.

On the girl's sheet the "right" row is drawn facing left like the left row, so
her right walk is the left walk mirrored. The girl with glasses has a proper
right row.

Output per character: public/assets/characters/<id>.png and <id>.json, in the
layout the game uses (rows of equal-sized cells), with the extra animations as
additional rows.

Run from the repo root:  python3 tools/extract_people.py
"""

import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_cats import background_like, blobs, flood_from_edges  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'assets', 'characters')

# For each sheet, the area of each animation, above its frame numbers:
#   name: (x0, y0, x1, y1, frames). 'right': None means mirror the left walk.
PEOPLE = {
    'girl': {
        'name': 'Girl',
        'sheet': 'girl-sheet.png',
        'rows': {
            'down': (20, 92, 762, 245, 8),
            'up': (775, 92, 1515, 246, 8),
            'left': (25, 355, 762, 512, 8),
            'right': None,
            'play': (30, 622, 755, 763, 4),
            'attack': (790, 622, 1515, 763, 4),
            'jump': (30, 825, 755, 986, 4),
            'sleep': (790, 845, 1515, 986, 4),
        },
    },
    'glasses': {
        'name': 'Glasses',
        'sheet': 'glasses-sheet.png',
        'rows': {
            'down': (18, 90, 755, 244, 8),
            'up': (785, 90, 1515, 244, 8),
            'left': (22, 352, 760, 512, 8),
            'right': (778, 352, 1515, 512, 8),
            'play': (30, 620, 760, 763, 4),
            'attack': (790, 620, 1515, 763, 4),
            'jump': (30, 818, 760, 986, 4),
            'sleep': (790, 840, 1515, 986, 4),
        },
    },
}
WALKS = ['down', 'up', 'left', 'right']
EXTRAS = ['play', 'attack', 'jump', 'sleep']
COLS = 8


def split_frames(alpha, n):
    """Split a row into n frames by its empty columns. Frames drawn touching are
    cut at the emptiest column near the middle of the merged piece; small pieces
    (a yarn ball, a swipe) join their nearest neighbour."""
    counts = alpha.sum(axis=0)
    spans, start = [], None
    for x, c in enumerate(counts > 0):
        if c and start is None:
            start = x
        elif not c and start is not None:
            spans.append([start, x])
            start = None
    if start is not None:
        spans.append([start, len(counts)])
    spans = [s for s in spans if alpha[:, s[0]:s[1]].sum() > 40]
    while len(spans) > n:
        gaps = [spans[i + 1][0] - spans[i][1] for i in range(len(spans) - 1)]
        i = int(np.argmin(gaps))
        spans[i] = [spans[i][0], spans[i + 1][1]]
        del spans[i + 1]
    while len(spans) < n:
        i = max(range(len(spans)), key=lambda k: spans[k][1] - spans[k][0])
        a, b = spans[i]
        lo, hi = a + (b - a) // 4, b - (b - a) // 4
        cut = lo + int(np.argmin(counts[lo:hi]))
        spans[i:i + 1] = [[a, cut], [cut, b]]
    return spans


def cut_row(sheet, box):
    x0, y0, x1, y1, n = box
    region = sheet[y0:y1, x0:x1]
    alpha = ~flood_from_edges(background_like(region))
    keep = np.zeros_like(alpha)
    for pts in blobs(alpha, 50):
        ys = [p[0] for p in pts]
        if max(ys) - min(ys) <= 6 or min(ys) == 0:
            continue  # a thin line or a cut-off label box, not part of her
        for y, x in pts:
            keep[y, x] = True
    frames = []
    for a, b in split_frames(keep, n):
        sub = keep[:, a:b]
        body = max(blobs(sub, 50), key=len)
        ys = np.array([p[0] for p in body])
        xs = np.array([p[1] for p in body])
        top, bottom = ys.min(), ys.max()
        # Centre on the head/upper body so swinging legs and hair don't shift her.
        upper = ys < top + (bottom - top) * 0.45
        rgba = np.zeros((y1 - y0, b - a, 4), dtype=np.uint8)
        rgba[..., :3] = region[:, a:b]
        rgba[..., 3] = sub * 255
        frames.append({
            'rgba': rgba,
            'cx': (xs[upper].min() + xs[upper].max()) / 2,
            'top': int(np.nonzero(sub)[0].min()),
            'bottom': int(bottom),
        })
    floor = max(f['bottom'] for f in frames)  # shared floor keeps the jump's height
    for f in frames:
        f['floor'] = floor
    return frames


def mirror(frames):
    out = []
    for f in frames:
        w = f['rgba'].shape[1]
        out.append({**f, 'rgba': f['rgba'][:, ::-1].copy(), 'cx': w - 1 - f['cx']})
    return out


def build(pid, cfg):
    sheet = np.array(Image.open(os.path.join(ROOT, 'art', cfg['sheet'])).convert('RGB'))
    rows = {name: cut_row(sheet, box) for name, box in cfg['rows'].items() if box}
    if cfg['rows']['right'] is None:
        rows['right'] = mirror(rows['left'])
    order = WALKS + EXTRAS

    all_frames = [f for name in order for f in rows[name]]
    half_w = int(np.ceil(max(max(f['cx'], f['rgba'].shape[1] - f['cx']) for f in all_frames))) + 1
    above = int(max(f['floor'] - f['top'] for f in all_frames)) + 2
    cell_w, cell_h = half_w * 2, above + 3
    foot_x, foot_y = half_w, above
    walk_h = int(max(f['floor'] - f['top'] for name in WALKS for f in rows[name]))

    out = Image.new('RGBA', (cell_w * COLS, cell_h * len(order)), (0, 0, 0, 0))
    for r, name in enumerate(order):
        for c, f in enumerate(rows[name]):
            img = Image.fromarray(f['rgba'], 'RGBA')
            ox = int(round(c * cell_w + foot_x - f['cx']))
            oy = int(r * cell_h + foot_y - f['floor'])
            out.alpha_composite(img, (max(0, ox), max(0, oy)), (max(0, -ox), max(0, -oy)))
    os.makedirs(OUT, exist_ok=True)
    out.save(os.path.join(OUT, f'{pid}.png'), optimize=True)

    meta = {
        'id': pid,
        'name': cfg['name'],
        'image': f'assets/characters/{pid}.png',
        'cellW': cell_w,
        'cellH': cell_h,
        'footX': foot_x,
        'footY': foot_y,
        'walkH': walk_h,  # standing height, used to size her in the house
        'rows': order,
        'frames': COLS,
        'walkFrames': 8,  # every walk frame is part of the cycle
        'extraFrames': 4,
    }
    with open(os.path.join(OUT, f'{pid}.json'), 'w') as fh:
        json.dump(meta, fh, indent=2)
    print(f'{pid}: cell {cell_w}x{cell_h}, standing height {walk_h}')


def main():
    only = sys.argv[1:]
    for pid, cfg in PEOPLE.items():
        if not only or pid in only:
            build(pid, cfg)


if __name__ == '__main__':
    main()
