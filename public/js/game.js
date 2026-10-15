import { MAP_W, MAP_H, FURNITURE, isWalkable, moveWithCollision, findPath, roomAt, furnitureAt } from './map.js';
import { LOOKS, CHAR_H, loadCharacters, charWidth, drawCharacter, drawPortrait } from './characters.js';
import { CAT_H, loadCats, drawCat, drawCatPortrait } from './cats.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d');

const SPEED = 130; // world px per second
const NEAR = 44; // how close you need to be to hug / high five
const EMOTES = ['😀', '😂', '😍', '😮', '😢', '😡', '👍', '💤', '🎉', '❤️'];

const houseImg = new Image();
houseImg.src = window.COZY_HOUSE_SRC || 'assets/house.png'; // the offline preview embeds it

const state = {
  myId: null,
  room: null,
  players: new Map(), // id -> player
  effects: [], // floating emojis
  ripples: [], // tap markers
  zoomMul: 1,
  cats: new Map(), // id -> cat (run by the server)
};

// The local player's movement intent.
const me = {
  path: null,
  follow: null, // id of player being followed
  pending: null, // { target, action } to do once we reach them
  repathAt: 0,
  danceUntil: 0,
  seat: null, // the bed / couch / desk seat we're in
  goingToSeat: null, // the seat we're walking over to
};

let ws = null;
let joined = false;
let profile = loadProfile();

function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem('cozy-profile') || '{}');
    return { name: p.name || '', look: Number.isInteger(p.look) ? p.look : Math.floor(Math.random() * 2) };
  } catch {
    return { name: '', look: 0 };
  }
}
function saveProfile() {
  try {
    localStorage.setItem('cozy-profile', JSON.stringify(profile));
  } catch {}
}

// ---------------------------------------------------------------------------
// Join screen
// ---------------------------------------------------------------------------

function lookButton(i, selected, onPick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'look' + (selected ? ' selected' : '');
  const c = document.createElement('canvas');
  c.width = 88;
  c.height = 140;
  drawPortrait(c, i);
  const label = document.createElement('span');
  label.textContent = LOOKS[i].name;
  b.append(c, label);
  b.addEventListener('click', () => onPick(i, b));
  return b;
}

function buildPicker() {
  const picker = $('picker');
  picker.innerHTML = '';
  LOOKS.forEach((_, i) => {
    picker.append(
      lookButton(i, i === profile.look, (idx, btn) => {
        profile.look = idx;
        picker.querySelectorAll('.look').forEach((el) => el.classList.remove('selected'));
        btn.classList.add('selected');
      })
    );
  });
}

function initJoin() {
  const params = new URLSearchParams(location.search);
  $('nameInput').value = profile.name;
  $('roomInput').value = params.get('room') || randomRoom();
  buildPicker();
  const go = () => {
    profile.name = $('nameInput').value.trim().slice(0, 16) || LOOKS[profile.look].name;
    saveProfile();
    const room = ($('roomInput').value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '') || 'lobby').slice(0, 24);
    history.replaceState(null, '', `?room=${encodeURIComponent(room)}`);
    $('join').classList.add('hidden');
    connect(room);
  };
  $('joinBtn').addEventListener('click', go);
  $('nameInput').addEventListener('keydown', (e) => e.key === 'Enter' && go());
  $('roomInput').addEventListener('keydown', (e) => e.key === 'Enter' && go());
}

function randomRoom() {
  const words = ['maple', 'fern', 'acorn', 'cocoa', 'pine', 'honey', 'moss', 'plum', 'tea', 'clover'];
  return words[Math.floor(Math.random() * words.length)] + '-' + Math.floor(100 + Math.random() * 900);
}

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------

let reconnectDelay = 500;

