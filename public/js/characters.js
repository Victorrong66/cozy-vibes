// Character sprites, cut from art/characters-sheet.png by tools/extract_sprites.py.
// Each sheet has one row per direction (down, up, left, right) and one column per
// animation frame. Frame 0 is the standing pose and the rest is the walk cycle.

const IDS = ['boy', 'girl'];

// How tall a character is drawn in the house, in house-image pixels.
export const CHAR_H = 76;

export const LOOKS = []; // filled by loadCharacters(): { id, name, img, meta, scale }

export async function loadCharacters() {
  const loaded = await Promise.all(
    IDS.map(async (id) => {
      const meta = await (await fetch(`assets/characters/${id}.json`)).json();
      const img = new Image();
      img.src = meta.image;
      await img.decode();
      // Scale so the character's full height (head to feet) is CHAR_H.
      return { id, name: meta.name, img, meta, scale: CHAR_H / meta.footY };
    })
  );
  LOOKS.splice(0, LOOKS.length, ...loaded);
}

export function lookOf(index) {
  return LOOKS[((index % LOOKS.length) + LOOKS.length) % LOOKS.length];
}

// Width of the drawn character, for tapping on it.
export function charWidth(index) {
  const l = lookOf(index);
  return l.meta.cellW * l.scale * 0.6;
}

const WALK_MS = 105;

/**
 * Draw a character with its feet at (x, y).
 * pose: stand | sit | sleep | dance ; dir: down | up | left | right
 */
export function drawCharacter(ctx, index, x, y, dir, moving, pose, now, phase = 0) {
  const look = lookOf(index);
  const { meta, img, scale } = look;
  const walkFrames = meta.frames - 1; // the last frame repeats the first

  let frame = 0;
  if (pose === 'dance') {
    dir = ['down', 'left', 'down', 'right'][Math.floor(now / 420) % 4];
    frame = 1 + (Math.floor(now / WALK_MS) % walkFrames);
  } else if (moving) {
    frame = Math.floor(now / WALK_MS + phase) % walkFrames;
  }
  if (pose === 'sit' || pose === 'sleep') dir = 'down';

  const row = Math.max(0, meta.rows.indexOf(dir));
  const sx = frame * meta.cellW;
  const sy = row * meta.cellH;
  const w = meta.cellW * scale;
  const h = meta.cellH * scale;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(x, y);
  if (pose === 'dance') ctx.translate(0, -Math.abs(Math.sin(now / 210)) * 3);
  if (pose === 'sit') ctx.scale(1, 0.84); // a little crouch
  if (pose === 'sleep') {
    // Lie down on the floor.
    ctx.translate(CHAR_H * 0.5, -10);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(img, sx, sy, meta.cellW, meta.cellH, -meta.footX * scale, -meta.footY * scale, w, h);
  ctx.restore();
}

// Draw the front-facing standing frame to fill a small canvas (picker, menu).
export function drawPortrait(canvas, index) {
  const { meta, img } = lookOf(index);
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  const s = Math.min(canvas.width / meta.cellW, canvas.height / meta.cellH);
  const w = meta.cellW * s, h = meta.cellH * s;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, meta.cellW, meta.cellH, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}
