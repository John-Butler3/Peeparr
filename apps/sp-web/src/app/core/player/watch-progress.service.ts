import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, Subject, catchError, forkJoin, map, of, tap } from 'rxjs';

interface WatchProgressResponse {
  items: Array<{ id: string; activeCatalogSceneId: string | null; progressPercent: number }>;
}

interface WatchProgressIndex {
  /** Stash scene id -> percent. */
  local: ReadonlyMap<string, number>;
  /** Catalog scene id -> percent. */
  catalog: ReadonlyMap<string, number>;
  /** Stash scene id -> catalog scene id, to keep both in step. */
  catalogIdByLocal: ReadonlyMap<string, string>;
}

const EMPTY_INDEX: WatchProgressIndex = {
  local: new Map(),
  catalog: new Map(),
  catalogIdByLocal: new Map(),
};

// YouTube-style red "watched" line on scene thumbnails: how far through each
// scene with watch history the viewer is. Loaded lazily on first lookup and
// refreshed when it goes stale; playback updates it straight away.
@Injectable({
  providedIn: 'root',
})
export class WatchProgressService {
  static readonly STALE_AFTER_MS = 60_000;

  private readonly http = inject(HttpClient, { optional: true });
  private readonly index = signal<WatchProgressIndex>(EMPTY_INDEX);
  private loading = false;
  private loadedAt = 0;
  /** Counts clearings, so that a list asked for before one doesn't undo it. */
  private changes = 0;

  /** Scenes just marked unwatched (Stash ids), for lists holding their own copies. */
  readonly cleared = new Subject<readonly string[]>();

  /** Percent watched (1-100) for a Stash or catalog scene id, else null. */
  percentFor(sceneId: string | null | undefined): number | null {
    this.refreshIfStale();
    if (!sceneId) {
      return null;
    }

    const index = this.index();
    return index.local.get(sceneId) ?? index.catalog.get(sceneId) ?? null;
  }

  /** Whether any of these Stash scenes has watch history. */
  isWatched(stashSceneIds: readonly string[]): boolean {
    return stashSceneIds.some((id) => this.percentFor(id) !== null);
  }

  /**
   * Clears these Stash scenes' watch history (resume point and play count).
   * Their progress lines go at once, not waiting for the server; if it fails,
   * they come back.
   */
  markUnwatched(stashSceneIds: readonly string[]): Observable<void> {
    const http = this.http;
    if (!http || stashSceneIds.length === 0) {
      return of(undefined);
    }

    this.forget(stashSceneIds);
    this.cleared.next(stashSceneIds);
    return forkJoin(
      stashSceneIds.map((id) =>
        http.post<void>(`/api/home/watch-progress/${encodeURIComponent(id)}/unwatched`, {}),
      ),
    ).pipe(
      tap({
        // What the server now says, from after the change.
        next: () => this.refreshAfterChange(),
        error: () => this.refreshAfterChange(),
      }),
      map(() => undefined),
    );
  }

  /** Playback just saved a position for this Stash scene. */
  record(stashSceneId: string, resumeSeconds: number, duration: number | null): void {
    if (!duration || duration <= 0 || resumeSeconds <= 0) {
      return;
    }

    let percent = Math.min(100, Math.max(1, Math.round((resumeSeconds / duration) * 100)));
    if (percent >= 95) {
      percent = 100;
    }

    const current = this.index();
    const local = new Map(current.local).set(stashSceneId, percent);
    const catalog = new Map(current.catalog);
    const catalogId = current.catalogIdByLocal.get(stashSceneId);
    if (catalogId) {
      catalog.set(catalogId, percent);
    }
    this.index.set({ ...current, local, catalog });
  }

  refresh(): void {
    const http = this.http;
    if (!http || this.loading) {
      return;
    }

    this.loading = true;
    const changes = this.changes;
    http
      .get<WatchProgressResponse>('/api/home/watch-progress')
      .pipe(catchError(() => of<WatchProgressResponse>({ items: [] })))
      .subscribe((response) => {
        this.loading = false;
        if (changes !== this.changes) {
          // Out of date before it arrived: asked for again on the next look.
          this.loadedAt = 0;
          return;
        }
        this.loadedAt = Date.now();
        const local = new Map<string, number>();
        const catalog = new Map<string, number>();
        const catalogIdByLocal = new Map<string, string>();
        for (const item of response.items) {
          local.set(item.id, item.progressPercent);
          if (item.activeCatalogSceneId) {
            catalog.set(item.activeCatalogSceneId, item.progressPercent);
            catalogIdByLocal.set(item.id, item.activeCatalogSceneId);
          }
        }
        this.index.set({ local, catalog, catalogIdByLocal });
      });
  }

  private refreshAfterChange(): void {
    this.loadedAt = 0;
    this.refresh();
  }

  private forget(stashSceneIds: readonly string[]): void {
    this.changes += 1;
    const current = this.index();
    const local = new Map(current.local);
    const catalog = new Map(current.catalog);
    for (const id of stashSceneIds) {
      local.delete(id);
      const catalogId = current.catalogIdByLocal.get(id);
      if (catalogId) {
        catalog.delete(catalogId);
      }
    }
    this.index.set({ ...current, local, catalog });
  }

  private refreshIfStale(): void {
    if (!this.loading && Date.now() - this.loadedAt > WatchProgressService.STALE_AFTER_MS) {
      this.refresh();
    }
  }
}
