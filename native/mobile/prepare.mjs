import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const base = dirname(fileURLToPath(import.meta.url));
const source = join(base, '..', '..');
const out = join(base, 'www');
await mkdir(out, { recursive: true });

let html = await readFile(join(source, 'index.html'), 'utf8');
html = html
  .replace('<link rel="manifest" href="/manifest.webmanifest">', '')
  .replace('<script src="/pwa.js" defer></script>', '')
  .replace('<script src="/app.js" defer></script>', '<script src="/native.js" defer></script><script src="/app.js" defer></script>');
await writeFile(join(out, 'index.html'), html);
for (const file of ['app.js', 'style.css', 'favicon.svg', 'icon-192.png', 'icon-512.png']) {
  await copyFile(join(source, file), join(out, file));
}
await build({ entryPoints: [join(base, 'native.mjs')], bundle: true, format: 'iife', platform: 'browser', outfile: join(out, 'native.js') });
