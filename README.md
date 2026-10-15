# Cozy Vibes 🏡

A little multiplayer house you hang out in with friends, straight from the browser,
on phones and laptops alike.

## Playing

- **Move:** tap or click anywhere on the floor and your character walks there, finding
  its own way through the doors. On a keyboard you can also use WASD or the arrow keys.
- **Interact:** tap any character to open their action menu: wave, high five, hug,
  send love, poke, dance together, follow, or walk over. Hugs, high fives, pokes and
  dances walk you over to the other person first.
- **Yourself:** tap your own character to sit, nap, dance, emote or change your look.
- **Chat:** type in the box at the bottom (or press Enter on a keyboard). Messages
  show up as speech bubbles.
- **Friends:** everyone who uses the same *house code* ends up in the same house.
  Press **Invite** to share the link.

The walls are solid. The living room and hallway are one open space, there's one door
into the bedroom and one into the office, and the front door stays shut.

## Running it locally

```bash
npm install
npm start          # http://localhost:3000
npm run check      # syntax check + wall/door collision tests
```

To try it on your phone while running it on your computer, open
`http://<your-computer's-local-IP>:3000` with the phone on the same Wi-Fi.

## Putting it online

Since it's multiplayer, it needs a small Node server (static hosting like GitHub Pages
won't work). Any host that runs Node and supports WebSockets will do. The easiest:

**Render (free tier):** New → Blueprint → pick this repo. It reads `render.yaml`.
Railway, Fly.io and Glitch also work; the start command is `npm start` and the server
listens on `$PORT`.

## How it's put together

| File | What it does |
| --- | --- |
| `server.js` | Serves the game and relays players between everyone in a house over WebSockets. It also rejects positions inside walls. |
| `public/js/map.js` | The floor plan: walkable areas, doors, blockers, collision and pathfinding. The server and browser share it. |
| `public/js/characters.js` | Loads the character sprite sheets and draws the walk, sit, nap and dance animations. |
| `public/js/game.js` | Rendering, controls, camera, action menu, chat, emotes. |
| `public/assets/house.png` | The house map. |

### Changing walls and doors

Coordinates are in pixels of `house.png` (1536×1024). Edit `AREAS` in `map.js` to change
where people can stand, or add to `BLOCKERS` for solid furniture. Then run
`npm run check`.

### Characters

The boy and girl come from `art/characters-sheet.png`.
`tools/extract_sprites.py` cuts the frames out, removes the gray background and
shadow, and lines every frame up on the character's feet. It writes
`public/assets/characters/<id>.png` (one row per direction, one column per frame) plus
a `.json` file with the frame size. If you edit the sheet, re-run it:

```bash
pip install pillow numpy
python3 tools/extract_sprites.py
```

To add another character, add its frames to the sheet (or a new one), add an entry to
`CHARACTERS` in the script, and add its id to `IDS` in `public/js/characters.js`.
Frame 0 is the standing pose and the rest is the walk cycle. Sitting, napping and
dancing are made from those same frames.
