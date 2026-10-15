// Checks the house layout: walls block, the two doors let you through,
// and the front door stays shut.
import assert from 'node:assert/strict';
import { isWalkable, isValidSpot, findPath, moveWithCollision, roomAt, FURNITURE, furnitureAt } from '../public/js/map.js';

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

// Furniture is solid; you can only get on through each seat's entry point.
for (const [x, y, what] of [[1005, 260, 'bed'], [560, 520, 'couch'], [1160, 500, 'desk'], [255, 500, 'TV'], [440, 510, 'coffee table'], [650, 260, 'dining table']]) {
  assert.ok(!isWalkable(x, y), `${what} is solid`);
}
for (const f of FURNITURE) {
  for (const seat of f.seats) {
    assert.ok(isWalkable(seat.entry.x, seat.entry.y), `${f.name} entry is on the floor`);
    assert.ok(!isWalkable(seat.x, seat.y), `${f.name} seat is on the furniture`);
    assert.ok(isValidSpot(seat.x, seat.y), `${f.name} seat is allowed for the server`);
    assert.equal(furnitureAt(seat.x, seat.y), f, `${f.name} seat is inside its tap area`);
    assert.ok(findPath(living.x, living.y, seat.entry.x, seat.entry.y), `${f.name} entry is reachable`);
  }
}
// Bed: in from the sides, level with the white sheet.
assert.ok(FURNITURE.find((f) => f.id === 'bed').seats.every((s) => s.entry.y > 195 && s.entry.y < 215));
// Couch: only from the coffee table side (left of the couch).
assert.ok(FURNITURE.find((f) => f.id === 'couch').seats.every((s) => s.entry.x < 512 && s.entry.x > 478));
assert.ok(!isValidSpot(700, 700.5) || isWalkable(700, 700.5));

console.log('collision tests passed');
