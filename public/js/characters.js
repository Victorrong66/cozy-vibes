// Placeholder pixel-art characters, drawn in code so the game works before the
// real animation frames are added. Every frame is pre-rendered once into a small
// canvas and cached. To switch to real sprite sheets, replace getFrame() so it
// returns the matching image frame; nothing else in the game needs to change.

export const PX = 2; // world pixels per art pixel
const W = 16; // art width
const H = 32; // art height (with headroom for hair buns and bobbing)
export const SPRITE_W = W * PX;
export const SPRITE_H = H * PX;
// Where the feet touch the floor, measured from the top of the sprite.
export const FEET_Y = 30 * PX;

export const LOOKS = [
  { name: 'Maple', skin: '#f2c9a0', hair: '#6b3b1f', style: 'short', shirt: '#d9644a', pants: '#3d4e6b', shoes: '#2b2118' },
  { name: 'Fern', skin: '#e8b48a', hair: '#2a1d14', style: 'long', shirt: '#6f9a4c', pants: '#5a4634', shoes: '#2b2118' },
  { name: 'Juniper', skin: '#c68a5e', hair: '#1c1410', style: 'bun', shirt: '#e3b341', pants: '#40536e', shoes: '#3a2a1e' },
  { name: 'Willow', skin: '#8d5a3b', hair: '#140e0b', style: 'spiky', shirt: '#4a7fb5', pants: '#2f3a2c', shoes: '#1c1612' },
  { name: 'Clover', skin: '#f6d7b8', hair: '#e0b356', style: 'long', shirt: '#c97bb0', pants: '#4b3f63', shoes: '#2b2118' },
  { name: 'Sage', skin: '#d9a679', hair: '#a8452b', style: 'short', shirt: '#4f8f86', pants: '#6b4a32', shoes: '#2b2118' },
  { name: 'Hazel', skin: '#b07850', hair: '#3b2a20', style: 'bun', shirt: '#f0ede0', pants: '#3a5a3a', shoes: '#4a2e1e' },
  { name: 'Birch', skin: '#efc39b', hair: '#d8d2c4', style: 'spiky', shirt: '#7a5ca8', pants: '#2d2d38', shoes: '#151515' },
];

const OUTLINE = '#2a1a12';
const cache = new Map();

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v + amt)));
  const r = c((n >> 16) & 255), g = c((n >> 8) & 255), b = c(n & 255);
  return `rgb(${r},${g},${b})`;
}