function connect(room) {
  state.room = room;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws?room=${encodeURIComponent(room)}`);
  showStatus(joined ? 'Reconnecting…' : 'Entering the house…');

  ws.addEventListener('open', () => {
    reconnectDelay = 500;
    send({ t: 'join', room, name: profile.name, look: profile.look });
  });
  ws.addEventListener('message', (e) => {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    onMessage(msg);
  });
  ws.addEventListener('close', () => {
    if (state.full) return;
    showStatus('Connection lost. Reconnecting…');
    setTimeout(() => connect(room), reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 8000);
  });
}

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function makePlayer(p) {
  return {
    id: p.id,
    name: p.name,
    look: p.look,
    x: p.x,
    y: p.y,
    tx: p.x, // network target (remote players are smoothed toward it)
    ty: p.y,
    dir: p.dir || 'down',
    moving: !!p.moving,
    pose: p.pose || 'stand',
    animT: Math.random() * 10,
    bubble: null,
    shakeUntil: 0,
  };
}

function onMessage(msg) {
  switch (msg.t) {
    case 'welcome': {
      const prev = state.players.get(state.myId);
      me.seat = me.goingToSeat = null;
      state.myId = msg.id;
      state.players.clear();
      for (const p of msg.players) state.players.set(p.id, makePlayer(p));
      state.cats.clear();
      for (const c of msg.cats || []) updateCat(c);
      const mine = state.players.get(msg.id);
      if (prev && isWalkable(prev.x, prev.y)) {
        // Reconnected: keep standing where we were.
        mine.x = mine.tx = prev.x;
        mine.y = mine.ty = prev.y;
        mine.dir = prev.dir;
      }
      joined = true;
      hideStatus();
      $('hud').classList.remove('hidden');
      $('bottomBar').classList.remove('hidden');
      $('roomName').textContent = msg.room;
      updateCount();
      sendState(true);
      if (!prev) toast(`Welcome home, ${profile.name}! Tap the floor to walk, tap someone to interact.`);
      break;
    }
    case 'full':
      state.full = true;
      showStatus('This house is full (16 people). Try another house code.');
      break;
    case 'join':
      state.players.set(msg.player.id, makePlayer(msg.player));
      toast(`${msg.player.name} came over 🏡`);
      updateCount();
      break;
    case 'leave': {
      const p = state.players.get(msg.id);
      if (p) toast(`${p.name} went home 👋`);
      state.players.delete(msg.id);
      if (me.follow === msg.id) me.follow = null;
      if (me.pending && me.pending.target === msg.id) me.pending = null;
      if (menuTarget === msg.id) closeMenu();
      updateCount();
      break;
    }
    case 's':
      for (const [id, x, y, dir, moving, pose] of msg.p) {
        if (id === state.myId) continue;
        const p = state.players.get(id);
        if (!p) continue;
        p.tx = x;
        p.ty = y;
        p.dir = dir;
        p.moving = !!moving;
        p.pose = pose;
      }
      break;
    case 'profile': {
      const p = state.players.get(msg.id);
      if (p) {
        p.name = msg.name;
        p.look = msg.look;
      }
      break;
    }
    case 'chat': {
      const p = state.players.get(msg.from);
      if (p) p.bubble = { text: msg.text, until: performance.now() + 5000 + msg.text.length * 60 };
      break;
    }
    case 'cats':
      for (const c of msg.c) updateCat(c);
      break;
    case 'catfx':
      addEffect(msg.id, msg.emoji);
      if (msg.by === state.myId) toast(msg.text);
      break;
    case 'emote':
      addEffect(msg.from, msg.emoji);
      break;
    case 'action':
      onAction(msg.from, msg.to, msg.action);
      break;
  }
}

function updateCat([id, x, y, flip, anim, n]) {
  let c = state.cats.get(id);
  if (!c) {
    c = { id, cat: true, x, y, tx: x, ty: y, flip, anim, n, started: performance.now() };
    state.cats.set(id, c);
  }
  c.tx = x;
  c.ty = y;
  c.flip = !!flip;
  if (c.n !== n || c.anim !== anim) {
    c.anim = anim;
    c.n = n;
    c.started = performance.now();
  }
}

const CAT_NAMES = { tabby: 'Biscuit', black: 'Pepper' };

function updateCount() {
  $('playerCount').textContent = state.players.size;
}

let lastSent = '';
let lastSentAt = 0;
function sendState(force) {
  const p = state.players.get(state.myId);
  if (!p) return;
  const key = `${p.x.toFixed(1)},${p.y.toFixed(1)},${p.dir},${p.moving},${p.pose}`;
  const now = performance.now();
  if (!force && key === lastSent && now - lastSentAt < 2000) return;
  if (!force && now - lastSentAt < 60) return;
  lastSent = key;
  lastSentAt = now;
  send({ t: 'state', x: p.x, y: p.y, dir: p.dir, moving: p.moving, pose: p.pose });
}

// ---------------------------------------------------------------------------
// Actions between characters
// ---------------------------------------------------------------------------

const ACTIONS = {
  wave: { label: '👋 Wave', near: false },
  highfive: { label: '✋ High five', near: true },
  hug: { label: '🤗 Hug', near: true },
  heart: { label: '❤️ Send love', near: false },
  poke: { label: '👉 Poke', near: true },
  dance: { label: '💃 Dance together', near: true },
};

function nameOf(id) {
  return id === state.myId ? 'you' : state.players.get(id)?.name || 'Someone';
}

function onAction(from, to, action) {
  const a = state.players.get(from);
  const b = state.players.get(to);
  if (!a || !b) return;
  const toMe = to === state.myId;
  const fromMe = from === state.myId;
  switch (action) {
    case 'wave':
      addEffect(from, '👋');
      if (toMe) toast(`${a.name} waved at you 👋`);
      faceEachOther(a, b);
      break;
    case 'highfive':
      addEffect(from, '✋');
      addEffect(to, '✋');
      addEffect(from, '✨', { midTo: to });
      if (toMe) toast(`${a.name} high-fived you! ✋`);
      faceEachOther(a, b);
      break;
    case 'hug':
      addEffect(from, '🤗');
      addEffect(to, '💞');
      if (toMe) toast(`${a.name} gave you a hug 🤗`);
      faceEachOther(a, b);
      break;
    case 'heart':
      addEffect(from, '❤️', { flyTo: to });
      if (toMe) toast(`${a.name} sent you some love ❤️`);
      break;
    case 'poke':
      addEffect(to, '❗');
      b.shakeUntil = performance.now() + 500;
      if (toMe) toast(`${a.name} poked you 👉`);
      faceEachOther(a, b);
      break;
    case 'dance':
      addEffect(from, '🎵');
      addEffect(to, '🎶');
      if (toMe || fromMe) startDancing();
      if (toMe) toast(`${a.name} pulled you into a dance 💃`);
      break;
    case 'follow':
      if (toMe) toast(`${a.name} is following you 👣`);
      break;
    case 'unfollow':
      if (toMe) toast(`${a.name} stopped following you`);
      break;
  }
}

function faceEachOther(a, b) {
  const mine = state.players.get(state.myId);
  if (a !== mine && b !== mine) return;
  const other = a === mine ? b : a;
  if (mine.moving || mine.pose !== 'stand') return;
  mine.dir = dirToward(mine, other);
  sendState(true);
}

function dirToward(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

function startDancing() {
  const mine = state.players.get(state.myId);
  leaveSeat();
  me.danceUntil = performance.now() + 5000;
  mine.pose = 'dance';
  sendState(true);
}

function doAction(targetId, action) {
  const mine = state.players.get(state.myId);
  const target = state.players.get(targetId);
  if (!mine || !target) return;
  if (action === 'follow') {
    leaveSeat();
    me.goingToSeat = null;
    me.follow = targetId;
    me.pending = null;
    send({ t: 'action', target: targetId, action: 'follow' });
    toast(`Following ${target.name} 👣 (move to stop)`);
    return;
  }
  if (action === 'unfollow') {
    stopFollowing();
    return;
  }
  if (ACTIONS[action].near && !closeEnough(mine, target)) {
    // Walk over first, then do it.
    me.follow = null;
    me.pending = { target: targetId, action };
    walkTo(target.x, target.y);
    return;
  }
  send({ t: 'action', target: targetId, action });
}

// Close enough to hug or high five. Someone in bed or on the couch can be
// reached from beside the furniture.
function closeEnough(a, b) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  return d <= NEAR || (!isWalkable(b.x, b.y) && d <= 95);
}

function stopFollowing() {
  if (me.follow != null) {
    send({ t: 'action', target: me.follow, action: 'unfollow' });
    me.follow = null;
  }
}

// A player (numeric id) or a cat (string id).
function entity(id) {
  return state.players.get(id) || state.cats.get(id);
}

function addEffect(playerId, emoji, opts = {}) {
  state.effects.push({ playerId, emoji, t0: performance.now(), ...opts });
}

// ---------------------------------------------------------------------------
// Action menu (tap a character)
// ---------------------------------------------------------------------------

let menuTarget = null;

function openMenu(id, screenX, screenY) {
  const p = state.players.get(id);
  if (!p) return;
  menuTarget = id;
  const isMe = id === state.myId;
  const menu = $('actionMenu');
  drawPortrait($('menuPortrait'), p.look);
  $('menuName').textContent = isMe ? `${p.name} (you)` : p.name;
  $('menuSub').textContent = isMe ? 'What do you want to do?' : `In the ${roomAt(p.x, p.y)}`;

  const box = $('menuButtons');
  box.innerHTML = '';
  const add = (label, fn, cls = '') => {
    const b = document.createElement('button');
    b.className = 'btn ' + cls;
    b.textContent = label;
    b.addEventListener('click', () => {
      fn();
      closeMenu();
    });
    box.append(b);
    return b;
  };

  if (isMe) {
    const mine = state.players.get(state.myId);
    if (mine.pose === 'stand') {
      add('🪑 Sit down', () => setPose('sit'));
      add('😴 Nap', () => setPose('sleep'));
    } else {
      add('🧍 Stand up', () => setPose('stand'), 'wide');
    }
    add('💃 Dance', () => startDancing(), 'wide');
    const row = document.createElement('div');
    row.className = 'emotes';
    for (const e of EMOTES.slice(0, 6)) {
      const b = document.createElement('button');
      b.textContent = e;
      b.addEventListener('click', () => {
        emote(e);
        closeMenu();
      });
      row.append(b);
    }
    box.append(row);
    const looks = document.createElement('div');
    looks.className = 'looks';
    LOOKS.forEach((_, i) =>
      looks.append(
        lookButton(i, i === mine.look, (idx) => {
          profile.look = idx;
          saveProfile();
          mine.look = idx;
          send({ t: 'profile', name: profile.name, look: idx });
          closeMenu();
        })
      )
    );
    box.append(looks);
  } else {
    for (const [key, a] of Object.entries(ACTIONS)) add(a.label, () => doAction(id, key));
    if (me.follow === id) add('🛑 Stop following', () => doAction(id, 'unfollow'), 'wide');
    else add('👣 Follow', () => doAction(id, 'follow'), 'wide');
    add('🚶 Walk over', () => walkTo(p.x, p.y + 20), 'wide');
  }

  placeMenu(screenX, screenY);
}

function placeMenu(screenX, screenY) {
  const menu = $('actionMenu');
  menu.classList.remove('hidden');
  // Layout size, not getBoundingClientRect: the pop-in animation scales it down.
  const r = { width: menu.offsetWidth, height: menu.offsetHeight };
  const x = Math.min(Math.max(8, screenX - r.width / 2), innerWidth - r.width - 8);
  let y = screenY + 16;
  if (y + r.height > innerHeight - 70) y = Math.max(8, screenY - r.height - 70);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
}

const CAT_ACTIONS = {
  pet: { label: '🤚 Pet', near: true },
  play: { label: '🧶 Play', near: true },
  tease: { label: '😼 Tease', near: true },
  call: { label: '🐾 Call over', near: false },
};

const CAT_MOODS = {
  sleep: 'Fast asleep',
  play: 'Playing with yarn',
  walk: 'Wandering around',
  loaf: 'Loafing',
  attack: 'Feeling feisty',
  jump: 'Mid-jump!',
  idle: 'Just hanging out',
};

function openCatMenu(c, screenX, screenY) {
  menuTarget = c.id;
  const menu = $('actionMenu');
  drawCatPortrait($('menuPortrait'), c.id);
  $('menuName').textContent = CAT_NAMES[c.id] || 'Cat';
  $('menuSub').textContent = `${CAT_MOODS[c.anim] || 'Being a cat'} · ${roomAt(c.x, c.y) === 'doorway' ? 'in a doorway' : 'in the ' + roomAt(c.x, c.y)}`;
  const box = $('menuButtons');
  box.innerHTML = '';
  for (const [action, a] of Object.entries(CAT_ACTIONS)) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = a.label;
    b.addEventListener('click', () => {
      doCatAction(c.id, action);
      closeMenu();
    });
    box.append(b);
  }
  placeMenu(screenX, screenY);
}

function doCatAction(id, action) {
  const mine = state.players.get(state.myId);
  const c = state.cats.get(id);
  if (!mine || !c) return;
  if (CAT_ACTIONS[action].near && !closeEnough(mine, c)) {
    me.follow = null;
    me.pending = { target: id, action, cat: true };
    walkTo(c.x, c.y);
    return;
  }
  send({ t: 'cat', id, action });
}

function closeMenu() {
  menuTarget = null;
  $('actionMenu').classList.add('hidden');
}

function setPose(pose) {
  const mine = state.players.get(state.myId);
  leaveSeat();
  me.goingToSeat = null;
  me.path = null;
  stopFollowing();
  me.danceUntil = 0;
  mine.pose = pose;
  if (pose === 'sleep') addEffect(state.myId, '💤');
  sendState(true);
}

function emote(e) {
  send({ t: 'emote', emoji: e });
}

// ---------------------------------------------------------------------------
// Furniture: walk to a seat's entry point, then sit / lie down
// ---------------------------------------------------------------------------

const furnitureOf = (seat) => FURNITURE.find((f) => f.seats.includes(seat));

function seatTaken(seat) {
  for (const p of state.players.values()) {
    if (p.id !== state.myId && Math.hypot(p.tx - seat.x, p.ty - seat.y) < 4) return true;
  }
  return false;
}

function useFurniture(f) {
  const mine = state.players.get(state.myId);
  if (!mine || (me.seat && f.seats.includes(me.seat))) return;
  const free = f.seats.filter((s) => !seatTaken(s));
  if (!free.length) {
    toast(`Someone's already using the ${f.name}`);
    return;
  }
  // The seat whose way in is closest to where we're standing.
  const near = (s) => Math.hypot(s.entry.x - mine.x, s.entry.y - mine.y);
  const seat = free.sort((a, b) => near(a) - near(b))[0];
  me.pending = null;
  stopFollowing();
  walkTo(seat.entry.x, seat.entry.y);
  me.goingToSeat = seat;
}

