import { ApplicationRef, Component, OnDestroy, inject } from '@angular/core';
import { releaseBootSplash, takeBootSplash } from './boot-splash';

/**
 * 'reveal': the logo in the middle of the screen zooms gently, then nested
 * almond shapes open from a point just below its centre, revealing the page.
 * Plays when the app opens signed in -- on the splash that's already on
 * screen from index.html -- and straight after signing in (the same splash,
 * shown again). Starts once the page has finished loading.
 */
export type AppSplashMode = 'reveal';

// What the next app shell shows: a fresh page load and signing in get the
// splash; afterwards nothing, until the page is reloaded.
let nextSplash: AppSplashMode | null = 'reveal';

/** Plays the given splash (or none) the next time the app shell opens. */
export function setNextAppSplash(mode: AppSplashMode | null): void {
  nextSplash = mode;
}

@Component({
  selector: 'app-splash',
  template: '',
})
export class AppSplashComponent implements OnDestroy {
  /** The reveal itself; matches styles/_app-splash.scss. */
  static readonly REVEAL_MS = 2100;
  /** Don't wait on a slow page for longer than this. */
  static readonly MAX_WAIT_MS = 5000;
  /** The almond shapes' width at scale 1 (see index.html). */
  private static readonly SHAPE_WIDTH = 120;
  /** The zoom point, below the middle of the screen. */
  private static readonly ZOOM_POINT_OFFSET_Y = 16;

  private readonly appRef = inject(ApplicationRef);
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private splash: HTMLElement | null = null;
  private destroyed = false;

  constructor() {
    const mode = nextSplash;
    nextSplash = null;
    if (!mode) {
      return;
    }

    // The splash from index.html: still showing on a fresh load, or shown
    // again (logo in the middle) after signing in.
    const splash = takeBootSplash();
    if (!splash) {
      return;
    }
    this.splash = splash;

    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      releaseBootSplash(splash);
      return;
    }

    void this.whenLoaded().then(() => this.reveal(splash));
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.timers.forEach((timer) => clearTimeout(timer));
    if (this.splash && !this.splash.hidden) {
      releaseBootSplash(this.splash);
    }
  }

  // The page's first render and data requests are done (or it's taking too long).
  private whenLoaded(): Promise<void> {
    return new Promise((resolve) => {
      this.timers.push(setTimeout(resolve, AppSplashComponent.MAX_WAIT_MS));
      void this.appRef.whenStable().then(() => requestAnimationFrame(() => resolve()));
    });
  }

  private reveal(splash: HTMLElement): void {
    if (this.destroyed) {
      return;
    }

    // Grow the shapes until the outer almond (pointed at both ends, so it
    // needs plenty of room) has just cleared this screen's farthest corner
    // from the zoom point.
    const farthestCorner = Math.hypot(
      window.innerWidth / 2,
      window.innerHeight / 2 + AppSplashComponent.ZOOM_POINT_OFFSET_Y,
    );
    const scaleEnd = (farthestCorner * 3.4) / AppSplashComponent.SHAPE_WIDTH;
    document.documentElement.style.setProperty('--splash-scale-end', scaleEnd.toFixed(2));

    splash.classList.add('is-revealing');
    this.timers.push(
      setTimeout(() => {
        releaseBootSplash(splash);
        this.splash = null;
      }, AppSplashComponent.REVEAL_MS),
    );
  }
}
