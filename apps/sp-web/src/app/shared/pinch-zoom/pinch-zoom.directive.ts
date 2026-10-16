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

interface View {
  scale: number;
  tx: number;
  ty: number;
}

/** The picture as shown fitted: its size and centre on the stage. */
interface Fitted {
  w: number;
  h: number;
  cx: number;
  cy: number;
}

/**
 * Photo zoom inside a full-screen stage, instead of the browser zooming the
 * page: pinch with two fingers, double-tap (or click with a mouse), the
 * scroll wheel or a trackpad pinch zoom around that point; drag to pan while
 * zoomed, and a fling glides on. At normal size the picture follows a
 * sideways drag and a swipe emits `swipe`; a tap beside it emits `dismiss`.
 *
 * Put it on the stage (positioned, filling the screen, picture centred in it
 * with object-fit: contain) and pass the picture as `pinchZoomTarget`. For
 * a carousel, pass the strip holding the neighbouring pictures (either side
 * of the current one, a stage width + SLIDE_GAP_PX away) as `pinchZoomTrack`:
 * swipes then drag the strip, and a swipe slides it a whole picture across.
 *
 * GPU limits: browsers clamp very large layers (Safari per side, which
 * squashes or stretches the picture), so the deepest zoom keeps the zoomed
 * picture within MAX_LAYER_PX device pixels.
 *
 * Smoothness: moves are a GPU transform, animated frame by frame. Sharpness:
 * a transform only stretches the picture as drawn at its fitted size, so once
 * things settle the picture is laid out at its zoomed size (up to its own
 * resolution) and the browser redraws it from the full image.
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
  static readonly ANIMATION_MS = 260;
  static readonly WHEEL_ANIMATION_MS = 140;
  /** Quiet time after moving before redrawing sharp. */
  static readonly SETTLE_MS = 120;
  /** Zoom at least this far, however small the picture... */
  static readonly MIN_MAX_SCALE = 3;
  /** ...and as far as this beyond actual pixels... */
  static readonly BEYOND_ACTUAL = 1.5;
  /** ...but never past this many device pixels along the picture's long side. */
  static readonly MAX_LAYER_PX = 8192;
  /** Space between pictures in a carousel strip. */
  static readonly SLIDE_GAP_PX = 24;
  static readonly SLIDE_MS = 280;

  private readonly stage = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);

  /** The picture, or a selector for it within the stage (looked up as needed). */
  @Input() pinchZoomTarget: HTMLElement | string | null = null;
  /** Off until the full picture has loaded: taps and swipes still work. */
  @Input() pinchZoomEnabled = true;
  private get target(): HTMLElement | null {
    const target = this.pinchZoomTarget;
    return typeof target === 'string' ? this.stage.querySelector<HTMLElement>(target) : target;
  }

  /** Carousel strip, moved by swipes (see above). */
  @Input() pinchZoomTrack: HTMLElement | null = null;
  @Input() pinchZoomHasPrevious = false;
  @Input() pinchZoomHasNext = false;

  @Output() readonly zoomedChange = new EventEmitter<boolean>();
  @Output() readonly swipe = new EventEmitter<'next' | 'previous'>();
  @Output() readonly dismiss = new EventEmitter<void>();

  /** What's on screen now. */
  private view: View = { scale: 1, tx: 0, ty: 0 };
  /** Where the running animation is heading. */
  private goal: View = { scale: 1, tx: 0, ty: 0 };
  private zoomed = false;
  private fitted: Fitted | null = null;
  /** Laid out at the zoomed size (sharp) rather than transformed. */
  private sharp = false;

  private readonly pointers = new Map<number, Point>();
  private gestureStart: { point: Point; time: number; type: string; onTarget: boolean } | null =
    null;
  private multiTouch = false;
  private moved = false;
  private pinch: { distance: number; scale: number; mid: Point } | null = null;
  /** Recent pan positions, for the fling speed. */
  private trail: { point: Point; time: number }[] = [];
  private lastTap: { point: Point; time: number } | null = null;

  private frame: number | null = null;
  private animation: { from: View; to: View; duration: number; start: number | null } | null = null;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;
  /** The carousel strip's sideways offset, and its slide animation. */
  private trackX = 0;
  private trackFrame: number | null = null;
  private trackFallback: ReturnType<typeof setTimeout> | null = null;
  private sharpTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    this.stage.setPointerCapture?.(event.pointerId);
    const point = this.local(event);
    this.pointers.set(event.pointerId, point);
    // Catch it where it is: stop gliding, back to the transform to move it.
    this.stopAnimation();
    this.stopTrack();
    this.cancelSharpen();
    this.render();
    if (this.pointers.size === 1) {
      this.gestureStart = {
        point,
        time: event.timeStamp,
        type: event.pointerType,
        onTarget: this.isOnTarget(event),
      };
      this.multiTouch = false;
      this.moved = false;
      this.trail = [{ point, time: event.timeStamp }];
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
      const raw = (this.pinch.scale * distance(a, b)) / this.pinch.distance;
      // Follow the fingers: move with the midpoint, zoom around it.
      const moved: View = {
        ...this.view,
        tx: this.view.tx + mid.x - this.pinch.mid.x,
        ty: this.view.ty + mid.y - this.pinch.mid.y,
      };
      this.pinch.mid = mid;
      this.setView(this.elasticPan(this.zoomedAround(moved, this.elasticScale(raw), mid)));
    } else if (this.pointers.size === 1 && !this.multiTouch) {
      this.trail.push({ point: current, time: event.timeStamp });
      if (this.trail.length > 5) {
        this.trail.shift();
      }
      if (this.view.scale > 1) {
        this.setView(
          this.elasticPan({
            ...this.view,
            tx: this.view.tx + current.x - previous.x,
            ty: this.view.ty + current.y - previous.y,
          }),
        );
      } else if (start && this.moved) {
        // At normal size a sideways drag moves the strip (or the picture),
        // reluctantly where there's no picture to come in.
        const dx = current.x - start.point.x;
        const neighbour = dx < 0 ? this.pinchZoomHasNext : this.pinchZoomHasPrevious;
        const x = this.pinchZoomTrack && !neighbour ? dx / 3 : dx;
        if (this.pinchZoomTrack) {
          this.setTrack(x);
        } else {
          this.setView({ scale: 1, tx: x, ty: 0 });
        }
      }
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
      this.trail = [];
      return;
    }
    if (this.pointers.size > 0) {
      this.startPinch();
      return;
    }

    const start = this.gestureStart;
    this.gestureStart = null;
    const single = !!start && !this.multiTouch && event.type !== 'pointercancel';
    if (single && !this.moved && event.timeStamp - start.time < PinchZoomDirective.TAP_MS) {
      this.pinch = null;
      this.onTap(point, start.type, start.onTarget, event.timeStamp);
      return;
    }
    if (single && this.view.scale <= 1) {
      const dx = point.x - start.point.x;
      const dy = point.y - start.point.y;
      const flick = Math.abs(this.flingVelocity().x) > 0.4 && Math.abs(dx) > 20;
      if (
        (Math.abs(dx) > PinchZoomDirective.SWIPE_PX || flick) &&
        Math.abs(dx) > Math.abs(dy) * 1.5
      ) {
        this.pinch = null;
        const direction = dx < 0 ? 'next' : 'previous';
        if (!this.slide(direction)) {
          this.reset();
          this.emit(() => this.swipe.emit(direction));
        }
        return;
      }
      if (this.trackX !== 0) {
        this.pinch = null;
        this.animateTrack(0);
        return;
      }
    }
    this.settle(single);
    this.pinch = null;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (!this.canZoom()) {
      return;
    }
    // Trackpad pinches arrive as ctrl+wheel with small steps.
    const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002));
    // Steps add up on the goal, and the view eases after it.
    const from = this.animation ? this.goal : this.view;
    const scale = Math.min(this.maxScale(), Math.max(1, from.scale * factor));
    this.animateTo(
      this.clamped(this.zoomedAround(from, scale, this.local(event))),
      PinchZoomDirective.WHEEL_ANIMATION_MS,
    );
  };

  // A new screen size changes the fitted size: start again from fitted.
  private readonly onResize = (): void => this.reset();

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
      window.addEventListener('resize', this.onResize);
    });
  }

  ngOnDestroy(): void {
    this.clearDismissTimer();
    this.cancelSharpen();
    this.stopAnimation();
    this.stopTrack();
    if (this.trackFallback) {
      clearTimeout(this.trackFallback);
    }
    window.removeEventListener('resize', this.onResize);
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

  /**
   * Slides the carousel strip a whole picture across, then emits `swipe`
   * (the host shows that picture and calls reset(), which recentres the
   * strip in the same render). False when there's no strip or neighbour.
   */
  slide(direction: 'next' | 'previous'): boolean {
    const neighbour = direction === 'next' ? this.pinchZoomHasNext : this.pinchZoomHasPrevious;
    if (!this.pinchZoomTrack || !neighbour) {
      return false;
    }
    this.reset();
    const distance = this.stage.clientWidth + PinchZoomDirective.SLIDE_GAP_PX;
    this.animateTrack(direction === 'next' ? -distance : distance, () => {
      this.emit(() => this.swipe.emit(direction));
      // In case the host doesn't reset: don't leave the strip slid away.
      this.trackFallback = setTimeout(() => this.setTrack(0), 250);
    });
    return true;
  }

  /** Back to fitted: at once (next picture), or animated (Esc). */
  reset(animate = false): void {
    this.cancelSharpen();
    if (!animate) {
      this.stopTrack();
      this.setTrack(0);
    }
    if (animate && !sameView(this.view, FITTED)) {
      this.animateTo(FITTED, PinchZoomDirective.ANIMATION_MS);
      return;
    }
    this.stopAnimation();
    this.setView(FITTED);
    this.fitted = null;
  }

  /** Fitted <-> close up (about actual pixels), around a point on the stage. */
  toggleAt(point: Point): void {
    if (!this.canZoom()) {
      return;
    }
    const current = this.animation ? this.goal : this.view;
    if (current.scale > 1) {
      this.animateTo(FITTED, PinchZoomDirective.ANIMATION_MS);
      return;
    }
    const goal = this.clamped(this.zoomedAround(this.view, this.closeUpScale(), point));
    this.animateTo(goal, PinchZoomDirective.ANIMATION_MS);
  }

  private onTap(point: Point, type: string, onTarget: boolean, time: number): void {
    if (type === 'mouse') {
      if (onTarget || this.view.scale > 1) {
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
    if (this.view.scale > 1) {
      // A tap while zoomed changes nothing: redraw sharp again.
      this.scheduleSharpen(PinchZoomDirective.SETTLE_MS);
    } else if (!onTarget) {
      this.clearDismissTimer();
      this.dismissTimer = setTimeout(() => {
        this.dismissTimer = null;
        this.emit(() => this.dismiss.emit());
      }, PinchZoomDirective.DOUBLE_TAP_MS);
    }
  }

  /**
   * After fingers lift: back to fitted if (nearly) zoomed out; otherwise
   * glide on with a fling, spring back inside the limits, then redraw sharp.
   */
  private settle(fling: boolean): void {
    if (this.view.scale <= 1.02) {
      this.animateTo(FITTED, PinchZoomDirective.ANIMATION_MS);
      return;
    }
    let goal = this.view;
    if (goal.scale > this.maxScale()) {
      goal = this.zoomedAround(goal, this.maxScale(), this.pinch?.mid ?? this.stageCentre());
    }
    if (fling) {
      const velocity = this.flingVelocity();
      // How far a fling glides: its speed (px/ms) x a short time.
      goal = { ...goal, tx: goal.tx + velocity.x * 180, ty: goal.ty + velocity.y * 180 };
    }
    goal = this.clamped(goal);
    if (sameView(goal, this.view)) {
      this.scheduleSharpen(PinchZoomDirective.SETTLE_MS);
      return;
    }
    this.animateTo(goal, PinchZoomDirective.ANIMATION_MS);
  }

  private flingVelocity(): Point {
    const trail = this.trail;
    if (trail.length < 2) {
      return { x: 0, y: 0 };
    }
    const first = trail[0];
    const last = trail[trail.length - 1];
    const ms = last.time - first.time;
    // Only a quick, recent movement counts as a fling.
    if (ms <= 0 || ms > 120) {
      return { x: 0, y: 0 };
    }
    return { x: (last.point.x - first.point.x) / ms, y: (last.point.y - first.point.y) / ms };
  }

  private startPinch(): void {
    const [a, b] = [...this.pointers.values()];
    this.pinch = {
      distance: Math.max(1, distance(a, b)),
      scale: this.view.scale,
      mid: midpoint(a, b),
    };
  }

  private canZoom(): boolean {
    const fitted = this.measure();
    return this.pinchZoomEnabled && !!fitted && fitted.w > 0 && fitted.h > 0;
  }

  /**
   * The picture's fitted size and centre, measured while it isn't zoomed:
   * from its box, narrowed to its own shape (object-fit: contain may
   * letterbox it inside the box).
   */
  private measure(): Fitted | null {
    const target = this.target;
    if (!target) {
      return null;
    }
    if (this.fitted && (this.view.scale !== 1 || this.sharp)) {
      return this.fitted;
    }
    const box = target.getBoundingClientRect();
    const stage = this.stage.getBoundingClientRect();
    let w: number;
    let h: number;
    let cx: number;
    let cy: number;
    if (box.width > 0 && box.height > 0) {
      // Exact (fractional) size; take off any sideways drag at 1x.
      w = box.width;
      h = box.height;
      cx = box.left - stage.left + w / 2 - this.view.tx - this.trackX;
      cy = box.top - stage.top + h / 2 - this.view.ty;
    } else {
      w = target.offsetWidth;
      h = target.offsetHeight;
      cx = target.offsetLeft + w / 2;
      cy = target.offsetTop + h / 2;
    }
    const image = target as HTMLImageElement;
    if (image.naturalWidth > 0 && image.naturalHeight > 0 && w > 0 && h > 0) {
      const fit = Math.min(w / image.naturalWidth, h / image.naturalHeight);
      w = image.naturalWidth * fit;
      h = image.naturalHeight * fit;
    }
    this.fitted = { w, h, cx, cy };
    return this.fitted;
  }

  /** About actual pixels, but always a real step in (2.5x or more). */
  private closeUpScale(): number {
    return Math.min(this.maxScale(), Math.max(2.5, this.actualPixelsScale()));
  }

  private maxScale(): number {
    const wanted = Math.max(
      PinchZoomDirective.MIN_MAX_SCALE,
      this.actualPixelsScale() * PinchZoomDirective.BEYOND_ACTUAL,
    );
    const fitted = this.measure();
    const longSide = fitted ? Math.max(fitted.w, fitted.h) * (globalThis.devicePixelRatio || 1) : 0;
    const layerLimit = longSide > 0 ? PinchZoomDirective.MAX_LAYER_PX / longSide : wanted;
    return Math.max(1, Math.min(wanted, layerLimit));
  }

  /** Picture pixels per screen (device) pixel when fitted. */
  private actualPixelsScale(): number {
    const natural = (this.target as HTMLImageElement | null)?.naturalWidth ?? 0;
    const shown = (this.measure()?.w ?? 0) * (globalThis.devicePixelRatio || 1);
    return shown > 0 && natural > 0 ? natural / shown : 1;
  }

  /** Past the limits a pinch goes on, but resists (and springs back after). */
  private elasticScale(raw: number): number {
    const max = this.maxScale();
    if (raw < 1) {
      return 1 - (1 - raw) * 0.4;
    }
    if (raw > max) {
      return max * (1 + Math.log(raw / max) * 0.3);
    }
    return raw;
  }

  /** Dragging past an edge moves at a third of the speed. */
  private elasticPan(view: View): View {
    const limits = this.limits(view.scale);
    const resist = (value: number, limit: number) =>
      value > limit
        ? limit + (value - limit) / 3
        : value < -limit
          ? -limit + (value + limit) / 3
          : value;
    return { ...view, tx: resist(view.tx, limits.x), ty: resist(view.ty, limits.y) };
  }

  /** `view` scaled to `scale`, keeping the picture point under `point` there. */
  private zoomedAround(view: View, scale: number, point: Point): View {
    const fitted = this.measure();
    if (!fitted) {
      return view;
    }
    // Offset of the point from the picture's centre, in fitted pixels.
    const dx = (point.x - fitted.cx - view.tx) / view.scale;
    const dy = (point.y - fitted.cy - view.ty) / view.scale;
    return { scale, tx: point.x - fitted.cx - scale * dx, ty: point.y - fitted.cy - scale * dy };
  }

  /** Within limits: 1x to max, and no empty space past the picture's edges. */
  private clamped(view: View): View {
    const scale = Math.min(this.maxScale(), Math.max(1, view.scale));
    if (scale === 1) {
      return FITTED;
    }
    const limits = this.limits(scale);
    return {
      scale,
      tx: Math.min(limits.x, Math.max(-limits.x, view.tx)),
      ty: Math.min(limits.y, Math.max(-limits.y, view.ty)),
    };
  }

  private limits(scale: number): Point {
    const fitted = this.measure();
    if (!fitted) {
      return { x: 0, y: 0 };
    }
    return {
      x: Math.max(0, (fitted.w * scale - this.stage.clientWidth) / 2),
      y: Math.max(0, (fitted.h * scale - this.stage.clientHeight) / 2),
    };
  }

  private stageCentre(): Point {
    return { x: this.stage.clientWidth / 2, y: this.stage.clientHeight / 2 };
  }

  private animateTo(goal: View, duration: number): void {
    this.cancelSharpen();
    this.goal = goal;
    this.animation = { from: { ...this.view }, to: goal, duration, start: null };
    this.updateZoomed(goal.scale > 1);
    if (this.frame === null) {
      this.frame = requestFrame(this.step);
    }
  }

  private readonly step = (now: number): void => {
    this.frame = null;
    const animation = this.animation;
    if (!animation) {
      return;
    }
    animation.start ??= now;
    const t = Math.min(1, (now - animation.start) / animation.duration);
    const e = easeOutCubic(t);
    const { from, to } = animation;
    this.view = {
      scale: from.scale + (to.scale - from.scale) * e,
      tx: from.tx + (to.tx - from.tx) * e,
      ty: from.ty + (to.ty - from.ty) * e,
    };
    this.render();
    if (t < 1) {
      this.frame = requestFrame(this.step);
      return;
    }
    this.animation = null;
    if (to.scale <= 1) {
      this.reset();
    } else {
      this.scheduleSharpen(PinchZoomDirective.SETTLE_MS);
    }
  };

  private stopAnimation(): void {
    if (this.frame !== null) {
      cancelFrame(this.frame);
      this.frame = null;
    }
    this.animation = null;
  }

  private setView(view: View): void {
    this.view = view;
    this.render();
    this.updateZoomed(view.scale > 1);
  }

  /** Shows the view as a transform (quick, for anything moving). */
  private render(): void {
    const target = this.target;
    if (!target) {
      return;
    }
    this.unsharpen(target);
    const { scale, tx, ty } = this.view;
    const still = sameView(this.view, FITTED);
    target.style.transform = still ? '' : `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
    target.style.willChange = still ? '' : 'transform';
  }

  private updateZoomed(zoomed: boolean): void {
    if (zoomed !== this.zoomed) {
      this.zoomed = zoomed;
      this.emit(() => this.zoomedChange.emit(zoomed));
    }
  }

  private scheduleSharpen(delayMs: number): void {
    this.cancelSharpen();
    this.sharpTimer = setTimeout(() => {
      this.sharpTimer = null;
      this.sharpen();
    }, delayMs);
  }

  private cancelSharpen(): void {
    if (this.sharpTimer) {
      clearTimeout(this.sharpTimer);
      this.sharpTimer = null;
    }
  }

  /**
   * Lays the picture out at its zoomed size, in the same place on screen,
   * so it's drawn from the full image. No transform is left on it: a big
   * transformed layer is what browsers clamp (and distort).
   */
  private sharpen(): void {
    const target = this.target;
    const fitted = this.measure();
    const { scale, tx, ty } = this.view;
    if (!target || !fitted || scale <= 1 || this.pointers.size > 0 || this.animation) {
      return;
    }
    const width = fitted.w * scale;
    const height = fitted.h * scale;
    Object.assign(target.style, {
      transform: 'none',
      willChange: '',
      position: 'absolute',
      left: `${fitted.cx + tx - width / 2}px`,
      top: `${fitted.cy + ty - height / 2}px`,
      width: `${width}px`,
      height: `${height}px`,
      maxWidth: 'none',
      maxHeight: 'none',
    });
    this.sharp = true;
  }

  private unsharpen(target: HTMLElement): void {
    if (!this.sharp) {
      return;
    }
    for (const property of [
      'position',
      'left',
      'top',
      'width',
      'height',
      'maxWidth',
      'maxHeight',
    ] as const) {
      target.style[property] = '';
    }
    this.sharp = false;
  }

  private setTrack(x: number): void {
    this.trackX = x;
    if (this.trackFallback) {
      clearTimeout(this.trackFallback);
      this.trackFallback = null;
    }
    const track = this.pinchZoomTrack;
    if (track) {
      track.style.transform = x ? `translate3d(${x}px, 0, 0)` : '';
    }
  }

  private animateTrack(to: number, done?: () => void): void {
    this.stopTrack();
    const from = this.trackX;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now;
      const t = Math.min(1, (now - start) / PinchZoomDirective.SLIDE_MS);
      this.setTrack(from + (to - from) * easeOutCubic(t));
      if (t < 1) {
        this.trackFrame = requestFrame(step);
      } else {
        this.trackFrame = null;
        done?.();
      }
    };
    this.trackFrame = requestFrame(step);
  }

  private stopTrack(): void {
    if (this.trackFrame !== null) {
      cancelFrame(this.trackFrame);
      this.trackFrame = null;
    }
  }

  private local(event: MouseEvent): Point {
    const rect = this.stage.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private isOnTarget(event: Event): boolean {
    const target = this.target;
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

const FITTED: View = { scale: 1, tx: 0, ty: 0 };

function requestFrame(callback: (now: number) => void): number {
  return typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(callback)
    : (setTimeout(() => callback(Date.now()), 16) as unknown as number);
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle);
  } else {
    clearTimeout(handle);
  }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function sameView(a: View, b: View): boolean {
  return (
    Math.abs(a.scale - b.scale) < 1e-4 && Math.abs(a.tx - b.tx) < 0.5 && Math.abs(a.ty - b.ty) < 0.5
  );
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
