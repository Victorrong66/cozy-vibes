# Cozy Vibes 🏡

A little multiplayer house you hang out in with friends, straight from the browser,
on phones and laptops alike.

## Playing

- **Move:** on a phone or tablet, use the joystick at the bottom of the screen (push it
  further to walk faster). On a laptop, click the floor and your character walks there,
  finding its own way through the doors, or use WASD / the arrow keys.
- **Look around:** drag the map with your finger (or the mouse). Walking again, or
  tapping **📍 Me**, brings the camera back to you.
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
- **Housemates:** tap **🙋 Add** to invite a computer-controlled housemate: an
  animator (works at the desk), chef (dining table), gamer (couch), sleepy roommate
  (bed), plant lover (waters the plants) or bookworm (bookshelves and couch). Pick
  how they look and, if you like, their name. They do their own thing, react when you
  wave, hug or poke them, and sometimes join in when you chat. Tap one and choose
  **Send home** to remove them. Up to 6 per house. Everyone sees the same ones, and
  they're remembered with the house and in saves.
- **Coming back:** each house remembers where everyone was, including who was in
  bed or on the couch, plus the cats. Come back with the same house code on the same
  phone or laptop and you're right where you left off.
- **Saves:** tap 💾 to name a save (like "Movie night"), and load it any time to put
  everyone and the cats back where they were. People who aren't there when it's loaded
  go back to their spot the next time they come over. Each house keeps up to 10 saves.
- **Yourself:** tap your own character to sit, nap, dance, emote or change your look.
- **Chat:** tap 💬 (or press Enter on a keyboard) and type. Messages show up as speech
  bubbles.
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
| `src/npcs.js` | Housemates: each role's routine, lines and reactions. Role names and descriptions are in `public/js/roles.js`. |

Where houses are stored: on Cloudflare, in each house's Durable Object storage. With
`npm start`, in `data/<house code>.json` (set `DATA_DIR` to put them elsewhere). In the
offline preview, in the browser.
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

### Marking no-walk areas on a picture

Paint red over a copy of `public/assets/house.png` wherever characters shouldn't stand, save
it as `art/no-walk-marks.jpg`, and run `python3 tools/marks_to_blockers.py`. It prints a
rectangle for each marked area to paste into `BLOCKERS` in `public/js/map.js`, and writes
`art/no-walk-check.png` so you can see them over the map.

### Characters

The boy comes from `art/characters-sheet.png` (`tools/extract_sprites.py`). The girl and the
girl with glasses come from `art/girl-sheet.png` and `art/glasses-sheet.png`
(`tools/extract_people.py`). Their sheets also have play, attack, jump and sleep
animations: they play with yarn when sitting on the floor, curl up to nap, jump when
dancing or high-fiving, and swing when poking. The scripts remove the
background and line every frame up on the feet, writing `public/assets/characters/<id>.png`
plus a `.json` with the frame layout. If you edit a sheet, re-run its script:

```bash
pip install pillow numpy
python3 tools/extract_sprites.py   # boy
python3 tools/extract_people.py     # girl and girl with glasses
```

The cats come from `art/cats-sheet.png` the same way: `python3 tools/extract_cats.py`
writes `public/assets/cats/`. Their behaviour lives in `src/cats.js` and runs on the
server, so everyone sees the same cats.

To add another character, add its frames to the sheet (or a new one), add an entry to
`CHARACTERS` in the script, and add its id to `IDS` in `public/js/characters.js`.
Frame 0 is the standing pose and the rest is the walk cycle. Sitting, napping and
dancing are made from those same frames.
