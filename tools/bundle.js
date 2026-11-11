'use strict';
// Packs the game into one self-contained HTML file (easy to upload, email, or open offline).
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(rootDir, rel), 'utf8');

const html = read('index.html')
  .replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, rel) => `<style>\n${read(rel)}</style>`)
  .replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, rel) => `<script>\n${read(rel)}</script>`);

const out = path.join(rootDir, 'twin-snap-single.html');
fs.writeFileSync(out, html);
process.stdout.write(`wrote ${out} (${Math.round(html.length / 1024)} KB)\n`);
