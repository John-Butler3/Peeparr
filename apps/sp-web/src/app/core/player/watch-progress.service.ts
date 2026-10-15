import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, tap } from 'rxjs';

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
   * Clears these Stash scenes' watch history (resume point and play count)
   * and drops their progress lines straight away.
   */
  markUnwatched(stashSceneIds: readonly string[]): Observable<void> {
    const http = this.http;
    if (!http || stashSceneIds.length === 0) {
      return of(undefined);
    }

    return forkJoin(
      stashSceneIds.map((id) =>
        http.post<void>(`/api/home/watch-progress/${encodeURIComponent(id)}/unwatched`, {}),
      ),
    ).pipe(
      tap(() => this.forget(stashSceneIds)),
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
    http
      .get<WatchProgressResponse>('/api/home/watch-progress')
      .pipe(catchError(() => of<WatchProgressResponse>({ items: [] })))
      .subscribe((response) => {
        this.loading = false;
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

  private forget(stashSceneIds: readonly string[]): void {
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
