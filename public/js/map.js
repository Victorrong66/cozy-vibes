// House map: walkable floor areas in image pixel coordinates (house.png is 1536x1024).
// A character's position is the point between its feet. A position is walkable
// when the whole foot box around it sits inside the union of these rectangles,
// so the walls are simply "everything not listed here".

export const MAP_W = 1536;
export const MAP_H = 1024;

export const AREAS = [
  { name: 'living room', x1: 240, y1: 225, x2: 805, y2: 738 },
  { name: 'hallway', x1: 800, y1: 472, x2: 980, y2: 738 },
  { name: 'bedroom door', x1: 872, y1: 360, x2: 932, y2: 480, door: true },
  { name: 'bedroom', x1: 850, y1: 172, x2: 1336, y2: 368 },
  { name: 'office door', x1: 972, y1: 546, x2: 1022, y2: 616, door: true },
  { name: 'office', x1: 1016, y1: 472, x2: 1346, y2: 740 },
];

// Solid bits that poke into a floor area.
export const BLOCKERS = [
  { name: 'pillar by the front door', x1: 822, y1: 690, x2: 852, y2: 760 },
];

// Half-width and height of the foot box used for collision.
export const FOOT_HALF_W = 9;
export const FOOT_H = 6;

export const SPAWN = { x: 890, y: 690 };

function pointInAreas(x, y) {
  for (const b of BLOCKERS) {
    if (x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2) return false;
  }
  for (const a of AREAS) {
    if (x >= a.x1 && x <= a.x2 && y >= a.y1 && y <= a.y2) return true;
  }
  return false;
}

export function isWalkable(x, y) {
  return (
    pointInAreas(x - FOOT_HALF_W, y) &&
    pointInAreas(x + FOOT_HALF_W, y) &&
    pointInAreas(x - FOOT_HALF_W, y - FOOT_H) &&
    pointInAreas(x + FOOT_HALF_W, y - FOOT_H) &&
    pointInAreas(x, y - FOOT_H / 2)
  );
}

export function roomAt(x, y) {
  for (const a of AREAS) {
    if (!a.door && x >= a.x1 && x <= a.x2 && y >= a.y1 && y <= a.y2) return a.name;
  }
  return 'doorway';
}

// Move from (x, y) by (dx, dy), sliding along walls instead of stopping dead.
export function moveWithCollision(x, y, dx, dy) {
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 4));
  const sx = dx / steps;
  const sy = dy / steps;
  for (let i = 0; i < steps; i++) {
    if (isWalkable(x + sx, y)) x += sx;
    if (isWalkable(x, y + sy)) y += sy;
  }
  return { x, y };
}

// ---- Pathfinding on a coarse grid (used for tap-to-move and "walk over to") ----

const CELL = 8;
const GW = Math.ceil(MAP_W / CELL);
const GH = Math.ceil(MAP_H / CELL);
let grid = null;

function buildGrid() {
  grid = new Uint8Array(GW * GH);
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      grid[gy * GW + gx] = isWalkable(gx * CELL + CELL / 2, gy * CELL + CELL / 2) ? 1 : 0;
    }
  }
}

function toCell(x, y) {
  return [Math.floor(x / CELL), Math.floor(y / CELL)];
}

function nearestWalkableCell(gx, gy) {
  if (!grid) buildGrid();
  for (let r = 0; r < 40; r++) {
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
        const cx = gx + ox, cy = gy + oy;
        if (cx >= 0 && cy >= 0 && cx < GW && cy < GH && grid[cy * GW + cx]) return [cx, cy];
      }
    }
  }
  return null;
}

// Returns a list of waypoints from (sx, sy) to (tx, ty), or null when unreachable.
export function findPath(sx, sy, tx, ty) {
  if (!grid) buildGrid();
  const start = nearestWalkableCell(...toCell(sx, sy));
  const goal = nearestWalkableCell(...toCell(tx, ty));
  if (!start || !goal) return null;
  const si = start[1] * GW + start[0];
  const gi = goal[1] * GW + goal[0];
  const prev = new Int32Array(GW * GH).fill(-1);
  prev[si] = si;
  const queue = new Int32Array(GW * GH);
  let head = 0, tail = 0;
  queue[tail++] = si;
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (head < tail) {
    const cur = queue[head++];
    if (cur === gi) break;
    const cx = cur % GW, cy = (cur / GW) | 0;
    for (const [ox, oy] of dirs) {
      const nx = cx + ox, ny = cy + oy;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const ni = ny * GW + nx;
      if (!grid[ni] || prev[ni] !== -1) continue;
      // No corner cutting through walls on diagonals.
      if (ox && oy && (!grid[cy * GW + nx] || !grid[ny * GW + cx])) continue;
      prev[ni] = cur;
      queue[tail++] = ni;
    }
  }
  if (prev[gi] === -1) return null;
  const cells = [];
  for (let c = gi; c !== si; c = prev[c]) cells.push(c);
  cells.reverse();
  const pts = cells.map((c) => ({ x: (c % GW) * CELL + CELL / 2, y: ((c / GW) | 0) * CELL + CELL / 2 }));
  // Land exactly on the tapped spot when it's walkable.
  if (isWalkable(tx, ty) && pts.length) pts[pts.length - 1] = { x: tx, y: ty };
  return smoothPath(sx, sy, pts);
}

function lineWalkable(x1, y1, x2, y2) {
  const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 4);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    if (!isWalkable(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) return false;
  }
  return true;
}

// Drop waypoints that can be skipped with a straight, wall-free line.
function smoothPath(sx, sy, pts) {
  const out = [];
  let ax = sx, ay = sy, i = 0;
  while (i < pts.length) {
    let j = pts.length - 1;
    while (j > i && !lineWalkable(ax, ay, pts[j].x, pts[j].y)) j--;
    out.push(pts[j]);
    ax = pts[j].x;
    ay = pts[j].y;
    i = j + 1;
  }
  return out;
}
