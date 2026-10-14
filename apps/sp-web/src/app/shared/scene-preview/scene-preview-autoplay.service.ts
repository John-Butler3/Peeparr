import { Injectable } from '@angular/core';

/** What the autoplay needs from a preview thumbnail (ScenePreviewDirective). */
export interface ScenePreviewAutoplayItem {
  readonly host: HTMLElement;
  readonly autoplayEligible: boolean;
  readonly isActive: boolean;
  playNow(): void;
  prefetch(): void;
  stop(): void;
}

/**
 * YouTube-app style autoplay for touch screens: when scrolling stops, the
 * preview thumbnail nearest the top third of the screen plays its muted
 * preview.
 * It keeps playing while you scroll, until it's mostly off screen or another
 * one starts. While scrolling with nothing playing, the thumbnail heading for
 * the top third is loaded ahead (paused, hidden), so when scrolling stops it
 * usually just starts. Nothing autoplays while a real video fills most of
 * the screen (the full player), while something that plays its own preview
 * (Home's hero) is on screen, or on devices with a mouse (they use hover
 * instead). The pinned player on a scene page and the miniplayer don't
 * stop previews of what's below them.
 */
@Injectable({
  providedIn: 'root',
})
export class ScenePreviewAutoplayService {
  /** How long scrolling must have stopped for. */
  static readonly SETTLE_MS = 100;
  /** Where on screen the playing thumbnail should be: a third of the way down. */
  static readonly TARGET_Y = 1 / 3;
  /** How often to re-check which thumbnail to load ahead while scrolling. */
  static readonly PREFETCH_EVERY_MS = 200;
  /** Share of a thumbnail that must be on screen to be picked... */
  static readonly MIN_VISIBLE = 0.6;
  /** ...and below which a playing one stops while scrolling. */
  static readonly KEEP_VISIBLE = 0.2;

  /** No hover, coarse pointer: phones and tablets. */
  touchScreen =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches;

  private readonly items = new Set<ScenePreviewAutoplayItem>();
  /** Elements that, while this share of them is on screen, hold autoplay off. */
  private readonly holds = new Map<HTMLElement, number>();
  private current: ScenePreviewAutoplayItem | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private prefetchTimer: ReturnType<typeof setTimeout> | null = null;
  private visibilityCheckQueued = false;
  private listening = false;

  private readonly onScroll = () => {
    // The playing preview carries on until it's mostly off screen.
    if (this.current && !this.visibilityCheckQueued) {
      this.visibilityCheckQueued = true;
      requestAnimationFrame(() => {
        this.visibilityCheckQueued = false;
        const current = this.current;
        if (
          current &&
          (visibleShare(current.host) < ScenePreviewAutoplayService.KEEP_VISIBLE || this.held())
        ) {
          current.stop();
          this.current = null;
        }
      });
    }
    this.scheduleSettle();
    if (!this.prefetchTimer) {
      this.prefetchTimer = setTimeout(() => {
        this.prefetchTimer = null;
        this.prefetchNext();
      }, ScenePreviewAutoplayService.PREFETCH_EVERY_MS);
    }
  };
  private readonly onResize = () => this.scheduleSettle();
  private readonly onVisibilityChange = () => {
    if (document.hidden) {
      this.current?.stop();
      this.current = null;
    } else {
      this.scheduleSettle();
    }
  };

  register(item: ScenePreviewAutoplayItem): void {
    this.items.add(item);
    if (this.touchScreen) {
      this.listen();
      // New thumbnails (page load, more results): pick once things settle.
      this.scheduleSettle();
    }
  }

  unregister(item: ScenePreviewAutoplayItem): void {
    this.items.delete(item);
    if (this.current === item) {
      this.current = null;
    }
    if (this.items.size === 0) {
      this.unlisten();
    }
  }

