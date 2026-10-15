// Builds a single self-contained HTML file of the game that runs with no server:
// images are embedded, and the multiplayer Room runs in the page with two bot
// housemates (see tools/preview/shim.js).
//
//   node tools/build_preview.mjs [output.html]     (default: dist/preview.html)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const out = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'preview.html'));

const dataUri = (file, type) => `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;

// Generated module with the embedded images.
const meta = {};
for (const id of ['boy', 'girl', 'glasses']) {
  const m = JSON.parse(fs.readFileSync(path.join(PUB, 'assets/characters', `${id}.json`), 'utf8'));
  m.image = dataUri(path.join(PUB, 'assets/characters', `${id}.png`), 'image/png');
  meta[`characters/${id}`] = m;
}
for (const id of ['tabby', 'black']) {
  const m = JSON.parse(fs.readFileSync(path.join(PUB, 'assets/cats', `${id}.json`), 'utf8'));
  m.image = dataUri(path.join(PUB, 'assets/cats', `${id}.png`), 'image/png');
  meta[`cats/${id}`] = m;
}
const gen = path.join(ROOT, 'tools/preview/assets.gen.js');
fs.writeFileSync(
  gen,
  `export const HOUSE_SRC = ${JSON.stringify(dataUri(path.join(PUB, 'assets/house.png'), 'image/png'))};\n` +
    `export const CHARACTER_META = ${JSON.stringify(meta)};\n`
);

try {
  const result = await build({
    stdin: {
      contents: `import './tools/preview/shim.js';\nimport './public/js/game.js';\n`,
      resolveDir: ROOT,
      sourcefile: 'preview-entry.js',
    },
    bundle: true,
    format: 'iife',
    minify: true,
    write: false,
    target: 'es2020',
  });
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');

  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(PUB, 'style.css'), 'utf8');
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<link rel="stylesheet"[^>]*>/, '');
  let body = html.match(/<body>([\s\S]*?)<\/body>/)[1].replace(/<script[^>]*src="js\/game\.js"[^>]*><\/script>/, '');
  // In the preview everyone's in the same pretend house, so drop the house code field.
  body = body
    .replace(/<label>House code[\s\S]*?<\/label>\s*<p class="hint">[\s\S]*?<\/p>/, '<p class="hint">Preview mode: you share the house with two bots, Mochi and Bao. Once it\'s hosted, real friends can join with a house code.</p>');

  const page = `${head.trim()}
  <meta name="claude:viewport-fit-sides" content="cover" />
  <style>
${css}
#roomInput, #inviteBtn { display: none !important; }
  </style>
${body.trim()}
  <input id="roomInput" type="hidden" value="preview" />
  <script>${js}</script>
`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, page);
  console.log(`wrote ${path.relative(process.cwd(), out)} (${(page.length / 1e6).toFixed(1)} MB)`);
} finally {
  fs.rmSync(gen, { force: true });
}
