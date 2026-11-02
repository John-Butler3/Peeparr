import {
  Directive,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnDestroy,
  OnInit,
  Output,
  inject,
} from '@angular/core';
import { Observable, Subscription } from 'rxjs';
import { ScenePreviewSource } from '../scene-card/scene-preview.service';
import { PreviewAudioService } from './preview-audio.service';
import { ScenePreviewAutoplayService } from './scene-preview-autoplay.service';

export type ScenePreviewLoader = () => Observable<ScenePreviewSource | null>;

/**
 * YouTube-style scene preview on any thumbnail: a loop from the middle of the
 * scene, faded in over the thumbnail, with sound and a mute button
 * (PreviewAudioService). Read-only: previews never save progress.
 *
 * - Mouse: rest on the thumbnail. The video starts loading straight away
 *   (hidden) and fades in once the hover is confirmed and a frame is ready.
 * - Touch screens: no gesture -- like the YouTube app, whichever thumbnail
 *   is nearest the top third of the screen when scrolling stops plays
 *   (ScenePreviewAutoplayService), loaded ahead while scrolling. Tapping
 *   still opens the scene.
 *
 * Plays Stash's short preview clip when it has been generated (small, so
 * near-instant), otherwise the full file from its middle.
 *
 * The host must be `position: relative; overflow: hidden` (the video is
 * absolutely positioned inside it; see styles/_scene-preview.scss). While a
 * preview shows, the host gets `is-previewing`.
 */
@Directive({
  selector: '[appScenePreview]',
})
export class ScenePreviewDirective implements OnInit, OnDestroy {
  static readonly PREVIEW_DELAY_MS = 500;
  /** Skip loading for a mouse just passing over. */
  static readonly PREFETCH_DELAY_MS = 120;
  static readonly PREVIEW_LOOP_SECONDS = 20;
  /** Matches the .hover-preview opacity transition. */
  static readonly PREVIEW_FADE_MS = 450;
  /** Back to the thumbnail once played through (scenePreviewOnce). */
  static readonly FINISH_FADE_MS = 1200;

  /** Only one thumbnail previews at a time. */
  private static active: ScenePreviewDirective | null = null;
  /** Previews only start once the page has been still this long. */
  static readonly SCROLL_QUIET_MS = 150;
  private static lastScrollAt = 0;
  private static scrollListening = false;
  /** Preview clips that turned out not to exist (not generated in Stash). */
  private static readonly missingClips = new Set<string>();

  /** Resolves the preview stream; null when the scene can't be previewed. */
  @Input('appScenePreview') loader: ScenePreviewLoader | null = null;
  /**
   * Take part in scroll autoplay on touch screens. Off for compact lists
   * next to a playing video (Up next, series parts).
   */
  @Input() scenePreviewAutoplay = true;
  /** Start when a mouse rests on it. Off when the page decides (a scene page's player). */
  @Input() scenePreviewHover = true;
  /** A slower cross-fade to and from the thumbnail (default: PREVIEW_FADE_MS). */
  @Input() scenePreviewFadeMs: number | null = null;
  /** Play through once and fade back to the thumbnail, rather than looping. */
  @Input() scenePreviewOnce = false;
  /**
   * Plays regardless of other thumbnails' previews, neither stopping them nor
   * being stopped by them (a scene page's own picture, pinned above its rows).
   */
  @Input() scenePreviewIndependent = false;
  /** Played through (scenePreviewOnce), and fading back to the thumbnail. */
  @Output() scenePreviewFinished = new EventEmitter<void>();

  readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly autoplay = inject(ScenePreviewAutoplayService);
  private readonly audio = inject(PreviewAudioService);
  private muteButton: HTMLElement | null = null;
  private videoListeners: AbortController | null = null;
  private video: HTMLVideoElement | null = null;
  private visible = false;
  /** Previewing, for an independent one (others share `active`). */
  private running = false;
  private previewStart = 0;
  private source: ScenePreviewSource | null = null;
  /** Playing Stash's preview clip (looped whole) rather than the full file. */
  private clipMode = false;
  private prefetchTimer: ReturnType<typeof setTimeout> | null = null;
  private revealTimer: ReturnType<typeof setTimeout> | null = null;
  private teardownTimer: ReturnType<typeof setTimeout> | null = null;
  private subscription: Subscription | null = null;
  /** Hover confirmed / chosen for autoplay. */
  private revealAllowed = false;
  /** The mouse is over this thumbnail. */
  private hovered = false;
  /** A real frame is on screen. */
  private frameReady = false;

