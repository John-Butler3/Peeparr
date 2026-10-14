import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { HomeRailItem } from '../../../core/api/home.types';
import { ScenePreviewAutoplayService } from '../../../shared/scene-preview/scene-preview-autoplay.service';
import {
  ScenePreviewService,
  ScenePreviewSource,
} from '../../../shared/scene-card/scene-preview.service';

/**
 * Home's hero: the most recently added scenes, one at a time, each playing
 * its muted preview; once the preview clip has played through (or after
 * PREVIEW_HOLD_MS when previewing the full file) it slides on to the next
 * (looping), or swipe sideways to change scene. Tapping the picture
 * opens the scene; Play plays it. While it's on screen the thumbnails below
 * don't autoplay their previews; scrolled away, it pauses and they do.
 */
@Component({
  selector: 'app-home-hero',
  imports: [RouterLink],
  templateUrl: './home-hero.component.html',
  styleUrl: './home-hero.component.scss',
})
export class HomeHeroComponent implements OnChanges, OnDestroy {
  static readonly SLIDES = 5;
  /** Preview time per scene before moving on. */
  static readonly PREVIEW_HOLD_MS = 8000;
  /** A preview clip plays through once, within these bounds. */
  static readonly CLIP_HOLD_MIN_MS = 4000;
  static readonly CLIP_HOLD_MAX_MS = 15000;
  /** Move on anyway if a preview never starts. */
  static readonly NO_PREVIEW_ADVANCE_MS = 12000;
  /** How far a sideways swipe must go to change scene. */
  static readonly SWIPE_PX = 40;
  /** Share of the hero on screen for it to count as being looked at. */
  static readonly ON_SCREEN_SHARE = 0.25;
  static readonly PREVIEW_LOOP_SECONDS = 20;

  @Input() items: readonly HomeRailItem[] = [];
  @Output() play = new EventEmitter<string>();

  @ViewChild('video') private videoRef?: ElementRef<HTMLVideoElement>;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly previewService = inject(ScenePreviewService);
  private readonly autoplay = inject(ScenePreviewAutoplayService);
  protected readonly slides = signal<HomeRailItem[]>([]);
  protected readonly index = signal(0);
  protected readonly current = computed(() => this.slides()[this.index()] ?? null);
  protected readonly videoPlaying = signal(false);
  protected readonly dragX = signal(0);
  protected readonly dragging = signal(false);
  /** The bar along the bottom filling up until the next scene (restarts per run). */
  protected readonly progress = signal<{ run: number; ms: number } | null>(null);

  private advanceTimer: ReturnType<typeof setTimeout> | null = null;
  private sourceSubscription: Subscription | null = null;
  private source: ScenePreviewSource | null = null;
  private clipMode = false;
  private previewStart = 0;
  private readonly missingClips = new Set<string>();
  private onScreen = true;
  private holdStarted = false;
  private progressRuns = 0;
  private touchStart: { x: number; y: number; sideways: boolean | null } | null = null;
  private readonly observer =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver((entries) => this.setOnScreen(entries[0]?.isIntersecting ?? true), {
          threshold: HomeHeroComponent.ON_SCREEN_SHARE,
        })
      : null;
  private readonly onVisibility = () => {
    if (document.hidden) {
      this.pause();
    } else {
      this.loadPreview();
    }
  };

  constructor() {
    document.addEventListener('visibilitychange', this.onVisibility);
    this.observer?.observe(this.host);
    this.autoplay.holdWhileOnScreen(this.host, HomeHeroComponent.ON_SCREEN_SHARE);
  }

  ngOnChanges(): void {
    const next = this.items.slice(0, HomeHeroComponent.SLIDES);
    const sameScenes =
      next.length === this.slides().length && next.every((item, i) => item.id === this.slides()[i]?.id);
    this.slides.set(next);
    if (!sameScenes) {
      this.index.set(0);
      // Let the view render the video element first.
      setTimeout(() => this.loadPreview(), 0);
    }
  }

  ngOnDestroy(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.observer?.disconnect();
    this.autoplay.releaseHold(this.host);
    this.clearTimer();
    this.sourceSubscription?.unsubscribe();
    this.dropVideo();
  }

  protected goTo(index: number): void {
    if (index === this.index()) {
      return;
    }
    this.index.set(index);
    this.loadPreview();
  }