function sitIn(seat) {
  const mine = state.players.get(state.myId);
  const f = furnitureOf(seat);
  mine.x = seat.x;
  mine.y = seat.y;
  mine.dir = seat.dir;
  mine.pose = f.pose;
  me.seat = seat;
  me.path = null;
  me.danceUntil = 0;
  if (f.pose === 'bed') addEffect(state.myId, '💤');
  sendState(true);
}

// Get up and step back out the way we came in.
function leaveSeat() {
  if (!me.seat) return;
  const mine = state.players.get(state.myId);
  mine.x = me.seat.entry.x;
  mine.y = me.seat.entry.y;
  mine.pose = 'stand';
  me.seat = null;
  sendState(true);
}

// ---------------------------------------------------------------------------
// Input: keyboard, tap/click to walk, tap characters
// ---------------------------------------------------------------------------

const keys = new Set();
addEventListener('keydown', (e) => {
  if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
    if (e.key === 'Escape') document.activeElement.blur();
    return;
  }
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
    keys.add(k);
    e.preventDefault();
  } else if (k === 'enter' && joined) {
    $('chatInput').focus();
    e.preventDefault();
  } else if (k === 'escape') {
    closeMenu();
    $('emoteTray').classList.add('hidden');
  }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => keys.clear());

let down = null;
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener('pointerup', (e) => {
  if (!down || !joined) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved > 20) return;
  $('emoteTray').classList.add('hidden');
  if (document.activeElement === $('chatInput')) $('chatInput').blur();
  if (!$('actionMenu').classList.contains('hidden')) {
    closeMenu();
    return;
  }
  const w = screenToWorld(e.clientX, e.clientY);
  const cat = pickCat(w.x, w.y);
  if (cat) {
    openCatMenu(cat, e.clientX, e.clientY);
    return;
  }
  const hit = pickPlayer(w.x, w.y);
  if (hit) {
    openMenu(hit.id, e.clientX, e.clientY);
    return;
  }
  const furniture = furnitureAt(w.x, w.y);
  if (furniture) {
    useFurniture(furniture);
    state.ripples.push({ x: w.x, y: w.y, t0: performance.now(), ok: true });
    return;
  }
  me.pending = null;
  stopFollowing();
  walkTo(w.x, w.y);
  state.ripples.push({ x: w.x, y: w.y, t0: performance.now(), ok: !!me.path });
});

