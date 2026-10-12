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
  .replace('<div><strong>桌面通知</strong>', '<div><strong>系统通知</strong>')
  .replace('提醒需要保持网页打开；浏览器关闭后无法发送定时通知。计时、设置和打卡记录仅保存在本设备。清除浏览器数据会删除记录。', '允许系统通知后，退到后台时仍可收到计时和每日开始提醒；省电设置可能影响准点。计时、设置和打卡记录仅保存在本设备。卸载或清除应用数据会删除记录。')
  .replace('<script src="/app.js" defer></script>', '<script src="/native.js" defer></script><script src="/app.js" defer></script>');
await writeFile(join(out, 'index.html'), html);
for (const file of ['app.js', 'style.css', 'favicon.svg', 'icon-192.png', 'icon-512.png']) {
  await copyFile(join(source, file), join(out, file));
}
await build({ entryPoints: [join(base, 'native.mjs')], bundle: true, format: 'iife', platform: 'browser', outfile: join(out, 'native.js') });
