import { Injectable, inject } from '@angular/core';
import { NavigationStart, RouteReuseStrategy, Router } from '@angular/router';
import { KeepAliveRouteStrategy } from './keep-alive-route.strategy';
import { NavigationHistoryService } from './navigation-history.service';
import { ScrollMemoryService } from './scroll-memory.service';

/**
 * Fading the page on screen out, just before a page change that moves the
 * playing video (down into the miniplayer, or back up): the video, lifted
 * out of the page, glides over the fade rather than a cut. The next page
 * then fades in a touch more gently (read by the page transition).
 *
 * Swiping the video down by hand: the page you came from (kept alive) is put
 * back behind this one, scrolled as you left it, and this page fades with
 * the drag to reveal it (setProgress). Let go and it's simply there --
 * the router takes that same element back -- or, cancelled, it's put away.
 *
 * Pages are kept alive when left, so a faded page is reset as the next one
 * comes in: it must show normally when it's returned to.
 *
 * Putting a whole page back takes a phone a moment (style, layout, paint of
 * all of it), long enough to stall a swipe. So while a scene plays, the page
 * you came from is readied behind it ahead of time, unseen (prepareBehind):
 * a swipe then only has to show it.
 */
@Injectable({ providedIn: 'root' })
export class PageFadeService {
  static readonly FADE_OUT_MS = 200;
  /** How far a drag dims the page (at its full distance), with nothing behind. */
  static readonly DRAG_DIM = 0.5;
  /** With the page before revealed behind it: almost gone. */
  static readonly DRAG_REVEAL = 0.9;

  private readonly reuseStrategy = inject(RouteReuseStrategy);
  private readonly history = inject(NavigationHistoryService);
  private readonly scrollMemory = inject(ScrollMemoryService);

  private area: HTMLElement | null = null;
  private page: HTMLElement | null = null;
  /** The page before, put back behind this one while dragging. */
  private behind: HTMLElement | null = null;
  private behindPath: string | null = null;
  private fading: Animation | null = null;
  private soft = false;
  /** The page behind was readied ahead of time: a cancelled swipe hides it again. */
  private warm = false;
  /**
   * Where each page left started down the document (pages under the top
   * bar start lower than a scene's, which has none on phones), so one put
   * back behind sits where it'll be.
   */
  private readonly pageTops = new Map<string, number>();

