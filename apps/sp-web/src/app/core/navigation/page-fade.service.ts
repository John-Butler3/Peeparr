import { Injectable } from '@angular/core';

/**
 * Fading the page on screen out, just before a page change that moves the
 * playing video (down into the miniplayer, or back up): the video, lifted
 * out of the page, glides over the fade rather than a cut. While the video
 * is dragged down by hand the page dims with it (setProgress). The next
 * page then fades in a touch more gently (read by the page transition).
 *
 * Pages are kept alive when left, so a faded page is reset as the next one
 * comes in: it must show normally when it's returned to.
 */
@Injectable({ providedIn: 'root' })
export class PageFadeService {
  static readonly FADE_OUT_MS = 200;
  /** How far a drag dims the page (at its full distance). */
  static readonly DRAG_DIM = 0.5;

  private area: HTMLElement | null = null;
  private page: HTMLElement | null = null;
  private fading: Animation | null = null;
  private soft = false;

  /** The page area (the page transition's host). */
  setArea(area: HTMLElement | null): void {
    this.area = area;
  }

  /** Dims the page with a drag (0 to 1 of the way). */
  setProgress(progress: number): void {
    const page = this.currentPage();
    if (!page) {
      return;
    }
    this.page = page;
    const clamped = Math.min(1, Math.max(0, progress));
    page.style.opacity = clamped > 0 ? String(1 - clamped * PageFadeService.DRAG_DIM) : '';
  }

  /** Fades the page on screen out (from wherever a drag left it); resolves when it has. */
  fadeOut(): Promise<void> {
    this.soft = true;
    const page = this.currentPage();
    if (!page || typeof page.animate !== 'function') {
      return Promise.resolve();
    }
    this.page = page;
    this.fading?.cancel();
    const from = Number(page.style.opacity || '1');
    const fading = page.animate([{ opacity: from }, { opacity: 0 }], {
      duration: PageFadeService.FADE_OUT_MS * from,
      easing: 'ease-out',
      fill: 'forwards',
    });
    this.fading = fading;
    return fading.finished.then(
      () => undefined,
      () => undefined,
    );
  }

  /** The drag or page change didn't happen: the page shows again. */
  cancel(): void {
    this.reset();
    this.soft = false;
  }

  /**
   * The next page is coming in: whether it should fade in gently (asked
   * once). The faded page is reset for when it's shown again.
   */
  takeSoftEnter(): boolean {
    const soft = this.soft;
    this.soft = false;
    this.reset();
    return soft;
  }

  private reset(): void {
    this.fading?.cancel();
    this.fading = null;
    if (this.page) {
      this.page.style.opacity = '';
      this.page = null;
    }
  }

  private currentPage(): HTMLElement | null {
    return this.area?.querySelector<HTMLElement>(':scope > :not(router-outlet)') ?? null;
  }
}
