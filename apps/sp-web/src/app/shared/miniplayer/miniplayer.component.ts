import {
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouteReuseStrategy, Router } from '@angular/router';
import { PlayerService } from '../../core/player/player.service';
import { KeepAliveRouteStrategy } from '../../core/navigation/keep-alive-route.strategy';
import { PageFadeService } from '../../core/navigation/page-fade.service';
import { SharedVideoService } from '../../core/player/shared-video.service';

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
export class MiniplayerComponent implements OnDestroy {
  private static readonly PROGRESS_SAVE_INTERVAL_MS = 20_000;
  // Sizes iOS/Android/desktop commonly probe for when picking a "now playing"
  // artwork entry (the OS fetches and scales the same image whichever it picks).
  private static readonly ARTWORK_SIZES = ['96x96', '192x192', '256x256', '384x384', '512x512'];

  private readonly playerService = inject(PlayerService);
  private readonly sharedVideo = inject(SharedVideoService);
  private readonly pageFade = inject(PageFadeService);
  private readonly reuseStrategy = inject(RouteReuseStrategy);
  /** A swipe up on the miniplayer, towards its scene's page. */
  private swipe: {
    x: number;
    y: number;
    up: boolean | null;
    lifted: boolean;
    progress: number;
    dy: number;
    time: number;
    speed: number;
    target: DOMRect;
    distance: number;
  } | null = null;
  private swipeListeners: AbortController | null = null;

  // Its scene's page stays kept (asleep) while the miniplayer is open, so
  // going back up -- tap or swipe -- finds it as it was, at once.
  private readonly keepScenePage = effect(() => {
    const url = this.state() ? this.sceneUrl() : null;
    if (this.reuseStrategy instanceof KeepAliveRouteStrategy) {
      this.reuseStrategy.pin(url);
    }
  });
  private readonly router = inject(Router);
  private progressSaveInterval: ReturnType<typeof setInterval> | null = null;
  private listeners: AbortController | null = null;
  /** Start position set for this load (metadata can arrive again, e.g. AirPlay). */
  private positioned = false;
  private slot: HTMLElement | null = null;

  // Shown while there's a scene: the shared video goes in. Gone (closed, or
  // another player started): stop it, unless it was handed on.
  @ViewChild('videoSlot') private set videoSlot(slot: ElementRef<HTMLElement> | undefined) {
    this.slot = slot?.nativeElement ?? null;
    if (this.slot) {
      this.attachVideo();
    } else {
      this.detachVideo();
    }
  }

  // A different scene handed over while already open: same slot, new video.
  private readonly onSceneChange = effect(() => {
    this.state();
    untracked(() => {
      if (this.slot) {
        this.attachVideo();
      }
    });
  });

  /** The shared video, while the miniplayer has it. */
  private get video(): HTMLVideoElement | null {
    return this.sharedVideo.isOwner(this) ? this.sharedVideo.video : null;
  }

  protected readonly state = this.playerService.state;
  protected readonly paused = signal(false);
  /** Playing on an Apple TV (AirPlay): the scene's picture shows instead of the black video. */
  protected readonly wireless = signal(false);
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

  ngOnDestroy(): void {
    this.swipeListeners?.abort();
    this.detachVideo();
  }

  // Back to the scene's own page, its player carrying on from here (with
  // the same video: it waits in the page until that player takes it).
  protected openScenePage(): void {
    const link = this.playerService.details()?.detailsLink;
    const current = this.state();
    const video = this.video;
    if (!link || !current || !video) {
      return;
    }

    this.saveCurrentProgress();
    this.playerService.handBack(current.source.stashSceneId, video.currentTime);
    this.stopProgressSaveInterval();
    this.listeners?.abort();
    // It stays where it is, showing, then grows into the page's player.
    this.sharedVideo.park(this, video.getBoundingClientRect(), current.imageUrl);
    // The page on screen fades out under the video first.
    void this.pageFade.fadeOut().then(() =>
      this.router.navigate([...link.commands], {
        queryParams: { ...(link.queryParams ?? {}), autoplay: '1' },
      }),
    );
  }

