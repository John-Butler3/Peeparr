import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const FPS = 20;
mkdirSync('/ad/out', { recursive: true });
const b = await puppeteer.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files'] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 720 });
await p.goto('file:///ad/ad.html');
await p.waitForFunction('window.ready === true');
const only = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
const SECONDS = await p.evaluate(() => window.TOTAL);
const frames = only ?? Array.from({ length: Math.round(FPS * SECONDS) }, (_, i) => i / FPS);
for (let i = 0; i < frames.length; i++) {
  const t = frames[i];
  await p.evaluate((tt) => window.render(tt), t);
  await p.screenshot({ path: '/ad/out/' + (only ? 't' + t : String(i).padStart(4, '0')) + '.jpg', type: 'jpeg', quality: 92 });
}
await b.close();
