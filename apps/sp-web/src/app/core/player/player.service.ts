import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';
import { DiscoverService } from '../api/discover.service';
import { ScenePlaybackSource } from '../api/discover.types';
import { WatchProgressService } from './watch-progress.service';

export type PlayerState =
  | { status: 'loading'; title: string; imageUrl: string | null }
  | { status: 'error'; title: string; imageUrl: string | null; message: string }
  | {
      status: 'ready';
      title: string;
      imageUrl: string | null;
      source: ScenePlaybackSource;
    };

// What the watch panel shows under the video (YouTube-style watch page).
// Everything is optional; callers pass what they already know.
export interface PlayerDetails {
  studio?: string | null;
  studioImageUrl?: string | null;
  releaseDate?: string | null;
  performers?: readonly string[];
  description?: string | null;
  /** In-app page for the scene (opened from the watch panel). */
  detailsLink?: { commands: readonly unknown[]; queryParams?: Record<string, string> | null } | null;
  stashUrl?: string | null;
}

// A list of Stash scenes played back-to-back (a series' "Play all").
export interface PlayerQueueItem {
  localSceneId: string;
  title: string;
  imageUrl: string | null;
  details?: PlayerDetails | null;
}

/** 'full': the watch panel; 'mini': the docked miniplayer. */
export type PlayerMode = 'full' | 'mini';

export interface PlayerQueue {
  name: string;
  items: readonly PlayerQueueItem[];
  index: number;
}

interface ScenePlaybackInfo {
  resumeSeconds: number;
  duration: number | null;
}

@Injectable({
  providedIn: 'root',
})
export class PlayerService {
  private readonly http = inject(HttpClient);
  private readonly watchProgress = inject(WatchProgressService);
  private readonly discoverService = inject(DiscoverService);

  // Guards against a slow/late response from a previous open() overwriting
  // state after the player was closed or a different scene was opened.
  private requestToken = 0;

  readonly state = signal<PlayerState | null>(null);
  readonly details = signal<PlayerDetails | null>(null);
  readonly mode = signal<PlayerMode>('full');
  readonly queue = signal<PlayerQueue | null>(null);
  readonly hasNext = computed(() => {
    const queue = this.queue();
    return !!queue && queue.index < queue.items.length - 1;
  });
  readonly hasPrevious = computed(() => (this.queue()?.index ?? 0) > 0);

  playQueue(name: string, items: readonly PlayerQueueItem[], startIndex = 0): void {
    if (items.length === 0) {
      return;
    }

    const index = Math.min(Math.max(0, startIndex), items.length - 1);
    this.queue.set({ name, items, index });
    this.mode.set('full');
    this.loadLocalScene(items[index]);
  }

  /** Jumps to a queued scene (the watch panel's "Up next" list). */
  playQueueIndex(index: number): boolean {
    const queue = this.queue();
    if (!queue || index < 0 || index >= queue.items.length || index === queue.index) {
      return false;
    }

    return this.moveQueue(index - queue.index);
  }

  /** Stream source for a Stash scene id (resume point included). */
  resolveLocalSource(localSceneId: string): Observable<ScenePlaybackSource> {
    const streamUrl = `/api/media/stash/scenes/${encodeURIComponent(localSceneId)}/stream`;
    return this.getScenePlaybackInfo(localSceneId).pipe(
      catchError(() => of<ScenePlaybackInfo>({ resumeSeconds: 0, duration: null })),
      map((info) => ({
        streamUrl,
        stashSceneId: localSceneId,
        resumeSeconds: info.resumeSeconds,
        duration: info.duration,
      })),
    );
  }

  /** Stream source for a catalog scene (via its matching Stash copy). */
  resolveCatalogSource(catalogStashId: string, copyId?: string): Observable<ScenePlaybackSource> {
    return this.discoverService.getSceneStreamUrl(catalogStashId, copyId);
  }

  // An inline (watch page) player handing its video over when you leave the
  // page: carries on in the miniplayer from the same moment, YouTube-style.
  handOff(params: {
    title: string;
    imageUrl: string | null;
    source: ScenePlaybackSource;
    details?: PlayerDetails | null;
  }): void {
    this.requestToken += 1;
    this.queue.set(null);
    this.details.set(params.details ?? null);
    this.mode.set('mini');
    this.state.set({
      status: 'ready',
      title: params.title,
      imageUrl: params.imageUrl,
      source: params.source,
    });
  }

