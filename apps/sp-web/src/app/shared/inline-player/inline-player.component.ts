import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Observable, Subscription } from 'rxjs';
import { ScenePlaybackSource } from '../../core/api/discover.types';
import { PageFadeService, onShowingPage } from '../../core/navigation/page-fade.service';
import { PlayerDetails, PlayerService } from '../../core/player/player.service';
import { SharedVideoService } from '../../core/player/shared-video.service';
import { VideoQualityService } from '../../core/player/video-quality.service';

// The watch-page player. A thumbnail with a play button that turns into the
// video in place. Leaving the page while it plays hands the video to the
// global miniplayer at the same moment. Swiping down on the playing video
// lifts it out of the page to follow the finger, and far enough asks the
// page to go (`minimize`), the video carrying on into the miniplayer.
//
// Pages are kept alive when left (KeepAliveRouteStrategy): asleep, this
// player has handed its video on; woken (back on the page), it takes it
// back from the miniplayer if that's still playing it.
@Component({
  selector: 'app-inline-player',
  imports: [ProgressSpinner],
  templateUrl: './inline-player.component.html',
  styleUrl: './inline-player.component.scss',
})
export class InlinePlayerComponent implements OnChanges, OnDestroy {
  private static readonly PROGRESS_SAVE_INTERVAL_MS = 20_000;
  // A saved position this close to the end counts as finished: start over.
  private static readonly RESUME_END_MARGIN_S = 10;
  /** How far down a swipe must go to minimise... */
  private static readonly MINIMIZE_DRAG_PX = 110;
  /** ...or a flick this fast (px/ms) and this far. */
  private static readonly MINIMIZE_FLICK_SPEED = 0.5;
  private static readonly MINIMIZE_FLICK_PX = 40;
  /** This long after it starts playing, the page you came from is readied behind. */
  private static readonly PREPARE_BEHIND_MS = 1500;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly playerService = inject(PlayerService);
  private readonly sharedVideo = inject(SharedVideoService);
  private readonly pageFade = inject(PageFadeService);
  /** Its page was left (kept alive, out of the document). */
  private asleep = false;
  /** Asleep, its video went on to the miniplayer. */
  private handedOff = false;
  private slotElement: HTMLElement | null = null;
  private dragListeners: AbortController | null = null;
  /**
   * Where the video was on screen as navigation away began (the page is
   * gone by the time this player is destroyed): the miniplayer's video
   * flies down from there.
   */
  private leavingRect: DOMRect | null = null;
  private readonly navigationWatch = inject(Router).events.subscribe((event) => {
    if (event instanceof NavigationStart) {
      this.leavingRect = this.video?.getBoundingClientRect() ?? null;
    } else if (event instanceof NavigationEnd) {
      // Its page left (kept, asleep) or back on screen.
      if (!onShowingPage(this.host) && !this.asleep) {
        this.sleep();
      } else if (onShowingPage(this.host) && this.asleep) {
        this.wake();
      }
    }
  });
  private sourceSubscription: Subscription | null = null;
  /** The quality changed (by hand): a playing scene switches, from where it is. */
  private readonly qualityWatch = inject(VideoQualityService).changes.subscribe(() =>
    this.switchQuality(),
  );
  private progressInterval: ReturnType<typeof setInterval> | null = null;
  private prepareTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners: AbortController | null = null;
  /** Start position set for this load (metadata can arrive again, e.g. AirPlay). */
  private positioned = false;

  // The slot appears once the source is ready: the shared video goes in.
  @ViewChild('videoSlot') private set videoSlot(slot: ElementRef<HTMLElement> | undefined) {
    if (slot) {
      this.attachVideo(slot.nativeElement);
    }
  }

  /** The shared video, while this player has it. */
  private get video(): HTMLVideoElement | null {
    return this.sharedVideo.isOwner(this) ? this.sharedVideo.video : null;
  }

  @Input({ required: true }) title = '';
  @Input() posterUrl: string | null = null;
  @Input() durationSeconds: number | null = null;
  /** Stash scene id; preferred when set. */
  @Input() localSceneId: string | null = null;
  /** Catalog scene id (+ Stash copy), when there's no local id. */
  @Input() catalogStashId: string | null = null;
  @Input() copyId: string | null = null;
  @Input() details: PlayerDetails | null = null;
  /** Start playing as soon as the scene is known (e.g. autoplay of Up next). */
  @Input() autoplay = false;
  /** False when the scene can't be played (not in Stash): poster only. */
  @Input() playable = true;

