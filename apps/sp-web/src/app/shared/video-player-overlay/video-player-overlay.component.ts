import { DOCUMENT } from '@angular/common';
import {
  Component,
  ElementRef,
  HostListener,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { ProgressSpinner } from 'primeng/progressspinner';
import { catchError, of, Subscription } from 'rxjs';
import { LibraryService } from '../../core/api/library.service';
import { libraryUpNextItem } from '../../core/player/player-details.util';
import { PlayerDetails, PlayerService } from '../../core/player/player.service';
import { UpNextItem, UpNextListComponent } from '../up-next-list/up-next-list.component';

import { LogoContrastDirective } from '../logo-contrast/logo-contrast.directive';
@Component({
  selector: 'app-video-player-overlay',
  imports: [LogoContrastDirective, ProgressSpinner, UpNextListComponent],
  templateUrl: './video-player-overlay.component.html',
  styleUrl: './video-player-overlay.component.scss',
})
export class VideoPlayerOverlayComponent {
  private readonly playerService = inject(PlayerService);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly libraryService = inject(LibraryService);
  private recommendedSubscription: Subscription | null = null;
  private recommendedFor: string | null = null;

  // Swipe the video down this far (px) to drop into the miniplayer.
  private static readonly MINIMIZE_DRAG_PX = 110;
  private dragStartY: number | null = null;

  private static readonly PROGRESS_SAVE_INTERVAL_MS = 20_000;
  private progressSaveInterval: ReturnType<typeof setInterval> | null = null;

  @ViewChild('videoEl') private videoElRef?: ElementRef<HTMLVideoElement>;

  protected readonly state = this.playerService.state;
  protected readonly queue = this.playerService.queue;
  protected readonly hasNext = this.playerService.hasNext;
  protected readonly hasPrevious = this.playerService.hasPrevious;
  protected readonly details = this.playerService.details;
  protected readonly mini = computed(() => this.playerService.mode() === 'mini');
  protected readonly dragOffset = signal(0);
  protected readonly paused = signal(false);
  /** Playback position 0..1, drawn as the miniplayer's red progress line. */
  protected readonly progress = signal(0);
  protected readonly descriptionExpanded = signal(false);
  // Up next for a single scene (a series shows its own parts instead).
  protected readonly recommended = signal<UpNextItem[]>([]);
  protected readonly subtitle = computed(() => {
    const details = this.details();
    return [details?.studio, details?.releaseDate].filter(Boolean).join(' · ');
  });

  constructor() {
    // The full watch panel covers the page: stop the page behind it scrolling.
    effect(() => {
      const locked = !!this.state() && !this.mini();
      this.document.body.style.overflow = locked ? 'hidden' : '';
    });
    // A new scene starts with its description collapsed.
    effect(() => {
      this.state();
      this.descriptionExpanded.set(false);
    });
    // Recommendations for whatever single scene is playing.
    effect(() => {
      const state = this.state();
      const sceneId = state?.status === 'ready' && !this.queue() ? state.source.stashSceneId : null;
      if (sceneId !== this.recommendedFor) {
        this.loadRecommended(sceneId);
      }
    });
  }

  // Escape steps down one level: watch panel -> miniplayer -> closed.
  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (!this.state()) {
      return;
    }

    if (this.mini()) {
      this.closePlayer();
    } else {
      this.minimize();
    }
  }

  // An Up next pick opens that scene's page; this video carries on mini.
  protected onRecommendedClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).closest('a')) {
      this.minimize();
    }
  }

  private loadRecommended(sceneId: string | null): void {
    this.recommendedFor = sceneId;
    this.recommendedSubscription?.unsubscribe();
    this.recommended.set([]);
    if (!sceneId) {
      return;
    }

    this.recommendedSubscription = this.libraryService
      .getRecommended(sceneId, 12)
      .pipe(catchError(() => of({ items: [] })))
      .subscribe((response) =>
        this.recommended.set(response.items.map((item) => libraryUpNextItem(item))),
      );
  }

  protected minimize(): void {
    this.dragOffset.set(0);
    this.playerService.minimize();
  }

  // Tapping the miniplayer: back to the scene's own page, its player carrying
  // on from here (never a separate watch panel).
  protected openScenePage(): void {
    const link = this.details()?.detailsLink;
    const current = this.state();
    const video = this.videoElRef?.nativeElement;
    if (!link || current?.status !== 'ready' || !video) {
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

  protected toggleDescription(): void {
    this.descriptionExpanded.update((value) => !value);
  }

  protected playQueueIndex(index: number): void {
    this.saveCurrentProgress();
    this.playerService.playQueueIndex(index);
  }

  // Opens the scene's page under the player, YouTube-style: the video keeps
  // playing in the miniplayer.
  protected openDetails(link: NonNullable<PlayerDetails['detailsLink']>): void {
    this.minimize();
    void this.router.navigate([...link.commands], { queryParams: link.queryParams ?? {} });
  }

  // Swipe-down-to-minimize on the video (touch only; the native controls
  // still get taps, only a clear downward drag is taken over).
  protected onDragStart(event: TouchEvent): void {
    if (this.mini() || event.touches.length !== 1) {
      return;
    }

    this.dragStartY = event.touches[0].clientY;
  }

  protected onDragMove(event: TouchEvent): void {
    if (this.dragStartY === null) {
      return;
    }

    this.dragOffset.set(Math.max(0, event.touches[0].clientY - this.dragStartY));
  }

  protected onDragEnd(): void {
    if (this.dragStartY === null) {
      return;
    }

    this.dragStartY = null;
    if (this.dragOffset() > VideoPlayerOverlayComponent.MINIMIZE_DRAG_PX) {
      this.minimize();
    }
    this.dragOffset.set(0);
  }

  protected onVideoLoadedMetadata(): void {
    this.progress.set(0);
    const current = this.state();
    const video = this.videoElRef?.nativeElement;
    if (current?.status !== 'ready' || !video) {
      return;
    }

    const resumeSeconds = current.source.resumeSeconds;
    if (resumeSeconds > 0 && resumeSeconds < video.duration) {
      video.currentTime = resumeSeconds;
    }

    video.play().catch(() => {
      // Autoplay can be blocked by the browser; the user can press play.
    });

    this.updateMediaSessionMetadata(current.title, current.imageUrl);
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

  // Series playback: when a part finishes, go straight on to the next one.
  // (The 'pause' that precedes 'ended' has already saved its progress.)
  protected onVideoEnded(): void {
    this.playerService.next();
  }

  protected playNext(): void {
    this.saveCurrentProgress();
    this.playerService.next();
  }

  protected playPrevious(): void {
    this.saveCurrentProgress();
    this.playerService.previous();
  }

  protected closePlayer(): void {
    this.saveCurrentProgress();
    this.stopProgressSaveInterval();
    this.playerService.close();
    this.clearMediaSessionMetadata();
  }

  // Sizes iOS/Android/desktop commonly probe for when picking a "now
  // playing" artwork entry. The real thumbnail is rarely any of these
  // exact dimensions (scene screenshots are landscape, arbitrary sizes),
  // but declaring the same URL under several common square hints is the
  // standard workaround -- the OS still just fetches and scales the image,
  // this only affects which array entry it decides to request.
  private static readonly ARTWORK_SIZES = ['96x96', '192x192', '256x256', '384x384', '512x512'];

  // Drives the OS/browser "now playing" surface (iOS Control Center/lock
  // screen, AirPlay's now-playing overlay, Android notification, desktop
  // media keys, etc.) so it shows the actual scene title and thumbnail
  // instead of just the page title.
  private updateMediaSessionMetadata(title: string, imageUrl: string | null): void {
    if (!('mediaSession' in navigator)) {
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artwork: imageUrl
        ? VideoPlayerOverlayComponent.ARTWORK_SIZES.map((sizes) => ({ src: imageUrl, sizes }))
        : [],
    });
    navigator.mediaSession.playbackState = 'playing';
    this.registerMediaSessionActionHandlers();
  }

  // WebKit/iOS only treats a page as a fully integrated media session --
  // showing our custom title/artwork on the lock screen, Control Center,
  // and AirPlay's now-playing overlay -- once play/pause/seek handlers are
  // registered. Without these it can fall back to a generic identity (the
  // browser engine's own name) instead of the metadata set above.
  private registerMediaSessionActionHandlers(): void {
    const session = navigator.mediaSession;

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
    // Lock screen / headphone skip buttons step through a series.
    session.setActionHandler('nexttrack', this.hasNext() ? () => this.playNext() : null);
    session.setActionHandler('previoustrack', this.hasPrevious() ? () => this.playPrevious() : null);
  }

  private clearMediaSessionMetadata(): void {
    if (!('mediaSession' in navigator)) {
      return;
    }

    const session = navigator.mediaSession;
    session.metadata = null;
    session.playbackState = 'none';
    session.setActionHandler('play', null);
    session.setActionHandler('pause', null);
    session.setActionHandler('seekto', null);
    session.setActionHandler('seekbackward', null);
    session.setActionHandler('seekforward', null);
    session.setActionHandler('nexttrack', null);
    session.setActionHandler('previoustrack', null);
  }

  private startProgressSaveInterval(): void {
    this.stopProgressSaveInterval();
    this.progressSaveInterval = setInterval(() => {
      this.saveCurrentProgress();
    }, VideoPlayerOverlayComponent.PROGRESS_SAVE_INTERVAL_MS);
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
    if (current?.status !== 'ready' || !video) {
      return;
    }

    const duration = Number.isFinite(video.duration) ? video.duration : null;
    this.playerService.saveProgress(
      current.source.stashSceneId,
      video.currentTime,
      duration,
    );
  }
}
