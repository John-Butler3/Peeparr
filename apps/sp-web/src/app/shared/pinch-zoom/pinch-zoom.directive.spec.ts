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

describe('PinchZoomDirective', () => {
  beforeEach(() => vi.useFakeTimers());
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

    expect(scale()).toBeCloseTo(2);
    expect(host.zoomed).toBe(true);

    photo.dispatchEvent(pointer('pointerup', 300, 300, { id: 1 }));
    photo.dispatchEvent(pointer('pointerup', 500, 300, { id: 2 }));
    // A pinch is not a tap or a swipe.
    vi.advanceTimersByTime(PinchZoomDirective.DOUBLE_TAP_MS);
    expect(host.dismissed).toBe(0);
    expect(host.swipes).toEqual([]);
  });

  it('double-tap zooms in at that spot and back out, and dragging pans meanwhile', () => {
    const { host, photo, tap, scale } = render();

    tap(photo, 300, 200, 0);
    tap(photo, 300, 200, 150);
    expect(scale()).toBeGreaterThanOrEqual(2.5);
    expect(host.zoomed).toBe(true);

    const before = photo.style.transform;
    photo.dispatchEvent(pointer('pointerdown', 400, 300, { time: 1000 }));
    photo.dispatchEvent(pointer('pointermove', 340, 280, { time: 1050 }));
    photo.dispatchEvent(pointer('pointerup', 340, 280, { time: 1100 }));
    expect(photo.style.transform).not.toBe(before);
    expect(host.swipes).toEqual([]);

    tap(photo, 300, 200, 2000);
    tap(photo, 300, 200, 2150);
    expect(photo.style.transform).toBe('');
    expect(host.zoomed).toBe(false);
  });

  it('a mouse click on the photo zooms; the wheel zooms too', () => {
    const { host, stage, photo, tap, scale } = render();

    tap(photo, 400, 300, 0, 'mouse');
    expect(host.zoomed).toBe(true);
    tap(photo, 400, 300, 1000, 'mouse');
    expect(host.zoomed).toBe(false);

    const wheel = new WheelEvent('wheel', {
      deltaY: -200,
      clientX: 400,
      clientY: 300,
      cancelable: true,
    });
    stage.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(scale()).toBeGreaterThan(1);
  });

  it('at normal size: swipes sideways, and a tap beside the photo dismisses', () => {
    const { host, stage, photo, tap } = render();

    photo.dispatchEvent(pointer('pointerdown', 500, 300, { time: 0 }));
    photo.dispatchEvent(pointer('pointermove', 380, 305, { time: 100 }));
    photo.dispatchEvent(pointer('pointerup', 380, 305, { time: 400 }));
    photo.dispatchEvent(pointer('pointerdown', 300, 300, { time: 1000 }));
    photo.dispatchEvent(pointer('pointerup', 420, 300, { time: 1400 }));
    expect(host.swipes).toEqual(['next', 'previous']);

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
    expect(photo.style.transform).toBe('');
    expect(host.zoomed).toBe(false);
  });
});
