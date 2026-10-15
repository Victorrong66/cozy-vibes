// Local / Node server: serves the game files and runs a Room per house code.
// The live site runs the same Room on Cloudflare instead (see worker/index.js).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Room, cleanRoom } from './src/room.js';

const PORT = process.env.PORT || 3000;
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
// Each house's memory and save files live in one JSON file here.
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
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

function fileStore(code) {
  const file = path.join(DATA_DIR, `${code}.json`);
  return {
    load: async () => {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return null; // a brand new house
      }
    },
    save: async (data) => {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(data));
      fs.renameSync(`${file}.tmp`, file); // never leave a half-written file
    },
  };
}

const rooms = new Map(); // house code -> Room
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4 * 1024 });

wss.on('connection', (ws, req) => {
  const code = cleanRoom(new URL(req.url, 'http://x').searchParams.get('room'));
  let room = rooms.get(code);
  if (!room) {
    room = new Room(code, () => rooms.delete(code), fileStore(code));
    rooms.set(code, room);
  }
  room.attach(ws);
});

server.listen(PORT, () => console.log(`Cozy Vibes running on http://localhost:${PORT}`));
