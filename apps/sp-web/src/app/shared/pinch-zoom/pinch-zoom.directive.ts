import {
  Directive,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnDestroy,
  Output,
  inject,
} from '@angular/core';

interface Point {
  x: number;
  y: number;
}

/**
 * Photo zoom inside a full-screen stage, instead of the browser zooming the
 * page: pinch with two fingers, double-tap (or click with a mouse), the
 * scroll wheel or a trackpad pinch zoom the target picture around that
 * point; drag to pan it while zoomed. At normal size, a sideways swipe emits
 * `swipe` and a tap beside the picture emits `dismiss`.
 *
 * Put it on the stage (positioned, filling the screen, picture centred in
 * it) and pass the picture as `pinchZoomTarget`.
 */
@Directive({
  selector: '[appPinchZoom]',
  host: { style: 'touch-action: none' },
})
export class PinchZoomDirective implements OnDestroy {
  static readonly TAP_SLOP_PX = 10;
  static readonly TAP_MS = 300;
  static readonly DOUBLE_TAP_MS = 300;
  static readonly SWIPE_PX = 60;
  static readonly ANIMATION_MS = 200;
  /** Zoom at least this far, however small the picture. */
  static readonly MIN_MAX_SCALE = 4;

  private readonly stage = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);

  @Input() pinchZoomTarget: HTMLElement | null = null;
  /** Off until the full picture has loaded: taps and swipes still work. */
  @Input() pinchZoomEnabled = true;

  @Output() readonly zoomedChange = new EventEmitter<boolean>();
  @Output() readonly swipe = new EventEmitter<'next' | 'previous'>();
  @Output() readonly dismiss = new EventEmitter<void>();

  private scale = 1;
  private tx = 0;
  private ty = 0;
  private zoomed = false;

  private readonly pointers = new Map<number, Point>();
  private gestureStart: { point: Point; time: number; type: string; onTarget: boolean } | null =
    null;
  private multiTouch = false;
  private moved = false;
  private pinch: { distance: number; scale: number; mid: Point } | null = null;
  private lastTap: { point: Point; time: number } | null = null;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    this.stage.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, this.local(event));
    this.setTransition(false);
    if (this.pointers.size === 1) {
      this.gestureStart = {
        point: this.local(event),
        time: event.timeStamp,
        type: event.pointerType,
        onTarget: this.isOnTarget(event),
      };
      this.multiTouch = false;
      this.moved = false;
    } else if (this.pointers.size === 2) {
      this.multiTouch = true;
      this.startPinch();
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) {
      return;
    }
    const current = this.local(event);
    this.pointers.set(event.pointerId, current);
    const start = this.gestureStart;
    if (start && distance(current, start.point) > PinchZoomDirective.TAP_SLOP_PX) {
      this.moved = true;
    }

    if (this.pointers.size >= 2 && this.pinch && this.canZoom()) {
      const [a, b] = [...this.pointers.values()];
      const mid = midpoint(a, b);
      const nextScale = (this.pinch.scale * distance(a, b)) / this.pinch.distance;
      // Follow the fingers: zoom around the midpoint, and move with it.
      this.tx += mid.x - this.pinch.mid.x;
      this.ty += mid.y - this.pinch.mid.y;
      this.pinch.mid = mid;
      this.zoomAt(nextScale, mid, false);
    } else if (this.pointers.size === 1 && this.scale > 1) {
      this.tx += current.x - previous.x;
      this.ty += current.y - previous.y;
      this.clampAndApply();
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.pointers.has(event.pointerId)) {
      return;
    }
    const point = this.local(event);
    this.pointers.delete(event.pointerId);
    if (this.pointers.size === 1) {
      // One finger left after a pinch: carry on panning from it.
      this.pinch = null;
      return;
    }
    if (this.pointers.size > 0) {
      this.startPinch();
      return;
    }
    this.pinch = null;
    if (this.scale < 1.02) {
      this.reset(true);
    }

    const start = this.gestureStart;
    this.gestureStart = null;
    if (!start || this.multiTouch || event.type === 'pointercancel') {
      return;
    }
    const dx = point.x - start.point.x;
    const dy = point.y - start.point.y;
    if (!this.moved && event.timeStamp - start.time < PinchZoomDirective.TAP_MS) {
      this.onTap(point, start.type, start.onTarget, event.timeStamp);
    } else if (
      this.scale === 1 &&
      Math.abs(dx) > PinchZoomDirective.SWIPE_PX &&
      Math.abs(dx) > Math.abs(dy) * 1.5
    ) {
      this.emit(() => this.swipe.emit(dx < 0 ? 'next' : 'previous'));
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (!this.canZoom()) {
      return;
    }
    this.setTransition(false);
    // Trackpad pinches arrive as ctrl+wheel with small steps.
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
    this.zoomAt(this.scale * factor, this.local(event), false);
    if (this.scale < 1.02) {
      this.reset(false);
    }
  };

  // Safari's own pinch-to-zoom of the page.
  private readonly preventGesture = (event: Event): void => event.preventDefault();

  // The stage handles its own taps; the click that follows must not reach
  // anything underneath (like an overlay that closes on click).
  private readonly stopClick = (event: MouseEvent): void => event.stopPropagation();

  constructor() {
    this.zone.runOutsideAngular(() => {
      this.stage.addEventListener('pointerdown', this.onPointerDown);
      this.stage.addEventListener('pointermove', this.onPointerMove);
      this.stage.addEventListener('pointerup', this.onPointerUp);
      this.stage.addEventListener('pointercancel', this.onPointerUp);
      this.stage.addEventListener('wheel', this.onWheel, { passive: false });
      this.stage.addEventListener('gesturestart', this.preventGesture);
      this.stage.addEventListener('gesturechange', this.preventGesture);
      this.stage.addEventListener('click', this.stopClick);
    });
  }

  ngOnDestroy(): void {
    this.clearDismissTimer();
    this.stage.removeEventListener('pointerdown', this.onPointerDown);
    this.stage.removeEventListener('pointermove', this.onPointerMove);
    this.stage.removeEventListener('pointerup', this.onPointerUp);
    this.stage.removeEventListener('pointercancel', this.onPointerUp);
    this.stage.removeEventListener('wheel', this.onWheel);
    this.stage.removeEventListener('gesturestart', this.preventGesture);
    this.stage.removeEventListener('gesturechange', this.preventGesture);
    this.stage.removeEventListener('click', this.stopClick);
  }

  get isZoomed(): boolean {
    return this.zoomed;
  }

  /** Back to fitted, e.g. for the next picture or Esc. */
  reset(animate = false): void {
    this.setTransition(animate);
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this.apply();
  }

  /** Fitted <-> close up (about actual pixels), around a point on the stage. */
  toggleAt(point: Point): void {
    if (!this.canZoom()) {
      return;
    }
    if (this.scale > 1) {
      this.reset(true);
      return;
    }
    this.zoomAt(this.closeUpScale(), point, true);
  }

  private onTap(point: Point, type: string, onTarget: boolean, time: number): void {
    if (type === 'mouse') {
      if (onTarget || this.scale > 1) {
        this.toggleAt(point);
      } else {
        this.emit(() => this.dismiss.emit());
      }
      return;
    }
    // Touch: double-tap zooms; a single tap beside the picture closes, once
    // it's clear no second tap is coming.
    const last = this.lastTap;
    if (
      last &&
      time - last.time < PinchZoomDirective.DOUBLE_TAP_MS &&
      distance(point, last.point) < 40
    ) {
      this.lastTap = null;
      this.clearDismissTimer();
      this.toggleAt(point);
      return;
    }
    this.lastTap = { point, time };
    if (!onTarget && this.scale === 1) {
      this.clearDismissTimer();
      this.dismissTimer = setTimeout(() => {
        this.dismissTimer = null;
        this.emit(() => this.dismiss.emit());
      }, PinchZoomDirective.DOUBLE_TAP_MS);
    }
  }

  private startPinch(): void {
    const [a, b] = [...this.pointers.values()];
    this.pinch = { distance: Math.max(1, distance(a, b)), scale: this.scale, mid: midpoint(a, b) };
  }

  private canZoom(): boolean {
    const target = this.pinchZoomTarget;
    return this.pinchZoomEnabled && !!target && target.offsetWidth > 0 && target.offsetHeight > 0;
  }

  /** About actual pixels, but always a real step in (2.5x or more). */
  private closeUpScale(): number {
    return Math.min(this.maxScale(), Math.max(2.5, this.actualPixelsScale()));
  }

  private maxScale(): number {
    return Math.max(PinchZoomDirective.MIN_MAX_SCALE, this.actualPixelsScale() * 2);
  }

  /** Picture pixels per screen (device) pixel when fitted. */
  private actualPixelsScale(): number {
    const target = this.pinchZoomTarget as HTMLImageElement | null;
    const natural = target?.naturalWidth ?? 0;
    const shown = (target?.offsetWidth ?? 0) * (globalThis.devicePixelRatio || 1);
    return shown > 0 && natural > 0 ? natural / shown : 1;
  }

  /** Scales to `nextScale`, keeping the picture point under `point` there. */
  private zoomAt(nextScale: number, point: Point, animate: boolean): void {
    const target = this.pinchZoomTarget;
    if (!target) {
      return;
    }
    const clamped = Math.min(this.maxScale(), Math.max(1, nextScale));
    const centre = this.targetCentre(target);
    // Offset of the point from the picture's centre, in unscaled pixels.
    const dx = (point.x - centre.x - this.tx) / this.scale;
    const dy = (point.y - centre.y - this.ty) / this.scale;
    this.scale = clamped;
    this.tx = point.x - centre.x - clamped * dx;
    this.ty = point.y - centre.y - clamped * dy;
    this.setTransition(animate);
    this.clampAndApply();
  }

  /** No empty space dragged into view: edges stop at the stage's edges. */
  private clampAndApply(): void {
    const target = this.pinchZoomTarget;
    if (target) {
      const limitX = Math.max(0, (target.offsetWidth * this.scale - this.stage.clientWidth) / 2);
      const limitY = Math.max(0, (target.offsetHeight * this.scale - this.stage.clientHeight) / 2);
      this.tx = Math.min(limitX, Math.max(-limitX, this.tx));
      this.ty = Math.min(limitY, Math.max(-limitY, this.ty));
    }
    this.apply();
  }

  private apply(): void {
    const target = this.pinchZoomTarget;
    if (target) {
      target.style.transform =
        this.scale === 1 ? '' : `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
    }
    const zoomed = this.scale > 1;
    if (zoomed !== this.zoomed) {
      this.zoomed = zoomed;
      this.emit(() => this.zoomedChange.emit(zoomed));
    }
  }

  private setTransition(animate: boolean): void {
    const target = this.pinchZoomTarget;
    if (target) {
      target.style.transition = animate
        ? `transform ${PinchZoomDirective.ANIMATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
        : 'none';
    }
  }

  private targetCentre(target: HTMLElement): Point {
    return {
      x: target.offsetLeft + target.offsetWidth / 2,
      y: target.offsetTop + target.offsetHeight / 2,
    };
  }

  private local(event: MouseEvent): Point {
    const rect = this.stage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private isOnTarget(event: Event): boolean {
    const target = this.pinchZoomTarget;
    return !!target && event.target instanceof Node && target.contains(event.target);
  }

  private clearDismissTimer(): void {
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
  }

  private emit(fn: () => void): void {
    this.zone.run(fn);
  }
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
