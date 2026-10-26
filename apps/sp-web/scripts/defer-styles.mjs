// After `ng build`: the app's stylesheet no longer holds up the first paint,
// so the loading logo in index.html shows straight away instead of a black
// screen. The <link rel="stylesheet"> becomes a preload (fetched just as
// early, but not render-blocking); main.ts applies it and waits for it
// before starting the app.
import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../dist/sp-web/browser/index.html', import.meta.url);
const html = readFileSync(file, 'utf8');
const pattern = /<link rel="stylesheet" href="(styles-[^"]+\.css)"[^>]*>/;
if (!pattern.test(html)) {
  throw new Error('defer-styles: no app stylesheet link in index.html');
}
writeFileSync(
  file,
  html.replace(pattern, '<link rel="preload" as="style" href="$1" id="app-styles">'),
);
console.log('defer-styles: app stylesheet preloaded, applied by main.ts');
