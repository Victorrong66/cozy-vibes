// Offline preview: runs the real multiplayer Room inside the page, so the game works
// as a single HTML file with no server. Two bot housemates join so there's someone
// to tap on. Must be imported before game.js.

import { Room } from '../../src/room.js';
import { AREAS, FURNITURE, isWalkable, findPath, moveWithCollision } from '../../public/js/map.js';
import { HOUSE_SRC, CHARACTER_META } from './assets.gen.js';

window.COZY_HOUSE_SRC = HOUSE_SRC;

// Serve the character and cat sheets' metadata from memory.
const realFetch = window.fetch.bind(window);
window.fetch = (url, opts) => {
  const m = String(url).match(/assets\/((?:characters|cats)\/\w+)\.json$/);
  if (m && CHARACTER_META[m[1]]) {
    return Promise.resolve(new Response(JSON.stringify(CHARACTER_META[m[1]]), { headers: { 'Content-Type': 'application/json' } }));
  }
  return realFetch(url, opts);
};

// ---- A pair of in-page sockets standing in for a WebSocket connection ----

class End {
  constructor() {
    this.readyState = 0;
    this.peer = null;
    this.listeners = {};
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  emit(type, ev = {}) {
    for (const fn of this.listeners[type] || []) fn(ev);
  }
  send(data) {
    if (this.readyState !== 1) return;
    const peer = this.peer;
    setTimeout(() => peer.readyState === 1 && peer.emit('message', { data }), 0);
  }
  close() {
    if (this.readyState === 3) return;
    for (const e of [this, this.peer]) {
      e.readyState = 3;
      setTimeout(() => e.emit('close', {}), 0);
    }
  }
}

const room = new Room('preview');

function openPair() {
  const client = new End();
  const server = new End();
  client.peer = server;
  server.peer = client;
  client.readyState = server.readyState = 1;
  room.attach(server);
  return client;
}

class PreviewSocket extends End {
  constructor() {
    super();
    const inner = openPair();
    this.inner = inner;
    inner.addEventListener('message', (e) => this.emit('message', e));
    inner.addEventListener('close', () => {
      this.readyState = 3;
      this.emit('close', {});
    });
    setTimeout(() => {
      this.readyState = 1;
      this.emit('open', {});
    }, 0);
  }
  send(data) {
    this.inner.send(data);
  }
  close() {
    this.inner.close();
  }
}
window.WebSocket = PreviewSocket;

// ---- Bot housemates ----

const ROOMS = AREAS.filter((a) => !a.door);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const REPLIES = {
  wave: { action: 'wave', say: ['hiii 👋', 'oh hey!', 'hello hello'] },
  highfive: { action: 'highfive', say: ['yesss ✋', 'nice one!'] },
  hug: { action: 'hug', say: ['aww 🥰', 'cozy hug!'] },
  heart: { action: 'heart', say: ['love you too ❤️', '🥹'] },
  poke: { say: ['hey! 😆', 'stop it haha', 'what?'] },
  dance: { say: ['let’s gooo 💃', 'dance party!'] },
  follow: { say: ['where are we going?', 'follow the leader 👣'] },
};
const IDLE_LINES = ['this house is so cozy', 'anyone want tea? 🍵', 'I love this rug', 'nap time soon 😴', 'the plants look happy today 🌿'];
const CHAT_REPLIES = ['haha', 'same!', 'omg yes', 'true true', '😂', 'love that'];

function startBot(name, look, startDelay) {
  const sock = openPair();
  const bot = { id: null, x: 0, y: 0, dir: 'down', pose: 'stand', path: null, waitUntil: 0, danceUntil: 0, seat: null, goingToSeat: null };
  const others = new Map(); // id -> [x, y], to see which seats are free
  const seatFree = (s) => ![...others.values()].some(([x, y]) => Math.hypot(x - s.x, y - s.y) < 4);
  const leaveSeat = () => {
    if (!bot.seat) return;
    bot.x = bot.seat.entry.x;
    bot.y = bot.seat.entry.y;
    bot.seat = null;
    bot.pose = 'stand';
  };
  const send = (msg) => sock.send(JSON.stringify(msg));
  const say = (text, delay = 700) => setTimeout(() => send({ t: 'chat', text }), delay);

  sock.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.t === 'welcome') {
      bot.id = msg.id;
      const me = msg.players.find((p) => p.id === msg.id);
      bot.x = me.x;
      bot.y = me.y;
    } else if (msg.t === 's') {
      for (const [id, x, y] of msg.p) if (id !== bot.id) others.set(id, [x, y]);
    } else if (msg.t === 'leave') {
      others.delete(msg.id);
    } else if (msg.t === 'action' && msg.to === bot.id) {
      const r = REPLIES[msg.action];
      if (!r) return;
      bot.path = null;
      bot.goingToSeat = null;
      bot.waitUntil = performance.now() + 4000;
      if (r.action) setTimeout(() => send({ t: 'action', target: msg.from, action: r.action }), 900);
      if (msg.action === 'dance') {
        leaveSeat();
        bot.pose = 'dance';
        bot.danceUntil = performance.now() + 5000;
      }
      if (msg.action === 'poke') send({ t: 'emote', emoji: '😮' });
      say(pick(r.say), 1300);
    } else if (msg.t === 'chat' && msg.from !== bot.id && Math.random() < 0.45) {
      say(pick(CHAT_REPLIES), 1200 + Math.random() * 1500);
    }
  });

  setTimeout(() => send({ t: 'join', name, look }), startDelay);

  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    if (bot.id == null) return;

    if (bot.pose === 'dance' && now > bot.danceUntil) bot.pose = 'stand';

    let moving = false;
    if (bot.path && bot.path.length) {
      const wp = bot.path[0];
      const dx = wp.x - bot.x, dy = wp.y - bot.y;
      const d = Math.hypot(dx, dy);
      if (d < 2) bot.path.shift();
      else {
        const step = Math.min(d, 75 * dt);
        const n = moveWithCollision(bot.x, bot.y, (dx / d) * step, (dy / d) * step);
        moving = Math.hypot(n.x - bot.x, n.y - bot.y) > 0.01;
        if (!moving) bot.path = null;
        bot.x = n.x;
        bot.y = n.y;
        bot.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      }
      if (bot.path && !bot.path.length && bot.goingToSeat) {
        // Arrived at the way onto the furniture.
        const seat = bot.goingToSeat;
        bot.goingToSeat = null;
        bot.path = null;
        if (seatFree(seat)) {
          bot.seat = seat;
          bot.x = seat.x;
          bot.y = seat.y;
          bot.dir = seat.dir;
          bot.pose = FURNITURE.find((f) => f.seats.includes(seat)).pose;
          bot.waitUntil = now + rand(6000, 14000);
          if (bot.pose === 'bed') send({ t: 'emote', emoji: '💤' });
        }
      } else if (bot.path && !bot.path.length) {
        bot.path = null;
        bot.dir = 'down';
        bot.waitUntil = now + rand(2500, 7000);
        // Sometimes settle in for a bit.
        const r = Math.random();
        if (r < 0.15) bot.pose = 'sit';
        else if (r < 0.22) bot.pose = 'sleep';
        else if (r < 0.32) send({ t: 'emote', emoji: pick(['😀', '🎉', '❤️', '👍']) });
        else if (r < 0.4) say(pick(IDLE_LINES), 0);
      }
    } else if (now > bot.waitUntil && bot.pose !== 'dance') {
      leaveSeat();
      bot.goingToSeat = null;
      if (Math.random() < 0.35) {
        // Go use the bed, couch or desk.
        const seat = pick(FURNITURE.flatMap((f) => f.seats).filter(seatFree));
        if (seat) {
          bot.path = findPath(bot.x, bot.y, seat.entry.x, seat.entry.y);
          if (bot.path) {
            bot.goingToSeat = seat;
            bot.pose = 'stand';
            bot.waitUntil = now + 1500;
            return send({ t: 'state', x: bot.x, y: bot.y, dir: bot.dir, moving: false, pose: bot.pose });
          }
        }
      }
      const area = pick(ROOMS);
      for (let i = 0; i < 20; i++) {
        const tx = rand(area.x1, area.x2), ty = rand(area.y1, area.y2);
        if (!isWalkable(tx, ty)) continue;
        bot.path = findPath(bot.x, bot.y, tx, ty);
        if (bot.path) {
          bot.pose = 'stand';
          break;
        }
      }
      bot.waitUntil = now + 1500;
    }
    send({ t: 'state', x: bot.x, y: bot.y, dir: bot.dir, moving, pose: bot.pose });
  }, 100);
}

startBot('Mochi', 1, 300);
startBot('Bao', 0, 900);