  minimize(): void {
    if (this.state()) {
      this.mode.set('mini');
    }
  }

  expand(): void {
    if (this.state()) {
      this.mode.set('full');
    }
  }

  // Moves to the next queued scene. Returns false at the end of the queue.
  next(): boolean {
    return this.moveQueue(1);
  }

  previous(): boolean {
    return this.moveQueue(-1);
  }

  openByCatalogSceneId(params: {
    title: string;
    catalogStashId: string;
    copyId?: string;
    imageUrl?: string | null;
    details?: PlayerDetails | null;
  }): void {
    this.queue.set(null);
    this.mode.set('full');
    this.details.set(params.details ?? null);
    const imageUrl = params.imageUrl ?? null;
    const token = this.beginLoad(params.title, imageUrl);

    this.discoverService
      .getSceneStreamUrl(params.catalogStashId, params.copyId)
      .subscribe({
        next: (source) => this.applySource(token, params.title, imageUrl, source),
        error: () =>
          this.applyError(
            token,
            params.title,
            imageUrl,
            'Failed to load stream from Stash.',
          ),
      });
  }

  openByLocalSceneId(params: {
    title: string;
    localSceneId: string;
    imageUrl?: string | null;
    details?: PlayerDetails | null;
  }): void {
    this.queue.set(null);
    this.mode.set('full');
    this.loadLocalScene(params);
  }

  private moveQueue(step: number): boolean {
    const queue = this.queue();
    const index = (queue?.index ?? 0) + step;
    if (!queue || index < 0 || index >= queue.items.length) {
      return false;
    }

    this.queue.set({ ...queue, index });
    this.loadLocalScene(queue.items[index]);
    return true;
  }

  private loadLocalScene(params: {
    title: string;
    localSceneId: string;
    imageUrl?: string | null;
    details?: PlayerDetails | null;
  }): void {
    this.details.set(params.details ?? null);
    const imageUrl = params.imageUrl ?? null;
    const token = this.beginLoad(params.title, imageUrl);

    this.resolveLocalSource(params.localSceneId).subscribe((source) =>
      this.applySource(token, params.title, imageUrl, source),
    );
  }

  close(): void {
    this.requestToken += 1;
    this.state.set(null);
    this.queue.set(null);
    this.details.set(null);
    this.mode.set('full');
  }

  saveProgress(
    stashSceneId: string,
    resumeSeconds: number,
    playDuration: number | null,
  ): void {
    if (!Number.isFinite(resumeSeconds) || resumeSeconds < 0) {
      return;
    }

    this.watchProgress.record(stashSceneId, resumeSeconds, playDuration);

    this.http
      .post<void>(
        `/api/media/stash/scenes/${encodeURIComponent(stashSceneId)}/progress`,
        {
          resumeSeconds,
          ...(playDuration !== null ? { playDuration } : {}),
        },
      )
      .pipe(catchError(() => of(undefined)))
      .subscribe();
  }

  private getScenePlaybackInfo(
    localSceneId: string,
  ): Observable<ScenePlaybackInfo> {
    return this.http.get<ScenePlaybackInfo>(
      `/api/media/stash/scenes/${encodeURIComponent(localSceneId)}/playback-info`,
    );
  }

  private beginLoad(title: string, imageUrl: string | null): number {
    this.requestToken += 1;
    const token = this.requestToken;
    this.state.set({ status: 'loading', title, imageUrl });
    return token;
  }

  private applySource(
    token: number,
    title: string,
    imageUrl: string | null,
    source: ScenePlaybackSource,
  ): void {
    if (token !== this.requestToken) {
      return;
    }

    this.state.set({ status: 'ready', title, imageUrl, source });
  }

  private applyError(
    token: number,
    title: string,
    imageUrl: string | null,
    message: string,
  ): void {
    if (token !== this.requestToken) {
      return;
    }

    this.state.set({ status: 'error', title, imageUrl, message });
  }
}
