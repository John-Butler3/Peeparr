import { Injectable, inject } from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';

/**
 * Going back returns you to where you were on the previous page.
 *
 * Remembers the scroll position of each page as you leave it. Going back --
 * browser / phone back, or an in-app "Back to ..." link to the page you came
 * from -- restores it; anything else starts at the top. Pages load their
 * content after the navigation, so the restore keeps trying while the page
 * grows (lists that load more as you scroll keep loading), until it gets
 * there, the user scrolls, or it gives up.
 */
@Injectable({
  providedIn: 'root',
})
export class ScrollMemoryService {
  static readonly RESTORE_TIMEOUT_MS = 4000;

  private readonly router = inject(Router);
  private readonly positions = new Map<string, number>();
  /** In-app trail of visited URLs, to recognise "back to the page before". */
  private readonly trail: string[] = [];
  private goingBack = false;
  private restoreRun = 0;
  private started = false;

  /** Where a page was scrolled when it was left (0 if unknown). */
  savedPosition(url: string): number {
    return this.positions.get(url) ?? 0;
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }

    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.positions.set(this.router.url, window.scrollY);
        this.goingBack =
          event.navigationTrigger === 'popstate' ||
          (this.trail.length >= 2 && this.trail[this.trail.length - 2] === event.url);
      } else if (event instanceof NavigationEnd) {
        this.onArrive(event.urlAfterRedirects);
      }
    });
  }

  private onArrive(url: string): void {
    const previous = this.trail[this.trail.length - 2];
    if (this.goingBack && previous === url) {
      this.trail.pop();
    } else if (this.trail[this.trail.length - 1] !== url) {
      this.trail.push(url);
      if (this.trail.length > 50) {
        this.trail.shift();
      }
    }

    const saved = this.goingBack ? this.positions.get(url) : undefined;
    this.goingBack = false;
    this.restoreRun++;
    if (saved && saved > 0) {
      this.restore(saved);
    } else {
      window.scrollTo(0, 0);
    }
  }

  private restore(target: number): void {
    const run = this.restoreRun;
    const deadline = performance.now() + ScrollMemoryService.RESTORE_TIMEOUT_MS;
    // The user taking over stops it.
    const stop = () => {
      if (run === this.restoreRun) {
        this.restoreRun++;
      }
    };
    const inputs = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
    inputs.forEach((type) => window.addEventListener(type, stop, { once: true, passive: true }));
    const cleanUp = () => inputs.forEach((type) => window.removeEventListener(type, stop));

    const step = () => {
      if (run !== this.restoreRun) {
        cleanUp();
        return;
      }

      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, Math.max(0, Math.min(target, maxScroll)));
      const arrived = maxScroll >= target - 1 && Math.abs(window.scrollY - target) <= 1;
      if (arrived || performance.now() > deadline) {
        cleanUp();
        return;
      }

      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