  // Phone long-press side effects (text selection, dragging the image out).
  private readonly blockListener = (event: Event) => event.preventDefault();

  constructor() {
    this.host.addEventListener('selectstart', this.blockListener);
    this.host.addEventListener('dragstart', this.blockListener);
    this.host.classList.add('scene-preview-host');
    ScenePreviewDirective.listenForScroll();
    // Phones: a quick fade, so the preview is on screen almost at once.
    this.host.classList.toggle('scene-preview-quick', this.autoplay.touchScreen);
  }

  ngOnInit(): void {
    this.autoplay.register(this);
  }

  ngOnDestroy(): void {
    this.autoplay.unregister(this);
    this.host.removeEventListener('selectstart', this.blockListener);
    this.host.removeEventListener('dragstart', this.blockListener);
    this.stop();
    this.teardownVideo();
    this.muteButton?.remove();
  }

  /** Can play in autoplay right now. */
  get autoplayEligible(): boolean {
    return this.scenePreviewAutoplay && !!this.loader;
  }

  /** Previewing (loading or showing). */
  get isActive(): boolean {
    return this.scenePreviewIndependent ? this.running : ScenePreviewDirective.active === this;
  }

  @HostListener('pointerenter', ['$event'])
  protected onPointerEnter(event: PointerEvent): void {
    // (Already on it: browsers can report this again when what's under the
    // pointer changes, and it shouldn't start the preview over.)
    if (event.pointerType !== 'mouse' || !this.loader || !this.scenePreviewHover || this.hovered) {
      return;
    }

    this.hovered = true;
    this.stop();
    this.startHoverWhenStill();
  }

  // Scrolling slides thumbnails under a resting mouse: only start once the
  // page has stopped moving (and the mouse is still on this one).
  private startHoverWhenStill(): void {
    if (!this.hovered) {
      return;
    }

    const sinceScroll = Date.now() - ScenePreviewDirective.lastScrollAt;
    if (sinceScroll < ScenePreviewDirective.SCROLL_QUIET_MS) {
      this.prefetchTimer = setTimeout(
        () => {
          this.prefetchTimer = null;
          this.startHoverWhenStill();
        },
        ScenePreviewDirective.SCROLL_QUIET_MS - sinceScroll + 10,
      );
      return;
    }

    this.prefetchTimer = setTimeout(() => {
      this.prefetchTimer = null;
      this.start();
    }, ScenePreviewDirective.PREFETCH_DELAY_MS);
    this.revealTimer = setTimeout(() => {
      this.revealTimer = null;
      this.reveal();
    }, ScenePreviewDirective.PREVIEW_DELAY_MS);
  }

  private static listenForScroll(): void {
    if (ScenePreviewDirective.scrollListening || typeof document === 'undefined') {
      return;
    }
    ScenePreviewDirective.scrollListening = true;
    document.addEventListener('scroll', () => (ScenePreviewDirective.lastScrollAt = Date.now()), {
      capture: true,
      passive: true,
    });
  }

  @HostListener('pointerleave', ['$event'])
  protected onPointerLeave(event: PointerEvent): void {
    if (event.pointerType === 'mouse' && this.scenePreviewHover) {
      this.hovered = false;
      this.stop();
    }
  }

  @HostListener('contextmenu', ['$event'])
  protected onContextMenu(event: Event): void {
    // Long-press menu on touch screens (right-click on a mouse is left alone).
    if (this.autoplay.touchScreen) {
      event.preventDefault();
    }
  }

  /** Autoplay chose this thumbnail: play as soon as a frame is ready. */
  playNow(): void {
    if (this.isActive) {
      // Already loaded ahead (or still playing): show / carry on.
      this.reveal();
      return;
    }

    this.stop();
    this.start();
    this.reveal();
  }

