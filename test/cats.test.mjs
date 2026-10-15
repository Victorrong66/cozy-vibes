// Runs the cats for a while (with a fake clock) and checks they stay on the
// floor or on their nap spots, use their animations, and react to players.
import assert from 'node:assert/strict';
import { Cats } from '../src/cats.js';
import { isWalkable } from '../public/js/map.js';

let clock = 1_000_000;
Date.now = () => clock;

const cats = new Cats();
const player = { id: 1, x: 500, y: 500 };
const seen = new Set();
const NAP_OK = [[1005, 296], [378, 372], [1262, 668], [896, 640]];

for (let i = 0; i < 10 * 60 * 15; i++) {
  clock += 66;
  cats.update(66, [player]);
  for (const c of cats.cats) {
    seen.add(c.anim);
    if (c.jump) continue; // mid-air between the floor and furniture
    const onSpot = NAP_OK.some(([x, y]) => Math.hypot(c.x - x, c.y - y) < 1);
    assert.ok(isWalkable(c.x, c.y) || onSpot, `${c.name} ended up inside a wall at ${c.x},${c.y} (${c.anim})`);
  }
  if (i % 900 === 0) {
    const c = cats.cats[i % 2];
    const fx = cats.interact(player, c.id, ['pet', 'play', 'tease', 'call'][(i / 900) % 4]);
    assert.ok(fx === null || (fx.emoji && fx.text));
  }
}
for (const anim of ['walk', 'idle', 'sleep', 'play', 'loaf']) assert.ok(seen.has(anim), `cats never did "${anim}"`);
console.log('cat tests passed:', [...seen].join(', '));
