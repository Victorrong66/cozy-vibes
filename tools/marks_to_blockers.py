"""Turn red scribbles on a copy of the map into blocked rectangles.

Paint red over a copy of public/assets/house.png wherever characters shouldn't
stand, save it as art/no-walk-marks.jpg (or .png), and run:

    python3 tools/marks_to_blockers.py

It prints one rectangle per marked area (in house.png pixels), ready to paste
into BLOCKERS in public/js/map.js, and writes art/no-walk-check.png showing
the rectangles over the map so you can check them.
"""

import os
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MARKS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'art', 'no-walk-marks.jpg')
HOUSE = os.path.join(ROOT, 'public', 'assets', 'house.png')
JOIN = 7  # scribble strokes closer than this many pixels count as one area
PAD = 3  # grow each area a little past the scribble


def main():
    marks = Image.open(MARKS).convert('RGB')
    house = Image.open(HOUSE).convert('RGB')
    if marks.size != house.size:
        marks = marks.resize(house.size, Image.LANCZOS)
    a = np.array(marks).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    red = (r > 160) & (g < 95) & (b < 95) & (r - g > 110)

    # Join nearby strokes of the same scribble.
    near = red.copy()
    ys, xs = np.nonzero(red)
    for dy in range(-JOIN, JOIN + 1):
        for dx in range(-JOIN, JOIN + 1):
            yy = np.clip(ys + dy, 0, red.shape[0] - 1)
            xx = np.clip(xs + dx, 0, red.shape[1] - 1)
            near[yy, xx] = True

    seen = np.zeros_like(near)
    boxes = []
    h, w = near.shape
    for sy, sx in zip(*np.nonzero(red)):
        if seen[sy, sx]:
            continue
        q = deque([(sy, sx)])
        seen[sy, sx] = True
        x1 = x2 = sx
        y1 = y2 = sy
        count = 0
        while q:
            y, x = q.popleft()
            if red[y, x]:
                count += 1
                x1, x2, y1, y2 = min(x1, x), max(x2, x), min(y1, y), max(y2, y)
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and near[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True
                    q.append((ny, nx))
        if count >= 25:  # ignore stray specks
            boxes.append((int(x1) - PAD, int(y1) - PAD, int(x2) + PAD, int(y2) + PAD, count))

    boxes.sort(key=lambda b: (b[1] // 120, b[0]))
    check = house.copy()
    d = ImageDraw.Draw(check, 'RGBA')
    for i, (x1, y1, x2, y2, n) in enumerate(boxes):
        d.rectangle([x1, y1, x2, y2], fill=(255, 0, 0, 70), outline=(255, 0, 0, 255), width=2)
        d.text((x1 + 3, y1 + 2), str(i + 1), fill=(255, 255, 255, 255))
        print(f'  {{ x1: {x1}, y1: {y1}, x2: {x2}, y2: {y2} }},  // area {i + 1}')
    check.save(os.path.join(ROOT, 'art', 'no-walk-check.png'))


if __name__ == '__main__':
    main()