  constructor() {
    const router = inject(Router);
    router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        if (this.reuseStrategy instanceof KeepAliveRouteStrategy) {
          this.reuseStrategy.navigationStarted();
        }
        const page = this.currentPage();
        if (page) {
          this.pageTops.set(pathOf(router.url), page.getBoundingClientRect().top + window.scrollY);
        }
      }
    });
  }

  /** The page area (the page transition's host). */
  setArea(area: HTMLElement | null): void {
    this.area = area;
  }

  /**
   * Puts the page you came from back behind this one (if it's been kept), as
   * it was. True if it's there.
   */
  revealBehind(): boolean {
    const previous = this.history.previous();
    return !!previous && this.revealPage(previous.url) !== null;
  }

  /**
   * Readies the page you came from behind this one, unseen, so a swipe
   * later only has to show it. True if it's there.
   */
  prepareBehind(): boolean {
    if (this.behind) {
      return true;
    }
    const previous = this.history.previous();
    const behind = previous ? this.placeBehind(previous.url) : null;
    if (!behind) {
      return false;
    }
    behind.style.opacity = '0';
    this.warm = true;
    return true;
  }

  /**
   * revealBehind, just after the next frame: putting a whole page back
   * (Home, say) takes a phone a moment, and a swipe's video should already
   * be moving with the finger by then, not wait for it. Skipped if
   * `stillWanted` says the swipe has ended meanwhile.
   */
  revealBehindSoon(stillWanted: () => boolean): void {
    requestAnimationFrame(() =>
      setTimeout(() => {
        if (stillWanted()) {
          this.revealBehind();
        }
      }),
    );
  }

  /**
   * Puts a kept page (by URL) behind this one, as it was: for a page about
   * to be gone to by a drag (swiping up the miniplayer to its scene). The
   * page's element, or null if it isn't kept.
   */
  revealPage(url: string): HTMLElement | null {
    if (this.behind && this.behindPath !== pathOf(url)) {
      this.putBehindAway();
    }
    const behind = this.behind ?? this.placeBehind(url);
    const page = this.currentPage();
    if (!behind || !page) {
      return null;
    }
    behind.style.opacity = '';
    // This page in front of it, covering it until it fades.
    Object.assign(page.style, {
      position: 'relative',
      zIndex: '1',
      background: 'var(--app-bg)',
    });
    this.page = page;
    return behind;
  }

  /** A kept page (by URL) put in behind this one, where it'll be once there. */
  private placeBehind(url: string): HTMLElement | null {
    const area = this.area;
    const page = this.currentPage();
    const strategy =
      this.reuseStrategy instanceof KeepAliveRouteStrategy ? this.reuseStrategy : null;
    const behind = strategy?.peekPage(url) ?? null;
    if (!area || !page || !behind || behind.isConnected) {
      return null;
    }
    // Where it'll be once there: where it started, scrolled as it was left.
    const rect = page.getBoundingClientRect();
    const pageTop = this.pageTops.get(pathOf(url)) ?? rect.top + window.scrollY;
    const top = pageTop - this.scrollMemory.savedPosition(url);
    behind.classList.add('page-behind');
    Object.assign(behind.style, {
      position: 'fixed',
      top: `${top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      zIndex: '0',
      pointerEvents: 'none',
    });
    area.appendChild(behind);
    this.behind = behind;
    this.behindPath = pathOf(url);
    return behind;
  }

  /** Fades the page with a drag (0 to 1 of the way). */
  setProgress(progress: number): void {
    const page = this.page ?? this.currentPage();
    if (!page) {
      return;
    }
    this.page = page;
    const clamped = Math.min(1, Math.max(0, progress));
    const shown = !!this.behind && this.behind.style.opacity !== '0';
    const depth = shown ? PageFadeService.DRAG_REVEAL : PageFadeService.DRAG_DIM;
    page.style.opacity = clamped > 0 ? String(1 - clamped * depth) : '';
  }

  /** Fades the page on screen out (from wherever a drag left it); resolves when it has. */
  fadeOut(): Promise<void> {
    this.soft = true;
    const page = this.page ?? this.currentPage();
    if (!page || typeof page.animate !== 'function') {
      return Promise.resolve();
    }
    this.page = page;
    this.fading?.cancel();
    const from = Number(page.style.opacity || '1');
    const fading = page.animate([{ opacity: from }, { opacity: 0 }], {
      duration: PageFadeService.FADE_OUT_MS * from,
      easing: 'ease-out',
      fill: 'forwards',
    });
    this.fading = fading;
    return fading.finished.then(
      () => undefined,
      () => undefined,
    );
  }

  /** The drag or page change didn't happen: the page shows again. */
  cancel(): void {
    if (this.warm && this.behind) {
      // Readied ahead of time: kept, unseen again, for the next swipe.
      this.behind.style.opacity = '0';
    } else {
      this.putBehindAway();
    }
    this.reset();
    this.soft = false;
  }

  /**
   * After a page change: if the page revealed behind is the one the router
   * brought back, it's simply there now (true: no page-in needed); if not,
   * it's put away. Either way the page left is reset.
   */
  finishReveal(): boolean {
    const behind = this.behind;
    if (!behind) {
      return false;
    }
    this.behind = null;
    this.warm = false;
    const strategy =
      this.reuseStrategy instanceof KeepAliveRouteStrategy ? this.reuseStrategy : null;
    const arrived = !!strategy?.wasJustRetrieved(behind);
    clearBehindStyles(behind);
    if (!arrived) {
      behind.remove();
    }
    this.soft = false;
    this.reset();
    return arrived;
  }

  /**
   * The next page is coming in: whether it should fade in gently (asked
   * once). The faded page is reset for when it's shown again.
   */
  takeSoftEnter(): boolean {
    const soft = this.soft;
    this.soft = false;
    this.reset();
    return soft;
  }

  private putBehindAway(): void {
    const behind = this.behind;
    this.behind = null;
    this.warm = false;
    if (behind) {
      clearBehindStyles(behind);
      behind.remove();
    }
  }

  private reset(): void {
    this.fading?.cancel();
    this.fading = null;
    if (this.page) {
      for (const property of ['opacity', 'position', 'zIndex', 'background'] as const) {
        this.page.style[property] = '';
      }
      this.page = null;
    }
  }

  private currentPage(): HTMLElement | null {
    return (
      this.area?.querySelector<HTMLElement>(':scope > :not(router-outlet):not(.page-behind)') ??
      null
    );
  }
}

function clearBehindStyles(behind: HTMLElement): void {
  behind.classList.remove('page-behind');
  for (const property of [
    'position',
    'top',
    'left',
    'width',
    'zIndex',
    'pointerEvents',
    'opacity',
  ] as const) {
    behind.style[property] = '';
  }
}

function pathOf(url: string): string {
  return url.split(/[?#]/)[0];
}

/**
 * Whether `element` is on a page that's showing: in the document, and not on
 * a page only put behind the current one (readied for a swipe, or revealed
 * by one). Such a page is still asleep: no playing, refreshing, autoplay.
 */
export function onShowingPage(element: Element): boolean {
  return element.isConnected && !element.closest('.page-behind');
}
