import { Injectable } from '@angular/core';
import { PlayerDetails } from './player.service';

/** What the OS shows about the scene playing. */
export interface NowPlayingInfo {
  title: string;
  imageUrl: string | null;
  details?: PlayerDetails | null;
}

type Handled = 'play' | 'pause' | 'seekto' | 'seekbackward' | 'seekforward';

/**
 * The OS "now playing" surface (iPhone lock screen and Control Center, the
 * Apple TV while on AirPlay, Android's notification, media keys): the
 * scene's title, its performers and site, and its thumbnail, with play /
 * pause / seek handlers, for whichever player has the video.
 *
 * WebKit shows nothing but the page's name until the handlers are
 * registered, and goes back to it when the video starts (or restarts) --
 * so the details are put up again on every 'playing'. Artwork URLs are
 * made absolute: a relative one isn't fetched everywhere.
 */
@Injectable({ providedIn: 'root' })
export class NowPlayingService {
  /** One image serves every size: the OS scales whichever it picks. */
  static readonly ARTWORK_SIZES = ['96x96', '192x192', '256x256', '384x384', '512x512'];
  private static readonly ACTIONS: readonly Handled[] = [
    'play',
    'pause',
    'seekto',
    'seekbackward',
    'seekforward',
  ];

  private video: HTMLVideoElement | null = null;
  private info: NowPlayingInfo | null = null;
  private listeners: AbortController | null = null;

  /** This video, started, is what's playing: put its details up and keep them there. */
  show(video: HTMLVideoElement, info: NowPlayingInfo): void {
    if (!this.supported()) {
      return;
    }
    this.info = info;
    if (this.video !== video) {
      this.listen(video);
    }
    this.apply('playing');
  }

  /** Nothing is playing any more. */
  clear(): void {
    this.listeners?.abort();
    this.listeners = null;
    this.video = null;
    this.info = null;
    if (!this.supported()) {
      return;
    }
    const session = navigator.mediaSession;
    session.metadata = null;
    session.playbackState = 'none';
    for (const action of NowPlayingService.ACTIONS) {
      this.setHandler(session, action, null);
    }
  }

  private supported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      'mediaSession' in navigator &&
      typeof MediaMetadata !== 'undefined'
    );
  }

  private listen(video: HTMLVideoElement): void {
    this.listeners?.abort();
    this.listeners = new AbortController();
    this.video = video;
    const signal = this.listeners.signal;
    // Starting puts the page's name up in WebKit: the scene's details again.
    video.addEventListener('playing', () => this.apply('playing'), { signal });
    video.addEventListener('play', () => this.setState('playing'), { signal });
    video.addEventListener('pause', () => this.setState('paused'), { signal });
    video.addEventListener('ended', () => this.setState('paused'), { signal });
  }

  private apply(state: MediaSessionPlaybackState): void {
    const video = this.video;
    const info = this.info;
    if (!video || !info) {
      return;
    }
    const session = navigator.mediaSession;
    const performers = info.details?.performers?.filter(Boolean) ?? [];
    const studio = info.details?.studio?.trim() ?? '';
    session.metadata = new MediaMetadata({
      title: info.title,
      artist: performers.join(', '),
      album: studio,
      artwork: info.imageUrl ? this.artwork(info.imageUrl) : [],
    });
    session.playbackState = state;

    this.setHandler(session, 'play', () => {
      video.play().catch(() => undefined);
    });
    this.setHandler(session, 'pause', () => video.pause());
    this.setHandler(session, 'seekto', (details) => {
      if (typeof details.seekTime === 'number') {
        video.currentTime = details.seekTime;
      }
    });
    this.setHandler(session, 'seekbackward', (details) => {
      video.currentTime = Math.max(0, video.currentTime - (details.seekOffset ?? 10));
    });
    this.setHandler(session, 'seekforward', (details) => {
      video.currentTime = Math.min(
        video.duration || Infinity,
        video.currentTime + (details.seekOffset ?? 10),
      );
    });
  }

  private setState(state: MediaSessionPlaybackState): void {
    if (this.video) {
      navigator.mediaSession.playbackState = state;
    }
  }

  private artwork(imageUrl: string): MediaImage[] {
    const src = this.absolute(imageUrl);
    return NowPlayingService.ARTWORK_SIZES.map((sizes) => ({ src, sizes }));
  }

  private absolute(url: string): string {
    try {
      return new URL(url, document.baseURI).href;
    } catch {
      return url;
    }
  }

  private setHandler(
    session: MediaSession,
    action: Handled,
    handler: MediaSessionActionHandler | null,
  ): void {
    try {
      session.setActionHandler(action, handler);
    } catch {
      // Not an action this browser knows.
    }
  }
}
