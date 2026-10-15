// Computer-controlled housemates that players add with the "Add" button. They
// live in the Room (server side) like the cats, so everyone sees the same ones.
// To players they look like any other person in the house (with a role badge),
// so waving, hugging and the rest just work.

import { AREAS, FURNITURE, SPAWN, isWalkable, findPath, moveWithCollision } from '../public/js/map.js';
import { ROLE_INFO } from '../public/js/roles.js';

export const MAX_NPCS = 6;
const SPEED = 72;

const seatsOf = (id) => FURNITURE.find((f) => f.id === id).seats;
const ROOMS = AREAS.filter((a) => !a.door);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// What each kind of housemate likes doing. Activities are picked by weight:
//   seat:  use a piece of furniture        spots: go stand at one of these places
//   wander: stroll somewhere random        nap: lie down on the floor for a bit
const ROUTINES = {
  animator: {
    names: ['Ava', 'Kai', 'Momo', 'Remy'],
    activities: [
      { w: 6, seat: 'desk', stay: [25, 50], emote: '🎨' },
      { w: 2, wander: true },
      { w: 1, seat: 'couch', stay: [10, 20] },
    ],
    lines: ['sketching a new scene ✏️', 'this frame is so close…', 'need more coffee ☕', 'the walk cycle finally looks right!', 'adding a little squash and stretch'],
    replies: { wave: ['hey! 👋', 'oh hi, didn’t see you there'], hug: ['aww, thanks 🥰'], poke: ['hey, I almost smudged that line!'], chat: ['ooh, I should animate that', 'haha true', 'can I draw you later?'] },
  },
  chef: {
    names: ['Theo', 'Bea', 'Luca', 'Nori'],
    activities: [
      { w: 5, spots: [{ x: 653, y: 350 }, { x: 750, y: 255 }, { x: 560, y: 262 }], stay: [12, 25], emote: '🍳' },
      { w: 2, wander: true },
    ],
    lines: ['dinner’s almost ready 🍲', 'who wants pancakes? 🥞', 'smells good in here, right?', 'tasting… needs more garlic', 'I made cookies 🍪'],
    replies: { wave: ['hi! hungry? 🍽️'], hug: ['careful, flour everywhere 😄'], poke: ['hey! no stealing snacks'], chat: ['you should stay for dinner', 'yum', 'I’ll make that next!'] },
  },
  gamer: {
    names: ['Jun', 'Pixel', 'Ozzy', 'Lumi'],
    activities: [
      { w: 6, seat: 'couch', stay: [25, 50], emote: '🎮' },
      { w: 1, seat: 'desk', stay: [15, 30], emote: '🎮' },
      { w: 2, wander: true },
    ],
    lines: ['one more round!', 'gg 🎮', 'who wants to play co-op?', 'NOOO so close', 'new high score 🏆'],
    replies: { wave: ['yo! 👋'], hug: ['ok ok, pausing for a hug 🤗'], poke: ['hey I was mid-boss fight!'], chat: ['lol', 'gg', 'wanna play after?'] },
  },
  sleepy: {
    names: ['Mellow', 'Snooze', 'Dozy', 'Ren'],
    activities: [
      { w: 6, seat: 'bed', stay: [40, 80] },
      { w: 2, nap: true, stay: [20, 40] },
      { w: 1, wander: true },
    ],
    lines: ['*yawn*', 'five more minutes…', 'is it nap time? it’s always nap time', 'zzz…'],
    replies: { wave: ['mm… hi 😴'], hug: ['cozy… 💤'], poke: ['huh?! I’m awake!'], chat: ['mhm…', 'zzz', 'sounds nice…'] },
  },
  plants: {
    names: ['Fern', 'Ivy', 'Basil', 'Sage'],
    activities: [
      { w: 6, spots: [{ x: 292, y: 350 }, { x: 755, y: 312 }, { x: 1240, y: 205 }, { x: 1078, y: 692 }, { x: 1300, y: 640 }, { x: 545, y: 690 }, { x: 1080, y: 560 }], stay: [8, 16], emote: '💧' },
      { w: 1, wander: true },
    ],
    lines: ['you’re growing so well 🌱', 'a little water for you 💧', 'this one needs more sun ☀️', 'new leaf! 🌿'],
    replies: { wave: ['hello! 🌻'], hug: ['you’re as nice as a sunny day ☀️'], poke: ['careful, the pothos is delicate!'], chat: ['that’s lovely', 'plants agree 🌱', 'aww'] },
  },
  bookworm: {
    names: ['Mira', 'Otto', 'Wren', 'Iris'],
    activities: [
      { w: 4, spots: [{ x: 290, y: 280 }, { x: 1300, y: 575 }], stay: [20, 40], emote: '📖' },
      { w: 3, seat: 'couch', stay: [20, 40], emote: '📖' },
      { w: 1, wander: true },
    ],
    lines: ['just one more chapter 📖', 'shh, it’s getting good', 'have you read this one?', 'plot twist!! 😮'],
    replies: { wave: ['oh! hi 👋'], hug: ['🥰 thanks'], poke: ['you made me lose my page!'], chat: ['interesting…', 'that’s like a book I read', 'hm!'] },
  },
};

