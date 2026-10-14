import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, map, of, shareReplay } from 'rxjs';
import { ScenePlaybackSource } from '../../core/api/discover.types';

export interface ScenePreviewSource {
  /** Stash's short preview clip, when generated (404 otherwise). */
  clipUrl: string | null;
  /** The full scene; previewed from the middle when there's no clip. */
  streamUrl: string;
  duration: number | null;
}

const clipUrl = (stashSceneId: string) =>
  `/api/media/stash/scenes/${encodeURIComponent(stashSceneId)}/preview`;

// Where a hover preview (YouTube-style) streams from. Read-only: previews
// never save progress, so they don't touch watch history or resume points.
@Injectable({
  providedIn: 'root',
})
export class ScenePreviewService {
  private readonly http = inject(HttpClient, { optional: true });
  private readonly catalogSources = new Map<string, Observable<ScenePreviewSource | null>>();

  /** A Stash scene id (library, home). */
  local(stashSceneId: string, duration: number | null): Observable<ScenePreviewSource | null> {
    return of({
      clipUrl: clipUrl(stashSceneId),
      streamUrl: `/api/media/stash/scenes/${encodeURIComponent(stashSceneId)}/stream`,
      duration,
    });
  }

  /** A catalog scene id, via its Stash copy (looked up once per scene). */
  catalog(catalogStashId: string): Observable<ScenePreviewSource | null> {
    const http = this.http;
    if (!http) {
      return of(null);
    }

    let source = this.catalogSources.get(catalogStashId);
    if (!source) {
      source = http
        .get<ScenePlaybackSource>(`/api/scenes/${encodeURIComponent(catalogStashId)}/stream`)
        .pipe(
          map((playback) => ({
            clipUrl: clipUrl(playback.stashSceneId),
            streamUrl: playback.streamUrl,
            duration: playback.duration,
          })),
          catchError(() => of(null)),
          shareReplay(1),
        );
      this.catalogSources.set(catalogStashId, source);
    }

    return source;
  }
}
