import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PinchZoomDirective } from './pinch-zoom.directive';

@Component({
  imports: [PinchZoomDirective],
  template: `
    <div
      class="stage"
      appPinchZoom
      [pinchZoomTarget]="photo"
      [pinchZoomEnabled]="enabled"
      (zoomedChange)="zoomed = $event"
      (swipe)="swipes.push($event)"
      (dismiss)="dismissed = dismissed + 1"
    >
      <img #photo class="photo" alt="" />
    </div>
  `,
})
class HostComponent {
  enabled = true;
  zoomed = false;
  swipes: string[] = [];
  dismissed = 0;
}

// jsdom has no PointerEvent: a mouse event carrying what the directive reads.
function pointer(
  type: string,
  x: number,
  y: number,
  options: { id?: number; kind?: string; time?: number } = {},
): Event {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, 'pointerId', { value: options.id ?? 1 });
  Object.defineProperty(event, 'pointerType', { value: options.kind ?? 'touch' });
  Object.defineProperty(event, 'timeStamp', { value: options.time ?? 0 });
  return event;
}

/** Long enough for a zoom animation, not yet for the sharp redraw after it. */
const ANIMATED = PinchZoomDirective.ANIMATION_MS + 40;
/** Animation and the sharp redraw. */
const SETTLED = ANIMATED + PinchZoomDirective.SETTLE_MS + 40;

