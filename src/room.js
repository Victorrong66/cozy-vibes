// One house full of players. This is the whole multiplayer game server, shared by
// the Node server (server.js, for running locally) and the Cloudflare Worker
// (worker/index.js, where each house is a Durable Object).
//
// Sockets only need send(), close(), readyState and addEventListener('message' |
// 'close'), which both the `ws` package and Cloudflare's WebSocket provide.
//
// A house remembers things through a `store` with load() and save(data). The
// saved data is:
//   players: token -> { name, look, x, y, dir, pose, seen }   where everyone was
//   cats:    the cats' positions and naps
//   saves:   up to MAX_SAVES named snapshots people can go back to

import { SPAWN, isWalkable, isValidSpot } from '../public/js/map.js';
import { Cats } from './cats.js';

export const MAX_PLAYERS = 16;
export const MAX_SAVES = 10;
const MAX_REMEMBERED = 60; // people a house remembers
const TICK_MS = 66; // ~15 movement broadcasts per second
const IDLE_KICK_MS = 45000; // clients check in at least every 2s while open
const PERSIST_MS = 15000; // how often to write while people are moving around

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

function cleanToken(v) {
  const t = String(v ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  return t.length >= 8 ? t : null;
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, look: p.look, x: p.x, y: p.y, dir: p.dir, moving: p.moving, pose: p.pose };
}

// Where a player is, in the shape a house remembers it.
function spotOf(p) {
  // Dancing is temporary; come back standing.
  return { name: p.name, look: p.look, x: p.x, y: p.y, dir: p.dir, pose: p.pose === 'dance' ? 'stand' : p.pose, seen: Date.now() };
}

// What the save list shows (never includes anyone's token).
function saveSummary(s) {
  return { id: s.id, name: s.name, at: s.at, by: s.by, who: Object.values(s.players).map((p) => p.name) };
}

const memoryStore = () => {
  let data = null;
  return { load: async () => data, save: async (d) => void (data = d) };
};

export class Room {
  constructor(code, onEmpty = () => {}, store = memoryStore()) {
    this.code = code;
    this.players = new Map();
    this.nextId = 1;
    this.timer = null;
    this.onEmpty = onEmpty;
    this.cats = new Cats();
    this.store = store;
    this.memory = { players: {}, cats: null, saves: [] };
    this.persistTimer = null;
    this.ready = this.loadMemory();
  }

  async loadMemory() {
    try {
      const data = await this.store.load();
      if (data && typeof data === 'object') {
        this.memory.players = data.players && typeof data.players === 'object' ? data.players : {};
        this.memory.saves = Array.isArray(data.saves) ? data.saves.slice(-MAX_SAVES) : [];
        if (data.cats) this.cats.restore(data.cats);
      }
    } catch (err) {
      console.error(`Couldn't load house "${this.code}":`, err);
    }
  }

