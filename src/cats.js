// The house cats. They live in the Room (server side), so everyone in a house
// sees the same cats doing the same thing. Each tick the Room calls update(),
// and anything that changed is broadcast to players.
//
// Animations the client knows how to draw:
//   walk, idle (standing), loaf (lying with head up), play (with yarn),
//   attack (a swat), jump, sleep

import { AREAS, isWalkable, findPath, moveWithCollision } from '../public/js/map.js';

export const CAT_DEFS = [
  { id: 'tabby', name: 'Biscuit', start: { x: 380, y: 372 } },
  { id: 'black', name: 'Pepper', start: { x: 1180, y: 660 } },
];

const WALK_SPEED = 52;
const RUN_SPEED = 120;
const JUMP_MS = 600;
const ROOMS = AREAS.filter((a) => !a.door);

// Favourite places to nap. `from` is where the cat jumps up from when the spot
// is on furniture.
const NAP_SPOTS = [
  { name: 'the bed', x: 1005, y: 296, from: { x: 1005, y: 338 } },
  { name: 'the cushion', x: 378, y: 372 },
  { name: 'the beanbag', x: 1262, y: 668 },
  { name: 'the hallway rug', x: 896, y: 640 },
];

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Cats {
  constructor() {
    this.cats = CAT_DEFS.map((d) => ({
      id: d.id,
      name: d.name,
      x: d.start.x,
      y: d.start.y,
      flip: Math.random() < 0.5, // true = facing left
      anim: 'idle',
      n: 0, // bumps whenever an animation starts, so clients restart it
      path: null,
      speed: WALK_SPEED,
      jump: null,
      spot: null, // nap spot it's on
      until: Date.now() + rand(1000, 4000),
      then: null, // what to do on arriving
      dirty: true,
    }));
  }

  snapshot() {
    return this.cats.map((c) => this.wire(c));
  }

  names() {
    return Object.fromEntries(this.cats.map((c) => [c.id, c.name]));
  }

  rename(id, name) {
    const c = this.cats.find((k) => k.id === id);
    if (!c || !name) return null;
    const old = c.name;
    c.name = name;
    return old;
  }

  // For save files: where each cat is and whether it's napping.
  serialize() {
    return this.cats.map((c) => ({
      id: c.id,
      x: Math.round(c.jump ? c.jump.tx : c.x),
      y: Math.round(c.jump ? c.jump.ty : c.y),
      flip: c.flip,
      name: c.name,
      napping: c.anim === 'sleep' && c.spot ? c.spot.name : null,
    }));
  }

  restore(saved) {
    for (const s of Array.isArray(saved) ? saved : []) {
      const c = this.cats.find((k) => k.id === s.id);
      if (!c) continue;
      if (typeof s.name === 'string' && s.name.trim()) c.name = s.name.trim().slice(0, 16);
      const spot = NAP_SPOTS.find((n) => n.name === s.napping);
      c.path = null;
      c.jump = null;
      c.then = null;
      c.flip = !!s.flip;
      if (spot) {
        c.x = spot.x;
        c.y = spot.y;
        c.spot = spot;
        this.setAnim(c, 'sleep', rand(15000, 30000));
      } else if (isWalkable(s.x, s.y)) {
        c.x = s.x;
        c.y = s.y;
        c.spot = null;
        this.setAnim(c, 'idle', rand(1500, 4000));
      }
      c.dirty = true;
    }
  }

  wire(c) {
    return [c.id, Math.round(c.x * 10) / 10, Math.round(c.y * 10) / 10, c.flip ? 1 : 0, c.anim, c.n];
  }

  setAnim(c, anim, ms) {
    if (c.anim !== anim) {
      c.anim = anim;
      c.n++;
    }
    if (ms != null) c.until = Date.now() + ms;
    c.dirty = true;
  }

  face(c, x) {
    if (Math.abs(x - c.x) > 2) c.flip = x < c.x;
  }

  walkTo(c, x, y, then, speed = WALK_SPEED) {
    this.leaveSpot(c);
    const path = findPath(c.x, c.y, x, y);
    if (!path || !path.length) {
      if (then) then();
      return false;
    }
    c.path = path;
    c.speed = speed;
    c.then = then || null;
    this.setAnim(c, 'walk');
    return true;
  }

  jumpTo(c, x, y, then) {
    c.jump = { fx: c.x, fy: c.y, tx: x, ty: y, t: 0 };
    this.face(c, x);
    c.then = then || null;
    this.setAnim(c, 'jump');
  }

  // A cat napping up on furniture hops down before going anywhere.
  leaveSpot(c) {
    const spot = c.spot;
    c.spot = null;
    if (spot && spot.from) {
      c.x = spot.from.x;
      c.y = spot.from.y;
      c.dirty = true;
    }
  }

  // ---- What a cat does when it's free to choose ----
  decide(c, players) {
    const r = Math.random();
    if (r < 0.42) {
      const area = pick(ROOMS);
      for (let i = 0; i < 20; i++) {
        const x = rand(area.x1, area.x2), y = rand(area.y1, area.y2);
        if (isWalkable(x, y) && this.walkTo(c, x, y, () => this.setAnim(c, 'idle', rand(1500, 4000)))) return;
      }
      this.setAnim(c, 'idle', 2000);
    } else if (r < 0.62) {
      this.goNap(c);
    } else if (r < 0.75) {
      this.setAnim(c, 'play', rand(3500, 6000));
    } else if (r < 0.87) {
      this.setAnim(c, 'loaf', rand(4000, 9000));
    } else if (players.length) {
      // Wander over to someone and hang out by their feet.
      const p = pick(players);
      const side = Math.random() < 0.5 ? -26 : 26;
      const ok = this.walkTo(c, p.x + side, p.y + 4, () => {
        this.face(c, p.x);
        this.setAnim(c, 'loaf', rand(5000, 9000));
      });
      if (!ok) this.setAnim(c, 'idle', 2000);
    } else {
      this.setAnim(c, 'idle', 3000);
    }
  }

  goNap(c) {
    const taken = new Set(this.cats.filter((o) => o !== c && o.spot).map((o) => o.spot));
    const spot = pick(NAP_SPOTS.filter((s) => !taken.has(s)));
    if (!spot) return this.setAnim(c, 'loaf', 5000);
    const settle = () => {
      c.spot = spot;
      this.setAnim(c, 'sleep', rand(15000, 32000));
    };
    const start = spot.from || spot;
    this.walkTo(c, start.x, start.y, () => {
      if (spot.from) this.jumpTo(c, spot.x, spot.y, settle);
      else {
        c.x = spot.x;
        c.y = spot.y;
        settle();
      }
    });
  }

  // ---- Players doing things to cats ----
  interact(player, id, action) {
    const c = this.cats.find((k) => k.id === id);
    if (!c) return null;
    const asleep = c.anim === 'sleep';
    c.then = null;
    switch (action) {
      case 'pet':
        if (asleep) return { id, emoji: '💤', text: `${c.name} purrs in their sleep` };
        c.path = null;
        c.jump = null;
        this.face(c, player.x);
        this.setAnim(c, 'loaf', rand(5000, 8000));
        return { id, emoji: '💕', text: `${c.name} purrs` };
      case 'play':
        if (c.jump) return null;
        this.leaveSpot(c);
        c.path = null;
        this.face(c, player.x);
        this.setAnim(c, 'play', rand(5000, 7000));
        return { id, emoji: '🧶', text: `${c.name} pounces on the yarn` };
      case 'tease':
        if (c.jump) return null;
        this.leaveSpot(c);
        c.path = null;
        this.face(c, player.x);
        this.setAnim(c, 'attack', 700);
        // After the swat, dash off somewhere else.
        c.then = () => {
          const area = pick(ROOMS);
          for (let i = 0; i < 20; i++) {
            const x = rand(area.x1, area.x2), y = rand(area.y1, area.y2);
            if (isWalkable(x, y) && this.walkTo(c, x, y, () => this.setAnim(c, 'idle', 2000), RUN_SPEED)) return;
          }
        };
        return { id, emoji: '💢', text: `${c.name} swats at you` };
      case 'call': {
        if (c.jump) return null;
        const side = player.x > c.x ? -26 : 26;
        const ok = this.walkTo(c, player.x + side, player.y + 4, () => {
          this.face(c, player.x);
          this.setAnim(c, 'loaf', rand(6000, 10000));
        }, asleep ? WALK_SPEED : WALK_SPEED * 1.4);
        if (!ok) return { id, emoji: '❓', text: `${c.name} can't reach you` };
        return { id, emoji: '🐾', text: `${c.name} is coming over` };
      }
    }
    return null;
  }

  // ---- Simulation step; returns the cats that changed ----
  update(dtMs, players) {
    const now = Date.now();
    const changed = [];
    for (const c of this.cats) {
      if (c.jump) {
        const j = c.jump;
        j.t += dtMs;
        const t = Math.min(1, j.t / JUMP_MS);
        c.x = j.fx + (j.tx - j.fx) * t;
        c.y = j.fy + (j.ty - j.fy) * t;
        c.dirty = true;
        if (t >= 1) {
          c.jump = null;
          const then = c.then;
          c.then = null;
          if (then) then();
          else this.setAnim(c, 'idle', 1500);
        }
      } else if (c.path && c.path.length) {
        const wp = c.path[0];
        const dx = wp.x - c.x, dy = wp.y - c.y;
        const d = Math.hypot(dx, dy);
        const step = (c.speed * dtMs) / 1000;
        if (d <= Math.max(1, step)) {
          c.x = wp.x;
          c.y = wp.y;
          c.path.shift();
        } else {
          const n = moveWithCollision(c.x, c.y, (dx / d) * step, (dy / d) * step);
          if (Math.hypot(n.x - c.x, n.y - c.y) < 0.01) c.path = []; // stuck
          c.x = n.x;
          c.y = n.y;
          this.face(c, wp.x);
        }
        c.dirty = true;
        if (!c.path.length) {
          c.path = null;
          const then = c.then;
          c.then = null;
          if (then) then();
          else this.setAnim(c, 'idle', 2000);
        }
      } else if (now > c.until) {
        if (c.spot) {
          // Wake up; hop down first if napping on furniture.
          const spot = c.spot;
          c.spot = null;
          if (spot.from) this.jumpTo(c, spot.from.x, spot.from.y, () => this.setAnim(c, 'idle', 800));
          else this.setAnim(c, 'idle', 800);
        } else if (c.then) {
          const then = c.then;
          c.then = null;
          then();
        } else {
          this.decide(c, players);
        }
      }
      if (c.dirty) {
        c.dirty = false;
        changed.push(this.wire(c));
      }
    }
    return changed;
  }
}