function pickCat(wx, wy) {
  const pad = 6 / view.zoom;
  for (const c of [...state.cats.values()].sort((a, b) => b.y - a.y)) {
    if (Math.abs(wx - c.x) <= 22 + pad && wy >= c.y - CAT_H - pad && wy <= c.y + 5 + pad) return c;
  }
  return null;
}

function pickPlayer(wx, wy) {
  // Front-most (largest y) first; generous hit box for fingers.
  const list = [...state.players.values()].sort((a, b) => b.y - a.y);
  const pad = 8 / view.zoom;
  for (const p of list) {
    const half = charWidth(p.look) / 2;
    const left = p.x - half - pad;
    const right = p.x + half + pad;
    const top = p.y - CHAR_H - pad;
    const bottom = p.y + 6 + pad;
    if (wx >= left && wx <= right && wy >= top && wy <= bottom) return p;
  }
  return null;
}

function walkTo(x, y) {
  const mine = state.players.get(state.myId);
  if (!mine) return;
  leaveSeat();
  me.goingToSeat = null;
  me.path = findPath(mine.x, mine.y, x, y);
  if (me.path && mine.pose !== 'stand') {
    mine.pose = 'stand';
    me.danceUntil = 0;
  }
}

// HUD buttons
$('zoomIn').addEventListener('click', () => (state.zoomMul = Math.min(3, state.zoomMul * 1.25)));
$('zoomOut').addEventListener('click', () => (state.zoomMul = Math.max(0.4, state.zoomMul / 1.25)));
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    state.zoomMul = Math.min(3, Math.max(0.4, state.zoomMul * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
  },
  { passive: false }
);
$('menuClose').addEventListener('click', closeMenu);
$('inviteBtn').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${encodeURIComponent(state.room)}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Cozy Vibes', text: 'Come hang out in my house!', url });
    else {
      await navigator.clipboard.writeText(url);
      toast('Invite link copied! 📋');
    }
  } catch {
    prompt('Share this link with your friends:', url);
  }
});
$('chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('chatInput').value.trim();
  if (!text) return;
  send({ t: 'chat', text });
  $('chatInput').value = '';
  $('chatInput').blur();
});
$('emoteBtn').addEventListener('click', () => $('emoteTray').classList.toggle('hidden'));
for (const e of EMOTES) {
  const b = document.createElement('button');
  b.textContent = e;
  b.addEventListener('click', () => {
    emote(e);
    $('emoteTray').classList.add('hidden');
  });
  $('emoteTray').append(b);
}