  /** No autoplay while `element` is at least `share` on screen. */
  holdWhileOnScreen(element: HTMLElement, share: number): void {
    this.holds.set(element, share);
    this.scheduleSettle();
  }

  releaseHold(element: HTMLElement): void {
    if (this.holds.delete(element)) {
      this.scheduleSettle();
    }
  }

  /** Picks and plays the thumbnail nearest the top third of the screen. */
  pick(): void {
    this.settleTimer = null;
    if (!this.touchScreen || document.hidden) {
      return;
    }

    if (realVideoPlaying() || this.held()) {
      this.current?.stop();
      this.current = null;
      return;
    }

    const best = this.findBest();
    if (best !== this.current) {
      this.current?.stop();
    }
    this.current = best;
    best?.playNow();
  }

  // While scrolling with nothing playing: load the likely next pick ahead,
  // paused and hidden (never cutting off one that's still playing).
  private prefetchNext(): void {
    if (
      !this.touchScreen ||
      document.hidden ||
      realVideoPlaying() ||
      this.held() ||
      this.current?.isActive
    ) {
      return;
    }

    const best = this.findBest();
    if (best) {
      best.prefetch();
      this.current = best;
    }
  }

  private held(): boolean {
    for (const [element, share] of this.holds) {
      if (element.isConnected && visibleShare(element) >= share) {
        return true;
      }
    }
    return false;
  }

  private findBest(): ScenePreviewAutoplayItem | null {
    const viewportCentreX = window.innerWidth / 2;
    const targetY = window.innerHeight * ScenePreviewAutoplayService.TARGET_Y;
    let best: ScenePreviewAutoplayItem | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const item of this.items) {
      if (!item.autoplayEligible || !item.host.isConnected) {
        continue;
      }

      const rect = item.host.getBoundingClientRect();
      if (visibleShare(item.host, rect) < ScenePreviewAutoplayService.MIN_VISIBLE) {
        continue;
      }

      // Mostly vertical lists; sideways distance (rails) counts for less.
      const dy = Math.abs(rect.top + rect.height / 2 - targetY);
      const dx = Math.abs(rect.left + rect.width / 2 - viewportCentreX);
      const score = dy + dx * 0.25;
      if (score < bestScore) {
        best = item;
        bestScore = score;
      }
    }

    return best;
  }

  private scheduleSettle(): void {
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
    }
    this.settleTimer = setTimeout(() => this.pick(), ScenePreviewAutoplayService.SETTLE_MS);
  }

  private listen(): void {
    if (this.listening) {
      return;
    }
    this.listening = true;
    // Capture: also catches sideways-scrolling rails.
    document.addEventListener('scroll', this.onScroll, { capture: true, passive: true });
    window.addEventListener('resize', this.onResize, { passive: true });
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private unlisten(): void {
    if (!this.listening) {
      return;
    }
    this.listening = false;
    document.removeEventListener('scroll', this.onScroll, { capture: true });
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    if (this.prefetchTimer) {
      clearTimeout(this.prefetchTimer);
      this.prefetchTimer = null;
    }
  }
}

function visibleShare(element: HTMLElement, rect = element.getBoundingClientRect()): number {
  const area = rect.width * rect.height;
  if (area <= 0) {
    return 0;
  }

  const width = Math.max(0, Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0));
  const height = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
  return (width * height) / area;
}

/** Share of the screen a playing video must cover to hold previews off. */
const FULL_PLAYER_SHARE = 0.45;

// A real video (not a preview) is playing and fills most of the screen.
function realVideoPlaying(): boolean {
  const screenArea = window.innerWidth * window.innerHeight;
  return Array.from(document.querySelectorAll('video')).some((video) => {
    if (video.classList.contains('hover-preview') || video.paused || video.ended) {
      return false;
    }
    const rect = video.getBoundingClientRect();
    return screenArea > 0 && (rect.width * rect.height * visibleShare(video, rect)) / screenArea >= FULL_PLAYER_SHARE;
  });
}
