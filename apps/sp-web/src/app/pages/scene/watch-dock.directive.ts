import { DestroyRef, Directive, ElementRef, Input, NgZone, OnChanges, inject } from '@angular/core';

/**
 * Scene page, for scenes not in the library: as you scroll, the picture
 * stays pinned and shrinks into the top-right corner, and the title slides
 * into a slim bar beside it (styles in _watch-page.scss, `.is-catalog-only`).
 *
 * Sets on the host:
 * - `--dock` 0..1: how far the picture has docked. It shrinks at the same
 *   rate the page scrolls, so the content below stays attached to its
 *   bottom edge.
 * - `--dock-scale`: the picture's docked size (`--dock-thumb-w` from CSS)
 *   as a share of its full width.
 * - `--dock-title` 0..1: how far the page's title has gone under the bar,
 *   so the bar's own copy of it fades in as the original disappears.
 * - `.is-docked` once it's fully docked.
 */
@Directive({
  selector: '[appWatchDock]',
})
export class WatchDockDirective implements OnChanges {
  @Input('appWatchDock') enabled = false;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);
  private frame = 0;
  private listening = false;
  private readonly resizeObserver =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.schedule());
  private readonly schedule = () => {
    if (!this.frame) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.update();
      });
    }
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  ngOnChanges(): void {
    if (this.enabled) {
      this.start();
    } else {
      this.stop();
    }
  }

  private start(): void {
    if (this.listening) {
      return;
    }
    this.listening = true;
    this.zone.runOutsideAngular(() => {
      window.addEventListener('scroll', this.schedule, { passive: true });
      window.addEventListener('resize', this.schedule, { passive: true });
      this.resizeObserver?.observe(this.host);
    });
    this.schedule();
  }

  private stop(): void {
    if (this.listening) {
      this.listening = false;
      window.removeEventListener('scroll', this.schedule);
      window.removeEventListener('resize', this.schedule);
      this.resizeObserver?.disconnect();
    }
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.host.style.removeProperty('--dock');
    this.host.style.removeProperty('--dock-scale');
    this.host.style.removeProperty('--dock-title');
    this.host.classList.remove('is-docked');
  }

  // Pins where the picture sticks with the masthead showing (.watch-dock-probe:
  // the masthead, the notch and the gap). The masthead slides away on phones
  // while scrolling down; counting from it keeps the docking steady when it
  // does.
  private update(): void {
    const media = this.host.querySelector<HTMLElement>('.watch-media');
    const marker = this.host.querySelector<HTMLElement>('.watch-dock-marker');
    if (!media || !marker || media.offsetWidth === 0) {
      return;
    }

    const style = getComputedStyle(media);
    const width = media.offsetWidth;
    const height = media.offsetHeight;
    const thumbWidth = parseFloat(getComputedStyle(this.host).getPropertyValue('--dock-thumb-w')) || 112;
    const scale = Math.min(1, thumbWidth / width);
    // Where the picture would be without sticking, and where it sticks.
    const naturalTop = marker.getBoundingClientRect().top + window.scrollY + (parseFloat(style.marginTop) || 0);
    const pinsAt = naturalTop - (marker.querySelector<HTMLElement>('.watch-dock-probe')?.offsetHeight ?? 0);
    const distance = height * (1 - scale);
    const dock = distance > 0 ? Math.min(1, Math.max(0, (window.scrollY - pinsAt) / distance)) : 0;

    this.host.style.setProperty('--dock-scale', scale.toFixed(4));
    this.host.style.setProperty('--dock', dock.toFixed(4));
    this.host.style.setProperty('--dock-title', this.titleUnderBar().toFixed(4));
    this.host.classList.toggle('is-docked', dock >= 1);
  }

  private titleUnderBar(): number {
    const bar = this.host.querySelector<HTMLElement>('.watch-dock');
    const title = this.host.querySelector<HTMLElement>('.watch-title-row');
    if (!bar || !title) {
      return 0;
    }
    const titleRect = title.getBoundingClientRect();
    const covered = bar.getBoundingClientRect().bottom - titleRect.top;
    return titleRect.height > 0 ? Math.min(1, Math.max(0, covered / titleRect.height)) : 0;
  }
}
