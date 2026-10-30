// Renders the Chrome Web Store screenshots and promo tiles from store/templates into store/.
// Builds the preview (sample data, chrome.* stubbed), serves it with the templates and screenshots each one in headless Chrome.
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const preview = join(root, 'packages/extension/dist-preview');
const templates = join(root, 'store/templates');
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const ASSETS = [
  ['1-sidepanel.html', 'screenshot-1-sidepanel.png', 1280, 800],
  ['2-dashboard.html', 'screenshot-2-dashboard.png', 1280, 800],
  ['3-export.html', 'screenshot-3-export.png', 1280, 800],
  ['4-activities.html', 'screenshot-4-activities.png', 1280, 800],
  ['5-privacy.html', 'screenshot-5-privacy.png', 1280, 800],
  ['promo-small.html', 'promo-small-440x280.png', 440, 280],
  ['marquee.html', 'promo-marquee-1400x560.png', 1400, 560],
];
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };

execFileSync('node', ['build.mjs', '--preview'], { cwd: join(root, 'packages/extension'), stdio: 'inherit' });

// /store/* comes from the templates, everything else from the preview build.
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = path.startsWith('/store/') ? join(templates, path.slice('/store/'.length)) : join(preview, path);
  try {
    const body = readFileSync(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();

const profile = mkdtempSync(join(tmpdir(), 'training-brief-store-'));
try {
  for (const [template, out, width, height] of ASSETS) {
    // A fresh profile per shot, so the stubbed storage always starts on sample data.
    rmSync(profile, { recursive: true, force: true });
    // Async, so this process's server can answer Chrome while it renders.
    await promisify(execFile)(chrome, [
      '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', '--no-first-run',
      '--blink-settings=preferredColorScheme=1', `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
      '--virtual-time-budget=6000', `--screenshot=${join(root, 'store', out)}`, `http://127.0.0.1:${port}/store/${template}`,
    ]);
    console.log(out);
  }
} finally {
  server.close();
  rmSync(profile, { recursive: true, force: true });
}

