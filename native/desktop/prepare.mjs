import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = dirname(fileURLToPath(import.meta.url));
const source = join(base, '..', '..');
const out = join(base, 'renderer');
const apiUrl = process.env.ZHIJIAN_API_URL || '';
if (apiUrl && new URL(apiUrl).protocol !== 'https:') throw new Error('Production API URL must use HTTPS');
const connectOrigin = apiUrl ? new URL(apiUrl).origin : "'none'";
await mkdir(out, { recursive: true });

let html = await readFile(join(source, 'index.html'), 'utf8');
html = html
  .replace('<link rel="manifest" href="/manifest.webmanifest">', '')
  .replace('<script src="/pwa.js" defer></script>', '')
  .replace('</head>', `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src ${connectOrigin}; object-src 'none'; base-uri 'none'"></head>`);
await writeFile(join(out, 'index.html'), html);
await writeFile(join(out, 'cloud-config.js'), `window.ZHIJIAN_API_URL = ${JSON.stringify(apiUrl)};\n`);
for (const file of ['app.js', 'cloud.js', 'style.css', 'favicon.svg', 'icon-192.png', 'icon-512.png']) {
  await copyFile(join(source, file), join(out, file));
}
