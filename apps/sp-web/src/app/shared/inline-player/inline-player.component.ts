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
import { ProgressSpinner } from 'primeng/progressspinner';
import { Observable, Subscription } from 'rxjs';
import { ScenePlaybackSource } from '../../core/api/discover.types';
import { PlayerDetails, PlayerService } from '../../core/player/player.service';
import { SharedVideoService } from '../../core/player/shared-video.service';

// YouTube's watch-page player. A thumbnail with a play button that
// turns into the video in place. Leaving the page while it plays hands the
// video to the global miniplayer at the same moment. Swiping down on the
// playing video asks the page to do that (`minimize`).
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
  /** How far down a swipe must go to minimise. */
  private static readonly MINIMIZE_DRAG_PX = 110;

  private readonly playerService = inject(PlayerService);
  private readonly sharedVideo = inject(SharedVideoService);
  private sourceSubscription: Subscription | null = null;
  private progressInterval: ReturnType<typeof setInterval> | null = null;
  private listeners: AbortController | null = null;

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
  /** Swiped down while playing: carry on in the miniplayer. */
  @Output() minimize = new EventEmitter<void>();

  protected readonly status = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  protected readonly source = signal<ScenePlaybackSource | null>(null);
  protected readonly dragOffset = signal(0);
  private drag: { x: number; y: number; down: boolean | null } | null = null;

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
    const video = this.video;
    const source = this.source();
    if (video && source && !video.paused && !video.ended) {
      this.playerService.saveProgress(
        source.stashSceneId,
        video.currentTime,
        this.videoDuration(video),
      );
      // Still playing: the miniplayer takes the same video (it waits in the
      // page meanwhile), so it doesn't stop, here or on an Apple TV.
      this.listeners?.abort();
      this.sharedVideo.park(this);
      this.playerService.handOff({
        title: this.title,
        imageUrl: this.posterUrl,
        source: { ...source, resumeSeconds: video.currentTime },
        details: this.details,
      });
    } else {
      this.saveProgress();
      this.sharedVideo.release(this);
    }
    this.cleanup();
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
    this.drag =
      video && !video.paused && touch && event.touches.length === 1
        ? { x: touch.clientX, y: touch.clientY, down: null }
        : null;
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
      this.dragOffset.set(Math.max(0, dy));
    }
  }

  protected onDragEnd(): void {
    const minimise =
      !!this.drag?.down && this.dragOffset() > InlinePlayerComponent.MINIMIZE_DRAG_PX;
    this.drag = null;
    this.dragOffset.set(0);
    if (minimise) {
      this.minimize.emit();
    }
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
    const carriedOn = this.sharedVideo.attach(this, slot, source.stashSceneId, source.streamUrl);
    const video = this.sharedVideo.video;
    video.controls = true;
    if (this.posterUrl) {
      video.poster = this.posterUrl;
    } else {
      video.removeAttribute('poster');
    }
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
    if (!video || !source) {
      return;
    }

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
    this.updateMediaSession();
    this.stopInterval();
    this.progressInterval = setInterval(
      () => this.saveProgress(),
      InlinePlayerComponent.PROGRESS_SAVE_INTERVAL_MS,
    );
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
