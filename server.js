// Cozy Vibes server: serves the game files and relays player state between
// everyone in the same house (room code) over WebSockets.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_PLAYERS_PER_ROOM = 16;
const TICK_MS = 66; // ~15 state broadcasts per second

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, maxPayload: 4 * 1024 });

// roomCode -> Map<id, player>
const rooms = new Map();
let nextId = 1;
let map = null; // loaded from public/js/map.js (ES module)

const ACTIONS = new Set(['wave', 'highfive', 'hug', 'heart', 'poke', 'dance', 'follow', 'unfollow']);
const POSES = new Set(['stand', 'sit', 'sleep', 'dance']);
const EMOTES = new Set(['😀', '😂', '😍', '😮', '😢', '😡', '👍', '💤', '🎉', '❤️']);

function clean(str, max) {
  return String(str ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

function cleanRoom(str) {
  return clean(str, 24).toLowerCase().replace(/[^a-z0-9-]/g, '') || 'lobby';
}

function publicPlayer(p) {
  return { id: p.id, name: p.name, look: p.look, x: p.x, y: p.y, dir: p.dir, moving: p.moving, pose: p.pose };
}

function broadcast(room, msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const p of room.values()) {
    if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(data);
  }
}

wss.on('connection', (ws) => {
  let player = null;
  let room = null;
  let roomCode = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'join' && !player) {
      roomCode = cleanRoom(msg.room);
      if (!rooms.has(roomCode)) rooms.set(roomCode, new Map());
      room = rooms.get(roomCode);
      if (room.size >= MAX_PLAYERS_PER_ROOM) {
        ws.send(JSON.stringify({ t: 'full' }));
        return ws.close();
      }
      const spawn = map.SPAWN;
      player = {
        id: nextId++,
        ws,
        name: clean(msg.name, 16) || 'Guest',
        look: Number.isInteger(msg.look) ? Math.max(0, Math.min(31, msg.look)) : 0,
        x: spawn.x + (Math.random() * 60 - 30),
        y: spawn.y - Math.random() * 20,
        dir: 'down',
        moving: false,
        pose: 'stand',
        dirty: true,
      };
      if (!map.isWalkable(player.x, player.y)) {
        player.x = spawn.x;
        player.y = spawn.y;
      }
      room.set(player.id, player);
      ws.send(
        JSON.stringify({ t: 'welcome', id: player.id, room: roomCode, players: [...room.values()].map(publicPlayer) })
      );
      broadcast(room, { t: 'join', player: publicPlayer(player) }, player.id);
      return;
    }

    if (!player) return;

    switch (msg.t) {
      case 'state': {
        const x = Number(msg.x), y = Number(msg.y);
        // Only accept positions that are actually on the floor; walls stay solid
        // even for a modified client.
        if (Number.isFinite(x) && Number.isFinite(y) && map.isWalkable(x, y)) {
          player.x = Math.round(x * 10) / 10;
          player.y = Math.round(y * 10) / 10;
        }
        if (['up', 'down', 'left', 'right'].includes(msg.dir)) player.dir = msg.dir;
        player.moving = !!msg.moving;
        if (POSES.has(msg.pose)) player.pose = msg.pose;
        player.dirty = true;
        break;
      }
      case 'action': {
        if (!ACTIONS.has(msg.action)) return;
        const target = room.get(Number(msg.target));
        if (!target || target.id === player.id) return;
        broadcast(room, { t: 'action', from: player.id, to: target.id, action: msg.action });
        break;
      }
      case 'emote': {
        if (!EMOTES.has(msg.emoji)) return;
        broadcast(room, { t: 'emote', from: player.id, emoji: msg.emoji });
        break;
      }
      case 'chat': {
        const text = clean(msg.text, 120);
        const now = Date.now();
        if (!text || now - (player.lastChat || 0) < 700) return;
        player.lastChat = now;
        broadcast(room, { t: 'chat', from: player.id, text });
        break;
      }
      case 'profile': {
        player.name = clean(msg.name, 16) || player.name;
        if (Number.isInteger(msg.look)) player.look = Math.max(0, Math.min(31, msg.look));
        broadcast(room, { t: 'profile', id: player.id, name: player.name, look: player.look });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!player) return;
    room.delete(player.id);
    broadcast(room, { t: 'leave', id: player.id });
    if (room.size === 0) rooms.delete(roomCode);
  });
});

// Batch movement updates so phones on slow networks aren't flooded.
setInterval(() => {
  for (const room of rooms.values()) {
    const changed = [];
    for (const p of room.values()) {
      if (p.dirty) {
        changed.push([p.id, p.x, p.y, p.dir, p.moving ? 1 : 0, p.pose]);
        p.dirty = false;
      }
    }
    if (changed.length) broadcast(room, { t: 's', p: changed });
  }
}, TICK_MS);

// Drop dead connections (phones that went to sleep, etc.).
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
});

// The map (walls, doors, spawn) is shared with the browser, so load the same file.
import(pathToFileURL(path.join(PUBLIC_DIR, 'js/map.js')).href).then((m) => {
  map = m;
  server.listen(PORT, () => console.log(`Cozy Vibes running on http://localhost:${PORT}`));
});
