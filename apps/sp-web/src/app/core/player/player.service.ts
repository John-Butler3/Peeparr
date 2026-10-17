import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, map, of } from 'rxjs';
import { DiscoverService } from '../api/discover.service';
import { ScenePlaybackSource } from '../api/discover.types';
import { VideoQualityService } from './video-quality.service';
import { WatchProgressService } from './watch-progress.service';

/** What the miniplayer is playing (a video carried on from its scene page). */
export interface MiniplayerState {
  title: string;
  imageUrl: string | null;
  source: ScenePlaybackSource;
}

// About the scene playing (the miniplayer's subtitle, the lock screen).
// Everything is optional; callers pass what they already know.
export interface PlayerDetails {
  studio?: string | null;
  studioImageUrl?: string | null;
  releaseDate?: string | null;
  performers?: readonly string[];
  description?: string | null;
  /** The scene's page in the app (where Play opens, and the miniplayer returns). */
  detailsLink?: {
    commands: readonly unknown[];
    queryParams?: Record<string, string> | null;
  } | null;
  stashUrl?: string | null;
}

// A series' parts, in order ("Play all").
export interface PlayerQueueItem {
  localSceneId: string;
  title: string;
  imageUrl: string | null;
  details?: PlayerDetails | null;
}

interface ScenePlaybackInfo {
  resumeSeconds: number;
  duration: number | null;
  /** Lets players without the session cookie (AirPlay) fetch the video. */
  streamToken?: string | null;
}

/**
 * Playback: always on the scene's own page, in its player. Play anywhere
 * opens that page autoplaying. Leaving the page while it plays hands the
 * video to the miniplayer, which carries on and returns to the page when
 * tapped.
 */
@Injectable({
  providedIn: 'root',
})
export class PlayerService {
  private readonly http = inject(HttpClient);
  private readonly watchProgress = inject(WatchProgressService);
  private readonly discoverService = inject(DiscoverService);
  private readonly router = inject(Router);
  private readonly videoQuality = inject(VideoQualityService);
  private pendingHandBack: { stashSceneId: string; seconds: number } | null = null;

  /** The miniplayer's video, while there is one. */
  readonly state = signal<MiniplayerState | null>(null);
  readonly details = signal<PlayerDetails | null>(null);

  openByCatalogSceneId(params: {
    title: string;
    catalogStashId: string;
    imageUrl?: string | null;
    details?: PlayerDetails | null;
  }): void {
    this.openScenePage(params.details?.detailsLink, ['/scene', params.catalogStashId]);
  }

  openByLocalSceneId(params: {
    title: string;
    localSceneId: string;
    imageUrl?: string | null;
    details?: PlayerDetails | null;
  }): void {
    this.openScenePage(params.details?.detailsLink, ['/library/scene', params.localSceneId]);
  }

  // A series plays from the chosen part's page: its other parts head Up next
  // there and follow on automatically.
  playQueue(name: string, items: readonly PlayerQueueItem[], startIndex = 0): void {
    const item = items[Math.min(Math.max(0, startIndex), items.length - 1)];
    if (item) {
      this.openScenePage(item.details?.detailsLink, ['/library/scene', item.localSceneId]);
    }
  }

  /** Stream source for a Stash scene id (resume point included). */
  resolveLocalSource(localSceneId: string): Observable<ScenePlaybackSource> {
    const streamUrl = `/api/media/stash/scenes/${encodeURIComponent(localSceneId)}/stream`;
    return this.getScenePlaybackInfo(localSceneId).pipe(
      catchError(() => of<ScenePlaybackInfo>({ resumeSeconds: 0, duration: null })),
      map((info) => ({
        // With the stream token, an Apple TV handed this URL over AirPlay can
        // fetch it too (it doesn't have the session cookie).
        streamUrl: info.streamToken
          ? `${streamUrl}?st=${encodeURIComponent(info.streamToken)}`
          : streamUrl,
        stashSceneId: localSceneId,
        resumeSeconds: info.resumeSeconds,
        duration: info.duration,
      })),
      // At this device's quality.
      map((source) => this.videoQuality.apply(source)),
    );
  }

  /** Stream source for a catalog scene (via its matching Stash copy). */
  resolveCatalogSource(catalogStashId: string, copyId?: string): Observable<ScenePlaybackSource> {
    return this.discoverService
      .getSceneStreamUrl(catalogStashId, copyId)
      .pipe(map((source) => this.videoQuality.apply(source)));
  }

  // A scene page's player handing its video over as you leave the page: the
  // miniplayer carries on from the same moment, YouTube-style.
  handOff(params: {
    title: string;
    imageUrl: string | null;
    source: ScenePlaybackSource;
    details?: PlayerDetails | null;
  }): void {
    this.details.set(params.details ?? null);
    this.state.set({ title: params.title, imageUrl: params.imageUrl, source: params.source });
  }

  /**
   * The miniplayer going back to its scene's page: where the video was, for
   * that page's player to carry on from (taken once).
   */
  handBack(stashSceneId: string, seconds: number): void {
    this.pendingHandBack = { stashSceneId, seconds };
  }

  takeHandBack(stashSceneId: string): number | null {
    const pending = this.pendingHandBack;
    if (!pending || pending.stashSceneId !== stashSceneId) {
      return null;
    }
    this.pendingHandBack = null;
    return pending.seconds;
  }

  close(): void {
    this.state.set(null);
    this.details.set(null);
  }

  saveProgress(stashSceneId: string, resumeSeconds: number, playDuration: number | null): void {
    if (!Number.isFinite(resumeSeconds) || resumeSeconds < 0) {
      return;
    }

    this.watchProgress.record(stashSceneId, resumeSeconds, playDuration);

    this.http
      .post<void>(`/api/media/stash/scenes/${encodeURIComponent(stashSceneId)}/progress`, {
        resumeSeconds,
        ...(playDuration !== null ? { playDuration } : {}),
      })
      .pipe(catchError(() => of(undefined)))
      .subscribe();
  }

  private openScenePage(
    link: PlayerDetails['detailsLink'] | undefined,
    fallback: readonly unknown[],
  ): void {
    void this.router.navigate([...(link?.commands ?? fallback)], {
      queryParams: { ...(link?.queryParams ?? {}), autoplay: '1' },
    });
  }

  private getScenePlaybackInfo(localSceneId: string): Observable<ScenePlaybackInfo> {
    return this.http.get<ScenePlaybackInfo>(
      `/api/media/stash/scenes/${encodeURIComponent(localSceneId)}/playback-info`,
    );
  }
}
