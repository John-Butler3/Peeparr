// Puts the two recordings side by side, a step at a time with its caption,
// between a title card and an end card, and renders it frame by frame.
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const FPS = 30;
const REC = process.env.REC ?? '/work/rec';
const OUT = process.env.FRAMES ?? '/work/frames';
const INTRO = 3.4, OUTRO = 4.6;
const STEPS = [
  ['signin', 'Sign in', 'Your own Peeparr, on any screen.'],
  ['home', 'Home', 'Pick up where you left off, see what’s new, preview as you browse.'],
  ['search', 'Search', 'Scenes, performers and sites as you type.'],
  ['request', 'Request', 'One tap sends it to Whisparr.'],
  ['download', 'Follow the download', 'Requested, downloading, importing — every stage in view.'],
  ['library', 'In your library', 'Stash picks it up, and it’s ready to watch.'],
  ['preview', 'Preview', 'The site’s logo, then a preview, before you press play.'],
  ['watch', 'Watch', 'Plays right there, with chapters and quality options.'],
  ['keep', 'Keep watching', 'It carries on in the miniplayer, and Continue Watching keeps your place.'],
  ['explore', 'Explore', 'Performers, sites and more from the people you like.'],
];
const dev = {};
for (const name of ['desktop', 'phone']) {
  const tl = JSON.parse(fs.readFileSync(`${REC}/${name}/timeline.json`));
  const t0 = tl.steps[0].t;
  const at = Object.fromEntries(tl.steps.map((s) => [s.id, s.t - t0]));
  const s = STEPS.map(([id]) => at[id]);
  const d = STEPS.map(([id], i) => (i < STEPS.length - 1 ? at[STEPS[i + 1][0]] : at.end) - at[id]);
  dev[name] = { dir: `file://${REC}/${name}/`, frames: tl.frames.map((f) => [+(f.t - t0).toFixed(3), f.file]), taps: tl.taps.map((p) => ({ x: p.x, y: p.y, t: p.t - t0 })), s, d };
}
// Each step as long as the slower device needs, but no more than 1.5x the quicker
// one (the slower is then sped up), between 3.6 and 9 seconds.
let g = INTRO;
const steps = STEPS.map(([id, title, text], i) => {
  const a = dev.desktop.d[i], b = dev.phone.d[i];
  const len = Math.min(9, Math.max(3.6, Math.min(Math.max(a, b), 1.5 * Math.min(a, b))));
  const step = { id, title, text, g0: g, g1: g + len };
  g += len;
  return step;
});
const TOTAL = g + OUTRO;
const logoSvg = fs.readFileSync(process.env.LOGO ?? '/work/logo.svg', 'utf8');
const html = fs.readFileSync(new URL('./compose.html', import.meta.url), 'utf8').replace('<script>', `<script>window.DATA=${JSON.stringify({ steps, dev, logoSvg })};</script><script>`);
fs.writeFileSync('/work/compose.built.html', html);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium-browser', args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
await page.goto('file:///work/compose.built.html');
await page.waitForFunction('window.ready === true');
const only = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
const times = only ?? Array.from({ length: Math.round(TOTAL * FPS) }, (_, i) => i / FPS);
for (let i = 0; i < times.length; i++) {
  await page.evaluate((t) => window.render(t), times[i]);
  await page.screenshot({ path: `${OUT}/${only ? 't' + times[i] : String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 90 });
  if (i % 300 === 0) console.log('frame', i, '/', times.length);
}
await browser.close();
console.log('total', TOTAL.toFixed(1), 's', steps.map((s) => `${s.id}:${(s.g1 - s.g0).toFixed(1)}`).join(' '));