  @Output() ended = new EventEmitter<void>();
  /** Swiped down: leave the page (playing, the video carries on in the miniplayer; paused, it's closed). */
  @Output() minimize = new EventEmitter<void>();

  protected readonly status = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  protected readonly source = signal<ScenePlaybackSource | null>(null);
  protected readonly dragOffset = signal(0);
  private drag: {
    x: number;
    y: number;
    down: boolean | null;
    /** Playing when the drag began: off to the miniplayer (else: closing). */
    playing: boolean;
    /** The video lifted out of the page, following the finger. */
    lifted: boolean;
    dy: number;
    time: number;
    /** Downward speed lately (px/ms), for a flick. */
    speed: number;
  } | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    const sceneChanged = changes['localSceneId'] || changes['catalogStashId'] || changes['copyId'];
    if (sceneChanged && !sceneChanged.firstChange) {
      this.stop();
    }

    if ((sceneChanged || changes['autoplay']) && this.autoplay && this.status() === 'idle') {
      this.start();
    }
  }

  ngOnDestroy(): void {
    if (!this.handOffIfPlaying()) {
      this.saveProgress();
      this.sharedVideo.release(this);
    }
    this.navigationWatch.unsubscribe();
    this.qualityWatch.unsubscribe();
    this.cleanup();
  }

  /**
   * Leaving while it plays: the miniplayer takes the same video (it waits on
   * screen meanwhile), so it doesn't stop, here or on an Apple TV.
   */
  private handOffIfPlaying(): boolean {
    const video = this.video;
    const source = this.source();
    if (!video || !source || video.paused || video.ended) {
      return false;
    }
    this.playerService.saveProgress(
      source.stashSceneId,
      video.currentTime,
      this.videoDuration(video),
    );
    this.listeners?.abort();
    this.sharedVideo.park(this, this.leavingRect, this.posterUrl);
    this.playerService.handOff({
      title: this.title,
      imageUrl: this.posterUrl,
      source: { ...source, resumeSeconds: video.currentTime },
      details: this.details,
    });
    return true;
  }

  private sleep(): void {
    this.asleep = true;
    this.handedOff = this.handOffIfPlaying();
    this.stopInterval();
    if (!this.handedOff) {
      // Not playing: stopped, and the poster for when it's back.
      this.saveProgress();
      this.sharedVideo.release(this);
      this.listeners?.abort();
      this.source.set(null);
      this.status.set('idle');
    }
  }

  private wake(): void {
    this.asleep = false;
    const source = this.source();
    const slot = this.slotElement;
    // The miniplayer still has it (playing, or paused there).
    const takeBack =
      this.handedOff && !!source && !!slot && this.sharedVideo.hasScene(source.stashSceneId);
    this.handedOff = false;
    if (takeBack && source && slot) {
      // Still in the miniplayer: it comes back (flying up) here.
      this.attachVideo(slot);
      this.playerService.close();
      return;
    }
    if (!this.sharedVideo.isOwner(this)) {
      this.listeners?.abort();
      this.source.set(null);
      this.status.set('idle');
      if (this.autoplay) {
        this.start();
      }
    }
  }

  /** The page's own Play button: start, or carry on if already loaded. */
  play(): void {
    const video = this.video;
    if (this.status() === 'ready' && video) {
      void video.play().catch(() => undefined);
      return;
    }

    this.start();
  }

  // Swipe down on the playing video (touch only; taps and sideways drags
  // still reach the native controls).
  protected onDragStart(event: TouchEvent): void {
    const video = this.video;
    const touch = event.touches[0];
    // Playing: a swipe down goes to the miniplayer. Paused: it closes.
    this.drag =
      video && video.getAttribute('src') && !video.ended && touch && event.touches.length === 1
        ? {
            x: touch.clientX,
            y: touch.clientY,
            down: null,
            playing: !video.paused,
            lifted: false,
            dy: 0,
            time: event.timeStamp,
            speed: 0,
          }
        : null;
    if (this.drag) {
      // Followed on the document: once lifted, the video (where the touch
      // began, and where its events keep going) is no longer in this player.
      this.dragListeners?.abort();
      this.dragListeners = new AbortController();
      const signal = this.dragListeners.signal;
      document.addEventListener('touchmove', (e) => this.onDragMove(e), { passive: false, signal });
      document.addEventListener('touchend', () => this.onDragEnd(), { signal });
      document.addEventListener('touchcancel', () => this.onDragEnd(), { signal });
    }
  }

  /**
   * A swipe down on the player is claimed from its first move: left to the
   * browser even briefly, Safari starts bouncing the whole page with the
   * finger (a black gap opening above it) and won't give the swipe back.
   * Bound on the player itself, so Safari knows from the touch's start that
   * its moves may be taken (a listener added once it's begun can be too late).
   */
  protected claimSwipe(event: TouchEvent): void {
    const drag = this.drag;
    const touch = event.touches[0];
    if (!drag || !touch || drag.down === false || !event.cancelable) {
      return;
    }
    const dx = touch.clientX - drag.x;
    const dy = touch.clientY - drag.y;
    if (drag.down || (dy > 0 && dy >= Math.abs(dx))) {
      event.preventDefault();
    }
  }

  protected onDragMove(event: TouchEvent): void {
    const drag = this.drag;
    const touch = event.touches[0];
    if (!drag || !touch) {
      return;
    }
    const dx = touch.clientX - drag.x;
    const dy = touch.clientY - drag.y;
    // Decide once: a mostly downward drag minimises, anything else is left alone.
    if (drag.down === null && Math.max(Math.abs(dx), Math.abs(dy)) > 10) {
      drag.down = dy > 0 && dy > Math.abs(dx);
    }
    if (drag.down) {
      if (event.cancelable) {
        event.preventDefault();
      }
      const elapsed = Math.max(1, event.timeStamp - drag.time);
      drag.speed = (dy - drag.dy) / elapsed;
      drag.dy = dy;
      drag.time = event.timeStamp;
      // The video comes out of the page, in front of everything, and
      // follows the finger: towards the miniplayer if playing, or straight
      // down, fading, if paused (closing). The page fades behind it.
      if (!drag.lifted && this.sharedVideo.liftForDrag()) {
        drag.lifted = true;
        // The page you came from, behind this one, revealed as it fades
        // (once the video's moving).
        this.pageFade.revealBehindSoon(() => this.drag === drag);
      }
      if (drag.lifted) {
        if (drag.playing) {
          this.sharedVideo.moveLifted(dy);
        } else {
          this.sharedVideo.moveLiftedDown(dy);
        }
        this.pageFade.setProgress(dy / (InlinePlayerComponent.MINIMIZE_DRAG_PX * 3));
      } else {
        this.dragOffset.set(Math.max(0, dy));
      }
    }
  }

  protected onDragEnd(): void {
    const drag = this.drag;
    this.drag = null;
    this.dragListeners?.abort();
    this.dragListeners = null;
    this.dragOffset.set(0);
    if (!drag?.down) {
      return;
    }
    const minimise =
      drag.dy > InlinePlayerComponent.MINIMIZE_DRAG_PX ||
      (drag.speed > InlinePlayerComponent.MINIMIZE_FLICK_SPEED &&
        drag.dy > InlinePlayerComponent.MINIMIZE_FLICK_PX);
    if (minimise && drag.playing) {
      // Leaves the page; the video carries on from where the finger left it.
      this.minimize.emit();
    } else if (minimise) {
      // Paused: closes. The video fades away, then the page goes (back).
      void this.sharedVideo.dismissLifted().then(() => this.minimize.emit());
    } else if (drag.lifted) {
      this.sharedVideo.dropBack();
      this.pageFade.cancel();
    }
  }

  /** Reloads this player's scene at the quality now chosen, carrying on from where it is. */
  private switchQuality(): void {
    const video = this.video;
    const slot = this.slotElement;
    const request = this.resolveSource();
    if (!video || !slot || !request || this.status() !== 'ready' || this.asleep) {
      return;
    }
    const at = video.currentTime;
    const playing = !video.paused;
    this.sourceSubscription?.unsubscribe();
    this.sourceSubscription = request.subscribe((source) => {
      if (!this.sharedVideo.isOwner(this)) {
        return;
      }
      this.source.set({ ...source, resumeSeconds: at });
      this.attachVideo(slot);
      if (!playing) {
        // Paused: stays paused, at the same moment.
        this.sharedVideo.video.addEventListener('playing', () => this.sharedVideo.video.pause(), {
          once: true,
        });
      }
    });
  }

  protected start(): void {
    if (!this.playable || this.status() === 'loading') {
      return;
    }

    const request = this.resolveSource();
    if (!request) {
      return;
    }

    // One video at a time: an open watch panel/miniplayer gives way.
    this.playerService.close();
    this.status.set('loading');
    this.sourceSubscription?.unsubscribe();
    this.sourceSubscription = request.subscribe({
      next: (source) => {
        this.source.set(source);
        this.status.set('ready');
      },
      error: () => this.status.set('error'),
    });
  }

  private attachVideo(slot: HTMLElement): void {
    const source = this.source();
    if (!source) {
      return;
    }
    this.slotElement = slot;
    const carriedOn = this.sharedVideo.attach(this, slot, source.stashSceneId, source.streamUrl, {
      controls: true,
      poster: this.posterUrl,
    });
    const video = this.sharedVideo.video;
    this.positioned = carriedOn;
    this.listeners?.abort();
    this.listeners = new AbortController();
    const signal = this.listeners.signal;
    video.addEventListener('loadedmetadata', () => this.onLoadedMetadata(), { signal });
    video.addEventListener('pause', () => this.onPause(), { signal });
    video.addEventListener('ended', () => this.onEnded(), { signal });
    if (carriedOn) {
      // Back from the miniplayer with the same video: it just carries on.
      this.playerService.takeHandBack(source.stashSceneId);
      if (video.paused) {
        video.play().catch(() => undefined);
      }
      this.startedPlaying();
    }
  }

  protected onLoadedMetadata(): void {
    const video = this.video;
    const source = this.source();
    if (!video || !source || this.positioned) {
      return;
    }
    this.positioned = true;

    // Back from the miniplayer: carry on exactly where it was.
    const resume = this.playerService.takeHandBack(source.stashSceneId) ?? source.resumeSeconds;
    if (resume > 0 && resume < video.duration - InlinePlayerComponent.RESUME_END_MARGIN_S) {
      video.currentTime = resume;
    }
    video.play().catch(() => {
      // Autoplay can be blocked; the native controls are there to press play.
    });
    this.startedPlaying();
  }

  private startedPlaying(): void {
    this.readyPageBehind();
    this.updateMediaSession();
    this.stopInterval();
    this.progressInterval = setInterval(
      () => this.saveProgress(),
      InlinePlayerComponent.PROGRESS_SAVE_INTERVAL_MS,
    );
  }

  /**
   * Readies the page you came from behind this one (unseen), a moment after
   * it starts playing, so a swipe down needn't wait for it to be put back.
   */
  private readyPageBehind(): void {
    if (this.prepareTimer) {
      clearTimeout(this.prepareTimer);
    }
    this.prepareTimer = setTimeout(() => {
      this.prepareTimer = null;
      if (this.sharedVideo.isOwner(this) && onShowingPage(this.host) && !this.drag) {
        this.pageFade.prepareBehind();
      }
    }, InlinePlayerComponent.PREPARE_BEHIND_MS);
  }

  protected onPause(): void {
    this.saveProgress();
  }

  protected onEnded(): void {
    this.saveProgress();
    this.ended.emit();
  }

  protected durationLabel(): string | null {
    const seconds = this.durationSeconds ?? 0;
    if (seconds <= 0) {
      return null;
    }

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = String(Math.floor(seconds % 60)).padStart(2, '0');
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
      : `${minutes}:${rest}`;
  }

  private resolveSource(): Observable<ScenePlaybackSource> | null {
    if (this.localSceneId) {
      return this.playerService.resolveLocalSource(this.localSceneId);
    }

    if (this.catalogStashId) {
      return this.playerService.resolveCatalogSource(this.catalogStashId, this.copyId ?? undefined);
    }

    return null;
  }

  private stop(): void {
    this.saveProgress();
    this.sharedVideo.release(this);
    this.cleanup();
    this.source.set(null);
    this.status.set('idle');
  }

  private cleanup(): void {
    if (this.prepareTimer) {
      clearTimeout(this.prepareTimer);
      this.prepareTimer = null;
    }
    this.dragListeners?.abort();
    this.listeners?.abort();
    this.listeners = null;
    this.sourceSubscription?.unsubscribe();
    this.sourceSubscription = null;
    this.stopInterval();
  }

  private stopInterval(): void {
    if (this.progressInterval !== null) {
      clearInterval(this.progressInterval);
      this.progressInterval = null;
    }
  }

  private saveProgress(): void {
    const video = this.video;
    const source = this.source();
    if (!video || !source || video.currentTime <= 0) {
      return;
    }

    this.playerService.saveProgress(
      source.stashSceneId,
      video.currentTime,
      this.videoDuration(video),
    );
  }

  private videoDuration(video: HTMLVideoElement): number | null {
    return Number.isFinite(video.duration) ? video.duration : null;
  }

  // Lock screen / AirPlay "now playing" title and artwork.
  private updateMediaSession(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) {
      return;
    }

    navigator.mediaSession.metadata = new MediaMetadata({
      title: this.title,
      artwork: this.posterUrl ? [{ src: this.posterUrl, sizes: '512x512' }] : [],
    });
  }
}
