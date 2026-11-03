import { Injectable, inject, signal } from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { onShowingPage } from '../../core/navigation/page-fade.service';

const pathOf = (url: string) => url.split(/[?#]/)[0];

/**
 * Sound for scene previews. They play with sound, one at a time (whichever
 * started last), and never over a scene actually playing. Muting one mutes the
 * rest, until a new page.
 *
 * Browsers can refuse to start a video with sound before a tap (phones most of
 * all): it then plays muted, and its button says so; tapping that turns the
 * sound on. Phones allow sound per video element, once tapped, so such an
 * element is kept for the next preview.
 *
 * A page left is kept alive, out of sight: nothing on it plays, let alone with
 * sound -- not what was playing as it was left, nor anything due to start.
 */
@Injectable({ providedIn: 'root' })
export class PreviewAudioService {
  /** The viewer's choice, on this page. */
  readonly muted = signal(false);

  private readonly router = inject(Router);
  private path = pathOf(this.router.url);
  /** The preview with sound right now. */
  private audible: HTMLVideoElement | null = null;
  /** Elements allowed sound by a tap, not in use. */
  private readonly allowed: HTMLVideoElement[] = [];
  private readonly tapped = new WeakSet<HTMLVideoElement>();
  /** Previews started and not yet done with. */
  private readonly playing = new Set<HTMLVideoElement>();

  constructor() {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        // A page left stays alive: nothing from it should carry on being heard.
        this.silence();
      } else if (event instanceof NavigationEnd) {
        this.stopOffPage();
        const path = pathOf(event.urlAfterRedirects);
        if (path !== this.path) {
          this.path = path;
          this.muted.set(false);
        }
      }
    });
    if (typeof document !== 'undefined') {
      // Capture: 'play' doesn't bubble. A real scene starting takes over.
      document.addEventListener(
        'play',
        (event) => {
          const video = event.target;
          if (video instanceof HTMLVideoElement && !video.classList.contains('hover-preview')) {
            this.silence();
          }
        },
        { capture: true },
      );
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.silence();
        }
      });
    }
  }

  /** Starts a preview, with sound if it can have it. */
  play(video: HTMLVideoElement): Promise<void> {
    if (!onShowingPage(video)) {
      // Due to start, but its page has gone meanwhile.
      video.muted = true;
      return Promise.resolve();
    }
    this.playing.add(video);
    this.applySound(video);
    const playing = (video.play() as Promise<void> | undefined) ?? Promise.resolve();
    return playing.catch((error: { name?: string }) => {
      if (error?.name === 'NotAllowedError' && !video.muted) {
        // Sound refused: muted instead, until it's tapped.
        video.muted = true;
        return (video.play() as Promise<void> | undefined) ?? undefined;
      }
      throw error;
    });
  }

  /** Its mute button tapped (which also lets a phone play it with sound). */
  toggle(video: HTMLVideoElement): void {
    if (video.muted) {
      this.muted.set(false);
      this.tapped.add(video);
      this.giveSoundTo(video);
    } else {
      this.muted.set(true);
      this.silence();
    }
  }

  /** A preview's video for a new preview: one allowed sound, if there is one. */
  takeVideo(): HTMLVideoElement {
    return this.allowed.pop() ?? document.createElement('video');
  }

  /** A preview's done with its video. */
  release(video: HTMLVideoElement): void {
    this.playing.delete(video);
    if (this.audible === video) {
      this.audible = null;
    }
    if (this.tapped.has(video)) {
      this.allowed.push(video);
    }
  }

  private stopOffPage(): void {
    for (const video of this.playing) {
      if (!onShowingPage(video)) {
        video.muted = true;
        video.pause();
        this.playing.delete(video);
        if (this.audible === video) {
          this.audible = null;
        }
      }
    }
  }

  private applySound(video: HTMLVideoElement): void {
    if (this.muted() || this.sceneIsPlaying()) {
      video.muted = true;
    } else {
      this.giveSoundTo(video);
    }
  }

  private giveSoundTo(video: HTMLVideoElement): void {
    if (this.audible && this.audible !== video) {
      this.audible.muted = true;
    }
    this.audible = video;
    video.muted = false;
  }

  private silence(): void {
    if (this.audible) {
      this.audible.muted = true;
      this.audible = null;
    }
  }

  private sceneIsPlaying(): boolean {
    return Array.from(document.querySelectorAll('video')).some(
      (video) => !video.classList.contains('hover-preview') && !video.paused && !video.ended,
    );
  }
}
