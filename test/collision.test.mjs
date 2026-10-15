// Checks the house layout: walls block, the two doors let you through,
// and the front door stays shut.
import assert from 'node:assert/strict';
import { isWalkable, findPath, moveWithCollision, roomAt } from '../public/js/map.js';

const living = { x: 500, y: 500 };
const bedroom = { x: 1100, y: 330 };
const office = { x: 1150, y: 650 };

assert.ok(isWalkable(living.x, living.y), 'living room floor');
assert.ok(isWalkable(bedroom.x, bedroom.y), 'bedroom floor');
assert.ok(isWalkable(office.x, office.y), 'office floor');

// Walls
assert.ok(!isWalkable(825, 300), 'wall between living room and bedroom');
assert.ok(!isWalkable(1000, 680), 'wall between hallway and office (below door)');
assert.ok(!isWalkable(1000, 470), 'wall between hallway and office (above door)');
assert.ok(!isWalkable(1100, 370), 'wall between bedroom and office');
assert.ok(!isWalkable(500, 780), 'outer wall / front of house');
assert.ok(!isWalkable(905, 780), 'front door is closed');
assert.ok(!isWalkable(200, 500), 'left outer wall');

// Doors
assert.ok(isWalkable(904, 410), 'bedroom doorway');
assert.ok(isWalkable(995, 550), 'office doorway');
assert.ok(!isWalkable(500, 728), 'bottom wall of the living room');
assert.ok(!isWalkable(835, 700), 'pillar by the front door');

// Walking straight into a wall stops you
const hit = moveWithCollision(780, 300, 200, 0);
assert.ok(hit.x < 806, `blocked by wall, got x=${hit.x}`);

// Every room is reachable from the living room, and only through the doors.
for (const [name, to] of Object.entries({ bedroom, office })) {
  const path = findPath(living.x, living.y, to.x, to.y);
  assert.ok(path && path.length, `path to ${name}`);
  const rooms = new Set();
  let px = living.x, py = living.y;
  for (const wp of path) {
    const n = Math.ceil(Math.hypot(wp.x - px, wp.y - py) / 3);
    for (let i = 1; i <= n; i++) {
      const x = px + ((wp.x - px) * i) / n, y = py + ((wp.y - py) * i) / n;
      assert.ok(isWalkable(x, y), `path to ${name} crosses a wall at ${x},${y}`);
      rooms.add(roomAt(x, y));
    }
    px = wp.x;
    py = wp.y;
  }
  assert.ok(rooms.has('doorway') || rooms.has(name), `${name} reached`);
}

// Nothing outside the house is reachable.
assert.equal(findPath(500, 500, 905, 950)?.some((p) => p.y > 745) ?? false, false, 'cannot walk outside');

console.log('collision tests passed');
