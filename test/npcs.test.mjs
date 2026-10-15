// Housemates: their favourite spots are reachable, they never end up inside
// walls or furniture, they react to people, and the house remembers them.
import assert from 'node:assert/strict';
import { Npcs, ROLES } from '../src/npcs.js';
import { Room } from '../src/room.js';
import { isWalkable, isValidSpot, findPath, SPAWN } from '../public/js/map.js';

for (const [key, r] of Object.entries(ROLES)) {
  for (const a of r.activities) for (const s of a.spots || []) {
    assert.ok(isWalkable(s.x, s.y), `${key} spot ${s.x},${s.y} is on the floor`);
    assert.ok(findPath(SPAWN.x, SPAWN.y, s.x, s.y), `${key} spot ${s.x},${s.y} is reachable`);
  }
}

// Run one of each for 10 simulated minutes.
let clock = 1_000_000;
const realNow = Date.now;
Date.now = () => clock;
const said = [];
let nextId = 1;
const npcs = new Npcs({
  nextId: () => nextId++,
  others: (self) => [...npcs.list.values()].filter((n) => n !== self),
  say: (n, text) => said.push(text),
  emote: () => {},
  act: () => {},
});
for (const role of Object.keys(ROLES)) npcs.add(role, 0);
const poses = new Set();
const usedSeats = new Set();
for (let i = 0; i < 10 * 60 * 15; i++) {
  clock += 66;
  npcs.update(66, true);
  for (const n of npcs.list.values()) {
    poses.add(n.pose);
    if (n.seat) usedSeats.add(n.npc + ':' + n.pose);
    assert.ok(isValidSpot(n.x, n.y), `${n.name} (${n.npc}) ended up in a wall at ${n.x},${n.y}`);
  }
  // No two people in the same seat.
  const seated = [...npcs.list.values()].filter((n) => n.seat).map((n) => `${n.x},${n.y}`);
  assert.equal(new Set(seated).size, seated.length, 'two housemates in one seat');
}
Date.now = realNow;
assert.ok(poses.has('bed') && poses.has('sit'), `housemates use the furniture (saw ${[...poses]})`);
assert.ok(said.length > 0, 'housemates chat now and then');
console.log('seats used:', [...usedSeats].join(', '));

// Through the Room: add, react, remember, save/load.
function fakeSocket() {
  const listeners = {};
  const ws = {
    readyState: 1,
    sent: [],
    send: (d) => ws.sent.push(JSON.parse(d)),
    close: () => {
      ws.readyState = 3;
      (listeners.close || []).forEach((f) => f({}));
    },
    addEventListener: (t, f) => (listeners[t] ||= []).push(f),
    receive: async (msg) => {
      for (const f of listeners.message || []) await f({ data: JSON.stringify(msg) });
    },
  };
  return ws;
}
let stored = null;
const store = { load: async () => stored && JSON.parse(JSON.stringify(stored)), save: async (d) => void (stored = JSON.parse(JSON.stringify(d))) };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let room = new Room('n', () => {}, store);
const a = fakeSocket();
room.attach(a);
await a.receive({ t: 'join', name: 'Ann', look: 0, token: 'token-ann-npc' });
await a.receive({ t: 'addNpc', role: 'animator', look: 1, name: 'Ava' });
const joined = a.sent.find((m) => m.t === 'join' && m.player.npc === 'animator');
assert.ok(joined && joined.player.name === 'Ava', 'housemate joined everyone');
const ava = joined.player.id;
await wait(900);
await a.receive({ t: 'addNpc', role: 'nope', look: 0 });
assert.equal(room.npcs.size, 1, 'unknown roles are refused');

// Wave at Ava: she waves back and says something.
await a.receive({ t: 'action', target: ava, action: 'wave' });
await wait(1600);
assert.ok(a.sent.some((m) => m.t === 'action' && m.from === ava && m.action === 'wave'), 'Ava waves back');
assert.ok(a.sent.some((m) => m.t === 'chat' && m.from === ava), 'Ava says hi');

// Remembered after a restart.
a.close();
await wait(10);
assert.equal(stored.npcs[0].name, 'Ava');
room = new Room('n', () => {}, store);
await room.ready;
assert.equal([...room.npcs.list.values()][0].name, 'Ava', 'Ava is still living here');

// Saves bring back the housemates who were there.
const b = fakeSocket();
room.attach(b);
await b.receive({ t: 'join', name: 'Ann', look: 0, token: 'token-ann-npc' });
await b.receive({ t: 'save', name: 'With Ava' });
const id = [...room.npcs.list.keys()][0];
await wait(900);
await b.receive({ t: 'removeNpc', id });
assert.equal(room.npcs.size, 0, 'sent home');
await wait(1100);
await b.receive({ t: 'load', id: stored.saves[0].id });
assert.equal([...room.npcs.list.values()][0]?.name, 'Ava', 'loading the save brings Ava back');
assert.ok(b.sent.some((m) => m.t === 'saves' && m.list[0].who.some((w) => w.includes('Ava'))), 'save list shows Ava');
// Real players can never be removed, only computer housemates.
const c = fakeSocket();
room.attach(c);
await c.receive({ t: 'join', name: 'Cam', look: 1, token: 'token-cam-321' });
const camId = c.sent.find((m) => m.t === 'welcome').id;
await wait(300);
await b.receive({ t: 'removeNpc', id: camId });
assert.ok(room.players.has(camId), 'a real player is not removed');
assert.ok(!b.sent.some((m) => m.t === 'leave' && m.id === camId), 'nobody is told Cam left');

console.log('housemate tests passed');
process.exit(0);
