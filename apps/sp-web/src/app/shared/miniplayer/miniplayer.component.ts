import { Component, ElementRef, HostListener, ViewChild, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { PlayerService } from '../../core/player/player.service';

/**
 * YouTube's miniplayer: the video from a scene page carries on here after
 * leaving the page. Tap it to go back to the page (its player picks up from
 * the same moment); play/pause and close from the bar; Escape closes it.
 */
@Component({
  selector: 'app-miniplayer',
  templateUrl: './miniplayer.component.html',
  styleUrl: './miniplayer.component.scss',
})
export class MiniplayerComponent {
  private static readonly PROGRESS_SAVE_INTERVAL_MS = 20_000;
  // Sizes iOS/Android/desktop commonly probe for when picking a "now playing"
  // artwork entry (the OS fetches and scales the same image whichever it picks).
  private static readonly ARTWORK_SIZES = ['96x96', '192x192', '256x256', '384x384', '512x512'];

  private readonly playerService = inject(PlayerService);
  private readonly router = inject(Router);
  private progressSaveInterval: ReturnType<typeof setInterval> | null = null;

  @ViewChild('videoEl') private videoElRef?: ElementRef<HTMLVideoElement>;

  protected readonly state = this.playerService.state;
  protected readonly paused = signal(false);
  /** Playback position 0..1, drawn as the red progress line. */
  protected readonly progress = signal(0);
  protected readonly subtitle = computed(() => {
    const details = this.playerService.details();
    return [details?.studio, details?.releaseDate].filter(Boolean).join(' · ');
  });

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.state()) {
      this.closePlayer();
    }
  }

  // Back to the scene's own page, its player carrying on from here.
  protected openScenePage(): void {
    const link = this.playerService.details()?.detailsLink;
    const current = this.state();
    const video = this.videoElRef?.nativeElement;
    if (!link || !current || !video) {
      return;
    }

    this.saveCurrentProgress();
    this.playerService.handBack(current.source.stashSceneId, video.currentTime);
    void this.router.navigate([...link.commands], {
      queryParams: { ...(link.queryParams ?? {}), autoplay: '1' },
    });
  }

  protected togglePlayback(): void {
    const video = this.videoElRef?.nativeElement;
    if (!video) {
      return;
    }

    if (video.paused) {
      video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }

  protected onVideoLoadedMetadata(): void {
    this.progress.set(0);
    const current = this.state();
    const video = this.videoElRef?.nativeElement;
    if (!current || !video) {
      return;
    }

    const resumeSeconds = current.source.resumeSeconds;
    if (resumeSeconds > 0 && resumeSeconds < video.duration) {
      video.currentTime = resumeSeconds;
    }

    video.play().catch(() => {
      // Autoplay can be blocked by the browser; the user can press play.
    });

    this.updateMediaSession(current.title, current.imageUrl);
    this.startProgressSaveInterval();
  }

  protected onVideoPlay(): void {
    this.paused.set(false);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing';
    }
  }

  protected onVideoTimeUpdate(): void {
    const video = this.videoElRef?.nativeElement;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      return;
    }

    this.progress.set(Math.min(1, Math.max(0, video.currentTime / video.duration)));
  }

  protected onVideoPause(): void {
    this.paused.set(true);
    this.saveCurrentProgress();
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'paused';
    }
  }

  protected closePlayer(): void {
    this.saveCurrentProgress();
    this.stopProgressSaveInterval();
    this.playerService.close();
    this.clearMediaSession();
  }

  // The OS "now playing" surface (lock screen, Control Center, AirPlay,
  // Android notification, media keys): the scene's title and picture, with
  // play/pause/seek handlers -- WebKit only shows custom metadata once those
  // are registered.
  private updateMediaSession(title: string, imageUrl: string | null): void {
    if (!('mediaSession' in navigator)) {
      return;
    }

    const session = navigator.mediaSession;
    session.metadata = new MediaMetadata({
      title,
      artwork: imageUrl
        ? MiniplayerComponent.ARTWORK_SIZES.map((sizes) => ({ src: imageUrl, sizes }))
        : [],
    });
    session.playbackState = 'playing';
    session.setActionHandler('play', () => {
      this.videoElRef?.nativeElement.play().catch(() => undefined);
    });
    session.setActionHandler('pause', () => {
      this.videoElRef?.nativeElement.pause();
    });
    session.setActionHandler('seekto', (details) => {
      const video = this.videoElRef?.nativeElement;
      if (video && typeof details.seekTime === 'number') {
        video.currentTime = details.seekTime;
      }
    });
    session.setActionHandler('seekbackward', (details) => {
      const video = this.videoElRef?.nativeElement;
      if (video) {
        video.currentTime = Math.max(0, video.currentTime - (details.seekOffset ?? 10));
      }
    });
    session.setActionHandler('seekforward', (details) => {
      const video = this.videoElRef?.nativeElement;
      if (video) {
        video.currentTime = Math.min(
          video.duration || Infinity,
          video.currentTime + (details.seekOffset ?? 10),
        );
      }
    });
  }

  private clearMediaSession(): void {
    if (!('mediaSession' in navigator)) {
      return;
    }

    const session = navigator.mediaSession;
    session.metadata = null;
    session.playbackState = 'none';
    for (const action of ['play', 'pause', 'seekto', 'seekbackward', 'seekforward'] as const) {
      session.setActionHandler(action, null);
    }
  }

  private startProgressSaveInterval(): void {
    this.stopProgressSaveInterval();
    this.progressSaveInterval = setInterval(
      () => this.saveCurrentProgress(),
      MiniplayerComponent.PROGRESS_SAVE_INTERVAL_MS,
    );
  }

  private stopProgressSaveInterval(): void {
    if (this.progressSaveInterval !== null) {
      clearInterval(this.progressSaveInterval);
      this.progressSaveInterval = null;
    }
  }

  private saveCurrentProgress(): void {
    const current = this.state();
    const video = this.videoElRef?.nativeElement;
    if (!current || !video) {
      return;
    }

    const duration = Number.isFinite(video.duration) ? video.duration : null;
    this.playerService.saveProgress(current.source.stashSceneId, video.currentTime, duration);
  }
}