  /** The scene page's URL (from its details link). */
  private sceneUrl(): string | null {
    const link = this.playerService.details()?.detailsLink;
    return link ? this.router.serializeUrl(this.router.createUrlTree([...link.commands])) : null;
  }

  // Swipe up on the miniplayer: the video lifts out and heads up to the
  // scene page's player, with that page (kept) revealed behind this one as
  // it fades; far enough, or a flick, and it opens; otherwise it settles back.
  protected onSwipeStart(event: TouchEvent): void {
    const touch = event.touches[0];
    if (!touch || event.touches.length !== 1 || !this.video) {
      return;
    }
    const height = this.video.getBoundingClientRect().top;
    this.swipe = {
      x: touch.clientX,
      y: touch.clientY,
      up: null,
      lifted: false,
      progress: 0,
      dy: 0,
      time: event.timeStamp,
      speed: 0,
      target: new DOMRect(0, 0, window.innerWidth, (window.innerWidth * 9) / 16),
      distance: Math.max(1, height),
    };
    this.swipeListeners?.abort();
    this.swipeListeners = new AbortController();
    const signal = this.swipeListeners.signal;
    document.addEventListener('touchmove', (e) => this.onSwipeMove(e), { passive: false, signal });
    document.addEventListener('touchend', () => this.onSwipeEnd(), { signal });
    document.addEventListener('touchcancel', () => this.onSwipeEnd(), { signal });
  }

  private onSwipeMove(event: TouchEvent): void {
    const swipe = this.swipe;
    const touch = event.touches[0];
    if (!swipe || !touch) {
      return;
    }
    const dx = touch.clientX - swipe.x;
    const dy = swipe.y - touch.clientY;
    if (swipe.up === null && Math.max(Math.abs(dx), Math.abs(dy)) > 10) {
      swipe.up = dy > 0 && dy > Math.abs(dx);
    }
    if (!swipe.up) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    swipe.speed = (dy - swipe.dy) / Math.max(1, event.timeStamp - swipe.time);
    swipe.dy = dy;
    swipe.time = event.timeStamp;
    if (!swipe.lifted) {
      const from = this.video?.getBoundingClientRect();
      if (!from || !this.sharedVideo.liftForDrag()) {
        this.swipe = null;
        return;
      }
      swipe.lifted = true;
      const url = this.sceneUrl();
      const page = url ? this.pageFade.revealPage(url) : null;
      const slot = page?.querySelector<HTMLElement>('.video-slot')?.getBoundingClientRect();
      if (slot && slot.width > 0) {
        swipe.target = slot;
      }
      swipe.distance = Math.max(1, from.top - swipe.target.top);
    }
    swipe.progress = Math.min(1, Math.max(0, dy / swipe.distance));
    this.sharedVideo.moveLiftedTo(swipe.target, swipe.progress);
    this.pageFade.setProgress(swipe.progress);
  }

  private onSwipeEnd(): void {
    const swipe = this.swipe;
    this.swipe = null;
    this.swipeListeners?.abort();
    this.swipeListeners = null;
    if (!swipe?.lifted) {
      return;
    }
    const open = swipe.progress > 0.35 || (swipe.speed > 0.5 && swipe.dy > 40);
    if (open) {
      this.goToScene();
    } else {
      this.sharedVideo.dropBack();
      this.pageFade.cancel();
    }
  }