describe('PinchZoomDirective', () => {
  beforeEach(() =>
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    }),
  );
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  function render(enabled = true) {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.enabled = enabled;
    fixture.detectChanges();
    const stage = fixture.nativeElement.querySelector('.stage') as HTMLElement;
    const photo = fixture.nativeElement.querySelector('.photo') as HTMLImageElement;
    // A 6000px-wide photo fitted at 400 x 300, centred on an 800 x 600 stage.
    const layout: Record<string, number> = {
      offsetWidth: 400,
      offsetHeight: 300,
      offsetLeft: 200,
      offsetTop: 150,
    };
    for (const [key, value] of Object.entries(layout)) {
      Object.defineProperty(photo, key, { value });
    }
    Object.defineProperty(photo, 'naturalWidth', { value: 6000 });
    Object.defineProperty(stage, 'clientWidth', { value: 800 });
    Object.defineProperty(stage, 'clientHeight', { value: 600 });
    stage.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    const host = fixture.componentInstance;
    const tap = (el: HTMLElement, x: number, y: number, time: number, kind = 'touch') => {
      el.dispatchEvent(pointer('pointerdown', x, y, { kind, time }));
      el.dispatchEvent(pointer('pointerup', x, y, { kind, time: time + 50 }));
    };
    const scale = () => Number(/scale\(([\d.]+)\)/.exec(photo.style.transform)?.[1] ?? 1);
    return { fixture, host, stage, photo, tap, scale };
  }

  it('pinching zooms the photo around the fingers, not the page', () => {
    const { host, stage, photo, scale } = render();
    expect(stage.style.touchAction).toBe('none');

    photo.dispatchEvent(pointer('pointerdown', 350, 300, { id: 1 }));
    photo.dispatchEvent(pointer('pointerdown', 450, 300, { id: 2 }));
    photo.dispatchEvent(pointer('pointermove', 300, 300, { id: 1 }));
    photo.dispatchEvent(pointer('pointermove', 500, 300, { id: 2 }));

    // Live with the fingers: a GPU transform.
    expect(scale()).toBeCloseTo(2);
    expect(photo.style.willChange).toBe('transform');
    expect(host.zoomed).toBe(true);

    photo.dispatchEvent(pointer('pointerup', 300, 300, { id: 1, time: 500 }));
    photo.dispatchEvent(pointer('pointerup', 500, 300, { id: 2, time: 500 }));
    vi.advanceTimersByTime(SETTLED);
    // A pinch is not a tap or a swipe.
    expect(host.dismissed).toBe(0);
    expect(host.swipes).toEqual([]);
    // Settled: laid out at 2x so it's drawn sharp.
    expect(photo.style.width).toBe('800px');
    expect(photo.style.transform).toBe('none');
  });

  it('springs back from pinching smaller than the screen', () => {
    const { host, photo, scale } = render();

    photo.dispatchEvent(pointer('pointerdown', 300, 300, { id: 1 }));
    photo.dispatchEvent(pointer('pointerdown', 500, 300, { id: 2 }));
    photo.dispatchEvent(pointer('pointermove', 350, 300, { id: 1 }));
    photo.dispatchEvent(pointer('pointermove', 450, 300, { id: 2 }));
    // Resists: half the fingers' distance is not half the size.
    expect(scale()).toBeGreaterThan(0.5);
    expect(scale()).toBeLessThan(1);

    photo.dispatchEvent(pointer('pointerup', 350, 300, { id: 1, time: 500 }));
    photo.dispatchEvent(pointer('pointerup', 450, 300, { id: 2, time: 500 }));
    vi.advanceTimersByTime(ANIMATED);
    expect(photo.style.transform).toBe('');
    expect(host.zoomed).toBe(false);
  });

  it('double-tap zooms in smoothly at that spot and back out, and dragging pans', () => {
    const { host, photo, tap, scale } = render();

    tap(photo, 300, 200, 0);
    tap(photo, 300, 200, 150);
    expect(host.zoomed).toBe(true);
    vi.advanceTimersByTime(PinchZoomDirective.ANIMATION_MS / 3);
    // Part way there: animated, not a jump.
    expect(scale()).toBeGreaterThan(1);
    expect(scale()).toBeLessThan(15);
    vi.advanceTimersByTime(ANIMATED);
    expect(scale()).toBeCloseTo(15);

    const before = photo.style.transform;
    photo.dispatchEvent(pointer('pointerdown', 400, 300, { time: 1000 }));
    photo.dispatchEvent(pointer('pointermove', 340, 280, { time: 1300 }));
    photo.dispatchEvent(pointer('pointerup', 340, 280, { time: 1350 }));
    expect(photo.style.transform).not.toBe(before);
    expect(host.swipes).toEqual([]);

    tap(photo, 300, 200, 2000);
    tap(photo, 300, 200, 2150);
    vi.advanceTimersByTime(ANIMATED);
    expect(photo.style.transform).toBe('');
    expect(host.zoomed).toBe(false);
  });

  it('once a zoom settles, lays the photo out at that size so it is drawn sharp', () => {
    const { photo, tap } = render();

    tap(photo, 400, 300, 0, 'mouse');
    vi.advanceTimersByTime(ANIMATED);
    // Just finished animating: still the quick transform.
    expect(photo.style.transform).toContain('scale(');
    vi.advanceTimersByTime(SETTLED);

    // 6000px photo shown 400px wide: 15x is actual pixels (no device scaling here).
    expect(photo.style.transform).toBe('none');
    expect(photo.style.position).toBe('absolute');
    expect(photo.style.width).toBe('6000px');
    expect(photo.style.height).toBe('4500px');
    // Clicked at the centre, so the centre stays put: 400 - 6000 / 2.
    expect(photo.style.left).toBe('-2600px');

    // Touching it again goes back to the transform for the gesture...
    photo.dispatchEvent(pointer('pointerdown', 400, 300, { time: 1000, kind: 'mouse' }));
    expect(photo.style.width).toBe('');
    expect(photo.style.transform).toContain('scale(15)');
    // ...a slow drag moves it exactly with the pointer...
    photo.dispatchEvent(pointer('pointermove', 300, 300, { time: 1300, kind: 'mouse' }));
    photo.dispatchEvent(pointer('pointerup', 300, 300, { time: 1400, kind: 'mouse' }));
    vi.advanceTimersByTime(SETTLED);
    // ...and it's sharp again where it was left.
    expect(photo.style.width).toBe('6000px');
    expect(photo.style.left).toBe('-2700px');

    // A quick flick glides on past where the pointer stopped.
    photo.dispatchEvent(pointer('pointerdown', 400, 300, { time: 3000, kind: 'mouse' }));
    photo.dispatchEvent(pointer('pointermove', 300, 300, { time: 3040, kind: 'mouse' }));
    photo.dispatchEvent(pointer('pointerup', 300, 300, { time: 3050, kind: 'mouse' }));
    vi.advanceTimersByTime(SETTLED);
    expect(parseFloat(photo.style.left)).toBeLessThan(-2800);
  });

  it('never stretches the picture: zoomed sizes keep its shape', () => {
    const { photo, tap } = render();
    // A 6000 x 3000 picture letterboxed in its 400 x 300 box: shown 400 x 200.
    Object.defineProperty(photo, 'naturalHeight', { value: 3000 });

    tap(photo, 400, 300, 0, 'mouse');
    vi.advanceTimersByTime(SETTLED);

    expect(parseFloat(photo.style.width) / parseFloat(photo.style.height)).toBeCloseTo(2);
  });

  it('zoomed all the way in, the picture keeps its shape and stays within GPU limits', () => {
    const { stage, photo } = render();

    for (let i = 0; i < 30; i++) {
      stage.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -400, clientX: 400, clientY: 300, cancelable: true }),
      );
      vi.advanceTimersByTime(20);
    }
    vi.advanceTimersByTime(SETTLED);

    const width = parseFloat(photo.style.width);
    const height = parseFloat(photo.style.height);
    expect(width).toBeLessThanOrEqual(PinchZoomDirective.MAX_LAYER_PX);
    expect(width).toBeGreaterThan(6000);
    expect(width / height).toBeCloseTo(400 / 300);
    // Laid out, not stretched by a leftover transform.
    expect(photo.style.transform).toBe('none');
  });

  it('a mouse click on the photo zooms and unzooms; the wheel zooms too', () => {
    const { host, stage, photo, tap } = render();

    tap(photo, 400, 300, 0, 'mouse');
    vi.advanceTimersByTime(ANIMATED);
    expect(host.zoomed).toBe(true);
    tap(photo, 400, 300, 1000, 'mouse');
    vi.advanceTimersByTime(ANIMATED);
    expect(host.zoomed).toBe(false);
    expect(photo.style.transform).toBe('');

    const wheel = new WheelEvent('wheel', {
      deltaY: -200,
      clientX: 400,
      clientY: 300,
      cancelable: true,
    });
    stage.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(host.zoomed).toBe(true);
    vi.advanceTimersByTime(SETTLED);
    expect(photo.style.width).not.toBe('');
  });

  it('at normal size: the photo follows a sideways swipe, and a tap beside it dismisses', () => {
    const { host, stage, photo, tap } = render();

    photo.dispatchEvent(pointer('pointerdown', 500, 300, { time: 0 }));
    photo.dispatchEvent(pointer('pointermove', 380, 305, { time: 100 }));
    expect(photo.style.transform).toContain('translate3d(-120px, 0px, 0)');
    photo.dispatchEvent(pointer('pointerup', 380, 305, { time: 400 }));
    photo.dispatchEvent(pointer('pointerdown', 300, 300, { time: 1000 }));
    photo.dispatchEvent(pointer('pointerup', 420, 300, { time: 1400 }));
    expect(host.swipes).toEqual(['next', 'previous']);
    expect(photo.style.transform).toBe('');

    // A short drag isn't a swipe: it slides back.
    photo.dispatchEvent(pointer('pointerdown', 400, 300, { time: 1500 }));
    photo.dispatchEvent(pointer('pointermove', 370, 300, { time: 1600 }));
    photo.dispatchEvent(pointer('pointerup', 370, 300, { time: 1700 }));
    vi.advanceTimersByTime(ANIMATED);
    expect(host.swipes).toEqual(['next', 'previous']);
    expect(photo.style.transform).toBe('');

    tap(photo, 400, 300, 2000);
    vi.advanceTimersByTime(PinchZoomDirective.DOUBLE_TAP_MS);
    expect(host.dismissed).toBe(0);

    tap(stage, 50, 50, 5000);
    expect(host.dismissed).toBe(0);
    vi.advanceTimersByTime(PinchZoomDirective.DOUBLE_TAP_MS);
    expect(host.dismissed).toBe(1);
  });

  it('does nothing to the photo while disabled (still loading)', () => {
    const { host, photo, tap } = render(false);

    tap(photo, 300, 200, 0);
    tap(photo, 300, 200, 150);
    vi.advanceTimersByTime(SETTLED);
    expect(photo.style.transform).toBe('');
    expect(host.zoomed).toBe(false);
  });
});
