// Draws the house cats from the sheets cut by tools/extract_cats.py. The cats
// themselves are run by the server (src/cats.js); this only animates them.

const IDS = ['tabby', 'black'];
export const CAT_H = 34; // height of a walking cat in the house, in house pixels
export const CAT_SHEETS = {};

export async function loadCats() {
  await Promise.all(
    IDS.map(async (id) => {
      const meta = await (await fetch(`assets/cats/${id}.json`)).json();
      const img = new Image();
      img.src = meta.image;
      await img.decode();
      CAT_SHEETS[id] = { meta, img, scale: CAT_H / meta.walkH };
    })
  );
}

// Which frame of which row to show, `ms` after the animation started.
function frameFor(anim, ms, now) {
  switch (anim) {
    case 'walk':
      return ['walk', Math.floor(now / 120) % 4];
    case 'play':
      return ['play', Math.floor(ms / 190) % 4];
    case 'attack':
      return ['attack', Math.min(3, Math.floor(ms / 140))];
    case 'jump':
      return ['jump', Math.min(3, Math.floor(ms / 150))];
    case 'sleep':
      // Curl up, then breathe slowly between the last two frames.
      if (ms < 1200) return ['sleep', Math.floor(ms / 400)];
      return ['sleep', 2 + (Math.floor((ms - 1200) / 1100) % 2)];
    case 'loaf':
      return ['sleep', 0];
    default:
      return ['walk', 0];
  }
}

export function drawCat(ctx, id, x, y, flip, anim, ms, now) {
  const sheet = CAT_SHEETS[id];
  if (!sheet) return;
  const { meta, img, scale } = sheet;
  const [rowName, frame] = frameFor(anim, ms, now);
  const row = meta.rows.indexOf(rowName);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(x, y);
  if (flip) ctx.scale(-1, 1); // the sheet faces right
  ctx.drawImage(
    img,
    frame * meta.cellW,
    row * meta.cellH,
    meta.cellW,
    meta.cellH,
    -meta.footX * scale,
    -meta.footY * scale,
    meta.cellW * scale,
    meta.cellH * scale
  );
  ctx.restore();
}

export function drawCatPortrait(canvas, id) {
  const sheet = CAT_SHEETS[id];
  if (!sheet) return;
  const { meta, img } = sheet;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, canvas.width, canvas.height);
  const s = canvas.width / (meta.cellW * 0.62); // the cat fills the middle of its cell
  const w = meta.cellW * s, h = meta.cellH * s;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, meta.cellW, meta.cellH, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
}
