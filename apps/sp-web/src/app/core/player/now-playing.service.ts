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
 * so the details are put up again on every 'playing'.
 *
 * The artwork is the thumbnail, cropped square and handed over as a data
 * URL: iOS left the Dynamic Island's picture empty when given the
 * thumbnail's own (signed-in, 16:9) address. Until it's ready -- or if it
 * can't be had -- the Peeparr logo stands in.
 */
@Injectable({ providedIn: 'root' })
export class NowPlayingService {
  /** The square the thumbnail is cropped to. */
  static readonly ARTWORK_PX = 512;
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
  /** Thumbnails made square, by their address. */
  private readonly squares = new Map<string, string>();
  private squaring: string | null = null;

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
      artwork: this.artwork(info.imageUrl),
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

  private artwork(imageUrl: string | null): MediaImage[] {
    const square = imageUrl ? this.squares.get(imageUrl) : undefined;
    if (square) {
      const px = NowPlayingService.ARTWORK_PX;
      return [{ src: square, sizes: `${px}x${px}`, type: 'image/jpeg' }];
    }
    if (imageUrl) {
      this.makeSquare(imageUrl);
    }
    return [{ src: this.absolute(this.logo()), sizes: '512x512', type: 'image/png' }];
  }

  /** The app's logo, the discreet one when that's what the app shows. */
  private logo(): string {
    const touchIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    return touchIcon?.getAttribute('href')?.includes('discreet')
      ? 'icons/icon-discreet-512.png'
      : 'icons/icon-512.png';
  }

  /** Loads the thumbnail and crops it square; the details go up again with it. */
  private makeSquare(imageUrl: string): void {
    if (this.squaring === imageUrl) {
      return;
    }
    this.squaring = imageUrl;
    const image = new Image();
    image.onload = () => {
      if (this.squaring === imageUrl) {
        this.squaring = null;
      }
      const square = this.crop(image);
      if (!square) {
        return;
      }
      this.squares.clear();
      this.squares.set(imageUrl, square);
      if (this.info?.imageUrl === imageUrl && this.video) {
        this.apply(this.video.paused ? 'paused' : 'playing');
      }
    };
    image.onerror = () => {
      if (this.squaring === imageUrl) {
        this.squaring = null;
      }
    };
    image.src = this.absolute(imageUrl);
  }

  private crop(image: HTMLImageElement): string | null {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    if (!width || !height) {
      return null;
    }
    try {
      const px = NowPlayingService.ARTWORK_PX;
      const canvas = document.createElement('canvas');
      canvas.width = px;
      canvas.height = px;
      const context = canvas.getContext('2d');
      if (!context) {
        return null;
      }
      const side = Math.min(width, height);
      context.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, px, px);
      const data = canvas.toDataURL('image/jpeg', 0.85);
      return data.startsWith('data:image/jpeg') ? data : null;
    } catch {
      return null;
    }
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
