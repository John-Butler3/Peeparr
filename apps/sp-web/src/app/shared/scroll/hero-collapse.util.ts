import { NgZone } from '@angular/core';

// Scroll-driven "collapsing hero" pages (scene/performer/studio) drive a
// --hero-collapse CSS variable (0..1) from how far the page has scrolled
// past the point where the sticky header pins to the top.
//
// The header shrinks by a known amount (the "shrink distance", resolved from
// CSS via the .hero-shrink-probe element so rem values and breakpoints are
// honoured), and the page scrolls 1:1 with that shrink: scrolling N px
// shrinks the header by N px. A spacer (margin-bottom on the sticky header,
// growing by the same amount the header shrinks) keeps the total flow height
// constant, so the content below scrolls natively -- attached to the bar's
// bottom edge during the collapse, and under the finished bar afterwards --
// with no script-driven content movement to jitter against the scroll.
export interface HeroCollapseState {
  // 0..1 across the header's shrink (after any .hero-collapse-delay section).
  progress: number;
  // 0..1 across the distance given by .hero-dock-probe, measured from the
  // moment the header pins. Lets pages animate things into place *before*
  // the collapse starts; 0 when the page has no dock probe.
  dock: number;
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export function measureHeroCollapse(host: HTMLElement): HeroCollapseState {
  const sentinel = host.querySelector('.hero-sentinel');
  const probe = host.querySelector<HTMLElement>('.hero-shrink-probe');
  if (!sentinel || !probe) {
    return { progress: 0, dock: 0 };
  }

  const shrinkPx = probe.offsetHeight;
  if (shrinkPx <= 0) {
    return { progress: 0, dock: 0 };
  }

  const pinOffset = sentinel.getBoundingClientRect().top + window.scrollY;
  const dockPx = host.querySelector<HTMLElement>('.hero-dock-probe')?.offsetHeight ?? 0;
  // Optional: pages whose title section should scroll away under the
  // pinned header before it starts collapsing mark that section with
  // .hero-collapse-delay; the collapse starts once it has scrolled past.
  const delayPx = host.querySelector<HTMLElement>('.hero-collapse-delay')?.offsetHeight ?? 0;

  return {
    progress: clamp01((window.scrollY - pinOffset - delayPx) / shrinkPx),
    dock: dockPx > 0 ? clamp01((window.scrollY - pinOffset) / dockPx) : 0,
  };
}

// Listens for scroll/resize/host-size changes outside Angular, coalesces them
// to one measurement per animation frame, and only re-enters Angular (once)
// when the progress value actually changed. Returns a teardown function.
export function observeHeroCollapse(
  host: HTMLElement,
  zone: NgZone,
  onChange: (progress: number, dock: number) => void,
): () => void {
  let frame = 0;
  let lastProgress = Number.NaN;
  let lastDock = Number.NaN;

  const update = (): void => {
    frame = 0;
    const next = measureHeroCollapse(host);
    if (next.progress === lastProgress && next.dock === lastDock) {
      return;
    }

    lastProgress = next.progress;
    lastDock = next.dock;
    zone.run(() => onChange(next.progress, next.dock));
  };

  const schedule = (): void => {
    if (frame === 0) {
      frame = requestAnimationFrame(update);
    }
  };

  const resizeObserver =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);

  zone.runOutsideAngular(() => {
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    resizeObserver?.observe(host);
  });
  schedule();

  return () => {
    window.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', schedule);
    resizeObserver?.disconnect();
    if (frame !== 0) {
      cancelAnimationFrame(frame);
    }
  };
}
