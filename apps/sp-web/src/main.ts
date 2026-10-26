import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

/**
 * The app's stylesheet, preloaded rather than render-blocking (see
 * scripts/defer-styles.mjs) so the loading logo paints at once: applied
 * here, and the app starts once it has loaded. (Without the build step,
 * e.g. `ng serve`, it's an ordinary stylesheet already.)
 */
function applyStyles(): Promise<void> {
  const preload = document.getElementById('app-styles') as HTMLLinkElement | null;
  if (!preload) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = preload.href;
    sheet.onload = () => resolve();
    sheet.onerror = () => resolve();
    preload.after(sheet);
  });
}

applyStyles()
  .then(() => bootstrapApplication(App, appConfig))
  .catch((err) => console.error(err));
