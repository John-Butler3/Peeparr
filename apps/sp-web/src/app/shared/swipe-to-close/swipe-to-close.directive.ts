import { Directive, ElementRef, EventEmitter, Input, NgZone, OnDestroy, Output, inject } from '@angular/core';

/**
 * Bottom sheets: drag down to dismiss. The sheet follows the finger (and an
 * optional backdrop fades with it); let go past a quarter of its height, or
 * with a quick flick, and it slides away and emits `swipeClose`; otherwise it
 * springs back. Only starts when the sheet is scrolled to the top, so
 * scrolling its contents still works.
 */
@Directive({
  selector: '[appSwipeToClose]',
})
export class SwipeToCloseDirective implements OnDestroy {
  /** Fraction of the sheet's height to drag before letting go closes it. */
  static readonly CLOSE_FRACTION = 0.25;
  /** Or a flick at least this fast (px/ms). */
  static readonly CLOSE_VELOCITY = 0.5;
  static readonly SLOP_PX = 6;
  static readonly ANIMATION_MS = 200;

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);

  /** Faded out as the sheet is dragged away. */
  @Input() swipeBackdrop: HTMLElement | null = null;
  @Output() readonly swipeClose = new EventEmitter<void>();

  private startY = 0;
  private startTime = 0;
  private offset = 0;
  private tracking = false;
  private dragging = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  private readonly onStart = (event: TouchEvent): void => {
    if (event.touches.length !== 1) {
      return;
    }
    this.startY = event.touches[0].clientY;
    this.startTime = event.timeStamp;
    this.offset = 0;
    this.tracking = true;
    this.dragging = false;
  };

  private readonly onMove = (event: TouchEvent): void => {
    if (!this.tracking) {
      return;
    }
    const dy = event.touches[0].clientY - this.startY;
    if (!this.dragging) {
      // Only a downward drag from the top of the sheet's scroll; anything
      // else is scrolling.
      if (dy > SwipeToCloseDirective.SLOP_PX && this.element.scrollTop <= 0) {
        this.dragging = true;
        this.element.style.animation = 'none';
        this.element.style.transition = 'none';
        if (this.swipeBackdrop) {
          this.swipeBackdrop.style.animation = 'none';
          this.swipeBackdrop.style.transition = 'none';
        }
      } else if (Math.abs(dy) > SwipeToCloseDirective.SLOP_PX) {
        this.tracking = false;
        return;
      } else {
        return;
      }
    }
    event.preventDefault();
    this.offset = Math.max(0, dy - SwipeToCloseDirective.SLOP_PX);
    this.apply(this.offset);
  };

  private readonly onEnd = (event: TouchEvent): void => {
    if (!this.dragging) {
      this.tracking = false;
      return;
    }
    this.tracking = false;
    this.dragging = false;
    const height = this.element.offsetHeight || 1;
    const velocity = this.offset / Math.max(1, event.timeStamp - this.startTime);
    const close =
      this.offset > height * SwipeToCloseDirective.CLOSE_FRACTION ||
      velocity > SwipeToCloseDirective.CLOSE_VELOCITY;

    const ease = `${SwipeToCloseDirective.ANIMATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    this.element.style.transition = `transform ${ease}`;
    if (this.swipeBackdrop) {
      this.swipeBackdrop.style.transition = `opacity ${ease}`;
    }
    if (close) {
      this.apply(height);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.zone.run(() => this.swipeClose.emit());
        this.reset();
      }, SwipeToCloseDirective.ANIMATION_MS);
    } else {
      this.apply(0);
      this.timer = setTimeout(() => this.reset(), SwipeToCloseDirective.ANIMATION_MS);
    }
  };

  constructor() {
    this.zone.runOutsideAngular(() => {
      this.element.addEventListener('touchstart', this.onStart, { passive: true });
      // Not passive: a drag stops the page scrolling underneath.
      this.element.addEventListener('touchmove', this.onMove, { passive: false });
      this.element.addEventListener('touchend', this.onEnd);
      this.element.addEventListener('touchcancel', this.onEnd);
    });
  }

  ngOnDestroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.element.removeEventListener('touchstart', this.onStart);
    this.element.removeEventListener('touchmove', this.onMove);
    this.element.removeEventListener('touchend', this.onEnd);
    this.element.removeEventListener('touchcancel', this.onEnd);
  }

  private apply(offset: number): void {
    this.element.style.transform = offset > 0 ? `translateY(${offset}px)` : '';
    if (this.swipeBackdrop) {
      const height = this.element.offsetHeight || 1;
      this.swipeBackdrop.style.opacity = String(Math.max(0, 1 - offset / height));
    }
  }

  private reset(): void {
    for (const el of [this.element, this.swipeBackdrop]) {
      if (el) {
        el.style.transition = '';
        el.style.transform = '';
        el.style.opacity = '';
      }
    }
  }
}
