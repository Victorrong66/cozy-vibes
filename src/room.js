// One house full of players. This is the whole multiplayer game server, shared by
// the Node server (server.js, for running locally) and the Cloudflare Worker
// (worker/index.js, where each house is a Durable Object).
//
// Sockets only need send(), close(), readyState and addEventListener('message' |
// 'close'), which both the `ws` package and Cloudflare's WebSocket provide.

import { SPAWN, isWalkable, isValidSpot } from '../public/js/map.js';
import { Cats } from './cats.js';

export const MAX_PLAYERS = 16;
const TICK_MS = 66; // ~15 movement broadcasts per second
const IDLE_KICK_MS = 45000; // clients check in at least every 2s while open

const ACTIONS = new Set(['wave', 'highfive', 'hug', 'heart', 'poke', 'dance', 'follow', 'unfollow']);
const POSES = new Set(['stand', 'sit', 'sleep', 'dance', 'bed']);
const DIRS = new Set(['up', 'down', 'left', 'right']);
const CAT_ACTIONS = new Set(['pet', 'play', 'tease', 'call']);
const EMOTES = new Set(['😀', '😂', '😍', '😮', '😢', '😡', '👍', '💤', '🎉', '❤️']);
const OPEN = 1;

function clean(str, max) {
  return String(str ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

export function cleanRoom(str) {
  return clean(str, 24).toLowerCase().replace(/[^a-z0-9-]/g, '') || 'lobby';
}

function cleanLook(v, fallback) {
  return Number.isInteger(v) ? Math.max(0, Math.min(31, v)) : fallback;
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, look: p.look, x: p.x, y: p.y, dir: p.dir, moving: p.moving, pose: p.pose };
}

export class Room {
  constructor(code, onEmpty = () => {}) {
    this.code = code;
    this.players = new Map();
    this.nextId = 1;
    this.timer = null;
    this.onEmpty = onEmpty;
    this.cats = new Cats();
  }

  // Wire up a freshly opened socket. The first message must be a join.
  attach(ws) {
    let player = null;
    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (!player) {
        if (msg.t === 'join') player = this.join(ws, msg);
        return;
      }
      player.lastSeen = Date.now();
      this.handle(player, msg);
    });
    ws.addEventListener('close', () => {
      if (player) this.leave(player);
      player = null;
    });
  }

  join(ws, msg) {
    if (this.players.size >= MAX_PLAYERS) {
      ws.send(JSON.stringify({ t: 'full' }));
      ws.close(1000, 'full');
      return null;
    }
    const player = {
      id: this.nextId++,
      ws,
      name: clean(msg.name, 16) || 'Guest',
      look: cleanLook(msg.look, 0),
      x: SPAWN.x + (Math.random() * 60 - 30),
      y: SPAWN.y - Math.random() * 20,
      dir: 'down',
      moving: false,
      pose: 'stand',
      dirty: true,
      lastSeen: Date.now(),
      lastChat: 0,
    };
    if (!isWalkable(player.x, player.y)) {
      player.x = SPAWN.x;
      player.y = SPAWN.y;
    }
    this.players.set(player.id, player);
    this.sendTo(player, { t: 'welcome', id: player.id, room: this.code, players: [...this.players.values()].map(publicPlayer), cats: this.cats.snapshot() });
    this.broadcast({ t: 'join', player: publicPlayer(player) }, player.id);
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    return player;
  }

  handle(player, msg) {
    switch (msg.t) {
      case 'state': {
        const x = Number(msg.x), y = Number(msg.y);
        // Only accept positions on the floor or in a seat, so walls and furniture
        // stay solid even for a modified client.
        if (Number.isFinite(x) && Number.isFinite(y) && isValidSpot(x, y)) {
          player.x = Math.round(x * 10) / 10;
          player.y = Math.round(y * 10) / 10;
        }
        if (DIRS.has(msg.dir)) player.dir = msg.dir;
        player.moving = !!msg.moving;
        if (POSES.has(msg.pose)) player.pose = msg.pose;
        player.dirty = true;
        break;
      }
      case 'action': {
        if (!ACTIONS.has(msg.action)) return;
        const target = this.players.get(Number(msg.target));
        if (!target || target.id === player.id) return;
        this.broadcast({ t: 'action', from: player.id, to: target.id, action: msg.action });
        break;
      }
      case 'emote':
        if (EMOTES.has(msg.emoji)) this.broadcast({ t: 'emote', from: player.id, emoji: msg.emoji });
        break;
      case 'chat': {
        const text = clean(msg.text, 120);
        const now = Date.now();
        if (!text || now - player.lastChat < 700) return;
        player.lastChat = now;
        this.broadcast({ t: 'chat', from: player.id, text });
        break;
      }
      case 'cat': {
        if (!CAT_ACTIONS.has(msg.action)) return;
        const now = Date.now();
        if (now - (player.lastCat || 0) < 400) return;
        player.lastCat = now;
        const fx = this.cats.interact(player, String(msg.id), msg.action);
        if (fx) this.broadcast({ t: 'catfx', by: player.id, action: msg.action, ...fx });
        break;
      }
      case 'profile':
        player.name = clean(msg.name, 16) || player.name;
        player.look = cleanLook(msg.look, player.look);
        this.broadcast({ t: 'profile', id: player.id, name: player.name, look: player.look });
        break;
    }
  }

  leave(player) {
    if (!this.players.delete(player.id)) return;
    this.broadcast({ t: 'leave', id: player.id });
    if (this.players.size === 0) {
      clearInterval(this.timer);
      this.timer = null;
      this.onEmpty();
    }
  }

  // Batch movement into one message per tick so phones on slow networks keep up,
  // and drop players whose connection silently died.
  tick() {
    const now = Date.now();
    const changed = [];
    for (const p of this.players.values()) {
      if (now - p.lastSeen > IDLE_KICK_MS) {
        try {
          p.ws.close(1001, 'idle');
        } catch {}
        this.leave(p);
        continue;
      }
      if (p.dirty) {
        changed.push([p.id, p.x, p.y, p.dir, p.moving ? 1 : 0, p.pose]);
        p.dirty = false;
      }
    }
    if (changed.length) this.broadcast({ t: 's', p: changed });
    // Real time since the last tick, so cats keep pace even if timers drift.
    const dt = Math.min(250, now - (this.lastTick || now - TICK_MS));
    this.lastTick = now;
    const cats = this.cats.update(dt, [...this.players.values()]);
    if (cats.length) this.broadcast({ t: 'cats', c: cats });
  }

  sendTo(player, msg) {
    if (player.ws.readyState === OPEN) player.ws.send(JSON.stringify(msg));
  }

  broadcast(msg, exceptId) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.id !== exceptId && p.ws.readyState === OPEN) {
        try {
          p.ws.send(data);
        } catch {}
      }
    }
  }
}
