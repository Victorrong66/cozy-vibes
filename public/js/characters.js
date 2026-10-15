// Character sprites. The boy comes from art/characters-sheet.png
// (tools/extract_sprites.py) and the girl from art/girl-sheet.png
// (tools/extract_girl.py). Each sheet has one row per walking direction (down,
// up, left, right); frame 0 is the standing pose. A sheet may also have extra
// rows - play, attack, jump, sleep - which are used when present.

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
      // Scale so a standing character (head to feet) is CHAR_H tall.
      return { id, name: meta.name, img, meta, scale: CHAR_H / (meta.walkH || meta.footY) };
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
  return (l.meta.walkH || l.meta.footY) * l.scale * 0.42;
}

const WALK_MS = 105;
// How far above the feet the blanket starts when someone's in bed.
export const BED_TUCK = 36;

/**
 * Draw a character with its feet at (x, y).
 * pose: stand | sit | sleep | dance | bed ; dir: down | up | left | right
 * opts.seated: sitting on furniture (rather than on the floor)
 * opts.action: { row, ms } a short one-off animation, e.g. a poke
 */
export function drawCharacter(ctx, index, x, y, dir, moving, pose, now, phase = 0, opts = {}) {
  const look = lookOf(index);
  const { meta, img, scale } = look;
  const has = (row) => meta.rows.includes(row);
  // Older sheets repeat the standing frame at the end of the walk; newer ones list
  // how many walk frames there are.
  const walkFrames = meta.walkFrames || meta.frames - 1;

  let rowName = dir;
  let frame = 0;
  let flip = false;
  let special = false; // drawn from an extra row, so skip the improvised poses

  if (opts.action && has(opts.action.row)) {
    rowName = opts.action.row;
    frame = Math.min(3, Math.floor(opts.action.ms / 140));
    flip = dir === 'left' && rowName === 'attack'; // the swipe is drawn going right
    special = true;
  } else if (pose === 'dance' && has('jump')) {
    rowName = 'jump';
    frame = Math.floor(now / 170) % 4;
    special = true;
  } else if (pose === 'sleep' && has('sleep')) {
    rowName = 'sleep';
    frame = 2 + (Math.floor((now + phase * 1000) / 1100) % 2); // curled up, breathing
    special = true;
  } else if (pose === 'sit' && !opts.seated && has('play')) {
    rowName = 'play'; // sitting on the floor playing with yarn
    frame = Math.floor((now + phase * 1000) / 320) % 4;
    special = true;
  } else if (pose === 'dance') {
    rowName = ['down', 'left', 'down', 'right'][Math.floor(now / 420) % 4];
    frame = 1 + (Math.floor(now / WALK_MS) % walkFrames);
  } else if (moving) {
    frame = Math.floor(now / WALK_MS + phase) % walkFrames;
  }
  if (!special && (pose === 'sleep' || pose === 'bed')) rowName = 'down';

  const row = Math.max(0, meta.rows.indexOf(rowName));
  const sx = frame * meta.cellW;
  const sy = row * meta.cellH;
  const w = meta.cellW * scale;
  const h = meta.cellH * scale;

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (pose === 'bed') {
    // Tucked in: only the head and shoulders show above the blanket.
    ctx.beginPath();
    ctx.rect(x - 60, y - CHAR_H - 20, 120, CHAR_H + 20 - BED_TUCK);
    ctx.clip();
  }
  ctx.translate(x, y);
  if (!special) {
    if (pose === 'dance') ctx.translate(0, -Math.abs(Math.sin(now / 210)) * 3);
    if (pose === 'sit') ctx.scale(1, 0.84); // a little crouch
    if (pose === 'sleep') {
      // Lie down on the floor.
      ctx.translate(CHAR_H * 0.5, -10);
      ctx.rotate(-Math.PI / 2);
    }
  }
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(img, sx, sy, meta.cellW, meta.cellH, -meta.footX * scale, -meta.footY * scale, w, h);
  ctx.restore();
}

// Draw the front-facing standing frame to fill a small canvas (picker, menu).
export function drawPortrait(canvas, index) {
  const { meta, img } = lookOf(index);
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  // Just the standing figure, not the headroom some sheets keep for jumping.
  const standH = (meta.walkH || meta.footY) + 6;
  const srcY = Math.max(0, meta.footY - standH + 2);
  const srcH = Math.min(meta.cellH - srcY, standH + 4);
  const srcW = Math.min(meta.cellW, standH * 0.75);
  const srcX = meta.footX - srcW / 2;
  const s = Math.min(canvas.width / srcW, canvas.height / srcH);
  const w = srcW * s, h = srcH * s;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, srcX, srcY, srcW, srcH, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}