  /** Opens the scene's page with the video already lifted: it flies the rest of the way there. */
  private goToScene(): void {
    const link = this.playerService.details()?.detailsLink;
    const current = this.state();
    const video = this.sharedVideo.video;
    if (!link || !current) {
      this.sharedVideo.dropBack();
      this.pageFade.cancel();
      return;
    }
    this.saveCurrentProgress();
    this.playerService.handBack(current.source.stashSceneId, video.currentTime);
    this.stopProgressSaveInterval();
    this.listeners?.abort();
    // Handed on where it is, for the scene page's player to take (closing
    // the miniplayer then can't stop it).
    this.sharedVideo.park(this, video.getBoundingClientRect(), current.imageUrl);
    void this.pageFade.fadeOut().then(() =>
      this.router.navigate([...link.commands], {
        queryParams: { ...(link.queryParams ?? {}), autoplay: '1' },
      }),
    );
  }

  protected togglePlayback(): void {
    const video = this.video;
    if (!video) {
      return;
    }

    if (video.paused) {
      video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }

  private attachVideo(): void {
    const current = this.state();
    if (!current || !this.slot) {
      return;
    }
    const carriedOn = this.sharedVideo.attach(
      this,
      this.slot,
      current.source.stashSceneId,
      current.source.streamUrl,
      { controls: false },
    );
    const video = this.sharedVideo.video;
    this.positioned = carriedOn;
    this.listeners?.abort();
    this.listeners = new AbortController();
    const signal = this.listeners.signal;
    video.addEventListener('loadedmetadata', () => this.onVideoLoadedMetadata(), { signal });
    video.addEventListener('play', () => this.onVideoPlay(), { signal });
    video.addEventListener('pause', () => this.onVideoPause(), { signal });
    video.addEventListener('timeupdate', () => this.onVideoTimeUpdate(), { signal });
    const updateWireless = () =>
      this.wireless.set(
        !!(video as HTMLVideoElement & { webkitCurrentPlaybackTargetIsWireless?: boolean })
          .webkitCurrentPlaybackTargetIsWireless,
      );
    video.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', updateWireless, {
      signal,
    });
    updateWireless();
    if (carriedOn) {
      // Handed over still playing: it just carries on.
      this.paused.set(video.paused);
      this.onVideoTimeUpdate();
      this.startedPlaying();
    }
  }

  private detachVideo(): void {
    this.listeners?.abort();
    this.listeners = null;
    this.stopProgressSaveInterval();
    this.sharedVideo.release(this);
  }

  protected onVideoLoadedMetadata(): void {
    const current = this.state();
    const video = this.video;
    if (!current || !video || this.positioned) {
      return;
    }
    this.positioned = true;
    this.progress.set(0);

    const resumeSeconds = current.source.resumeSeconds;
    if (resumeSeconds > 0 && resumeSeconds < video.duration) {
      video.currentTime = resumeSeconds;
    }

    video.play().catch(() => {
      // Autoplay can be blocked by the browser; the user can press play.
    });

    this.startedPlaying();
  }

  private startedPlaying(): void {
    const current = this.state();
    if (current) {
      this.updateMediaSession(current.title, current.imageUrl);
    }
    this.startProgressSaveInterval();
  }

  protected onVideoPlay(): void {
    this.paused.set(false);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = 'playing';
    }
  }

  protected onVideoTimeUpdate(): void {
    const video = this.video;
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
    this.detachVideo();
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
      this.video?.play().catch(() => undefined);
    });
    session.setActionHandler('pause', () => {
      this.video?.pause();
    });
    session.setActionHandler('seekto', (details) => {
      const video = this.video;
      if (video && typeof details.seekTime === 'number') {
        video.currentTime = details.seekTime;
      }
    });
    session.setActionHandler('seekbackward', (details) => {
      const video = this.video;
      if (video) {
        video.currentTime = Math.max(0, video.currentTime - (details.seekOffset ?? 10));
      }
    });
    session.setActionHandler('seekforward', (details) => {
      const video = this.video;
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
    const video = this.video;
    if (!current || !video) {
      return;
    }

    const duration = Number.isFinite(video.duration) ? video.duration : null;
    this.playerService.saveProgress(current.source.stashSceneId, video.currentTime, duration);
  }
}