  /** Autoplay expects this one next: load it, paused and hidden. */
  prefetch(): void {
    if (this.isActive) {
      return;
    }

    this.stop();
    this.start();
  }

  /** Stops the preview, fading back to the thumbnail if it was showing. */
  stop(fadeMs = this.scenePreviewFadeMs ?? ScenePreviewDirective.PREVIEW_FADE_MS): void {
    if (this.prefetchTimer) {
      clearTimeout(this.prefetchTimer);
      this.prefetchTimer = null;
    }
    if (this.revealTimer) {
      clearTimeout(this.revealTimer);
      this.revealTimer = null;
    }
    this.revealAllowed = false;
    this.frameReady = false;
    this.subscription?.unsubscribe();
    this.subscription = null;
    this.running = false;
    if (ScenePreviewDirective.active === this) {
      ScenePreviewDirective.active = null;
    }
    this.source = null;

    if (this.visible && !this.teardownTimer) {
      // Fade back to the thumbnail, then drop the video.
      if (this.video) {
        this.video.style.transitionDuration = `${fadeMs}ms`;
      }
      this.setVisible(false);
      this.video?.pause();
      this.teardownTimer = setTimeout(() => this.teardownVideo(), fadeMs);
      return;
    }

    if (!this.teardownTimer) {
      this.teardownVideo();
    }
  }

  private start(): void {
    const loader = this.loader;
    if (!loader) {
      return;
    }

    if (this.scenePreviewIndependent) {
      this.running = true;
    } else {
      const previous = ScenePreviewDirective.active;
      if (previous && previous !== this) {
        previous.stop();
      }
      ScenePreviewDirective.active = this;
    }
    // Still fading out from a moment ago: start over cleanly.
    if (this.teardownTimer) {
      this.teardownVideo();
    }

    this.frameReady = false;
    this.subscription?.unsubscribe();
    this.subscription = loader().subscribe((source) => {
      if (!source) {
        return;
      }

      this.source = source;
      const clip = source.clipUrl;
      if (clip && !ScenePreviewDirective.missingClips.has(clip)) {
        this.clipMode = true;
        this.previewStart = 0;
        this.createVideo(clip);
      } else {
        this.playFullFile();
      }
    });
  }

  // No preview clip: the full file, from its middle.
  private playFullFile(): void {
    const source = this.source;
    if (!source) {
      return;
    }

    this.clipMode = false;
    this.previewStart = source.duration ? Math.floor(source.duration / 2) : 0;
    this.createVideo(`${source.streamUrl}#t=${this.previewStart}`);
  }

  private onVideoError(): void {
    const clip = this.source?.clipUrl;
    if (this.clipMode && clip) {
      // Not generated in Stash: remember, and use the full file instead.
      ScenePreviewDirective.missingClips.add(clip);
      this.playFullFile();
      return;
    }

    this.stop();
  }

  private createVideo(src: string): void {
    this.teardownVideo();
    const video = this.audio.takeVideo();
    this.videoListeners = new AbortController();
    const signal = this.videoListeners.signal;
    video.className = 'hover-preview';
    video.muted = true;
    video.defaultMuted = true;
    video.setAttribute('muted', '');
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.preload = 'auto';
    video.loop = this.clipMode && !this.scenePreviewOnce;
    video.setAttribute('aria-hidden', 'true');
    if (this.scenePreviewFadeMs !== null) {
      video.style.transitionDuration = `${this.scenePreviewFadeMs}ms`;
    }
    video.addEventListener('loadedmetadata', () => this.onMetadata(video), { signal });
    video.addEventListener('playing', () => this.onPlaying(video), { signal });
    video.addEventListener('timeupdate', () => this.onTimeUpdate(video), { signal });
    video.addEventListener('error', () => this.onVideoError(), { signal });
    video.addEventListener('ended', () => this.finishIfOnce(), { signal });
    video.addEventListener('volumechange', () => this.syncMuteButton(), { signal });
    video.src = src;
    this.host.appendChild(video);
    this.video = video;
  }

