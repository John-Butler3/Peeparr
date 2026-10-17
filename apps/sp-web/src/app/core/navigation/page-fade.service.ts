import { Injectable } from '@angular/core';

/**
 * Fading the page on screen out, just before a page change that moves the
 * playing video (down into the miniplayer, or back up): the video, lifted
 * out of the page, glides over the fade rather than a cut. The next page
 * then fades in a touch more gently (read by the page transition).
 */
@Injectable({ providedIn: 'root' })
export class PageFadeService {
  static readonly FADE_OUT_MS = 200;

  private area: HTMLElement | null = null;
  private fading: Animation | null = null;
  private soft = false;

  /** The page area (the page transition's host). */
  setArea(area: HTMLElement | null): void {
    this.area = area;
  }

  /** Fades the page on screen out; resolves when it has. */
  fadeOut(): Promise<void> {
    this.soft = true;
    const page = this.area?.querySelector<HTMLElement>(':scope > :not(router-outlet)');
    if (!page || typeof page.animate !== 'function') {
      return Promise.resolve();
    }
    this.fading?.cancel();
    const fading = page.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: PageFadeService.FADE_OUT_MS,
      easing: 'ease-out',
      fill: 'forwards',
    });
    this.fading = fading;
    return fading.finished.then(
      () => undefined,
      () => undefined,
    );
  }

  /** The page change didn't happen: the page shows again. */
  cancel(): void {
    this.fading?.cancel();
    this.fading = null;
    this.soft = false;
  }

  /** Whether the page now arriving should fade in gently (asked once). */
  takeSoftEnter(): boolean {
    const soft = this.soft;
    this.soft = false;
    this.fading = null;
    return soft;
  }
}