  // Write soon (coalescing bursts), or right away when `now` is set.
  persist(now = false) {
    if (now) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
      return this.writeMemory();
    }
    if (!this.persistTimer) this.persistTimer = setTimeout(() => this.writeMemory(), PERSIST_MS);
  }

  async writeMemory() {
    this.persistTimer = null;
    for (const p of this.players.values()) if (p.token) this.memory.players[p.token] = spotOf(p);
    // Forget the people who haven't been around for longest.
    const known = Object.entries(this.memory.players);
    if (known.length > MAX_REMEMBERED) {
      known.sort((a, b) => b[1].seen - a[1].seen);
      this.memory.players = Object.fromEntries(known.slice(0, MAX_REMEMBERED));
    }
    this.memory.cats = this.cats.serialize();
    try {
      await this.store.save(this.memory);
    } catch (err) {
      console.error(`Couldn't save house "${this.code}":`, err);
    }
  }

  // Wire up a freshly opened socket. The first message must be a join.
  attach(ws) {
    let player = null;
    ws.addEventListener('message', async (event) => {
      let msg;
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      await this.ready;
      if (!player) {
        if (msg.t === 'join') player = this.join(ws, msg);
        return;
      }
      player.lastSeen = Date.now();
      this.handle(player, msg);
    });
    ws.addEventListener('close', async () => {
      await this.ready;
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
    const token = cleanToken(msg.token);
    const player = {
      id: this.nextId++,
      ws,
      token,
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
    // Back where you left off, unless someone else is in that spot now.
    const remembered = token && this.memory.players[token];
    const back = remembered && this.placeAt(player, remembered);
    this.players.set(player.id, player);
    this.sendTo(player, {
      t: 'welcome',
      id: player.id,
      room: this.code,
      back: !!back,
      players: [...this.players.values()].map(publicPlayer),
      cats: this.cats.snapshot(),
    });
    this.broadcast({ t: 'join', player: publicPlayer(player) }, player.id);
    if (!this.timer) this.timer = setInterval(() => this.tick(), TICK_MS);
    return player;
  }

  // Put a player at a remembered spot if it's valid and free. Returns true if moved.
  placeAt(player, spot) {
    const x = Number(spot.x), y = Number(spot.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !isValidSpot(x, y)) return false;
    for (const other of this.players.values()) {
      if (other !== player && Math.hypot(other.x - x, other.y - y) < 4) return false;
    }
    player.x = x;
    player.y = y;
    player.dir = DIRS.has(spot.dir) ? spot.dir : 'down';
    player.pose = POSES.has(spot.pose) && spot.pose !== 'dance' ? spot.pose : 'stand';
    // A seat pose only makes sense in a seat; on the open floor, sitting and napping are fine.
    if (!isWalkable(x, y) && player.pose === 'stand') player.pose = 'sit';
    player.dirty = true;
    return true;
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
        if (player.token) this.persist();
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
      case 'saves':
        this.sendTo(player, { t: 'saves', list: this.memory.saves.map(saveSummary) });
        break;
      case 'save':
      case 'load':
      case 'deleteSave': {
        const now = Date.now();
        if (now - (player.lastSaveAction || 0) < 1000) return;
        player.lastSaveAction = now;
        if (msg.t === 'save') this.saveSnapshot(player, clean(msg.name, 40));
        else if (msg.t === 'load') this.loadSnapshot(player, String(msg.id));
        else this.deleteSnapshot(player, String(msg.id));
        break;
      }
    }
  }

  // ---- Save files ----

  saveSnapshot(player, name) {
    const players = {};
    let n = 0;
    for (const p of this.players.values()) players[p.token || `guest-${n++}`] = spotOf(p);
    const save = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: name || 'Untitled save',
      at: Date.now(),
      by: player.name,
      players,
      cats: this.cats.serialize(),
    };
    this.memory.saves.push(save);
    if (this.memory.saves.length > MAX_SAVES) this.memory.saves.shift();
    this.persist(true);
    this.broadcast({ t: 'saves', list: this.memory.saves.map(saveSummary) });
    this.broadcast({ t: 'notice', text: `💾 ${player.name} saved "${save.name}"` });
  }

  loadSnapshot(player, id) {
    const save = this.memory.saves.find((s) => s.id === id);
    if (!save) return this.sendTo(player, { t: 'notice', text: 'That save is gone. Someone may have deleted it.' });
    // Everyone in the save goes back to their spot: right now if they're here,
    // or the next time they come over.
    for (const [token, spot] of Object.entries(save.players)) {
      if (token.startsWith('guest-')) continue;
      const here = [...this.players.values()].find((p) => p.token === token);
      if (here) {
        if (this.placeAt(here, spot)) this.sendTo(here, { t: 'moveto', x: here.x, y: here.y, dir: here.dir, pose: here.pose });
      } else {
        this.memory.players[token] = { ...spot, seen: Date.now() };
      }
    }
    this.cats.restore(save.cats);
    this.persist(true);
    this.broadcast({ t: 'notice', text: `📂 ${player.name} loaded "${save.name}"` });
  }

  deleteSnapshot(player, id) {
    const i = this.memory.saves.findIndex((s) => s.id === id);
    if (i === -1) return;
    const [gone] = this.memory.saves.splice(i, 1);
    this.persist(true);
    this.broadcast({ t: 'saves', list: this.memory.saves.map(saveSummary) });
    this.broadcast({ t: 'notice', text: `🗑️ ${player.name} deleted "${gone.name}"` });
  }

  leave(player) {
    if (!this.players.delete(player.id)) return;
    if (player.token) this.memory.players[player.token] = spotOf(player);
    this.broadcast({ t: 'leave', id: player.id });
    this.persist(true);
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
