import { Component, ElementRef, NgZone, OnDestroy, inject } from '@angular/core';
import { NavigationHistoryService } from '../../core/navigation/navigation-history.service';

/**
 * Phones: swipe right from the left edge to go back, like the "Back to ..."
 * button (and the system gesture on iOS / Android). A round arrow follows
 * the finger in from the edge; past ARM_PX (or with a quick flick) letting
 * go goes back, otherwise it slides away again.
 *
 * Only from the edge, so sideways swipes elsewhere (the banner, rows, the
 * photo viewer) keep working; not where there's nothing to go back to, and
 * not on videos, sliders, form fields or inside [data-no-swipe-back].
 */
@Component({
  selector: 'app-edge-swipe-back',
  template: `<div class="edge-back" aria-hidden="true">
    <i class="pi pi-chevron-left"></i>
  </div>`,
  styleUrl: './edge-swipe-back.component.scss',
})
export class EdgeSwipeBackComponent implements OnDestroy {
  /** Start within this distance of the left edge. */
  static readonly EDGE_PX = 24;
  /** Drag this far to go back on release... */
  static readonly ARM_PX = 90;
  /** ...or flick at least this fast (px/ms) and this far. */
  static readonly FLICK_SPEED = 0.6;
  static readonly FLICK_PX = 40;
  /** How far in the arrow comes. */
  static readonly MAX_PULL_PX = 72;
  static readonly SIZE_PX = 44;

  private readonly history = inject(NavigationHistoryService);
  private readonly zone = inject(NgZone);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  private gesture: { x: number; y: number; time: number; sideways: boolean | null } | null = null;
  private dx = 0;

  private readonly onStart = (event: TouchEvent): void => {
    this.gesture = null;
    const touch = event.touches[0];
    if (
      event.touches.length !== 1 ||
      !touch ||
      touch.clientX > EdgeSwipeBackComponent.EDGE_PX ||
      document.fullscreenElement ||
      excluded(event.target) ||
      !this.history.canGoBack()
    ) {
      return;
    }
    this.gesture = { x: touch.clientX, y: touch.clientY, time: event.timeStamp, sideways: null };
    this.dx = 0;
  };

  private readonly onMove = (event: TouchEvent): void => {
    const gesture = this.gesture;
    const touch = event.touches[0];
    if (!gesture || !touch) {
      return;
    }
    const dx = touch.clientX - gesture.x;
    const dy = touch.clientY - gesture.y;
    if (gesture.sideways === null) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) {
        return;
      }
      // Decided once: rightwards and more sideways than up/down, else it's
      // a scroll and left alone.
      gesture.sideways = dx > 0 && dx > Math.abs(dy);
      if (!gesture.sideways) {
        this.gesture = null;
        return;
      }
    }
    // Ours now: don't also scroll a row or the page.
    event.preventDefault();
    this.dx = Math.max(0, dx);
    this.show(this.dx, gesture.y, false);
  };

  private readonly onEnd = (event: TouchEvent): void => {
    const gesture = this.gesture;
    this.gesture = null;
    if (!gesture?.sideways) {
      return;
    }
    const speed = this.dx / Math.max(1, event.timeStamp - gesture.time);
    const goBack =
      event.type === 'touchend' &&
      (this.dx > EdgeSwipeBackComponent.ARM_PX ||
        (speed > EdgeSwipeBackComponent.FLICK_SPEED && this.dx > EdgeSwipeBackComponent.FLICK_PX));
    this.show(0, gesture.y, true);
    if (goBack) {
      this.zone.run(() => this.history.back());
    }
  };

  constructor() {
    this.zone.runOutsideAngular(() => {
      document.addEventListener('touchstart', this.onStart, { passive: true });
      // Not passive: once it's a back swipe, the page mustn't scroll too.
      document.addEventListener('touchmove', this.onMove, { passive: false });
      document.addEventListener('touchend', this.onEnd);
      document.addEventListener('touchcancel', this.onEnd);
    });
  }

  ngOnDestroy(): void {
    document.removeEventListener('touchstart', this.onStart);
    document.removeEventListener('touchmove', this.onMove);
    document.removeEventListener('touchend', this.onEnd);
    document.removeEventListener('touchcancel', this.onEnd);
  }

  /** The arrow: in from the edge with the finger, brighter once armed. */
  private show(dx: number, y: number, settling: boolean): void {
    const arrow = this.host.querySelector<HTMLElement>('.edge-back');
    if (!arrow) {
      return;
    }
    const size = EdgeSwipeBackComponent.SIZE_PX;
    // Comes in quickly at first, then eases to a stop.
    const pull = EdgeSwipeBackComponent.MAX_PULL_PX * (1 - Math.exp(-dx / 90));
    const armed = dx > EdgeSwipeBackComponent.ARM_PX;
    arrow.classList.toggle('is-armed', armed);
    arrow.classList.toggle('is-settling', settling);
    arrow.style.top = `${y - size / 2}px`;
    arrow.style.transform = `translateX(${pull - size}px)`;
    arrow.style.opacity = dx > 0 ? String(Math.min(1, dx / 40)) : '0';
  }
}

function excluded(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    !!target.closest(
      '[data-no-swipe-back], video, input, textarea, select, [role="slider"], [contenteditable="true"]',
    )
  );
}
