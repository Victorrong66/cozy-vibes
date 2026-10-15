// The house remembers where people were, and save files can be made, loaded
// and deleted. Uses fake sockets and an in-memory store.
import assert from 'node:assert/strict';
import { Room } from '../src/room.js';
import { FURNITURE } from '../public/js/map.js';

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
    last: (t) => [...ws.sent].reverse().find((m) => m.t === t),
  };
  return ws;
}
const tick = () => new Promise((r) => setTimeout(r, 5));
const waitSave = () => new Promise((r) => setTimeout(r, 1100)); // save actions are rate limited to 1/s

let stored = null;
const store = { load: async () => stored && JSON.parse(JSON.stringify(stored)), save: async (d) => void (stored = JSON.parse(JSON.stringify(d))) };

// --- Coming back puts you where you left off ---
let room = new Room('t', () => {}, store);
let a = fakeSocket();
room.attach(a);
await a.receive({ t: 'join', name: 'Ann', look: 1, token: 'token-ann-123' });
assert.equal(a.last('welcome').back, false, 'first visit is not a return');
await a.receive({ t: 'state', x: 500, y: 500, dir: 'left', moving: false, pose: 'stand' });
a.close();
await tick();
assert.ok(stored.players['token-ann-123'], 'house remembers Ann');

room = new Room('t', () => {}, store); // e.g. the server restarted
a = fakeSocket();
room.attach(a);
await a.receive({ t: 'join', name: 'Ann', look: 1, token: 'token-ann-123' });
let w = a.last('welcome');
let me = w.players.find((p) => p.id === w.id);
assert.equal(w.back, true);
assert.deepEqual([me.x, me.y, me.dir], [500, 500, 'left'], 'back where she left off');

// --- Napping in bed is remembered too ---
const bedSeat = FURNITURE.find((f) => f.id === 'bed').seats[0];
await a.receive({ t: 'state', x: bedSeat.x, y: bedSeat.y, dir: 'down', moving: false, pose: 'bed' });
a.close();
await tick();
a = fakeSocket();
room.attach(a);
await a.receive({ t: 'join', name: 'Ann', look: 1, token: 'token-ann-123' });
w = a.last('welcome');
me = w.players.find((p) => p.id === w.id);
assert.deepEqual([me.x, me.y, me.pose], [bedSeat.x, bedSeat.y, 'bed'], 'still in bed');

// --- Save, move, load ---
const b = fakeSocket();
room.attach(b);
await b.receive({ t: 'join', name: 'Ben', look: 0, token: 'token-ben-456' });
await b.receive({ t: 'state', x: 700, y: 600, dir: 'right', moving: false, pose: 'sit' });
await a.receive({ t: 'save', name: 'Movie night' });
assert.equal(stored.saves.length, 1, 'save written straight away');
let list = b.last('saves').list;
assert.equal(list[0].name, 'Movie night');
assert.deepEqual(list[0].who.sort(), ['Ann', 'Ben']);
assert.ok(!JSON.stringify(list).includes('token-'), 'save list never shows tokens');

await b.receive({ t: 'state', x: 300, y: 300, dir: 'up', moving: false, pose: 'stand' });
await waitSave();
await b.receive({ t: 'load', id: list[0].id });
const moved = b.last('moveto');
assert.deepEqual([moved.x, moved.y, moved.pose], [700, 600, 'sit'], 'Ben is back on his spot');
assert.ok(b.last('notice').text.includes('Movie night'));

// --- Loading remembers absent people's spots for when they come back ---
await waitSave();
await a.receive({ t: 'state', x: 400, y: 650, dir: 'down', moving: false, pose: 'stand' });
await a.receive({ t: 'save', name: 'Second' });
b.close();
await waitSave();
await a.receive({ t: 'load', id: stored.saves[1].id });
assert.deepEqual([stored.players['token-ben-456'].x, stored.players['token-ben-456'].y], [700, 600], 'Ben will come back where he was in the save');

// --- Delete; and only 10 saves are kept ---
await waitSave();
await a.receive({ t: 'deleteSave', id: stored.saves[0].id });
assert.equal(stored.saves.length, 1);
for (let i = 0; i < 12; i++) {
  room.saveSnapshot({ name: 'Ann' }, `Save ${i}`);
}
await tick();
assert.equal(stored.saves.length, 10, 'at most 10 saves');
assert.equal(stored.saves.at(-1).name, 'Save 11');

// --- Cats come back to where they were ---
const cat = room.cats.cats[0];
cat.x = 900;
cat.y = 600;
cat.path = null;
cat.jump = null;
room.saveSnapshot({ name: 'Ann' }, 'Cat spot');
cat.x = 400;
cat.y = 400;
room.loadSnapshot({ name: 'Ann', id: 1 }, stored.saves.at(-1).id);
assert.deepEqual([room.cats.cats[0].x, room.cats.cats[0].y], [900, 600], 'cat restored');

console.log('save tests passed');
process.exit(0);
