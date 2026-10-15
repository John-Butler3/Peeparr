import { Location } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';

interface HistoryEntry {
  /** Router navigation ids that landed on this entry (to match Back/Forward). */
  ids: number[];
  url: string;
  path: string;
  /** Set by the page once it knows its name ("Anna Example"). */
  label: string | null;
}

// What to call a page that hasn't named itself, by path.
const PATH_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['/home', 'Home'],
  ['/scenes', 'Scenes'],
  ['/scene/', 'Scene'],
  ['/library/scene/', 'Scene'],
  ['/library', 'Library'],
  ['/upcoming', 'Upcoming'],
  ['/acquisition', 'Acquisition'],
  ['/performers', 'Performers'],
  ['/performer/', 'Performer'],
  ['/studios', 'Studios'],
  ['/studio/', 'Studio'],
  ['/series/', 'Series'],
  ['/series', 'Series'],
  ['/galleries/', 'Gallery'],
  ['/galleries', 'Galleries'],
  ['/search', 'Search'],
  ['/settings', 'Settings'],
];

/**
 * In-app history, so "Back to ..." buttons name the screen you actually came
 * from and return to it (with the browser's own Back, which restores where
 * you were scrolled). Pages name themselves with setLabel(); others are
 * named by path. With no in-app history (a link opened directly), back
 * buttons fall back to their page's default.
 */
@Injectable({
  providedIn: 'root',
})
export class NavigationHistoryService {
  /** Longest label shown on a back button. */
  static readonly MAX_LABEL = 28;
  private static readonly MAX_ENTRIES = 50;

  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private entries: HistoryEntry[] = [];
  private index = -1;
  private pending: { id: number; popstate: boolean; restoredId: number | null; replace: boolean } | null =
    null;
  private readonly version = signal(0);

  /** The screen before this one, if it was in the app. */
  readonly previous = computed(() => {
    this.version();
    const entry = this.index > 0 ? this.entries[this.index - 1] : null;
    return entry ? { url: entry.url, label: this.labelFor(entry) } : null;
  });

  constructor() {
    const url = this.router.url;
    if (url && url !== '/') {
      this.entries = [this.entry(-1, url)];
      this.index = 0;
    }

    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.pending = {
          id: event.id,
          popstate: event.navigationTrigger === 'popstate',
          restoredId: event.restoredState?.navigationId ?? null,
          replace: this.router.getCurrentNavigation()?.extras.replaceUrl === true,
        };
      } else if (event instanceof NavigationEnd) {
        this.record(event.id, event.urlAfterRedirects);
      }
    });
  }

  /** "Back to <previous screen>", or the fallback with no in-app history. */
  backLabel(fallback: string): string {
    const previous = this.previous();
    return previous ? `Back to ${previous.label}` : fallback;
  }

  canGoBack(): boolean {
    return this.previous() !== null;
  }

  /**
   * Back to the previous screen. Returns false (doing nothing) when there's
   * no in-app history, so the caller can use its own default.
   */
  back(): boolean {
    if (!this.canGoBack()) {
      return false;
    }
    this.location.back();
    return true;
  }

  /** Names the current screen for the next screen's back button. */
  setLabel(label: string | null | undefined): void {
    const current = this.entries[this.index];
    const trimmed = label?.trim();
    if (current && trimmed && current.label !== trimmed) {
      current.label = trimmed;
      this.version.update((v) => v + 1);
    }
  }

  private record(id: number, url: string): void {
    const pending = this.pending?.id === id ? this.pending : null;
    this.pending = null;
    const path = this.pathOf(url);
    const current = this.entries[this.index];

    if (pending?.popstate) {
      // Back/Forward: find where in our history that was.
      const found = pending.restoredId !== null
        ? this.entries.findIndex((entry) => entry.ids.includes(pending.restoredId!))
        : -1;
      if (found >= 0) {
        this.index = found;
        this.entries[found].url = url;
        this.entries[found].ids.push(id);
      } else {
        this.entries = [this.entry(id, url)];
        this.index = 0;
      }
    } else if (current && (pending?.replace || current.path === path)) {
      // Same screen (filters, a tab) or a replaced URL: update it in place.
      if (current.path !== path) {
        current.label = null;
        current.path = path;
      }
      current.url = url;
      current.ids.push(id);
    } else {
      this.entries = this.entries.slice(0, this.index + 1);
      this.entries.push(this.entry(id, url));
      if (this.entries.length > NavigationHistoryService.MAX_ENTRIES) {
        this.entries.shift();
      }
      this.index = this.entries.length - 1;
    }
    this.version.update((v) => v + 1);
  }

  private entry(id: number, url: string): HistoryEntry {
    return { ids: [id], url, path: this.pathOf(url), label: null };
  }

  private labelFor(entry: HistoryEntry): string {
    const label = entry.label ?? PATH_LABELS.find(([prefix]) => entry.path.startsWith(prefix))?.[1] ?? 'previous page';
    return label.length > NavigationHistoryService.MAX_LABEL
      ? `${label.slice(0, NavigationHistoryService.MAX_LABEL - 1).trimEnd()}…`
      : label;
  }

  private pathOf(url: string): string {
    return url.split(/[?#]/)[0] || '/';
  }
}