  private onMetadata(video: HTMLVideoElement): void {
    // Full file whose duration wasn't known up front: jump to the middle now.
    if (
      !this.clipMode &&
      !this.previewStart &&
      Number.isFinite(video.duration) &&
      video.duration > 0
    ) {
      this.previewStart = Math.floor(video.duration / 2);
      video.currentTime = this.previewStart;
    }
    // Loaded ahead: stay paused on the first frame until it's revealed.
    if (this.revealAllowed) {
      this.play(video);
    }
  }

  private play(video: HTMLVideoElement): void {
    this.audio.play(video).catch(() => this.stop());
  }

  // Shown only once a real frame is on screen, so the fade goes from the
  // thumbnail straight into the picture (no black flash while it seeks).
  private onPlaying(video: HTMLVideoElement): void {
    const show = () => {
      this.frameReady = true;
      this.updateVisibility();
    };
    const withFrameCallback = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
    };
    if (typeof withFrameCallback.requestVideoFrameCallback === 'function') {
      withFrameCallback.requestVideoFrameCallback(show);
    } else {
      show();
    }
  }

  private onTimeUpdate(video: HTMLVideoElement): void {
    // A clip loops by itself; the full file loops a window from its middle.
    if (
      !this.clipMode &&
      video.currentTime > this.previewStart + ScenePreviewDirective.PREVIEW_LOOP_SECONDS
    ) {
      if (this.scenePreviewOnce) {
        this.finishIfOnce();
      } else {
        video.currentTime = this.previewStart;
      }
    }
  }

  private finishIfOnce(): void {
    if (this.scenePreviewOnce && this.isActive) {
      this.stop(ScenePreviewDirective.FINISH_FADE_MS);
      this.scenePreviewFinished.emit();
    }
  }

  private reveal(): void {
    this.revealAllowed = true;
    const video = this.video;
    if (video && video.paused && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      this.play(video);
    }
    this.updateVisibility();
  }

  private updateVisibility(): void {
    this.setVisible(this.revealAllowed && this.frameReady && !!this.video);
  }

  private setVisible(visible: boolean): void {
    this.visible = visible;
    this.video?.classList.toggle('is-playing', visible);
    this.host.classList.toggle('is-previewing', visible);
    this.syncMuteButton();
  }

  // Over the preview while it shows. (A span: the thumbnail may be a button.)
  private syncMuteButton(): void {
    const video = this.video;
    if (!this.visible || !video) {
      this.muteButton?.remove();
      this.muteButton = null;
      return;
    }
    if (!this.muteButton) {
      this.muteButton = this.createMuteButton();
      this.host.appendChild(this.muteButton);
    }
    const label = video.muted ? 'Turn preview sound on' : 'Mute previews';
    this.muteButton.setAttribute('aria-label', label);
    this.muteButton.title = label;
    const icon = this.muteButton.firstElementChild;
    icon?.classList.toggle('pi-volume-off', video.muted);
    icon?.classList.toggle('pi-volume-up', !video.muted);
  }

  private createMuteButton(): HTMLElement {
    const button = document.createElement('span');
    button.className = 'preview-mute';
    button.setAttribute('role', 'button');
    button.tabIndex = 0;
    const icon = document.createElement('i');
    icon.className = 'pi';
    icon.setAttribute('aria-hidden', 'true');
    button.appendChild(icon);
    // Not the thumbnail's own tap (opening or playing the scene).
    const toggle = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (this.video) {
        this.audio.toggle(this.video);
      }
    };
    button.addEventListener('click', toggle);
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        toggle(event);
      }
    });
    return button;
  }

  private teardownVideo(): void {
    if (this.teardownTimer) {
      clearTimeout(this.teardownTimer);
      this.teardownTimer = null;
    }

    // Drop the source so the browser stops downloading the stream.
    const video = this.video;
    if (video) {
      this.videoListeners?.abort();
      this.videoListeners = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
      video.style.transitionDuration = '';
      this.audio.release(video);
      this.video = null;
    }
    this.setVisible(false);
  }
}
