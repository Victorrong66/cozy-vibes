# Cozy Vibes 🏡

A little multiplayer house you hang out in with friends, straight from the browser,
on phones and laptops alike.

## Playing

- **Move:** tap or click anywhere on the floor and your character walks there, finding
  its own way through the doors. On a keyboard you can also use WASD or the arrow keys.
- **Interact:** tap any character to open their action menu: wave, high five, hug,
  send love, poke, dance together, follow, or walk over. Hugs, high fives, pokes and
  dances walk you over to the other person first.
- **Furniture:** tap the bed, couch or desk to use it. You get into bed from either side
  where the green blanket meets the white sheet, onto the couch only from the coffee
  table side, and into the desk chair from the front. Move again to get up. The bed,
  couch, desk, TV, coffee table and dining table are solid otherwise.
- **Cats:** Biscuit (the tabby) and Pepper (the black cat) roam the house on their own.
  They wander, nap on the bed, cushion, beanbag or hallway rug, play with yarn and come
  hang out by people. Everyone in a house sees the same cats. Tap one to pet it, play
  with it, tease it (it swats and runs off) or call it over.
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
npm start          # plain Node server: http://localhost:3000
npm run dev        # or the Cloudflare version locally: http://localhost:8787
npm run check      # syntax check + wall/door collision tests
```

To try it on your phone while running it on your computer, open
`http://<your-computer's-local-IP>:3000` with the phone on the same Wi-Fi.

### Offline preview

`node tools/build_preview.mjs` builds `dist/preview.html`, a single file you can open
anywhere with no server. Everything's embedded, and two bot housemates (Mochi and Bao)
keep you company in place of real players.

## Hosting on Cloudflare

It's multiplayer, so it runs as a **Cloudflare Worker** with a **Durable Object** per
house (that's what keeps everyone in a house connected), plus the game files as static
assets. Plain Cloudflare *Pages* won't work, because it can't hold the live connections.
Everything fits in Cloudflare's free plan.

**Option A: connect the GitHub repo (deploys on every push)**
1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Import a repository**.
2. Pick this repo. Use `npm install` as the build command and `npx wrangler deploy` as
   the deploy command. Everything else comes from `wrangler.jsonc`.
3. You'll get a `cozy-vibes.<you>.workers.dev` link. To use your own domain, go to the
   Worker → **Settings** → **Domains & Routes**.

**Option B: from your computer**
```bash
npx wrangler login
npm run deploy
```

## How it's put together

| File | What it does |
| --- | --- |
| `src/room.js` | The multiplayer server logic for one house: joining, movement, actions, chat. It rejects positions inside walls. |
| `src/cats.js` | The two house cats: what they decide to do and how they react to people. |
| `worker/index.js` | Cloudflare entry point: one Durable Object per house code, each running a `Room`. |
| `server.js` | The same `Room` on plain Node, for running locally or on any Node host. |
| `public/js/map.js` | The floor plan: walkable areas, doors, blockers, collision and pathfinding. The server and browser share it. |
| `public/js/characters.js` | Loads the character sprite sheets and draws the walk, sit, nap and dance animations. |
| `public/js/game.js` | Rendering, controls, camera, action menu, chat, emotes. |
| `public/assets/house.png` | The house map. |

### Changing walls and doors

Coordinates are in pixels of `house.png` (1536×1024). Edit `AREAS` in `map.js` to change
where people can stand, add to `BLOCKERS` for solid furniture, or add to `FURNITURE` for things you can sit or lie on (each seat has an entry point that decides which side you get on from). Then run
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

The cats come from `art/cats-sheet.png` the same way: `python3 tools/extract_cats.py`
writes `public/assets/cats/`. Their behaviour lives in `src/cats.js` and runs on the
server, so everyone sees the same cats.

To add another character, add its frames to the sheet (or a new one), add an entry to
`CHARACTERS` in the script, and add its id to `IDS` in `public/js/characters.js`.
Frame 0 is the standing pose and the rest is the walk cycle. Sitting, napping and
dancing are made from those same frames.
