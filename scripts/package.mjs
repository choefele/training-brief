// Zips packages/extension/dist for upload to the Chrome Web Store.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'packages/extension/package.json'), 'utf8'));
const zip = join(root, `training-brief-${version}.zip`);
execFileSync('zip', ['-r', '-X', '-q', zip, '.', '-x', '.DS_Store'], { cwd: join(root, 'packages/extension/dist'), stdio: 'inherit' });
console.log(`Wrote ${zip}`);