// ---------------------------------------------------------------------------
// Toasts / status
// ---------------------------------------------------------------------------

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  $('toasts').append(el);
  setTimeout(() => el.remove(), 3300);
  while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
}
function showStatus(text) {
  $('status').textContent = text;
  $('status').classList.remove('hidden');
}
function hideStatus() {
  $('status').classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function updateMe(dt, now) {
  const mine = state.players.get(state.myId);
  if (!mine) return;

  let vx = 0, vy = 0;
  if (keys.has('arrowleft') || keys.has('a')) vx -= 1;
  if (keys.has('arrowright') || keys.has('d')) vx += 1;
  if (keys.has('arrowup') || keys.has('w')) vy -= 1;
  if (keys.has('arrowdown') || keys.has('s')) vy += 1;

  if (vx || vy) {
    leaveSeat();
    me.goingToSeat = null;
    me.path = null;
    me.pending = null;
    stopFollowing();
  }

  // Following someone: keep re-planning a path to just behind them.
  if (me.follow != null && now > me.repathAt) {
    const t = state.players.get(me.follow);
    me.repathAt = now + 400;
    if (!t) me.follow = null;
    else if (Math.hypot(t.x - mine.x, t.y - mine.y) > 50) me.path = findPath(mine.x, mine.y, t.x, t.y);
    else me.path = null;
  }
  // Walking over to do something: re-plan if they move.
  if (me.pending && now > me.repathAt) {
    const t = me.pending.cat ? state.cats.get(me.pending.target) : state.players.get(me.pending.target);
    me.repathAt = now + 400;
    if (!t) me.pending = null;
    else if (closeEnough(mine, t)) {
      if (me.pending.cat) send({ t: 'cat', id: t.id, action: me.pending.action });
      else send({ t: 'action', target: t.id, action: me.pending.action });
      me.pending = null;
      me.path = null;
    } else me.path = findPath(mine.x, mine.y, t.x, t.y);
  }

  if (!vx && !vy && me.path && me.path.length) {
    const wp = me.path[0];
    const dx = wp.x - mine.x, dy = wp.y - mine.y;
    const d = Math.hypot(dx, dy);
    const stopShort = me.follow != null || me.pending ? (me.path.length === 1 ? 30 : 0) : 0;
    if (d <= Math.max(2, stopShort)) {
      me.path.shift();
      if (stopShort && me.path.length === 0) me.path = null;
    } else {
      vx = dx / d;
      vy = dy / d;
    }
    if (me.path && me.path.length === 0) me.path = null;
  }

  const moving = !!(vx || vy);
  if (moving) {
    const len = Math.hypot(vx, vy);
    const step = Math.min(SPEED * dt, me.path && me.path[0] ? Math.hypot(me.path[0].x - mine.x, me.path[0].y - mine.y) : Infinity);
    const n = moveWithCollision(mine.x, mine.y, (vx / len) * step, (vy / len) * step);
    const actuallyMoved = Math.hypot(n.x - mine.x, n.y - mine.y) > 0.01;
    mine.x = n.x;
    mine.y = n.y;
    if (Math.abs(vx) > Math.abs(vy) * 1.1) mine.dir = vx > 0 ? 'right' : 'left';
    else mine.dir = vy > 0 ? 'down' : 'up';
    mine.moving = actuallyMoved;
    if (!actuallyMoved && me.path) me.path = null; // stuck: give up
    if (mine.pose !== 'stand') {
      mine.pose = 'stand';
      me.danceUntil = 0;
    }
  } else {
    mine.moving = false;
  }

  // Reached the way onto the furniture: get on.
  if (me.goingToSeat && !(me.path && me.path.length)) {
    const seat = me.goingToSeat;
    me.goingToSeat = null;
    if (Math.hypot(mine.x - seat.entry.x, mine.y - seat.entry.y) < 10 && !seatTaken(seat)) sitIn(seat);
  }

  if (mine.pose === 'dance' && me.danceUntil && now > me.danceUntil) {
    mine.pose = 'stand';
    me.danceUntil = 0;
  }
  sendState(false);
}

function updateOthers(dt) {
  const k = 1 - Math.exp(-dt * 12);
  for (const c of state.cats.values()) {
    if (Math.hypot(c.tx - c.x, c.ty - c.y) > 150) {
      c.x = c.tx;
      c.y = c.ty;
    } else {
      c.x += (c.tx - c.x) * k;
      c.y += (c.ty - c.y) * k;
    }
  }
  for (const p of state.players.values()) {
    if (p.id === state.myId) continue;
    const d = Math.hypot(p.tx - p.x, p.ty - p.y);
    if (d > 200) {
      p.x = p.tx;
      p.y = p.ty;
    } else {
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const view = { zoom: 1, camX: MAP_W / 2, camY: MAP_H / 2, w: 0, h: 0, dpr: 1 };

function resize() {
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.w = innerWidth;
  view.h = innerHeight;
  canvas.width = Math.round(view.w * view.dpr);
  canvas.height = Math.round(view.h * view.dpr);
}
addEventListener('resize', resize);
resize();

function baseZoom() {
  // Fit the whole house on big screens; on phones, zoom in so characters stay readable.
  const fit = Math.min(view.w / 1240, view.h / 780);
  const small = Math.min(view.w, view.h);
  return small < 600 ? Math.max(fit, small / 520) : fit;
}

function updateCamera(dt) {
  view.zoom = baseZoom() * state.zoomMul;
  const mine = state.players.get(state.myId);
  const target = mine ? { x: mine.x, y: mine.y - 20 } : { x: MAP_W / 2, y: MAP_H / 2 - 60 };
  const halfW = view.w / 2 / view.zoom;
  const halfH = view.h / 2 / view.zoom;
  // Keep the camera on the house; centre it when the view is larger than the house.
  const minX = 160 + halfW, maxX = 1400 - halfW;
  const minY = 10 + halfH, maxY = 900 - halfH;
  const tx = minX > maxX ? (160 + 1400) / 2 : Math.min(maxX, Math.max(minX, target.x));
  const ty = minY > maxY ? (10 + 900) / 2 : Math.min(maxY, Math.max(minY, target.y));
  const k = 1 - Math.exp(-dt * 6);
  view.camX += (tx - view.camX) * k;
  view.camY += (ty - view.camY) * k;
}

function screenToWorld(sx, sy) {
  return { x: (sx - view.w / 2) / view.zoom + view.camX, y: (sy - view.h / 2) / view.zoom + view.camY };
}
function worldToScreen(wx, wy) {
  return { x: (wx - view.camX) * view.zoom + view.w / 2, y: (wy - view.camY) * view.zoom + view.h / 2 };
}

function render(now) {
  const { dpr, zoom } = view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#3d6e2f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * (view.w / 2 - view.camX * zoom), dpr * (view.h / 2 - view.camY * zoom));
  ctx.imageSmoothingEnabled = false;
  if (houseImg.complete) ctx.drawImage(houseImg, 0, 0);

  // Tap markers
  state.ripples = state.ripples.filter((r) => now - r.t0 < 600);
  for (const r of state.ripples) {
    const t = (now - r.t0) / 600;
    ctx.strokeStyle = r.ok ? `rgba(255,240,200,${1 - t})` : `rgba(220,80,60,${1 - t})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(r.x, r.y, 6 + t * 12, (6 + t * 12) * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  const list = [...state.players.values()].sort((a, b) => a.y - b.y);
  const scene = [...list, ...state.cats.values()].sort((a, b) => a.y - b.y);
  for (const e of scene) {
    if (e.cat) {
      if (e.anim !== 'jump') {
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath();
        ctx.ellipse(e.x, e.y, 14, 4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      drawCat(ctx, e.id, e.x, e.y, e.flip, e.anim, now - e.started, now);
    } else drawPlayer(e, now);
  }

  // Screen-space overlay: names, bubbles, effects (crisp text at any zoom)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const p of list) drawLabels(p, now);
  drawEffects(now);
}

function drawPlayer(p, now) {
  const mine = p.id === state.myId;
  const moving = p.moving && p.pose === 'stand';

  let sx = p.x;
  if (now < p.shakeUntil) sx += Math.sin(now / 25) * 2;

  // Shadow
  if (p.pose !== 'bed') {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.pose === 'sleep' ? 30 : 13, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (mine && p.pose !== 'bed') {
    ctx.strokeStyle = 'rgba(255, 230, 150, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, p.pose === 'sleep' ? 34 : 17, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawCharacter(ctx, p.look, sx, p.y, p.dir, moving, p.pose, now, p.animT);
}

function drawLabels(p, now) {
  const mine = p.id === state.myId;
  const head = worldToScreen(p.x, p.y - (p.pose === 'sleep' ? 30 : p.pose === 'sit' ? CHAR_H * 0.84 : CHAR_H) - 2);
  const fs = Math.max(11, Math.min(14, 12 * view.zoom));
  ctx.font = `700 ${fs}px ui-rounded, Nunito, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  const label = p.name + (me.follow === p.id ? ' 👣' : '');
  const w = ctx.measureText(label).width + 10;
  ctx.fillStyle = mine ? 'rgba(227,163,59,0.92)' : 'rgba(42,26,18,0.72)';
  roundRect(head.x - w / 2, head.y - fs - 6, w, fs + 5, 6);
  ctx.fill();
  ctx.fillStyle = mine ? '#2a1a12' : '#fbf1dc';
  ctx.fillText(label, head.x, head.y - 2);

  if (p.pose === 'sleep' || p.pose === 'bed') {
    const t = (now / 1000) % 2;
    ctx.font = `${fs + 2}px sans-serif`;
    ctx.globalAlpha = 1 - t / 2;
    ctx.fillText('💤', head.x + 18, head.y - fs - 8 - t * 8);
    ctx.globalAlpha = 1;
  }

  if (p.bubble) {
    if (now > p.bubble.until) p.bubble = null;
    else drawBubble(p.bubble.text, head.x, head.y - fs - 12);
  }
}

function drawBubble(text, x, y) {
  ctx.font = `600 14px ui-rounded, Nunito, system-ui, sans-serif`;
  const lines = wrap(text, 180);
  const lh = 18;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 18;
  const h = lines.length * lh + 10;
  const bx = Math.min(Math.max(4, x - w / 2), view.w - w - 4);
  const by = y - h - 6;
  ctx.fillStyle = '#fffaf0';
  ctx.strokeStyle = '#3b2416';
  ctx.lineWidth = 2;
  roundRect(bx, by, w, h, 10);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 6, by + h - 1);
  ctx.lineTo(x, by + h + 7);
  ctx.lineTo(x + 6, by + h - 1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2a1a12';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + w / 2, by + 5 + i * lh));
}

function wrap(text, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const word of words) {
    const test = cur ? cur + ' ' + word : word;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = word;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4);
}

function drawEffects(now) {
  const DUR = 1600;
  state.effects = state.effects.filter((e) => now - e.t0 < DUR && entity(e.playerId));
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const e of state.effects) {
    const t = (now - e.t0) / DUR;
    const p = entity(e.playerId);
    let wx = p.x, wy = p.y - (p.cat ? CAT_H + 6 : CHAR_H + 10);
    const other = state.players.get(e.flyTo ?? e.midTo);
    if (other && e.flyTo != null) {
      wx = p.x + (other.x - p.x) * t;
      wy = p.y - 30 + (other.y - p.y) * t - Math.sin(t * Math.PI) * 40;
    } else if (other) {
      wx = (p.x + other.x) / 2;
      wy = (p.y + other.y) / 2 - 40;
    }
    const s = worldToScreen(wx, wy);
    const rise = e.flyTo != null ? 0 : t * 28;
    const size = 22 + Math.sin(Math.min(1, t * 4) * Math.PI) * 6;
    ctx.globalAlpha = t > 0.75 ? (1 - t) * 4 : 1;
    ctx.font = `${size}px sans-serif`;
    ctx.fillText(e.emoji, s.x, s.y - rise);
  }
  ctx.globalAlpha = 1;
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (joined) {
    updateMe(dt, now);
    updateOthers(dt);
  }
  updateCamera(dt);
  render(now);
  requestAnimationFrame(loop);
}

// Debug hook for automated tests.
window.__cozy = { state, me, walkTo, view };

Promise.all([loadCharacters(), loadCats()]).then(() => {
  profile.look = ((profile.look % LOOKS.length) + LOOKS.length) % LOOKS.length;
  initJoin();
  requestAnimationFrame(loop);
});
