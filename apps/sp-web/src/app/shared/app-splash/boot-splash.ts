// The splash in index.html: on screen from the first paint, and reused for
// the reveal after signing in. Exactly one owner deals with it at a time:
// the app shell plays the reveal on it; otherwise (sign-in and other pages
// with their own intro) the root app fades it away. Afterwards it's hidden
// and left in the page, ready to be used again.

/** The app shell takes the splash over to reveal the page with it. */
export function takeBootSplash(): HTMLElement | null {
  const splash = document.getElementById('boot-splash');
  if (!splash || splash.dataset['taken']) {
    return null;
  }

  splash.dataset['taken'] = 'true';
  splash.classList.remove('is-revealing', 'is-dismissing');
  splash.hidden = false;
  return splash;
}

/** Hides the splash again (after its reveal or fade), ready for reuse. */
export function releaseBootSplash(splash: HTMLElement): void {
  splash.hidden = true;
  splash.classList.remove('is-revealing', 'is-dismissing');
  delete splash.dataset['taken'];
}

/** Fades the waiting splash away unless the app shell has taken it. */
export function dismissBootSplash(): void {
  const splash = document.getElementById('boot-splash');
  if (!splash || splash.hidden || splash.dataset['taken']) {
    return;
  }

  splash.dataset['taken'] = 'true';
  splash.classList.add('is-dismissing');
  setTimeout(() => releaseBootSplash(splash), 300);
}
