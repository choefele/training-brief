// Renders packages/extension/icon.svg into the PNG sizes Chrome needs, plus the padded Chrome Web Store icon.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(root, 'packages/extension');
const svg = readFileSync(join(ext, 'icon.svg'), 'utf8');
for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(join(ext, 'public/icons', `icon-${size}.png`), png);
  console.log(`icon-${size}.png`);
}

// The store wants 96×96 artwork with 16 px of transparent space around it. The tile spans 4–124 in icon.svg,
// so scale it by 96/120 and shift it so it starts at 16.
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const padded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><g transform="translate(12.8 12.8) scale(0.8)">${inner}</g></svg>`;
writeFileSync(join(root, 'store/icon-128.png'), new Resvg(padded, { fitTo: { mode: 'width', value: 128 } }).render().asPng());
console.log('store/icon-128.png');