  protected onTouchStart(event: TouchEvent): void {
    const touch = event.touches[0];
    this.touchStart =
      touch && event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY, sideways: null } : null;
  }

  protected onTouchMove(event: TouchEvent): void {
    const start = this.touchStart;
    const touch = event.touches[0];
    if (!start || !touch) {
      return;
    }
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    // Decide once per gesture: sideways drags the hero, otherwise it's a scroll.
    if (start.sideways === null && Math.max(Math.abs(dx), Math.abs(dy)) > 8) {
      start.sideways = Math.abs(dx) > Math.abs(dy);
    }
    if (start.sideways) {
      this.dragging.set(true);
      this.dragX.set(dx);
    }
  }

  protected onTouchEnd(): void {
    const dx = this.dragX();
    const wasDragging = this.dragging();
    this.touchStart = null;
    this.dragging.set(false);
    this.dragX.set(0);
    const count = this.slides().length;
    if (!wasDragging || Math.abs(dx) < HomeHeroComponent.SWIPE_PX || count < 2) {
      return;
    }
    this.goTo((this.index() + (dx < 0 ? 1 : count - 1)) % count);
  }

  protected link(item: HomeRailItem): readonly unknown[] {
    return item.activeCatalogSceneId ? ['/scene', item.activeCatalogSceneId] : ['/library/scene', item.id];
  }

  protected onVideoMetadata(video: HTMLVideoElement): void {
    video.muted = true;
    if (!this.clipMode && !this.previewStart && Number.isFinite(video.duration) && video.duration > 0) {
      this.previewStart = Math.floor(video.duration / 2);
      video.currentTime = this.previewStart;
    }
    void video
      .play()
      .catch(() => this.scheduleAdvance(HomeHeroComponent.NO_PREVIEW_ADVANCE_MS, true));
  }

  // Counts the preview time from when it first actually plays (not again
  // after buffering).
  protected onVideoPlaying(video: HTMLVideoElement): void {
    this.videoPlaying.set(true);
    if (!this.holdStarted) {
      this.holdStarted = true;
      this.scheduleAdvance(this.holdTime(video), true);
    }
  }

  protected onVideoTimeUpdate(video: HTMLVideoElement): void {
    if (!this.clipMode && video.currentTime > this.previewStart + HomeHeroComponent.PREVIEW_LOOP_SECONDS) {
      video.currentTime = this.previewStart;
    }
  }

  protected onVideoError(): void {
    const clip = this.source?.clipUrl;
    if (this.clipMode && clip) {
      this.missingClips.add(clip);
      this.playFullFile();
      return;
    }
    this.videoPlaying.set(false);
  }

  // Stash's preview clip once through; the full file gets PREVIEW_HOLD_MS.
  private holdTime(video: HTMLVideoElement): number {
    const clipMs = video.duration * 1000;
    if (!this.clipMode || !Number.isFinite(clipMs) || clipMs <= 0) {
      return HomeHeroComponent.PREVIEW_HOLD_MS;
    }
    return Math.round(
      Math.min(HomeHeroComponent.CLIP_HOLD_MAX_MS, Math.max(HomeHeroComponent.CLIP_HOLD_MIN_MS, clipMs)),
    );
  }

  private setOnScreen(onScreen: boolean): void {
    if (onScreen === this.onScreen) {
      return;
    }
    this.onScreen = onScreen;
    if (onScreen) {
      this.loadPreview();
    } else {
      this.pause();
    }
  }

  private pause(): void {
    this.clearTimer();
    this.sourceSubscription?.unsubscribe();
    this.videoRef?.nativeElement.pause();
  }

  private next(): void {
    const count = this.slides().length;
    if (count > 1) {
      this.index.set((this.index() + 1) % count);
    }
    this.loadPreview();
  }

  private loadPreview(): void {
    this.clearTimer();
    this.sourceSubscription?.unsubscribe();
    this.videoPlaying.set(false);
    this.holdStarted = false;
    const item = this.current();
    if (!item || document.hidden || !this.onScreen) {
      return;
    }

    // Moves on even if the preview never plays (the bar waits for it to).
    this.scheduleAdvance(HomeHeroComponent.NO_PREVIEW_ADVANCE_MS);
    this.sourceSubscription = this.previewService.local(item.id, item.duration).subscribe((source) => {
      this.source = source;
      const clip = source?.clipUrl;
      if (clip && !this.missingClips.has(clip)) {
        this.clipMode = true;
        this.previewStart = 0;
        this.setVideoSource(clip);
      } else {
        this.playFullFile();
      }
    });
  }

  private playFullFile(): void {
    const source = this.source;
    if (!source) {
      return;
    }
    this.clipMode = false;
    this.previewStart = source.duration ? Math.floor(source.duration / 2) : 0;
    this.setVideoSource(`${source.streamUrl}#t=${this.previewStart}`);
  }

  private setVideoSource(src: string): void {
    const video = this.videoRef?.nativeElement;
    if (!video) {
      return;
    }
    video.loop = this.clipMode;
    video.muted = true;
    video.src = src;
  }

  private scheduleAdvance(ms: number, showProgress = false): void {
    this.clearTimer();
    this.advanceTimer = setTimeout(() => this.next(), ms);
    if (showProgress) {
      this.progress.set({ run: ++this.progressRuns, ms });
    }
  }

  private clearTimer(): void {
    this.progress.set(null);
    if (this.advanceTimer) {
      clearTimeout(this.advanceTimer);
      this.advanceTimer = null;
    }
  }

  private dropVideo(): void {
    const video = this.videoRef?.nativeElement;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  }
}
