// Renders packages/extension/icon.svg into the PNG sizes Chrome needs.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ext = join(dirname(fileURLToPath(import.meta.url)), '../packages/extension');
const svg = readFileSync(join(ext, 'icon.svg'), 'utf8');
for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(join(ext, 'public/icons', `icon-${size}.png`), png);
  console.log(`icon-${size}.png`);
}