export const ROLES = Object.fromEntries(Object.entries(ROUTINES).map(([k, v]) => [k, { ...ROLE_INFO[k], ...v }]));

const REPLY_ACTION = { wave: 'wave', highfive: 'highfive', hug: 'hug', heart: 'heart' };

export class Npcs {
  // room provides: nextId(), others(npc) -> people/housemates, say(npc, text),
  // emote(npc, emoji), act(npc, targetId, action)
  constructor(room) {
    this.room = room;
    this.list = new Map(); // id -> housemate
  }

  get size() {
    return this.list.size;
  }

  add(role, look, name, at) {
    const r = ROLES[role];
    const npc = {
      id: this.room.nextId(),
      npc: role,
      name: name || pick(r.names),
      look,
      x: at?.x ?? SPAWN.x + rand(-25, 25),
      y: at?.y ?? SPAWN.y - rand(0, 15),
      dir: at?.dir || 'down',
      moving: false,
      pose: 'stand',
      dirty: true,
      path: null,
      seat: null,
      goingToSeat: null,
      plan: null,
      waitUntil: Date.now() + rand(800, 2500),
      danceUntil: 0,
      nextLineAt: Date.now() + rand(15000, 40000),
    };
    if (!isWalkable(npc.x, npc.y)) {
      npc.x = SPAWN.x;
      npc.y = SPAWN.y;
    }
    // Back in a seat they were saved in.
    if (at) {
      const seat = FURNITURE.flatMap((f) => f.seats).find((s) => Math.abs(s.x - at.x) < 1 && Math.abs(s.y - at.y) < 1);
      if (seat && this.seatFree(seat, npc)) this.sitIn(npc, seat, Date.now() + rand(10000, 30000));
    }
    this.list.set(npc.id, npc);
    return npc;
  }

  remove(id) {
    const npc = this.list.get(id);
    this.list.delete(id);
    return npc;
  }

  serialize() {
    return [...this.list.values()].map((n) => ({ role: n.npc, name: n.name, look: n.look, x: n.x, y: n.y, dir: n.dir }));
  }

  // Replace everyone with a saved roster. Returns [removed, added].
  restore(saved) {
    const removed = [...this.list.values()];
    this.list.clear();
    const added = [];
    for (const s of Array.isArray(saved) ? saved.slice(0, MAX_NPCS) : []) {
      if (!ROLES[s.role]) continue;
      added.push(this.add(s.role, Number.isInteger(s.look) ? s.look : 0, String(s.name || '').slice(0, 16), s));
    }
    return [removed, added];
  }

  // ---- Furniture ----
  seatFree(seat, self) {
    for (const p of this.room.others(self)) if (Math.hypot(p.x - seat.x, p.y - seat.y) < 4) return false;
    return true;
  }

  sitIn(npc, seat, until) {
    const f = FURNITURE.find((k) => k.seats.includes(seat));
    npc.x = seat.x;
    npc.y = seat.y;
    npc.dir = seat.dir;
    npc.pose = f.pose;
    npc.seat = seat;
    npc.waitUntil = until;
    npc.dirty = true;
  }

  leaveSeat(npc) {
    if (!npc.seat) return;
    npc.x = npc.seat.entry.x;
    npc.y = npc.seat.entry.y;
    npc.seat = null;
    npc.pose = 'stand';
    npc.dirty = true;
  }

  goTo(npc, x, y) {
    this.leaveSeat(npc);
    npc.pose = 'stand';
    npc.path = findPath(npc.x, npc.y, x, y);
    return !!npc.path;
  }

  // ---- Choosing what to do next ----
  decide(npc, now) {
    const role = ROLES[npc.npc];
    const total = role.activities.reduce((s, a) => s + a.w, 0);
    let r = Math.random() * total;
    let act = role.activities[0];
    for (const a of role.activities) {
      if ((r -= a.w) <= 0) {
        act = a;
        break;
      }
    }
    npc.plan = act;
    if (act.seat) {
      const free = seatsOf(act.seat).filter((s) => this.seatFree(s, npc));
      if (free.length) {
        const seat = pick(free);
        if (this.goTo(npc, seat.entry.x, seat.entry.y)) {
          npc.goingToSeat = seat;
          return;
        }
      }
    } else if (act.spots) {
      const spot = pick(act.spots);
      if (this.goTo(npc, spot.x, spot.y)) return;
    } else if (act.nap) {
      this.leaveSeat(npc);
      npc.pose = 'sleep';
      npc.dirty = true;
      npc.waitUntil = now + rand(...act.stay) * 1000;
      return;
    }
    // Wander (also the fallback when the favourite place is taken).
    npc.plan = { wander: true };
    const area = pick(ROOMS);
    for (let i = 0; i < 20; i++) {
      const x = rand(area.x1, area.x2), y = rand(area.y1, area.y2);
      if (isWalkable(x, y) && this.goTo(npc, x, y)) return;
    }
    npc.waitUntil = now + 2000;
  }