// pose: stand | sit | sleep | dance ; dir: down | up | left | right ; frame 0-3
function paint(look, dir, frame, pose) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  g.translate(0, 3);
  const r = (x, y, w, h, col) => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
  };

  const walking = pose === 'stand' && frame > 0;
  const bob = (walking && frame % 2 === 1) || (pose === 'dance' && frame % 2 === 1) ? 1 : 0;
  const lower = pose === 'sit' || pose === 'sleep' ? 3 : 0;
  const oy = 1 + bob + lower;
  const eyesClosed = pose === 'sleep';
  const side = dir === 'left' || dir === 'right';

  // Legs
  const legTop = 19 + oy;
  let lLen = 6 - lower, rLen = 6 - lower;
  if (walking && frame === 1) lLen -= 1;
  if (walking && frame === 3) rLen -= 1;
  if (pose === 'dance') (frame < 2 ? (lLen -= 1) : (rLen -= 1));
  if (side && walking) {
    // Side view: one leg in front, one behind
    const fwd = frame === 1 ? 1 : frame === 3 ? -1 : 0;
    r(6 - fwd, legTop, 2, lLen, look.pants);
    r(8 + fwd, legTop, 2, rLen, shade(look.pants, -18));
    r(6 - fwd, legTop + lLen, 3, 1, look.shoes);
    r(8 + fwd, legTop + rLen, 3, 1, look.shoes);
  } else {
    r(5, legTop, 3, lLen, look.pants);
    r(8, legTop, 3, rLen, shade(look.pants, -12));
    r(5, legTop + lLen, 3, 1, look.shoes);
    r(8, legTop + rLen, 3, 1, look.shoes);
  }

  // Body
  const bodyTop = 11 + oy;
  r(4, bodyTop, 8, 8, look.shirt);
  r(4, bodyTop + 6, 8, 2, shade(look.shirt, -25));
  r(4, bodyTop, 8, 1, shade(look.shirt, 20));

  // Arms
  const armSwing = walking ? (frame === 1 ? 1 : frame === 3 ? -1 : 0) : 0;
  if (pose === 'dance' && frame % 2 === 0) {
    r(2, bodyTop - 4, 2, 5, look.shirt);
    r(12, bodyTop - 4, 2, 5, look.shirt);
    r(2, bodyTop - 5, 2, 1, look.skin);
    r(12, bodyTop - 5, 2, 1, look.skin);
  } else if (side) {
    const ax = dir === 'left' ? 6 + armSwing : 8 - armSwing;
    r(ax, bodyTop + 1, 2, 6, shade(look.shirt, -10));
    r(ax, bodyTop + 7, 2, 1, look.skin);
  } else {
    r(2, bodyTop + 1 + armSwing, 2, 6, shade(look.shirt, -10));
    r(12, bodyTop + 1 - armSwing, 2, 6, shade(look.shirt, -10));
    r(2, bodyTop + 7 + armSwing, 2, 1, look.skin);
    r(12, bodyTop + 7 - armSwing, 2, 1, look.skin);
  }

  // Head
  const headTop = 2 + oy;
  r(3, headTop, 10, 9, look.skin);
  r(3, headTop + 8, 10, 1, shade(look.skin, -20));

  // Hair
  const hair = look.hair;
  const hairDark = shade(hair, -20);
  if (dir === 'up') {
    r(3, headTop, 10, 9, hair);
    r(3, headTop + 7, 10, 2, hairDark);
  } else {
    r(3, headTop - 1, 10, 3, hair);
    r(2, headTop, 1, 4, hair);
    r(13, headTop, 1, 4, hair);
    if (dir === 'left') r(9, headTop, 4, 7, hair);
    if (dir === 'right') r(3, headTop, 4, 7, hair);
  }
  if (look.style === 'long') {
    if (dir === 'up') r(3, headTop + 8, 10, 5, hair);
    else {
      r(2, headTop + 2, 2, 9, hair);
      r(12, headTop + 2, 2, 9, hair);
    }
  } else if (look.style === 'bun') {
    r(6, headTop - 4, 4, 3, hair);
    r(7, headTop - 4, 2, 1, shade(hair, 25));
  } else if (look.style === 'spiky') {
    r(3, headTop - 2, 2, 1, hair);
    r(7, headTop - 3, 2, 2, hair);
    r(11, headTop - 2, 2, 1, hair);
  } else {
    r(4, headTop - 2, 8, 1, hair);
  }
  r(4, headTop - 1, 3, 1, shade(hair, 30)); // highlight

  // Face
  const eye = '#2a1a12';
  const ey = headTop + 5;
  if (dir === 'down') {
    if (eyesClosed) {
      r(5, ey + 1, 2, 1, eye);
      r(9, ey + 1, 2, 1, eye);
    } else {
      r(5, ey, 2, 2, eye);
      r(9, ey, 2, 2, eye);
      r(5, ey, 1, 1, '#ffffff');
      r(9, ey, 1, 1, '#ffffff');
    }
    r(4, ey + 2, 1, 1, '#e8908a');
    r(11, ey + 2, 1, 1, '#e8908a');
  } else if (dir === 'left') {
    eyesClosed ? r(4, ey + 1, 2, 1, eye) : r(4, ey, 2, 2, eye);
    r(3, ey + 2, 1, 1, '#e8908a');
  } else if (dir === 'right') {
    eyesClosed ? r(10, ey + 1, 2, 1, eye) : r(10, ey, 2, 2, eye);
    r(12, ey + 2, 1, 1, '#e8908a');
  }

  // Outline: stamp a dark silhouette behind the art.
  const out = document.createElement('canvas');
  out.width = W * PX;
  out.height = H * PX;
  const o = out.getContext('2d');
  o.imageSmoothingEnabled = false;
  const sil = document.createElement('canvas');
  sil.width = W;
  sil.height = H;
  const s = sil.getContext('2d');
  s.drawImage(c, 0, 0);
  s.globalCompositeOperation = 'source-in';
  s.fillStyle = OUTLINE;
  s.fillRect(0, 0, W, H);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    o.drawImage(sil, dx * PX, dy * PX, W * PX, H * PX);
  }
  o.drawImage(c, 0, 0, W * PX, H * PX);
  return out;
}

export function getFrame(lookIndex, dir, frame, pose) {
  const key = `${lookIndex}|${dir}|${frame}|${pose}`;
  let f = cache.get(key);
  if (!f) {
    const look = LOOKS[((lookIndex % LOOKS.length) + LOOKS.length) % LOOKS.length];
    f = paint(look, dir, frame, pose);
    cache.set(key, f);
  }
  return f;
}

// Small portrait used in the character picker.
export function portrait(lookIndex) {
  return getFrame(lookIndex, 'down', 0, 'stand');
}
