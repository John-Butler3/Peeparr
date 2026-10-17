import { ComponentRef, Injectable } from '@angular/core';
import {
  ActivatedRouteSnapshot,
  BaseRouteReuseStrategy,
  DetachedRouteHandle,
} from '@angular/router';

/**
 * Pages you leave stay alive, asleep, instead of being destroyed: going back
 * (or back up from the miniplayer to the scene) shows them at once, as they
 * were. Kept per page (path and its ids, not query parameters), the most
 * recent MAX_PAGES; older ones are destroyed. Only browsing and watching
 * pages are kept (Acquisition and Settings should always open fresh).
 *
 * Asleep, a page is out of the document: its videos pause, and anything it
 * does on a timer should check it's still in the page (see Home).
 */
@Injectable({ providedIn: 'root' })
export class KeepAliveRouteStrategy extends BaseRouteReuseStrategy {
  static readonly MAX_PAGES = 5;
  static readonly KEPT_PATHS = new Set([
    'home',
    'scene/:stashId',
    'library/scene/:sceneId',
    'scenes',
    'search',
    'upcoming',
    'library',
    'galleries',
    'galleries/:galleryId',
    'series',
    'series/:seriesId',
    'performers',
    'performer/:performerId',
    'studios',
    'studio/:studioId',
  ]);

  private readonly pages = new Map<string, DetachedRouteHandle>();
  /** The page element most recently handed back to the router. */
  private retrievedElement: HTMLElement | null = null;

  /** The miniplayer's scene: kept however many pages come after it. */
  private pinned: string | null = null;

  /** A kept page's element (out of the document), by URL; null if not kept. */
  peekPage(url: string): HTMLElement | null {
    return elementOf(this.pages.get(urlKey(url)) ?? null);
  }

  /** Keeps this page (by URL) whatever else is kept, or stops (null). */
  pin(url: string | null): void {
    this.pinned = url ? urlKey(url) : null;
  }

  /** Whether this element is the page the router has just brought back. */
  wasJustRetrieved(element: HTMLElement): boolean {
    return this.retrievedElement === element;
  }

  override shouldDetach(route: ActivatedRouteSnapshot): boolean {
    return KeepAliveRouteStrategy.KEPT_PATHS.has(route.routeConfig?.path ?? '');
  }

  override store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle | null): void {
    const key = pageKey(route);
    this.pages.delete(key);
    if (!handle) {
      return;
    }
    this.pages.set(key, handle);
    // The oldest go, but never the pinned one (it doesn't count).
    const unpinned = () => this.pages.size - (this.pinned && this.pages.has(this.pinned) ? 1 : 0);
    while (unpinned() > KeepAliveRouteStrategy.MAX_PAGES) {
      const oldest = [...this.pages.entries()].find(([key]) => key !== this.pinned);
      if (!oldest) {
        break;
      }
      this.pages.delete(oldest[0]);
      destroy(oldest[1]);
    }
  }

  override shouldAttach(route: ActivatedRouteSnapshot): boolean {
    return this.pages.has(pageKey(route));
  }

  override retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
    const handle = this.pages.get(pageKey(route)) ?? null;
    this.retrievedElement = elementOf(handle);
    return handle;
  }
}

/** A URL as a page key: its path, without the leading slash or query. */
function urlKey(url: string): string {
  return url.split(/[?#]/)[0].replace(/^\/+/, '');
}

/** The page's path with its ids filled in (no query parameters). */
function pageKey(route: ActivatedRouteSnapshot): string {
  return route.pathFromRoot.flatMap((part) => part.url.map((segment) => segment.path)).join('/');
}

function elementOf(handle: DetachedRouteHandle | null): HTMLElement | null {
  const element = (handle as { componentRef?: ComponentRef<unknown> } | null)?.componentRef
    ?.location?.nativeElement;
  return element instanceof HTMLElement ? element : null;
}

function destroy(handle: DetachedRouteHandle): void {
  (handle as { componentRef?: ComponentRef<unknown> }).componentRef?.destroy();
}
