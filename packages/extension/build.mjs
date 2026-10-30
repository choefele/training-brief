// Bundles the extension into dist/: one script per page, static files copied, fonts bundled locally.
import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');
// --preview writes a copy that runs in a normal browser tab, with chrome.* stubbed and sample data. For UI work only.
const preview = process.argv.includes('--preview');
const out = preview ? join(root, 'dist-preview') : dist;
const require = createRequire(import.meta.url);

const FONTS = [
  ['@fontsource/barlow-condensed', ['barlow-condensed-latin-500-normal', 'barlow-condensed-latin-600-normal', 'barlow-condensed-latin-700-normal']],
  ['@fontsource/source-sans-3', ['source-sans-3-latin-400-normal', 'source-sans-3-latin-500-normal', 'source-sans-3-latin-600-normal', 'source-sans-3-latin-700-normal']],
  ['@fontsource/ibm-plex-mono', ['ibm-plex-mono-latin-400-normal', 'ibm-plex-mono-latin-500-normal']],
];

async function copyStatic() {
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(src, 'manifest.json'), 'utf8'));
  manifest.version = pkg.version;
  await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const page of ['sidepanel', 'dashboard', 'options']) {
    await cp(join(src, page, `${page}.html`), join(out, `${page}.html`));
    await cp(join(src, page, `${page}.css`), join(out, `${page}.css`));
  }
  await cp(join(src, 'styles', 'base.css'), join(out, 'base.css'));
  await cp(join(src, 'styles', 'fonts.css'), join(out, 'fonts.css'));
  await cp(join(root, 'public'), out, { recursive: true });
  if (preview) {
    await cp(join(root, 'dev', 'chrome-shim.js'), join(out, 'chrome-shim.js'));
    for (const page of ['sidepanel', 'dashboard', 'options']) {
      const file = join(out, `${page}.html`);
      await writeFile(file, (await readFile(file, 'utf8')).replace('<script type="module"', '<script src="chrome-shim.js"></script><script type="module"'));
    }
  }
  await mkdir(join(out, 'fonts'), { recursive: true });
  for (const [pkgName, files] of FONTS) {
    const dir = join(dirname(require.resolve(`${pkgName}/package.json`)), 'files');
    for (const f of files) await cp(join(dir, `${f}.woff2`), join(out, 'fonts', `${f}.woff2`));
  }
}

const options = {
  entryPoints: {
    background: join(src, 'background.ts'),
    sidepanel: join(src, 'sidepanel', 'sidepanel.ts'),
    dashboard: join(src, 'dashboard', 'dashboard.ts'),
    options: join(src, 'options', 'options.ts'),
  },
  outdir: out,
  bundle: true,
  format: 'esm',
  splitting: false,
  target: 'chrome116',
  legalComments: 'none',
  logLevel: 'info',
  plugins: [{ name: 'static', setup: b => b.onEnd(async r => { if (!r.errors.length) await copyStatic(); }) }],
};

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