  arrived(npc, now) {
    const plan = npc.plan || {};
    const seat = npc.goingToSeat;
    npc.goingToSeat = null;
    const stay = plan.stay ? rand(...plan.stay) * 1000 : rand(3000, 8000);
    if (seat && this.seatFree(seat, npc)) this.sitIn(npc, seat, now + stay);
    else {
      npc.dir = 'down';
      npc.waitUntil = now + stay;
    }
    if (plan.emote && Math.random() < 0.6) this.room.emote(npc, plan.emote);
  }

  // ---- Reacting to people ----
  react(npc, player, action) {
    const role = ROLES[npc.npc];
    const later = (ms, fn) => setTimeout(() => this.list.has(npc.id) && fn(), ms);
    npc.path = null;
    npc.goingToSeat = null;
    npc.waitUntil = Math.max(npc.waitUntil, Date.now() + 4000);
    if (!npc.seat && npc.pose === 'stand') {
      npc.dir = Math.abs(player.x - npc.x) > Math.abs(player.y - npc.y) ? (player.x > npc.x ? 'right' : 'left') : player.y > npc.y ? 'down' : 'up';
      npc.dirty = true;
    }
    if (REPLY_ACTION[action]) later(900, () => this.room.act(npc, player.id, REPLY_ACTION[action]));
    if (action === 'dance') {
      this.leaveSeat(npc);
      npc.pose = 'dance';
      npc.danceUntil = Date.now() + 5000;
      npc.dirty = true;
      later(1200, () => this.room.say(npc, 'let’s dance! 💃'));
      return;
    }
    if (action === 'poke') this.room.emote(npc, '😮');
    if (action === 'follow') return later(1000, () => this.room.say(npc, 'where are we going? 👣'));
    const lines = role.replies[action];
    if (lines) later(1400, () => this.room.say(npc, pick(lines)));
  }

  hearChat(player) {
    // Someone nearby might chime in.
    const near = [...this.list.values()].filter((n) => Math.hypot(n.x - player.x, n.y - player.y) < 260 && n.pose !== 'sleep' && n.pose !== 'bed');
    if (!near.length || Math.random() > 0.45) return;
    const npc = pick(near);
    setTimeout(() => this.list.has(npc.id) && this.room.say(npc, pick(ROLES[npc.npc].replies.chat)), rand(1200, 2600));
  }

  // ---- Simulation step ----
  update(dtMs, anyoneHome) {
    const now = Date.now();
    for (const npc of this.list.values()) {
      const wasMoving = npc.moving;
      npc.moving = false;
      if (npc.pose === 'dance' && now > npc.danceUntil) {
        npc.pose = 'stand';
        npc.dirty = true;
      }
      if (npc.path && npc.path.length) {
        const wp = npc.path[0];
        const dx = wp.x - npc.x, dy = wp.y - npc.y;
        const d = Math.hypot(dx, dy);
        const step = (SPEED * dtMs) / 1000;
        if (d <= Math.max(1, step)) {
          npc.x = wp.x;
          npc.y = wp.y;
          npc.path.shift();
        } else {
          const n = moveWithCollision(npc.x, npc.y, (dx / d) * step, (dy / d) * step);
          if (Math.hypot(n.x - npc.x, n.y - npc.y) < 0.01) npc.path = []; // stuck
          npc.x = n.x;
          npc.y = n.y;
          npc.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
          npc.moving = true;
        }
        npc.dirty = true;
        if (!npc.path.length) {
          npc.path = null;
          this.arrived(npc, now);
        }
      } else if (now > npc.waitUntil && npc.pose !== 'dance') {
        if (npc.pose === 'sleep') npc.pose = 'stand';
        this.decide(npc, now);
      }
      if (wasMoving !== npc.moving) npc.dirty = true;
      // Say something now and then (not in their sleep).
      if (anyoneHome && now > npc.nextLineAt) {
        npc.nextLineAt = now + rand(35000, 80000);
        if (npc.pose !== 'bed' && npc.pose !== 'sleep') this.room.say(npc, pick(ROLES[npc.npc].lines));
      }
    }
  }
}
