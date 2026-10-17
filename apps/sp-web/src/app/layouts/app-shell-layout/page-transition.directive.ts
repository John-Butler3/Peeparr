import {
  ApplicationRef,
  DestroyRef,
  Directive,
  ElementRef,
  Injector,
  afterNextRender,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationCancel,
  NavigationEnd,
  NavigationError,
  NavigationStart,
  Router,
} from '@angular/router';
import { PageFadeService } from '../../core/navigation/page-fade.service';
import { SharedVideoService } from '../../core/player/shared-video.service';

/**
 * YouTube-style page changes. Moving to another page keeps the new page
 * hidden while it loads (its requests, then the pictures on screen), with a
 * progress bar along the top if that takes a moment, and then shows it all
 * at once, rising slightly into place with a quick fade -- instead of the
 * page appearing and filling in piece by piece. Waits at most WAIT_MAX_MS.
 * Changes within a page (filters, search text) aren't page changes.
 *
 * When the playing video moves with the page change (down into the
 * miniplayer, or back up), the page being left has faded out first
 * (PageFadeService) and the new one fades in a touch more gently.
 */
@Directive({
  selector: '[appPageTransition]',
  exportAs: 'pageTransition',
})
export class PageTransitionDirective {
  /** Longest a page stays hidden waiting to be ready. */
  static readonly WAIT_MAX_MS = 900;
  /** The progress bar only shows if loading takes longer than this. */
  static readonly PROGRESS_DELAY_MS = 150;
  /** Matches the page-in animation. */
  static readonly ENTER_MS = 260;
  /** Matches the gentler page-in (.is-soft) while a video moves. */
  static readonly SOFT_ENTER_MS = 360;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly router = inject(Router);
  private readonly appRef = inject(ApplicationRef);
  private readonly injector = inject(Injector);
  private readonly sharedVideo = inject(SharedVideoService);
  private readonly pageFade = inject(PageFadeService);
  private run = 0;
  private fromPath = this.pathOf(this.router.url);
  private changingPage = false;
  private progressTimer: ReturnType<typeof setTimeout> | null = null;
  private enterTimer: ReturnType<typeof setTimeout> | null = null;

  /** A page is loading behind the progress bar. */
  readonly loading = signal(false);

  constructor() {
    this.router.events.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.changingPage = this.pathOf(event.url) !== this.fromPath;
      } else if (event instanceof NavigationEnd) {
        this.fromPath = this.pathOf(event.urlAfterRedirects);
        if (this.changingPage) {
          this.changingPage = false;
          // Already showing (revealed behind a video swiped down): no page-in.
          if (this.pageFade.finishReveal()) {
            this.clearTimers();
            this.host.classList.remove('is-pending', 'is-entering', 'is-soft');
            return;
          }
          void this.enter();
        }
      } else if (event instanceof NavigationCancel || event instanceof NavigationError) {
        this.changingPage = false;
        // Stayed on this page: it shows again, its video back in its player.
        this.pageFade.cancel();
        this.sharedVideo.putBack();
      }
    });
    this.pageFade.setArea(this.host);
    inject(DestroyRef).onDestroy(() => {
      this.clearTimers();
      this.pageFade.setArea(null);
    });
  }

  private async enter(): Promise<void> {
    const run = ++this.run;
    this.clearTimers();
    // Hidden before the new page's first paint.
    this.host.classList.remove('is-entering');
    this.host.classList.add('is-pending');
    this.progressTimer = setTimeout(
      () => this.loading.set(true),
      PageTransitionDirective.PROGRESS_DELAY_MS,
    );

    const deadline = Date.now() + PageTransitionDirective.WAIT_MAX_MS;
    await this.withDeadline(this.ready(), deadline);
    if (run !== this.run) {
      return;
    }

    this.clearTimers();
    this.loading.set(false);
    this.host.classList.remove('is-pending');
    this.host.classList.add('is-entering');
    const soft = this.pageFade.takeSoftEnter();
    this.host.classList.toggle('is-soft', soft);
    this.enterTimer = setTimeout(
      () => this.host.classList.remove('is-entering', 'is-soft'),
      soft ? PageTransitionDirective.SOFT_ENTER_MS : PageTransitionDirective.ENTER_MS,
    );
  }

  // The page has rendered, its requests have finished, and the pictures now
  // on screen have loaded.
  private async ready(): Promise<void> {
    await new Promise<void>((resolve) =>
      afterNextRender(() => resolve(), { injector: this.injector }),
    );
    await this.appRef.whenStable();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await Promise.all(this.picturesOnScreen().map((image) => this.loaded(image)));
  }

  private picturesOnScreen(): HTMLImageElement[] {
    const height = window.innerHeight;
    const width = window.innerWidth;
    return Array.from(this.host.querySelectorAll('img')).filter((image) => {
      if (image.complete) {
        return false;
      }
      const rect = image.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < height && rect.right > 0 && rect.left < width;
    });
  }

  private loaded(image: HTMLImageElement): Promise<void> {
    return new Promise((resolve) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => resolve(), { once: true });
    });
  }

  private withDeadline(work: Promise<void>, deadline: number): Promise<void> {
    return Promise.race([
      work,
      new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, deadline - Date.now()))),
    ]);
  }

  private pathOf(url: string): string {
    return url.split(/[?#]/)[0] ?? url;
  }

  private clearTimers(): void {
    if (this.progressTimer) {
      clearTimeout(this.progressTimer);
      this.progressTimer = null;
    }
    if (this.enterTimer) {
      clearTimeout(this.enterTimer);
      this.enterTimer = null;
    }
  }
}
